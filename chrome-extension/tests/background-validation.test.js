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

function createHarness() {
  const localStore = {};
  const sessionStore = {};
  const runtimeListeners = [];
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
    SaltbreadCore: {
      calculateAverageBuyAmount() {
        return null;
      },
      calculateMarketData() {
        return {};
      },
      mapUpbitOrder(order) {
        return order;
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

  return { context, localStore, runtimeListeners };
}

function sendMessage(runtimeListener, message) {
  return new Promise((resolve, reject) => {
    const keepsChannelOpen = runtimeListener(message, {}, resolve);

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
