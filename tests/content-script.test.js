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
    location:
      options.location || {
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
    documentElementAttributes,
    documentListeners,
    localStore,
    runtimeListeners,
    sentRuntimeMessages,
    storageListeners,
  };
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

  const contextDebug = debugEvents.find(
    (event) => event.kind === "ORDER_CONTEXT_WITH_SNAPSHOTS",
  );
  assert.equal(contextDebug.payload.hasMarketSnapshot, true);
  assert.equal(contextDebug.payload.marketSnapshotSource, "demo-page");
  assert.equal(contextDebug.payload.hasPersonalSnapshot, true);
  assert.equal(contextDebug.payload.personalSnapshotSource, "demo-page");
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

test("Upbit 확인 팝업의 확인 클릭은 경고를 다시 띄우지 않고 피드백을 연다", () => {
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
      dialog.textContent = "매수 주문 안내 시장가 주문 확인";
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

      const target = new Element();
      target.textContent = "확인";
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
        feedbackAttemptId: activeTradeFeedback?.attemptId || null
      };
    })()`,
    context,
  );

  assert.equal(result.defaultPrevented, false);
  assert.equal(result.propagationStopped, false);
  assert.equal(result.immediatePropagationStopped, false);
  assert.equal(result.side, "BUY");
  assert.equal(result.orderMode, "MARKET");
  assert.equal(result.activeRuleId, null);
  assert.equal(result.activeSnapshotId, null);
  assert.equal(result.feedbackActive, true);
  assert.ok(result.feedbackAttemptId);
  assert.ok(
    debugEvents.some(
      (event) => event.kind === "ORDER_CONTEXT_WITH_SNAPSHOTS",
    ),
  );
});

test("피드백 응답 후 같은 확인 버튼을 다시 눌러도 피드백을 다시 열지 않는다", () => {
  const { context, debugEvents } = createContentHarness();

  const result = vm.runInContext(
    `(() => {
      startBehaviorTracking();

      const dialog = new Element();
      dialog.tagName = "DIV";
      dialog.textContent = "매수 주문 안내 시장가 주문 확인";
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
      const firstAttemptId = activeTradeFeedback?.attemptId || null;
      answerTradeFeedback("PLANNED");
      handleDocumentClick(event);

      return {
        firstAttemptId,
        feedbackActiveAfterSecondClick: Boolean(activeTradeFeedback),
        feedbackRespondedAt: pendingAttempt?.feedbackRespondedAt || null
      };
    })()`,
    context,
  );

  assert.ok(result.firstAttemptId);
  assert.equal(result.feedbackActiveAfterSecondClick, false);
  assert.ok(result.feedbackRespondedAt);
  assert.equal(
    debugEvents.filter((event) => event.kind === "TradeFeedbackDTO").length,
    1,
  );
});

test("활성 경고가 있을 때 Upbit 확인 클릭은 PROCEED 반응으로 닫고 피드백을 연다", () => {
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
      dialog.textContent = "매수 주문 안내 시장가 주문 확인";
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

      handleDocumentClick({
        target: button,
        defaultPrevented: false,
        propagationStopped: false,
        immediatePropagationStopped: false,
        preventDefault() { this.defaultPrevented = true; },
        stopPropagation() { this.propagationStopped = true; },
        stopImmediatePropagation() { this.immediatePropagationStopped = true; }
      });

      return {
        hasActiveWarning: Boolean(activeDetectionResult?.detected),
        activeSnapshotId: activeGuardrailSnapshotId || null,
        feedbackActive: Boolean(activeTradeFeedback),
        feedbackAttemptId: activeTradeFeedback?.attemptId || null
      };
    })()`,
    context,
  );

  assert.equal(result.hasActiveWarning, false);
  assert.equal(result.activeSnapshotId, null);
  assert.equal(result.feedbackActive, true);
  assert.ok(result.feedbackAttemptId);
  assert.ok(
    debugEvents.some(
      (event) =>
        event.kind === "GuardrailReactionDTO" &&
        event.payload.action === "PROCEED",
    ),
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

      const dialog = new Element();
      dialog.tagName = "DIV";
      dialog.textContent = "매도 주문 안내 주문 가능 수량이 부족합니다.";
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
        activeDetectionResult: Boolean(activeDetectionResult)
      };
    })()`,
    context,
  );

  assert.equal(result.defaultPrevented, false);
  assert.equal(result.propagationStopped, false);
  assert.equal(result.immediatePropagationStopped, false);
  assert.equal(result.hasPendingAttempt, false);
  assert.equal(result.activeDetectionResult, false);
  assert.equal(
    debugEvents.some((event) => event.kind === "ORDER_INTENT_CLICK"),
    false,
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
        pendingSide: pendingAttempt?.snapshot?.side,
        pendingOrderMode: pendingAttempt?.snapshot?.orderMode,
        statusCalls,
        sessionStillSame: Boolean(behaviorState?.sessionId)
      };
    })()`,
    context,
  );

  assert.equal(result.pendingSide, "SELL");
  assert.equal(result.pendingOrderMode, "MARKET");
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
    true,
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
