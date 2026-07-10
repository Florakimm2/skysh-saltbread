/* eslint-disable @typescript-eslint/no-require-imports */
const test = require("node:test");
const assert = require("node:assert/strict");
const cryptoModule = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function createContentHarness() {
  const runtimeListeners = [];
  const storageListeners = [];
  const locationUrl = new URL("https://example.com/demo?market=KRW-BTC");
  function createNode() {
    return {
      dataset: {},
      style: {},
      hidden: false,
      inert: false,
      textContent: "",
      className: "",
      classList: { add() {}, remove() {}, toggle() {} },
      setAttribute() {},
      getAttribute() {
        return null;
      },
      append() {},
      appendChild() {},
      replaceChildren() {},
      addEventListener() {},
      querySelector() {
        return createNode();
      },
      remove() {},
    };
  }
  const panel = createNode();
  const status = createNode();
  const badgeElement = createNode();
  const titleElement = createNode();
  const messageElement = createNode();
  status.querySelector = (selector) => {
    if (selector === "[data-status-badge]") return badgeElement;
    if (selector === "[data-status-title]") return titleElement;
    if (selector === "[data-status-message]") return messageElement;
    return null;
  };
  panel.querySelector = () => createNode();
  const documentStub = {
    hidden: false,
    documentElement: {
      setAttribute() {},
    },
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent() {},
    getElementById(id) {
      return id === "saltbread-extension-panel" ? panel : null;
    },
    querySelector(selector) {
      if (selector === ".saltbread-analysis-status") {
        return status;
      }
      return null;
    },
    createElement() {
      return createNode();
    },
    createTextNode(text) {
      return { textContent: text };
    },
  };
  const context = {
    TextDecoder,
    TextEncoder,
    URL,
    CustomEvent: class CustomEvent {
      constructor(type, init = {}) {
        this.type = type;
        this.detail = init.detail;
      }
    },
    Element: class Element {},
    Node: class Node {},
    chrome: {
      runtime: {
        onMessage: {
          addListener(listener) {
            runtimeListeners.push(listener);
          },
        },
        sendMessage() {
          return Promise.resolve({ ok: false });
        },
      },
      storage: {
        local: {
          get() {
            return Promise.resolve({});
          },
        },
        onChanged: {
          addListener(listener) {
            storageListeners.push(listener);
          },
        },
      },
    },
    crypto: cryptoModule.webcrypto,
    document: documentStub,
    location: locationUrl,
    SaltbreadCore: {
      buildBehaviorSnapshot() {
        return {};
      },
      detectOrderActionSide() {
        return null;
      },
      evaluateGuardrailRules() {
        return { detected: false, matchedRuleIds: [], primaryRuleId: null };
      },
      evaluateRuleExpression() {
        return false;
      },
      parseMarket() {
        return "KRW-BTC";
      },
      resolveVisualMode(mode) {
        return typeof mode === "string" ? mode : "DEFAULT";
      },
      RULE_FIELD_CATALOG: {},
      toNumber(value) {
        const numeric = Number(value);
        return Number.isFinite(numeric) ? numeric : null;
      },
    },
    SALTBREAD_CONFIG: {
      appUrl: "https://example.com",
      appOrigins: ["https://example.com"],
    },
    console,
    setInterval() {
      return 1;
    },
    clearInterval() {},
    setTimeout() {
      return 1;
    },
    clearTimeout() {},
  };
  context.window = context;
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(
    fs.readFileSync(path.join(__dirname, "../content.js"), "utf8"),
    context,
  );

  return {
    context,
    runtimeListener: runtimeListeners[0],
    storageListeners,
    panel,
    status,
    titleElement,
    messageElement,
  };
}

function sendRuntimeMessage(listener, message) {
  return listener(message, {}, () => {});
}

function detectedResult(attemptId, snapshotId, visualMode = "DEFAULT") {
  return {
    type: "DETECTION_RESULT",
    payload: {
      detected: true,
      type: "USER_GUARDRAIL_RULE",
      message: "guardrail",
      visualMode,
      flameMode: visualMode,
      orderContextSnapshot: {
        attemptId,
        snapshotId,
        market: "KRW-BTC",
      },
    },
  };
}

test("settled attemptId의 DETECTION_RESULT는 현재 UI를 갱신하지 않는다", () => {
  const { context, runtimeListener } = createContentHarness();
  vm.runInContext(
    `pendingAttempt = {
      attemptId: "attempt-settled",
      snapshot: { attemptId: "attempt-settled", snapshotId: "snapshot-settled", market: "KRW-BTC" },
      snapshotEmitted: true,
      feedbackShownAt: null,
      feedbackRespondedAt: null,
    };
    showTradeFeedback();`,
    context,
  );

  assert.equal(
    vm.runInContext('settledAttemptIds.has("attempt-settled")', context),
    true,
  );

  sendRuntimeMessage(
    runtimeListener,
    detectedResult("attempt-settled", "snapshot-settled"),
  );

  assert.equal(vm.runInContext("activeDetectionResult", context), null);
});

