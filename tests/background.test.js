/* eslint-disable @typescript-eslint/no-require-imports */
const test = require("node:test");
const assert = require("node:assert/strict");
const cryptoModule = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const SaltbreadCore = require("../chrome-extension/data-core.js");

test("앱 페이지 origin에는 배포 주소와 localhost를 모두 포함한다", () => {
  const context = {};
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(
    fs.readFileSync(
      path.join(__dirname, "../chrome-extension/config.js"),
      "utf8",
    ),
    context,
  );

  assert.deepEqual(
    Array.from(context.SALTBREAD_CONFIG.appOrigins),
    [
      "https://skysh-saltbread.vercel.app",
      "http://localhost:3000",
    ],
  );
  assert.equal(
    context.SALTBREAD_CONFIG.apiBaseUrl,
    "https://skysh-saltbread.vercel.app",
  );
  assert.equal(
    context.SALTBREAD_CONFIG.behaviorEventsPath,
    "/api/behavior/events",
  );
});

function createStorageArea(store) {
  return {
    async get(keys) {
      if (typeof keys === "string") {
        return { [keys]: store[keys] };
      }

      if (Array.isArray(keys)) {
        return Object.fromEntries(keys.map((key) => [key, store[key]]));
      }

      if (keys && typeof keys === "object") {
        return Object.fromEntries(
          Object.entries(keys).map(([key, fallback]) => [
            key,
            store[key] ?? fallback,
          ]),
        );
      }

      return { ...store };
    },
    async set(values) {
      Object.assign(store, values);
    },
    async remove(keys) {
      for (const key of Array.isArray(keys) ? keys : [keys]) {
        delete store[key];
      }
    },
  };
}

function createBackgroundHarness() {
  const localStore = {};
  const sessionStore = {};
  const runtimeListeners = [];
  const sentTabMessages = [];
  const alarms = new Map();
  const context = {
    SaltbreadCore,
    TextDecoder,
    TextEncoder,
    URL,
    atob(value) {
      return Buffer.from(value, "base64").toString("binary");
    },
    btoa(value) {
      return Buffer.from(value, "binary").toString("base64");
    },
    chrome: {
      alarms: {
        async get(name) {
          return alarms.get(name);
        },
        async create(name, options) {
          alarms.set(name, options);
        },
        onAlarm: { addListener() {} },
      },
      runtime: {
        onInstalled: { addListener() {} },
        onStartup: { addListener() {} },
        onMessage: {
          addListener(listener) {
            runtimeListeners.push(listener);
          },
        },
      },
      storage: {
        local: createStorageArea(localStore),
        session: createStorageArea(sessionStore),
      },
      tabs: {
        async query() {
          return [];
        },
        async sendMessage(tabId, message) {
          sentTabMessages.push({ tabId, message });
          return null;
        },
        async create() {
          return {};
        },
      },
    },
    crypto: cryptoModule.webcrypto,
    fetch: async () => {
      throw new Error("Unexpected fetch");
    },
    importScripts() {},
    setTimeout(callback) {
      callback();
      return 0;
    },
    console,
  };
  context.globalThis = context;
  vm.createContext(context);
  const configPath = path.join(__dirname, "../chrome-extension/config.js");
  vm.runInContext(fs.readFileSync(configPath, "utf8"), context);
  const backgroundPath = path.join(
    __dirname,
    "../chrome-extension/background.js",
  );
  vm.runInContext(fs.readFileSync(backgroundPath, "utf8"), context);

  return {
    context,
    localStore,
    sessionStore,
    runtimeListeners,
    alarms,
    sentTabMessages,
  };
}

async function waitForRequests(capturedRequests, predicate, expectedCount = 1) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const matches = capturedRequests.filter(predicate);

    if (matches.length >= expectedCount) {
      return matches;
    }

    await new Promise((resolve) => setImmediate(resolve));
  }

  return capturedRequests.filter(predicate);
}

test("Upbit API 연결 후 새로고침 대상은 거래/데모 탭으로 제한한다", async () => {
  const { context } = createBackgroundHarness();
  const reloadedTabIds = [];

  context.chrome.tabs.query = async () => [
    { id: 1, url: "https://upbit.com/exchange?code=CRIX.UPBIT.KRW-BTC" },
    { id: 2, url: "http://localhost:3000/demo?code=CRIX.UPBIT.KRW-BTC" },
    { id: 3, url: "https://upbit.com/balances" },
    { id: 4, url: "http://localhost:3000/dashboard" },
  ];
  context.chrome.tabs.reload = async (tabId) => {
    reloadedTabIds.push(tabId);
  };

  await vm.runInContext("reloadCollectableTradingTabs()", context);

  assert.deepEqual(reloadedTabIds, [1, 2]);
});

test("Upbit 키를 AES-GCM으로 암호화하고 비밀번호로 다시 잠금 해제한다", async () => {
  const { context, localStore, sessionStore } = createBackgroundHarness();
  await vm.runInContext(
    'encryptAndStoreCredentials("access-value", "secret-value", "password-123")',
    context,
  );

  const serialized = JSON.stringify(localStore.upbitCredentials);
  assert.equal(serialized.includes("access-value"), false);
  assert.equal(serialized.includes("secret-value"), false);
  assert.ok(localStore.upbitCredentials.ciphertext);
  assert.ok(sessionStore.upbitCredentialSessionKey);

  const decrypted = await vm.runInContext("decryptCredentials()", context);
  assert.deepEqual(
    JSON.parse(JSON.stringify(decrypted)),
    { accessKey: "access-value", secretKey: "secret-value" },
  );

  delete sessionStore.upbitCredentialSessionKey;
  await assert.rejects(
    vm.runInContext("decryptCredentials()", context),
    /잠겨 있습니다/,
  );
  await assert.rejects(
    vm.runInContext('unlockCredentials("wrong-password")', context),
    /올바르지 않습니다/,
  );
  await vm.runInContext('unlockCredentials("password-123")', context);
  assert.ok(sessionStore.upbitCredentialSessionKey);
});

test("Upbit 인증용 HS512 JWT와 query_hash를 생성한다", async () => {
  const { context } = createBackgroundHarness();
  const queryString = vm.runInContext(
    'createQueryString([["states[]", "done"], ["start_time", "2026-06-28T10:00:00+09:00"]])',
    context,
  );
  const encodedQueryString = vm.runInContext(
    'createEncodedQueryString([["states[]", "done"], ["start_time", "2026-06-28T10:00:00+09:00"]])',
    context,
  );
  const jwt = await vm.runInContext(
    `createJwt("access-key", "secret-key", ${JSON.stringify(queryString)})`,
    context,
  );
  const [header, payload, signature] = jwt.split(".");
  const decodedHeader = JSON.parse(
    Buffer.from(header, "base64url").toString("utf8"),
  );
  const decodedPayload = JSON.parse(
    Buffer.from(payload, "base64url").toString("utf8"),
  );
  const expectedSignature = cryptoModule
    .createHmac("sha512", "secret-key")
    .update(`${header}.${payload}`)
    .digest("base64url");
  const expectedQueryHash = cryptoModule
    .createHash("sha512")
    .update(queryString)
    .digest("hex");

  assert.equal(
    queryString,
    "states[]=done&start_time=2026-06-28T10:00:00+09:00",
  );
  assert.equal(
    encodedQueryString,
    "states[]=done&start_time=2026-06-28T10%3A00%3A00%2B09%3A00",
  );
  assert.equal(decodedHeader.alg, "HS512");
  assert.equal(decodedPayload.access_key, "access-key");
  assert.equal(decodedPayload.query_hash_alg, "SHA512");
  assert.equal(decodedPayload.query_hash, expectedQueryHash);
  assert.equal(signature, expectedSignature);
});

