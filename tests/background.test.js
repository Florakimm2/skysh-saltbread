/* eslint-disable @typescript-eslint/no-require-imports */
const test = require("node:test");
const assert = require("node:assert/strict");
const cryptoModule = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const SaltbreadCore = require("../chrome-extension/data-core.js");

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
  const alarms = new Map();
  const context = {
    SaltbreadCore,
    SALTBREAD_CONFIG: {
      apiBaseUrl: "http://localhost:3000",
      dashboardUrl: "http://localhost:3000",
      detectPath: "/api/ext/detect",
      upbitApiBaseUrl: "https://api.upbit.com",
    },
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
        async sendMessage() {
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
  const backgroundPath = path.join(
    __dirname,
    "../chrome-extension/background.js",
  );
  vm.runInContext(fs.readFileSync(backgroundPath, "utf8"), context);

  return { context, localStore, sessionStore, runtimeListeners, alarms };
}

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
    'createQueryString([["states[]", "done"], ["limit", "100"]])',
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

  assert.equal(queryString, "states[]=done&limit=100");
  assert.equal(decodedHeader.alg, "HS512");
  assert.equal(decodedPayload.access_key, "access-key");
  assert.equal(decodedPayload.query_hash_alg, "SHA512");
  assert.equal(decodedPayload.query_hash.length, 128);
  assert.equal(signature, expectedSignature);
});

test("공개 API 응답을 시장 데이터 캐시에 저장한다", async () => {
  const { context, localStore } = createBackgroundHarness();
  const now = Date.now();
  const minute = 60_000;
  let fetchCount = 0;
  let marketDetailFetchCount = 0;
  const candles = Array.from({ length: 20 }, (_, index) => ({
    candle_date_time_utc: new Date(now - index * minute)
      .toISOString()
      .slice(0, 19),
    trade_price: index >= 15 ? 100 : 106,
    opening_price: 100,
    candle_acc_trade_volume: index === 1 ? 40 : 10,
  }));
  context.fetch = async (url) => {
    fetchCount += 1;
    let response;

    if (url.includes("/candles/")) {
      response = candles;
    } else if (url.includes("/ticker/all")) {
      response = [
        {
          market: "KRW-BTC",
          trade_price: 106,
          signed_change_rate: 0.1,
        },
        { market: "KRW-ETH", signed_change_rate: 0.2 },
        { market: "KRW-XRP", signed_change_rate: -0.15 },
      ];
    } else {
      marketDetailFetchCount += 1;
      response = [
        {
          market: "KRW-BTC",
          market_event: { warning: true, caution: {} },
        },
      ];
    }

    return {
      ok: true,
      async json() {
        return response;
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
  assert.deepEqual(
    JSON.parse(JSON.stringify(localStore.marketDataCache["KRW-BTC"])),
    JSON.parse(JSON.stringify(result)),
  );
  await vm.runInContext('collectMarketData("KRW-BTC")', context);
  assert.equal(fetchCount, 5);
  assert.equal(marketDetailFetchCount, 1);
});

test("주문 클릭 시 인증 주문을 조회하고 detect용 이력으로 변환한다", async () => {
  const { context } = createBackgroundHarness();
  await vm.runInContext(
    'encryptAndStoreCredentials("access-value", "secret-value", "password-123")',
    context,
  );
  context.fetch = async (url) => {
    let response;

    if (url.includes("/orders/closed")) {
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
});

test("1분 알람을 만들고 detect.md 형식으로 백엔드 판정을 요청한다", async () => {
  const { context, localStore, alarms } = createBackgroundHarness();
  localStore.auth = { accessToken: "backend-access-token" };
  localStore.orderDataCache = {
    "KRW-BTC": {
      clientAverageBuyAmount: 500_000,
      recentOrders: [],
    },
  };
  let capturedRequest = null;
  context.fetch = async (url, options) => {
    capturedRequest = { url, options };
    return {
      ok: true,
      async json() {
        return {
          detected: true,
          type: "ALL_IN_IMPULSE",
          message: "최대 금액 매수를 시도하고 있어요.",
        };
      },
    };
  };
  await vm.runInContext("ensureCollectionAlarm()", context);
  const result = await vm.runInContext(
    `callDetectionApi(
      1,
      {
        market: "KRW-BTC",
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
  const requestBody = JSON.parse(capturedRequest.options.body);

  assert.equal(alarms.get("saltbread-minute-collection").periodInMinutes, 1);
  assert.equal(
    capturedRequest.url,
    "http://localhost:3000/api/ext/detect",
  );
  assert.equal(
    capturedRequest.options.headers.Authorization,
    "Bearer backend-access-token",
  );
  assert.equal(requestBody.market, "KRW-BTC");
  assert.equal(requestBody.current_order.order_amount, 1_500_000);
  assert.equal(requestBody.behavior_data.client_avg_buy_amount, 500_000);
  assert.deepEqual(requestBody.recent_orders, []);
  assert.equal(result.type, "ALL_IN_IMPULSE");
  assert.equal(result.flameMode, "pink");
  assert.equal(localStore.flameTheme.mode, "pink");
  assert.equal(localStore.flameTheme.orderSide, "BUY");
});
