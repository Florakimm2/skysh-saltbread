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
  const storageListeners = [];
  const sentRuntimeMessages = [];
  const sentWindowMessages = [];
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
      appendChild(child) {
        this.children.push(child);
        return child;
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
        onChanged: {
          addListener(listener) {
            storageListeners.push(listener);
          },
        },
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
        children: [],
        setAttribute(name, value) {
          documentElementAttributes[name] = value;
        },
        getAttribute(name) {
          return documentElementAttributes[name] || null;
        },
        removeAttribute(name) {
          delete documentElementAttributes[name];
        },
        append(child) {
          this.children.push(child);
        },
        appendChild(child) {
          this.children.push(child);
          return child;
        },
      },
      head: {
        children: [],
        append(child) {
          this.children.push(child);
        },
        appendChild(child) {
          this.children.push(child);
          return child;
        },
      },
      body: { append() {} },
      createElement: createElementStub,
      createTextNode(text) {
        return { textContent: text };
      },
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
    location:
      options.location || {
        href: "https://upbit.com/exchange?code=CRIX.UPBIT.KRW-BTC",
        origin: "https://upbit.com",
        pathname: "/exchange",
      },
    postMessage(message, targetOrigin) {
      sentWindowMessages.push({ message, targetOrigin });
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
    documentElementAttributes,
    documentListeners,
    localStore,
    runtimeListeners,
    sentRuntimeMessages,
    sentWindowMessages,
    storageListeners,
  };
}

function runUpbitConfirmScenario(context, { buttonText, modalText }) {
  return vm.runInContext(
    `(() => {
      startBehaviorTracking();

      const dialog = new Element();
      dialog.tagName = "DIV";
      dialog.textContent = ${JSON.stringify(modalText)};
      dialog.dataset = {};
      dialog.className = "";
      dialog.parentElement = document.body;
      dialog.getAttribute = () => null;
      dialog.querySelectorAll = () => [];

      const button = new Element();
      button.tagName = "A";
      button.textContent = ${JSON.stringify(buttonText)};
      button.dataset = {};
      button.className = "css-dgy70k";
      button.parentElement = dialog;
      button.querySelectorAll = () => [];
      button.getAttribute = () => null;
      button.closest = (selector) => {
        if (selector.includes("saltbread-extension-panel") || selector.includes("tablist")) {
          return null;
        }
        if (selector.includes("#QuoteOrderConfirmPopup") || selector.includes("#modal")) {
          return dialog;
        }
        if (selector.includes("button") || selector.includes("[role='button']") || selector.includes("a")) {
          return button;
        }
        return null;
      };

      handleDocumentClick({ target: button });
      return pendingAttempt?.snapshot || null;
    })()`,
    context,
  );
}

function installWarningPanelStub(context, { collapsed = false } = {}) {
  vm.runInContext(
    `(() => {
      const classState = new Set(${collapsed ? '["is-collapsed"]' : "[]" });
      const badgeElement = { textContent: "" };
      const titleElement = { textContent: "" };
      const messageElement = {
        textContent: "",
        children: [],
        replaceChildren() {
          this.children = [];
          this.textContent = "";
        },
        append(...nodes) {
          this.children.push(...nodes);
          this.textContent += nodes.map((node) => node.textContent || "").join("");
        },
      };
      const statusElement = {
        dataset: {},
        attributes: {},
        focused: false,
        scrolled: false,
        setAttribute(name, value) {
          this.attributes[name] = value;
        },
        focus() {
          this.focused = true;
        },
        scrollIntoView() {
          this.scrolled = true;
        },
        querySelector(selector) {
          if (selector === "[data-status-badge]") return badgeElement;
          if (selector === "[data-status-title]") return titleElement;
          if (selector === "[data-status-message]") return messageElement;
          return null;
        },
      };
      const rulesSection = { hidden: false };
      const feedbackSection = { hidden: true };
      const bodyElement = { inert: false, setAttribute() {} };
      const reopenElement = { setAttribute() {} };
      const collapsedControls = { setAttribute() {} };
      const panelElement = {
        dataset: { collapsed: String(${collapsed}) },
        classList: {
          contains(name) {
            return classState.has(name);
          },
          toggle(name, value) {
            if (value) classState.add(name);
            else classState.delete(name);
          },
        },
        remove() {},
        querySelector(selector) {
          if (selector === "[data-panel-rules-section]") return rulesSection;
          if (selector === "[data-trade-feedback]") return feedbackSection;
          if (selector === ".saltbread-panel__body") return bodyElement;
          if (selector === ".saltbread-panel__reopen") return reopenElement;
          if (selector === ".saltbread-panel__collapsed-controls") return collapsedControls;
          return null;
        },
      };
      document.getElementById = (id) =>
        id === PANEL_ID ? panelElement : null;
      document.querySelector = (selector) =>
        selector === ".saltbread-analysis-status" ? statusElement : null;
      globalThis.__warningPanelStub = {
        panelElement,
        statusElement,
        titleElement,
        messageElement,
        rulesSection,
        feedbackSection,
      };
    })()`,
    context,
  );
}