test("Upbit 인증 요청은 URL만 인코딩하고 JWT는 원본 쿼리를 해시한다", async () => {
  const { context } = createBackgroundHarness();
  let capturedRequest = null;
  context.fetch = async (url, options) => {
    capturedRequest = { url, options };
    return {
      ok: true,
      async json() {
        return [];
      },
    };
  };

  await vm.runInContext(
    `fetchPrivateUpbit(
      "/v1/orders/closed",
      [["start_time", "2026-06-28T10:00:00+09:00"]],
      { accessKey: "access-key", secretKey: "secret-key" }
    )`,
    context,
  );

  const token = capturedRequest.options.headers.Authorization.replace(
    "Bearer ",
    "",
  );
  const [, payload] = token.split(".");
  const decodedPayload = JSON.parse(
    Buffer.from(payload, "base64url").toString("utf8"),
  );
  const expectedQueryHash = cryptoModule
    .createHash("sha512")
    .update("start_time=2026-06-28T10:00:00+09:00")
    .digest("hex");

  assert.equal(
    capturedRequest.url,
    "https://api.upbit.com/v1/orders/closed?start_time=2026-06-28T10%3A00%3A00%2B09%3A00",
  );
  assert.equal(decodedPayload.query_hash, expectedQueryHash);
});

test("확장 로그 DTO는 /api/me/logs 엔드포인트로 인증 저장된다", async () => {
  const { context, localStore, runtimeListeners } = createBackgroundHarness();
  localStore.auth = {
    accessToken: "backend-access-token",
    expiresAt: Date.now() + 60 * 60 * 1000,
    user: { id: "test-user" },
  };
  const capturedRequests = [];
  context.fetch = async (url, options) => {
    capturedRequests.push({ url, options });
    return {
      ok: true,
      async json() {
        return { ok: true, data: { saved: true } };
      },
    };
  };

  function send(message) {
    return new Promise((resolve) => {
      const keepsChannelOpen = runtimeListeners[0](
        message,
        { tab: { id: 11 } },
        resolve,
      );

      assert.equal(keepsChannelOpen, false);
    });
  }

  await send({
    type: "SAVE_ORDER_CONTEXT_SNAPSHOT",
    payload: {
      snapshotId: "snapshot-logs-1",
      attemptId: "attempt-logs-1",
      snapshotTrigger: "ORDER_INTENT_CLICK",
      capturedAt: "2026-07-08T01:00:00.000Z",
      market: "KRW-BTC",
      side: "BUY",
      orderMode: "LIMIT",
      intentPrice: "100000000",
      intentQuantity: "0.01",
      intentAmount: "1000000",
      matchedRuleIdsAtSnapshot: ["rule-1"],
      primaryShownRuleId: "rule-1",
      shownRuleIds: ["rule-1"],
      marketRiskFlags: [],
      debugOnly: "ignored",
    },
  });
  await send({
    type: "SAVE_GUARDRAIL_REACTION",
    payload: {
      reactionId: "local-reaction",
      snapshotId: "snapshot-logs-1",
      action: "PROCEED",
      reactedAt: "2026-07-08T01:00:01.000Z",
      reactionUiVersion: "v1",
    },
  });
  await send({
    type: "SAVE_TRADE_FEEDBACK",
    payload: {
      feedbackId: "local-feedback",
      attemptId: "attempt-logs-1",
      feedbackStatus: "ANSWERED",
      selfAssessment: "PLANNED",
      feedbackShownAt: "2026-07-08T01:00:02.000Z",
      respondedAt: "2026-07-08T01:00:03.000Z",
      feedbackUiVersion: "v1",
    },
  });

  const logRequests = await waitForRequests(
    capturedRequests,
    ({ url }) => url.includes("/api/me/logs/"),
    3,
  );
  const snapshotRequest = logRequests.find(({ url }) =>
    url.endsWith("/api/me/logs/order-context-snapshots"),
  );
  const reactionRequest = logRequests.find(({ url }) =>
    url.endsWith("/api/me/logs/guardrail-reactions"),
  );
  const feedbackRequest = logRequests.find(({ url }) =>
    url.endsWith("/api/me/logs/trade-feedbacks"),
  );
  const snapshotBody = JSON.parse(snapshotRequest.options.body);
  const reactionBody = JSON.parse(reactionRequest.options.body);
  const feedbackBody = JSON.parse(feedbackRequest.options.body);

  assert.equal(logRequests.length, 3);
  assert.equal(snapshotRequest.options.method, "POST");
  assert.equal(
    snapshotRequest.options.headers.Authorization,
    "Bearer backend-access-token",
  );
  assert.equal(snapshotRequest.options.headers["X-User-Id"], undefined);
  assert.equal(snapshotBody.snapshotId, "snapshot-logs-1");
  assert.equal(snapshotBody.market, "KRW-BTC");
  assert.equal(snapshotBody.orderTime, "10:00");
  assert.equal(snapshotBody.orderTimeMinutes, 600);
  assert.equal(snapshotBody.debugOnly, undefined);
  assert.equal(reactionBody.snapshotId, "snapshot-logs-1");
  assert.equal(reactionBody.action, "PROCEED");
  assert.equal(reactionBody.reactionId, undefined);
  assert.equal(feedbackBody.attemptId, "attempt-logs-1");
  assert.equal(feedbackBody.feedbackStatus, "ANSWERED");
  assert.equal(feedbackBody.selfAssessment, "PLANNED");
  assert.equal(feedbackBody.feedbackId, undefined);
});

test("로그 저장 5xx 실패는 UI 응답을 막지 않고 재시도한다", async () => {
  const { context, localStore, runtimeListeners, sentTabMessages } =
    createBackgroundHarness();
  localStore.auth = {
    accessToken: "backend-access-token",
    expiresAt: Date.now() + 60 * 60 * 1000,
    user: { id: "test-user" },
  };
  const capturedRequests = [];
  context.fetch = async (url, options) => {
    capturedRequests.push({ url, options });

    if (capturedRequests.length === 1) {
      return {
        ok: false,
        status: 503,
        async json() {
          return { message: "temporary unavailable" };
        },
      };
    }

    return {
      ok: true,
      async json() {
        return { ok: true };
      },
    };
  };
  const response = await new Promise((resolve) => {
    const keepsChannelOpen = runtimeListeners[0](
      {
        type: "SAVE_ORDER_CONTEXT_SNAPSHOT",
        payload: {
          snapshotId: "snapshot-retry",
          attemptId: "attempt-retry",
          snapshotTrigger: "ORDER_INTENT_CLICK",
          capturedAt: "2026-07-08T01:00:00.000Z",
          market: "KRW-BTC",
          side: "BUY",
          orderMode: "LIMIT",
        },
      },
      { tab: { id: 12 } },
      resolve,
    );

    assert.equal(keepsChannelOpen, false);
  });
  const logRequests = await waitForRequests(
    capturedRequests,
    ({ url }) => url.endsWith("/api/me/logs/order-context-snapshots"),
    2,
  );

  assert.equal(response.ok, true);
  assert.equal(logRequests.length, 2);
  assert.ok(
    sentTabMessages.some(
      ({ message }) =>
        message.type === "LOG_SAVE_STATUS" &&
        message.payload.kind === "order-context-snapshot" &&
        message.payload.ok === true,
    ),
  );
});

