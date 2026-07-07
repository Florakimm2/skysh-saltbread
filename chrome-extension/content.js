const PANEL_ID = "saltbread-extension-panel";
const APP_URL = globalThis.SALTBREAD_CONFIG.appUrl;
const APP_ORIGINS = new Set([
  APP_URL,
  ...(globalThis.SALTBREAD_CONFIG.appOrigins || []),
]);
const BEHAVIOR_INPUT_DEBOUNCE_MS = 650;
const {
  buildBehaviorSnapshot,
  detectOrderActionSide,
  parseMarket,
  toNumber,
} =
  globalThis.SaltbreadCore;
const METRIC_DEFINITIONS = [
  {
    id: "max-click",
    icon: "◎",
    label: "최대(100%) 선택",
    initialValue: "아니요",
    description: "최근 주문 시도 이후",
  },
  {
    id: "buy-clicks",
    icon: "↗",
    label: "1분 내 매수 클릭",
    initialValue: "0회",
    description: "현재 종목 기준",
  },
  {
    id: "amount-edits",
    icon: "✎",
    label: "3분 내 입력 수정",
    initialValue: "0회",
    description: "금액·가격·수량 입력",
  },
  {
    id: "average-buy",
    icon: "₩",
    label: "최근 평균 매수 금액",
    initialValue: "-",
    description: "최근 체결 10회 기준",
  },
  {
    id: "dwell-time",
    icon: "◷",
    label: "종목 체류 시간",
    initialValue: "00:00:00",
    description: "현재 종목 화면이 보인 시간",
  },
];
const DETECTION_TITLES = {
  FOMO_CHASING: "FOMO 추격 매수",
  REVENGE_TRADING: "복수 매매",
  HESITATION: "주문 망설임",
  ALL_IN_IMPULSE: "충동적 올인",
  AMOUNT_SPIKE: "주문 금액 급증",
  MACHINE_GUN_TRADING: "연속 시장가 매수",
  HIGH_RISK_HOPPING: "고위험 종목 이동",
};

let behaviorState = null;
let behaviorTimerId = null;
let panelFlame = null;
let collapsedPanelFlame = null;
let currentPageUrl = location.href;
let pendingAttempt = null;
let activeGuardrailSnapshotId = null;
let activeDetectionResult = null;

function isAppPage() {
  return APP_ORIGINS.has(location.origin);
}

function isDashboardPage() {
  return (
    isAppPage() &&
    (location.pathname === "/dashboard" ||
      location.pathname.startsWith("/dashboard/"))
  );
}

function isDemoPage() {
  return isAppPage() && location.pathname === "/demo";
}

function emitExtensionDebug(category, kind, payload, occurredAt = null) {
  document.dispatchEvent(
    new CustomEvent("saltbread:extension-debug", {
      detail: {
        category,
        kind,
        payload,
        occurredAt: occurredAt || new Date().toISOString(),
      },
    }),
  );
}

function createUuid() {
  return typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : createOrderSessionId();
}

function decimalString(value) {
  if (value === null || value === undefined || value === "") return null;
  const numeric = toNumber(value);
  return numeric === null ? null : String(numeric);
}

function acknowledgePageEvent(event) {
  const requestId = event.detail?.requestId;

  if (typeof requestId === "string" && requestId) {
    document.documentElement.setAttribute(
      "data-saltbread-event-ack",
      requestId,
    );
  }
}

function normalizeFlameMode(mode) {
  const normalized = String(mode || "DEFAULT").trim().toUpperCase();
  const aliases = {
    DEFAULT: "DEFAULT",
    AUTO: "DEFAULT",
    BLUE: "SAD",
    PINK: "SCARED",
  };
  const resolved = aliases[normalized] || normalized;

  return [
    "DEFAULT",
    "CURIOUS",
    "SURPRISED",
    "FAST_BURN",
    "SCARED",
    "SAD",
  ].includes(resolved)
    ? resolved
    : "DEFAULT";
}

function applyFlameTheme(mode) {
  const normalizedMode = normalizeFlameMode(mode);
  const panel = document.getElementById(PANEL_ID);

  if (panel) {
    panel.dataset.flameMode = normalizedMode.toLowerCase();
  }

  panelFlame?.setMode(normalizedMode);
  collapsedPanelFlame?.setMode(normalizedMode);
}

function isLoggedIn(auth) {
  return Boolean(auth?.accessToken && auth?.user);
}

function renderMetricCards() {
  return METRIC_DEFINITIONS.map(
    ({ id, icon, label, initialValue, description }) => `
      <article
        class="saltbread-metric-card"
        data-metric="${id}"
        data-changed="false"
        title="${description}"
      >
        <span class="saltbread-metric-card__icon" aria-hidden="true">${icon}</span>
        <span class="saltbread-metric-card__label">${label}</span>
        <strong class="saltbread-metric-card__value">${initialValue}</strong>
      </article>
    `,
  ).join("");
}

function removePanel() {
  panelFlame?.destroy();
  panelFlame = null;
  collapsedPanelFlame?.destroy();
  collapsedPanelFlame = null;
  document.getElementById(PANEL_ID)?.remove();
  stopBehaviorTracking();
}

