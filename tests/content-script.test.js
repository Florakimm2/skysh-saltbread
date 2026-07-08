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

      return { ...store };
    },
    async set(values) {
      Object.assign(store, values);
    },
  };
}

function createContentHarness(options = {}) {
  const localStore = {};
  const debugEvents = [];
  const documentListeners = {};
  const runtimeListeners = [];
  const sentRuntimeMessages = [];
  const createdElements = [];
  function createElementStub() {
    const element = {
      dataset: {},
      classList: {
        add() {},
        remove() {},
        toggle() {},
      },
      style: { setProperty() {} },
      children: [],
      innerHTML: "",
      textContent: "",
      append(child) {
        this.children.push(child);
      },
      remove() {},
      setAttribute(name, value) {
        this[name] = value;
      },
      querySelector() {
        return {
          addEventListener() {},
          setAttribute() {},
          textContent: "",
          dataset: {},
        };
      },
      querySelectorAll() {
        return [];
      },
    };
    createdElements.push(element);
    return element;
  }
  const documentElementAttributes = {};
  const context = {
    SaltbreadCore,
    SALTBREAD_CONFIG: {
      appUrl: "http://localhost:3000",
      appOrigins: ["http://localhost:3000"],
    },
    chrome: {
      runtime: {
        onMessage: {
          addListener(listener) {
            runtimeListeners.push(listener);
          },
        },
        async sendMessage(message) {
          sentRuntimeMessages.push(message);
          if (message.type === "LOAD_GUARDRAIL_RULES") {
            return {
              ok: true,
              guardrailRules:
                options.guardrailRulesState || {
                  rules: [],
                  source: "network",
                  fetchedAt: "2026-07-08T00:00:00.000Z",
                },
            };
          }
          return { ok: true };
        },
      },
      storage: {
        local: createStorageArea(localStore),
        onChanged: { addListener() {} },
      },
    },
    console,
    crypto: {
      randomUUID: cryptoModule.randomUUID,
      getRandomValues: cryptoModule.webcrypto.getRandomValues.bind(
        cryptoModule.webcrypto,
      ),
    },
    CustomEvent: class CustomEvent {
      constructor(type, init = {}) {
        this.type = type;
        this.detail = init.detail;
      }
    },
    document: {
      hidden: false,
      documentElement: {
        setAttribute(name, value) {
          documentElementAttributes[name] = value;
        },
        getAttribute(name) {
          return documentElementAttributes[name] || null;
        },
        removeAttribute(name) {
          delete documentElementAttributes[name];
        },
      },
      body: { append() {} },
      createElement: createElementStub,
      addEventListener(type, listener) {
        documentListeners[type] ||= [];
        documentListeners[type].push(listener);
      },
      removeEventListener() {},
      dispatchEvent(event) {
        if (event.type === "saltbread:extension-debug") {
          debugEvents.push(event.detail);
        }
      },
      getElementById() {
        return null;
      },
      querySelector() {
        return null;
      },
      querySelectorAll() {
        return [];
      },
    },
    Element: class Element {},
    HTMLElement: class HTMLElement {},
    HTMLInputElement: class HTMLInputElement {},
    location: {
      href: "https://upbit.com/exchange?code=CRIX.UPBIT.KRW-BTC",
      origin: "https://upbit.com",
      pathname: "/exchange",
    },
    matchMedia() {
      return { matches: false };
    },
    requestAnimationFrame() {
      return 0;
    },
    clearInterval() {},
    clearTimeout() {},
    setInterval() {
      return 0;
    },
    setTimeout() {
      return 0;
    },
  };
  context.globalThis = context;
  context.window = context;
  vm.createContext(context);
  vm.runInContext(
    fs.readFileSync(
      path.join(__dirname, "../chrome-extension/content.js"),
      "utf8",
    ),
    context,
  );

  return {
    context,
    createdElements,
    debugEvents,
    runtimeListeners,
    sentRuntimeMessages,
  };
}

test("ORDER_INTENT_CLICK 스냅샷은 가격 입력이 없어도 즉시 수집된다", () => {
  const { context, debugEvents, sentRuntimeMessages } = createContentHarness();

  assert.doesNotThrow(() => {
    vm.runInContext("startBehaviorTracking(); beginOrderAttempt(null);", context);
  });

  assert.equal(debugEvents.length, 1);
  assert.equal(debugEvents[0].kind, "ORDER_INTENT_CLICK");
  assert.equal(debugEvents[0].payload.snapshotTrigger, "ORDER_INTENT_CLICK");
  assert.equal(debugEvents[0].payload.market, "KRW-BTC");
  assert.ok(debugEvents[0].payload.attemptId);
  assert.equal(
    sentRuntimeMessages.some(
      (message) => message.type === "REGISTER_MARKET_CONTEXT",
    ),
    true,
  );
});

