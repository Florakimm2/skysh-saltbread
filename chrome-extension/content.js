const PANEL_ID = "saltbread-extension-panel";
const APP_URL = globalThis.SALTBREAD_CONFIG.appUrl;
const APP_ORIGINS = new Set([
  APP_URL,
  ...(globalThis.SALTBREAD_CONFIG.appOrigins || []),
]);
const CONSENT_STORAGE_KEY = "behaviorDataConsent";
const CONSENT_VERSION = 1;
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
let demoContext = null;
let demoDetectionTimerId = null;
let currentPageUrl = location.href;

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

function acknowledgePageEvent(event) {
  const requestId = event.detail?.requestId;

  if (typeof requestId === "string" && requestId) {
    document.documentElement.setAttribute(
      "data-saltbread-event-ack",
      requestId,
    );
  }
}

function activeDemoContext() {
  if (!demoContext) {
    return null;
  }

  if (Date.now() >= demoContext.expiresAt) {
    demoContext = null;
    return null;
  }

  return demoContext;
}

function normalizeFlameMode(mode) {
  return ["default", "blue", "pink"].includes(mode) ? mode : "default";
}

function applyFlameTheme(mode) {
  const normalizedMode = normalizeFlameMode(mode);
  const panel = document.getElementById(PANEL_ID);

  if (panel) {
    panel.dataset.flameMode = normalizedMode;
  }

  panelFlame?.setMode(normalizedMode);
  collapsedPanelFlame?.setMode(normalizedMode);
}

function isLoggedIn(auth) {
  return Boolean(auth?.accessToken && auth?.user);
}