test("ORDER_ACTION_DETECTED는 실제 주문 로그와 outcome patch를 저장한다", async () => {
  const { context, localStore, runtimeListeners } = createBackgroundHarness();
  await vm.runInContext(
    'encryptAndStoreCredentials("access-value", "secret-value", "password-123")',
    context,
  );
  localStore.auth = {
    accessToken: "backend-access-token",
    expiresAt: Date.now() + 60 * 60 * 1000,
    user: { id: "test-user" },
  };
  const capturedRequests = [];
  context.fetch = async (url, options) => {
    capturedRequests.push({ url, options });
    let response = { ok: true, data: { saved: true } };

    if (url.includes("api.upbit.com/v1/orders/closed")) {
      response = [];
    } else if (url.includes("api.upbit.com/v1/orders/open")) {
      response = [
        {
          uuid: "upbit-order-1",
          market: "KRW-BTC",
          side: "bid",
          state: "wait",
          ord_type: "limit",
          price: "100000000",
          volume: "0.01",
          executed_volume: "0",
          executed_funds: "0",
          paid_fee: "0",
          remaining_volume: "0.01",
          created_at: "2026-07-08T10:00:00+09:00",
        },
      ];
    } else if (url.includes("api.upbit.com/v1/accounts")) {
      response = [
        { currency: "KRW", balance: "2000000" },
        { currency: "BTC", balance: "0.1", avg_buy_price: "100000000" },
      ];
    }

    return {
      ok: true,
      async json() {
        return response;
      },
    };
  };
  const response = await new Promise((resolve) => {
    const keepsChannelOpen = runtimeListeners[0](
      {
        type: "ORDER_ACTION_DETECTED",
        payload: {
          market: "KRW-BTC",
          pageUrl: "https://upbit.com/exchange?code=CRIX.UPBIT.KRW-BTC",
          sessionId: "session-confirmed",
          currentOrder: {
            market: "KRW-BTC",
            order_side: "BUY",
            order_status: "WAIT",
            order_type: "LIMIT",
            order_price: 100_000_000,
            order_volume: 0.01,
            order_amount: 1_000_000,
            realized_loss_pct_1h: null,
            order_request_time: "2026-07-08T10:00:00+09:00",
            order_cancel_time: null,
          },
          behaviorData: {
            is_max_button_clicked: false,
            client_avg_buy_amount: 500_000,
            buy_click_count_1m: 1,
            input_edit_count: 1,
            page_stay_duration: 30,
          },
          orderContextSnapshot: {
            snapshotId: "snapshot-confirmed",
            attemptId: "attempt-confirmed",
            snapshotTrigger: "ORDER_INTENT_CLICK",
            capturedAt: "2026-07-08T01:00:00.000Z",
            market: "KRW-BTC",
            side: "BUY",
            orderMode: "LIMIT",
            intentPrice: "100000000",
            intentQuantity: "0.01",
            intentAmount: "1000000",
          },
          demoData: null,
          refreshAlreadyRequested: true,
        },
      },
      { tab: { id: 13 } },
      resolve,
    );

    assert.equal(keepsChannelOpen, true);
  });
  const confirmedRequests = await waitForRequests(
    capturedRequests,
    ({ url }) => url.includes("/api/me/logs/confirmed-trade-logs"),
    2,
  );
  const createRequest = confirmedRequests.find(({ url, options }) =>
    url.endsWith("/api/me/logs/confirmed-trade-logs") &&
    options.method === "POST",
  );
  const outcomeRequest = confirmedRequests.find(({ url, options }) =>
    url.endsWith("/api/me/logs/confirmed-trade-logs/outcome") &&
    options.method === "PATCH",
  );
  const createBody = JSON.parse(createRequest.options.body);
  const outcomeBody = JSON.parse(outcomeRequest.options.body);

  assert.equal(response.ok, true);
  assert.equal(createRequest.options.headers.Authorization, "Bearer backend-access-token");
  assert.equal(createBody.tradeLogId, undefined);
  assert.equal(createBody.attemptId, "attempt-confirmed");
  assert.equal(createBody.upbitOrderUuid, "upbit-order-1");
  assert.equal(createBody.ordType, "LIMIT");
  assert.equal(createBody.limitPrice, "100000000");
  assert.equal(outcomeRequest.options.headers.Authorization, "Bearer backend-access-token");
  assert.equal(outcomeBody.upbitOrderUuid, "upbit-order-1");
  assert.equal(outcomeBody.state, "wait");
  assert.equal(outcomeBody.executedVolume, "0");
});

test("데모 raw orders는 ConfirmedTradeLog로 저장하지 않는다", async () => {
  const { context, localStore, runtimeListeners } = createBackgroundHarness();
  localStore.auth = {
    accessToken: "backend-access-token",
    expiresAt: Date.now() + 60 * 60 * 1000,
    user: { id: "test-user" },
  };
  const capturedRequests = [];
  context.fetch = async (url, options) => {
    capturedRequests.push({ url, options });
    return {
      ok: true,
      async json() {
        return { ok: true };
      },
    };
  };

  const response = await new Promise((resolve) => {
    const keepsChannelOpen = runtimeListeners[0](
      {
        type: "ORDER_ACTION_DETECTED",
        payload: {
          market: "KRW-BTC",
          pageUrl: "http://localhost:3000/demo",
          currentOrder: {
            market: "KRW-BTC",
            order_side: "BUY",
            order_status: "WAIT",
            order_type: "LIMIT",
            order_price: 100_000_000,
            order_volume: 0.01,
            order_amount: 1_000_000,
            realized_loss_pct_1h: null,
            order_request_time: "2026-07-08T10:00:00+09:00",
            order_cancel_time: null,
          },
          behaviorData: {
            is_max_button_clicked: false,
            client_avg_buy_amount: 500_000,
            buy_click_count_1m: 1,
            input_edit_count: 1,
            page_stay_duration: 30,
          },
          orderContextSnapshot: {
            snapshotId: "snapshot-demo-confirmed",
            attemptId: "attempt-demo-confirmed",
            snapshotTrigger: "ORDER_INTENT_CLICK",
            capturedAt: "2026-07-08T01:00:00.000Z",
            market: "KRW-BTC",
            side: "BUY",
            orderMode: "LIMIT",
          },
          demoData: {
            rawOpenOrders: [
              {
                uuid: "demo-order-1",
                market: "KRW-BTC",
                side: "bid",
                state: "wait",
                ord_type: "limit",
                price: "100000000",
                volume: "0.01",
                created_at: "2026-07-08T10:00:00+09:00",
              },
            ],
            rawClosedOrders: [],
          },
          refreshAlreadyRequested: true,
        },
      },
      { tab: { id: 14 } },
      resolve,
    );

    assert.equal(keepsChannelOpen, true);
  });

  assert.equal(response.ok, true);
  assert.equal(
    capturedRequests.some(({ url }) =>
      url.includes("/api/me/logs/confirmed-trade-logs"),
    ),
    false,
  );
});

test("attemptId는 정확히 하나의 Upbit 주문 후보에만 매칭한다", () => {
  const { context } = createBackgroundHarness();

  const result = vm.runInContext(
    `(() => {
      const attemptContext = {
        attemptId: "attempt-ambiguous",
        currentOrder: {
          market: "KRW-BTC",
          order_side: "BUY",
          order_type: "LIMIT",
          order_price: 100000000,
          order_volume: 0.01,
          order_amount: 1000000
        },
        orderContextSnapshot: {
          capturedAt: "2026-07-08T01:00:00.000Z",
          market: "KRW-BTC",
          side: "BUY",
          orderMode: "LIMIT",
          intentPrice: "100000000",
          intentQuantity: "0.01",
          intentAmount: "1000000"
        }
      };
      const ambiguousData = {
        rawOpenOrders: [],
        rawClosedOrders: [
          {
            uuid: "order-1",
            market: "KRW-BTC",
            side: "bid",
            ord_type: "limit",
            price: "100000000",
            volume: "0.01",
            created_at: "2026-07-08T10:00:01+09:00"
          },
          {
            uuid: "order-2",
            market: "KRW-BTC",
            side: "bid",
            ord_type: "limit",
            price: "100000000",
            volume: "0.01",
            created_at: "2026-07-08T10:00:02+09:00"
          }
        ]
      };
      const singleData = {
        rawOpenOrders: [],
        rawClosedOrders: [ambiguousData.rawClosedOrders[0]]
      };

      return {
        ambiguous: resolveAttemptMatchedOrderUuid(ambiguousData, attemptContext),
        single: resolveAttemptMatchedOrderUuid(singleData, attemptContext)
      };
    })()`,
    context,
  );

  assert.equal(result.ambiguous, null);
  assert.equal(result.single, "order-1");
});

