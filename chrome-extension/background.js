importScripts("config.js", "data-core.js");

const {
  calculateAverageBuyAmount,
  calculateMarketData,
  mapUpbitOrder,
  resolveFlameMode,
} = globalThis.SaltbreadCore;
const {
  appUrl: APP_URL,
  appOrigins,
  apiBaseUrl: API_BASE_URL,
  detectPath: DETECT_PATH,
  behaviorEventsPath: BEHAVIOR_EVENTS_PATH,
  upbitApiBaseUrl: UPBIT_API_BASE_URL,
} = globalThis.SALTBREAD_CONFIG;
const DEVELOPMENT_APP_HOSTNAMES = new Set(["localhost", "127.0.0.1"]);
const ALLOWED_APP_ORIGINS = [
  ...new Set([APP_URL, ...(appOrigins || [])]),
];
const APP_TAB_URL_PATTERNS = [
  ...ALLOWED_APP_ORIGINS.map((origin) => `${origin}/*`),
  "http://localhost/*",
  "http://127.0.0.1/*",
];
const COLLECTION_ALARM = "saltbread-minute-collection";
const CREDENTIALS_STORAGE_KEY = "upbitCredentials";
const SESSION_KEY_STORAGE_KEY = "upbitCredentialSessionKey";
const REFRESH_TOKEN_COOKIE_NAME = "refreshToken";
const PUBLIC_REQUEST_INTERVAL_MS = 10_100;
const MARKET_DETAILS_CACHE_MS = 10 * 60 * 1000;
const DETECTION_MARKET_CACHE_MS = 2 * 60 * 1000;
const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();
let publicRequestQueue = Promise.resolve();
let lastPublicRequestAt = 0;

function normalizeAllowedAppOrigin(value) {
  if (!value || typeof value !== "string") {
    return null;
  }

  try {
    const url = new URL(value);
    const origin = url.origin;
    const isDevelopmentOrigin =
      url.protocol === "http:" &&
      DEVELOPMENT_APP_HOSTNAMES.has(url.hostname);

    return ALLOWED_APP_ORIGINS.includes(origin) || isDevelopmentOrigin
      ? origin
      : null;
  } catch {
    return null;
  }
}

function getSenderOrigin(sender) {
  return normalizeAllowedAppOrigin(sender?.origin || sender?.url || "");
}

function getAuthApiBase(auth) {
  return normalizeAllowedAppOrigin(auth?.appOrigin) || API_BASE_URL;
}

async function resolveCurrentAppOrigin() {
  const activeTabs = await chrome.tabs.query({
    active: true,
    currentWindow: true,
  });
  const activeOrigin = normalizeAllowedAppOrigin(activeTabs[0]?.url);

  if (activeOrigin) {
    return activeOrigin;
  }

  const appTabs = await chrome.tabs.query({ url: APP_TAB_URL_PATTERNS });
  const mostRecentOrigin = [...appTabs]
    .sort((left, right) => (right.lastAccessed || 0) - (left.lastAccessed || 0))
    .map((tab) => normalizeAllowedAppOrigin(tab.url))
    .find(Boolean);

  return mostRecentOrigin || normalizeAllowedAppOrigin(APP_URL) || APP_URL;
}

async function readRefreshCookie(appOrigin) {
  if (!chrome.cookies?.get) {
    throw new Error("확장 프로그램의 쿠키 권한을 확인해 주세요.");
  }

  return chrome.cookies.get({
    url: `${appOrigin}/`,
    name: REFRESH_TOKEN_COOKIE_NAME,
  });
}

async function rotateRefreshCookie(appOrigin, refreshToken) {
  if (!refreshToken || !chrome.cookies?.set) {
    return;
  }

  await chrome.cookies.set({
    url: `${appOrigin}/`,
    name: REFRESH_TOKEN_COOKIE_NAME,
    value: refreshToken,
    path: "/",
    httpOnly: true,
    secure: appOrigin.startsWith("https://"),
    sameSite: "lax",
  });
}

