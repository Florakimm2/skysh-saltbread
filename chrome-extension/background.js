importScripts("config.js", "data-core.js");

const {
  calculateAverageBuyAmount,
  evaluateGuardrailRules,
  mapUpbitOrder,
  parseMarket,
  resolveVisualMode,
  toNumber,
} = globalThis.SaltbreadCore;
const {
  appUrl: APP_URL,
  appOrigins,
  apiBaseUrl: API_BASE_URL,
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
const CREDENTIALS_STORAGE_KEY = "upbitCredentials";
const SESSION_KEY_STORAGE_KEY = "upbitCredentialSessionKey";
const GUARDRAIL_RULES_CACHE_KEY = "guardrailRulesCache";
const MARKET_SNAPSHOT_CACHE_KEY = "marketSnapshotCache";
const PERSONAL_SNAPSHOT_CACHE_KEY = "personalSnapshotCache";
const SNAPSHOT_REFRESH_ALARM_NAME = "saltbread-snapshot-refresh";
const REFRESH_TOKEN_COOKIE_NAME = "refreshToken";
const PUBLIC_REQUEST_INTERVAL_MS = 10_100;
const MARKET_DETAILS_CACHE_MS = 10 * 60 * 1000;
const DETECTION_MARKET_CACHE_MS = 2 * 60 * 1000;
const SNAPSHOT_REFRESH_PERIOD_MINUTES = 0.5;
const LOG_SAVE_RETRY_DELAYS_MS = [500, 1_500];
const BACKGROUND_ORDER_DEBUG_KEY = "saltbread:upbit-order-debug";
const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();
let publicRequestQueue = Promise.resolve();
let lastPublicRequestAt = 0;
const loggedGuardrailRuleUsers = new Set();
let backgroundOrderDebugEnabled = true;

function isSensitiveDebugKey(key) {
  return /(?:access[_-]?token|refresh[_-]?token|authorization|access[_-]?key|secret[_-]?key|api[_-]?key|firebase[_-]?token|bearer)/i.test(
    String(key || ""),
  );
}

function sanitizeDebugPayload(value, seen = new WeakSet()) {
  if (value === null || value === undefined) {
    return value;
  }

  if (typeof value !== "object") {
    return value;
  }

  if (seen.has(value)) {
    return "[Circular]";
  }

  seen.add(value);

  if (Array.isArray(value)) {
    const sanitizedArray = value.map((item) => sanitizeDebugPayload(item, seen));
    seen.delete(value);
    return sanitizedArray;
  }

  const sanitizedObject = Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      isSensitiveDebugKey(key)
        ? "[REDACTED]"
        : sanitizeDebugPayload(item, seen),
    ]),
  );
  seen.delete(value);
  return sanitizedObject;
}

function debugBackgroundOrder(eventName, payload = {}) {
  if (!backgroundOrderDebugEnabled) {
    return;
  }

  const safePayload = sanitizeDebugPayload(payload);

  try {
    console.groupCollapsed(`🔥 [불씨][BACKGROUND_ORDER] ${eventName}`);
    console.log(safePayload);
    console.trace();
    console.groupEnd();
  } catch {
    console.log(`[불씨][BACKGROUND_ORDER] ${eventName}`, safePayload);
  }
}

function loadBackgroundOrderDebugFlag() {
  try {
    chrome.storage?.local?.get(BACKGROUND_ORDER_DEBUG_KEY).then((store) => {
      const value = store?.[BACKGROUND_ORDER_DEBUG_KEY];
      backgroundOrderDebugEnabled = value !== false && value !== "false";
    });
  } catch {
    backgroundOrderDebugEnabled = true;
  }
}

loadBackgroundOrderDebugFlag();
chrome.storage?.onChanged?.addListener?.((changes, areaName) => {
  if (areaName !== "local" || !changes[BACKGROUND_ORDER_DEBUG_KEY]) {
    return;
  }

  const value = changes[BACKGROUND_ORDER_DEBUG_KEY].newValue;
  backgroundOrderDebugEnabled = value !== false && value !== "false";
});

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

function isDemoPageUrl(value) {
  try {
    const url = new URL(value || "");
    return normalizeAllowedAppOrigin(url.href) === url.origin &&
      url.pathname === "/demo";
  } catch {
    return false;
  }
}

function isUpbitExchangeUrl(value) {
  try {
    const url = new URL(value || "");
    return (
      ["upbit.com", "www.upbit.com"].includes(url.hostname) &&
      url.pathname.startsWith("/exchange")
    );
  } catch {
    return false;
  }
}

function isCollectableTradingUrl(value) {
  return isUpbitExchangeUrl(value) || isDemoPageUrl(value);
}