test("백엔드 market snapshot 응답을 로컬 캐시에 저장한다", async () => {
  const { context, localStore } = createBackgroundHarness();
  let fetchCount = 0;
  context.fetch = async (url) => {
    fetchCount += 1;
    assert.ok(url.includes("/api/market-snapshot?market=KRW-BTC"));

    return {
      ok: true,
      async json() {
        return {
          market: "KRW-BTC",
          tradePrice: "106",
          signedChangeRate: 0.1,
          shortTermReturn5m: 0.06,
          spreadRate: null,
          marketRiskFlags: ["WARNING"],
          pricePositionIn5mRange: null,
          volumeSpikeRatio5m: 4,
          fetchedAt: new Date().toISOString(),
          freshnessMs: 0,
          source: "backend-market-snapshot",
        };
      },
    };
  };

  const result = await vm.runInContext(
    'collectMarketData("KRW-BTC")',
    context,
  );

  assert.equal(result.market, "KRW-BTC");
  assert.equal(result.current_price, 106);
  assert.equal(result.market_data.has_warning_badge, true);
  assert.equal(result.shortTermReturn5m, 0.06);
  assert.equal(localStore.marketSnapshotCache["KRW-BTC"].tradePrice, "106");
  assert.deepEqual(
    JSON.parse(JSON.stringify(localStore.marketDataCache["KRW-BTC"])),
    JSON.parse(JSON.stringify(result)),
  );
  await vm.runInContext('collectMarketData("KRW-BTC")', context);
  assert.equal(fetchCount, 2);
});

test("활성 거래 탭 market은 parseMarket으로 해석해 alarm refresh에 사용한다", async () => {
  const { context } = createBackgroundHarness();

  context.chrome.tabs.query = async () => [
    {
      id: 99,
      active: true,
      url: "https://upbit.com/exchange?code=CRIX.UPBIT.KRW-DOGE",
    },
  ];

  const market = await vm.runInContext("resolveActiveTradingMarket()", context);

  assert.equal(market, "KRW-DOGE");
});

test("시장 데이터 조회는 demoData를 무시하고 실제 Upbit 캐시를 사용한다", async () => {
  const { context, localStore } = createBackgroundHarness();
  localStore.marketDataCache = {
    "KRW-BTC": {
      current_price: 82_000_000,
      market_data: {
        price_change_rate_15m: 1.2,
        volume_change_rate_1m: 30,
        is_top3_volatility: false,
        has_warning_badge: false,
      },
      collected_at: new Date().toISOString(),
    },
  };
  const result = await vm.runInContext(
    `getMarketDataForContext({
      market: "KRW-BTC",
      demoData: {
        currentPrice: 100000000,
        marketData: {
          price_change_rate_15m: 6.2,
          volume_change_rate_1m: 340,
          is_top3_volatility: false,
          has_warning_badge: false
        }
      }
    })`,
    context,
  );

  assert.equal(result.current_price, 82_000_000);
  assert.equal(result.market_data.price_change_rate_15m, 1.2);
});

test("데모 페이지 시장 데이터는 market API cache 대신 demoData 원본에서 매핑한다", async () => {
  const { context, localStore } = createBackgroundHarness();
  localStore.marketDataCache = {
    "KRW-SOL": {
      current_price: 1,
      market_data: { price_change_rate_15m: 0 },
      collected_at: new Date().toISOString(),
    },
  };

  const result = await vm.runInContext(
    `getMarketDataForContext({
      market: "KRW-SOL",
      pageUrl: "http://localhost:3000/demo?code=CRIX.UPBIT.KRW-SOL",
      demoData: {
        marketData: {
          market: "KRW-SOL",
          tradePriceAtSnapshot: "318500",
          signedChangeRate: 0.16,
          shortTermReturn5m: 0.046,
          pricePositionIn5mRange: 0.94,
          volumeSpikeRatio5m: 5.8,
          spreadRate: 0.0009,
          ticker: {
            trade_price: 318500,
            signed_change_rate: 0.16
          },
          price_change_rate_15m: 16,
          price_change_rate_5m: 4.6,
          volume_change_rate_1m: 580,
          has_warning_badge: true
        }
      }
    })`,
    context,
  );

  assert.equal(result.current_price, 318500);
  assert.equal(result.tradePriceAtSnapshot, "318500");
  assert.equal(result.signedChangeRate, 0.16);
  assert.equal(result.shortTermReturn5m, 0.046);
  assert.equal(result.pricePositionIn5mRange, 0.94);
  assert.deepEqual(JSON.parse(JSON.stringify(result.marketRiskFlags)), ["WARNING"]);
});