test("사용자 규칙은 페이지 세션에서 한 번만 불러온다", async () => {
  const { context, sentRuntimeMessages } = createContentHarness({
    guardrailRulesState: {
      source: "network",
      fetchedAt: "2026-07-08T00:00:00.000Z",
      rules: [
        {
          ruleId: "intent-warning",
          isEnabled: true,
          expression: {
            nodeType: "CONDITION",
            leftField: "snapshotTrigger",
            operator: "EQ",
            rightOperand: {
              operandType: "LITERAL",
              value: "ORDER_INTENT_CLICK",
            },
          },
        },
      ],
    },
  });

  await vm.runInContext(
    "Promise.all([loadPageGuardrailRules(), loadPageGuardrailRules()])",
    context,
  );

  assert.equal(
    sentRuntimeMessages.filter(
      (message) => message.type === "LOAD_GUARDRAIL_RULES",
    ).length,
    1,
  );
});

test("ORDER_INTENT_CLICK은 로컬 규칙으로 즉시 경고 상태를 만든다", () => {
  const { context, debugEvents } = createContentHarness();

  vm.runInContext(
    `setPageGuardrailRulesState({
      source: "network",
      fetchedAt: "2026-07-08T00:00:00.000Z",
      rules: [{
        ruleId: "intent-warning",
        isEnabled: true,
        priority: 1,
        riskLevel: "MEDIUM",
        visualMode: "CURIOUS",
        warningTitle: "주문 의도 확인",
        warningMessage: "주문 버튼 클릭을 한 번 더 확인합니다.",
        expression: {
          nodeType: "CONDITION",
          leftField: "snapshotTrigger",
          operator: "EQ",
          rightOperand: {
            operandType: "LITERAL",
            value: "ORDER_INTENT_CLICK"
          }
        }
      }]
    });
    startBehaviorTracking();
    beginOrderAttempt(null);`,
    context,
  );

  assert.equal(debugEvents.length, 1);
  assert.equal(debugEvents[0].kind, "ORDER_INTENT_CLICK");
  assert.deepEqual(
    JSON.parse(JSON.stringify(debugEvents[0].payload.shownRuleIds)),
    ["intent-warning"],
  );
  assert.equal(
    vm.runInContext("activeDetectionResult.primaryRuleId", context),
    "intent-warning",
  );
});

test("닫은 ORDER_INTENT_CLICK 경고는 background 결과가 늦게 와도 다시 열리지 않는다", () => {
  const { context, debugEvents, runtimeListeners } = createContentHarness();

  vm.runInContext(
    `setPageGuardrailRulesState({
      source: "network",
      fetchedAt: "2026-07-08T00:00:00.000Z",
      rules: [{
        ruleId: "intent-warning",
        isEnabled: true,
        priority: 1,
        riskLevel: "MEDIUM",
        visualMode: "CURIOUS",
        warningTitle: "주문 의도 확인",
        warningMessage: "주문 버튼 클릭을 한 번 더 확인합니다.",
        expression: {
          nodeType: "CONDITION",
          leftField: "snapshotTrigger",
          operator: "EQ",
          rightOperand: {
            operandType: "LITERAL",
            value: "ORDER_INTENT_CLICK"
          }
        }
      }]
    });
    startBehaviorTracking();
    beginOrderAttempt(null);`,
    context,
  );

  const snapshot = debugEvents[0].payload;
  assert.equal(
    vm.runInContext("activeDetectionResult.primaryRuleId", context),
    "intent-warning",
  );

  vm.runInContext('closeGuardrail("PROCEED")', context);
  assert.equal(vm.runInContext("activeDetectionResult", context), null);

  runtimeListeners[0](
    {
      type: "DETECTION_RESULT",
      payload: {
        detected: true,
        type: "USER_GUARDRAIL_RULE",
        message: "주문 버튼 클릭을 한 번 더 확인합니다.",
        warningTitle: "주문 의도 확인",
        matchedRuleIds: ["intent-warning"],
        primaryRuleId: "intent-warning",
        visualMode: "CURIOUS",
        flameMode: "CURIOUS",
        orderContextSnapshot: snapshot,
      },
    },
    {},
    () => {},
  );

  assert.equal(vm.runInContext("activeDetectionResult", context), null);
  assert.equal(
    debugEvents.filter((event) => event.kind === "ORDER_INTENT_CLICK").length,
    1,
  );
});