function createPanel(auth) {
  if (document.getElementById(PANEL_ID)) {
    return;
  }

  const panel = document.createElement("aside");
  panel.id = PANEL_ID;
  panel.dataset.authenticated = String(isLoggedIn(auth));
  panel.setAttribute("aria-label", "불씨 행동 데이터");
  panel.innerHTML = `
    <div class="saltbread-panel__collapsed-controls" aria-hidden="true">
      <div class="saltbread-panel__collapsed-flame"></div>
      <button
        class="saltbread-panel__reopen"
        type="button"
        aria-label="불씨 패널 열기"
        aria-hidden="true"
        title="패널 열기"
      >
        <span aria-hidden="true"></span>
      </button>
    </div>

    <div class="saltbread-panel__body">
      <div class="saltbread-panel__header">
        <div class="saltbread-panel__flame"></div>
        <div class="saltbread-panel__title">
          <strong>불씨</strong>
          <span>행동 데이터</span>
        </div>
        <button
          class="saltbread-panel__collapse"
          type="button"
          aria-label="불씨 패널 접기"
          title="패널 접기"
        >
          <span aria-hidden="true"></span>
        </button>
      </div>

      <p class="saltbread-panel__account"></p>

      <div
        class="saltbread-analysis-status"
        data-state="loading"
        aria-label="분석 상태"
        aria-live="polite"
      >
        <div class="saltbread-analysis-status__eyebrow">
          <span class="saltbread-analysis-status__dot" aria-hidden="true"></span>
          <span data-status-badge>실시간 분석</span>
        </div>
        <strong data-status-title>데이터 수집 중...</strong>
        <p data-status-message>주문 행동 변화를 확인하고 있어요.</p>
      </div>
      <p class="saltbread-logging-status" data-logging-status hidden></p>

      <section class="saltbread-panel__section" aria-labelledby="saltbread-metrics-title">
        <div class="saltbread-panel__section-heading">
          <h2 id="saltbread-metrics-title">실시간 행동 데이터</h2>
          <span data-current-market>종목 확인 중</span>
        </div>
        <div class="saltbread-metric-list">
          ${renderMetricCards()}
        </div>
      </section>

      <div class="saltbread-panel__actions" aria-label="거래 판단">
        <button
          class="saltbread-action-button saltbread-action-button--history"
          type="button"
        >
          내 과거 기록 보기
        </button>
        <button
          class="saltbread-action-button saltbread-action-button--proceed"
          type="button"
        >
          그래도 진행
        </button>
      </div>
    </div>
  `;

  panel.querySelector(".saltbread-panel__account").textContent =
    auth?.user?.email || "DEMO SESSION · 서버 저장 안 함";
  panel
    .querySelector(".saltbread-panel__collapse")
    .addEventListener("click", () => setPanelCollapsed(panel, true));
  panel
    .querySelector(".saltbread-panel__reopen")
    .addEventListener("click", () => setPanelCollapsed(panel, false));
  panel
    .querySelector(".saltbread-action-button--history")
    .addEventListener("click", openDashboard);
  panel
    .querySelector(".saltbread-action-button--proceed")
    .addEventListener("click", () => {
      closeGuardrail("PROCEED");
      setPanelCollapsed(panel, true);
    });

  document.body.append(panel);
  panelFlame = new CuteIdleFlame(
    panel.querySelector(".saltbread-panel__flame"),
    {
      mode: "default",
      label: "현재 감정 매매 상태를 보여주는 불꽃",
    },
  );
  collapsedPanelFlame = new CuteIdleFlame(
    panel.querySelector(".saltbread-panel__collapsed-flame"),
    {
      mode: "default",
      label: "접힌 불씨의 현재 감정 매매 상태 불꽃",
    },
  );
  chrome.storage.local
    .get("flameTheme")
    .then(({ flameTheme }) => applyFlameTheme(flameTheme?.mode));
  startBehaviorTracking();
}

function openDashboard() {
  chrome.runtime.sendMessage({ type: "OPEN_DASHBOARD" });
}

function setPanelCollapsed(panel, isCollapsed) {
  panel.classList.toggle("is-collapsed", isCollapsed);
  panel.querySelector(".saltbread-panel__body").inert = isCollapsed;
  panel
    .querySelector(".saltbread-panel__body")
    .setAttribute("aria-hidden", String(isCollapsed));
  panel.querySelector(".saltbread-panel__reopen").setAttribute(
    "aria-hidden",
    String(!isCollapsed),
  );
  panel
    .querySelector(".saltbread-panel__collapsed-controls")
    .setAttribute("aria-hidden", String(!isCollapsed));
}

function normalizedText(element) {
  return element?.textContent?.replace(/\s/g, "") || "";
}

function findOrderPanel(element) {
  let candidate = element;
  let fallback = null;

  while (candidate && candidate !== document.body) {
    const text = normalizedText(candidate);
    const inputCount = candidate.querySelectorAll?.("input").length || 0;
    const keywordCount = [
      text.includes("주문총액"),
      text.includes("주문수량"),
      text.includes("매수가격") || text.includes("매도가격"),
    ].filter(Boolean).length;

    if (
      inputCount > 0 &&
      keywordCount > 0
    ) {
      fallback = candidate;

      if (
        ["ARTICLE", "FORM", "SECTION"].includes(candidate.tagName) ||
        (inputCount >= 2 && keywordCount >= 2)
      ) {
        return candidate;
      }
    }

    candidate = candidate.parentElement;
  }

  return fallback;
}

function isOrderInput(target) {
  return (
    target instanceof HTMLInputElement &&
    !target.closest(`#${PANEL_ID}`) &&
    Boolean(findOrderPanel(target))
  );
}

function findOrderButton(target) {
  if (!(target instanceof Element)) {
    return null;
  }

  const button = target.closest("button, [role='button']");

  if (
    !button ||
    button.closest(`#${PANEL_ID}`) ||
    button.getAttribute("role") === "tab" ||
    button.closest("[role='tablist']")
  ) {
    return null;
  }

  const buttonText = normalizedText(button);
  const explicitSide = button.dataset.saltbreadOrderAction;
  const orderSide =
    ["BUY", "SELL"].includes(explicitSide) ? explicitSide : detectOrderActionSide(
      buttonText,
    );
  const isConfirmAction = /^(매수확인|매도확인)$/.test(buttonText);

  return orderSide && (findOrderPanel(button) || isConfirmAction)
    ? button
    : null;
}

function isMaxButton(target) {
  if (!(target instanceof Element)) {
    return false;
  }

  const button = target.closest("button, [role='button']");

  if (!button || button.closest(`#${PANEL_ID}`) || !findOrderPanel(button)) {
    return false;
  }

  const text = normalizedText(button);
  return /^(최대|100%|최대100%)$/.test(text);
}

function findInputValue(panel, labelPattern) {
  if (!panel) {
    return null;
  }

  const inputs = [...panel.querySelectorAll("input")];

  for (const input of inputs) {
    if (!inputMatchesLabel(input, panel, labelPattern)) {
      continue;
    }

    const value = readInputNumber(input);

    if (value !== null) {
      return value;
    }
  }

  return null;
}

function inputMatchesLabel(input, panel, labelPattern) {
  const directLabels = [
    input.getAttribute("aria-label"),
    ...[...(input.labels || [])].map((label) => label.textContent),
  ].filter(Boolean);
  let candidate = input.parentElement;

  for (const label of directLabels) {
    if (labelPattern.test(String(label).replace(/\s/g, ""))) {
      return true;
    }
  }

  for (let depth = 0; candidate && candidate !== panel && depth < 4; depth += 1) {
    if (labelPattern.test(normalizedText(candidate))) {
      return true;
    }

    candidate = candidate.parentElement;
  }

  return false;
}

function readInputNumber(input) {
  if (!(input instanceof HTMLInputElement) || !input.value.trim()) {
    return null;
  }

  const value = toNumber(input.value);
  return value !== null && value >= 0 ? value : null;
}

function getOrderInputKind(input, panel = findOrderPanel(input)) {
  if (!(input instanceof HTMLInputElement) || !panel) {
    return null;
  }

  const directLabels = [
    input.getAttribute("aria-label"),
    input.getAttribute("placeholder"),
    ...[...(input.labels || [])].map((label) => label.textContent),
  ]
    .filter(Boolean)
    .join(" ");
  const candidates = [directLabels];
  let candidate = input.parentElement;

  for (let depth = 0; candidate && candidate !== panel && depth < 4; depth += 1) {
    candidates.push(candidate.textContent || "");
    candidate = candidate.parentElement;
  }

  for (const text of candidates) {
    const normalized = String(text).replace(/\s/g, "");

    if (/주문총액|매수금액|매도금액|총주문금액/.test(normalized)) {
      return { eventType: "AMOUNT_INPUT", field: "amount" };
    }

    if (/매수가격|매도가격|주문가격/.test(normalized)) {
      return { eventType: "PRICE_INPUT", field: "price" };
    }

    if (/주문수량|매수수량|매도수량/.test(normalized)) {
      return { eventType: "QUANTITY_INPUT", field: "quantity" };
    }
  }

  return null;
}