test("데모 페이지 즉시 감지는 데모 데이터로 사용자 가드레일과 DTO 수집을 실행한다", async () => {
  const { context, localStore, runtimeListeners, sentTabMessages } =
    createBackgroundHarness();
  localStore.auth = {
    accessToken: "backend-access-token",
    expiresAt: Date.now() + 60 * 60 * 1000,
    user: { id: "test-user" },
  };
  localStore.guardrailRulesCache = {
    userId: "test-user",
    fetchedAt: new Date().toISOString(),
    rules: [
      {
        ruleId: "demo-sol-surge-buy",
        name: "데모 SOL 급등 추격 매수",
        isEnabled: true,
        priority: 1,
        riskLevel: "HIGH",
        visualMode: "SCARED",
        warningTitle: "급등 추격 매수 위험",
        warningMessage: "데모 페이지 SOL 시장 데이터로 급등 추격 매수를 감지했습니다.",
        requiresPrivateApi: false,
        expression: {
          nodeType: "GROUP",
          operator: "AND",
          children: [
            {
              nodeType: "CONDITION",
              leftField: "side",
              operator: "EQ",
              rightOperand: { operandType: "LITERAL", value: "BUY" },
            },
            {
              nodeType: "CONDITION",
              leftField: "orderMode",
              operator: "EQ",
              rightOperand: { operandType: "LITERAL", value: "MARKET" },
            },
            {
              nodeType: "CONDITION",
              leftField: "signedChangeRate",
              operator: "GTE",
              rightOperand: { operandType: "LITERAL", value: 0.1 },
            },
            {
              nodeType: "CONDITION",
              leftField: "shortTermReturn5m",
              operator: "GTE",
              rightOperand: { operandType: "LITERAL", value: 0.03 },
            },
            {
              nodeType: "CONDITION",
              leftField: "pricePositionIn5mRange",
              operator: "GTE",
              rightOperand: { operandType: "LITERAL", value: 0.8 },
            },
            {
              nodeType: "CONDITION",
              leftField: "requestedBalanceRatio",
              operator: "GTE",
              rightOperand: { operandType: "LITERAL", value: 0.5 },
            },
            {
              nodeType: "CONDITION",
              leftField: "orderbookClickToSnapshotMs",
              operator: "LTE",
              rightOperand: { operandType: "LITERAL", value: 5000 },
            },
          ],
        },
      },
    ],
  };
  const capturedRequests = [];
  context.fetch = async (url, options) => {
    capturedRequests.push({ url, options });
    return {
      ok: true,
      async json() {
        if (url.endsWith("/api/behavior/events")) {
          return { ok: true };
        }

        if (url.endsWith("/api/me/guardrail-rules")) {
          return { ok: true, data: [] };
        }

        throw new Error(`Unexpected legacy detect request: ${url}`);
      },
    };
  };
  const rawOrderNow = new Date().toISOString();

  const response = await new Promise((resolve) => {
    const keepsChannelOpen = runtimeListeners[0](
      {
        type: "RUN_DETECTION_NOW",
        payload: {
          market: "KRW-BTC",
          pageUrl: "http://localhost:3000/demo?code=CRIX.UPBIT.KRW-BTC",
          currentOrder: {
            market: "KRW-BTC",
            order_side: "BUY",
            order_status: "WAIT",
            order_type: "MARKET",
            order_price: 106_500_000,
            order_volume: 0.01127,
            order_amount: 1_200_000,
            realized_loss_pct_1h: null,
            order_request_time: "2026-06-28T10:30:00+09:00",
            order_cancel_time: null,
          },
          behaviorData: {
            is_max_button_clicked: false,
            client_avg_buy_amount: 500_000,
            buy_click_count_1m: 2,
            input_edit_count: 2,
            page_stay_duration: 32,
          },
          orderContextSnapshot: {
            snapshotId: "demo-sol-snapshot",
            attemptId: "demo-sol-attempt",
            snapshotTrigger: "ORDER_INTENT_CLICK",
            capturedAt: "2026-06-28T01:30:00.000Z",
            market: "KRW-BTC",
            side: "BUY",
            orderMode: "MARKET",
            intentPrice: null,
            intentQuantity: null,
            intentAmount: "1200000",
            requestedBalanceRatio: null,
            orderbookClickToSnapshotMs: 2400,
          },
          demoData: {
            market: "KRW-SOL",
            recentOrders: [],
            clientAverageBuyAmount: 500_000,
            currentPrice: 222_000,
            accounts: [
              { currency: "KRW", balance: "2400000" },
              { currency: "SOL", balance: "20", avg_buy_price: "180000" },
            ],
            recentOrders: [
              { uuid: "recent-sol", market: "KRW-SOL", created_at: rawOrderNow },
              { uuid: "recent-btc", market: "KRW-BTC", created_at: rawOrderNow },
            ],
            rawClosedOrders: [
              { uuid: "closed-sol", market: "KRW-SOL", created_at: rawOrderNow },
              { uuid: "closed-btc", market: "KRW-BTC", created_at: rawOrderNow },
            ],
            rawOpenOrders: [
              { uuid: "open-sol", market: "KRW-SOL", created_at: rawOrderNow },
            ],
            marketData: {
              market: "KRW-SOL",
              tradePriceAtSnapshot: "222000",
              signedChangeRate: 0.16,
              shortTermReturn5m: 0.046,
              spreadRate: 0.0007,
              pricePositionIn5mRange: 0.94,
              volumeSpikeRatio5m: 3.4,
              volume_change_rate_1m: 340,
              is_top3_volatility: false,
              has_warning_badge: false,
            },
            expiresAt: Date.now() + 180_000,
          },
        },
      },
      { tab: { id: 7 } },
      resolve,
    );

    assert.equal(keepsChannelOpen, true);
  });

  const demoDetectRequest = capturedRequests.find(({ url }) =>
    url.endsWith("/api/demo/detect"),
  );
  const behaviorRequest = capturedRequests.find(({ url }) =>
    url.endsWith("/api/behavior/events"),
  );
  const dtoMessage = sentTabMessages.find(
    ({ message }) => message.type === "DTO_DEBUG_SNAPSHOT",
  );

  assert.equal(response.ok, true);
  assert.equal(response.detection.type, "USER_GUARDRAIL_RULE");
  assert.equal(response.detection.primaryRuleId, "demo-sol-surge-buy");
  assert.equal(demoDetectRequest, undefined);
  assert.ok(behaviorRequest);
  assert.equal(
    capturedRequests.some(({ url }) => url.includes("api.upbit.com")),
    false,
  );
  assert.equal(
    capturedRequests.some(({ url }) =>
      url.endsWith("/api/me/guardrail-rules"),
    ),
    false,
  );
  assert.equal(dtoMessage.message.payload.personal.privateDataAvailable, false);
  assert.equal(dtoMessage.message.payload.personal.personalDataSource, "demo-data");
  assert.equal(dtoMessage.message.payload.personal.demoPersonalAvailable, true);
  assert.equal(dtoMessage.message.payload.personal.accounts.length, 2);
  assert.deepEqual(
    dtoMessage.message.payload.personal.recentOrders.map((order) => order.uuid),
    ["recent-sol"],
  );
  assert.equal(dtoMessage.message.payload.marketResolutionTrace.resolvedMarket, "KRW-SOL");
  assert.equal(dtoMessage.message.payload.marketDataSource, "demo-data");
  assert.equal(dtoMessage.message.payload.demoCacheDebug.hasDemoMarketCache, true);
  assert.equal(dtoMessage.message.payload.demoCacheDebug.hasDemoMarketFields, true);
  assert.equal(
    dtoMessage.message.payload.demoCacheDebug.hasDemoMarketForResolvedMarket,
    true,
  );
  assert.equal(dtoMessage.message.payload.marketMismatch, false);
  assert.equal(dtoMessage.message.payload.expectedMarket, "KRW-SOL");
  assert.equal(dtoMessage.message.payload.actualMarket, "KRW-SOL");
  assert.equal(dtoMessage.message.payload.usedForRuleEvaluation, true);
  assert.equal(dtoMessage.message.payload.orderContext.market, "KRW-SOL");
  assert.equal(dtoMessage.message.payload.market.market, "KRW-SOL");
  assert.equal(dtoMessage.message.payload.market.tradePriceAtSnapshot, "222000");
  assert.notEqual(dtoMessage.message.payload.market.tradePriceAtSnapshot, null);
  assert.notEqual(dtoMessage.message.payload.market.signedChangeRate, null);
  assert.equal(dtoMessage.message.payload.market.spreadRate, 0.0007);
  assert.equal(dtoMessage.message.payload.market.volumeSpikeRatio5m, 3.4);
  assert.notEqual(dtoMessage.message.payload.market.source, "backend-market-snapshot");
  assert.equal(
    dtoMessage.message.payload.orderContext.tradePriceAtSnapshot,
    "222000",
  );
  assert.notEqual(
    dtoMessage.message.payload.orderContext.tradePriceAtSnapshot,
    null,
  );
  assert.equal(
    dtoMessage.message.payload.orderContext.signedChangeRate,
    0.16,
  );
  assert.equal(
    dtoMessage.message.payload.orderContext.shortTermReturn5m,
    0.046,
  );
  assert.equal(
    dtoMessage.message.payload.orderContext.pricePositionIn5mRange,
    0.94,
  );
  assert.equal(
    dtoMessage.message.payload.orderContext.orderbookClickToSnapshotMs,
    2400,
  );
  assert.equal(
    dtoMessage.message.payload.orderContext.actualOrderCreatedCount10m,
    2,
  );
});