async function reloadCollectableTradingTabs() {
  const tabs = await chrome.tabs.query({});
  await Promise.all(
    tabs
      .filter((tab) => tab?.id && isCollectableTradingUrl(tab.url))
      .map(async (tab) => {
        try {
          await chrome.tabs.reload?.(tab.id);
        } catch {
          // best effort: credential save should not fail because a page reload failed
        }
      }),
  );
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

function createDashboardUrl(appOrigin, path = "/dashboard") {
  try {
    const appUrl = new URL(appOrigin);
    const url = new URL(
      typeof path === "string" && path ? path : "/dashboard",
      appUrl.origin,
    );

    if (url.origin !== appUrl.origin || !url.pathname.startsWith("/dashboard")) {
      return new URL("/dashboard", appUrl.origin).toString();
    }

    return url.toString();
  } catch {
    return `${appOrigin}/dashboard`;
  }
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
  if (hasCompletedOnboarding(auth)) {
    void fetchGuardrailRules(auth).catch(() => {});
  }
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

async function getValidBackendAuth(options = {}) {
  const { refreshProfile = false } = options;
  const { auth } = await chrome.storage.local.get("auth");

  if (!auth?.accessToken || !auth?.user) {
    return null;
  }

  if (auth.expiresAt > Date.now() + 60_000) {
    return refreshProfile ? refreshStoredAuthProfile(auth) : auth;
  }

  const appOrigin = normalizeAllowedAppOrigin(auth.appOrigin);

  if (appOrigin) {
    try {
      const refreshed = await refreshAuthForOrigin(appOrigin, auth);
      return refreshProfile ? refreshStoredAuthProfile(refreshed) : refreshed;
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
  return refreshProfile ? refreshStoredAuthProfile(nextAuth) : nextAuth;
}

async function getOptionalBackendAuth() {
  try {
    return await getValidBackendAuth();
  } catch {
    return null;
  }
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

function hasCompletedOnboarding(auth) {
  return Boolean(
    auth?.user?.personalDataConsentAgreed &&
      auth?.user?.onboardingCompleted,
  );
}

async function refreshStoredAuthProfile(auth) {
  if (!auth?.accessToken || !auth?.user) {
    return auth;
  }

  const response = await fetchJson(`${getAuthApiBase(auth)}/api/me/profile`, {
    method: "GET",
    headers: createBackendHeaders(auth),
  });
  const profile = response?.data || {};
  const nextAuth = {
    ...auth,
    user: {
      ...auth.user,
      email: profile.email || auth.user.email || "",
      name: profile.displayName || auth.user.name || "",
      personalDataConsentAgreed: Boolean(
        profile.personalDataConsentAgreed,
      ),
      personalDataConsentAgreedAt:
        profile.personalDataConsentAgreedAt || null,
      personalDataConsentVersion:
        profile.personalDataConsentVersion || null,
      onboardingCompleted: Boolean(profile.onboardingCompleted),
      onboardingCompletedAt: profile.onboardingCompletedAt || null,
    },
  };

  if (JSON.stringify(nextAuth.user) !== JSON.stringify(auth.user)) {
    await chrome.storage.local.set({ auth: nextAuth });
  }

  return nextAuth;
}

async function getCachedGuardrailRules() {
  const result = await chrome.storage.local.get(GUARDRAIL_RULES_CACHE_KEY);
  return result[GUARDRAIL_RULES_CACHE_KEY]?.rules || [];
}

async function getCachedGuardrailRulesState(auth = null) {
  const result = await chrome.storage.local.get(GUARDRAIL_RULES_CACHE_KEY);
  const cache = result[GUARDRAIL_RULES_CACHE_KEY] || {};
  const rules = Array.isArray(cache.rules) ? cache.rules : [];

  return {
    rules,
    source: cache.fetchedAt
      ? "page-cache"
      : auth?.accessToken
        ? "not-loaded"
        : "none",
    error: null,
    fetchedAt: cache.fetchedAt || null,
    userId: cache.userId || null,
  };
}

function summarizeGuardrailRulesForLog(rules) {
  return rules.map((rule) => ({
    ruleId: rule.ruleId,
    name: rule.name,
    isEnabled: rule.isEnabled,
    priority: rule.priority,
    riskLevel: rule.riskLevel,
    visualMode: rule.visualMode,
    warningTitle: rule.warningTitle,
    requiresPrivateApi: rule.requiresPrivateApi,
  }));
}

function logGuardrailRulesOnce(auth, rules) {
  const userKey = auth?.user?.id || auth?.user?.email || "unknown-user";

  if (loggedGuardrailRuleUsers.has(userKey)) {
    return;
  }

  loggedGuardrailRuleUsers.add(userKey);
  console.log(
    "[Saltbread] Loaded user guardrail rules",
    summarizeGuardrailRulesForLog(rules),
  );
}

async function fetchGuardrailRules(existingAuth = null) {
  const auth = existingAuth || (await getValidBackendAuth());

  if (!auth?.accessToken) {
    await chrome.storage.local.set({
      [GUARDRAIL_RULES_CACHE_KEY]: {
        rules: [],
        userId: null,
        fetchedAt: new Date().toISOString(),
      },
    });
    return [];
  }

  const response = await fetchJson(`${getAuthApiBase(auth)}/api/me/guardrail-rules`, {
    method: "GET",
    headers: createBackendHeaders(auth),
  });
  const rules = Array.isArray(response?.data) ? response.data : [];
  logGuardrailRulesOnce(auth, rules);

  await chrome.storage.local.set({
    [GUARDRAIL_RULES_CACHE_KEY]: {
      rules,
      userId: auth.user?.id || null,
      fetchedAt: new Date().toISOString(),
    },
  });

  return rules;
}

async function loadGuardrailRules(existingAuth = null) {
  try {
    return {
      rules: await fetchGuardrailRules(existingAuth),
      source: "network",
      error: null,
    };
  } catch (error) {
    return {
      rules: await getCachedGuardrailRules(),
      source: "cache",
      error: error instanceof Error ? error.message : "규칙을 불러오지 못했습니다.",
    };
  }
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

async function postBackendLog(path, payload, existingAuth = null) {
  const auth = existingAuth || (await getValidBackendAuth());

  if (!auth?.accessToken) {
    throw new Error("로그인 후 로그 저장을 다시 시도해 주세요.");
  }

  return fetchJson(`${getAuthApiBase(auth)}${path}`, {
    method: "POST",
    headers: createBackendHeaders(auth),
    body: JSON.stringify(payload),
  });
}

async function fetchUserStats() {
  const auth = await getValidBackendAuth();

  if (!auth?.accessToken) {
    const error = new Error("로그인이 필요합니다.");
    error.status = 401;
    throw error;
  }

  return fetchJson(`${getAuthApiBase(auth)}/api/me/stats`, {
    method: "GET",
    headers: createBackendHeaders(auth),
  });
}

async function patchBackendLog(path, payload, existingAuth = null) {
  const auth = existingAuth || (await getValidBackendAuth());

  if (!auth?.accessToken) {
    throw new Error("로그인 후 로그 저장을 다시 시도해 주세요.");
  }

  return fetchJson(`${getAuthApiBase(auth)}${path}`, {
    method: "PATCH",
    headers: createBackendHeaders(auth),
    body: JSON.stringify(payload),
  });
}

function isRetriableLogSaveError(error) {
  return !error?.status || error.status >= 500;
}

async function sendLogSaveStatus(tabId, payload) {
  if (!tabId) {
    return;
  }

  await sendTabMessage(tabId, {
    type: "LOG_SAVE_STATUS",
    payload,
  });
}

async function runLogSaveWithRetry(tabId, kind, taskFactory) {
  let lastError = null;

  for (let attempt = 0; attempt <= LOG_SAVE_RETRY_DELAYS_MS.length; attempt += 1) {
    try {
      await taskFactory();
      await sendLogSaveStatus(tabId, { kind, ok: true, message: "" });
      return;
    } catch (error) {
      lastError = error;

      if (
        attempt >= LOG_SAVE_RETRY_DELAYS_MS.length ||
        !isRetriableLogSaveError(error)
      ) {
        break;
      }

      await wait(LOG_SAVE_RETRY_DELAYS_MS[attempt]);
    }
  }

  await sendLogSaveStatus(tabId, {
    kind,
    ok: false,
    message: lastError?.message || "로그를 저장하지 못했습니다.",
  });
}

function enqueueLogSave(tabId, kind, taskFactory) {
  void runLogSaveWithRetry(tabId, kind, taskFactory);
}

function pickDefinedFields(source, fields) {
  const result = {};

  for (const field of fields) {
    if (source?.[field] !== undefined) {
      result[field] = source[field];
    }
  }

  return result;
}

function normalizeArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeOrderContextSnapshotLog(snapshot) {
  const payload = pickDefinedFields(snapshot || {}, [
    "snapshotId",
    "attemptId",
    "snapshotTrigger",
    "capturedAt",
    "market",
    "side",
    "orderMode",
    "entryPoint",
    "intentPrice",
    "intentQuantity",
    "intentAmount",
    "requestedBalanceRatio",
    "draftDurationMs",
    "lastEditToSnapshotMs",
    "draftEditCount",
    "amountChangeRate",
    "modeChangedToMarket",
    "orderbookClickToSnapshotMs",
    "orderIntentCount1m",
    "actualOrderCreatedCount10m",
    "sameSideIntentCount1m",
    "marketChangeCount5m",
    "sideChangeCount3m",
    "priceEditCount3m",
    "quantityEditCount3m",
    "amountEditCount3m",
    "inputRevertCount",
    "priceDirectionChangeCount",
    "priceChangeRate",
    "orderModeChangeCount3m",
    "allocationPresetPercent",
    "draftResetCount3m",
    "matchedRuleIdsAtSnapshot",
    "primaryShownRuleId",
    "shownRuleIds",
    "tradePriceAtSnapshot",
    "shortTermReturn5m",
    "signedChangeRate",
    "spreadRate",
    "marketRiskFlags",
    "pricePositionIn5mRange",
    "volumeSpikeRatio5m",
    "baseAssetAvgBuyPriceBeforeSnapshot",
    "priceVsAvgBuyRateAtSnapshot",
  ]);

  payload.matchedRuleIdsAtSnapshot = normalizeArray(
    payload.matchedRuleIdsAtSnapshot,
  );
  payload.shownRuleIds = normalizeArray(payload.shownRuleIds);
  payload.marketRiskFlags = normalizeArray(payload.marketRiskFlags);

  return payload;
}

function normalizeGuardrailReactionLog(reaction) {
  return pickDefinedFields(reaction || {}, [
    "snapshotId",
    "action",
    "reactedAt",
    "reactionUiVersion",
  ]);
}

function normalizeTradeFeedbackLog(feedback) {
  return pickDefinedFields(feedback || {}, [
    "attemptId",
    "feedbackStatus",
    "selfAssessment",
    "feedbackShownAt",
    "respondedAt",
    "feedbackUiVersion",
  ]);
}

function normalizeConfirmedTradeLog(log) {
  return pickDefinedFields(log || {}, [
    "attemptId",
    "upbitOrderUuid",
    "orderCreatedAt",
    "market",
    "side",
    "ordType",
    "limitPrice",
    "requestedFunds",
    "requestedVolume",
    "timeInForce",
    "state",
    "executedVolume",
    "executedFunds",
    "paidFee",
    "remainingVolume",
    "outcomeObservedAt",
  ]);
}

function normalizeOrderOutcomePatch(patch) {
  return pickDefinedFields(patch || {}, [
    "upbitOrderUuid",
    "state",
    "executedVolume",
    "executedFunds",
    "paidFee",
    "remainingVolume",
    "outcomeObservedAt",
  ]);
}

function normalizeUpbitOrderSide(order) {
  return String(order?.side).toLowerCase() === "ask" ? "SELL" : "BUY";
}

function normalizeUpbitOrderMode(order) {
  if (order?.ord_type === "limit") return "LIMIT";
  if (order?.ord_type === "price") return "MARKET";
  if (order?.ord_type === "market") return "MARKET";
  return String(order?.ord_type || "").toUpperCase();
}

function numbersAreSimilar(left, right, toleranceRate = 0.03) {
  const leftNumber = toNumber(left);
  const rightNumber = toNumber(right);

  if (leftNumber === null || rightNumber === null) {
    return false;
  }

  const tolerance = Math.max(1, Math.abs(rightNumber) * toleranceRate);
  return Math.abs(leftNumber - rightNumber) <= tolerance;
}

function orderMatchesAttemptIntent(order, attemptContext = {}) {
  const snapshot = attemptContext.orderContextSnapshot || {};
  const currentOrder = attemptContext.currentOrder || {};
  const capturedAt = Date.parse(snapshot.capturedAt || "");
  const orderCreatedAt = Date.parse(order?.created_at || "");

  if (
    !attemptContext.attemptId ||
    !Number.isFinite(capturedAt) ||
    !Number.isFinite(orderCreatedAt) ||
    orderCreatedAt < capturedAt
  ) {
    return false;
  }

  const market = snapshot.market || currentOrder.market;
  if (market && order.market !== market) {
    return false;
  }

  const side = snapshot.side || currentOrder.order_side;
  if (side && normalizeUpbitOrderSide(order) !== side) {
    return false;
  }

  const orderMode = snapshot.orderMode || currentOrder.order_type;
  if (orderMode && normalizeUpbitOrderMode(order) !== orderMode) {
    return false;
  }

  const requestedFunds =
    snapshot.intentAmount ?? currentOrder.order_amount ?? null;
  const requestedVolume =
    snapshot.intentQuantity ?? currentOrder.order_volume ?? null;

  if (order.ord_type === "price") {
    return numbersAreSimilar(order.price, requestedFunds);
  }

  if (order.ord_type === "market") {
    return numbersAreSimilar(order.volume, requestedVolume);
  }

  if (order.ord_type === "limit") {
    const priceMatches =
      snapshot.intentPrice === null && currentOrder.order_price === null
        ? true
        : numbersAreSimilar(
            order.price,
            snapshot.intentPrice ?? currentOrder.order_price,
          );
    return priceMatches && numbersAreSimilar(order.volume, requestedVolume);
  }

  return (
    numbersAreSimilar(order.price, requestedFunds) ||
    numbersAreSimilar(order.volume, requestedVolume)
  );
}

function resolveAttemptMatchedOrderUuid(orderData, attemptContext = {}) {
  const scopedOrderData = scopeOrderDataToMarket(
    orderData,
    attemptContext.market ||
      attemptContext.currentOrder?.market ||
      attemptContext.orderContextSnapshot?.market ||
      orderData?.market,
  );
  const orders = [
    ...(scopedOrderData?.rawOpenOrders || []),
    ...(scopedOrderData?.rawClosedOrders || []),
  ].filter(
    (order) => order?.uuid && orderMatchesAttemptIntent(order, attemptContext),
  );

  if (orders.length !== 1) {
    return null;
  }

  return orders[0].uuid;
}

function saveOrderContextSnapshotLog(snapshot, tabId) {
  const payload = normalizeOrderContextSnapshotLog(snapshot);

  enqueueLogSave(tabId, "order-context-snapshot", () =>
    postBackendLog("/api/me/logs/order-context-snapshots", payload),
  );
}

function saveGuardrailReactionLog(reaction, tabId) {
  const payload = normalizeGuardrailReactionLog(reaction);

  enqueueLogSave(tabId, "guardrail-reaction", () =>
    postBackendLog("/api/me/logs/guardrail-reactions", payload),
  );
}

function saveTradeFeedbackLog(feedback, tabId) {
  const payload = normalizeTradeFeedbackLog(feedback);

  enqueueLogSave(tabId, "trade-feedback", () =>
    postBackendLog("/api/me/logs/trade-feedbacks", payload),
  );
}

function saveConfirmedTradeLogBatch(orderData, attemptContext = {}, tabId) {
  const matchedOrderUuid = resolveAttemptMatchedOrderUuid(
    orderData,
    attemptContext,
  );
  const tradeLogs = toConfirmedTradeLogs(orderData, null)
    .map((log) => ({
      ...log,
      attemptId:
        matchedOrderUuid && log.upbitOrderUuid === matchedOrderUuid
          ? attemptContext.attemptId
          : null,
    }))
    .map(normalizeConfirmedTradeLog);
  const outcomePatches = toOrderOutcomePatches(orderData).map(
    normalizeOrderOutcomePatch,
  );

  if (tradeLogs.length === 0 && outcomePatches.length === 0) {
    return;
  }

  enqueueLogSave(tabId, "confirmed-trade-logs", async () => {
    const auth = await getValidBackendAuth();

    for (const log of tradeLogs) {
      await postBackendLog("/api/me/logs/confirmed-trade-logs", log, auth);
    }

    for (const patch of outcomePatches) {
      await patchBackendLog(
        "/api/me/logs/confirmed-trade-logs/outcome",
        patch,
        auth,
      );
    }
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

function normalizeBackendMarketSnapshot(rawSnapshot, market) {
  const snapshot = rawSnapshot?.data || rawSnapshot || {};
  const fetchedAt = snapshot.fetchedAt || new Date().toISOString();
  const fetchedAtMs = Date.parse(fetchedAt);
  const tradePrice =
    snapshot.tradePrice ??
    snapshot.tradePriceAtSnapshot ??
    snapshot.currentPrice ??
    snapshot.current_price ??
    null;

  return {
    market: snapshot.market || snapshot.symbol || market,
    tradePrice: tradePrice === null || tradePrice === undefined
      ? null
      : String(tradePrice),
    signedChangeRate: snapshot.signedChangeRate ?? null,
    shortTermReturn5m: snapshot.shortTermReturn5m ?? null,
    spreadRate: snapshot.spreadRate ?? null,
    marketRiskFlags: Array.isArray(snapshot.marketRiskFlags)
      ? snapshot.marketRiskFlags
      : [],
    pricePositionIn5mRange: snapshot.pricePositionIn5mRange ?? null,
    volumeSpikeRatio5m:
      snapshot.volumeSpikeRatio5m ?? snapshot.volumeSpikeRatio ?? null,
    fetchedAt,
    freshnessMs: Number.isFinite(fetchedAtMs) ? Date.now() - fetchedAtMs : 0,
    source: "backend-market-snapshot",
  };
}

function marketSnapshotToMarketData(snapshot) {
  const currentPrice = toNumber(snapshot?.tradePrice);
  const changeRate =
    snapshot?.shortTermReturn5m ?? snapshot?.signedChangeRate ?? null;

  return {
    market: snapshot?.market || "UNKNOWN",
    current_price: currentPrice,
    tradePriceAtSnapshot: snapshot?.tradePrice ?? null,
    shortTermReturn5m: snapshot?.shortTermReturn5m ?? null,
    signedChangeRate: snapshot?.signedChangeRate ?? null,
    spreadRate: snapshot?.spreadRate ?? null,
    marketRiskFlags: snapshot?.marketRiskFlags || [],
    pricePositionIn5mRange: snapshot?.pricePositionIn5mRange ?? null,
    volumeSpikeRatio5m: snapshot?.volumeSpikeRatio5m ?? null,
    market_data: {
      price_change_rate_15m:
        changeRate === null || changeRate === undefined
          ? null
          : Number(changeRate) * 100,
      volume_change_rate_1m: snapshot?.volumeSpikeRatio5m ?? null,
      is_top3_volatility: false,
      has_warning_badge: (snapshot?.marketRiskFlags || []).length > 0,
    },
    collected_at: snapshot?.fetchedAt || new Date().toISOString(),
    source: snapshot?.source || "backend-market-snapshot",
  };
}

async function fetchBackendMarketSnapshot(market) {
  const appOrigin = await resolveCurrentAppOrigin();
  const url = new URL("/api/market-snapshot", appOrigin);
  url.searchParams.set("market", market);

  return normalizeBackendMarketSnapshot(await fetchJson(url.toString()), market);
}

const MarketDataProvider = {
  async fetchSnapshot(market) {
    return fetchBackendMarketSnapshot(market);
  },
};

async function writeMarketSnapshotCache(market, snapshot) {
  const [{ [MARKET_SNAPSHOT_CACHE_KEY]: snapshotCache = {} }, { marketDataCache = {} }] =
    await Promise.all([
      chrome.storage.local.get(MARKET_SNAPSHOT_CACHE_KEY),
      chrome.storage.local.get("marketDataCache"),
    ]);

  snapshotCache[market] = snapshot;
  marketDataCache[market] = marketSnapshotToMarketData(snapshot);
  await chrome.storage.local.set({
    [MARKET_SNAPSHOT_CACHE_KEY]: snapshotCache,
    marketDataCache,
  });
}

async function collectMarketData(market) {
  const snapshot = await MarketDataProvider.fetchSnapshot(market);
  await writeMarketSnapshotCache(market, snapshot);
  return marketSnapshotToMarketData(snapshot);
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
  const [rawClosedOrders, rawOpenOrders, accounts] = await Promise.all([
    fetchPrivateUpbit(
      "/v1/orders/closed",
      [
        ["market", market],
        ["limit", "100"],
        ["order_by", "desc"],
      ],
      credentials,
    ),
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
  const closedOrders = filterOrdersByMarket(rawClosedOrders, market);
  const openOrders = filterOrdersByMarket(rawOpenOrders, market);
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
    accounts,
    rawClosedOrders: closedOrders,
    rawOpenOrders: openOrders,
    collected_at: new Date().toISOString(),
  };
  const { orderDataCache = {} } =
    await chrome.storage.local.get("orderDataCache");
  orderDataCache[market] = collected;
  await chrome.storage.local.set({ orderDataCache });
  return collected;
}

function filterOrdersByMarket(orders, market) {
  if (!Array.isArray(orders)) {
    return [];
  }

  if (!market) {
    return orders;
  }

  return orders.filter((order) => order?.market === market);
}

function scopeOrderDataToMarket(orderData, market = orderData?.market) {
  if (!orderData || !market) {
    return orderData || {};
  }

  return {
    ...orderData,
    market,
    rawClosedOrders: filterOrdersByMarket(orderData.rawClosedOrders, market),
    rawOpenOrders: filterOrdersByMarket(orderData.rawOpenOrders, market),
    recentOrders: filterOrdersByMarket(orderData.recentOrders, market),
  };
}

function toPersonalSnapshot(orderData, market) {
  const scopedOrderData = scopeOrderDataToMarket(
    orderData,
    market || orderData?.market,
  );

  if (
    !scopedOrderData?.privateDataAvailable &&
    scopedOrderData?.privateDataAvailable !== undefined
  ) {
    return null;
  }

  const fetchedAt = scopedOrderData?.collected_at || new Date().toISOString();
  const fetchedAtMs = Date.parse(fetchedAt);
  const baseCurrency = String(market || scopedOrderData?.market || "").split(
    "-",
  )[1];
  const baseAccount = (scopedOrderData?.accounts || []).find(
    (account) => account.currency === baseCurrency,
  );

  return {
    market: scopedOrderData?.market || market,
    balances: scopedOrderData?.accounts || [],
    openOrders: scopedOrderData?.rawOpenOrders || [],
    recentOrders: scopedOrderData?.recentOrders || [],
    recentTrades: scopedOrderData?.rawClosedOrders || [],
    baseAssetAvgBuyPrice: baseAccount?.avg_buy_price
      ? String(baseAccount.avg_buy_price)
      : null,
    actualOrderCreatedCount10m: countActualOrders10m(scopedOrderData),
    fetchedAt,
    freshnessMs: Number.isFinite(fetchedAtMs) ? Date.now() - fetchedAtMs : 0,
    source: "extension-private-cache",
  };
}

async function writePersonalSnapshotCache(market, snapshot) {
  const { [PERSONAL_SNAPSHOT_CACHE_KEY]: snapshotCache = {} } =
    await chrome.storage.local.get(PERSONAL_SNAPSHOT_CACHE_KEY);

  snapshotCache[market] = snapshot;
  await chrome.storage.local.set({ [PERSONAL_SNAPSHOT_CACHE_KEY]: snapshotCache });
}

async function collectOrderDataForDetection(market) {
  try {
    const orderData = await collectOrderData(market);
    const collected = { ...orderData, privateDataAvailable: true };
    await writePersonalSnapshotCache(market, toPersonalSnapshot(collected, market));
    return collected;
  } catch {
    const unavailable = {
      market,
      recentOrders: [],
      clientAverageBuyAmount: null,
      accounts: [],
      rawClosedOrders: [],
      rawOpenOrders: [],
      collected_at: new Date().toISOString(),
      privateDataAvailable: false,
    };
    await writePersonalSnapshotCache(market, null);
    return unavailable;
  }
}

function createDemoOrderData(context = {}) {
  const demoData = context.demoData || {};
  const market = context.market || demoData.market || null;
  const withMarket = (orders) =>
    Array.isArray(orders)
      ? orders.map((order) =>
          order && market && !order.market ? { ...order, market } : order,
        )
      : [];

  return {
    market: context.market,
    recentOrders: withMarket(demoData.recentOrders),
    clientAverageBuyAmount:
      demoData.clientAverageBuyAmount ??
      context.behaviorData?.client_avg_buy_amount ??
      null,
    accounts: Array.isArray(demoData.accounts) ? demoData.accounts : [],
    rawClosedOrders: withMarket(demoData.rawClosedOrders),
    rawOpenOrders: withMarket(demoData.rawOpenOrders),
    collected_at: new Date().toISOString(),
    updatedAt: demoData.updatedAt || null,
    privateDataAvailable: false,
    personalDataSource: "demo-data",
    demoPersonalAvailable: true,
    isDemoPersonalData: true,
  };
}

async function refreshMarketSnapshot(market) {
  if (!market) {
    return null;
  }

  const snapshot = await MarketDataProvider.fetchSnapshot(market);
  await writeMarketSnapshotCache(market, snapshot);
  return snapshot;
}

async function refreshPersonalSnapshot(market) {
  if (!market) {
    return null;
  }

  const orderData = await collectOrderDataForDetection(market);
  return toPersonalSnapshot(orderData, market);
}

async function refreshSnapshotCaches(market) {
  if (!market) {
    return { marketSnapshot: null, personalSnapshot: null };
  }

  const [marketResult, personalResult] = await Promise.allSettled([
    refreshMarketSnapshot(market),
    refreshPersonalSnapshot(market),
  ]);

  return {
    marketSnapshot:
      marketResult.status === "fulfilled" ? marketResult.value : null,
    personalSnapshot:
      personalResult.status === "fulfilled" ? personalResult.value : null,
  };
}

async function resolveActiveTradingMarket() {
  const activeTabs = await chrome.tabs.query({
    active: true,
    currentWindow: true,
  });
  const activeTab = activeTabs.find((tab) => isUpbitExchangeUrl(tab.url));

  if (!activeTab?.url) {
    return null;
  }

  return parseMarket(activeTab.url);
}

function requestSnapshotRefresh(market) {
  const refreshTask = (market
    ? Promise.resolve(market)
    : resolveActiveTradingMarket())
    .then((resolvedMarket) =>
      resolvedMarket ? refreshSnapshotCaches(resolvedMarket) : null,
    )
    .catch(() => null);

  return refreshTask;
}

function createDemoCacheDebug(context, resolvedMarket, marketData, orderData) {
  const demoData = context?.demoData || null;
  const demoMarket = demoData?.market || demoData?.marketData?.market || null;
  const demoMarketCacheKeys = demoMarket ? [demoMarket] : [];
  const hasMarketFields = Boolean(
    marketData?.current_price !== null &&
      marketData?.current_price !== undefined &&
      marketData?.tradePriceAtSnapshot,
  );
  const hasPersonalFields = Boolean(
    orderData?.personalDataSource === "demo-data" &&
      ((orderData.accounts || []).length ||
        (orderData.recentOrders || []).length ||
        (orderData.rawClosedOrders || []).length ||
        (orderData.rawOpenOrders || []).length),
  );

  return {
    hasDemoMarketCache: Boolean(demoData?.marketData),
    demoMarketCacheKeys,
    hasDemoMarketForResolvedMarket:
      Boolean(resolvedMarket) && demoMarketCacheKeys.includes(resolvedMarket),
    hasDemoMarketFields: hasMarketFields,
    hasDemoPersonalCache: Boolean(demoData),
    demoPersonalCacheKeys: demoMarketCacheKeys,
    hasDemoPersonalForResolvedMarket:
      Boolean(resolvedMarket) && demoMarketCacheKeys.includes(resolvedMarket),
    hasDemoPersonalFields: hasPersonalFields,
    latestDemoStateMarket: demoMarket,
    latestDemoStateUpdatedAt: demoData?.updatedAt || null,
  };
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
  const initialMarketResolution = resolveMarketForContext(context);
  const normalizedContext = normalizeDemoContextMarket(
    context,
    initialMarketResolution.market,
  );
  const normalizedMarketData =
    isDemoPageUrl(normalizedContext.pageUrl || "") && initialMarketResolution.market
      ? { ...marketData, market: initialMarketResolution.market }
      : marketData;

  if (!normalizedContext.currentOrder || !normalizedContext.behaviorData) {
    debugBackgroundOrder("BACKGROUND_DETECTION_API_RESPONSE", {
      skipped: true,
      reason: "missing_current_order_or_behavior_data",
      context: normalizedContext,
    });
    return null;
  }

  const pageUrl = normalizedContext.pageUrl || "";
  const isDemo = isDemoPageUrl(pageUrl);
  const isUpbitExchange = isUpbitExchangeUrl(pageUrl);

  if (!isDemo && !isUpbitExchange) {
    debugBackgroundOrder("BACKGROUND_DETECTION_API_RESPONSE", {
      skipped: true,
      reason: "unsupported_page",
      pageUrl,
      context: normalizedContext,
    });
    return null;
  }

  const [auth, { orderDataCache = {} }] = await Promise.all([
    isDemo ? getOptionalBackendAuth() : getValidBackendAuth(),
    chrome.storage.local.get("orderDataCache"),
  ]);

  if (!isDemo && !auth?.accessToken) {
    debugBackgroundOrder("BACKGROUND_DETECTION_API_RESPONSE", {
      skipped: true,
      reason: "missing_backend_auth",
      pageUrl,
      market: normalizedContext.market,
    });
    return null;
  }

  const orderData =
    options.orderData ||
    (isDemo
      ? createDemoOrderData(normalizedContext)
      : orderDataCache[normalizedContext.market] ||
        createDemoOrderData(normalizedContext));
  const scopedOrderData = scopeOrderDataToMarket(
    orderData,
    normalizedContext.market,
  );
  const recentOrders = scopedOrderData?.recentOrders || [];
  const lastLoss = recentOrders.find(
    (order) =>
      order.order_side === "SELL" &&
      order.realized_loss_pct_1h !== null &&
      Date.now() - Date.parse(order.order_request_time) <= 60 * 60 * 1000,
  );
  const requestBody = {
    market: normalizedContext.market,
    current_price: normalizedMarketData.current_price,
    market_data: normalizedMarketData.market_data,
    current_order: {
      ...normalizedContext.currentOrder,
      realized_loss_pct_1h: lastLoss?.realized_loss_pct_1h ?? null,
    },
    behavior_data: {
      ...normalizedContext.behaviorData,
      client_avg_buy_amount:
        scopedOrderData
          ? scopedOrderData.clientAverageBuyAmount ?? null
          : normalizedContext.behaviorData.client_avg_buy_amount ?? null,
    },
    recent_orders: recentOrders,
  };
  debugBackgroundOrder("BACKGROUND_DETECTION_API_REQUEST", {
    tabId,
    pageUrl,
    market: normalizedContext.market,
    requestBody,
    orderContextSnapshot: normalizedContext.orderContextSnapshot || null,
    options,
  });

  const behaviorEvent = {
    ...(normalizedContext.sessionId ? { sessionId: normalizedContext.sessionId } : {}),
    symbol: requestBody.market,
    eventType: "ORDER_SUBMIT_ATTEMPT",
    side: requestBody.current_order.order_side,
    orderType: requestBody.current_order.order_type,
    price: requestBody.current_order.order_price,
    amount: requestBody.current_order.order_amount,
    quantity: requestBody.current_order.order_volume,
    ...(normalizedContext.pageUrl ? { pageUrl: normalizedContext.pageUrl } : {}),
    occurredAt: requestBody.current_order.order_request_time,
    metadata: {
      behaviorData: requestBody.behavior_data,
      currentPrice: requestBody.current_price,
      marketData: requestBody.market_data,
    },
  };
  const behaviorSaveTask =
    options.logSubmitAttempt === false
      ? Promise.resolve()
      : auth?.accessToken
        ? postBehaviorEvent(behaviorEvent, auth)
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
          )
        : Promise.resolve();
  const rulesState = await getCachedGuardrailRulesState(auth);
  const orderContextSnapshot = enrichOrderContextSnapshot(
    normalizedContext,
    normalizedMarketData,
    scopedOrderData,
  );
  const expectedMarket = initialMarketResolution.market || orderContextSnapshot.market;
  const actualMarkets = {
    orderContextMarket: orderContextSnapshot.market || null,
    marketDataMarket: normalizedMarketData?.market || null,
    currentOrderMarket: normalizedContext.currentOrder?.market || null,
    orderDataMarket: scopedOrderData?.market || null,
  };
  const relevantMarkets = Object.values(actualMarkets).filter(Boolean);
  const mismatchedMarket = relevantMarkets.find(
    (market) => expectedMarket && market !== expectedMarket,
  );
  const marketMismatch = Boolean(mismatchedMarket);
  const demoCacheDebug = isDemo
    ? createDemoCacheDebug(
        normalizedContext,
        expectedMarket,
        normalizedMarketData,
        scopedOrderData,
      )
    : null;
  if (isDemo && !demoCacheDebug?.hasDemoMarketFields) {
    debugBackgroundOrder("DEMO_MARKET_SNAPSHOT_CACHE_MISS", {
      resolvedMarket: expectedMarket || null,
      demoMarketCacheKeys: demoCacheDebug?.demoMarketCacheKeys || [],
      demoPersonalCacheKeys: demoCacheDebug?.demoPersonalCacheKeys || [],
      latestDemoStateMarket: demoCacheDebug?.latestDemoStateMarket || null,
      latestDemoStateUpdatedAt: demoCacheDebug?.latestDemoStateUpdatedAt || null,
    });
  }
  if (isDemo && !demoCacheDebug?.hasDemoPersonalFields) {
    debugBackgroundOrder("DEMO_PERSONAL_SNAPSHOT_CACHE_MISS", {
      resolvedMarket: expectedMarket || null,
      demoMarketCacheKeys: demoCacheDebug?.demoMarketCacheKeys || [],
      demoPersonalCacheKeys: demoCacheDebug?.demoPersonalCacheKeys || [],
      latestDemoStateMarket: demoCacheDebug?.latestDemoStateMarket || null,
      latestDemoStateUpdatedAt: demoCacheDebug?.latestDemoStateUpdatedAt || null,
    });
  }
  const marketDebugFields = {
    marketResolutionTrace: initialMarketResolution.trace,
    marketDataSource:
      normalizedMarketData?.source ||
      (isDemo ? "demo-data" : "cache"),
    ...(demoCacheDebug ? { demoCacheDebug } : {}),
    marketMismatch,
    expectedMarket: expectedMarket || null,
    actualMarket:
      mismatchedMarket ||
      actualMarkets.marketDataMarket ||
      actualMarkets.orderContextMarket ||
      null,
    usedForRuleEvaluation: !marketMismatch,
  };

  if (marketMismatch) {
    await sendDtoDebugSnapshot(tabId, {
      ...marketDebugFields,
      behavior: normalizedContext.behaviorData || null,
      market: normalizedMarketData,
      personal: createPersonalDebugSnapshot(
        scopedOrderData,
        orderContextSnapshot,
        recentOrders,
      ),
      orderContext: orderContextSnapshot,
      ruleEvaluation: {
        source: rulesState.source,
        loadError: rulesState.error,
        ruleCount: rulesState.rules.length,
        detected: false,
        matchedRuleIds: [],
        primaryRuleId: null,
        primaryRule: null,
        skippedReason: "MARKET_MISMATCH",
        ...actualMarkets,
      },
    });
    await behaviorSaveTask;
    const mismatchResult = {
      detected: false,
      type: "USER_GUARDRAIL_RULE",
      message: "시장 데이터가 현재 주문 종목과 달라 가드레일 평가를 건너뛰었습니다.",
      marketMismatch: true,
      orderContextSnapshot,
      ruleEvaluation: {
        detected: false,
        matchedRuleIds: [],
        primaryRuleId: null,
        primaryRule: null,
        skippedReason: "MARKET_MISMATCH",
      },
    };
    debugBackgroundOrder("BACKGROUND_DETECTION_API_RESPONSE", {
      tabId,
      pageUrl,
      market: normalizedContext.market,
      response: mismatchResult,
    });
    return mismatchResult;
  }
  const ruleEvaluation = evaluateGuardrailRules(
    rulesState.rules,
    orderContextSnapshot,
  );
  const evaluatedSnapshot = {
    ...orderContextSnapshot,
    matchedRuleIdsAtSnapshot: ruleEvaluation.matchedRuleIds,
    primaryShownRuleId: ruleEvaluation.primaryRuleId,
    shownRuleIds: ruleEvaluation.primaryRuleId
      ? [ruleEvaluation.primaryRuleId]
      : [],
  };

  await sendDtoDebugSnapshot(tabId, {
    ...marketDebugFields,
    behavior: normalizedContext.behaviorData || null,
    market: normalizedMarketData,
    personal: createPersonalDebugSnapshot(
      scopedOrderData,
      orderContextSnapshot,
      recentOrders,
    ),
    orderContext: evaluatedSnapshot,
    ruleEvaluation: {
      source: rulesState.source,
      loadError: rulesState.error,
      ruleCount: rulesState.rules.length,
      detected: ruleEvaluation.detected,
      matchedRuleIds: ruleEvaluation.matchedRuleIds,
      primaryRuleId: ruleEvaluation.primaryRuleId,
      primaryRule: ruleEvaluation.primaryRule,
    },
  });

  if (ruleEvaluation.detected) {
    const flameMode = resolveVisualMode(ruleEvaluation.primaryRule);
    const ruleResult = {
      detected: true,
      type: "USER_GUARDRAIL_RULE",
      message:
        ruleEvaluation.warningMessage ||
        "사용자 규칙에 해당하는 주문 조건이 감지되었습니다.",
      warningTitle: ruleEvaluation.warningTitle,
      riskLevel: ruleEvaluation.riskLevel,
      matchedRuleIds: ruleEvaluation.matchedRuleIds,
      primaryRuleId: ruleEvaluation.primaryRuleId,
      primaryRule: ruleEvaluation.primaryRule,
      visualMode: flameMode,
      flameMode,
      orderContextSnapshot: evaluatedSnapshot,
      ruleEvaluation,
    };

    await chrome.storage.local.set({
      flameTheme: {
        mode: flameMode,
        detected: true,
        type: ruleResult.type,
        orderSide: context.currentOrder.order_side,
        primaryRuleId: ruleEvaluation.primaryRuleId,
        attemptId: evaluatedSnapshot.attemptId || null,
        updatedAt: new Date().toISOString(),
      },
    });
    await sendTabMessage(tabId, {
      type: "DETECTION_RESULT",
      payload: ruleResult,
    });
    await behaviorSaveTask;
    debugBackgroundOrder("BACKGROUND_DETECTION_API_RESPONSE", {
      tabId,
      pageUrl,
      market: normalizedContext.market,
      response: ruleResult,
    });
    return ruleResult;
  }

  const safeResult = {
    detected: false,
    type: "USER_GUARDRAIL_RULE",
    message: "설정된 가드레일에 해당하는 주문 조건은 감지되지 않았어요.",
    matchedRuleIds: [],
    primaryRuleId: null,
    primaryRule: null,
    visualMode: "DEFAULT",
    flameMode: "DEFAULT",
    orderContextSnapshot: evaluatedSnapshot,
    ruleEvaluation,
  };
  await chrome.storage.local.set({
    flameTheme: {
      mode: "DEFAULT",
      detected: false,
      type: safeResult.type,
      orderSide: context.currentOrder.order_side,
      attemptId: evaluatedSnapshot.attemptId || null,
      updatedAt: new Date().toISOString(),
    },
  });
  await sendTabMessage(tabId, {
    type: "DETECTION_RESULT",
    payload: safeResult,
  });
  await behaviorSaveTask;
  debugBackgroundOrder("BACKGROUND_DETECTION_API_RESPONSE", {
    tabId,
    pageUrl,
    market: normalizedContext.market,
    response: safeResult,
  });
  return safeResult;
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

async function getMarketDataForContext(context) {
  const { market: resolvedMarket } = resolveMarketForContext(context);
  const normalizedContext = normalizeDemoContextMarket(context, resolvedMarket);
  const demoData = normalizedContext?.demoData;
  const demoMarketData = demoData?.marketData || {};
  const demoCurrentPrice = toNumber(
    firstDefined(
      demoData?.currentPrice,
      demoMarketData.tradePrice,
      demoMarketData.tradePriceAtSnapshot,
      demoMarketData.currentPrice,
      demoMarketData.current_price,
      demoMarketData.ticker?.trade_price,
      demoMarketData.ticker?.tradePrice,
    ),
  );

  if (
    isDemoPageUrl(normalizedContext?.pageUrl) &&
    demoMarketData &&
    demoCurrentPrice !== null
  ) {
    return {
      market: resolvedMarket || normalizedContext.market,
      current_price: demoCurrentPrice,
      tradePriceAtSnapshot: decimalString(demoCurrentPrice),
      shortTermReturn5m:
        demoMarketData.shortTermReturn5m ??
        demoMarketData.short_term_return_5m ??
        demoMarketData.price_change_rate_5m_decimal ??
        percentageLikeToRatio(demoMarketData.price_change_rate_5m) ??
        null,
      signedChangeRate:
        demoMarketData.signedChangeRate ??
        demoMarketData.signed_change_rate ??
        demoMarketData.ticker?.signed_change_rate ??
        demoMarketData.ticker?.signedChangeRate ??
        demoMarketData.price_change_rate_15m_decimal ??
        percentageLikeToRatio(demoMarketData.price_change_rate_15m) ??
        null,
      spreadRate:
        demoMarketData.spreadRate ?? demoMarketData.spread_rate ?? null,
      marketRiskFlags: Array.isArray(demoMarketData.marketRiskFlags)
        ? demoMarketData.marketRiskFlags
        : demoMarketData.has_warning_badge
          ? ["WARNING"]
          : [],
      pricePositionIn5mRange:
        demoMarketData.pricePositionIn5mRange ??
        demoMarketData.price_position_in_5m_range ??
        null,
      volumeSpikeRatio5m:
        demoMarketData.volumeSpikeRatio5m ??
        demoMarketData.volume_spike_ratio_5m ??
        percentageLikeToRatio(demoMarketData.volume_change_rate_1m) ??
        null,
      market_data: demoMarketData,
      source: "demo-data",
    };
  }

  if (isDemoPageUrl(normalizedContext?.pageUrl)) {
    return {
      market: resolvedMarket || normalizedContext.market || "UNKNOWN",
      current_price: null,
      tradePriceAtSnapshot: null,
      shortTermReturn5m: null,
      signedChangeRate: null,
      spreadRate: null,
      marketRiskFlags: [],
      pricePositionIn5mRange: null,
      volumeSpikeRatio5m: null,
      market_data: demoMarketData || {},
      source: "demo-data",
    };
  }

  return getMarketDataForDetection(resolvedMarket || normalizedContext.market);
}

function percentageLikeToRatio(value) {
  const numeric = toNumber(value);
  return numeric === null ? null : numeric / 100;
}

function firstDefined(...values) {
  return values.find((value) => value !== undefined && value !== null);
}

function decimalString(value) {
  if (value === null || value === undefined || value === "") return null;
  const numeric = toNumber(value);
  return numeric === null ? null : String(numeric);
}

function resolveMarketForContext(context = {}) {
  const isDemo = isDemoPageUrl(context.pageUrl || "");
  const candidates = isDemo
    ? [
        context.demoData?.market,
        context.demoData?.marketData?.market,
        context.currentOrder?.market,
        context.orderContextSnapshot?.market,
        context.market,
      ]
    : [
        context.market,
        context.currentOrder?.market,
        context.orderContextSnapshot?.market,
      ];
  const market = candidates.find((candidate) => typeof candidate === "string" && candidate);

  return {
    market: market || null,
    trace: {
      isDemo,
      candidates: {
        contextMarket: context.market || null,
        currentOrderMarket: context.currentOrder?.market || null,
        orderContextMarket: context.orderContextSnapshot?.market || null,
        demoDataMarket: context.demoData?.market || null,
        demoMarketDataMarket: context.demoData?.marketData?.market || null,
      },
      resolvedMarket: market || null,
    },
  };
}

function normalizeDemoContextMarket(context = {}, market) {
  if (!isDemoPageUrl(context.pageUrl || "") || !market) {
    return context;
  }

  return {
    ...context,
    market,
    currentOrder: context.currentOrder
      ? { ...context.currentOrder, market }
      : context.currentOrder,
    orderContextSnapshot: context.orderContextSnapshot
      ? { ...context.orderContextSnapshot, market }
      : context.orderContextSnapshot,
    demoData: context.demoData
      ? {
          ...context.demoData,
          market,
          marketData: context.demoData.marketData
            ? { ...context.demoData.marketData, market }
            : context.demoData.marketData,
        }
      : context.demoData,
  };
}

function getAccount(accounts, currency) {
  return (accounts || []).find((account) => account.currency === currency);
}

function countActualOrders10m(orderData, now = Date.now()) {
  const scopedOrderData = scopeOrderDataToMarket(orderData);

  return [
    ...(scopedOrderData?.rawClosedOrders || []),
    ...(scopedOrderData?.rawOpenOrders || []),
  ].filter((order) => {
    const createdAt = Date.parse(order.created_at || "");
    return Number.isFinite(createdAt) && now - createdAt <= 10 * 60_000;
  }).length;
}

function enrichOrderContextSnapshot(context, marketData, orderData = {}) {
  const now = Date.now();
  const base = context.orderContextSnapshot || {};
  const currentOrder = context.currentOrder || {};
  const market = context.market || currentOrder.market || base.market || "UNKNOWN";
  const side = currentOrder.order_side || base.side || "UNKNOWN";
  const orderMode = currentOrder.order_type || base.orderMode || "UNKNOWN";
  const coinCurrency = String(market).split("-")[1];
  const accounts = orderData.accounts || [];
  const account =
    side === "BUY" ? getAccount(accounts, "KRW") : getAccount(accounts, coinCurrency);
  const available = toNumber(account?.balance);
  const requested =
    side === "BUY"
      ? toNumber(currentOrder.order_amount)
      : toNumber(currentOrder.order_volume);
  const baseAccount = getAccount(accounts, coinCurrency);
  const avgBuyPrice = toNumber(baseAccount?.avg_buy_price);
  const tradePrice = toNumber(marketData.tradePriceAtSnapshot) ||
    toNumber(marketData.current_price);
  const requestedBalanceRatio =
    base.requestedBalanceRatio ??
    (available && requested !== null
      ? Math.max(0, Math.min(1, requested / available))
      : null);
  const isDemoPersonalData =
    orderData?.personalDataSource === "demo-data" ||
    orderData?.isDemoPersonalData;

  return {
    snapshotId: base.snapshotId || crypto.randomUUID(),
    attemptId: base.attemptId || null,
    snapshotTrigger: base.snapshotTrigger || "ORDER_INTENT_CLICK",
    capturedAt: base.capturedAt || new Date().toISOString(),
    market,
    side,
    orderMode,
    entryPoint: base.entryPoint || "NORMAL",
    intentPrice:
      base.intentPrice ?? decimalString(currentOrder.order_price),
    intentQuantity:
      base.intentQuantity ?? decimalString(currentOrder.order_volume),
    intentAmount:
      base.intentAmount ?? decimalString(currentOrder.order_amount),
    requestedBalanceRatio,
    draftDurationMs: base.draftDurationMs ?? null,
    lastEditToSnapshotMs: base.lastEditToSnapshotMs ?? null,
    draftEditCount: base.draftEditCount ?? null,
    amountChangeRate: base.amountChangeRate ?? null,
    modeChangedToMarket: base.modeChangedToMarket ?? false,
    orderbookClickToSnapshotMs: base.orderbookClickToSnapshotMs ?? null,
    orderIntentCount1m:
      base.orderIntentCount1m ?? context.behaviorData?.buy_click_count_1m ?? 0,
    actualOrderCreatedCount10m:
      base.actualOrderCreatedCount10m ??
      (orderData?.privateDataAvailable === false && !isDemoPersonalData
        ? null
        : countActualOrders10m(orderData, now)),
    sameSideIntentCount1m:
      base.sameSideIntentCount1m ?? context.behaviorData?.buy_click_count_1m ?? 0,
    marketChangeCount5m: base.marketChangeCount5m ?? 0,
    sideChangeCount3m: base.sideChangeCount3m ?? 0,
    priceEditCount3m:
      base.priceEditCount3m ?? context.behaviorData?.input_edit_count ?? 0,
    quantityEditCount3m: base.quantityEditCount3m ?? 0,
    amountEditCount3m:
      base.amountEditCount3m ?? context.behaviorData?.input_edit_count ?? 0,
    inputRevertCount: base.inputRevertCount ?? 0,
    priceDirectionChangeCount: base.priceDirectionChangeCount ?? 0,
    priceChangeRate: base.priceChangeRate ?? null,
    orderModeChangeCount3m: base.orderModeChangeCount3m ?? 0,
    allocationPresetPercent: base.allocationPresetPercent ?? null,
    draftResetCount3m: base.draftResetCount3m ?? 0,
    matchedRuleIdsAtSnapshot: base.matchedRuleIdsAtSnapshot || [],
    primaryShownRuleId: base.primaryShownRuleId || null,
    shownRuleIds: base.shownRuleIds || [],
    tradePriceAtSnapshot:
      base.tradePriceAtSnapshot ??
      marketData.tradePriceAtSnapshot ??
      decimalString(marketData.current_price),
    shortTermReturn5m: base.shortTermReturn5m ?? marketData.shortTermReturn5m ?? null,
    signedChangeRate: base.signedChangeRate ?? marketData.signedChangeRate ?? null,
    spreadRate: base.spreadRate ?? marketData.spreadRate ?? null,
    marketRiskFlags: base.marketRiskFlags || marketData.marketRiskFlags || [],
    pricePositionIn5mRange:
      base.pricePositionIn5mRange ?? marketData.pricePositionIn5mRange ?? null,
    volumeSpikeRatio5m:
      base.volumeSpikeRatio5m ?? marketData.volumeSpikeRatio5m ?? null,
    baseAssetAvgBuyPriceBeforeSnapshot:
      base.baseAssetAvgBuyPriceBeforeSnapshot ??
      (avgBuyPrice && avgBuyPrice > 0 ? String(avgBuyPrice) : null),
    priceVsAvgBuyRateAtSnapshot:
      base.priceVsAvgBuyRateAtSnapshot ??
      (avgBuyPrice && tradePrice
        ? (tradePrice - avgBuyPrice) / avgBuyPrice
        : null),
  };
}

function toConfirmedTradeLogs(orderData, attemptId = null) {
  const scopedOrderData = scopeOrderDataToMarket(orderData);
  const orders = [
    ...(scopedOrderData?.rawOpenOrders || []),
    ...(scopedOrderData?.rawClosedOrders || []),
  ];

  return orders
    .filter((order) => order.uuid)
    .map((order) => ({
      tradeLogId: crypto.randomUUID(),
      attemptId,
      upbitOrderUuid: order.uuid,
      orderCreatedAt: order.created_at,
      market: order.market,
      side: String(order.side).toLowerCase() === "ask" ? "SELL" : "BUY",
      ordType:
        order.ord_type === "limit"
          ? "LIMIT"
          : order.ord_type === "price"
            ? "MARKET_BUY"
            : order.ord_type === "best"
              ? "BEST"
              : "MARKET_SELL",
      limitPrice:
        order.ord_type === "limit" ? decimalString(order.price) : null,
      requestedFunds:
        order.ord_type === "price" ? decimalString(order.price) : null,
      requestedVolume: decimalString(order.volume),
      timeInForce: order.time_in_force || null,
    }));
}

function toOrderOutcomePatches(orderData) {
  const scopedOrderData = scopeOrderDataToMarket(orderData);
  const orders = [
    ...(scopedOrderData?.rawOpenOrders || []),
    ...(scopedOrderData?.rawClosedOrders || []),
  ];

  return orders
    .filter((order) => order.uuid)
    .map((order) => ({
      upbitOrderUuid: order.uuid,
      state: order.state,
      executedVolume: decimalString(order.executed_volume),
      executedFunds: decimalString(order.executed_funds),
      paidFee: decimalString(order.paid_fee),
      remainingVolume: decimalString(order.remaining_volume),
      outcomeObservedAt: new Date().toISOString(),
    }));
}

async function sendDtoDebugSnapshot(tabId, payload) {
  debugBackgroundOrder("DTO_DEBUG_SNAPSHOT", {
    tabId,
    attemptId: payload?.orderContext?.attemptId || null,
    orderContextSnapshot: payload?.orderContext || null,
    marketSnapshot: payload?.market || null,
    personalSnapshot: payload?.personal || null,
    ruleEvaluation: payload?.ruleEvaluation || null,
    matchedRules: payload?.ruleEvaluation?.matchedRules || [],
    primaryRule: payload?.ruleEvaluation?.primaryRule || null,
  });
  await sendTabMessage(tabId, {
    type: "DTO_DEBUG_SNAPSHOT",
    payload: {
      ...payload,
      collectedAt: new Date().toISOString(),
    },
  });
}

function createPersonalDebugSnapshot(orderData, orderContextSnapshot, recentOrders = []) {
  const isDemoPersonalData =
    orderData?.personalDataSource === "demo-data" ||
    orderData?.isDemoPersonalData;

  return {
    privateDataAvailable: orderData?.privateDataAvailable ?? null,
    personalDataSource: isDemoPersonalData
      ? "demo-data"
      : orderData?.privateDataAvailable
        ? "upbit-private-api"
        : orderData?.personalDataSource || null,
    demoPersonalAvailable: Boolean(isDemoPersonalData),
    isDemoPersonalData: Boolean(isDemoPersonalData),
    accounts: orderData?.accounts || [],
    confirmedTradeLogs: isDemoPersonalData
      ? []
      : toConfirmedTradeLogs(orderData, orderContextSnapshot?.attemptId),
    orderOutcomePatches: isDemoPersonalData
      ? []
      : toOrderOutcomePatches(orderData),
    recentOrders,
    clientAverageBuyAmount: orderData?.clientAverageBuyAmount ?? null,
  };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (
    ["ORDER_ACTION_DETECTED", "ORDER_DATA_UPDATED", "DETECTION_RESULT"].includes(
      message?.type,
    )
  ) {
    const payload = message.payload || {};
    const snapshot = payload.orderContextSnapshot || {};
    const currentOrder = payload.currentOrder || {};
    debugBackgroundOrder(message.type, {
      messageType: message.type,
      payload,
      market: payload.market || snapshot.market || currentOrder.market || null,
      side:
        snapshot.side ||
        currentOrder.order_side ||
        payload.side ||
        null,
      orderMode:
        snapshot.orderMode ||
        currentOrder.order_type ||
        payload.orderMode ||
        null,
      intentPrice: snapshot.intentPrice || currentOrder.order_price || null,
      intentQuantity:
        snapshot.intentQuantity || currentOrder.order_volume || null,
      intentAmount: snapshot.intentAmount || currentOrder.order_amount || null,
      attemptId: snapshot.attemptId || payload.attemptId || null,
      senderTabUrl: sender.tab?.url || null,
      senderTabId: sender.tab?.id || null,
    });
  }

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
        chrome.tabs.create({
          url: createDashboardUrl(appOrigin, message.payload?.path),
        }),
      )
      .then(() => sendResponse({ ok: true }))
      .catch(() =>
        sendResponse({ ok: false, error: "대시보드를 열 수 없습니다." }),
      );
    return true;
  }

  if (message?.type === "OPEN_ONBOARDING") {
    resolveCurrentAppOrigin()
      .then((appOrigin) =>
        chrome.tabs.create({ url: `${appOrigin}/onboarding` }),
      )
      .then(() => sendResponse({ ok: true }))
      .catch(() =>
        sendResponse({ ok: false, error: "온보딩 페이지를 열 수 없습니다." }),
      );
    return true;
  }

  if (message?.type === "GET_AUTH_STATE") {
    getValidBackendAuth({ refreshProfile: true })
      .then((auth) =>
        sendResponse({
          ok: true,
          auth,
          onboardingReady: hasCompletedOnboarding(auth),
        }),
      )
      .catch((error) =>
        sendResponse({ ok: false, error: error.message }),
      );
    return true;
  }

  if (message?.type === "GET_USER_STATS") {
    fetchUserStats()
      .then((stats) =>
        sendResponse({
          ok: true,
          data: typeof stats?.data === "string" ? stats.data : "",
        }),
      )
      .catch((error) =>
        sendResponse({
          ok: false,
          authRequired: error.status === 401 || error.status === 403,
          error: error.message,
        }),
      );
    return true;
  }

  if (message?.type === "LOAD_GUARDRAIL_RULES") {
    loadGuardrailRules()
      .then((guardrailRules) =>
        sendResponse({ ok: true, guardrailRules }),
      )
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
    if (isDemoPageUrl(message.payload?.pageUrl)) {
      sendResponse({ ok: true, skipped: "demo-page" });
      return false;
    }
    void requestSnapshotRefresh(message.payload?.market);
    sendResponse({ ok: true });
    return false;
  }

  if (message?.type === "REFRESH_SNAPSHOTS_NOW") {
    if (isDemoPageUrl(message.payload?.pageUrl)) {
      sendResponse({ ok: true, snapshots: null, skipped: "demo-page" });
      return false;
    }
    requestSnapshotRefresh(message.payload?.market)
      .then((snapshots) => sendResponse({ ok: true, snapshots }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message?.type === "LOG_BEHAVIOR_EVENT") {
    postBehaviorEvent(message.payload)
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message?.type === "SAVE_ORDER_CONTEXT_SNAPSHOT") {
    saveOrderContextSnapshotLog(message.payload, sender.tab?.id);
    sendResponse({ ok: true });
    return false;
  }

  if (message?.type === "SAVE_GUARDRAIL_REACTION") {
    saveGuardrailReactionLog(message.payload, sender.tab?.id);
    sendResponse({ ok: true });
    return false;
  }

  if (message?.type === "SAVE_TRADE_FEEDBACK") {
    saveTradeFeedbackLog(message.payload, sender.tab?.id);
    sendResponse({ ok: true });
    return false;
  }

  if (message?.type === "RUN_DETECTION_NOW") {
    const context = message.payload;
    const pageUrl = context?.pageUrl || sender.tab?.url || "";

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

    if (!isCollectableTradingUrl(pageUrl)) {
      sendResponse({
        ok: false,
        error: "데모 페이지 또는 실제 Upbit 거래 화면에서만 감지를 실행합니다.",
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
      .catch((error) => {
        debugBackgroundOrder("BACKGROUND_DETECTION_API_ERROR", {
          messageType: message.type,
          error: error?.message || String(error),
          payload: context,
          senderTabUrl: sender.tab?.url || null,
          senderTabId: sender.tab?.id || null,
        });
        sendResponse({ ok: false, error: error.message });
      });
    return true;
  }

  if (
    message?.type === "RESET_DEMO_STATE" ||
    message?.type === "RESET_FLAME_STATE"
  ) {
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
    const pageUrl = message.payload?.pageUrl || sender.tab?.url || "";

    if (!isCollectableTradingUrl(pageUrl)) {
      sendResponse({
        ok: false,
        error: "데모 페이지 또는 실제 Upbit 거래 화면에서만 주문 데이터를 수집합니다.",
      });
      return false;
    }

    if (
      !isDemoPageUrl(pageUrl) &&
      !message.payload?.refreshAlreadyRequested
    ) {
      void requestSnapshotRefresh(message.payload?.market);
    }

    const collectOrder = isDemoPageUrl(pageUrl)
      ? Promise.resolve(createDemoOrderData(message.payload))
      : collectOrderDataForDetection(message.payload.market);

    collectOrder
      .then(async (orderData) => {
        let detection = null;

        if (sender.tab?.id) {
          if (!isDemoPageUrl(pageUrl)) {
            saveConfirmedTradeLogBatch(
              orderData,
              {
                attemptId:
                  message.payload.orderContextSnapshot?.attemptId || null,
                orderContextSnapshot:
                  message.payload.orderContextSnapshot || null,
                currentOrder: message.payload.currentOrder || null,
              },
              sender.tab.id,
            );
          }
          await sendTabMessage(sender.tab.id, {
            type: "ORDER_DATA_UPDATED",
            payload: orderData,
          });

          const detectionContext = {
            ...message.payload,
            pageUrl,
            market: message.payload?.market || orderData?.market,
          };
          const marketData = await getMarketDataForContext(detectionContext);
          detection = await callDetectionApi(
            sender.tab.id,
            detectionContext,
            marketData,
            {
              orderData,
              logSubmitAttempt: false,
            },
          );
        }

        sendResponse({ ok: true, data: orderData, detection });
      })
      .catch((error) => {
        debugBackgroundOrder("BACKGROUND_DETECTION_API_ERROR", {
          messageType: message.type,
          error: error?.message || String(error),
          payload: message.payload,
          senderTabUrl: sender.tab?.url || null,
          senderTabId: sender.tab?.id || null,
        });
        sendResponse({ ok: false, error: error.message });
      });
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
      .then(() => reloadCollectableTradingTabs())
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
    Promise.all([
      loadGuardrailRules(),
      requestSnapshotRefresh(message.payload?.market),
    ])
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

function installSnapshotRefreshAlarm() {
  chrome.alarms?.create(SNAPSHOT_REFRESH_ALARM_NAME, {
    periodInMinutes: SNAPSHOT_REFRESH_PERIOD_MINUTES,
  });
}

installSnapshotRefreshAlarm();

chrome.runtime.onInstalled?.addListener(() => {
  installSnapshotRefreshAlarm();
});

chrome.runtime.onStartup?.addListener(() => {
  installSnapshotRefreshAlarm();
});

chrome.alarms?.onAlarm?.addListener((alarm) => {
  if (alarm?.name !== SNAPSHOT_REFRESH_ALARM_NAME) {
    return;
  }

  void requestSnapshotRefresh();
});