function detectOrderType(panel) {
  if (!panel) {
    return null;
  }

  const controls = [
    ...panel.querySelectorAll("button, [role='tab'], [role='radio']"),
  ];
  const selectedControl = controls.find((control) => {
    const isSelected =
      control.getAttribute("aria-selected") === "true" ||
      control.getAttribute("aria-checked") === "true" ||
      control.dataset.state === "active" ||
      /(^|\s)(active|selected|on)(\s|$)/i.test(control.className);

    return isSelected && /시장가|지정가/.test(normalizedText(control));
  });

  if (normalizedText(selectedControl).includes("시장가")) {
    return "MARKET";
  }

  if (normalizedText(selectedControl).includes("지정가")) {
    return "LIMIT";
  }

  return null;
}

function detectOrderSide(panel, orderButton) {
  const explicitSide = orderButton?.dataset.saltbreadOrderAction;
  const buttonSide =
    ["BUY", "SELL"].includes(explicitSide)
      ? explicitSide
      : detectOrderActionSide(normalizedText(orderButton));

  if (buttonSide) {
    return buttonSide;
  }

  if (!panel) {
    return null;
  }

  const selectedSideControl = [
    ...panel.querySelectorAll("button, [role='tab'], [role='radio']"),
  ].find((control) => {
    const isSelected =
      control.getAttribute("aria-selected") === "true" ||
      control.getAttribute("aria-checked") === "true" ||
      control.dataset.state === "active" ||
      /(^|\s)(active|selected|on)(\s|$)/i.test(control.className);

    return isSelected && /^(매수|매도)$/.test(normalizedText(control));
  });

  if (normalizedText(selectedSideControl) === "매도") {
    return "SELL";
  }

  if (normalizedText(selectedSideControl) === "매수") {
    return "BUY";
  }

  return null;
}