async function refreshAuthForOrigin(appOrigin, currentAuth = {}) {
  const cookie = await readRefreshCookie(appOrigin);

  if (!cookie?.value) {
    throw new Error("웹 로그인 세션을 찾지 못했어요. 다시 로그인해 주세요.");
  }

  const refreshed = await fetchJson(
    `${appOrigin}/api/auth/extension/refresh`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken: cookie.value }),
    },
  );

  if (!refreshed?.accessToken || !refreshed?.refreshToken || !refreshed?.user) {
    throw new Error("서버에서 올바른 로그인 정보를 받지 못했어요.");
  }

  await rotateRefreshCookie(appOrigin, refreshed.refreshToken);

  const auth = {
    ...currentAuth,
    accessToken: refreshed.accessToken,
    expiresAt: Date.now() + Number(refreshed.expiresIn) * 1000,
    user: refreshed.user,
    appOrigin,
  };
  await chrome.storage.local.set({ auth });
  return auth;
}

async function handleAuthHandoff(appOrigin, sender = {}) {
  const normalizedAppOrigin = normalizeAllowedAppOrigin(appOrigin);
  const senderOrigin = getSenderOrigin(sender);

  if (!normalizedAppOrigin || senderOrigin !== normalizedAppOrigin) {
    throw new Error("허용되지 않은 앱 주소에서 보낸 연결 요청입니다.");
  }

  return refreshAuthForOrigin(normalizedAppOrigin);
}

globalThis.handleAuthHandoff = handleAuthHandoff;

function bytesToBase64(bytes) {
  let binary = "";

  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary);
}

function base64ToBytes(value) {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function bytesToBase64Url(bytes) {
  return bytesToBase64(bytes)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/g, "");
}

async function deriveCredentialKey(passphrase, salt) {
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    textEncoder.encode(passphrase),
    "PBKDF2",
    false,
    ["deriveKey"],
  );

  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      salt,
      iterations: 250_000,
    },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    true,
    ["encrypt", "decrypt"],
  );
}

async function saveCredentialSessionKey(key) {
  const rawKey = new Uint8Array(await crypto.subtle.exportKey("raw", key));
  await chrome.storage.session.set({
    [SESSION_KEY_STORAGE_KEY]: bytesToBase64(rawKey),
  });
}

async function encryptAndStoreCredentials(accessKey, secretKey, passphrase) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveCredentialKey(passphrase, salt);
  const plaintext = textEncoder.encode(JSON.stringify({ accessKey, secretKey }));
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plaintext),
  );

  await chrome.storage.local.set({
    [CREDENTIALS_STORAGE_KEY]: {
      version: 1,
      salt: bytesToBase64(salt),
      iv: bytesToBase64(iv),
      ciphertext: bytesToBase64(ciphertext),
      updatedAt: new Date().toISOString(),
    },
  });
  await saveCredentialSessionKey(key);
}

async function importCredentialSessionKey() {
  const result = await chrome.storage.session.get(SESSION_KEY_STORAGE_KEY);
  const encodedKey = result[SESSION_KEY_STORAGE_KEY];

  if (!encodedKey) {
    throw new Error(
      "Upbit API 키가 잠겨 있습니다. 확장 프로그램 팝업에서 잠금을 해제해 주세요.",
    );
  }

  return crypto.subtle.importKey(
    "raw",
    base64ToBytes(encodedKey),
    { name: "AES-GCM" },
    false,
    ["decrypt"],
  );
}

async function decryptCredentials(key = null) {
  const result = await chrome.storage.local.get(CREDENTIALS_STORAGE_KEY);
  const encrypted = result[CREDENTIALS_STORAGE_KEY];

  if (!encrypted) {
    throw new Error(
      "Upbit API 키가 설정되지 않았습니다. 확장 프로그램 팝업에서 등록해 주세요.",
    );
  }

  const decryptionKey = key || (await importCredentialSessionKey());
  const plaintext = await crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: base64ToBytes(encrypted.iv),
    },
    decryptionKey,
    base64ToBytes(encrypted.ciphertext),
  );

  return JSON.parse(textDecoder.decode(plaintext));
}

async function unlockCredentials(passphrase) {
  const result = await chrome.storage.local.get(CREDENTIALS_STORAGE_KEY);
  const encrypted = result[CREDENTIALS_STORAGE_KEY];

  if (!encrypted) {
    throw new Error("저장된 Upbit API 키가 없습니다.");
  }

  try {
    const key = await deriveCredentialKey(
      passphrase,
      base64ToBytes(encrypted.salt),
    );
    await decryptCredentials(key);
    await saveCredentialSessionKey(key);
  } catch {
    throw new Error("로컬 암호화 비밀번호가 올바르지 않습니다.");
  }
}