test("실제 Upbit 주문 액션은 로그 보정 후 사용자 규칙 evaluation result를 content로 보낸다", async () => {
  const { context, localStore, runtimeListeners, sentTabMessages } =
    createBackgroundHarness();
  localStore.auth = {
    accessToken: "backend-access-token",
    expiresAt: Date.now() + 60 * 60 * 1000,
    user: { id: "test-user" },
  };
  localStore.marketDataCache = {
    "KRW-BTC": {
      current_price: 100_000_000,
      market_data: {
        price_change_rate_15m: 0.5,
        volume_change_rate_1m: 20,
        is_top3_volatility: false,
        has_warning_badge: false,
      },
      collected_at: new Date().toISOString(),
    },
  };
  const capturedRequests = [];
  context.fetch = async (url, options) => {
    capturedRequests.push({ url, options });
    return {
      ok: true,
      async json() {
        return {
          detected: false,
          type: null,
          message: "현재 감정적 매매 패턴은 감지되지 않았어요.",
        };
      },
    };
  };

  async function sendOrderAction(orderSide) {
    return new Promise((resolve) => {
      const keepsChannelOpen = runtimeListeners[0](
        {
          type: "ORDER_ACTION_DETECTED",
          payload: {
            market: "KRW-BTC",
            pageUrl: "https://upbit.com/exchange?code=CRIX.UPBIT.KRW-BTC",
            currentOrder: {
              market: "KRW-BTC",
              order_side: orderSide,
              order_status: "WAIT",
              order_type: "LIMIT",
              order_price: 100_000_000,
              order_volume: 0.01,
              order_amount: 1_000_000,
              realized_loss_pct_1h: null,
              order_request_time: "2026-06-28T10:30:00+09:00",
              order_cancel_time: null,
            },
            behaviorData: {
              is_max_button_clicked: false,
              client_avg_buy_amount: 500_000,
              buy_click_count_1m: orderSide === "BUY" ? 1 : 0,
              input_edit_count: 1,
              page_stay_duration: 60,
            },
            demoData: null,
            refreshAlreadyRequested: true,
          },
        },
        { tab: { id: 7 } },
        resolve,
      );

      assert.equal(keepsChannelOpen, true);
    });
  }

  const buyResponse = await sendOrderAction("BUY");
  const sellResponse = await sendOrderAction("SELL");
  const detectRequests = capturedRequests.filter(({ url }) =>
    url.endsWith("/api/ext/detect"),
  );
  const behaviorRequests = capturedRequests.filter(({ url }) =>
    url.endsWith("/api/behavior/events"),
  );
  const detectRequestBodies = detectRequests.map(({ options }) =>
    JSON.parse(options.body),
  );
  const behaviorRequestBodies = behaviorRequests.map(({ options }) =>
    JSON.parse(options.body),
  );

  assert.equal(buyResponse.ok, true);
  assert.equal(sellResponse.ok, true);
  assert.equal(detectRequests.length, 0);
  assert.equal(behaviorRequests.length, 0);
  assert.equal(
    capturedRequests.filter(({ url }) =>
      url.endsWith("/api/me/guardrail-rules"),
    ).length,
    0,
  );
  assert.equal(buyResponse.detection.detected, false);
  assert.equal(buyResponse.detection.type, "USER_GUARDRAIL_RULE");
  assert.equal(sellResponse.detection.detected, false);
  assert.equal(sellResponse.detection.type, "USER_GUARDRAIL_RULE");
  assert.equal(
    sentTabMessages.filter(({ message }) => message.type === "DETECTION_RESULT")
      .length,
    2,
  );
});

test("ORDER_ACTION_DETECTED는 사용자 규칙 detection을 현재 tab으로 전송한다", async () => {
  const { context, localStore, runtimeListeners, sentTabMessages } =
    createBackgroundHarness();
  localStore.auth = {
    accessToken: "backend-access-token",
    expiresAt: Date.now() + 60 * 60 * 1000,
    user: { id: "test-user" },
  };
  localStore.marketDataCache = {
    "KRW-BTC": {
      current_price: 100_000_000,
      market_data: {
        price_change_rate_15m: 0.5,
        volume_change_rate_1m: 20,
        is_top3_volatility: false,
        has_warning_badge: false,
      },
      collected_at: new Date().toISOString(),
    },
  };
  const capturedRequests = [];
  context.fetch = async (url, options) => {
    capturedRequests.push({ url, options });
    return {
      ok: true,
      async json() {
        if (url.endsWith("/api/me/guardrail-rules")) {
          throw new Error("Guardrail rules should be loaded from page cache");
        }

        if (url.endsWith("/api/behavior/events")) {
          return { ok: true };
        }

        throw new Error(`Unexpected fallback request: ${url}`);
      },
    };
  };
  localStore.guardrailRulesCache = {
    userId: "test-user",
    fetchedAt: new Date().toISOString(),
    rules: [
      {
        ruleId: "high-allocation",
        isEnabled: true,
        priority: 1,
        riskLevel: "HIGH",
        visualMode: "SCARED",
        warningTitle: "고비중 시장가 매수",
        warningMessage: "가용 자산 대부분을 쓰는 주문입니다.",
        expression: {
          nodeType: "GROUP",
          operator: "AND",
          children: [
            {
              nodeType: "CONDITION",
              leftField: "side",
              operator: "EQ",
              rightOperand: {
                operandType: "LITERAL",
                value: "BUY",
              },
            },
            {
              nodeType: "CONDITION",
              leftField: "requestedBalanceRatio",
              operator: "GTE",
              rightOperand: {
                operandType: "LITERAL",
                value: 0.7,
              },
            },
          ],
        },
      },
    ],
  };

  const response = await new Promise((resolve) => {
    const keepsChannelOpen = runtimeListeners[0](
      {
          type: "ORDER_ACTION_DETECTED",
          payload: {
            market: "KRW-BTC",
            pageUrl: "https://upbit.com/exchange?code=CRIX.UPBIT.KRW-BTC",
            currentOrder: {
            market: "KRW-BTC",
            order_side: "BUY",
            order_status: "WAIT",
            order_type: "MARKET",
            order_price: null,
            order_volume: null,
            order_amount: 800_000,
            realized_loss_pct_1h: null,
            order_request_time: "2026-06-28T10:30:00+09:00",
            order_cancel_time: null,
          },
          behaviorData: {
            is_max_button_clicked: true,
            client_avg_buy_amount: 500_000,
            buy_click_count_1m: 1,
            input_edit_count: 1,
            page_stay_duration: 20,
          },
          orderContextSnapshot: {
            snapshotId: "snapshot-1",
            attemptId: "attempt-1",
            snapshotTrigger: "ORDER_INTENT_CLICK",
            capturedAt: "2026-06-28T01:30:00.000Z",
            market: "KRW-BTC",
            side: "BUY",
            orderMode: "MARKET",
            requestedBalanceRatio: 0.8,
          },
            demoData: null,
            refreshAlreadyRequested: true,
          },
      },
      { tab: { id: 8 } },
      resolve,
    );

    assert.equal(keepsChannelOpen, true);
  });

  assert.equal(response.ok, true);
  assert.equal(response.detection.detected, true);
  assert.equal(response.detection.primaryRuleId, "high-allocation");
  assert.equal(
    capturedRequests.some(({ url }) => url.endsWith("/api/ext/detect")),
    false,
  );
  assert.equal(
    capturedRequests.some(({ url }) =>
      url.endsWith("/api/me/guardrail-rules"),
    ),
    false,
  );
  assert.equal(
    sentTabMessages.some(({ message }) => message.type === "DETECTION_RESULT"),
    true,
  );
});

