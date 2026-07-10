/* eslint-disable @typescript-eslint/no-require-imports */
const test = require("node:test");
const assert = require("node:assert/strict");
const cryptoModule = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function createStorageArea(store) {
  return {
    async get(keys) {
      if (typeof keys === "string") {
        return { [keys]: store[keys] };
      }

      if (Array.isArray(keys)) {
        return Object.fromEntries(keys.map((key) => [key, store[key]]));
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

function createHarness({ queryTabs } = {}) {
  const localStore = {};
  const sessionStore = {};
  const runtimeListeners = [];
  const alarmListeners = [];
  const createdTabs = [];
  const context = {
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
        async get() {
          return { periodInMinutes: 1 };
        },
        async create() {},
        onAlarm: {
          addListener(listener) {
            alarmListeners.push(listener);
          },
        },
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
        async query(options) {
          return queryTabs ? queryTabs(options) : [];
        },
        async sendMessage() {
          return null;
        },
        async create(details) {
          createdTabs.push(details);
          return { id: createdTabs.length, ...details };
        },
      },
    },
    crypto: cryptoModule.webcrypto,
    fetch: async () => {
      throw new Error("Unexpected fetch");
    },
    importScripts() {},
    SaltbreadCore: {
      calculateAverageBuyAmount() {
        return null;
      },
      calculateMarketData() {
        return {};
      },
      evaluateGuardrailRules() {
        return {
          detected: false,
          matchedRules: [],
          matchedRuleIds: [],
          primaryRule: null,
          primaryRuleId: null,
          visualMode: "DEFAULT",
        };
      },
      mapUpbitOrder(order) {
        return order;
      },
      resolveVisualMode() {
        return "DEFAULT";
      },
      toNumber(value) {
        const numeric = Number(value);
        return Number.isFinite(numeric) ? numeric : null;
      },
    },
    SALTBREAD_CONFIG: {
      appUrl: "https://example.com",
      appOrigins: ["https://example.com"],
      apiBaseUrl: "https://example.com",
      dashboardUrl: "https://example.com/dashboard",
      behaviorEventsPath: "/api/behavior/events",
      upbitApiBaseUrl: "https://api.upbit.com",
    },
    setTimeout(callback) {
      callback();
      return 0;
    },
    console,
  };
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(
    fs.readFileSync(path.join(__dirname, "../background.js"), "utf8"),
    context,
  );

  return { context, localStore, runtimeListeners, alarmListeners, createdTabs };
}

function sendMessage(runtimeListener, message, sender = {}) {
  return new Promise((resolve, reject) => {
    const keepsChannelOpen = runtimeListener(message, sender, resolve);

    if (!keepsChannelOpen) {
      reject(new Error("메시지 채널이 비동기 응답을 기다리지 않았습니다."));
    }
  });
}

test("저장 전 자산과 두 주문조회 API를 limit 1로 검증한다", async () => {
  const { context, localStore, runtimeListeners } = createHarness();
  const requestedUrls = [];
  context.fetch = async (url) => {
    requestedUrls.push(url);
    return {
      ok: true,
      async json() {
        return [];
      },
    };
  };

  const response = await sendMessage(runtimeListeners[0], {
    type: "SAVE_UPBIT_CREDENTIALS",
    payload: {
      accessKey: "access-key",
      secretKey: "secret-key",
      passphrase: "password-123",
    },
  });

  assert.equal(response.ok, true);
  assert.deepEqual(requestedUrls, [
    "https://api.upbit.com/v1/accounts",
    "https://api.upbit.com/v1/orders/open?limit=1",
    "https://api.upbit.com/v1/orders/closed?limit=1",
  ]);
  assert.ok(localStore.upbitCredentials.ciphertext);
  assert.equal(
    JSON.stringify(localStore.upbitCredentials).includes("secret-key"),
    false,
  );
});

test("검증 실패 시 기존 암호화 키를 보존한다", async () => {
  const { context, localStore, runtimeListeners } = createHarness();
  const existingCredentials = {
    version: 1,
    ciphertext: "existing-ciphertext",
  };
  localStore.upbitCredentials = existingCredentials;
  context.fetch = async () => ({
    ok: false,
    status: 401,
    async json() {
      return {
        error: {
          name: "out_of_scope",
          message: "권한이 없습니다.",
        },
      };
    },
  });

  const response = await sendMessage(runtimeListeners[0], {
    type: "SAVE_UPBIT_CREDENTIALS",
    payload: {
      accessKey: "new-access-key",
      secretKey: "new-secret-key",
      passphrase: "password-123",
    },
  });

  assert.equal(response.ok, false);
  assert.match(response.error, /자산조회와 주문조회 권한/);
  assert.deepEqual(localStore.upbitCredentials, existingCredentials);
});

test("등록되지 않은 IP 오류를 구분한다", async () => {
  const { context } = createHarness();
  context.fetch = async () => ({
    ok: false,
    status: 401,
    async json() {
      return {
        error: {
          name: "no_authorization_ip",
          message: "허용되지 않은 IP입니다.",
        },
      };
    },
  });

  await assert.rejects(
    vm.runInContext(
      'validateUpbitCredentials({ accessKey: "access", secretKey: "secret" })',
      context,
    ),
    /공인 IP가 업비트 API Key에 등록되어 있지 않습니다/,
  );
});

test("잘못된 Access Key 오류를 구분한다", async () => {
  const { context } = createHarness();
  context.fetch = async () => ({
    ok: false,
    status: 401,
    async json() {
      return {
        error: {
          name: "invalid_access_key",
          message: "잘못된 키입니다.",
        },
      };
    },
  });

  await assert.rejects(
    vm.runInContext(
      'validateUpbitCredentials({ accessKey: "access", secretKey: "secret" })',
      context,
    ),
    /Access Key 또는 Secret Key가 올바르지 않거나 만료되었습니다/,
  );
});

test("OPEN_DASHBOARD는 요청된 대시보드 하위 경로를 연다", async () => {
  const { runtimeListeners, createdTabs } = createHarness();

  const response = await sendMessage(runtimeListeners[0], {
    type: "OPEN_DASHBOARD",
    payload: { path: "/dashboard/my-page" },
  });

  assert.equal(response.ok, true);
  assert.deepEqual(JSON.parse(JSON.stringify(createdTabs)), [
    { url: "https://example.com/dashboard/my-page" },
  ]);
});

test("OPEN_DASHBOARD는 대시보드 밖 경로를 기본 대시보드로 되돌린다", async () => {
  const { runtimeListeners, createdTabs } = createHarness();

  const response = await sendMessage(runtimeListeners[0], {
    type: "OPEN_DASHBOARD",
    payload: { path: "https://evil.example/settings" },
  });

  assert.equal(response.ok, true);
  assert.deepEqual(JSON.parse(JSON.stringify(createdTabs)), [
    { url: "https://example.com/dashboard" },
  ]);
});

test("데모 활성 탭에서는 alarm snapshot refresh가 backend market snapshot을 호출하지 않는다", async () => {
  const requestedUrls = [];
  const { context, alarmListeners } = createHarness({
    queryTabs(options) {
      if (options.active) {
        return [{ id: 11, url: "https://example.com/demo?market=KRW-BTC" }];
      }
      return [];
    },
  });
  context.fetch = async (url) => {
    requestedUrls.push(url);
    return {
      ok: true,
      async json() {
        return { data: { market: "KRW-BTC", tradePrice: "1000" } };
      },
    };
  };

  alarmListeners[0]({ name: "saltbread-snapshot-refresh" });
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(
    requestedUrls.some((url) => String(url).includes("/api/market-snapshot")),
    false,
  );
});

test("ORDER_ACTION_DETECTED가 데모 pageUrl이면 snapshot refresh를 요청하지 않는다", async () => {
  const requestedUrls = [];
  const { context, runtimeListeners } = createHarness();
  context.fetch = async (url) => {
    requestedUrls.push(url);
    return {
      ok: true,
      async json() {
        return { data: { market: "KRW-BTC", tradePrice: "1000" } };
      },
    };
  };

  const response = await sendMessage(
    runtimeListeners[0],
    {
      type: "ORDER_ACTION_DETECTED",
      payload: {
        market: "KRW-BTC",
        pageUrl: "https://example.com/demo?market=KRW-BTC",
        currentOrder: {
          market: "KRW-BTC",
          order_side: "BUY",
          order_type: "LIMIT",
          order_price: "1000",
          order_volume: "1",
          order_amount: "1000",
          order_request_time: new Date().toISOString(),
        },
        behaviorData: {},
        orderContextSnapshot: {
          snapshotId: "snapshot-1",
          attemptId: "attempt-1",
          market: "KRW-BTC",
          side: "BUY",
          orderMode: "LIMIT",
        },
        demoData: {
          market: "KRW-BTC",
          marketData: { market: "KRW-BTC", currentPrice: 1000 },
        },
      },
    },
    { tab: { id: 7, url: "https://example.com/demo?market=KRW-BTC" } },
  );

  assert.equal(response.ok, true);
  assert.equal(
    requestedUrls.some((url) => String(url).includes("/api/market-snapshot")),
    false,
  );
});

test("mixed market closedOrders는 현재 market 주문만 수집하고 confirmed logs에 남긴다", async () => {
  const requestedUrls = [];
  const { context } = createHarness();
  const now = new Date().toISOString();
  const closedBtc = {
    uuid: "closed-btc",
    market: "KRW-BTC",
    side: "bid",
    ord_type: "limit",
    price: "1000",
    volume: "1",
    executed_volume: "1",
    executed_funds: "1000",
    paid_fee: "0",
    remaining_volume: "0",
    state: "done",
    created_at: now,
  };
  const closedEth = {
    ...closedBtc,
    uuid: "closed-eth",
    market: "KRW-ETH",
    price: "2000",
    executed_funds: "2000",
  };
  const openBtc = {
    ...closedBtc,
    uuid: "open-btc",
    state: "wait",
    created_at: new Date(Date.now() - 60_000).toISOString(),
  };

  vm.runInContext(
    'decryptCredentials = async () => ({ accessKey: "access", secretKey: "secret" })',
    context,
  );
  context.fetch = async (url) => {
    requestedUrls.push(url);
    if (String(url).includes("/v1/orders/closed")) {
      return {
        ok: true,
        async json() {
          return [closedEth, closedBtc];
        },
      };
    }
    if (String(url).includes("/v1/orders/open")) {
      return {
        ok: true,
        async json() {
          return [openBtc];
        },
      };
    }
    return {
      ok: true,
      async json() {
        return [{ currency: "BTC", avg_buy_price: "1000" }];
      },
    };
  };

  const collected = await vm.runInContext(
    'collectOrderData("KRW-BTC")',
    context,
  );
  context.rawOpen = [openBtc];
  context.rawClosed = [closedEth, closedBtc];
  const confirmedLogs = vm.runInContext(
    'toConfirmedTradeLogs({ market: "KRW-BTC", rawOpenOrders: rawOpen, rawClosedOrders: rawClosed }, "attempt-1")',
    context,
  );

  assert.match(
    requestedUrls.find((url) => String(url).includes("/v1/orders/closed")),
    /market=KRW-BTC.*limit=100.*order_by=desc/,
  );
  assert.deepEqual(
    Array.from(collected.rawClosedOrders, (order) => order.uuid),
    ["closed-btc"],
  );
  assert.deepEqual(
    Array.from(collected.recentOrders, (order) => order.market),
    ["KRW-BTC", "KRW-BTC"],
  );
  assert.deepEqual(
    Array.from(confirmedLogs, (log) => log.upbitOrderUuid).sort(),
    ["closed-btc", "open-btc"],
  );
});