async function getCredentialStatus() {
  const [local, session] = await Promise.all([
    chrome.storage.local.get(CREDENTIALS_STORAGE_KEY),
    chrome.storage.session.get(SESSION_KEY_STORAGE_KEY),
  ]);

  return {
    configured: Boolean(local[CREDENTIALS_STORAGE_KEY]),
    unlocked: Boolean(session[SESSION_KEY_STORAGE_KEY]),
    updatedAt: local[CREDENTIALS_STORAGE_KEY]?.updatedAt || null,
  };
}

async function removeCredentials() {
  await Promise.all([
    chrome.storage.local.remove(CREDENTIALS_STORAGE_KEY),
    chrome.storage.session.remove(SESSION_KEY_STORAGE_KEY),
  ]);
}

async function clearExtensionSession() {
  await Promise.all([
    chrome.storage.local.remove("auth"),
    removeCredentials(),
  ]);
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  const data = await response.json().catch(() => null);

  if (!response.ok) {
    const message =
      data?.error?.message ||
      data?.message ||
      `요청에 실패했습니다. (${response.status})`;
    const error = new Error(message);
    error.status = response.status;
    error.code = data?.error?.name || data?.name || null;
    throw error;
  }

  return data;
}

async function getValidBackendAuth() {
  const { auth } = await chrome.storage.local.get("auth");

  if (!auth?.accessToken || !auth?.user) {
    return null;
  }

  if (auth.expiresAt > Date.now() + 60_000) {
    return auth;
  }

  const appOrigin = normalizeAllowedAppOrigin(auth.appOrigin);

  if (appOrigin) {
    try {
      return await refreshAuthForOrigin(appOrigin, auth);
    } catch (error) {
      await clearExtensionSession();
      throw error;
    }
  }

  const refreshed = await fetchJson(`${API_BASE_URL}/api/auth/refresh`, {
    method: "POST",
    credentials: "include",
  });
  const nextAuth = {
    ...auth,
    accessToken: refreshed.accessToken,
    expiresAt: Date.now() + Number(refreshed.expiresIn) * 1000,
  };
  await chrome.storage.local.set({ auth: nextAuth });
  return nextAuth;
}

async function removeRefreshCookie(appOrigin) {
  if (!chrome.cookies?.remove) {
    return;
  }

  await chrome.cookies.remove({
    url: `${appOrigin}/`,
    name: REFRESH_TOKEN_COOKIE_NAME,
  });
}

async function redirectAppTabsToLogin(appOrigin) {
  const tabs = await chrome.tabs.query({ url: [`${appOrigin}/*`] });

  await Promise.all(
    tabs
      .filter((tab) => typeof tab.id === "number")
      .map((tab) => chrome.tabs.update?.(tab.id, { url: `${appOrigin}/login` })),
  );
}

async function logoutEverywhere() {
  const { auth } = await chrome.storage.local.get("auth");
  const appOrigin =
    normalizeAllowedAppOrigin(auth?.appOrigin) ||
    (await resolveCurrentAppOrigin());
  let serverError = null;

  try {
    await fetchJson(`${appOrigin}/api/auth/logout`, {
      method: "POST",
      credentials: "include",
      headers: auth?.accessToken
        ? { Authorization: `Bearer ${auth.accessToken}` }
        : {},
    });
  } catch (error) {
    serverError = error.message;
  } finally {
    await Promise.all([
      removeRefreshCookie(appOrigin),
      clearExtensionSession(),
    ]);
    await redirectAppTabsToLogin(appOrigin);
  }

  return { appOrigin, serverError };
}

function createBackendHeaders(auth, includeUserId = false) {
  const headers = {
    Authorization: `Bearer ${auth.accessToken}`,
    "Content-Type": "application/json",
  };

  if (includeUserId && auth.user?.id) {
    headers["X-User-Id"] = auth.user.id;
  }

  return headers;
}