test("개인 Upbit API가 없어도 ORDER_ACTION_DETECTED는 market/behavior 기반 detection을 전송한다", async () => {
  const { context, localStore, runtimeListeners, sentTabMessages } =
    createBackgroundHarness();
  localStore.auth = {
    accessToken: "backend-access-token",
    expiresAt: Date.now() + 60 * 60 * 1000,
    user: { id: "test-user" },
  };
  localStore.marketDataCache = {
    "KRW-BTC": {
      current_price: 100_000_000,
      tradePriceAtSnapshot: "100000000",
      shortTermReturn5m: 0.01,
      signedChangeRate: 0.02,
      spreadRate: 0.0001,
      marketRiskFlags: [],
      pricePositionIn5mRange: 0.6,
      volumeSpikeRatio5m: 1.2,
      market_data: {
        price_change_rate_15m: 0.5,
        volume_change_rate_1m: 20,
        is_top3_volatility: false,
        has_warning_badge: false,
      },
      collected_at: new Date().toISOString(),
    },
  };
  localStore.guardrailRulesCache = {
    userId: "test-user",
    fetchedAt: new Date().toISOString(),
    rules: [
      {
        ruleId: "buy-warning",
        name: "매수 확인",
        isEnabled: true,
        priority: 1,
        riskLevel: "MEDIUM",
        visualMode: "CURIOUS",
        warningTitle: "매수 주문 확인",
        warningMessage: "매수 주문 전 한 번 더 확인합니다.",
        requiresPrivateApi: false,
        expression: {
          nodeType: "CONDITION",
          leftField: "side",
          operator: "EQ",
          rightOperand: {
            operandType: "LITERAL",
            value: "BUY",
          },
        },
      },
    ],
  };
  const capturedRequests = [];
  context.fetch = async (url, options) => {
    capturedRequests.push({ url, options });
    return {
      ok: true,
      async json() {
        if (url.endsWith("/api/me/guardrail-rules")) {
          throw new Error("Guardrail rules should be loaded from page cache");
        }

        if (url.endsWith("/api/behavior/events")) {
          return { ok: true };
        }

        throw new Error(`Unexpected request: ${url}`);
      },
    };
  };

  const response = await new Promise((resolve) => {
    const keepsChannelOpen = runtimeListeners[0](
      {
        type: "ORDER_ACTION_DETECTED",
        payload: {
          market: "KRW-BTC",
          pageUrl: "https://upbit.com/exchange?code=CRIX.UPBIT.KRW-BTC",
          currentOrder: {
            market: "KRW-BTC",
            order_side: "BUY",
            order_status: "WAIT",
            order_type: "LIMIT",
            order_price: 100_000_000,
            order_volume: 0.01,
            order_amount: 1_000_000,
            realized_loss_pct_1h: null,
            order_request_time: "2026-06-28T10:30:00+09:00",
            order_cancel_time: null,
          },
          behaviorData: {
            is_max_button_clicked: false,
            client_avg_buy_amount: null,
            buy_click_count_1m: 1,
            input_edit_count: 1,
            page_stay_duration: 60,
          },
          orderContextSnapshot: {
            snapshotId: "snapshot-buy",
            attemptId: "attempt-buy",
            snapshotTrigger: "ORDER_INTENT_CLICK",
            capturedAt: "2026-06-28T01:30:00.000Z",
            market: "KRW-BTC",
            side: "BUY",
            orderMode: "LIMIT",
            intentPrice: "100000000",
            intentQuantity: "0.01",
            intentAmount: "1000000",
          },
          demoData: null,
          refreshAlreadyRequested: true,
        },
      },
      { tab: { id: 9 } },
      resolve,
    );

    assert.equal(keepsChannelOpen, true);
  });
  assert.equal(response.ok, true);
  assert.equal(response.detection.detected, true);
  assert.equal(response.detection.primaryRuleId, "buy-warning");
  assert.equal(
    capturedRequests.some(({ url }) => url.endsWith("/api/ext/detect")),
    false,
  );
  assert.equal(
    capturedRequests.some(({ url }) =>
      url.endsWith("/api/me/guardrail-rules"),
    ),
    false,
  );
  assert.equal(
    capturedRequests.some(({ url }) => url.includes("api.upbit.com")),
    false,
  );
  assert.equal(
    sentTabMessages.some(({ message }) => message.type === "DTO_DEBUG_SNAPSHOT"),
    true,
  );
  assert.equal(
    sentTabMessages.some(({ message }) => message.type === "DETECTION_RESULT"),
    true,
  );
});

test("market mismatch가 있으면 사용자 규칙 평가를 건너뛰고 DTO debug에 남긴다", async () => {
  const { context, localStore, sentTabMessages } = createBackgroundHarness();
  localStore.auth = {
    accessToken: "backend-access-token",
    expiresAt: Date.now() + 60 * 60 * 1000,
    user: { id: "test-user" },
  };
  localStore.guardrailRulesCache = {
    userId: "test-user",
    fetchedAt: new Date().toISOString(),
    rules: [
      {
        ruleId: "sol-buy",
        isEnabled: true,
        priority: 1,
        riskLevel: "HIGH",
        visualMode: "SCARED",
        expression: {
          nodeType: "CONDITION",
          leftField: "side",
          operator: "EQ",
          rightOperand: { operandType: "LITERAL", value: "BUY" },
        },
      },
    ],
  };
  context.fetch = async (url) => {
    if (url.endsWith("/api/behavior/events")) {
      return {
        ok: true,
        async json() {
          return { ok: true };
        },
      };
    }

    throw new Error(`Unexpected request: ${url}`);
  };

  const result = await vm.runInContext(
    `callDetectionApi(
      17,
      {
        market: "KRW-SOL",
        pageUrl: "https://upbit.com/exchange?code=CRIX.UPBIT.KRW-SOL",
        currentOrder: {
          market: "KRW-SOL",
          order_side: "BUY",
          order_status: "WAIT",
          order_type: "MARKET",
          order_price: null,
          order_volume: null,
          order_amount: 1000000,
          realized_loss_pct_1h: null,
          order_request_time: "2026-06-28T10:30:00+09:00",
          order_cancel_time: null
        },
        behaviorData: {
          buy_click_count_1m: 1,
          input_edit_count: 1,
          page_stay_duration: 30
        },
        orderContextSnapshot: {
          snapshotId: "snapshot-sol",
          attemptId: "attempt-sol",
          snapshotTrigger: "ORDER_INTENT_CLICK",
          capturedAt: "2026-06-28T01:30:00.000Z",
          market: "KRW-SOL",
          side: "BUY",
          orderMode: "MARKET",
          intentAmount: "1000000"
        }
      },
      {
        market: "KRW-BTC",
        current_price: 100000000,
        tradePriceAtSnapshot: "100000000",
        signedChangeRate: 0.2,
        market_data: {},
        source: "backend-market-snapshot"
      },
      { logSubmitAttempt: false }
    )`,
    context,
  );
  const dtoMessage = sentTabMessages.find(
    ({ message }) => message.type === "DTO_DEBUG_SNAPSHOT",
  );

  assert.equal(result.marketMismatch, true);
  assert.equal(result.ruleEvaluation.skippedReason, "MARKET_MISMATCH");
  assert.equal(dtoMessage.message.payload.marketMismatch, true);
  assert.equal(dtoMessage.message.payload.expectedMarket, "KRW-SOL");
  assert.equal(dtoMessage.message.payload.actualMarket, "KRW-BTC");
  assert.equal(dtoMessage.message.payload.usedForRuleEvaluation, false);
  assert.equal(dtoMessage.message.payload.ruleEvaluation.detected, false);
  assert.equal(
    sentTabMessages.some(({ message }) => message.type === "DETECTION_RESULT"),
    false,
  );
});