test("현재 pendingAttempt와 다른 늦은 DETECTION_RESULT는 UI를 덮지 않는다", () => {
  const { context, runtimeListener } = createContentHarness();
  vm.runInContext(
    `pendingAttempt = {
      attemptId: "attempt-current",
      snapshot: { attemptId: "attempt-current", snapshotId: "snapshot-current", market: "KRW-BTC" },
      snapshotEmitted: true,
      feedbackShownAt: null,
      feedbackRespondedAt: null,
    };`,
    context,
  );

  sendRuntimeMessage(
    runtimeListener,
    detectedResult("attempt-old", "snapshot-old"),
  );

  assert.equal(vm.runInContext("activeDetectionResult", context), null);
});

test("피드백 완료 후 같은 attempt의 늦은 DETECTION_RESULT는 SURPRISED로 되돌리지 않는다", () => {
  const { context, runtimeListener, panel, status } = createContentHarness();
  vm.runInContext(
    `pendingAttempt = {
      attemptId: "attempt-a",
      snapshot: { attemptId: "attempt-a", snapshotId: "snapshot-a", market: "KRW-BTC" },
      snapshotEmitted: true,
      feedbackShownAt: null,
      feedbackRespondedAt: null,
    };`,
    context,
  );

  sendRuntimeMessage(
    runtimeListener,
    detectedResult("attempt-a", "snapshot-a", "SURPRISED"),
  );
  assert.equal(panel.dataset.flameMode, "surprised");
  assert.equal(status.dataset.state, "detected");

  vm.runInContext(
    "closeGuardrail('PROCEED'); showTradeFeedback(); answerTradeFeedback('PLANNED');",
    context,
  );
  assert.equal(panel.dataset.flameMode, "default");

  sendRuntimeMessage(
    runtimeListener,
    detectedResult("attempt-a", "snapshot-a-late", "SURPRISED"),
  );

  assert.equal(panel.dataset.flameMode, "default");
  assert.notEqual(status.dataset.state, "detected");
});

test("피드백 완료 후 늦은 ORDER_CONTEXT_WITH_SNAPSHOTS/local ruleEvaluation은 경고를 되살리지 않는다", () => {
  const { context, panel, status } = createContentHarness();
  vm.runInContext(
    `pendingAttempt = {
      attemptId: "attempt-a",
      snapshot: { attemptId: "attempt-a", snapshotId: "snapshot-a", market: "KRW-BTC" },
      snapshotEmitted: true,
      feedbackShownAt: null,
      feedbackRespondedAt: null,
    };
    showTradeFeedback();
    answerTradeFeedback('PLANNED');
    emitOrderContextSnapshotDebug({
      attemptId: "attempt-a",
      snapshotId: "snapshot-a-late",
      market: "KRW-BTC",
      capturedAt: new Date().toISOString(),
    });
    showDetectedGuardrailResult({
      detected: true,
      type: "USER_GUARDRAIL_RULE",
      message: "late local warning",
      visualMode: "SURPRISED",
      flameMode: "SURPRISED",
      orderContextSnapshot: {
        attemptId: "attempt-a",
        snapshotId: "snapshot-a-late",
        market: "KRW-BTC",
      },
    }, {
      attemptId: "attempt-a",
      snapshotId: "snapshot-a-late",
      market: "KRW-BTC",
    });`,
    context,
  );

  assert.equal(panel.dataset.flameMode, "default");
  assert.notEqual(status.dataset.state, "detected");
});

test("피드백 완료 후 새 attempt B는 정상적으로 SURPRISED 경고를 표시할 수 있다", () => {
  const { context, runtimeListener, panel, status } = createContentHarness();
  vm.runInContext(
    `pendingAttempt = {
      attemptId: "attempt-a",
      snapshot: { attemptId: "attempt-a", snapshotId: "snapshot-a", market: "KRW-BTC" },
      snapshotEmitted: true,
      feedbackShownAt: null,
      feedbackRespondedAt: null,
    };
    showTradeFeedback();
    answerTradeFeedback('PLANNED');
    unlockFeedbackCompletedVisualStateForNewAttempt();
    pendingAttempt = {
      attemptId: "attempt-b",
      snapshot: { attemptId: "attempt-b", snapshotId: "snapshot-b", market: "KRW-BTC" },
      snapshotEmitted: true,
      feedbackShownAt: null,
      feedbackRespondedAt: null,
    };`,
    context,
  );

  sendRuntimeMessage(
    runtimeListener,
    detectedResult("attempt-b", "snapshot-b", "SURPRISED"),
  );

  assert.equal(panel.dataset.flameMode, "surprised");
  assert.equal(status.dataset.state, "detected");
});