async function postDetectionRequest(requestBody, auth) {
  return fetchJson(`${getAuthApiBase(auth)}${DETECT_PATH}`, {
    method: "POST",
    headers: createBackendHeaders(auth),
    body: JSON.stringify(requestBody),
  });
}

async function postBehaviorEvent(eventPayload, existingAuth = null) {
  const auth = existingAuth || (await getValidBackendAuth());

  if (!auth?.accessToken || !auth.user?.id) {
    throw new Error("로그인 후 행동 로그 저장을 다시 시도해 주세요.");
  }

  return fetchJson(`${getAuthApiBase(auth)}${BEHAVIOR_EVENTS_PATH}`, {
    method: "POST",
    headers: createBackendHeaders(auth, true),
    body: JSON.stringify(eventPayload),
  });
}

function wait(durationMs) {
  return new Promise((resolve) => setTimeout(resolve, durationMs));
}

function fetchPublicUpbit(path) {
  const request = publicRequestQueue
    .catch(() => {})
    .then(async () => {
      const remainingWait =
        PUBLIC_REQUEST_INTERVAL_MS - (Date.now() - lastPublicRequestAt);

      if (remainingWait > 0) {
        await wait(remainingWait);
      }

      try {
        return await fetchJson(`${UPBIT_API_BASE_URL}${path}`);
      } finally {
        lastPublicRequestAt = Date.now();
      }
    });
  publicRequestQueue = request;
  return request;
}

async function getMarketDetails() {
  const { upbitMarketDetailsCache } = await chrome.storage.local.get(
    "upbitMarketDetailsCache",
  );

  if (
    upbitMarketDetailsCache?.data &&
    Date.now() - upbitMarketDetailsCache.collectedAt <
      MARKET_DETAILS_CACHE_MS
  ) {
    return upbitMarketDetailsCache.data;
  }

  const data = await fetchPublicUpbit("/v1/market/all?is_details=true");
  await chrome.storage.local.set({
    upbitMarketDetailsCache: {
      data,
      collectedAt: Date.now(),
    },
  });
  return data;
}

async function collectMarketData(market) {
  const encodedMarket = encodeURIComponent(market);
  const [candles, tickers, marketDetails] = await Promise.all([
    fetchPublicUpbit(
      `/v1/candles/minutes/1?market=${encodedMarket}&count=20`,
    ),
    fetchPublicUpbit(
      "/v1/ticker/all?quote_currencies=KRW",
    ),
    getMarketDetails(),
  ]);
  const collected = {
    market,
    ...calculateMarketData({
      market,
      candles,
      tickers,
      marketDetails,
    }),
    collected_at: new Date().toISOString(),
  };
  const { marketDataCache = {} } =
    await chrome.storage.local.get("marketDataCache");
  marketDataCache[market] = collected;
  await chrome.storage.local.set({ marketDataCache });
  return collected;
}

