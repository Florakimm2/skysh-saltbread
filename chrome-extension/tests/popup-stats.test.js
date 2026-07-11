/* eslint-disable @typescript-eslint/no-require-imports */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function createElement(id = "") {
  const attributes = new Map();
  const eventListeners = new Map();

  return {
    id,
    hidden: false,
    disabled: false,
    href: "",
    clickCount: 0,
    textContent: "",
    dataset: {},
    elements: {
      passphrase: { value: "" },
    },
    classList: {
      toggle() {},
      add() {},
      remove() {},
    },
    addEventListener(type, listener) {
      eventListeners.set(type, listener);
    },
    dispatchEvent(type, event) {
      eventListeners.get(type)?.(event);
    },
    click() {
      this.clickCount += 1;
      eventListeners.get("click")?.({
        stopPropagation() {},
      });
    },
    setAttribute(name, value) {
      attributes.set(name, String(value));
    },
    getAttribute(name) {
      return attributes.get(name) || null;
    },
    reset() {},
  };
}

async function createPopupHarness(statsResponse) {
  const elementIds = [
    "loading-view",
    "signed-out-view",
    "account-view",
    "open-login-button",
    "open-signup-button",
    "login-message",
    "account-greeting",
    "open-onboarding-button",
    "statistics-summary",
    "account-message",
    "logout-button",
    "api-key-toggle",
    "api-key-details",
    "api-key-form",
    "api-key-status",
    "api-key-message",
    "save-api-key-button",
    "api-guide-link",
    "unlock-api-key-button",
    "delete-api-key-button",
  ];
  const elements = Object.fromEntries(
    elementIds.map((id) => [id, createElement(id)]),
  );
  const sentMessages = [];
  const context = {
    document: {
      documentElement: { dataset: {} },
      querySelector(selector) {
        return elements[selector.replace(/^#/, "")] || null;
      },
    },
    chrome: {
      runtime: {
        sendMessage(message) {
          sentMessages.push(message);

          if (message.type === "GET_AUTH_STATE") {
            return Promise.resolve({
              ok: true,
              auth: {
                accessToken: "access-token",
                user: {
                  name: "불씨",
                  personalDataConsentAgreed: true,
                  onboardingCompleted: true,
                },
              },
            });
          }

          if (message.type === "GET_USER_STATS") {
            return Promise.resolve(statsResponse);
          }

          if (message.type === "GET_UPBIT_CREDENTIAL_STATUS") {
            return Promise.resolve({
              ok: true,
              status: { configured: false, unlocked: false },
            });
          }

          return Promise.resolve({ ok: true });
        },
      },
      storage: {
        onChanged: {
          addListener() {},
        },
      },
    },
    FormData: class FormData {
      get() {
        return "";
      }
    },
    window: {
      close() {},
    },
    console,
  };
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(
    fs.readFileSync(path.join(__dirname, "../popup.js"), "utf8"),
    context,
  );
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));

  return { elements, sentMessages };
}

test("popup stats 성공 시 API data 문자열을 그대로 표시한다", async () => {
  const { elements, sentMessages } = await createPopupHarness({
    ok: true,
    data: "불씨와 함께 3개의 기록을 쌓고 1개의 감정 매도를 막았어요!",
  });

  assert.equal(
    elements["statistics-summary"].textContent,
    "불씨와 함께 3개의 기록을 쌓고 1개의 감정 매도를 막았어요!",
  );
  assert.ok(sentMessages.some((message) => message.type === "GET_USER_STATS"));
});

test("popup stats 실패 시 fallback 문구를 표시한다", async () => {
  const { elements } = await createPopupHarness({
    ok: false,
    error: "server error",
  });

  assert.equal(
    elements["statistics-summary"].textContent,
    "불씨 기록을 불러오지 못했어요.",
  );
});

test("popup stats 인증 오류 시 로그인 필요 문구를 표시한다", async () => {
  const { elements } = await createPopupHarness({
    ok: false,
    authRequired: true,
    error: "unauthorized",
  });

  assert.equal(
    elements["statistics-summary"].textContent,
    "로그인하면 불씨 기록을 확인할 수 있어요.",
  );
});

test("업비트 API 가이드 링크는 외부 가이드 URL을 사용하고 클릭 전파를 막는다", async () => {
  const { elements } = await createPopupHarness({
    ok: true,
    data: "통계 메시지",
  });
  let propagationStopped = false;
  let defaultPrevented = false;

  assert.equal(
    elements["api-guide-link"].href,
    "https://glistening-theater-371.notion.site/API-399634ca4bdf80879c7fdcd41c4ba099?source=copy_link",
  );

  elements["api-guide-link"].dispatchEvent("click", {
    stopPropagation() {
      propagationStopped = true;
    },
  });

  assert.equal(propagationStopped, true);

  elements["api-guide-link"].dispatchEvent("keydown", {
    key: " ",
    preventDefault() {
      defaultPrevented = true;
    },
    stopPropagation() {
      propagationStopped = true;
    },
  });

  assert.equal(defaultPrevented, true);
  assert.equal(elements["api-guide-link"].clickCount, 1);
});
