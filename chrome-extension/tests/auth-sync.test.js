/* eslint-disable @typescript-eslint/no-require-imports */
const test = require("node:test");
const assert = require("node:assert/strict");
const cryptoModule = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const EXTENSION_ID = "a".repeat(32);
const extensionDirectory = path.join(__dirname, "..");

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
  const cookieStore = new Map();
  const runtimeListeners = [];
  const externalListeners = [];
  const cookieListeners = [];
  const createdTabs = [];
  const updatedTabs = [];

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
      cookies: {
        async get({ url, name }) {
          return cookieStore.get(`${new URL(url).origin}:${name}`) || null;
        },
        async set(details) {
          const cookie = {
            ...details,
            domain: new URL(details.url).hostname,
          };
          cookieStore.set(
            `${new URL(details.url).origin}:${details.name}`,
            cookie,
          );
          return cookie;
        },
        async remove({ url, name }) {
          const key = `${new URL(url).origin}:${name}`;
          const existing = cookieStore.get(key);
          cookieStore.delete(key);
          return existing || null;
        },
        onChanged: {
          addListener(listener) {
            cookieListeners.push(listener);
          },
        },
      },
      runtime: {
        id: EXTENSION_ID,
        onInstalled: { addListener() {} },
        onStartup: { addListener() {} },
        onMessage: {
          addListener(listener) {
            runtimeListeners.push(listener);
          },
        },
        onMessageExternal: {
          addListener(listener) {
            externalListeners.push(listener);
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
        async update(tabId, details) {
          updatedTabs.push({ tabId, ...details });
          return { id: tabId, ...details };
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

  return {
    context,
    localStore,
    sessionStore,
    cookieStore,
    runtimeListener: runtimeListeners[0],
    externalListener: externalListeners[0],
    cookieListener: cookieListeners[0],
    createdTabs,
    updatedTabs,
  };
}

function sendMessage(listener, message, sender = {}) {
  return new Promise((resolve, reject) => {
    const keepsChannelOpen = listener(message, sender, resolve);
    if (!keepsChannelOpen) {
      reject(new Error("메시지 채널이 비동기 응답을 기다리지 않았습니다."));
    }
  });
}

function jsonResponse(data, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      return data;
    },
  };
}

test("로그인은 활성 앱 탭의 실제 개발 포트 origin을 우선 사용한다", async () => {
  const harness = createHarness({
    queryTabs(options) {
      if (options.active) {
        return [{ id: 7, url: "http://127.0.0.1:3001/dashboard" }];
      }
      return [{ id: 8, url: "https://example.com/dashboard", lastAccessed: 9 }];
    },
  });

  const response = await sendMessage(harness.runtimeListener, {
    type: "OPEN_AUTH",
    payload: { mode: "login" },
  });

  assert.equal(response.ok, true);
  const opened = new URL(harness.createdTabs[0].url);
  assert.equal(opened.origin, "http://127.0.0.1:3001");
  assert.equal(opened.pathname, "/login");
  assert.equal(opened.searchParams.get("extensionId"), EXTENSION_ID);
});

test("manifest는 외부 연결과 로컬 앱 쿠키 접근을 허용한다", () => {
  const manifest = JSON.parse(
    fs.readFileSync(path.join(extensionDirectory, "manifest.json"), "utf8"),
  );

  assert.ok(manifest.permissions.includes("cookies"));
  assert.ok(
    manifest.externally_connectable.matches.includes(
      "http://localhost/*",
    ),
  );
  assert.ok(
    manifest.externally_connectable.matches.includes(
      "http://127.0.0.1/*",
    ),
  );
  assert.ok(manifest.host_permissions.includes("http://localhost/*"));
  assert.ok(manifest.host_permissions.includes("http://127.0.0.1/*"));
});

test("활성 앱 탭이 없으면 가장 최근 앱 탭 origin을 사용한다", async () => {
  const harness = createHarness({
    queryTabs(options) {
      if (options.active) return [{ id: 1, url: "https://upbit.com/exchange" }];
      return [
        { id: 2, url: "https://example.com/dashboard", lastAccessed: 10 },
        { id: 3, url: "http://localhost:3000/login", lastAccessed: 20 },
      ];
    },
  });

  await sendMessage(harness.runtimeListener, {
    type: "OPEN_AUTH",
    payload: { mode: "signup" },
  });

  const opened = new URL(harness.createdTabs[0].url);
  assert.equal(opened.origin, "http://localhost:3000");
  assert.equal(opened.pathname, "/signup");
});

test("허용된 sender의 handoff는 쿠키를 교환하고 origin과 인증을 저장한다", async () => {
  const harness = createHarness();
  harness.cookieStore.set("http://localhost:3001:refreshToken", {
    name: "refreshToken",
    value: "old-refresh",
    domain: "localhost",
  });
  harness.context.fetch = async (url, options) => {
    assert.equal(url, "http://localhost:3001/api/auth/extension/refresh");
    assert.equal(JSON.parse(options.body).refreshToken, "old-refresh");
    return jsonResponse({
      accessToken: "access-token",
      refreshToken: "rotated-refresh",
      expiresIn: 3600,
      user: { id: "user-1", email: "user@example.com", name: "불씨" },
    });
  };

  const response = await sendMessage(
    harness.externalListener,
    {
      type: "AUTH_HANDOFF",
      payload: { appOrigin: "http://localhost:3001" },
    },
    { url: "http://localhost:3001/extension/connect" },
  );

  assert.equal(response.ok, true);
  assert.equal(harness.localStore.auth.appOrigin, "http://localhost:3001");
  assert.equal(harness.localStore.auth.accessToken, "access-token");
  assert.equal(
    harness.cookieStore.get("http://localhost:3001:refreshToken").value,
    "rotated-refresh",
  );
});

test("handoff sender origin과 요청 origin이 다르면 거부한다", async () => {
  const harness = createHarness();
  const response = await sendMessage(
    harness.externalListener,
    {
      type: "AUTH_HANDOFF",
      payload: { appOrigin: "https://example.com" },
    },
    { url: "http://localhost:3000/extension/connect" },
  );

  assert.equal(response.ok, false);
  assert.match(response.error, /허용되지 않은 앱 주소/);
});

test("만료된 토큰은 저장된 appOrigin의 쿠키로 갱신한다", async () => {
  const harness = createHarness();
  harness.localStore.auth = {
    accessToken: "expired",
    expiresAt: 0,
    user: { id: "user-1" },
    appOrigin: "https://example.com",
  };
  harness.cookieStore.set("https://example.com:refreshToken", {
    name: "refreshToken",
    value: "refresh-token",
    domain: "example.com",
  });
  harness.context.fetch = async (url) => {
    if (url === "https://example.com/api/me/profile") {
      return jsonResponse({
        data: {
          email: "user@example.com",
          displayName: "불씨",
          personalDataConsentAgreed: true,
          personalDataConsentAgreedAt: "2026-07-08T00:00:00.000Z",
          personalDataConsentVersion: "v1",
          onboardingCompleted: true,
          onboardingCompletedAt: "2026-07-08T00:00:00.000Z",
        },
      });
    }

    assert.equal(url, "https://example.com/api/auth/extension/refresh");
    return jsonResponse({
      accessToken: "fresh-access",
      refreshToken: "fresh-refresh",
      expiresIn: 3600,
      user: { id: "user-1", email: "user@example.com", name: "불씨" },
    });
  };

  const response = await sendMessage(harness.runtimeListener, {
    type: "GET_AUTH_STATE",
  });

  assert.equal(response.ok, true);
  assert.equal(response.auth.accessToken, "fresh-access");
  assert.equal(response.auth.appOrigin, "https://example.com");
});

test("행동 로그는 인증에 저장된 appOrigin으로 전송한다", async () => {
  const harness = createHarness();
  const requestedUrls = [];
  harness.context.fetch = async (url) => {
    requestedUrls.push(url);
    return jsonResponse({ ok: true });
  };

  await vm.runInContext(
    `postBehaviorEvent(
      { eventType: "BUY_CLICK" },
      {
        accessToken: "token",
        user: { id: "user-1" },
        appOrigin: "http://127.0.0.1:3000"
      }
    )`,
    harness.context,
  );

  assert.deepEqual(requestedUrls, [
    "http://127.0.0.1:3000/api/behavior/events",
  ]);
});

test("통계 API는 저장된 accessToken과 appOrigin으로 호출한다", async () => {
  const harness = createHarness();
  harness.localStore.auth = {
    accessToken: "stats-token",
    expiresAt: Date.now() + 120000,
    user: { id: "user-1" },
    appOrigin: "http://localhost:3000",
  };
  const requested = [];
  harness.context.fetch = async (url, options) => {
    requested.push({ url, options });
    return jsonResponse({
      ok: true,
      data: "불씨와 함께 7개의 기록을 쌓고 2개의 감정 매도를 막았어요!",
    });
  };

  const response = await sendMessage(harness.runtimeListener, {
    type: "GET_USER_STATS",
  });

  assert.equal(response.ok, true);
  assert.equal(
    response.data,
    "불씨와 함께 7개의 기록을 쌓고 2개의 감정 매도를 막았어요!",
  );
  assert.equal(requested[0].url, "http://localhost:3000/api/me/stats");
  assert.equal(
    requested[0].options.headers.Authorization,
    "Bearer stats-token",
  );
});

test("통계 API는 accessToken이 없으면 로그인 필요로 응답한다", async () => {
  const harness = createHarness();

  const response = await sendMessage(harness.runtimeListener, {
    type: "GET_USER_STATS",
  });

  assert.equal(response.ok, false);
  assert.equal(response.authRequired, true);
});

test("확장 로그아웃은 인증·Upbit 키·복호화 키를 지우고 웹 탭을 이동한다", async () => {
  const harness = createHarness({
    queryTabs(options) {
      if (options.active) return [];
      return [
        { id: 4, url: "http://localhost:3000/dashboard", lastAccessed: 20 },
      ];
    },
  });
  harness.localStore.auth = {
    accessToken: "access-token",
    expiresAt: Date.now() + 10000,
    user: { id: "user-1" },
    appOrigin: "http://localhost:3000",
  };
  harness.localStore.upbitCredentials = { ciphertext: "encrypted" };
  harness.sessionStore.upbitCredentialSessionKey = "local-key";
  harness.cookieStore.set("http://localhost:3000:refreshToken", {
    name: "refreshToken",
    value: "refresh-token",
    domain: "localhost",
  });
  harness.context.fetch = async (url, options) => {
    assert.equal(url, "http://localhost:3000/api/auth/logout");
    assert.equal(options.headers.Authorization, "Bearer access-token");
    return jsonResponse({ message: "로그아웃되었습니다." });
  };

  const response = await sendMessage(harness.runtimeListener, {
    type: "LOGOUT_EVERYWHERE",
  });

  assert.equal(response.ok, true);
  assert.equal(harness.localStore.auth, undefined);
  assert.equal(harness.localStore.upbitCredentials, undefined);
  assert.equal(harness.sessionStore.upbitCredentialSessionKey, undefined);
  assert.equal(
    harness.cookieStore.has("http://localhost:3000:refreshToken"),
    false,
  );
  assert.deepEqual(harness.updatedTabs, [
    { tabId: 4, url: "http://localhost:3000/login" },
  ]);
});

test("웹에서 refresh cookie가 삭제되면 확장 로컬 정보도 모두 정리한다", async () => {
  const harness = createHarness();
  harness.localStore.auth = {
    accessToken: "access-token",
    user: { id: "user-1" },
    appOrigin: "https://example.com",
  };
  harness.localStore.upbitCredentials = { ciphertext: "encrypted" };
  harness.sessionStore.upbitCredentialSessionKey = "local-key";

  harness.cookieListener({
    removed: true,
    cause: "explicit",
    cookie: {
      name: "refreshToken",
      domain: "example.com",
    },
  });
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(harness.localStore.auth, undefined);
  assert.equal(harness.localStore.upbitCredentials, undefined);
  assert.equal(harness.sessionStore.upbitCredentialSessionKey, undefined);
});