async function createJwt(accessKey, secretKey, queryString = "") {
  const header = bytesToBase64Url(
    textEncoder.encode(JSON.stringify({ alg: "HS512", typ: "JWT" })),
  );
  const payload = {
    access_key: accessKey,
    nonce: crypto.randomUUID(),
  };

  if (queryString) {
    const queryHash = await crypto.subtle.digest(
      "SHA-512",
      textEncoder.encode(queryString),
    );
    payload.query_hash = [...new Uint8Array(queryHash)]
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
    payload.query_hash_alg = "SHA512";
  }

  const encodedPayload = bytesToBase64Url(
    textEncoder.encode(JSON.stringify(payload)),
  );
  const unsignedToken = `${header}.${encodedPayload}`;
  const signingKey = await crypto.subtle.importKey(
    "raw",
    textEncoder.encode(secretKey),
    { name: "HMAC", hash: "SHA-512" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    signingKey,
    textEncoder.encode(unsignedToken),
  );

  return `${unsignedToken}.${bytesToBase64Url(new Uint8Array(signature))}`;
}

function createQueryString(entries) {
  return entries
    .map(([key, value]) => `${key}=${value}`)
    .join("&");
}

function createEncodedQueryString(entries) {
  return entries
    .map(([key, value]) => {
      const encodedKey = encodeURIComponent(key)
        .replaceAll("%5B", "[")
        .replaceAll("%5D", "]");

      return `${encodedKey}=${encodeURIComponent(value)}`;
    })
    .join("&");
}

async function fetchPrivateUpbit(path, entries, credentials) {
  const queryString = createQueryString(entries);
  const encodedQueryString = createEncodedQueryString(entries);
  const jwt = await createJwt(
    credentials.accessKey,
    credentials.secretKey,
    queryString,
  );
  const url = `${UPBIT_API_BASE_URL}${path}${encodedQueryString ? `?${encodedQueryString}` : ""}`;

  return fetchJson(url, {
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${jwt}`,
    },
  });
}

function toUpbitCredentialValidationError(error, checkLabel) {
  if (error.code === "no_authorization_ip") {
    return new Error(
      "현재 네트워크의 공인 IP가 업비트 API Key에 등록되어 있지 않습니다.",
    );
  }

  if (error.code === "out_of_scope") {
    return new Error(
      `${checkLabel} 권한이 없습니다. 업비트 API Key에 자산조회와 주문조회 권한을 추가해 주세요.`,
    );
  }

  if (
    [
      "invalid_access_key",
      "expired_access_key",
      "jwt_verification",
    ].includes(error.code) ||
    error.status === 401
  ) {
    return new Error(
      "Access Key 또는 Secret Key가 올바르지 않거나 만료되었습니다.",
    );
  }

  return new Error(`${checkLabel} 검증에 실패했습니다. ${error.message}`);
}

async function validateUpbitCredentials(credentials) {
  const checks = [
    {
      label: "자산조회",
      path: "/v1/accounts",
      entries: [],
    },
    {
      label: "체결 대기 주문조회",
      path: "/v1/orders/open",
      entries: [["limit", "1"]],
    },
    {
      label: "종료 주문조회",
      path: "/v1/orders/closed",
      entries: [["limit", "1"]],
    },
  ];

  for (const check of checks) {
    try {
      await fetchPrivateUpbit(check.path, check.entries, credentials);
    } catch (error) {
      throw toUpbitCredentialValidationError(error, check.label);
    }
  }
}

async function collectOrderData(market) {
  const credentials = await decryptCredentials();
  const [closedOrders, openOrders, accounts] = await Promise.all([
    fetchPrivateUpbit("/v1/orders/closed", [], credentials),
    fetchPrivateUpbit(
      "/v1/orders/open",
      [
        ["market", market],
        ["states[]", "wait"],
        ["states[]", "watch"],
        ["limit", "100"],
        ["order_by", "desc"],
      ],
      credentials,
    ),
    fetchPrivateUpbit("/v1/accounts", [], credentials),
  ]);
  const averageBuyPrices = Object.fromEntries(
    accounts.map((account) => [account.currency, account.avg_buy_price]),
  );
  const recentOrders = [...openOrders, ...closedOrders]
    .map((order) => mapUpbitOrder(order, averageBuyPrices))
    .sort(
      (left, right) =>
        Date.parse(right.order_request_time) -
        Date.parse(left.order_request_time),
    );
  const clientAverageBuyAmount = calculateAverageBuyAmount(closedOrders);
  const collected = {
    market,
    recentOrders,
    clientAverageBuyAmount,
    collected_at: new Date().toISOString(),
  };
  const { orderDataCache = {} } =
    await chrome.storage.local.get("orderDataCache");
  orderDataCache[market] = collected;
  await chrome.storage.local.set({ orderDataCache });
  return collected;
}

async function collectOrderDataForDetection(market) {
  try {
    const orderData = await collectOrderData(market);
    return { ...orderData, privateDataAvailable: true };
  } catch {
    return {
      market,
      recentOrders: [],
      clientAverageBuyAmount: null,
      collected_at: new Date().toISOString(),
      privateDataAvailable: false,
    };
  }
}

async function sendTabMessage(tabId, message) {
  try {
    return await chrome.tabs.sendMessage(tabId, message);
  } catch {
    return null;
  }
}

async function callDetectionApi(
  tabId,
  context,
  marketData,
  options = {},
) {
  if (!context.currentOrder || !context.behaviorData) {
    return null;
  }

  const [auth, { orderDataCache = {} }] = await Promise.all([
    getValidBackendAuth(),
    chrome.storage.local.get("orderDataCache"),
  ]);

  if (!auth?.accessToken) {
    return null;
  }

  const orderData = context.demoData
    ? {
        recentOrders: context.demoData.recentOrders || [],
        clientAverageBuyAmount:
          context.demoData.clientAverageBuyAmount ?? null,
      }
    : options.orderData || orderDataCache[context.market];
  const recentOrders = orderData?.recentOrders || [];
  const lastLoss = recentOrders.find(
    (order) =>
      order.order_side === "SELL" &&
      order.realized_loss_pct_1h !== null &&
      Date.now() - Date.parse(order.order_request_time) <= 60 * 60 * 1000,
  );
  const requestBody = {
    market: context.market,
    current_price: marketData.current_price,
    market_data: marketData.market_data,
    current_order: {
      ...context.currentOrder,
      realized_loss_pct_1h: lastLoss?.realized_loss_pct_1h ?? null,
    },
    behavior_data: {
      ...context.behaviorData,
      client_avg_buy_amount:
        orderData
          ? orderData.clientAverageBuyAmount ?? null
          : context.behaviorData.client_avg_buy_amount ?? null,
    },
    recent_orders: recentOrders,
  };

  const behaviorEvent = {
    ...(context.sessionId ? { sessionId: context.sessionId } : {}),
    symbol: requestBody.market,
    eventType: "ORDER_SUBMIT_ATTEMPT",
    side: requestBody.current_order.order_side,
    orderType: requestBody.current_order.order_type,
    price: requestBody.current_order.order_price,
    amount: requestBody.current_order.order_amount,
    quantity: requestBody.current_order.order_volume,
    ...(context.pageUrl ? { pageUrl: context.pageUrl } : {}),
    occurredAt: requestBody.current_order.order_request_time,
    metadata: {
      behaviorData: requestBody.behavior_data,
      currentPrice: requestBody.current_price,
      marketData: requestBody.market_data,
    },
  };
  const detectionPromise = postDetectionRequest(requestBody, auth);
  const behaviorSaveTask =
    options.logSubmitAttempt === false
      ? Promise.resolve()
      : postBehaviorEvent(behaviorEvent, auth)
          .then(() =>
            sendTabMessage(tabId, {
              type: "BEHAVIOR_EVENT_STATUS",
              payload: { message: "" },
            }),
          )
          .catch((error) =>
            sendTabMessage(tabId, {
              type: "BEHAVIOR_EVENT_STATUS",
              payload: {
                message: `행동 로그 저장 실패: ${error.message}`,
              },
            }),
          );
  let result;

  try {
    result = await detectionPromise;
  } catch (error) {
    await behaviorSaveTask;
    throw error;
  }

  const flameMode = resolveFlameMode(
    result,
    context.currentOrder.order_side,
  );
  const themedResult = { ...result, flameMode };
  await chrome.storage.local.set({
    flameTheme: {
      mode: flameMode,
      detected: Boolean(result?.detected),
      type: result?.type || null,
      orderSide: context.currentOrder.order_side,
      updatedAt: new Date().toISOString(),
    },
  });
  await sendTabMessage(tabId, {
    type: "DETECTION_RESULT",
    payload: themedResult,
  });
  await behaviorSaveTask;
  return themedResult;
}

async function getMarketDataForDetection(market) {
  const { marketDataCache = {} } =
    await chrome.storage.local.get("marketDataCache");
  const cached = marketDataCache[market];
  const isFresh =
    cached?.collected_at &&
    Date.now() - Date.parse(cached.collected_at) <= DETECTION_MARKET_CACHE_MS;

  return isFresh ? cached : collectMarketData(market);
}

function getDemoMarketData(context) {
  const currentPrice = Number(context.demoData?.currentPrice);
  const marketData = context.demoData?.marketData;

  if (
    !Number.isFinite(currentPrice) ||
    currentPrice <= 0 ||
    !marketData ||
    !Number.isFinite(marketData.price_change_rate_15m) ||
    !Number.isFinite(marketData.volume_change_rate_1m) ||
    typeof marketData.is_top3_volatility !== "boolean" ||
    typeof marketData.has_warning_badge !== "boolean"
  ) {
    return null;
  }

  return {
    market: context.market,
    current_price: currentPrice,
    market_data: marketData,
    collected_at: new Date().toISOString(),
    isDemo: true,
  };
}

async function getMarketDataForContext(context) {
  return (
    getDemoMarketData(context) ||
    getMarketDataForDetection(context.market)
  );
}

async function runMinuteCycleForTab(tab) {
  const context = await sendTabMessage(tab.id, {
    type: "GET_CONTEXT_SNAPSHOT",
  });

  if (!context?.market) {
    return;
  }

  try {
    await sendTabMessage(tab.id, { type: "COLLECTION_STARTED" });
    const marketData =
      getDemoMarketData(context) || (await collectMarketData(context.market));
    await callDetectionApi(tab.id, context, marketData, {
      logSubmitAttempt: false,
    });
  } catch (error) {
    await sendTabMessage(tab.id, {
      type: "COLLECTION_ERROR",
      payload: { message: error.message },
    });
  }
}

async function runMinuteCycle() {
  const tabs = await chrome.tabs.query({
    url: [
      "https://upbit.com/exchange*",
      "https://www.upbit.com/exchange*",
      ...APP_TAB_URL_PATTERNS,
    ],
  });
  await Promise.all(tabs.map(runMinuteCycleForTab));
}

async function ensureCollectionAlarm() {
  const alarm = await chrome.alarms.get(COLLECTION_ALARM);

  if (!alarm) {
    await chrome.alarms.create(COLLECTION_ALARM, {
      delayInMinutes: 1,
      periodInMinutes: 1,
    });
  }
}

chrome.runtime.onInstalled.addListener(ensureCollectionAlarm);
chrome.runtime.onStartup.addListener(ensureCollectionAlarm);
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === COLLECTION_ALARM) {
    runMinuteCycle();
  }
});
ensureCollectionAlarm();

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "OPEN_AUTH") {
    const mode = message.payload?.mode === "signup" ? "signup" : "login";

    resolveCurrentAppOrigin()
      .then((appOrigin) => {
        const url = new URL(`/${mode}`, appOrigin);
        if (chrome.runtime.id) {
          url.searchParams.set("extensionId", chrome.runtime.id);
        }
        return chrome.tabs.create({ url: url.toString() });
      })
      .then(() => sendResponse({ ok: true }))
      .catch(() =>
        sendResponse({ ok: false, error: "로그인 페이지를 열 수 없습니다." }),
      );
    return true;
  }

  if (message?.type === "OPEN_DASHBOARD") {
    resolveCurrentAppOrigin()
      .then((appOrigin) =>
        chrome.tabs.create({ url: `${appOrigin}/dashboard` }),
      )
      .then(() => sendResponse({ ok: true }))
      .catch(() =>
        sendResponse({ ok: false, error: "대시보드를 열 수 없습니다." }),
      );
    return true;
  }

  if (message?.type === "GET_AUTH_STATE") {
    getValidBackendAuth()
      .then((auth) => sendResponse({ ok: true, auth }))
      .catch((error) =>
        sendResponse({ ok: false, error: error.message }),
      );
    return true;
  }

  if (message?.type === "LOGOUT_EVERYWHERE") {
    logoutEverywhere()
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message?.type === "REGISTER_MARKET_CONTEXT") {
    collectMarketData(message.payload.market)
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message?.type === "LOG_BEHAVIOR_EVENT") {
    postBehaviorEvent(message.payload)
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message?.type === "RUN_DETECTION_NOW") {
    const context = message.payload;

    if (
      !sender.tab?.id ||
      !context?.market ||
      !context.currentOrder ||
      !context.behaviorData
    ) {
      sendResponse({
        ok: false,
        error: "즉시 감지에 필요한 현재 주문 정보가 없습니다.",
      });
      return false;
    }

    getMarketDataForContext(context)
      .then((marketData) =>
        callDetectionApi(sender.tab.id, context, marketData),
      )
      .then((detection) =>
        sendResponse(
          detection
            ? { ok: true, detection }
            : {
                ok: false,
                error: "로그인 후 즉시 감지를 다시 실행해 주세요.",
              },
        ),
      )
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message?.type === "RESET_DEMO_STATE") {
    chrome.storage.local
      .set({
        flameTheme: {
          mode: "default",
          detected: false,
          type: null,
          orderSide: null,
          updatedAt: new Date().toISOString(),
        },
      })
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message?.type === "ORDER_ACTION_DETECTED") {
    const collectOrder = message.payload.demoData
      ? Promise.resolve({
          market: message.payload.market,
          recentOrders: message.payload.demoData.recentOrders || [],
          clientAverageBuyAmount:
            message.payload.demoData.clientAverageBuyAmount ?? null,
          collected_at: new Date().toISOString(),
          isDemo: true,
          privateDataAvailable: true,
        })
      : collectOrderDataForDetection(message.payload.market);

    collectOrder
      .then(async (orderData) => {
        let detection = null;

        if (sender.tab?.id) {
          await sendTabMessage(sender.tab.id, {
            type: "ORDER_DATA_UPDATED",
            payload: orderData,
          });
          const marketData = await getMarketDataForContext(message.payload);
          detection = await callDetectionApi(
            sender.tab.id,
            message.payload,
            marketData,
            { orderData },
          );
        }

        sendResponse({ ok: true, data: orderData, detection });
      })
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message?.type === "SAVE_UPBIT_CREDENTIALS") {
    const { accessKey, secretKey, passphrase } = message.payload || {};

    if (!accessKey || !secretKey || !passphrase || passphrase.length < 8) {
      sendResponse({
        ok: false,
        error: "API 키와 8자 이상의 로컬 암호화 비밀번호를 입력해 주세요.",
      });
      return false;
    }

    const credentials = {
      accessKey: accessKey.trim(),
      secretKey: secretKey.trim(),
    };

    validateUpbitCredentials(credentials)
      .then(() =>
        encryptAndStoreCredentials(
          credentials.accessKey,
          credentials.secretKey,
          passphrase,
        ),
      )
      .then(() => sendResponse({ ok: true }))
      .catch((error) =>
        sendResponse({
          ok: false,
          error: error.message || "API 키 검증 및 저장에 실패했습니다.",
        }),
      );
    return true;
  }

  if (message?.type === "UNLOCK_UPBIT_CREDENTIALS") {
    unlockCredentials(message.payload?.passphrase || "")
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message?.type === "GET_UPBIT_CREDENTIAL_STATUS") {
    getCredentialStatus()
      .then((status) => sendResponse({ ok: true, status }))
      .catch(() =>
        sendResponse({ ok: false, error: "API 키 상태를 확인하지 못했습니다." }),
      );
    return true;
  }

  if (message?.type === "DELETE_UPBIT_CREDENTIALS") {
    removeCredentials()
      .then(() => sendResponse({ ok: true }))
      .catch(() =>
        sendResponse({ ok: false, error: "API 키를 삭제하지 못했습니다." }),
      );
    return true;
  }

  if (message?.type === "LOCK_UPBIT_CREDENTIALS") {
    chrome.storage.session
      .remove(SESSION_KEY_STORAGE_KEY)
      .then(() => sendResponse({ ok: true }))
      .catch(() => sendResponse({ ok: false }));
    return true;
  }

  if (message?.type === "RUN_COLLECTION_NOW") {
    runMinuteCycle()
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  return false;
});

chrome.runtime.onMessageExternal?.addListener(
  (message, sender, sendResponse) => {
    if (message?.type !== "AUTH_HANDOFF") {
      return false;
    }

    handleAuthHandoff(message.payload?.appOrigin, sender)
      .then((auth) =>
        sendResponse({
          ok: true,
          auth: {
            expiresAt: auth.expiresAt,
            user: auth.user,
            appOrigin: auth.appOrigin,
          },
        }),
      )
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  },
);

chrome.cookies?.onChanged?.addListener((changeInfo) => {
  if (
    !changeInfo.removed ||
    changeInfo.cause === "overwrite" ||
    changeInfo.cookie?.name !== REFRESH_TOKEN_COOKIE_NAME
  ) {
    return;
  }

  chrome.storage.local.get("auth").then(({ auth }) => {
    const appOrigin = normalizeAllowedAppOrigin(auth?.appOrigin);

    if (
      appOrigin &&
      new URL(appOrigin).hostname ===
        String(changeInfo.cookie.domain || "").replace(/^\./, "")
    ) {
      void clearExtensionSession().catch(() => {});
    }
  });
});