test("주문 클릭 시 인증 주문을 조회하고 detect용 이력으로 변환한다", async () => {
  const { context } = createBackgroundHarness();
  await vm.runInContext(
    'encryptAndStoreCredentials("access-value", "secret-value", "password-123")',
    context,
  );
  let closedOrdersRequest = null;
  context.fetch = async (url) => {
    let response;

    if (url.includes("/orders/closed")) {
      closedOrdersRequest = url;
      response = [
        {
          market: "KRW-BTC",
          side: "bid",
          state: "done",
          ord_type: "limit",
          price: "100000000",
          volume: "0.01",
          executed_volume: "0.01",
          executed_funds: "1000000",
          created_at: "2026-06-28T10:00:00+09:00",
        },
      ];
    } else if (url.includes("/orders/open")) {
      response = [];
    } else {
      response = [{ currency: "BTC", avg_buy_price: "100000000" }];
    }

    return {
      ok: true,
      async json() {
        return response;
      },
    };
  };

  const result = await vm.runInContext(
    'collectOrderData("KRW-BTC")',
    context,
  );

  assert.equal(result.clientAverageBuyAmount, 1_000_000);
  assert.equal(result.recentOrders.length, 1);
  assert.equal(result.recentOrders[0].order_side, "BUY");
  assert.equal(result.recentOrders[0].order_type, "LIMIT");
  const closedOrdersUrl = new URL(closedOrdersRequest);
  assert.equal(closedOrdersUrl.origin, "https://api.upbit.com");
  assert.equal(closedOrdersUrl.pathname, "/v1/orders/closed");
  assert.equal(closedOrdersUrl.searchParams.get("market"), "KRW-BTC");
  assert.equal(closedOrdersUrl.searchParams.get("limit"), "100");
  assert.equal(closedOrdersUrl.searchParams.get("order_by"), "desc");
});

test("미체결 주문이나 계좌 조회 실패를 성공으로 숨기지 않는다", async () => {
  const { context } = createBackgroundHarness();
  await vm.runInContext(
    'encryptAndStoreCredentials("access-value", "secret-value", "password-123")',
    context,
  );
  context.fetch = async (url) => {
    if (url.includes("/orders/open")) {
      return {
        ok: false,
        async json() {
          return { error: { message: "주문조회 권한이 없습니다." } };
        },
      };
    }

    return {
      ok: true,
      async json() {
        return [];
      },
    };
  };

  await assert.rejects(
    vm.runInContext('collectOrderData("KRW-BTC")', context),
    /주문조회 권한이 없습니다/,
  );
});

test("만료된 백엔드 Access Token을 감지 전에 갱신한다", async () => {
  const { context, localStore } = createBackgroundHarness();
  localStore.auth = {
    accessToken: "expired-token",
    expiresAt: Date.now() - 1000,
    user: { id: "test-user" },
  };
  let refreshRequest = null;
  context.fetch = async (url, options) => {
    refreshRequest = { url, options };
    return {
      ok: true,
      async json() {
        return {
          accessToken: "refreshed-token",
          expiresIn: 3600,
        };
      },
    };
  };

  const auth = await vm.runInContext("getValidBackendAuth()", context);

  assert.equal(
    refreshRequest.url,
    `${context.SALTBREAD_CONFIG.apiBaseUrl}/api/auth/refresh`,
  );
  assert.equal(refreshRequest.options.credentials, "include");
  assert.equal(auth.accessToken, "refreshed-token");
  assert.equal(localStore.auth.accessToken, "refreshed-token");
  assert.ok(localStore.auth.expiresAt > Date.now());
});

test("주기 알람 없이 사용자 규칙 평가와 행동 로그 저장을 실행한다", async () => {
  const { context, localStore, alarms } = createBackgroundHarness();
  localStore.auth = {
    accessToken: "backend-access-token",
    expiresAt: Date.now() + 60 * 60 * 1000,
    user: { id: "test-user" },
  };
  localStore.orderDataCache = {
    "KRW-BTC": {
      clientAverageBuyAmount: 500_000,
      recentOrders: [],
    },
  };
  localStore.guardrailRulesCache = {
    userId: "test-user",
    fetchedAt: new Date().toISOString(),
    rules: [
      {
        ruleId: "all-in-user-rule",
        name: "최대 금액 매수",
        isEnabled: true,
        priority: 1,
        riskLevel: "HIGH",
        visualMode: "SCARED",
        warningTitle: "최대 금액 매수 확인",
        warningMessage: "큰 금액의 시장가 매수 주문입니다.",
        requiresPrivateApi: false,
        expression: {
          nodeType: "GROUP",
          operator: "AND",
          children: [
            {
              nodeType: "CONDITION",
              leftField: "side",
              operator: "EQ",
              rightOperand: { operandType: "LITERAL", value: "BUY" },
            },
            {
              nodeType: "CONDITION",
              leftField: "orderMode",
              operator: "EQ",
              rightOperand: { operandType: "LITERAL", value: "MARKET" },
            },
            {
              nodeType: "CONDITION",
              leftField: "intentAmount",
              operator: "GTE",
              rightOperand: { operandType: "LITERAL", value: "1000000" },
            },
          ],
        },
      },
    ],
  };
  const capturedRequests = [];
  context.fetch = async (url, options) => {
    capturedRequests.push({ url, options });
    return {
      ok: true,
      async json() {
        if (url.endsWith("/api/behavior/events")) {
          return { ok: true };
        }

        throw new Error(`Unexpected legacy detect request: ${url}`);
      },
    };
  };
  const result = await vm.runInContext(
    `callDetectionApi(
      1,
      {
        market: "KRW-BTC",
        pageUrl: "https://upbit.com/exchange?code=CRIX.UPBIT.KRW-BTC",
        currentOrder: {
          order_side: "BUY",
          order_status: "WAIT",
          order_type: "MARKET",
          order_price: null,
          order_volume: null,
          order_amount: 1500000,
          realized_loss_pct_1h: null,
          order_request_time: "2026-06-28T10:25:00+09:00",
          order_cancel_time: null
        },
        behaviorData: {
          is_max_button_clicked: true,
          client_avg_buy_amount: null,
          buy_click_count_1m: 1,
          input_edit_count: 2,
          page_stay_duration: 75
        }
      },
      {
        current_price: 82000000,
        market_data: {
          price_change_rate_15m: 5.5,
          volume_change_rate_1m: 315.2,
          is_top3_volatility: true,
          has_warning_badge: false
        }
      }
    )`,
    context,
  );
  const detectRequest = capturedRequests.find(({ url }) =>
    url.endsWith("/api/ext/detect"),
  );
  const behaviorRequest = capturedRequests.find(({ url }) =>
    url.endsWith("/api/behavior/events"),
  );
  const behaviorBody = JSON.parse(behaviorRequest.options.body);

  assert.equal(alarms.has("saltbread-minute-collection"), false);
  assert.equal(detectRequest, undefined);
  assert.equal(
    behaviorRequest.url,
    `${context.SALTBREAD_CONFIG.apiBaseUrl}/api/behavior/events`,
  );
  assert.equal(behaviorRequest.options.method, "POST");
  assert.equal(behaviorRequest.options.headers["X-User-Id"], "test-user");
  assert.deepEqual(behaviorBody, {
    symbol: "KRW-BTC",
    eventType: "ORDER_SUBMIT_ATTEMPT",
    side: "BUY",
    orderType: "MARKET",
    price: null,
    amount: 1_500_000,
    quantity: null,
    pageUrl: "https://upbit.com/exchange?code=CRIX.UPBIT.KRW-BTC",
    occurredAt: "2026-06-28T10:25:00+09:00",
    metadata: {
      behaviorData: {
        is_max_button_clicked: true,
        client_avg_buy_amount: 500_000,
        buy_click_count_1m: 1,
        input_edit_count: 2,
        page_stay_duration: 75,
      },
      currentPrice: 82_000_000,
      marketData: {
        price_change_rate_15m: 5.5,
        volume_change_rate_1m: 315.2,
        is_top3_volatility: true,
        has_warning_badge: false,
      },
    },
  });
  assert.equal(result.type, "USER_GUARDRAIL_RULE");
  assert.equal(result.primaryRuleId, "all-in-user-rule");
  assert.equal(result.orderContextSnapshot.intentAmount, "1500000");
  assert.equal(result.ruleEvaluation.matchedRuleIds[0], "all-in-user-rule");
  assert.equal(result.flameMode, "SCARED");
  assert.equal(localStore.flameTheme.mode, "SCARED");
  assert.equal(localStore.flameTheme.orderSide, "BUY");
});