function createOrderSessionId() {
  if (typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  const randomBytes = crypto.getRandomValues(new Uint8Array(16));
  return [...randomBytes]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function startNewOrderSession() {
  if (!behaviorState) {
    return;
  }

  behaviorState.sessionId = createOrderSessionId();
  behaviorState.lastLoggedInputValues.clear();
  behaviorState.inputValueHistoryByField = {
    price: new Set(),
    quantity: new Set(),
    amount: new Set(),
  };
  behaviorState.lastOrderType = null;
  behaviorState.draftStartedAt = null;
  behaviorState.lastEditAt = null;
  behaviorState.draftEditCount = 0;
  behaviorState.firstAmount = null;
  behaviorState.firstPrice = null;
  behaviorState.lastPriceValue = null;
  behaviorState.lastPriceDirection = null;
  behaviorState.inputRevertCount = 0;
  behaviorState.priceDirectionChangeCount = 0;
  behaviorState.lastOrderbookClickAt = null;
  behaviorState.allocationPresetPercent = null;
}

function addOrderValues(eventPayload, panel) {
  if (!eventPayload || !panel) {
    return { price: null, quantity: null, amount: null };
  }

  const price = findInputValue(panel, /매수가격|매도가격|주문가격/);
  const quantity = findInputValue(
    panel,
    /주문수량|매수수량|매도수량/,
  );
  const explicitAmount = findInputValue(
    panel,
    /주문총액|매수금액|매도금액|총주문금액/,
  );
  const amount =
    explicitAmount ??
    (price !== null && quantity !== null ? price * quantity : null);

  if (price !== null) {
    eventPayload.price = price;
  }

  if (quantity !== null) {
    eventPayload.quantity = quantity;
  }

  if (amount !== null) {
    eventPayload.amount = amount;
  }

  return { price, quantity, amount };
}

function createBehaviorEvent(eventType, panel, fields = {}) {
  const symbol = behaviorState?.market || parseMarket(location.href);

  if (!symbol || !behaviorState?.sessionId) {
    return null;
  }

  const eventPayload = {
    sessionId: behaviorState.sessionId,
    symbol,
    eventType,
    pageUrl: location.href,
    occurredAt: new Date().toISOString(),
  };
  const side = detectOrderSide(panel, null);
  const orderType = detectOrderType(panel);

  if (side) {
    eventPayload.side = side;
  }

  if (orderType) {
    eventPayload.orderType = orderType;
  }

  return Object.assign(eventPayload, fields);
}

function setLoggingStatus(message = "") {
  const status = document.querySelector("[data-logging-status]");

  if (!status) {
    return;
  }

  status.textContent = message;
  status.hidden = !message;
}

function sendBehaviorEvent(eventPayload) {
  if (!eventPayload) {
    return;
  }

  emitExtensionDebug(
    "behavior",
    eventPayload.eventType || "BEHAVIOR_EVENT",
    eventPayload,
    eventPayload.occurredAt,
  );

  if (isDemoPage() && !isLoggedInContext()) {
    return;
  }

  chrome.runtime
    .sendMessage({
      type: "LOG_BEHAVIOR_EVENT",
      payload: eventPayload,
    })
    .then((response) => {
      setLoggingStatus(
        response?.ok
          ? ""
          : response?.error || "행동 로그를 저장하지 못했습니다.",
      );
    })
    .catch(() =>
      setLoggingStatus("행동 로그 서버와 연결할 수 없습니다."),
    );
}

function isLoggedInContext() {
  return Boolean(document.getElementById(PANEL_ID)?.dataset.authenticated === "true");
}

function flushPendingInputEvent(input) {
  const pending = behaviorState?.pendingInputEvents.get(input);

  if (!pending) {
    return;
  }

  window.clearTimeout(pending.timerId);
  behaviorState.pendingInputEvents.delete(input);

  if (!input.isConnected) {
    return;
  }

  const panel = findOrderPanel(input);
  const value = readInputNumber(input);

  if (!panel || value === null) {
    return;
  }

  const duplicateKey = [
    behaviorState.sessionId,
    behaviorState.market,
    pending.eventType,
  ].join(":");

  if (behaviorState.lastLoggedInputValues.get(duplicateKey) === value) {
    return;
  }

  const eventPayload = createBehaviorEvent(
    pending.eventType,
    panel,
    { [pending.field]: value },
  );

  if (!eventPayload) {
    return;
  }

  behaviorState.lastLoggedInputValues.set(duplicateKey, value);
  sendBehaviorEvent(eventPayload);
}

function flushPendingInputEvents() {
  if (!behaviorState) {
    return;
  }

  for (const input of [...behaviorState.pendingInputEvents.keys()]) {
    flushPendingInputEvent(input);
  }
}

function findOrderTypeControl(target) {
  if (!(target instanceof Element)) {
    return null;
  }

  const control = target.closest(
    "button, input, [role='tab'], [role='radio']",
  );

  return control &&
    !control.closest(`#${PANEL_ID}`) &&
    /시장가|지정가/.test(
      `${normalizedText(control)} ${control.getAttribute("aria-label") || ""}`,
    )
    ? control
    : null;
}

function syncOrderType(panel, shouldLogChange) {
  if (!behaviorState || !panel) {
    return;
  }

  const nextOrderType = detectOrderType(panel);
  const previousOrderType = behaviorState.lastOrderType;

  if (!nextOrderType) {
    return;
  }

  behaviorState.lastOrderType = nextOrderType;

  if (
    !shouldLogChange ||
    !previousOrderType ||
    previousOrderType === nextOrderType
  ) {
    return;
  }

  behaviorState.orderModeChangeTimestamps.push(Date.now());

  sendBehaviorEvent(
    createBehaviorEvent("ORDER_TYPE_CHANGE", panel, {
      orderType: nextOrderType,
      metadata: { previousOrderType },
    }),
  );
}

function syncCurrentOrderType(shouldLogChange = true) {
  const panel = [...document.querySelectorAll("input")]
    .map((input) => findOrderPanel(input))
    .find(Boolean);
  syncOrderType(panel, shouldLogChange);
}

function readOrderDraft(orderButton = null) {
  const panel =
    (orderButton && findOrderPanel(orderButton)) ||
    [...document.querySelectorAll("input")]
      .map((input) => findOrderPanel(input))
      .find(Boolean);
  const market = behaviorState?.market || parseMarket(location.href);

  if (!panel || !market) {
    return null;
  }

  const side = detectOrderSide(panel, orderButton);
  const orderType = detectOrderType(panel);
  const price = findInputValue(panel, /매수가격|매도가격|주문가격/);
  const volume = findInputValue(panel, /주문수량|매수수량|매도수량/);
  const explicitAmount = findInputValue(
    panel,
    /주문총액|매수금액|매도금액|총주문금액/,
  );
  const amount =
    explicitAmount ??
    (price !== null && volume !== null ? price * volume : null);

  if (!side || !orderType || amount === null) {
    return null;
  }

  return {
    market,
    order_side: side,
    order_status: "WAIT",
    order_type: orderType,
    order_price: orderType === "MARKET" ? null : price,
    order_volume: volume,
    order_amount: amount,
    realized_loss_pct_1h: null,
    order_request_time: new Date().toISOString(),
    order_cancel_time: null,
  };
}

function handleAmountInput(event) {
  if (!behaviorState || !isOrderInput(event.target)) {
    return;
  }

  const editedAt = Date.now();
  behaviorState.inputEditTimestamps.push(editedAt);
  behaviorState.draftStartedAt ||= editedAt;
  behaviorState.lastEditAt = editedAt;
  behaviorState.draftEditCount += 1;
  const input = event.target;
  const inputKind = getOrderInputKind(input);

  if (inputKind) {
    const value = readInputNumber(input);
    const fieldTimestamps =
      behaviorState.inputEditTimestampsByField[inputKind.field] || [];
    fieldTimestamps.push(editedAt);
    behaviorState.inputEditTimestampsByField[inputKind.field] = fieldTimestamps;

    if (value !== null) {
      const history = behaviorState.inputValueHistoryByField[inputKind.field];
      const lastValue = behaviorState.lastInputValueByField[inputKind.field];

      if (lastValue !== value && history?.has(value)) {
        behaviorState.inputRevertCount += 1;
      }

      history?.add(value);
      behaviorState.lastInputValueByField[inputKind.field] = value;

      if (inputKind.field === "price") {
        behaviorState.firstPrice ??= value;

        if (behaviorState.lastPriceValue !== null) {
          const direction =
            value > behaviorState.lastPriceValue
              ? "UP"
              : value < behaviorState.lastPriceValue
                ? "DOWN"
                : null;

          if (
            direction &&
            behaviorState.lastPriceDirection &&
            behaviorState.lastPriceDirection !== direction
          ) {
            behaviorState.priceDirectionChangeCount += 1;
          }

          if (direction) {
            behaviorState.lastPriceDirection = direction;
          }
        }

        behaviorState.lastPriceValue = value;
      }
    }

    const previousPending = behaviorState.pendingInputEvents.get(input);

    if (previousPending) {
      window.clearTimeout(previousPending.timerId);
    }

    const pending = {
      ...inputKind,
      timerId: window.setTimeout(
        () => flushPendingInputEvent(input),
        BEHAVIOR_INPUT_DEBOUNCE_MS,
      ),
    };
    behaviorState.pendingInputEvents.set(input, pending);
  }

  renderBehaviorMetrics();
}

function handleDemoScenario(event) {
  if (!behaviorState || !isAppPage()) {
    return;
  }

  acknowledgePageEvent(event);
  setAnalysisStatus(
    "데모 페이지에서는 확장 프로그램 수집을 실행하지 않습니다.",
    "safe",
  );
}

function handleDetectNow(event) {
  if (!behaviorState || !isAppPage()) {
    return;
  }

  if (event) {
    acknowledgePageEvent(event);
  }

  if (isDemoPage()) {
    setAnalysisStatus(
      "데모 페이지에서는 확장 프로그램 수집을 실행하지 않습니다.",
      "safe",
    );
    return;
  }

  const snapshot = getContextSnapshot();

  if (!snapshot.market || !snapshot.currentOrder || !snapshot.behaviorData) {
    setAnalysisStatus("데이터 수집 중...", "loading");
    return;
  }

  setAnalysisStatus("데이터 수집 중...", "loading");
  chrome.runtime
    .sendMessage({
      type: "RUN_DETECTION_NOW",
      payload: snapshot,
    })
    .then((response) => {
      if (!response?.ok) {
        setAnalysisStatus(
          response?.error || "즉시 감지 요청에 실패했습니다.",
          "error",
        );
      }
    })
    .catch(() =>
      setAnalysisStatus("확장 프로그램과 연결할 수 없습니다.", "error"),
    );
}

function handleDemoReset(event) {
  if (!behaviorState || !isAppPage()) {
    return;
  }

  acknowledgePageEvent(event);
  const market = parseMarket(location.href) || behaviorState.market;
  behaviorState.market = market;
  behaviorState.inputEditTimestamps = [];
  behaviorState.inputEditTimestampsByField = {
    price: [],
    quantity: [],
    amount: [],
  };
  behaviorState.buyClicksByMarket = market ? { [market]: [] } : {};
  behaviorState.orderIntentTimestamps = [];
  behaviorState.sameSideIntentTimestamps = {
    BUY: [],
    SELL: [],
  };
  behaviorState.maxClickedSinceLastOrder = false;
  behaviorState.clientAvgBuyAmount = null;
  behaviorState.lastOrder = null;
  behaviorState.lastOrderBehavior = null;
  behaviorState.lastOrderAt = null;
  behaviorState.lastOrderSessionId = null;
  behaviorState.visibleDurationMs = 0;
  behaviorState.visibleSince = document.hidden ? null : Date.now();
  startNewOrderSession();
  applyFlameTheme("default");
  setLoggingStatus();
  renderBehaviorMetrics();
  setAnalysisStatus("데이터 수집 중...", "loading");
  chrome.runtime.sendMessage({ type: "RESET_DEMO_STATE" }).catch(() => {});
}

function buildOrderContextSnapshot(orderButton, snapshotTrigger) {
  const panel = findOrderPanel(orderButton);
  const draft = readOrderDraft(orderButton);
  const capturedAt = new Date().toISOString();
  const now = Date.now();
  const market = draft?.market || behaviorState?.market || parseMarket(location.href);
  const side = draft?.order_side || detectOrderSide(panel, orderButton) || "UNKNOWN";
  const orderMode = draft?.order_type || detectOrderType(panel) || "UNKNOWN";
  const amount = draft?.order_amount ?? null;
  const quantity = draft?.order_volume ?? null;
  const recentFieldEdits = (field) =>
    (behaviorState?.inputEditTimestampsByField?.[field] || []).filter(
      (timestamp) => timestamp >= now - 3 * 60_000,
    ).length;
  const recentIntentCount =
    (behaviorState?.orderIntentTimestamps || []).filter(
      (timestamp) => timestamp >= now - 60_000,
    ).length + 1;
  const recentSameSideIntentCount =
    (behaviorState?.sameSideIntentTimestamps?.[side] || []).filter(
      (timestamp) => timestamp >= now - 60_000,
    ).length + 1;

  if (behaviorState && behaviorState.firstAmount === null && amount !== null) {
    behaviorState.firstAmount = amount;
  }

  return {
    snapshotId: createUuid(),
    attemptId:
      snapshotTrigger === "ORDER_INTENT_CLICK" ? createUuid() : null,
    snapshotTrigger,
    capturedAt,
    market: market || "UNKNOWN",
    side,
    orderMode,
    entryPoint: "NORMAL",
    intentPrice: decimalString(draft?.order_price),
    intentQuantity: decimalString(quantity),
    intentAmount: decimalString(amount),
    requestedBalanceRatio: null,
    draftDurationMs: behaviorState?.draftStartedAt
      ? now - behaviorState.draftStartedAt
      : null,
    lastEditToSnapshotMs: behaviorState?.lastEditAt
      ? now - behaviorState.lastEditAt
      : null,
    draftEditCount: behaviorState?.draftEditCount ?? null,
    amountChangeRate:
      behaviorState?.firstAmount && amount !== null
        ? (amount - behaviorState.firstAmount) / behaviorState.firstAmount
        : null,
    modeChangedToMarket: orderMode === "MARKET"
      ? (behaviorState?.orderModeChangeTimestamps?.length || 0) > 0
      : false,
    orderbookClickToSnapshotMs: behaviorState?.lastOrderbookClickAt
      ? now - behaviorState.lastOrderbookClickAt
      : null,
    orderIntentCount1m: recentIntentCount,
    actualOrderCreatedCount10m: null,
    sameSideIntentCount1m: recentSameSideIntentCount,
    marketChangeCount5m: (behaviorState?.marketChangeTimestamps || []).filter(
      (timestamp) => timestamp >= now - 5 * 60_000,
    ).length,
    sideChangeCount3m: (behaviorState?.sideChangeTimestamps || []).filter(
      (timestamp) => timestamp >= now - 3 * 60_000,
    ).length,
    priceEditCount3m: recentFieldEdits("price"),
    quantityEditCount3m: recentFieldEdits("quantity"),
    amountEditCount3m: recentFieldEdits("amount"),
    inputRevertCount: behaviorState?.inputRevertCount ?? 0,
    priceDirectionChangeCount:
      behaviorState?.priceDirectionChangeCount ?? 0,
    priceChangeRate:
      behaviorState?.firstPrice && price !== null
        ? (price - behaviorState.firstPrice) / behaviorState.firstPrice
        : null,
    orderModeChangeCount3m: (
      behaviorState?.orderModeChangeTimestamps || []
    ).filter((timestamp) => timestamp >= now - 3 * 60_000).length,
    allocationPresetPercent:
      behaviorState?.allocationPresetPercent ?? null,
    draftResetCount3m: 0,
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
    baseAssetAvgBuyPriceBeforeSnapshot: null,
    priceVsAvgBuyRateAtSnapshot: null,
  };
}

function emitOrderContextSnapshot(snapshot, detection = null) {
  const matchedRuleIds = detection?.matchedRuleIds || [];
  const primaryRuleId = detection?.primaryRuleId || null;
  const payload = {
    ...snapshot,
    matchedRuleIdsAtSnapshot: matchedRuleIds,
    primaryShownRuleId: primaryRuleId,
    shownRuleIds: primaryRuleId ? [primaryRuleId] : [],
  };
  emitExtensionDebug(
    "behavior",
    "OrderContextSnapshotDTO",
    payload,
    payload.capturedAt,
  );
  return payload;
}

function beginOrderAttempt(orderButton) {
  if (pendingAttempt && !pendingAttempt.snapshotEmitted) {
    emitOrderContextSnapshot(pendingAttempt.snapshot, activeDetectionResult);
    pendingAttempt.snapshotEmitted = true;
  }
  const snapshot = buildOrderContextSnapshot(
    orderButton,
    "ORDER_INTENT_CLICK",
  );
  pendingAttempt = {
    attemptId: snapshot.attemptId,
    snapshot,
    snapshotEmitted: false,
    feedbackShownAt: null,
  };
  window.setTimeout(() => {
    if (pendingAttempt?.attemptId === snapshot.attemptId && !pendingAttempt.snapshotEmitted) {
      emitOrderContextSnapshot(snapshot, activeDetectionResult);
      pendingAttempt.snapshotEmitted = true;
    }
  }, 2500);
}

function closeGuardrail(action) {
  const dialog = document.getElementById("saltbread-guardrail-dialog");
  const snapshotId = activeGuardrailSnapshotId;
  if (snapshotId) {
    emitExtensionDebug("behavior", "GuardrailReactionDTO", {
      reactionId: createUuid(),
      snapshotId,
      action,
      reactedAt: new Date().toISOString(),
      reactionUiVersion: "v1",
    });
  }
  activeGuardrailSnapshotId = null;
  dialog?.remove();
  if (action === "REVIEW") {
    document.dispatchEvent(new CustomEvent("saltbread:demo-review-order"));
  }
}

function showGuardrail(result, snapshotId) {
  document.getElementById("saltbread-guardrail-dialog")?.remove();
  const dialog = document.createElement("aside");
  dialog.id = "saltbread-guardrail-dialog";
  dialog.setAttribute("aria-label", "불씨 주문 가드레일");
  dialog.innerHTML = `
    <button class="saltbread-guardrail__close" type="button" aria-label="닫기">×</button>
    <span>FIREGUARD · ${result.primaryRuleId || "RISK_RULE"}</span>
    <strong>${DETECTION_TITLES[result.type] || "주문 전 확인"}</strong>
    <p>${result.message || "이 주문을 한 번 더 확인해 보세요."}</p>
    <div>
      <button type="button" data-reaction="REVIEW">주문 내용 다시 보기</button>
      <button type="button" data-reaction="PROCEED">계속 주문하기</button>
    </div>
  `;
  dialog
    .querySelector("[data-reaction='REVIEW']")
    .addEventListener("click", () => closeGuardrail("REVIEW"));
  dialog
    .querySelector("[data-reaction='PROCEED']")
    .addEventListener("click", () => closeGuardrail("PROCEED"));
  dialog
    .querySelector(".saltbread-guardrail__close")
    .addEventListener("click", () => closeGuardrail("CLOSE"));
  document.body.append(dialog);
  activeGuardrailSnapshotId = snapshotId;
}

function showTradeFeedback() {
  if (!pendingAttempt?.attemptId) return;
  const feedbackAttempt = pendingAttempt;
  feedbackAttempt.feedbackShownAt = new Date().toISOString();
  document.getElementById("saltbread-feedback-dialog")?.remove();
  const dialog = document.createElement("aside");
  dialog.id = "saltbread-feedback-dialog";
  dialog.setAttribute("aria-label", "거래 자기평가");
  dialog.innerHTML = `
    <span>TRADE FEEDBACK</span>
    <strong>이번 거래는 어떤 거래였나요?</strong>
    <button type="button" data-assessment="PLANNED">계획된 거래였어요</button>
    <button type="button" data-assessment="EMOTIONAL">감정적인 거래였어요</button>
    <button type="button" data-assessment="DISMISSED">건너뛰기</button>
  `;
  dialog.querySelectorAll("[data-assessment]").forEach((button) => {
    button.addEventListener("click", () => {
      const assessment = button.dataset.assessment;
      emitExtensionDebug("behavior", "TradeFeedbackDTO", {
        feedbackId: createUuid(),
        attemptId: feedbackAttempt.attemptId,
        feedbackStatus:
          assessment === "DISMISSED" ? "DISMISSED" : "ANSWERED",
        selfAssessment:
          assessment === "DISMISSED" ? null : assessment,
        feedbackShownAt: feedbackAttempt.feedbackShownAt,
        respondedAt: new Date().toISOString(),
        feedbackUiVersion: "v1",
      });
      dialog.remove();
    });
  });
  document.body.append(dialog);
}

function handleDemoContext(event) {
  if (!isDemoPage()) return;
  acknowledgePageEvent(event);
}

function handleDemoOrderEvent(event) {
  if (!isDemoPage()) return;
  acknowledgePageEvent(event);
}

function handleDocumentClick(event) {
  if (!behaviorState) {
    return;
  }

  const confirmButton = event.target instanceof Element
    ? event.target.closest("[data-saltbread-order-confirm]")
    : null;
  if (confirmButton) {
    if (!isDemoPage()) {
      showTradeFeedback();
    }
    return;
  }

  if (isDemoPage()) {
    return;
  }

  const orderbookTarget = event.target instanceof Element
    ? event.target.closest("[data-saltbread-orderbook-price]")
    : null;
  if (orderbookTarget) {
    behaviorState.lastOrderbookClickAt = Date.now();
  }

  const clickedControl = event.target instanceof Element
    ? event.target.closest("button, [role='tab']")
    : null;
  const clickedText = normalizedText(clickedControl);
  if (/^(10%|25%|50%|100%|최대)$/.test(clickedText)) {
    behaviorState.allocationPresetPercent =
      clickedText === "최대" ? 100 : Number(clickedText.replace("%", ""));
  }
  if (/^(매수|매도)$/.test(clickedText)) {
    behaviorState.sideChangeTimestamps.push(Date.now());
  }

  const orderTypeControl = findOrderTypeControl(event.target);

  if (orderTypeControl) {
    window.setTimeout(
      () => syncOrderType(findOrderPanel(orderTypeControl), true),
      0,
    );
  }

  if (isMaxButton(event.target)) {
    behaviorState.maxClickedSinceLastOrder = true;
    renderBehaviorMetrics();
    return;
  }

  const orderButton = findOrderButton(event.target);

  if (!orderButton) {
    return;
  }

  beginOrderAttempt(orderButton);

  flushPendingInputEvents();
  const orderPanel = findOrderPanel(orderButton);
  const orderSide =
    orderButton.dataset.saltbreadOrderAction ||
    detectOrderActionSide(normalizedText(orderButton));
  if (["BUY", "SELL"].includes(orderSide)) {
    const clickedAt = Date.now();
    behaviorState.orderIntentTimestamps.push(clickedAt);
    behaviorState.sameSideIntentTimestamps[orderSide].push(clickedAt);
  }
  const clickEvent = createBehaviorEvent(
    orderSide === "SELL" ? "SELL_CLICK" : "BUY_CLICK",
    orderPanel,
    { side: orderSide },
  );

  if (clickEvent && ["BUY", "SELL"].includes(orderSide)) {
    addOrderValues(clickEvent, orderPanel);
    sendBehaviorEvent(clickEvent);
  }

  const submittedSessionId = behaviorState.sessionId;
  const orderDraft = readOrderDraft(orderButton);

  if (!orderDraft) {
    const orderType = detectOrderType(orderPanel);

    if (orderType && ["BUY", "SELL"].includes(orderSide)) {
      const submitEvent = createBehaviorEvent(
        "ORDER_SUBMIT_ATTEMPT",
        orderPanel,
        { side: orderSide, orderType },
      );
      addOrderValues(submitEvent, orderPanel);
      sendBehaviorEvent(submitEvent);
    }

    startNewOrderSession();
    syncOrderType(orderPanel, false);
    setAnalysisStatus(
      "주문 정보를 읽지 못했습니다. 거래 화면을 새로고침해 주세요.",
      "error",
    );
    return;
  }

  if (orderDraft.order_side === "BUY") {
    const marketClicks =
      behaviorState.buyClicksByMarket[behaviorState.market] || [];
    marketClicks.push(Date.now());
    behaviorState.buyClicksByMarket[behaviorState.market] = marketClicks;
  }

  behaviorState.lastOrder = orderDraft;
  const behaviorData = getBehaviorData();
  behaviorState.lastOrderBehavior = behaviorData;
  behaviorState.lastOrderAt = Date.now();
  behaviorState.lastOrderSessionId = submittedSessionId;
  behaviorState.maxClickedSinceLastOrder = false;
  renderBehaviorMetrics();
  applyFlameTheme("default");
  setAnalysisStatus("주문·체결 데이터를 확인하고 있어요.", "loading");

  chrome.runtime
    .sendMessage({
      type: "ORDER_ACTION_DETECTED",
      payload: {
        market: behaviorState.market,
        sessionId: submittedSessionId,
        pageUrl: location.href,
        currentOrder: orderDraft,
        behaviorData,
        orderContextSnapshot: pendingAttempt?.snapshot || null,
        demoData: null,
      },
    })
    .then((response) => {
      if (!response?.ok && response?.error) {
        setAnalysisStatus(response.error, "error");
      }
    })
    .catch(() =>
      setAnalysisStatus("확장 프로그램과 연결할 수 없습니다.", "error"),
    );

  startNewOrderSession();
  syncOrderType(orderPanel, false);
}

function updateVisibleDuration() {
  if (!behaviorState?.visibleSince) {
    return;
  }

  behaviorState.visibleDurationMs += Date.now() - behaviorState.visibleSince;
  behaviorState.visibleSince = null;
}

function handleVisibilityChange() {
  if (!behaviorState) {
    return;
  }

  if (document.hidden) {
    updateVisibleDuration();
  } else {
    behaviorState.visibleSince = Date.now();
  }

  renderBehaviorMetrics();
}

function syncCurrentMarket() {
  if (!behaviorState) {
    return;
  }

  const nextMarket = parseMarket(location.href);

  if (!nextMarket || nextMarket === behaviorState.market) {
    return;
  }

  flushPendingInputEvents();
  updateVisibleDuration();
  behaviorState.marketChangeTimestamps.push(Date.now());
  behaviorState.market = nextMarket;
  behaviorState.visibleDurationMs = 0;
  behaviorState.visibleSince = document.hidden ? null : Date.now();
  behaviorState.maxClickedSinceLastOrder = false;
  behaviorState.lastOrder = null;
  behaviorState.lastOrderBehavior = null;
  behaviorState.lastOrderAt = null;
  behaviorState.lastOrderSessionId = null;
  startNewOrderSession();
  renderBehaviorMetrics();
  registerCurrentContext();
}

function getBehaviorData() {
  return buildBehaviorSnapshot(behaviorState);
}

function formatDuration(durationSeconds) {
  const totalSeconds = Math.floor(durationSeconds);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  return [hours, minutes, seconds]
    .map((value) => String(value).padStart(2, "0"))
    .join(":");
}

function formatWon(value) {
  return value === null
    ? "-"
    : `${Math.round(value).toLocaleString("ko-KR")}원`;
}

function promoteMetricCard(card) {
  const list = card.closest(".saltbread-metric-list");

  if (!list || list.firstElementChild === card) {
    return;
  }

  const cards = [...list.querySelectorAll(".saltbread-metric-card")];
  const previousTops = new Map(
    cards.map((item) => [item, item.getBoundingClientRect().top]),
  );
  list.prepend(card);

  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    return;
  }

  requestAnimationFrame(() => {
    for (const item of cards) {
      const previousTop = previousTops.get(item);
      const nextTop = item.getBoundingClientRect().top;
      const delta = previousTop - nextTop;

      if (Math.abs(delta) < 1 || typeof item.animate !== "function") {
        continue;
      }

      item.animate(
        [
          { transform: `translateY(${delta}px)` },
          { transform: "translateY(0)" },
        ],
        {
          duration: 360,
          easing: "cubic-bezier(0.22, 1, 0.36, 1)",
        },
      );
    }
  });
}

function setMetric(id, value) {
  const card = document.querySelector(`[data-metric="${id}"]`);

  if (!card) {
    return;
  }

  const valueElement = card.querySelector(".saltbread-metric-card__value");

  if (valueElement.textContent === value) {
    return;
  }

  valueElement.textContent = value;
  card.dataset.changed = "true";
  card.classList.remove("is-updated");
  void card.offsetWidth;
  card.classList.add("is-updated");
  promoteMetricCard(card);
  window.setTimeout(() => card.classList.remove("is-updated"), 650);
}

function renderBehaviorMetrics() {
  if (!behaviorState) {
    return;
  }

  const behavior = getBehaviorData();
  const marketLabel = document.querySelector("[data-current-market]");

  if (marketLabel) {
    marketLabel.textContent = behaviorState.market || "종목 확인 중";
  }

  setMetric(
    "max-click",
    behavior.is_max_button_clicked ? "예" : "아니요",
  );
  setMetric("buy-clicks", `${behavior.buy_click_count_1m}회`);
  setMetric("amount-edits", `${behavior.input_edit_count}회`);
  setMetric("average-buy", formatWon(behavior.client_avg_buy_amount));
  setMetric("dwell-time", formatDuration(behavior.page_stay_duration));
}

function setAnalysisStatus(message, state = "loading", type = null, title = null) {
  const status = document.querySelector(".saltbread-analysis-status");
  const badgeElement = status?.querySelector("[data-status-badge]");
  const titleElement = status?.querySelector("[data-status-title]");
  const messageElement = status?.querySelector("[data-status-message]");

  if (!status || !badgeElement || !titleElement || !messageElement) {
    return;
  }

  if (state === "loading") {
    applyFlameTheme("default");
  }

  status.dataset.state = state;

  if (state === "detected") {
    badgeElement.textContent = "주의";
    titleElement.textContent =
      title || DETECTION_TITLES[type] || type || "감정 매매 패턴 감지";
    messageElement.textContent = message;
    return;
  }

  if (state === "safe") {
    badgeElement.textContent = "미감지";
    titleElement.textContent = "감지된 패턴 없음";
    messageElement.textContent = message;
    return;
  }

  if (state === "error") {
    badgeElement.textContent = "확인 필요";
    titleElement.textContent = "데이터 연결 확인";
    messageElement.textContent = message;
    return;
  }

  badgeElement.textContent = "실시간 분석";
  titleElement.textContent = message || "데이터 수집 중...";
  messageElement.textContent = "주문 행동 변화를 확인하고 있어요.";
}

function getContextSnapshot() {
  const currentBehavior = behaviorState ? getBehaviorData() : null;
  const hasRecentOrder =
    behaviorState?.lastOrderAt &&
    Date.now() - behaviorState.lastOrderAt <= 2 * 60 * 1000;
  const behaviorData =
    hasRecentOrder && behaviorState.lastOrderBehavior
      ? {
          ...behaviorState.lastOrderBehavior,
          client_avg_buy_amount: currentBehavior.client_avg_buy_amount,
        }
      : currentBehavior;

  return {
    market: behaviorState?.market || parseMarket(location.href),
    sessionId:
      hasRecentOrder && behaviorState.lastOrderSessionId
        ? behaviorState.lastOrderSessionId
        : behaviorState?.sessionId,
    pageUrl: location.href,
    behaviorData,
    currentOrder:
      behaviorState?.lastOrder ||
      readOrderDraft(),
    orderContextSnapshot: pendingAttempt?.snapshot || null,
    demoData: null,
  };
}

function registerCurrentContext() {
  const snapshot = getContextSnapshot();

  if (!snapshot.market) {
    setAnalysisStatus("현재 종목을 확인하고 있어요.", "loading");
    return;
  }

  chrome.runtime
    .sendMessage({ type: "REGISTER_MARKET_CONTEXT", payload: snapshot })
    .catch(() => {});
}

function startBehaviorTracking() {
  if (behaviorState) {
    return;
  }

  behaviorState = {
    market: parseMarket(location.href),
    sessionId: createOrderSessionId(),
    inputEditTimestamps: [],
    inputEditTimestampsByField: {
      price: [],
      quantity: [],
      amount: [],
    },
    inputValueHistoryByField: {
      price: new Set(),
      quantity: new Set(),
      amount: new Set(),
    },
    lastInputValueByField: {},
    pendingInputEvents: new Map(),
    lastLoggedInputValues: new Map(),
    lastOrderType: null,
    buyClicksByMarket: {},
    orderIntentTimestamps: [],
    sameSideIntentTimestamps: {
      BUY: [],
      SELL: [],
    },
    maxClickedSinceLastOrder: false,
    clientAvgBuyAmount: null,
    lastOrder: null,
    lastOrderBehavior: null,
    lastOrderAt: null,
    lastOrderSessionId: null,
    visibleDurationMs: 0,
    visibleSince: document.hidden ? null : Date.now(),
    draftStartedAt: null,
    lastEditAt: null,
    draftEditCount: 0,
    firstAmount: null,
    firstPrice: null,
    lastPriceValue: null,
    lastPriceDirection: null,
    inputRevertCount: 0,
    priceDirectionChangeCount: 0,
    lastOrderbookClickAt: null,
    marketChangeTimestamps: [],
    sideChangeTimestamps: [],
    orderModeChangeTimestamps: [],
    allocationPresetPercent: null,
  };

  document.addEventListener("input", handleAmountInput, true);
  document.addEventListener("click", handleDocumentClick, true);
  document.addEventListener("saltbread:demo-scenario", handleDemoScenario);
  document.addEventListener("saltbread:detect-now", handleDetectNow);
  document.addEventListener("saltbread:demo-reset", handleDemoReset);
  document.addEventListener("saltbread:demo-context", handleDemoContext);
  document.addEventListener("saltbread:demo-order-event", handleDemoOrderEvent);
  document.addEventListener("visibilitychange", handleVisibilityChange);
  syncCurrentOrderType(false);
  behaviorTimerId = window.setInterval(() => {
    syncCurrentMarket();
    syncCurrentOrderType(true);
    renderBehaviorMetrics();
  }, 1000);
  renderBehaviorMetrics();
  if (!isDemoPage()) {
    registerCurrentContext();
  }
}

function stopBehaviorTracking() {
  if (!behaviorState) {
    return;
  }

  document.removeEventListener("input", handleAmountInput, true);
  document.removeEventListener("click", handleDocumentClick, true);
  document.removeEventListener("saltbread:demo-scenario", handleDemoScenario);
  document.removeEventListener("saltbread:detect-now", handleDetectNow);
  document.removeEventListener("saltbread:demo-reset", handleDemoReset);
  document.removeEventListener("saltbread:demo-context", handleDemoContext);
  document.removeEventListener("saltbread:demo-order-event", handleDemoOrderEvent);
  document.removeEventListener("visibilitychange", handleVisibilityChange);
  for (const pending of behaviorState.pendingInputEvents.values()) {
    window.clearTimeout(pending.timerId);
  }
  window.clearInterval(behaviorTimerId);
  behaviorTimerId = null;
  behaviorState = null;
  pendingAttempt = null;
  activeDetectionResult = null;
  activeGuardrailSnapshotId = null;
}

function syncPanel(auth) {
  if (!isDashboardPage() && (isLoggedIn(auth) || isDemoPage())) {
    createPanel(auth);
    return;
  }

  removePanel();
}

function refreshPanelState() {
  return chrome.storage.local
    .get("auth")
    .then(({ auth }) => syncPanel(auth));
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "GET_CONTEXT_SNAPSHOT") {
    sendResponse(getContextSnapshot());
    return false;
  }

  if (message?.type === "ORDER_DATA_UPDATED" && behaviorState) {
    behaviorState.clientAvgBuyAmount =
      message.payload?.clientAverageBuyAmount ?? null;
    renderBehaviorMetrics();
    setAnalysisStatus("데이터 수집 중...", "loading");
    return false;
  }

  if (message?.type === "COLLECTION_STARTED") {
    setAnalysisStatus("데이터 수집 중...", "loading");
    return false;
  }

  if (message?.type === "DETECTION_RESULT") {
    const result = message.payload;
    applyFlameTheme(result?.visualMode || result?.flameMode);
    activeDetectionResult = result?.detected ? result : null;

    if (result?.detected) {
      let snapshot;
      if (result.orderContextSnapshot) {
        snapshot = emitOrderContextSnapshot(result.orderContextSnapshot, result);
        if (pendingAttempt) {
          pendingAttempt.snapshotEmitted = true;
        }
      } else if (pendingAttempt && !pendingAttempt.snapshotEmitted) {
        snapshot = emitOrderContextSnapshot(pendingAttempt.snapshot, result);
        pendingAttempt.snapshotEmitted = true;
      } else if (pendingAttempt?.snapshot) {
        snapshot = pendingAttempt.snapshot;
      } else if (!activeGuardrailSnapshotId && isDemoPage()) {
        snapshot = emitOrderContextSnapshot(
          buildOrderContextSnapshot(null, "GUARDRAIL_SHOWN"),
          result,
        );
      }
      if (isDemoPage() && snapshot) {
        showGuardrail(result, snapshot.snapshotId);
      }
      if (snapshot?.snapshotId) {
        activeGuardrailSnapshotId = snapshot.snapshotId;
      }
      const panel = document.getElementById(PANEL_ID);
      if (panel) {
        setPanelCollapsed(panel, false);
      }
      setAnalysisStatus(
        result.message || `${result.type} 감정 매매 타입을 감지했어요.`,
        "detected",
        result.type,
        result.warningTitle || result.primaryRule?.warningTitle || null,
      );
    } else {
      activeGuardrailSnapshotId = null;
      document.getElementById("saltbread-guardrail-dialog")?.remove();
      setAnalysisStatus(result?.message || "데이터 수집 중...", "safe");
    }

    return false;
  }

  if (message?.type === "COLLECTION_ERROR") {
    applyFlameTheme("default");
    setAnalysisStatus(message.payload?.message || "데이터 수집에 실패했습니다.", "error");
    return false;
  }

  if (message?.type === "BEHAVIOR_EVENT_STATUS") {
    setLoggingStatus(message.payload?.message || "");
  }

  if (message?.type === "DEBUG_DATA_UPDATED") {
    emitExtensionDebug(
      message.payload?.category || "market",
      message.payload?.kind || "COLLECTED_DATA",
      message.payload?.data,
      message.payload?.occurredAt,
    );
  }

  if (message?.type === "DTO_DEBUG_SNAPSHOT") {
    console.log("[Saltbread DTO Debug]", message.payload);
    emitExtensionDebug(
      "behavior",
      "DTO_DEBUG_SNAPSHOT",
      message.payload,
      message.payload?.collectedAt,
    );
  }

  return false;
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local") {
    return;
  }

  if (changes.auth) {
    refreshPanelState();
  }

  if (changes.flameTheme) {
    applyFlameTheme(changes.flameTheme.newValue?.mode);
  }
});

refreshPanelState();

window.setInterval(() => {
  if (location.href === currentPageUrl) {
    return;
  }

  currentPageUrl = location.href;
  refreshPanelState();
}, 500);