test("ORDER_INTENT_CLICK 스냅샷은 가격 입력이 없어도 즉시 수집된다", () => {
  const { context, debugEvents, sentRuntimeMessages } = createContentHarness();

  assert.doesNotThrow(() => {
    vm.runInContext("startBehaviorTracking(); beginOrderAttempt(null);", context);
  });

  const snapshotEvent = debugEvents.find(
    (event) => event.kind === "ORDER_INTENT_CLICK",
  );

  assert.ok(snapshotEvent);
  assert.equal(snapshotEvent.payload.snapshotTrigger, "ORDER_INTENT_CLICK");
  assert.equal(snapshotEvent.payload.market, "KRW-BTC");
  assert.ok(snapshotEvent.payload.attemptId);
  assert.equal(
    sentRuntimeMessages.some(
      (message) =>
        message.type === "SAVE_ORDER_CONTEXT_SNAPSHOT" &&
        message.payload.snapshotId === snapshotEvent.payload.snapshotId,
    ),
    true,
  );
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

test("requiresPrivateApi 규칙 카드는 API 배지와 준비 상태 dataset을 렌더링한다", () => {
  const { context } = createContentHarness();

  const result = vm.runInContext(
    `(() => {
      privateApiReady = false;
      const locked = renderRuleRows([
        {
          ruleId: "private-rule",
          isEnabled: true,
          visualMode: "SAD",
          warningTitle: "손실 매도",
          requiresPrivateApi: true
        },
        {
          ruleId: "public-rule",
          isEnabled: true,
          visualMode: "CURIOUS",
          warningTitle: "시장 급변"
        }
      ]);
      privateApiReady = true;
      const ready = renderRuleRows([
        {
          ruleId: "private-rule",
          isEnabled: true,
          visualMode: "SAD",
          warningTitle: "손실 매도",
          requiresPrivateApi: true
        }
      ]);
      return { locked, ready };
    })()`,
    context,
  );

  assert.equal(result.locked.includes("saltbread-rule-row__api-badge"), true);
  assert.equal(result.locked.includes('data-private-api-required="true"'), true);
  assert.equal(result.locked.includes('data-private-api-ready="false"'), true);
  assert.equal(result.locked.includes("개인 API 연결 시 감시 가능"), true);
  assert.equal(result.ready.includes('data-private-api-ready="true"'), true);
});

test("가드레일 목록은 경고 제목보다 규칙 제목을 우선 표시한다", () => {
  const { context } = createContentHarness();

  const result = vm.runInContext(
    `renderRuleRows([{
      ruleId: "named-rule",
      isEnabled: true,
      visualMode: "CURIOUS",
      name: "시장가 매수 제한",
      warningTitle: "주의",
      warningMessage: "경고 카드 메시지"
    }])`,
    context,
  );

  assert.match(
    result,
    /<span class="saltbread-rule-row__title">시장가 매수 제한<\/span>/,
  );
  assert.doesNotMatch(
    result,
    /<span class="saltbread-rule-row__title">주의<\/span>/,
  );
});

test("패널 헤더는 로그인 이메일을 subtitle 위치에 표시하고 별도 이메일 줄을 렌더링하지 않는다", () => {
  const { context, createdElements } = createContentHarness();

  vm.runInContext(
    `createPanel({ user: { email: "test3@test.test" } })`,
    context,
  );

  const panelMarkup = createdElements[0].innerHTML;
  assert.match(
    panelMarkup,
    /<span class="saltbread-panel__subtitle">test3@test\.test<\/span>/,
  );
  assert.doesNotMatch(panelMarkup, /saltbread-panel__account/);
  assert.match(
    panelMarkup,
    /saltbread-panel__header[\s\S]*<\/div>\s*<div\s+class="saltbread-analysis-status"/,
  );
});

test("경고 카드 제목은 warningTitle을 쓰고 가드레일 목록은 규칙 제목을 유지한다", () => {
  const { context } = createContentHarness();
  const badgeElement = { textContent: "" };
  const titleElement = { textContent: "" };
  const messageElement = {
    textContent: "",
    children: [],
    replaceChildren() {
      this.children = [];
      this.textContent = "";
    },
    append(...nodes) {
      this.children.push(...nodes);
      this.textContent += nodes.map((node) => node.textContent || "").join("");
    },
  };
  const statusElement = {
    dataset: {},
    querySelector(selector) {
      if (selector === "[data-status-badge]") return badgeElement;
      if (selector === "[data-status-title]") return titleElement;
      if (selector === "[data-status-message]") return messageElement;
      return null;
    },
  };

  context.statusElement = statusElement;
  const result = vm.runInContext(
    `(() => {
      document.querySelector = (selector) =>
        selector === ".saltbread-analysis-status" ? statusElement : null;
      setAnalysisStatus(
        "경고 카드 메시지",
        "detected",
        "USER_GUARDRAIL_RULE",
        "주의",
        {
          detected: true,
          matchedRuleIds: ["market-buy-limit"],
          primaryRuleId: "market-buy-limit",
          orderContextSnapshot: {},
          ruleEvaluation: { matchedRules: [] }
        }
      );
      const rows = renderRuleRows([{
        ruleId: "market-buy-limit",
        isEnabled: true,
        visualMode: "CURIOUS",
        name: "시장가 매수 제한",
        warningTitle: "주의",
        warningMessage: "경고 카드 메시지"
      }]);
      return { title: statusElement.querySelector("[data-status-title]").textContent, rows };
    })()`,
    context,
  );

  assert.equal(result.title, "주의");
  assert.match(result.rows, /시장가 매수 제한/);
  assert.doesNotMatch(
    result.rows,
    /<span class="saltbread-rule-row__title">주의<\/span>/,
  );
});

test("규칙 점검하기는 대시보드 마이페이지를 연다", () => {
  const { context, createdElements, sentRuntimeMessages } = createContentHarness();

  vm.runInContext(
    `createPanel({ user: { email: "test3@test.test" } });
    openRuleSettings();`,
    context,
  );

  const panelMarkup = createdElements[0].innerHTML;
  assert.match(panelMarkup, /규칙 점검하기/);
  assert.doesNotMatch(panelMarkup, /내 과거 기록 보기/);
  assert.deepEqual(
    JSON.parse(
      JSON.stringify(
        sentRuntimeMessages.find((message) => message.type === "OPEN_DASHBOARD"),
      ),
    ),
    { type: "OPEN_DASHBOARD", payload: { path: "/dashboard/my-page" } },
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

  const snapshotEvent = debugEvents.find(
    (event) => event.kind === "ORDER_INTENT_CLICK",
  );

  assert.ok(snapshotEvent);
  assert.deepEqual(
    JSON.parse(JSON.stringify(snapshotEvent.payload.shownRuleIds)),
    ["intent-warning"],
  );
  assert.equal(
    vm.runInContext("activeDetectionResult.primaryRuleId", context),
    "intent-warning",
  );
});

test("접힌 패널 불꽃은 현재 경고 불꽃 모드와 함께 변경된다", () => {
  const { context } = createContentHarness();

  const result = vm.runInContext(
    `(() => {
      const calls = { panel: [], collapsed: [] };
      panelFlame = {
        setMode(mode) { calls.panel.push(mode); },
        destroy() {}
      };
      collapsedPanelFlame = {
        setMode(mode) { calls.collapsed.push(mode); },
        destroy() {}
      };
      applyFlameTheme("SAD");
      applyFlameTheme("FAST_BURN");
      return calls;
    })()`,
    context,
  );

  assert.deepEqual(JSON.parse(JSON.stringify(result.panel)), ["sad", "fastBurn"]);
  assert.deepEqual(
    JSON.parse(JSON.stringify(result.collapsed)),
    ["sad", "fastBurn"],
  );
});

test("경고 규칙 조건은 실제 snapshot 값을 넣어 자연어로 설명된다", () => {
  const { context } = createContentHarness();

  const descriptions = vm.runInContext(
    `buildMatchedRuleDescriptions({
      primaryRule: null,
      orderContextSnapshot: {
        side: "BUY",
        signedChangeRate: 0.12,
        orderMode: "MARKET"
      },
      ruleEvaluation: {
        matchedRules: [{
          ruleId: "natural-rule",
          warningTitle: "테스트 규칙",
          expression: {
            nodeType: "GROUP",
            operator: "AND",
            children: [
              {
                nodeType: "CONDITION",
                leftField: "side",
                operator: "EQ",
                rightOperand: { operandType: "LITERAL", value: "BUY" }
              },
              {
                nodeType: "CONDITION",
                leftField: "signedChangeRate",
                operator: "GTE",
                rightOperand: { operandType: "LITERAL", value: 0.1 }
              },
              {
                nodeType: "CONDITION",
                leftField: "orderMode",
                operator: "EQ",
                rightOperand: { operandType: "LITERAL", value: "LIMIT" }
              }
            ]
          }
        }]
      }
    }).map((description) =>
      description.parts.map((part) => part.text).join("")
    )`,
    context,
  );

  assert.deepEqual(JSON.parse(JSON.stringify(descriptions)), [
    "주문 타입이 BUY 에요.",
    "등락률이 12%로 10%보다 크거나 같아요.",
  ]);
});

test("ORDER_INTENT_CLICK은 cached market/personal snapshot을 병합하고 debug를 남긴다", () => {
  const { context, debugEvents } = createContentHarness();
  const fetchedAt = new Date().toISOString();

  vm.runInContext(
    `startBehaviorTracking();
    readOrderDraft = () => ({
      market: "KRW-BTC",
      order_side: "BUY",
      order_status: "WAIT",
      order_type: "MARKET",
      order_price: null,
      order_volume: null,
      order_amount: 1000000,
      realized_loss_pct_1h: null,
      order_request_time: "${fetchedAt}",
      order_cancel_time: null
    });
    cachedMarketSnapshotCache = {
      "KRW-BTC": {
        market: "KRW-BTC",
        tradePrice: "90000000",
        signedChangeRate: 0.12,
        shortTermReturn5m: 0.06,
        spreadRate: null,
        marketRiskFlags: [],
        pricePositionIn5mRange: null,
        volumeSpikeRatio5m: null,
        fetchedAt: "${fetchedAt}",
        freshnessMs: 0,
        source: "backend-market-snapshot"
      }
    };
    cachedPersonalSnapshotCache = {
      "KRW-BTC": {
        market: "KRW-BTC",
        balances: [{ currency: "KRW", balance: "2000000" }],
        openOrders: [],
        recentOrders: [],
        recentTrades: [],
        baseAssetAvgBuyPrice: "100000000",
        actualOrderCreatedCount10m: 3,
        fetchedAt: "${fetchedAt}",
        freshnessMs: 0,
        source: "extension-private-cache"
      }
    };
    beginOrderAttempt(null);`,
    context,
  );

  const snapshotEvent = debugEvents.find(
    (event) => event.kind === "ORDER_INTENT_CLICK",
  );
  const contextDebug = debugEvents.find(
    (event) => event.kind === "ORDER_CONTEXT_WITH_SNAPSHOTS",
  );

  assert.equal(snapshotEvent.payload.tradePriceAtSnapshot, "90000000");
  assert.equal(snapshotEvent.payload.signedChangeRate, 0.12);
  assert.equal(snapshotEvent.payload.shortTermReturn5m, 0.06);
  assert.equal(snapshotEvent.payload.requestedBalanceRatio, 0.5);
  assert.equal(snapshotEvent.payload.actualOrderCreatedCount10m, 3);
  assert.equal(
    snapshotEvent.payload.baseAssetAvgBuyPriceBeforeSnapshot,
    "100000000",
  );
  assert.equal(snapshotEvent.payload.priceVsAvgBuyRateAtSnapshot, -0.1);
  assert.equal(contextDebug.payload.hasMarketSnapshot, true);
  assert.equal(contextDebug.payload.marketSnapshotSource, "backend-market-snapshot");
  assert.equal(contextDebug.payload.hasPersonalSnapshot, true);
  assert.equal(
    contextDebug.payload.personalSnapshotSource,
    "extension-private-cache",
  );
});

test("데모 주문 클릭은 demo market/personal snapshot을 병합하고 debug에 source를 남긴다", () => {
  const { context, debugEvents } = createContentHarness({
    location: {
      href: "http://localhost:3000/demo?code=CRIX.UPBIT.KRW-BTC",
      origin: "http://localhost:3000",
      pathname: "/demo",
    },
  });
  const now = new Date().toISOString();

  vm.runInContext(
    `startBehaviorTracking();
    cachedMarketSnapshotCache = {
      "KRW-BTC": {
        market: "KRW-BTC",
        tradePrice: "90000000",
        signedChangeRate: -0.02,
        shortTermReturn5m: -0.01,
        fetchedAt: "${now}",
        freshnessMs: 0,
        source: "backend-market-snapshot"
      }
    };
    readOrderDraft = () => ({
      market: "KRW-BTC",
      order_side: "BUY",
      order_status: "WAIT",
      order_type: "MARKET",
      order_price: null,
      order_volume: null,
      order_amount: 1200000,
      realized_loss_pct_1h: null,
      order_request_time: "${now}",
      order_cancel_time: null
    });
    handleDemoScenario({
      detail: {
        market: "KRW-SOL",
        currentPrice: 222000,
        marketData: {
          market: "KRW-SOL",
          tradePriceAtSnapshot: "222000",
          signedChangeRate: 0.16,
          shortTermReturn5m: 0.046,
          pricePositionIn5mRange: 0.94
        },
        accounts: [
          { currency: "KRW", balance: "2400000" },
          { currency: "SOL", balance: "20", avgBuyPrice: "180000" }
        ],
        rawClosedOrders: [
          { uuid: "closed-1", created_at: "${now}" },
          { uuid: "closed-2", created_at: "${now}" }
        ],
        rawOpenOrders: [
          { uuid: "open-1", created_at: "${now}" }
        ],
        recentOrders: [],
        currentOrder: {
          market: "KRW-SOL",
          order_side: "BUY",
          order_type: "MARKET",
          order_amount: 1200000
        },
        orderbookClickToSnapshotMs: 2400
      }
    });
    beginOrderAttempt(null);`,
    context,
  );

  const contextDebug = debugEvents.filter(
    (event) => event.kind === "ORDER_CONTEXT_WITH_SNAPSHOTS",
  ).at(-1);
  assert.equal(contextDebug.payload.hasMarketSnapshot, true);
  assert.equal(contextDebug.payload.marketSnapshotSource, "demo-data");
  assert.equal(contextDebug.payload.hasPersonalSnapshot, true);
  assert.equal(contextDebug.payload.personalSnapshotSource, "demo-data");
  assert.equal(contextDebug.payload.market, "KRW-SOL");
  assert.equal(contextDebug.payload.mergedFields.tradePriceAtSnapshot, "222000");
  assert.equal(contextDebug.payload.mergedFields.signedChangeRate, 0.16);
  assert.equal(contextDebug.payload.mergedFields.shortTermReturn5m, 0.046);
  assert.equal(contextDebug.payload.mergedFields.requestedBalanceRatio, 0.5);
  assert.equal(contextDebug.payload.mergedFields.actualOrderCreatedCount10m, 3);
  assert.equal(
    contextDebug.payload.mergedFields.baseAssetAvgBuyPriceBeforeSnapshot,
    "180000",
  );
  assert.equal(contextDebug.payload.mergedFields.priceVsAvgBuyRateAtSnapshot, 0.23333333333333334);
});

test("demo DTO uses page internal MARKET_SNAPSHOT and ACCOUNT_SNAPSHOT bridge data", () => {
  const { context, debugEvents, sentRuntimeMessages } = createContentHarness({
    location: {
      href: "http://localhost:3000/demo?code=CRIX.UPBIT.KRW-BTC",
      origin: "http://localhost:3000",
      pathname: "/demo",
    },
  });
  const now = new Date().toISOString();

  vm.runInContext(
    `startBehaviorTracking();
    readOrderDraft = () => ({
      market: "KRW-BTC",
      order_side: "BUY",
      order_status: "WAIT",
      order_type: "MARKET",
      order_price: null,
      order_volume: null,
      order_amount: 5168,
      realized_loss_pct_1h: null,
      order_request_time: "${now}",
      order_cancel_time: null
    });
    handleDemoBridgeMessage({
      source: window,
      data: {
        source: "SALTBREAD_DEMO_PAGE",
        type: "DEMO_STATE",
        state: {
          market: "KRW-BTC",
          marketSnapshot: {
            market: "KRW-BTC",
            tradePriceAtSnapshot: "95291000",
            shortTermReturn5m: -0.0002832623428943117,
            signedChangeRate: 0.0103268764,
            spreadRate: 0.0007343992614041714,
            pricePositionIn5mRange: 0.5583333333333333,
            volumeSpikeRatio5m: 0.9673354860260226,
            marketRiskFlags: []
          },
          accountSnapshot: {
            market: "KRW-BTC",
            accounts: [
              { currency: "KRW", balance: "10000" },
              { currency: "BTC", balance: "0.1", avg_buy_price: "90000000" }
            ],
            orders: [
              { uuid: "btc-order", market: "KRW-BTC", created_at: "${now}", state: "done" },
              { uuid: "eth-order", market: "KRW-ETH", created_at: "${now}", state: "done" }
            ]
          },
          currentOrder: {
            market: "KRW-BTC",
            order_side: "BUY",
            order_type: "MARKET",
            order_amount: 5168
          }
        }
      }
    });
    beginOrderAttempt(null);`,
    context,
  );

  const contextDebug = debugEvents.filter(
    (event) => event.kind === "ORDER_CONTEXT_WITH_SNAPSHOTS",
  ).at(-1);
  const orderIntent = debugEvents.find(
    (event) => event.kind === "ORDER_INTENT_CLICK",
  );

  assert.equal(contextDebug.payload.hasMarketSnapshot, true);
  assert.equal(contextDebug.payload.marketSnapshotSource, "demo-data");
  assert.equal(contextDebug.payload.hasPersonalSnapshot, true);
  assert.equal(contextDebug.payload.personalSnapshotSource, "demo-data");
  assert.equal(contextDebug.payload.mergedFields.tradePriceAtSnapshot, "95291000");
  assert.equal(contextDebug.payload.mergedFields.signedChangeRate, 0.0103268764);
  assert.equal(contextDebug.payload.mergedFields.shortTermReturn5m, -0.0002832623428943117);
  assert.equal(contextDebug.payload.mergedFields.requestedBalanceRatio, 0.5168);
  assert.equal(contextDebug.payload.mergedFields.actualOrderCreatedCount10m, 1);
  assert.equal(
    contextDebug.payload.mergedFields.baseAssetAvgBuyPriceBeforeSnapshot,
    "90000000",
  );
  assert.equal(orderIntent.payload.tradePriceAtSnapshot, "95291000");
  assert.equal(orderIntent.payload.intentAmount, "5168");
  assert.equal(
    sentRuntimeMessages.some((message) => message.type === "REFRESH_SNAPSHOTS_NOW"),
    false,
  );
});

test("demo raw MARKET_SNAPSHOT emits bridge code next to raw inspector logging", () => {
  const source = fs.readFileSync(
    path.join(__dirname, "../frontend/demo/trading-terminal.tsx"),
    "utf8",
  );

  assert.match(source, /addDebugRecord\("page", "market", "MARKET_SNAPSHOT", context\)/);
  assert.match(source, /emitSaltbreadDemoBridge\("MARKET_SNAPSHOT", context\)/);
  assert.match(source, /addDebugRecord\("page", "personal", "ACCOUNT_SNAPSHOT", payload\)/);
  assert.match(source, /emitSaltbreadDemoBridge\("ACCOUNT_SNAPSHOT", payload\)/);
  assert.match(source, /type: "DEMO_STATE_SYNC"/);
});

test("content script receives raw MARKET_SNAPSHOT bridge message and caches DTO fields", () => {
  const { context, debugEvents } = createContentHarness({
    location: {
      href: "http://localhost:3000/demo?code=CRIX.UPBIT.KRW-BTC",
      origin: "http://localhost:3000",
      pathname: "/demo",
    },
  });
  const now = new Date().toISOString();

  vm.runInContext(
    `startBehaviorTracking();
    readOrderDraft = () => ({
      market: "KRW-BTC",
      order_side: "BUY",
      order_status: "WAIT",
      order_type: "MARKET",
      order_price: null,
      order_volume: null,
      order_amount: 5000,
      realized_loss_pct_1h: null,
      order_request_time: "${now}",
      order_cancel_time: null
    });
    handleDemoBridgeMessage({
      source: window,
      data: {
        source: "SALTBREAD_DEMO_PAGE",
        type: "MARKET_SNAPSHOT",
        payload: {
          market: "KRW-BTC",
          tradePriceAtSnapshot: "95470000",
          shortTermReturn5m: 0.001164022273723508,
          signedChangeRate: 0.0122247315,
          spreadRate: 0.00011521944066198806,
          marketRiskFlags: [],
          pricePositionIn5mRange: 0.9502762430939227,
          volumeSpikeRatio5m: 0.2240752691783242,
          ticker: {
            trade_price: 95470000,
            signed_change_rate: 0.0122247315
          }
        }
      }
    });
    handleDemoBridgeMessage({
      source: window,
      data: {
        source: "SALTBREAD_DEMO_PAGE",
        type: "ACCOUNT_SNAPSHOT",
        payload: {
          market: "KRW-BTC",
          accounts: [
            { currency: "KRW", balance: "10000" },
            { currency: "BTC", balance: "0.1", avg_buy_price: "90000000" }
          ],
          orders: []
        }
      }
    });
    beginOrderAttempt(null);`,
    context,
  );

  const cached = debugEvents.find(
    (event) => event.kind === "DEMO_MARKET_SNAPSHOT_CACHED",
  );
  const contextDebug = debugEvents.filter(
    (event) => event.kind === "ORDER_CONTEXT_WITH_SNAPSHOTS",
  ).at(-1);

  assert.ok(cached);
  assert.equal(cached.payload.fields.tradePriceAtSnapshot, "95470000");
  assert.equal(cached.payload.fields.signedChangeRate, 0.0122247315);
  assert.equal(contextDebug.payload.hasMarketSnapshot, true);
  assert.equal(contextDebug.payload.marketSnapshotSource, "demo-data");
  assert.equal(contextDebug.payload.mergedFields.tradePriceAtSnapshot, "95470000");
  assert.notEqual(contextDebug.payload.mergedFields.signedChangeRate, null);
});

test("content script requests and receives DEMO_STATE_SYNC after demo start", () => {
  const { context, debugEvents, sentWindowMessages } = createContentHarness({
    location: {
      href: "http://localhost:3000/demo?code=CRIX.UPBIT.KRW-BTC",
      origin: "http://localhost:3000",
      pathname: "/demo",
    },
  });

  vm.runInContext(
    `startBehaviorTracking();
    handleDemoBridgeMessage({
      source: window,
      data: {
        source: "SALTBREAD_DEMO_PAGE",
        type: "DEMO_STATE_SYNC",
        payload: {
          market: "KRW-BTC",
          marketSnapshot: {
            market: "KRW-BTC",
            tradePriceAtSnapshot: "95470000",
            signedChangeRate: 0.0122247315,
            shortTermReturn5m: 0.001164022273723508
          },
          accountSnapshot: {
            market: "KRW-BTC",
            accounts: [{ currency: "KRW", balance: "10000" }]
          },
          orders: [],
          updatedAt: "2026-07-10T00:00:00.000Z"
        }
      }
    });`,
    context,
  );

  assert.ok(
    sentWindowMessages.some(
      ({ message }) =>
        message.source === "SALTBREAD_EXTENSION" &&
        message.type === "REQUEST_DEMO_STATE",
    ),
  );
  assert.ok(
    debugEvents.some((event) => event.kind === "DEMO_STATE_SYNC_RECEIVED"),
  );
});

test("normalizeDemoMarketSnapshot maps raw MARKET_SNAPSHOT shape to DTO shape", () => {
  const { context } = createContentHarness({
    location: {
      href: "http://localhost:3000/demo?code=CRIX.UPBIT.KRW-BTC",
      origin: "http://localhost:3000",
      pathname: "/demo",
    },
  });

  const result = vm.runInContext(
    `createDemoMarketSnapshot({
      marketSnapshot: {
        market: "KRW-BTC",
        tradePriceAtSnapshot: "95470000",
        shortTermReturn5m: 0.001164022273723508,
        signedChangeRate: 0.0122247315,
        spreadRate: 0.00011521944066198806,
        marketRiskFlags: [],
        pricePositionIn5mRange: 0.9502762430939227,
        volumeSpikeRatio5m: 0.2240752691783242,
        ticker: {
          trade_price: 95470000,
          signed_change_rate: 0.0122247315
        }
      }
    })`,
    context,
  );

  assert.equal(result.market, "KRW-BTC");
  assert.equal(result.current_price, 95470000);
  assert.equal(result.tradePriceAtSnapshot, "95470000");
  assert.equal(result.signedChangeRate, 0.0122247315);
  assert.equal(result.shortTermReturn5m, 0.001164022273723508);
  assert.equal(result.spreadRate, 0.00011521944066198806);
  assert.equal(result.pricePositionIn5mRange, 0.9502762430939227);
  assert.equal(result.volumeSpikeRatio5m, 0.2240752691783242);
  assert.equal(result.source, "demo-data");
});

test("missing demo cache logs DEMO_MARKET_SNAPSHOT_CACHE_MISS", () => {
  const { context, debugEvents } = createContentHarness({
    location: {
      href: "http://localhost:3000/demo?code=CRIX.UPBIT.KRW-BTC",
      origin: "http://localhost:3000",
      pathname: "/demo",
    },
  });
  const now = new Date().toISOString();

  vm.runInContext(
    `startBehaviorTracking();
    readOrderDraft = () => ({
      market: "KRW-BTC",
      order_side: "BUY",
      order_status: "WAIT",
      order_type: "MARKET",
      order_price: null,
      order_volume: null,
      order_amount: 5000,
      realized_loss_pct_1h: null,
      order_request_time: "${now}",
      order_cancel_time: null
    });
    beginOrderAttempt(null);`,
    context,
  );

  assert.ok(
    debugEvents.some(
      (event) => event.kind === "DEMO_MARKET_SNAPSHOT_CACHE_MISS",
    ),
  );
});

test("demo page click does not run real Upbit confirm modal detector", () => {
  const { context, debugEvents, sentRuntimeMessages } = createContentHarness({
    location: {
      href: "http://localhost:3000/demo?code=CRIX.UPBIT.KRW-BTC",
      origin: "http://localhost:3000",
      pathname: "/demo",
    },
  });

  const result = vm.runInContext(
    `(() => {
      startBehaviorTracking();
      const dialog = new Element();
      dialog.tagName = "DIV";
      dialog.textContent = "매수주문 확인 시장가 매수 BTC/KRW 총액 5,190 KRW 취소 매수 확인";
      dialog.dataset = {};
      dialog.className = "";
      dialog.parentElement = document.body;
      dialog.getAttribute = () => null;
      dialog.querySelectorAll = () => [];

      const button = new Element();
      button.tagName = "A";
      button.textContent = "매수 확인";
      button.dataset = {};
      button.className = "css-dgy70k";
      button.parentElement = dialog;
      button.querySelectorAll = () => [];
      button.getAttribute = () => null;
      button.closest = (selector) => {
        if (selector.includes("saltbread-extension-panel") || selector.includes("tablist")) {
          return null;
        }
        if (selector.includes("#QuoteOrderConfirmPopup") || selector.includes("#modal")) {
          return dialog;
        }
        if (selector.includes("button") || selector.includes("[role='button']") || selector.includes("a")) {
          return button;
        }
        return null;
      };

      handleDocumentClick({ target: button });
      return {
        feedbackActive: Boolean(activeTradeFeedback),
        flowState: upbitOrderFlow.state
      };
    })()`,
    context,
  );

  assert.equal(result.feedbackActive, false);
  assert.notEqual(result.flowState, "FEEDBACK_SHOWN");
  assert.equal(
    debugEvents.some((event) => event.kind === "UPBIT_CONFIRM_BUTTON_CLICKED"),
    false,
  );
  assert.equal(
    sentRuntimeMessages.some((message) => message.type === "ORDER_ACTION_DETECTED"),
    false,
  );
});

test("실제 Upbit의 짧은 주문 라벨도 주문 버튼과 draft로 인식한다", () => {
  const { context } = createContentHarness();

  const result = vm.runInContext(
    `(() => {
      const panel = new Element();
      panel.tagName = "DIV";
      panel.textContent = "지정가 가격 수량 총액 주문가능";
      panel.parentElement = document.body;
      panel.dataset = {};
      panel.className = "";
      panel.getAttribute = () => null;

      const typeControl = new Element();
      typeControl.textContent = "지정가";
      typeControl.dataset = {};
      typeControl.className = "active";
      typeControl.getAttribute = (name) =>
        name === "aria-selected" ? "true" : null;

      const priceInput = new HTMLInputElement();
      priceInput.value = "100000000";
      priceInput.labels = [];
      priceInput.parentElement = panel;
      priceInput.getAttribute = (name) =>
        name === "placeholder" ? "가격" : null;

      const volumeInput = new HTMLInputElement();
      volumeInput.value = "0.01";
      volumeInput.labels = [];
      volumeInput.parentElement = panel;
      volumeInput.getAttribute = (name) =>
        name === "placeholder" ? "수량" : null;

      const amountInput = new HTMLInputElement();
      amountInput.value = "1000000";
      amountInput.labels = [];
      amountInput.parentElement = panel;
      amountInput.getAttribute = (name) =>
        name === "placeholder" ? "총액" : null;

      panel.querySelectorAll = (selector) => {
        if (selector === "input") {
          return [priceInput, volumeInput, amountInput];
        }
        if (selector.includes("button")) {
          return [typeControl];
        }
        return [];
      };

      const button = new Element();
      button.tagName = "BUTTON";
      button.textContent = "매수";
      button.dataset = {};
      button.className = "order-button";
      button.parentElement = panel;
      button.querySelectorAll = () => [];
      button.getAttribute = () => null;
      button.closest = (selector) => {
        if (selector.includes("saltbread-extension-panel") || selector.includes("tablist")) {
          return null;
        }
        if (selector.includes("button")) {
          return button;
        }
        return null;
      };

      behaviorState = {
        market: "KRW-BTC",
        sessionId: "session-real-dom",
        inputEditTimestamps: [],
        inputEditTimestampsByField: { price: [], quantity: [], amount: [] },
        orderIntentTimestamps: [],
        sameSideIntentTimestamps: { BUY: [], SELL: [] },
        marketChangeTimestamps: [],
        sideChangeTimestamps: [],
        orderModeChangeTimestamps: [],
        pendingInputEvents: new Map(),
        lastLoggedInputValues: new Map(),
        inputValueHistoryByField: { price: new Set(), quantity: new Set(), amount: new Set() },
        draftStartedAt: null,
        lastEditAt: null,
        draftEditCount: 0,
        firstAmount: null,
        firstPrice: null,
        lastOrderbookClickAt: null,
        inputRevertCount: 0,
        priceDirectionChangeCount: 0,
        allocationPresetPercent: null
      };

      const detectedButton = findOrderButton(button);
      const draft = readOrderDraft(button);

      const result = {
        buttonDetected: detectedButton === button,
        side: draft?.order_side,
        orderType: draft?.order_type,
        price: draft?.order_price,
        volume: draft?.order_volume,
        amount: draft?.order_amount
      };
      behaviorState = null;
      return result;
    })()`,
    context,
  );

  assert.deepEqual(JSON.parse(JSON.stringify(result)), {
    buttonDetected: true,
    side: "BUY",
    orderType: "LIMIT",
    price: 100_000_000,
    volume: 0.01,
    amount: 1_000_000,
  });
});

test("주문 행동 이벤트 생성은 orderButton 전역 참조 없이 동작한다", () => {
  const { context } = createContentHarness();

  const result = vm.runInContext(
    `(() => {
      startBehaviorTracking();
      const panel = new Element();
      panel.tagName = "DIV";
      panel.textContent = "매수 시장가 주문";
      panel.dataset = {};
      panel.className = "";
      panel.parentElement = document.body;
      panel.getAttribute = () => null;

      const typeControl = new Element();
      typeControl.textContent = "시장가";
      typeControl.dataset = {};
      typeControl.className = "active";
      typeControl.getAttribute = (name) =>
        name === "aria-selected" ? "true" : null;

      const sideControl = new Element();
      sideControl.textContent = "매수";
      sideControl.dataset = {};
      sideControl.className = "active";
      sideControl.getAttribute = (name) =>
        name === "aria-selected" ? "true" : null;

      panel.querySelectorAll = (selector) => {
        if (selector.includes("button")) {
          return [typeControl, sideControl];
        }
        return [];
      };

      return createBehaviorEvent("ORDER_SUBMIT_ATTEMPT", panel, {
        side: "BUY"
      });
    })()`,
    context,
  );

  assert.equal(result.eventType, "ORDER_SUBMIT_ATTEMPT");
  assert.equal(result.side, "BUY");
  assert.equal(result.orderType, "MARKET");
});

test("Upbit 확인 모달의 매수 확인 클릭은 주문 의도 생성 후 피드백을 표시한다", () => {
  const { context, debugEvents } = createContentHarness();

  const result = vm.runInContext(
    `(() => {
      setPageGuardrailRulesState({
        source: "network",
        fetchedAt: "2026-07-08T00:00:00.000Z",
        rules: [{
          ruleId: "buy-confirm-warning",
          isEnabled: true,
          priority: 1,
          riskLevel: "HIGH",
          visualMode: "EMBER",
          warningTitle: "매수 확인",
          warningMessage: "매수 확인 버튼을 한 번 더 점검합니다.",
          expression: {
            nodeType: "CONDITION",
            leftField: "side",
            operator: "EQ",
            rightOperand: {
              operandType: "LITERAL",
              value: "BUY"
            }
          }
        }]
      });
      startBehaviorTracking();

      const dialog = new Element();
      dialog.tagName = "DIV";
      dialog.textContent = "매수 주문 안내 시장가 주문금액 10000";
      dialog.dataset = {};
      dialog.className = "";
      dialog.parentElement = document.body;
      dialog.getAttribute = () => null;
      dialog.querySelectorAll = () => [];

      const button = new Element();
      button.tagName = "A";
      button.textContent = "매수 확인";
      button.dataset = {};
      button.className = "css-dgy70k";
      button.parentElement = dialog;
      button.querySelectorAll = () => [];
      button.getAttribute = () => null;
      button.closest = (selector) => {
        if (selector.includes("saltbread-extension-panel") || selector.includes("tablist")) {
          return null;
        }
        if (selector.includes("#QuoteOrderConfirmPopup") || selector.includes("#modal")) {
          return dialog;
        }
        if (selector.includes("button") || selector.includes("[role='button']") || selector.includes("a")) {
          return button;
        }
        return null;
      };

      const target = new Element();
      target.textContent = "매수 확인";
      target.dataset = {};
      target.parentElement = button;
      target.getAttribute = () => null;
      target.closest = (selector) => {
        if (selector.includes("button") || selector.includes("[role='button']") || selector.includes("a")) {
          return button;
        }
        return null;
      };

      const event = {
        target,
        defaultPrevented: false,
        propagationStopped: false,
        immediatePropagationStopped: false,
        preventDefault() { this.defaultPrevented = true; },
        stopPropagation() { this.propagationStopped = true; },
        stopImmediatePropagation() { this.immediatePropagationStopped = true; }
      };

      handleDocumentClick(event);

      return {
        defaultPrevented: event.defaultPrevented,
        propagationStopped: event.propagationStopped,
        immediatePropagationStopped: event.immediatePropagationStopped,
        side: pendingAttempt?.snapshot?.side,
        orderMode: pendingAttempt?.snapshot?.orderMode,
        activeRuleId: activeDetectionResult?.primaryRuleId || null,
        activeSnapshotId: activeGuardrailSnapshotId || null,
        feedbackActive: Boolean(activeTradeFeedback),
        feedbackAttemptId: activeTradeFeedback?.attemptId || null,
        orderIntentDebugCount: document.__debugCount || 0
      };
    })()`,
    context,
  );

  assert.equal(result.defaultPrevented, false);
  assert.equal(result.propagationStopped, false);
  assert.equal(result.immediatePropagationStopped, false);
  assert.equal(result.side, "BUY");
  assert.equal(result.orderMode, "MARKET");
  assert.equal(result.feedbackActive, true);
  assert.ok(result.feedbackAttemptId);
  assert.equal(result.activeRuleId, null);
  assert.equal(result.activeSnapshotId, null);
  assert.ok(
    debugEvents.some(
      (event) => event.kind === "UPBIT_CONFIRM_ORDER_INTENT_CAPTURED",
    ),
  );
  assert.ok(
    debugEvents.some(
      (event) => event.kind === "UPBIT_FEEDBACK_SHOWN_AFTER_CONFIRM_CLICK",
    ),
  );
});

test("Upbit 시장가 매수는 주문금액과 MARKET 모드를 snapshot에 담고 규칙 매칭한다", () => {
  const { context, debugEvents } = createContentHarness();

  vm.runInContext(
    `setPageGuardrailRulesState({
      source: "network",
      fetchedAt: "2026-07-08T00:00:00.000Z",
      rules: [{
        ruleId: "market-buy-rule",
        isEnabled: true,
        priority: 1,
        riskLevel: "MEDIUM",
        visualMode: "CURIOUS",
        warningTitle: "시장가 매수",
        expression: {
          nodeType: "GROUP",
          operator: "AND",
          children: [
            {
              nodeType: "CONDITION",
              leftField: "side",
              operator: "EQ",
              rightOperand: { operandType: "LITERAL", value: "BUY" }
            },
            {
              nodeType: "CONDITION",
              leftField: "orderMode",
              operator: "EQ",
              rightOperand: { operandType: "LITERAL", value: "MARKET" }
            }
          ]
        }
      }]
    });`,
    context,
  );

  const snapshot = runUpbitConfirmScenario(context, {
    buttonText: "매수 확인",
    modalText: "매수 주문 확인 주문유형 시장가 주문금액 150,000 KRW",
  });

  assert.equal(snapshot.side, "BUY");
  assert.equal(snapshot.orderMode, "MARKET");
  assert.equal(snapshot.intentAmount, "150000");
  assert.equal(snapshot.intentPrice, null);
  assert.equal(snapshot.intentQuantity, null);
  assert.match(snapshot.orderTime, /^([01]\d|2[0-3]):[0-5]\d$/);
  assert.equal(Number.isInteger(snapshot.orderTimeMinutes), true);
  assert.ok(snapshot.orderTimeMinutes >= 0 && snapshot.orderTimeMinutes <= 1439);
  assert.deepEqual(JSON.parse(JSON.stringify(snapshot.matchedRuleIdsAtSnapshot)), [
    "market-buy-rule",
  ]);
  assert.equal(
    debugEvents.some(
      (event) => event.kind === "UPBIT_CONFIRM_ORDER_INTENT_CAPTURED",
    ),
    true,
  );
});

test("detected=true ruleEvaluation은 FAST_BURN 경고 UI와 문구를 즉시 반영한다", () => {
  const { context } = createContentHarness();

  const result = vm.runInContext(
    `(() => {
      const badgeElement = { textContent: "" };
      const titleElement = { textContent: "" };
      const messageElement = {
        textContent: "",
        children: [],
        replaceChildren() {
          this.children = [];
          this.textContent = "";
        },
        append(...nodes) {
          this.children.push(...nodes);
          this.textContent += nodes.map((node) => node.textContent || "").join("");
        },
      };
      const statusElement = {
        dataset: {},
        querySelector(selector) {
          if (selector === "[data-status-badge]") return badgeElement;
          if (selector === "[data-status-title]") return titleElement;
          if (selector === "[data-status-message]") return messageElement;
          return null;
        },
      };
      const rulesSection = { hidden: false };
      const feedbackSection = { hidden: true };
      const collapsedChild = { inert: false, setAttribute() {} };
      const panelElement = {
        dataset: {},
        classList: { toggle() {} },
        remove() {},
        querySelector(selector) {
          if (selector === "[data-panel-rules-section]") return rulesSection;
          if (selector === "[data-trade-feedback]") return feedbackSection;
          return collapsedChild;
        },
      };
      document.getElementById = (id) =>
        id === PANEL_ID ? panelElement : null;
      document.querySelector = (selector) =>
        selector === ".saltbread-analysis-status" ? statusElement : null;

      const snapshot = {
        snapshotId: "snapshot-fast-burn",
        attemptId: "attempt-fast-burn",
        market: "KRW-BTC",
        side: "BUY",
        orderMode: "MARKET",
        intentAmount: "5000"
      };
      const primaryRule = {
        ruleId: "market-buy-fast-burn",
        name: "시장가 매수",
        visualMode: "FAST_BURN",
        warningTitle: "테",
        warningMessage: "테스트요",
        expression: {
          nodeType: "GROUP",
          operator: "AND",
          children: [
            {
              nodeType: "CONDITION",
              leftField: "side",
              operator: "EQ",
              rightOperand: { operandType: "LITERAL", value: "BUY" }
            },
            {
              nodeType: "CONDITION",
              leftField: "orderMode",
              operator: "EQ",
              rightOperand: { operandType: "LITERAL", value: "MARKET" }
            }
          ]
        }
      };

      const applied = showDetectedGuardrailResult({
        detected: true,
        type: "USER_GUARDRAIL_RULE",
        message: "테스트요",
        warningTitle: "테",
        visualMode: "FAST_BURN",
        flameMode: "FAST_BURN",
        primaryRuleId: primaryRule.ruleId,
        primaryRule,
        ruleEvaluation: {
          detected: true,
          matchedRules: [primaryRule],
          matchedRuleIds: [primaryRule.ruleId],
          primaryRule,
          primaryRuleId: primaryRule.ruleId
        },
        orderContextSnapshot: snapshot
      }, snapshot);

      return {
        applied,
        panelFlameMode: panelElement.dataset.flameMode,
        warningActive: panelElement.dataset.warningActive,
        feedbackActive: panelElement.dataset.feedbackActive,
        statusState: statusElement.dataset.state,
        title: titleElement.textContent,
        message: messageElement.textContent,
        activeRuleId: activeDetectionResult?.primaryRuleId || null,
        appliedLog: window.__SALTBREAD_UPBIT_DEBUG__
          .getState()
          .events.find((event) => event.eventName === "UPBIT_WARNING_UI_APPLIED")
      };
    })()`,
    context,
  );

  assert.equal(result.applied, true);
  assert.equal(result.panelFlameMode, "fast_burn");
  assert.equal(result.warningActive, "true");
  assert.equal(result.feedbackActive, "false");
  assert.equal(result.statusState, "detected");
  assert.equal(result.title, "테");
  assert.match(result.message, /테스트요/);
  assert.equal(result.activeRuleId, "market-buy-fast-burn");
  const appliedLog = result.appliedLog;
  assert.ok(appliedLog);
  assert.equal(appliedLog.payload.visualMode, "FAST_BURN");
  assert.equal(appliedLog.payload.renderedTitle, "테");
  assert.match(appliedLog.payload.renderedMessage, /테스트요/);
});

test("같은 attemptId의 늦은 safe DETECTION_RESULT는 로컬 primaryRule 경고 UI를 되돌리지 않는다", () => {
  const { context, runtimeListeners } = createContentHarness();

  const result = vm.runInContext(
    `(() => {
      const badgeElement = { textContent: "" };
      const titleElement = { textContent: "" };
      const messageElement = {
        textContent: "",
        children: [],
        replaceChildren() {
          this.children = [];
          this.textContent = "";
        },
        append(...nodes) {
          this.children.push(...nodes);
          this.textContent += nodes.map((node) => node.textContent || "").join("");
        },
      };
      const statusElement = {
        dataset: {},
        querySelector(selector) {
          if (selector === "[data-status-badge]") return badgeElement;
          if (selector === "[data-status-title]") return titleElement;
          if (selector === "[data-status-message]") return messageElement;
          return null;
        },
      };
      const panelElement = {
        dataset: {},
        classList: { toggle() {} },
        remove() {},
        querySelector(selector) {
          if (selector === "[data-panel-rules-section]") return { hidden: false };
          if (selector === "[data-trade-feedback]") return { hidden: true };
          return { inert: false, setAttribute() {} };
        },
      };
      document.getElementById = (id) =>
        id === PANEL_ID ? panelElement : null;
      document.querySelector = (selector) =>
        selector === ".saltbread-analysis-status" ? statusElement : null;

      const snapshot = {
        snapshotId: "snapshot-safe-late",
        attemptId: "attempt-safe-late",
        market: "KRW-BTC",
        side: "BUY",
        orderMode: "MARKET",
        intentAmount: "5000"
      };
      const primaryRule = {
        ruleId: "market-buy-fast-burn-late",
        name: "시장가 매수",
        visualMode: "FAST_BURN",
        warningTitle: "테",
        warningMessage: "테스트요"
      };

      showDetectedGuardrailResult({
        detected: true,
        type: "USER_GUARDRAIL_RULE",
        message: "테스트요",
        warningTitle: "테",
        visualMode: "FAST_BURN",
        flameMode: "FAST_BURN",
        primaryRuleId: primaryRule.ruleId,
        primaryRule,
        ruleEvaluation: {
          detected: true,
          matchedRules: [primaryRule],
          matchedRuleIds: [primaryRule.ruleId],
          primaryRule,
          primaryRuleId: primaryRule.ruleId
        },
        orderContextSnapshot: snapshot
      }, snapshot);

      return {
        before: {
          panelFlameMode: panelElement.dataset.flameMode,
          statusState: statusElement.dataset.state,
          title: titleElement.textContent,
          message: messageElement.textContent
        },
        snapshot
      };
    })()`,
    context,
  );

  runtimeListeners[0](
    {
      type: "DETECTION_RESULT",
      payload: {
        detected: false,
        message: "safe",
        orderContextSnapshot: result.snapshot,
      },
    },
    {},
    () => {},
  );

  const after = vm.runInContext(
    `({
      panelFlameMode: document.getElementById(PANEL_ID).dataset.flameMode,
      statusState: document.querySelector(".saltbread-analysis-status").dataset.state,
      title: document.querySelector(".saltbread-analysis-status").querySelector("[data-status-title]").textContent,
      message: document.querySelector(".saltbread-analysis-status").querySelector("[data-status-message]").textContent
    })`,
    context,
  );

  assert.equal(result.before.panelFlameMode, "fast_burn");
  assert.equal(after.panelFlameMode, "fast_burn");
  assert.equal(after.statusState, "detected");
  assert.equal(after.title, "테");
  assert.match(after.message, /테스트요/);
});

test("실제 Upbit confirm button click은 UPBIT_CONFIRM_BUTTON_CLICKED debug를 남긴다", () => {
  const { context, debugEvents } = createContentHarness();

  runUpbitConfirmScenario(context, {
    buttonText: "매수 확인",
    modalText: "매수 주문 확인 주문유형 시장가 주문금액 5,000 KRW",
  });

  const clicked = debugEvents.find(
    (event) => event.kind === "UPBIT_CONFIRM_BUTTON_CLICKED",
  );

  assert.ok(clicked);
  assert.equal(clicked.payload.side, "BUY");
  assert.equal(clicked.payload.orderMode, "MARKET");
  assert.equal(Number(clicked.payload.intentAmount), 5000);
});

test("Upbit 시장가 매수 금액 추출 실패는 capture skipped reason을 남긴다", () => {
  const { context, debugEvents } = createContentHarness();

  const snapshot = runUpbitConfirmScenario(context, {
    buttonText: "매수 확인",
    modalText: "매수 주문 확인 주문유형 시장가",
  });

  assert.equal(snapshot, null);
  assert.ok(
    debugEvents.some(
      (event) =>
        event.kind === "UPBIT_ORDER_CAPTURE_SKIPPED" &&
        event.payload.reason === "missing_intent_amount_for_market_buy",
    ),
  );
});

test("Upbit 시장가 매수 성공 debug에는 BUY MARKET intentAmount가 들어간다", () => {
  const { context, debugEvents } = createContentHarness();

  runUpbitConfirmScenario(context, {
    buttonText: "매수 확인",
    modalText: "매수 주문 확인 주문유형 시장가 주문금액 5,000 KRW",
  });

  const captured = debugEvents.find(
    (event) => event.kind === "UPBIT_CONFIRM_ORDER_INTENT_CAPTURED",
  );

  assert.ok(captured);
  assert.equal(captured.payload.side, "BUY");
  assert.equal(captured.payload.orderMode, "MARKET");
  assert.equal(captured.payload.intentAmount, 5000);
});

test("confirm modal open detected=true이면 warning UI가 클릭 전에 실제 적용된다", () => {
  const { context, debugEvents } = createContentHarness();
  installWarningPanelStub(context, { collapsed: true });

  const result = vm.runInContext(
    `(() => {
      setPageGuardrailRulesState({
        source: "network",
        fetchedAt: "2026-07-08T00:00:00.000Z",
        rules: [{
          ruleId: "market-buy-fast-burn-open",
          name: "시장가 매수",
          isEnabled: true,
          priority: 1,
          visualMode: "FAST_BURN",
          warningTitle: "테",
          warningMessage: "테스트요",
          expression: {
            nodeType: "GROUP",
            operator: "AND",
            children: [
              {
                nodeType: "CONDITION",
                leftField: "side",
                operator: "EQ",
                rightOperand: { operandType: "LITERAL", value: "BUY" }
              },
              {
                nodeType: "CONDITION",
                leftField: "orderMode",
                operator: "EQ",
                rightOperand: { operandType: "LITERAL", value: "MARKET" }
              }
            ]
          }
        }]
      });
      startBehaviorTracking();

      const dialog = new Element();
      dialog.tagName = "DIV";
      dialog.textContent = "매수주문 확인 시장가 매수 BTC/KRW 총액 5,190 KRW 취소 매수 확인";
      dialog.dataset = {};
      dialog.className = "";
      dialog.parentElement = document.body;
      dialog.getAttribute = () => null;
      dialog.querySelectorAll = () => [];

      const button = new Element();
      button.tagName = "A";
      button.textContent = "매수 확인";
      button.dataset = {};
      button.className = "css-dgy70k";
      button.parentElement = dialog;
      button.querySelectorAll = () => [];
      button.getAttribute = () => null;
      button.closest = (selector) => {
        if (selector.includes("saltbread-extension-panel") || selector.includes("tablist")) {
          return null;
        }
        if (selector.includes("#QuoteOrderConfirmPopup") || selector.includes("#modal")) {
          return dialog;
        }
        if (selector.includes("button") || selector.includes("[role='button']") || selector.includes("a")) {
          return button;
        }
        return null;
      };

      handleUpbitConfirmModalOpen(button, dialog);
      const state = window.__SALTBREAD_UPBIT_DEBUG__.getState();
      return {
        flowState: upbitOrderFlow.state,
        pendingAttempt,
        title: __warningPanelStub.titleElement.textContent,
        message: __warningPanelStub.messageElement.textContent,
        panelCollapsed: __warningPanelStub.panelElement.dataset.collapsed,
        feedbackActive: __warningPanelStub.panelElement.dataset.feedbackActive,
        warningActive: __warningPanelStub.panelElement.dataset.warningActive,
        statusState: __warningPanelStub.statusElement.dataset.state,
        focused: __warningPanelStub.statusElement.focused,
        scrolled: __warningPanelStub.statusElement.scrolled,
        lastWarningUiApplied: state.lastWarningUiApplied,
        lastTradeFeedbackDto: state.lastTradeFeedbackDto
      };
    })()`,
    context,
  );

  assert.equal(result.flowState, "GUARDRAIL_SHOWN");
  assert.ok(result.pendingAttempt.guardrailShownAt);
  assert.ok(result.pendingAttempt.warningAppliedAt);
  assert.equal(result.pendingAttempt.feedbackShownAt, null);
  assert.equal(result.pendingAttempt.feedbackRespondedAt, null);
  assert.equal(result.lastTradeFeedbackDto, null);
  assert.equal(result.panelCollapsed, "false");
  assert.equal(result.feedbackActive, "false");
  assert.equal(result.warningActive, "true");
  assert.equal(result.statusState, "detected");
  assert.equal(result.title, "테");
  assert.match(result.message, /테스트요/);
  assert.equal(result.focused, true);
  assert.equal(result.scrolled, true);
  assert.ok(result.lastWarningUiApplied);
  assert.equal(result.lastWarningUiApplied.source, "UPBIT_CONFIRM_MODAL_OPEN");
  assert.equal(result.lastWarningUiApplied.visualMode, "FAST_BURN");
  assert.equal(result.lastWarningUiApplied.warningCardExists, true);
  assert.equal(result.lastWarningUiApplied.panelOpen, true);
  assert.equal(result.lastWarningUiApplied.activeView, "WARNING");
  assert.equal(result.lastWarningUiApplied.renderedTitle, "테");
  assert.match(result.lastWarningUiApplied.renderedMessage, /테스트요/);
  assert.equal(
    vm.runInContext(
      `window.__SALTBREAD_UPBIT_DEBUG__.getState().events.some((event) =>
        event.eventName === "UPBIT_WARNING_UI_APPLIED"
      )`,
      context,
    ),
    true,
  );
  assert.equal(
    debugEvents.some((event) => event.kind === "TradeFeedbackDTO"),
    false,
  );
});

test("이전 attempt의 FEEDBACK_COMPLETED lock은 새 confirm modal warning을 막지 않는다", () => {
  const { context, debugEvents } = createContentHarness();
  installWarningPanelStub(context);

  const result = vm.runInContext(
    `(() => {
      setPageGuardrailRulesState({
        source: "network",
        fetchedAt: "2026-07-08T00:00:00.000Z",
        rules: [{
          ruleId: "new-attempt-warning",
          name: "시장가 매수",
          isEnabled: true,
          visualMode: "FAST_BURN",
          warningTitle: "새 경고",
          warningMessage: "새 attempt 경고",
          expression: {
            nodeType: "CONDITION",
            leftField: "side",
            operator: "EQ",
            rightOperand: { operandType: "LITERAL", value: "BUY" }
          }
        }]
      });
      pendingAttempt = {
        attemptId: "attempt-a",
        snapshot: { attemptId: "attempt-a", snapshotId: "snapshot-a" },
        snapshotEmitted: true,
        feedbackShownAt: "2026-07-08T00:00:00.000Z",
        feedbackRespondedAt: "2026-07-08T00:00:01.000Z"
      };
      rememberFeedbackCompletedAttempt("attempt-a");
      upbitOrderFlow = createIdleUpbitOrderFlow();
      startBehaviorTracking();

      const dialog = new Element();
      dialog.tagName = "DIV";
      dialog.textContent = "매수주문 확인 시장가 매수 BTC/KRW 총액 5,190 KRW 취소 매수 확인";
      dialog.dataset = {};
      dialog.className = "";
      dialog.parentElement = document.body;
      dialog.getAttribute = () => null;
      dialog.querySelectorAll = () => [];

      const button = new Element();
      button.tagName = "A";
      button.textContent = "매수 확인";
      button.dataset = {};
      button.className = "css-dgy70k";
      button.parentElement = dialog;
      button.querySelectorAll = () => [];
      button.getAttribute = () => null;
      button.closest = (selector) => {
        if (selector.includes("saltbread-extension-panel") || selector.includes("tablist")) {
          return null;
        }
        if (selector.includes("#QuoteOrderConfirmPopup") || selector.includes("#modal")) {
          return dialog;
        }
        if (selector.includes("button") || selector.includes("[role='button']") || selector.includes("a")) {
          return button;
        }
        return null;
      };

      handleUpbitConfirmModalOpen(button, dialog);
      return {
        attemptId: pendingAttempt?.attemptId || null,
        flowState: upbitOrderFlow.state,
        lastWarningUiApplied: window.__SALTBREAD_UPBIT_DEBUG__.getState().lastWarningUiApplied
      };
    })()`,
    context,
  );

  assert.notEqual(result.attemptId, "attempt-a");
  assert.equal(result.flowState, "GUARDRAIL_SHOWN");
  assert.ok(result.lastWarningUiApplied);
  assert.equal(result.lastWarningUiApplied.primaryRuleId, "new-attempt-warning");
  assert.equal(
    debugEvents.some(
      (event) =>
        event.kind === "UPBIT_WARNING_UI_SKIPPED" &&
        event.payload.reason === "ATTEMPT_ALREADY_FEEDBACK_COMPLETED",
    ),
    false,
  );
});

test("warning UI apply 실패 시 skipped reason과 DOM 상태를 남긴다", () => {
  const { context, debugEvents } = createContentHarness();

  vm.runInContext(
    `(() => {
      const snapshot = {
        snapshotId: "snapshot-no-panel",
        attemptId: "attempt-no-panel",
        market: "KRW-BTC",
        side: "BUY",
        orderMode: "MARKET",
        intentAmount: "5190"
      };
      showDetectedGuardrailResult({
        detected: true,
        type: "USER_GUARDRAIL_RULE",
        message: "테스트요",
        warningTitle: "테",
        visualMode: "FAST_BURN",
        flameMode: "FAST_BURN",
        primaryRuleId: "rule-no-panel",
        primaryRule: {
          ruleId: "rule-no-panel",
          name: "시장가 매수",
          visualMode: "FAST_BURN",
          warningTitle: "테",
          warningMessage: "테스트요"
        },
        ruleEvaluation: { detected: true },
        orderContextSnapshot: snapshot
      }, snapshot, {
        source: "UPBIT_CONFIRM_MODAL_OPEN",
        renderMode: "WARNING_ONLY"
      });
    })()`,
    context,
  );

  const skipped = vm.runInContext(
    `window.__SALTBREAD_UPBIT_DEBUG__.getState().events.find((event) =>
      event.eventName === "UPBIT_WARNING_UI_SKIPPED" &&
      event.payload.reason === "NO_PANEL_ROOT"
    )`,
    context,
  );

  assert.ok(skipped);
  assert.equal(skipped.payload.source, "UPBIT_CONFIRM_MODAL_OPEN");
  assert.equal(skipped.payload.panelExists, false);
  assert.equal(skipped.payload.warningCardExists, false);
  assert.equal(skipped.payload.reason, "NO_PANEL_ROOT");
});

test("첫 매수 클릭 직후 confirm modal wait loop가 시작된다", () => {
  const { context } = createContentHarness();

  const result = vm.runInContext(
    `(() => {
      startBehaviorTracking();
      const panel = new Element();
      panel.tagName = "DIV";
      panel.textContent = "시장가 주문금액 주문가능";
      panel.dataset = {};
      panel.className = "";
      panel.parentElement = document.body;
      panel.getAttribute = () => null;
      const amountInput = new HTMLInputElement();
      amountInput.value = "5190";
      amountInput.labels = [];
      amountInput.parentElement = panel;
      amountInput.getAttribute = (name) =>
        name === "placeholder" ? "주문금액" : null;
      panel.querySelectorAll = (selector) => selector === "input" ? [amountInput] : [];

      const submitButton = new Element();
      submitButton.tagName = "BUTTON";
      submitButton.textContent = "매수";
      submitButton.dataset = {};
      submitButton.className = "order-button";
      submitButton.parentElement = panel;
      submitButton.querySelectorAll = () => [];
      submitButton.getAttribute = () => null;
      submitButton.closest = (selector) => {
        if (selector.includes("saltbread-extension-panel") || selector.includes("tablist")) {
          return null;
        }
        if (selector.includes("button") || selector.includes("[role='button']")) {
          return submitButton;
        }
        return null;
      };

      handleDocumentClick({ target: submitButton });
      const state = window.__SALTBREAD_UPBIT_DEBUG__.getState();
      return {
        attemptId: pendingAttempt?.attemptId || null,
        flowState: upbitOrderFlow.state,
        waitStarted: state.events.some((event) =>
          event.eventName === "UPBIT_CONFIRM_MODAL_WAIT_STARTED"
        ),
        formClicked: state.events.some((event) =>
          event.eventName === "UPBIT_FORM_SUBMIT_CLICKED"
        )
      };
    })()`,
    context,
  );

  assert.ok(result.attemptId);
  assert.equal(result.flowState, "FORM_SUBMIT_CLICKED");
  assert.equal(result.formClicked, true);
  assert.equal(result.waitStarted, true);
});

test("confirm modal이 뒤늦게 DOM에 나타나면 polling이 confirm click 전에 잡는다", () => {
  const { context } = createContentHarness();
  installWarningPanelStub(context);

  const result = vm.runInContext(
    `(() => {
      setPageGuardrailRulesState({
        source: "network",
        fetchedAt: "2026-07-08T00:00:00.000Z",
        rules: [{
          ruleId: "polling-market-buy",
          name: "시장가 매수",
          isEnabled: true,
          visualMode: "FAST_BURN",
          warningTitle: "테",
          warningMessage: "테스트요",
          expression: {
            nodeType: "CONDITION",
            leftField: "side",
            operator: "EQ",
            rightOperand: { operandType: "LITERAL", value: "BUY" }
          }
        }]
      });
      const timeoutCallbacks = [];
      window.setTimeout = (callback) => {
        timeoutCallbacks.push(callback);
        return timeoutCallbacks.length;
      };
      window.clearTimeout = () => {};
      requestAnimationFrame = () => 0;
      window.requestAnimationFrame = requestAnimationFrame;

      startBehaviorTracking();
      let modalVisible = false;
      const dialog = new Element();
      dialog.tagName = "DIV";
      dialog.textContent = "매수주문 확인 시장가 매수 BTC/KRW 총액 5,190 KRW 취소 매수 확인";
      dialog.dataset = {};
      dialog.className = "";
      dialog.parentElement = document.body;
      dialog.hidden = false;
      dialog.getAttribute = () => null;

      const confirmButton = new Element();
      confirmButton.tagName = "A";
      confirmButton.textContent = "매수 확인";
      confirmButton.dataset = {};
      confirmButton.className = "css-dgy70k";
      confirmButton.parentElement = dialog;
      confirmButton.querySelectorAll = () => [];
      confirmButton.getAttribute = () => null;
      confirmButton.closest = (selector) => {
        if (selector.includes("saltbread-extension-panel") || selector.includes("tablist")) {
          return null;
        }
        if (selector.includes("#QuoteOrderConfirmPopup") || selector.includes("#modal")) {
          return dialog;
        }
        if (selector.includes("button") || selector.includes("[role='button']") || selector.includes("a")) {
          return confirmButton;
        }
        return null;
      };
      dialog.querySelectorAll = (selector) =>
        selector.includes("button") || selector.includes("a") ? [confirmButton] : [];
      dialog.matches = (selector) => selector.includes("#modal") || selector.includes("[role='dialog']");

      const originalQuerySelectorAll = document.querySelectorAll;
      document.querySelectorAll = (selector) =>
        selector === UPBIT_ORDER_DIALOG_SELECTOR && modalVisible
          ? [dialog]
          : originalQuerySelectorAll.call(document, selector);

      const panel = new Element();
      panel.tagName = "DIV";
      panel.textContent = "시장가 주문금액 주문가능";
      panel.dataset = {};
      panel.className = "";
      panel.parentElement = document.body;
      panel.getAttribute = () => null;
      const amountInput = new HTMLInputElement();
      amountInput.value = "5190";
      amountInput.labels = [];
      amountInput.parentElement = panel;
      amountInput.getAttribute = (name) =>
        name === "placeholder" ? "주문금액" : null;
      panel.querySelectorAll = (selector) => selector === "input" ? [amountInput] : [];

      const submitButton = new Element();
      submitButton.tagName = "BUTTON";
      submitButton.textContent = "매수";
      submitButton.dataset = {};
      submitButton.className = "order-button";
      submitButton.parentElement = panel;
      submitButton.querySelectorAll = () => [];
      submitButton.getAttribute = () => null;
      submitButton.closest = (selector) => {
        if (selector.includes("saltbread-extension-panel") || selector.includes("tablist")) {
          return null;
        }
        if (selector.includes("button") || selector.includes("[role='button']")) {
          return submitButton;
        }
        return null;
      };

      handleDocumentClick({ target: submitButton });
      modalVisible = true;
      const tick = timeoutCallbacks.shift();
      tick();
      const state = window.__SALTBREAD_UPBIT_DEBUG__.getState();
      return {
        flowState: upbitOrderFlow.state,
        warningAppliedAt: pendingAttempt?.warningAppliedAt || null,
        feedbackShownAt: pendingAttempt?.feedbackShownAt || null,
        earlyDetected: state.events.some((event) =>
          event.eventName === "UPBIT_CONFIRM_MODAL_EARLY_DETECTED"
        ),
        confirmOpenSource: state.events.find((event) =>
          event.eventName === "UPBIT_CONFIRM_MODAL_OPEN"
        )?.payload?.source || null,
        warningApplied: Boolean(state.lastWarningUiApplied)
      };
    })()`,
    context,
  );

  assert.equal(result.earlyDetected, true);
  assert.equal(result.confirmOpenSource, "FORM_SUBMIT_POLLING");
  assert.equal(result.flowState, "GUARDRAIL_SHOWN");
  assert.ok(result.warningAppliedAt);
  assert.equal(result.feedbackShownAt, null);
  assert.equal(result.warningApplied, true);
});

test("confirm click handler late fallback은 실패 진단 로그를 남긴다", () => {
  const { context } = createContentHarness();
  installWarningPanelStub(context);

  const result = vm.runInContext(
    `(() => {
      setPageGuardrailRulesState({
        source: "network",
        fetchedAt: "2026-07-08T00:00:00.000Z",
        rules: [{
          ruleId: "late-market-buy",
          name: "시장가 매수",
          isEnabled: true,
          visualMode: "FAST_BURN",
          warningTitle: "테",
          warningMessage: "테스트요",
          expression: {
            nodeType: "CONDITION",
            leftField: "side",
            operator: "EQ",
            rightOperand: { operandType: "LITERAL", value: "BUY" }
          }
        }]
      });
      startBehaviorTracking();

      const dialog = new Element();
      dialog.tagName = "DIV";
      dialog.textContent = "매수주문 확인 시장가 매수 BTC/KRW 총액 5,190 KRW 취소 매수 확인";
      dialog.dataset = {};
      dialog.className = "";
      dialog.parentElement = document.body;
      dialog.getAttribute = () => null;
      dialog.querySelectorAll = () => [];

      const button = new Element();
      button.tagName = "A";
      button.textContent = "매수 확인";
      button.dataset = {};
      button.className = "css-dgy70k";
      button.parentElement = dialog;
      button.querySelectorAll = () => [];
      button.getAttribute = () => null;
      button.closest = (selector) => {
        if (selector.includes("saltbread-extension-panel") || selector.includes("tablist")) {
          return null;
        }
        if (selector.includes("#QuoteOrderConfirmPopup") || selector.includes("#modal")) {
          return dialog;
        }
        if (selector.includes("button") || selector.includes("[role='button']") || selector.includes("a")) {
          return button;
        }
        return null;
      };

      handleDocumentClick({ target: button });
      const state = window.__SALTBREAD_UPBIT_DEBUG__.getState();
      return {
        late: state.events.some((event) =>
          event.eventName === "UPBIT_CONFIRM_MODAL_LATE_DETECTED_ON_CONFIRM_CLICK"
        ),
        withoutPriorWarning: state.events.some((event) =>
          event.eventName === "UPBIT_CONFIRM_CLICK_WITHOUT_PRIOR_WARNING"
        )
      };
    })()`,
    context,
  );

  assert.equal(result.late, true);
  assert.equal(result.withoutPriorWarning, true);
});

test("polling 정상 감지 후 confirm click은 late 로그 없이 warning lead time을 남긴다", () => {
  const { context } = createContentHarness();
  installWarningPanelStub(context);

  const result = vm.runInContext(
    `(() => {
      setPageGuardrailRulesState({
        source: "network",
        fetchedAt: "2026-07-08T00:00:00.000Z",
        rules: [{
          ruleId: "normal-market-buy",
          name: "시장가 매수",
          isEnabled: true,
          visualMode: "FAST_BURN",
          warningTitle: "테",
          warningMessage: "테스트요",
          expression: {
            nodeType: "CONDITION",
            leftField: "side",
            operator: "EQ",
            rightOperand: { operandType: "LITERAL", value: "BUY" }
          }
        }]
      });
      startBehaviorTracking();
      const dialog = new Element();
      dialog.tagName = "DIV";
      dialog.textContent = "매수주문 확인 시장가 매수 BTC/KRW 총액 5,190 KRW 취소 매수 확인";
      dialog.dataset = {};
      dialog.className = "";
      dialog.parentElement = document.body;
      dialog.getAttribute = () => null;

      const button = new Element();
      button.tagName = "A";
      button.textContent = "매수 확인";
      button.dataset = {};
      button.className = "css-dgy70k";
      button.parentElement = dialog;
      button.querySelectorAll = () => [];
      button.getAttribute = () => null;
      button.closest = (selector) => {
        if (selector.includes("saltbread-extension-panel") || selector.includes("tablist")) {
          return null;
        }
        if (selector.includes("#QuoteOrderConfirmPopup") || selector.includes("#modal")) {
          return dialog;
        }
        if (selector.includes("button") || selector.includes("[role='button']") || selector.includes("a")) {
          return button;
        }
        return null;
      };
      dialog.querySelectorAll = () => [button];

      upbitOrderFlow = {
        ...createIdleUpbitOrderFlow(),
        state: "FORM_SUBMIT_CLICKED",
        attemptId: "attempt-normal-poll",
        formRoot: null,
        market: "KRW-BTC",
        side: "BUY",
        orderMode: "MARKET"
      };
      pendingAttempt = {
        attemptId: "attempt-normal-poll",
        snapshot: null,
        snapshotEmitted: true,
        guardrailShownAt: null,
        warningAppliedAt: null,
        confirmClickedAt: null,
        feedbackShownAt: null,
        feedbackRespondedAt: null
      };
      scanAndHandleUpbitOrderModal({
        attemptId: "attempt-normal-poll",
        modalRoot: dialog,
        source: "FORM_SUBMIT_POLLING",
        tickCount: 3,
        detectionLagMs: 100
      });
      pendingAttempt.warningAppliedAt = new Date(Date.now() - 1000).toISOString();
      handleDocumentClick({
        target: button,
        defaultPrevented: false,
        propagationStopped: false,
        immediatePropagationStopped: false,
        preventDefault() { this.defaultPrevented = true; },
        stopPropagation() { this.propagationStopped = true; },
        stopImmediatePropagation() { this.immediatePropagationStopped = true; }
      });
      const state = window.__SALTBREAD_UPBIT_DEBUG__.getState();
      const clicked = state.events.find((event) =>
        event.eventName === "UPBIT_CONFIRM_BUTTON_CLICKED"
      );
      const requested = state.events.find((event) =>
        event.eventName === "UPBIT_FEEDBACK_REQUESTED_AFTER_CONFIRM_CLICK"
      );
      return {
        late: state.events.some((event) =>
          event.eventName === "UPBIT_CONFIRM_MODAL_LATE_DETECTED_ON_CONFIRM_CLICK"
        ),
        withoutPriorWarning: state.events.some((event) =>
          event.eventName === "UPBIT_CONFIRM_CLICK_WITHOUT_PRIOR_WARNING"
        ),
        warningLeadTimeMs: clicked?.payload?.warningLeadTimeMs ?? null,
        warningWasVisibleBeforeConfirmClick:
          clicked?.payload?.warningWasVisibleBeforeConfirmClick ?? false,
        activeViewBeforeFeedback:
          requested?.payload?.activeViewBeforeFeedback || null
      };
    })()`,
    context,
  );

  assert.equal(result.late, false);
  assert.equal(result.withoutPriorWarning, false);
  assert.ok(result.warningLeadTimeMs >= 300);
  assert.equal(result.warningWasVisibleBeforeConfirmClick, true);
  assert.equal(result.activeViewBeforeFeedback, "WARNING");
});

test("validation modal도 polling으로 잡고 warning/feedback을 만들지 않는다", () => {
  const { context } = createContentHarness();
  installWarningPanelStub(context);

  const result = vm.runInContext(
    `(() => {
      const timeoutCallbacks = [];
      window.setTimeout = (callback) => {
        timeoutCallbacks.push(callback);
        return timeoutCallbacks.length;
      };
      window.clearTimeout = () => {};
      requestAnimationFrame = () => 0;
      window.requestAnimationFrame = requestAnimationFrame;

      startBehaviorTracking();
      let modalVisible = false;
      const dialog = new Element();
      dialog.tagName = "DIV";
      dialog.textContent = "매수 주문 안내 주문 가능 금액이 부족합니다. 확인";
      dialog.dataset = {};
      dialog.className = "";
      dialog.parentElement = document.body;
      dialog.hidden = false;
      dialog.getAttribute = () => null;

      const okButton = new Element();
      okButton.tagName = "A";
      okButton.textContent = "확인";
      okButton.dataset = {};
      okButton.className = "css-dgy70k";
      okButton.parentElement = dialog;
      okButton.querySelectorAll = () => [];
      okButton.getAttribute = () => null;
      okButton.closest = (selector) => {
        if (selector.includes("saltbread-extension-panel") || selector.includes("tablist")) {
          return null;
        }
        if (selector.includes("#QuoteOrderConfirmPopup") || selector.includes("#modal")) {
          return dialog;
        }
        if (selector.includes("button") || selector.includes("[role='button']") || selector.includes("a")) {
          return okButton;
        }
        return null;
      };
      dialog.querySelectorAll = () => [okButton];
      dialog.matches = (selector) => selector.includes("#modal") || selector.includes("[role='dialog']");

      const originalQuerySelectorAll = document.querySelectorAll;
      document.querySelectorAll = (selector) =>
        selector === UPBIT_ORDER_DIALOG_SELECTOR && modalVisible
          ? [dialog]
          : originalQuerySelectorAll.call(document, selector);

      const panel = new Element();
      panel.tagName = "DIV";
      panel.textContent = "시장가 주문금액 주문가능";
      panel.dataset = {};
      panel.className = "";
      panel.parentElement = document.body;
      panel.getAttribute = () => null;
      const amountInput = new HTMLInputElement();
      amountInput.value = "5190";
      amountInput.labels = [];
      amountInput.parentElement = panel;
      amountInput.getAttribute = (name) =>
        name === "placeholder" ? "주문금액" : null;
      panel.querySelectorAll = (selector) => selector === "input" ? [amountInput] : [];

      const submitButton = new Element();
      submitButton.tagName = "BUTTON";
      submitButton.textContent = "매수";
      submitButton.dataset = {};
      submitButton.className = "order-button";
      submitButton.parentElement = panel;
      submitButton.querySelectorAll = () => [];
      submitButton.getAttribute = () => null;
      submitButton.closest = (selector) => {
        if (selector.includes("saltbread-extension-panel") || selector.includes("tablist")) {
          return null;
        }
        if (selector.includes("button") || selector.includes("[role='button']")) {
          return submitButton;
        }
        return null;
      };

      handleDocumentClick({ target: submitButton });
      modalVisible = true;
      timeoutCallbacks.shift()();
      const state = window.__SALTBREAD_UPBIT_DEBUG__.getState();
      return {
        flowState: upbitOrderFlow.state,
        validationOpen: state.events.some((event) =>
          event.eventName === "UPBIT_VALIDATION_MODAL_OPEN"
        ),
        warningApplied: Boolean(state.lastWarningUiApplied),
        feedbackActive: Boolean(activeTradeFeedback),
        tradeFeedbackDto: state.lastTradeFeedbackDto
      };
    })()`,
    context,
  );

  assert.equal(result.flowState, "VALIDATION_MODAL_OPEN");
  assert.equal(result.validationOpen, true);
  assert.equal(result.warningApplied, false);
  assert.equal(result.feedbackActive, false);
  assert.equal(result.tradeFeedbackDto, null);
});

test("debug payload sanitizer는 token과 key 계열 값을 redaction한다", () => {
  const { context } = createContentHarness();

  const sanitized = vm.runInContext(
    `sanitizeDebugPayload({
      accessToken: "access-token",
      refreshToken: "refresh-token",
      Authorization: "Bearer firebase-token",
      apiKey: "api-key",
      upbitAccessKey: "upbit-access-key",
      nested: {
        secretKey: "upbit-secret-key",
        value: "safe"
      }
    })`,
    context,
  );

  assert.equal(sanitized.accessToken, "[REDACTED]");
  assert.equal(sanitized.refreshToken, "[REDACTED]");
  assert.equal(sanitized.Authorization, "[REDACTED]");
  assert.equal(sanitized.apiKey, "[REDACTED]");
  assert.equal(sanitized.upbitAccessKey, "[REDACTED]");
  assert.equal(sanitized.nested.secretKey, "[REDACTED]");
  assert.equal(sanitized.nested.value, "safe");
});

test("UPBIT_RULE_EVALUATION_RESULT debug는 helper state에 lastRuleEvaluation을 저장한다", () => {
  const { context } = createContentHarness();

  const result = vm.runInContext(
    `(() => {
      installUpbitDebugHelper();
      debugUpbitOrder("UPBIT_RULE_EVALUATION_RESULT", {
        ruleEvaluation: {
          detected: false,
          matchedRules: [],
          primaryRule: null,
          conditionResults: [{
            ruleName: "시장가 매수",
            leftField: "side",
            operator: "EQ",
            expectedValue: "BUY",
            actualValue: "BUY",
            actualType: "string",
            pass: true
          }]
        }
      });
      return window.__SALTBREAD_UPBIT_DEBUG__.getState().lastRuleEvaluation;
    })()`,
    context,
  );

  assert.ok(result);
  assert.equal(result.detected, false);
  assert.equal(result.conditionResults[0].actualValue, "BUY");
});

test("printLastRuleEvaluation은 conditionResults가 있으면 console.table을 호출한다", () => {
  const { context } = createContentHarness();

  const result = vm.runInContext(
    `(() => {
      tableCalls = [];
      const originalTable = console.table;
      const originalLog = console.log;
      console.table = (value) => tableCalls.push(value);
      console.log = () => {};
      installUpbitDebugHelper();
      debugUpbitOrder("UPBIT_RULE_EVALUATION_RESULT", {
        ruleEvaluation: {
          detected: false,
          conditionResults: [{
            ruleName: "시장가 매수",
            leftField: "orderMode",
            operator: "EQ",
            expectedValue: "MARKET",
            actualValue: "LIMIT",
            actualType: "string",
            pass: false
          }]
        }
      });
      window.__SALTBREAD_UPBIT_DEBUG__.printLastRuleEvaluation();
      console.table = originalTable;
      console.log = originalLog;
      return tableCalls;
    })()`,
    context,
  );

  assert.equal(result.length, 1);
  assert.equal(result[0][0].leftField, "orderMode");
  assert.equal(result[0][0].pass, false);
});

test("ORDER_INTENT_CLICK debug는 helper state에 lastOrderIntentDto를 저장한다", () => {
  const { context } = createContentHarness();

  const result = vm.runInContext(
    `(() => {
      installUpbitDebugHelper();
      debugUpbitOrder("ORDER_INTENT_CLICK", {
        dto: {
          side: "BUY",
          orderMode: "MARKET",
          intentAmount: "5000"
        }
      });
      return window.__SALTBREAD_UPBIT_DEBUG__.getState().lastOrderIntentDto;
    })()`,
    context,
  );

  assert.equal(result.side, "BUY");
  assert.equal(result.orderMode, "MARKET");
  assert.equal(result.intentAmount, "5000");
});

test("UPBIT_ORDER_EXTRACTION_RESULT debug는 helper state에 lastExtractionResult를 저장한다", () => {
  const { context } = createContentHarness();

  const result = vm.runInContext(
    `(() => {
      installUpbitDebugHelper();
      debugUpbitOrder("UPBIT_ORDER_EXTRACTION_RESULT", {
        final: {
          side: "BUY",
          orderMode: "MARKET",
          intentAmount: 5000
        }
      });
      return window.__SALTBREAD_UPBIT_DEBUG__.getState().lastExtractionResult;
    })()`,
    context,
  );

  assert.equal(result.final.side, "BUY");
  assert.equal(result.final.orderMode, "MARKET");
  assert.equal(result.final.intentAmount, 5000);
});

test("UPBIT_ORDER_CAPTURE_SKIPPED debug는 helper state에 reason과 payload를 저장한다", () => {
  const { context } = createContentHarness();

  const result = vm.runInContext(
    `(() => {
      installUpbitDebugHelper();
      debugUpbitOrder("UPBIT_ORDER_CAPTURE_SKIPPED", {
        reason: "missing_intent_amount_for_market_buy",
        side: "BUY",
        orderMode: "MARKET"
      });
      const state = window.__SALTBREAD_UPBIT_DEBUG__.getState();
      return {
        reason: state.lastSkipReason,
        payload: state.lastSkipPayload
      };
    })()`,
    context,
  );

  assert.equal(result.reason, "missing_intent_amount_for_market_buy");
  assert.equal(result.payload.side, "BUY");
  assert.equal(result.payload.orderMode, "MARKET");
});

test("manifest는 Upbit MAIN world debug bridge를 document_start로 등록한다", () => {
  const manifest = JSON.parse(
    fs.readFileSync(
      path.join(__dirname, "../chrome-extension/manifest.json"),
      "utf8",
    ),
  );
  const bridgeScript = manifest.content_scripts.find((script) =>
    script.js?.includes("upbit-debug-bridge-main.js"),
  );

  assert.ok(bridgeScript);
  assert.equal(bridgeScript.world, "MAIN");
  assert.equal(bridgeScript.run_at, "document_start");
  assert.deepEqual(bridgeScript.js, ["upbit-debug-bridge-main.js"]);
  assert.ok(bridgeScript.matches.includes("https://upbit.com/exchange*"));
  assert.ok(bridgeScript.matches.includes("https://www.upbit.com/exchange*"));
});

test("MAIN world bridge 파일은 helper를 정의하고 초기 getState를 안전하게 제공한다", () => {
  const bridgePath = path.join(
    __dirname,
    "../chrome-extension/upbit-debug-bridge-main.js",
  );
  const bridgeSource = fs.readFileSync(bridgePath, "utf8");

  assert.match(bridgeSource, /window\.__SALTBREAD_UPBIT_DEBUG__/);
  assert.match(bridgeSource, /printLastRuleEvaluation/);

  const mainWorld = {
    console: { info() {}, log() {}, table() {} },
    localStorage: { setItem() {} },
    structuredClone,
    listeners: {},
    addEventListener(type, listener) {
      this.listeners[type] ||= [];
      this.listeners[type].push(listener);
    },
  };
  mainWorld.window = mainWorld;
  vm.createContext(mainWorld);
  vm.runInContext(bridgeSource, mainWorld);

  assert.equal(typeof mainWorld.__SALTBREAD_UPBIT_DEBUG__, "object");
  assert.equal(mainWorld.__SALTBREAD_UPBIT_DEBUG__.__installed, true);
  assert.equal(mainWorld.__SALTBREAD_UPBIT_DEBUG__.getState(), null);
});

test("content.js는 CSP를 깨는 inline script textContent 주입을 하지 않는다", () => {
  const contentSource = fs.readFileSync(
    path.join(__dirname, "../chrome-extension/content.js"),
    "utf8",
  );

  assert.doesNotMatch(contentSource, /script\.textContent\s*=/);
  assert.doesNotMatch(contentSource, /appendChild\(script\)/);
});

test("rememberUpbitDebugEvent는 MAIN world로 최신 state를 publish한다", () => {
  const { context, sentWindowMessages } = createContentHarness({
    location: {
      href: "https://upbit.com/exchange?code=CRIX.UPBIT.KRW-BTC",
      origin: "https://upbit.com",
      pathname: "/exchange",
      protocol: "https:",
    },
  });
  const previousCount = sentWindowMessages.length;

  vm.runInContext(
    `rememberUpbitDebugEvent("UPBIT_RULE_EVALUATION_RESULT", {
      ruleEvaluation: {
        detected: false,
        conditionResults: [{
          leftField: "side",
          actualValue: "BUY",
          pass: true
        }]
      }
    });`,
    context,
  );

  assert.equal(sentWindowMessages.length, previousCount + 1);
  const published = sentWindowMessages.at(-1);
  assert.equal(published.targetOrigin, "https://upbit.com");
  assert.equal(published.message.source, "SALTBREAD_UPBIT_DEBUG_BRIDGE");
  assert.equal(published.message.type, "SALTBREAD_UPBIT_DEBUG_STATE");
  assert.equal(
    published.message.state.lastRuleEvaluation.conditionResults[0].actualValue,
    "BUY",
  );
});

test("MAIN world postMessage payload는 token/key 계열 값을 redaction한다", () => {
  const { context, sentWindowMessages } = createContentHarness({
    location: {
      href: "https://upbit.com/exchange?code=CRIX.UPBIT.KRW-BTC",
      origin: "https://upbit.com",
      pathname: "/exchange",
      protocol: "https:",
    },
  });

  vm.runInContext(
    `rememberUpbitDebugEvent("UPBIT_ORDER_CAPTURE_SKIPPED", {
      reason: "debug_sanitize",
      accessToken: "access-token",
      refreshToken: "refresh-token",
      Authorization: "Bearer token",
      apiKey: "api-key",
      nested: {
        secretKey: "secret-key",
        safe: "ok"
      }
    });`,
    context,
  );

  const payload = sentWindowMessages.at(-1).message.state.lastSkipPayload;
  assert.equal(payload.accessToken, "[REDACTED]");
  assert.equal(payload.refreshToken, "[REDACTED]");
  assert.equal(payload.Authorization, "[REDACTED]");
  assert.equal(payload.apiKey, "[REDACTED]");
  assert.equal(payload.nested.secretKey, "[REDACTED]");
  assert.equal(payload.nested.safe, "ok");
});

test("Upbit 지정가 매수는 LIMIT 모드와 가격·수량·총액을 수집한다", () => {
  const { context } = createContentHarness();
  const snapshot = runUpbitConfirmScenario(context, {
    buttonText: "매수 확인",
    modalText: "매수 주문 확인 주문구분 지정가 가격 100 수량 2 주문총액 200 KRW",
  });

  assert.equal(snapshot.side, "BUY");
  assert.equal(snapshot.orderMode, "LIMIT");
  assert.equal(snapshot.intentPrice, "100");
  assert.equal(snapshot.intentQuantity, "2");
  assert.equal(snapshot.intentAmount, "200");
});

test("Upbit 시장가 매도는 MARKET 모드와 매도수량을 수집한다", () => {
  const { context } = createContentHarness();
  const snapshot = runUpbitConfirmScenario(context, {
    buttonText: "매도 확인",
    modalText: "매도 주문 확인 주문유형 시장가 매도수량 3.5 DOGE",
  });

  assert.equal(snapshot.side, "SELL");
  assert.equal(snapshot.orderMode, "MARKET");
  assert.equal(snapshot.intentQuantity, "3.5");
  assert.equal(snapshot.intentPrice, null);
  assert.equal(snapshot.intentAmount, null);
});

test("피드백 응답 후 완료 모달 확인을 눌러도 피드백을 다시 열지 않는다", () => {
  const { context, debugEvents } = createContentHarness();

  const result = vm.runInContext(
    `(() => {
      startBehaviorTracking();

      const dialog = new Element();
      dialog.tagName = "DIV";
      dialog.textContent = "매수 주문 안내 시장가 주문금액 10000";
      dialog.dataset = {};
      dialog.className = "";
      dialog.parentElement = document.body;
      dialog.getAttribute = () => null;
      dialog.querySelectorAll = () => [];

      const button = new Element();
      button.tagName = "A";
      button.textContent = "매수 확인";
      button.dataset = {};
      button.className = "css-dgy70k";
      button.parentElement = dialog;
      button.querySelectorAll = () => [];
      button.getAttribute = () => null;
      button.closest = (selector) => {
        if (selector.includes("saltbread-extension-panel") || selector.includes("tablist")) {
          return null;
        }
        if (selector.includes("#QuoteOrderConfirmPopup") || selector.includes("#modal")) {
          return dialog;
        }
        if (selector.includes("button") || selector.includes("[role='button']") || selector.includes("a")) {
          return button;
        }
        return null;
      };

      const event = {
        target: button,
        defaultPrevented: false,
        propagationStopped: false,
        immediatePropagationStopped: false,
        preventDefault() { this.defaultPrevented = true; },
        stopPropagation() { this.propagationStopped = true; },
        stopImmediatePropagation() { this.immediatePropagationStopped = true; }
      };

      handleDocumentClick(event);
      const firstAttemptId = activeTradeFeedback?.attemptId || null;
      answerTradeFeedback("PLANNED");

      const completionDialog = new Element();
      completionDialog.tagName = "DIV";
      completionDialog.textContent = "주문이 접수되었습니다.";
      completionDialog.dataset = {};
      completionDialog.className = "";
      completionDialog.parentElement = document.body;
      completionDialog.getAttribute = () => null;
      completionDialog.querySelectorAll = () => [];

      const okButton = new Element();
      okButton.tagName = "A";
      okButton.textContent = "확인";
      okButton.dataset = {};
      okButton.className = "css-dgy70k";
      okButton.parentElement = completionDialog;
      okButton.querySelectorAll = () => [];
      okButton.getAttribute = () => null;
      okButton.closest = (selector) => {
        if (selector.includes("saltbread-extension-panel") || selector.includes("tablist")) {
          return null;
        }
        if (selector.includes("#QuoteOrderConfirmPopup") || selector.includes("#modal")) {
          return completionDialog;
        }
        if (selector.includes("button") || selector.includes("[role='button']") || selector.includes("a")) {
          return okButton;
        }
        return null;
      };
      handleDocumentClick({ ...event, target: okButton });

      return {
        firstAttemptId,
        feedbackActiveAfterSecondClick: Boolean(activeTradeFeedback),
        feedbackRespondedAt: pendingAttempt?.feedbackRespondedAt || null,
        currentAttemptId: pendingAttempt?.attemptId || null
      };
    })()`,
    context,
  );

  assert.ok(result.firstAttemptId);
  assert.equal(result.feedbackActiveAfterSecondClick, false);
  assert.ok(result.feedbackRespondedAt);
  assert.equal(result.currentAttemptId, result.firstAttemptId);
  assert.equal(
    debugEvents.filter((event) => event.kind === "TradeFeedbackDTO").length,
    1,
  );
  assert.equal(
    debugEvents.filter((event) => event.kind === "ORDER_INTENT_CLICK").length,
    1,
  );
  assert.equal(
    debugEvents.some((event) => event.kind === "UPBIT_ORDER_COMPLETION_ACK"),
    true,
  );
});

test("활성 경고가 있어도 Upbit 확인 클릭 source는 피드백 UI를 표시한다", () => {
  const { context, debugEvents, sentRuntimeMessages } = createContentHarness();

  const result = vm.runInContext(
    `(() => {
      setPageGuardrailRulesState({
        source: "network",
        fetchedAt: "2026-07-08T00:00:00.000Z",
        rules: [{
          ruleId: "buy-warning",
          isEnabled: true,
          priority: 1,
          riskLevel: "HIGH",
          visualMode: "SAD",
          warningTitle: "매수 전 확인",
          warningMessage: "그래도 진행할지 확인합니다.",
          expression: {
            nodeType: "CONDITION",
            leftField: "side",
            operator: "EQ",
            rightOperand: {
              operandType: "LITERAL",
              value: "BUY"
            }
          }
        }]
      });
      startBehaviorTracking();
      readOrderDraft = () => ({
        market: "KRW-BTC",
        order_side: "BUY",
        order_status: "WAIT",
        order_type: "MARKET",
        order_price: null,
        order_volume: null,
        order_amount: 10000,
        realized_loss_pct_1h: null,
        order_request_time: new Date().toISOString(),
        order_cancel_time: null
      });
      beginOrderAttempt(null);

      const dialog = new Element();
      dialog.tagName = "DIV";
      dialog.textContent = "매수 주문 안내 시장가 주문금액 10000";
      dialog.dataset = {};
      dialog.className = "";
      dialog.parentElement = document.body;
      dialog.getAttribute = () => null;
      dialog.querySelectorAll = () => [];

      const button = new Element();
      button.tagName = "A";
      button.textContent = "매수 확인";
      button.dataset = {};
      button.className = "css-dgy70k";
      button.parentElement = dialog;
      button.querySelectorAll = () => [];
      button.getAttribute = () => null;
      button.closest = (selector) => {
        if (selector.includes("saltbread-extension-panel") || selector.includes("tablist")) {
          return null;
        }
        if (selector.includes("#QuoteOrderConfirmPopup") || selector.includes("#modal")) {
          return dialog;
        }
        if (selector.includes("button") || selector.includes("[role='button']") || selector.includes("a")) {
          return button;
        }
        return null;
      };

      const event = {
        target: button,
        defaultPrevented: false,
        propagationStopped: false,
        immediatePropagationStopped: false,
        preventDefault() { this.defaultPrevented = true; },
        stopPropagation() { this.propagationStopped = true; },
        stopImmediatePropagation() { this.immediatePropagationStopped = true; }
      };
      handleDocumentClick(event);

      return {
        hasActiveWarning: Boolean(activeDetectionResult?.detected),
        activeSnapshotId: activeGuardrailSnapshotId || null,
        feedbackActive: Boolean(activeTradeFeedback),
        feedbackAttemptId: activeTradeFeedback?.attemptId || null,
        feedbackShownAt: pendingAttempt?.feedbackShownAt || null,
        defaultPrevented: event.defaultPrevented,
        propagationStopped: event.propagationStopped,
        immediatePropagationStopped: event.immediatePropagationStopped,
        flowState: upbitOrderFlow.state
      };
    })()`,
    context,
  );

  assert.equal(result.defaultPrevented, false);
  assert.equal(result.propagationStopped, false);
  assert.equal(result.immediatePropagationStopped, false);
  assert.equal(result.hasActiveWarning, false);
  assert.equal(result.activeSnapshotId, null);
  assert.equal(result.feedbackActive, true);
  assert.ok(result.feedbackAttemptId);
  assert.ok(result.feedbackShownAt);
  assert.equal(result.flowState, "FEEDBACK_SHOWN");
  assert.equal(
    debugEvents.some(
      (event) =>
        event.kind === "GuardrailReactionDTO" &&
        event.payload.action === "PROCEED",
    ),
    false,
  );
  assert.equal(
    debugEvents.some(
      (event) => event.kind === "UPBIT_FEEDBACK_SKIPPED_ACTIVE_WARNING",
    ),
    false,
  );
  assert.equal(
    debugEvents.some(
      (event) => event.kind === "UPBIT_FEEDBACK_SHOWN_AFTER_CONFIRM_CLICK",
    ),
    true,
  );
  assert.ok(
    sentRuntimeMessages.some(
      (message) => message.type === "ORDER_ACTION_DETECTED",
    ),
  );
});

test("Upbit 자금 부족 안내 모달의 확인은 주문 의도로 잡지 않는다", () => {
  const { context, debugEvents } = createContentHarness();

  const result = vm.runInContext(
    `(() => {
      startBehaviorTracking();

      const panel = new Element();
      panel.tagName = "DIV";
      panel.textContent = "시장가 주문금액 주문가능";
      panel.dataset = {};
      panel.className = "";
      panel.parentElement = document.body;
      panel.getAttribute = () => null;
      const amountInput = new HTMLInputElement();
      amountInput.value = "10000";
      amountInput.labels = [];
      amountInput.parentElement = panel;
      amountInput.getAttribute = (name) =>
        name === "placeholder" ? "주문금액" : null;
      panel.querySelectorAll = (selector) => selector === "input" ? [amountInput] : [];

      const submitButton = new Element();
      submitButton.tagName = "BUTTON";
      submitButton.textContent = "매수";
      submitButton.dataset = {};
      submitButton.className = "order-button";
      submitButton.parentElement = panel;
      submitButton.querySelectorAll = () => [];
      submitButton.getAttribute = () => null;
      submitButton.closest = (selector) => {
        if (selector.includes("saltbread-extension-panel") || selector.includes("tablist")) {
          return null;
        }
        if (selector.includes("button") || selector.includes("[role='button']")) {
          return submitButton;
        }
        return null;
      };

      handleDocumentClick({ target: submitButton });

      const dialog = new Element();
      dialog.tagName = "DIV";
      dialog.textContent = "매수 주문 안내 주문 가능 금액이 부족합니다.";
      dialog.dataset = {};
      dialog.className = "";
      dialog.parentElement = document.body;
      dialog.getAttribute = () => null;
      dialog.querySelectorAll = () => [];

      const button = new Element();
      button.tagName = "A";
      button.textContent = "확인";
      button.dataset = {};
      button.className = "css-dgy70k";
      button.parentElement = dialog;
      button.querySelectorAll = () => [];
      button.getAttribute = () => null;
      button.closest = (selector) => {
        if (selector.includes("saltbread-extension-panel") || selector.includes("tablist")) {
          return null;
        }
        if (selector.includes("#QuoteOrderConfirmPopup") || selector.includes("#modal")) {
          return dialog;
        }
        if (selector.includes("button") || selector.includes("[role='button']") || selector.includes("a")) {
          return button;
        }
        return null;
      };

      const event = {
        target: button,
        defaultPrevented: false,
        propagationStopped: false,
        immediatePropagationStopped: false,
        preventDefault() { this.defaultPrevented = true; },
        stopPropagation() { this.propagationStopped = true; },
        stopImmediatePropagation() { this.immediatePropagationStopped = true; }
      };

      handleDocumentClick(event);

      return {
        defaultPrevented: event.defaultPrevented,
        propagationStopped: event.propagationStopped,
        immediatePropagationStopped: event.immediatePropagationStopped,
        hasPendingAttempt: Boolean(pendingAttempt),
        activeDetectionResult: Boolean(activeDetectionResult),
        flowState: upbitOrderFlow.state
      };
    })()`,
    context,
  );

  assert.equal(result.defaultPrevented, false);
  assert.equal(result.propagationStopped, false);
  assert.equal(result.immediatePropagationStopped, false);
  assert.equal(result.hasPendingAttempt, false);
  assert.equal(result.activeDetectionResult, false);
  assert.equal(result.flowState, "IDLE");
  assert.equal(
    debugEvents.some((event) => event.kind === "ORDER_INTENT_CLICK"),
    false,
  );
  assert.equal(
    debugEvents.some((event) => event.kind === "UPBIT_VALIDATION_MODAL_ACK"),
    true,
  );
});

test("Upbit 주문 버튼 클릭 후 draft를 못 읽어도 snapshot 평가 상태를 error로 덮지 않는다", () => {
  const { context, sentRuntimeMessages } = createContentHarness();

  const result = vm.runInContext(
    `(() => {
      startBehaviorTracking();
      statusCalls = [];
      setAnalysisStatus = (...args) => statusCalls.push(args);

      const panel = new Element();
      panel.tagName = "DIV";
      panel.textContent = "시장가 매도 주문 주문수량";
      panel.dataset = {};
      panel.className = "";
      panel.parentElement = document.body;
      panel.getAttribute = () => null;

      const input = new HTMLInputElement();
      input.value = "";
      input.labels = [];
      input.parentElement = panel;
      input.getAttribute = () => null;

      const typeControl = new Element();
      typeControl.textContent = "시장가";
      typeControl.dataset = {};
      typeControl.className = "active";
      typeControl.getAttribute = (name) =>
        name === "aria-selected" ? "true" : null;

      panel.querySelectorAll = (selector) => {
        if (selector === "input") {
          return [input];
        }
        if (selector.includes("button")) {
          return [typeControl];
        }
        return [];
      };

      const button = new Element();
      button.tagName = "BUTTON";
      button.textContent = "매도";
      button.dataset = {};
      button.className = "order-button";
      button.parentElement = panel;
      button.querySelectorAll = () => [];
      button.getAttribute = () => null;
      button.closest = (selector) => {
        if (selector.includes("saltbread-extension-panel") || selector.includes("tablist")) {
          return null;
        }
        if (selector.includes("button") || selector.includes("[role='button']")) {
          return button;
        }
        return null;
      };

      handleDocumentClick({ target: button });

      return {
        pendingSide: pendingAttempt?.snapshot?.side || null,
        pendingOrderMode: pendingAttempt?.snapshot?.orderMode || null,
        flowState: upbitOrderFlow.state,
        flowSide: upbitOrderFlow.side,
        flowOrderMode: upbitOrderFlow.orderMode,
        statusCalls,
        sessionStillSame: Boolean(behaviorState?.sessionId)
      };
    })()`,
    context,
  );

  assert.equal(result.pendingSide, null);
  assert.equal(result.pendingOrderMode, null);
  assert.equal(result.flowState, "FORM_SUBMIT_CLICKED");
  assert.equal(result.flowSide, "SELL");
  assert.equal(result.flowOrderMode, "MARKET");
  assert.equal(
    result.statusCalls.some((call) => call[1] === "error"),
    false,
  );
  assert.equal(
    result.statusCalls.some(
      (call) => call[0] === "주문 확인 팝업을 확인하고 있어요.",
    ),
    true,
  );
  assert.equal(
    sentRuntimeMessages.some(
      (message) =>
        message.type === "REFRESH_SNAPSHOTS_NOW" &&
        message.payload?.reason === "ORDER_DRAFT_UNAVAILABLE",
    ),
    false,
  );
});

test("데모 scenario snapshot은 pending attempt를 같은 규칙 경로로 즉시 재평가한다", () => {
  const { context } = createContentHarness({
    location: {
      href: "http://localhost:3000/demo?market=KRW-BTC",
      origin: "http://localhost:3000",
      pathname: "/demo",
    },
  });
  const now = new Date().toISOString();

  vm.runInContext(
    `setPageGuardrailRulesState({
      source: "network",
      fetchedAt: "${now}",
      rules: [{
        ruleId: "demo-balance-warning",
        isEnabled: true,
        priority: 1,
        riskLevel: "HIGH",
        visualMode: "SCARED",
        warningTitle: "데모 비중 확인",
        warningMessage: "데모 계좌 비중이 큰 주문입니다.",
        expression: {
          nodeType: "GROUP",
          operator: "AND",
          children: [
            {
              nodeType: "CONDITION",
              leftField: "signedChangeRate",
              operator: "GTE",
              rightOperand: { operandType: "LITERAL", value: 0.1 }
            },
            {
              nodeType: "CONDITION",
              leftField: "requestedBalanceRatio",
              operator: "GTE",
              rightOperand: { operandType: "LITERAL", value: 0.5 }
            }
          ]
        }
      }]
    });
    startBehaviorTracking();
    pendingAttempt = {
      attemptId: "attempt-demo",
      snapshotEmitted: true,
      feedbackShownAt: null,
      snapshot: {
        snapshotId: "snapshot-demo",
        attemptId: "attempt-demo",
        snapshotTrigger: "ORDER_INTENT_CLICK",
        capturedAt: "${now}",
        market: "KRW-BTC",
        side: "BUY",
        orderMode: "MARKET",
        entryPoint: "NORMAL",
        intentPrice: null,
        intentQuantity: null,
        intentAmount: "600000",
        requestedBalanceRatio: null,
        orderIntentCount1m: 1,
        sameSideIntentCount1m: 1,
        matchedRuleIdsAtSnapshot: [],
        primaryShownRuleId: null,
        shownRuleIds: [],
        tradePriceAtSnapshot: null,
        shortTermReturn5m: null,
        signedChangeRate: null,
        spreadRate: null,
        marketRiskFlags: [],
        pricePositionIn5mRange: null,
        volumeSpikeRatio5m: null,
        actualOrderCreatedCount10m: null,
        baseAssetAvgBuyPriceBeforeSnapshot: null,
        priceVsAvgBuyRateAtSnapshot: null
      }
    };
    handleDemoScenario({
      detail: {
        market: "KRW-BTC",
        currentPrice: 90000000,
        marketData: {
          signedChangeRate: 0.12,
          shortTermReturn5m: 0.06,
          volumeSpikeRatio5m: 2.5
        },
        currentOrder: {
          market: "KRW-BTC",
          order_side: "BUY",
          order_type: "MARKET",
          order_amount: 600000
        },
        accounts: [
          { currency: "KRW", balance: "1000000" },
          { currency: "BTC", balance: "0.1", avg_buy_price: "100000000" }
        ],
        rawClosedOrders: [
          { uuid: "closed-1", created_at: "${now}" },
          { uuid: "closed-2", created_at: "${now}" }
        ],
        rawOpenOrders: [
          { uuid: "open-1", created_at: "${now}" }
        ],
        recentOrders: [],
        expiresAt: Date.now() + 180000
      }
    });`,
    context,
  );

  assert.equal(
    vm.runInContext("activeDetectionResult.primaryRuleId", context),
    "demo-balance-warning",
  );
  assert.equal(
    vm.runInContext("pendingAttempt.snapshot.tradePriceAtSnapshot", context),
    "90000000",
  );
  assert.equal(
    vm.runInContext("pendingAttempt.snapshot.requestedBalanceRatio", context),
    0.6,
  );
  assert.equal(
    vm.runInContext("pendingAttempt.snapshot.actualOrderCreatedCount10m", context),
    3,
  );
  assert.equal(
    vm.runInContext(
      "pendingAttempt.snapshot.baseAssetAvgBuyPriceBeforeSnapshot",
      context,
    ),
    "100000000",
  );
  assert.equal(
    vm.runInContext("pendingAttempt.snapshot.priceVsAvgBuyRateAtSnapshot", context),
    -0.1,
  );
});

test("닫은 ORDER_INTENT_CLICK 경고는 background 결과가 늦게 와도 다시 열리지 않는다", () => {
  const { context, debugEvents, runtimeListeners, sentRuntimeMessages } =
    createContentHarness();

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

  const snapshot = debugEvents.find(
    (event) => event.kind === "ORDER_INTENT_CLICK",
  ).payload;
  assert.equal(
    vm.runInContext("activeDetectionResult.primaryRuleId", context),
    "intent-warning",
  );

  vm.runInContext('closeGuardrail("PROCEED")', context);
  assert.equal(vm.runInContext("activeDetectionResult", context), null);
  assert.equal(
    sentRuntimeMessages.some(
      (message) =>
        message.type === "SAVE_GUARDRAIL_REACTION" &&
        message.payload.snapshotId === snapshot.snapshotId &&
        message.payload.action === "PROCEED",
    ),
    true,
  );

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

test("legacy detection result는 사용자 설정 가드레일 경고로 표시하지 않는다", () => {
  const { context, runtimeListeners } = createContentHarness();

  vm.runInContext("startBehaviorTracking();", context);

  runtimeListeners[0](
    {
      type: "DETECTION_RESULT",
      payload: {
        detected: true,
        type: "MACHINE_GUN_TRADING",
        message: "짧은 시간 동안 시장가 매수를 반복하고 있어요.",
        flameMode: "FAST_BURN",
        orderContextSnapshot: {
          snapshotId: "legacy-snapshot",
          attemptId: "legacy-attempt",
          snapshotTrigger: "ORDER_INTENT_CLICK",
          capturedAt: new Date().toISOString(),
          market: "KRW-BTC",
          side: "BUY",
          orderMode: "MARKET",
        },
      },
    },
    {},
    () => {},
  );

  assert.equal(vm.runInContext("activeDetectionResult", context), null);
  assert.equal(vm.runInContext("activeGuardrailSnapshotId", context), null);
});

test("active guardrail은 background safe/stale result와 flameTheme 변경에 덮어써지지 않는다", () => {
  const { context, debugEvents, runtimeListeners, storageListeners } =
    createContentHarness();

  vm.runInContext(
    `setPageGuardrailRulesState({
      source: "network",
      fetchedAt: "2026-07-08T00:00:00.000Z",
      rules: [{
        ruleId: "active-warning",
        isEnabled: true,
        priority: 1,
        riskLevel: "HIGH",
        visualMode: "SCARED",
        warningTitle: "활성 경고",
        warningMessage: "현재 경고가 유지되어야 합니다.",
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
    const originalApplyFlameTheme = applyFlameTheme;
    flameThemeCalls = [];
    applyFlameTheme = (mode) => {
      flameThemeCalls.push(mode);
      originalApplyFlameTheme(mode);
    };
    startBehaviorTracking();
    beginOrderAttempt(null);
    flameThemeCalls = [];`,
    context,
  );

  const snapshot = debugEvents.find(
    (event) => event.kind === "ORDER_INTENT_CLICK",
  ).payload;
  assert.equal(
    vm.runInContext("activeDetectionResult.primaryRuleId", context),
    "active-warning",
  );

  runtimeListeners[0](
    {
      type: "DETECTION_RESULT",
      payload: {
        detected: false,
        message: "safe",
        orderContextSnapshot: snapshot,
      },
    },
    {},
    () => {},
  );
  assert.equal(
    vm.runInContext("activeDetectionResult.primaryRuleId", context),
    "active-warning",
  );

  runtimeListeners[0](
    {
      type: "DETECTION_RESULT",
      payload: {
        detected: true,
        primaryRuleId: "stale-warning",
        visualMode: "DEFAULT",
        orderContextSnapshot: {
          ...snapshot,
          snapshotId: "snapshot-stale",
        },
      },
    },
    {},
    () => {},
  );
  assert.equal(
    vm.runInContext("activeDetectionResult.primaryRuleId", context),
    "active-warning",
  );

  storageListeners[0](
    { flameTheme: { newValue: { mode: "default" } } },
    "local",
  );
  assert.equal(vm.runInContext("flameThemeCalls.length", context), 0);
});

test("TradeFeedbackDTO는 debug 이벤트와 backend 저장 메시지를 함께 보낸다", () => {
  const { context, debugEvents, sentRuntimeMessages } = createContentHarness();

  vm.runInContext(
    `emitTradeFeedback({
      attemptId: "attempt-feedback",
      feedbackShownAt: "2026-07-08T01:00:00.000Z"
    }, "EMOTIONAL")`,
    context,
  );

  const feedbackEvent = debugEvents.find(
    (event) => event.kind === "TradeFeedbackDTO",
  );
  const feedbackMessage = sentRuntimeMessages.find(
    (message) => message.type === "SAVE_TRADE_FEEDBACK",
  );

  assert.equal(feedbackEvent.payload.attemptId, "attempt-feedback");
  assert.equal(feedbackEvent.payload.feedbackStatus, "ANSWERED");
  assert.equal(feedbackEvent.payload.selfAssessment, "EMOTIONAL");
  assert.equal(feedbackMessage.payload.attemptId, "attempt-feedback");
  assert.equal(feedbackMessage.payload.feedbackStatus, "ANSWERED");
  assert.equal(feedbackMessage.payload.selfAssessment, "EMOTIONAL");
});

test("확장 context invalidated 중에도 content runtime 메시지는 예외를 밖으로 던지지 않는다", async () => {
  const { context } = createContentHarness();

  await assert.doesNotReject(
    vm.runInContext(
      `(() => {
        chrome.runtime.sendMessage = () => {
          throw new Error("Extension context invalidated.");
        };
        chrome.storage.local.get = () => {
          throw new Error("Extension context invalidated.");
        };

        sendBackendLogMessage("SAVE_ORDER_CONTEXT_SNAPSHOT", {
          snapshotId: "snapshot-invalidated",
          capturedAt: "2026-07-08T00:00:00.000Z"
        });
        sendBehaviorEvent({
          sessionId: "session-invalidated",
          symbol: "KRW-BTC",
          eventType: "BUY_CLICK",
          pageUrl: location.href,
          occurredAt: "2026-07-08T00:00:00.000Z"
        });
        sendSnapshotRefreshMessage("TEST_INVALIDATED", "KRW-BTC");
        loadLocalSnapshotCaches();
        return loadPageGuardrailRules();
      })()`,
      context,
    ),
  );
});