function hasBehaviorDataConsent(consent) {
  return consent?.accepted === true && consent.version === CONSENT_VERSION;
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
  panel.setAttribute("aria-label", "Fireguard 행동 데이터");
  panel.innerHTML = `
    <div class="saltbread-panel__collapsed-controls" aria-hidden="true">
      <div class="saltbread-panel__collapsed-flame"></div>
      <button
        class="saltbread-panel__reopen"
        type="button"
        aria-label="Fireguard 패널 열기"
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
          <strong>Fireguard</strong>
          <span>행동 데이터</span>
        </div>
        <button
          class="saltbread-panel__collapse"
          type="button"
          aria-label="Fireguard 패널 접기"
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
    auth.user.email;
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
    .addEventListener("click", () => setPanelCollapsed(panel, true));

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
      label: "접힌 Fireguard의 현재 감정 매매 상태 불꽃",
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

  const explicitSide = button.dataset.saltbreadOrderAction;
  const orderSide =
    ["BUY", "SELL"].includes(explicitSide) ? explicitSide : detectOrderActionSide(
      normalizedText(button),
    );

  return orderSide && findOrderPanel(button)
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
  const inputs = [...panel.querySelectorAll("input")];

  for (const input of inputs) {
    let candidate = input.parentElement;

    for (let depth = 0; candidate && depth < 4; depth += 1) {
      if (labelPattern.test(normalizedText(candidate))) {
        const value = toNumber(input.value);

        if (value !== null) {
          return value;
        }
      }

      candidate = candidate.parentElement;
    }
  }

  return null;
}

function detectOrderType(panel) {
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

  return "LIMIT";
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

  return /매도주문|매도하기/.test(normalizedText(panel)) ? "SELL" : "BUY";
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
    explicitAmount ?? (price !== null && volume !== null ? price * volume : 0);

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

  behaviorState.inputEditTimestamps.push(Date.now());
  renderBehaviorMetrics();
}

function handleDemoScenario(event) {
  if (!behaviorState || !isAppPage()) {
    return;
  }

  const detail = event.detail;
  const behavior = detail?.behaviorData;

  if (
    !detail?.currentOrder ||
    !behavior ||
    !Number.isFinite(detail.expiresAt)
  ) {
    return;
  }

  acknowledgePageEvent(event);
  const now = Date.now();
  const market = detail.market || behaviorState.market;
  behaviorState.market = market;
  behaviorState.inputEditTimestamps = Array.from(
    { length: Math.max(0, behavior.input_edit_count || 0) },
    (_, index) => now - index * 1000,
  );
  behaviorState.buyClicksByMarket[market] = Array.from(
    { length: Math.max(0, behavior.buy_click_count_1m || 0) },
    (_, index) => now - index * 1000,
  );
  behaviorState.maxClickedSinceLastOrder = Boolean(
    behavior.is_max_button_clicked,
  );
  behaviorState.clientAvgBuyAmount =
    behavior.client_avg_buy_amount ?? null;
  behaviorState.visibleDurationMs = Math.max(
    0,
    Number(behavior.page_stay_duration || 0) * 1000,
  );
  behaviorState.visibleSince = document.hidden ? null : now;
  demoContext = {
    type: detail.type || null,
    title: detail.title || "데모 시나리오",
    expiresAt: detail.expiresAt,
    currentOrder: detail.currentOrder,
    recentOrders: Array.isArray(detail.recentOrders)
      ? detail.recentOrders
      : [],
    clientAverageBuyAmount:
      detail.clientAverageBuyAmount ??
      behavior.client_avg_buy_amount ??
      null,
    currentPrice: detail.currentPrice,
    marketData: detail.marketData || null,
  };
  renderBehaviorMetrics();
  setAnalysisStatus("데이터 수집 중...", "loading");
  window.clearTimeout(demoDetectionTimerId);
  demoDetectionTimerId = window.setTimeout(() => {
    demoDetectionTimerId = null;
    handleDetectNow();
  }, 2000);
}

function handleDetectNow(event) {
  if (!behaviorState || !isAppPage()) {
    return;
  }

  if (event) {
    acknowledgePageEvent(event);
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
  window.clearTimeout(demoDetectionTimerId);
  demoDetectionTimerId = null;
  demoContext = null;
  behaviorState.market = market;
  behaviorState.inputEditTimestamps = [];
  behaviorState.buyClicksByMarket = market ? { [market]: [] } : {};
  behaviorState.maxClickedSinceLastOrder = false;
  behaviorState.clientAvgBuyAmount = null;
  behaviorState.lastOrder = null;
  behaviorState.lastOrderBehavior = null;
  behaviorState.lastOrderAt = null;
  behaviorState.visibleDurationMs = 0;
  behaviorState.visibleSince = document.hidden ? null : Date.now();
  applyFlameTheme("default");
  renderBehaviorMetrics();
  setAnalysisStatus("데이터 수집 중...", "loading");
  chrome.runtime.sendMessage({ type: "RESET_DEMO_STATE" }).catch(() => {});
}

function handleDocumentClick(event) {
  if (!behaviorState) {
    return;
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

  const demo = activeDemoContext();
  const orderDraft = demo?.currentOrder
    ? {
        ...demo.currentOrder,
        order_request_time: new Date().toISOString(),
      }
    : readOrderDraft(orderButton);

  if (!orderDraft) {
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
  behaviorState.maxClickedSinceLastOrder = false;
  renderBehaviorMetrics();
  applyFlameTheme("default");
  setAnalysisStatus("주문·체결 데이터를 확인하고 있어요.", "loading");

  chrome.runtime
    .sendMessage({
      type: "ORDER_ACTION_DETECTED",
      payload: {
        market: behaviorState.market,
        currentOrder: orderDraft,
        behaviorData,
        demoData: demo
          ? {
              recentOrders: demo.recentOrders,
              clientAverageBuyAmount: demo.clientAverageBuyAmount,
              currentPrice: demo.currentPrice,
              marketData: demo.marketData,
              type: demo.type,
              expiresAt: demo.expiresAt,
            }
          : null,
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

  updateVisibleDuration();
  behaviorState.market = nextMarket;
  behaviorState.visibleDurationMs = 0;
  behaviorState.visibleSince = document.hidden ? null : Date.now();
  behaviorState.maxClickedSinceLastOrder = false;
  behaviorState.lastOrder = null;
  behaviorState.lastOrderBehavior = null;
  behaviorState.lastOrderAt = null;
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

function setAnalysisStatus(message, state = "loading", type = null) {
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
      DETECTION_TITLES[type] || type || "감정 매매 패턴 감지";
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
  const demo = activeDemoContext();
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
    behaviorData,
    currentOrder:
      demo?.currentOrder ||
      behaviorState?.lastOrder ||
      readOrderDraft(),
    demoData: demo
      ? {
          recentOrders: demo.recentOrders,
          clientAverageBuyAmount: demo.clientAverageBuyAmount,
          currentPrice: demo.currentPrice,
          marketData: demo.marketData,
          type: demo.type,
          expiresAt: demo.expiresAt,
        }
      : null,
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
    inputEditTimestamps: [],
    buyClicksByMarket: {},
    maxClickedSinceLastOrder: false,
    clientAvgBuyAmount: null,
    lastOrder: null,
    lastOrderBehavior: null,
    lastOrderAt: null,
    visibleDurationMs: 0,
    visibleSince: document.hidden ? null : Date.now(),
  };

  document.addEventListener("input", handleAmountInput, true);
  document.addEventListener("click", handleDocumentClick, true);
  document.addEventListener("saltbread:demo-scenario", handleDemoScenario);
  document.addEventListener("saltbread:detect-now", handleDetectNow);
  document.addEventListener("saltbread:demo-reset", handleDemoReset);
  document.addEventListener("visibilitychange", handleVisibilityChange);
  behaviorTimerId = window.setInterval(() => {
    syncCurrentMarket();
    renderBehaviorMetrics();
  }, 1000);
  renderBehaviorMetrics();
  registerCurrentContext();
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
  document.removeEventListener("visibilitychange", handleVisibilityChange);
  window.clearInterval(behaviorTimerId);
  window.clearTimeout(demoDetectionTimerId);
  behaviorTimerId = null;
  demoDetectionTimerId = null;
  behaviorState = null;
  demoContext = null;
}

function syncPanel(auth, behaviorDataConsent) {
  if (
    !isDashboardPage() &&
    isLoggedIn(auth) &&
    hasBehaviorDataConsent(behaviorDataConsent)
  ) {
    createPanel(auth);
    return;
  }

  removePanel();
}

function refreshPanelState() {
  return chrome.storage.local
    .get(["auth", CONSENT_STORAGE_KEY])
    .then(({ auth, behaviorDataConsent }) =>
      syncPanel(auth, behaviorDataConsent),
    );
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
    applyFlameTheme(result?.flameMode);

    if (result?.detected) {
      setAnalysisStatus(
        result.message || `${result.type} 감정 매매 타입을 감지했어요.`,
        "detected",
        result.type,
      );
    } else {
      setAnalysisStatus(result?.message || "데이터 수집 중...", "safe");
    }

    return false;
  }

  if (message?.type === "COLLECTION_ERROR") {
    applyFlameTheme("default");
    setAnalysisStatus(message.payload?.message || "데이터 수집에 실패했습니다.", "error");
  }

  return false;
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local") {
    return;
  }

  if (changes.auth || changes[CONSENT_STORAGE_KEY]) {
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
