const PANEL_ID = "saltbread-extension-panel";
const APP_URL = globalThis.SALTBREAD_CONFIG.appUrl;
const APP_ORIGINS = new Set([
  APP_URL,
  ...(globalThis.SALTBREAD_CONFIG.appOrigins || []),
]);
const BEHAVIOR_INPUT_DEBOUNCE_MS = 650;
const GUARDRAIL_RULES_CACHE_KEY = "guardrailRulesCache";
const {
  buildBehaviorSnapshot,
  detectOrderActionSide,
  evaluateGuardrailRules,
  parseMarket,
  resolveVisualMode,
  toNumber,
} =
  globalThis.SaltbreadCore;
const DETECTION_TITLES = {
  FOMO_CHASING: "FOMO 추격 매수",
  REVENGE_TRADING: "복수 매매",
  HESITATION: "주문 망설임",
  ALL_IN_IMPULSE: "충동적 올인",
  AMOUNT_SPIKE: "주문 금액 급증",
  MACHINE_GUN_TRADING: "연속 시장가 매수",
  HIGH_RISK_HOPPING: "고위험 종목 이동",
};
const VISUAL_MODE_LABELS = {
  DEFAULT: "기본",
  CURIOUS: "확인",
  SURPRISED: "급변",
  FAST_BURN: "반복",
  SCARED: "위험",
  SAD: "손실",
};

let behaviorState = null;
let behaviorTimerId = null;
let panelFlame = null;
let collapsedPanelFlame = null;
let currentPageUrl = location.href;
let pendingAttempt = null;
let activeGuardrailSnapshotId = null;
let activeDetectionResult = null;
let activeTradeFeedback = null;
let guardrailRulesLogged = false;
let shownGuardrailSnapshotIds = new Set();
let closedGuardrailSnapshotIds = new Set();
let pageGuardrailRules = [];
let pageGuardrailRulesState = {
  rules: [],
  source: "unloaded",
  error: null,
  fetchedAt: null,
};
let guardrailRulesLoadPromise = null;

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

function isUpbitExchangePage() {
  return (
    ["upbit.com", "www.upbit.com"].includes(location.hostname) &&
    location.pathname.startsWith("/exchange")
  );
}

function isPanelAllowedPage() {
  return isDemoPage() || isUpbitExchangePage();
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
    FASTBURN: "FAST_BURN",
    FAST_BURN: "FAST_BURN",
    FAST_BURNING: "FAST_BURN",
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

function toDatasetFlameMode(mode) {
  const normalizedMode = normalizeFlameMode(mode);
  return normalizedMode === "FAST_BURN"
    ? "fast_burn"
    : normalizedMode.toLowerCase();
}

function toAnimationFlameMode(mode) {
  const normalizedMode = normalizeFlameMode(mode);
  const modes = {
    DEFAULT: "default",
    CURIOUS: "curious",
    SURPRISED: "surprised",
    FAST_BURN: "fastBurn",
    SCARED: "scared",
    SAD: "sad",
  };

  return modes[normalizedMode] || "default";
}

function setFlameAnimationMode(animation, mode) {
  if (!animation?.setMode) {
    return;
  }

  animation.setMode(toAnimationFlameMode(mode));
}

function applyFlameTheme(mode) {
  const normalizedMode = normalizeFlameMode(mode);
  const panel = document.getElementById(PANEL_ID);

  if (panel) {
    panel.dataset.flameMode = toDatasetFlameMode(normalizedMode);
  }

  setFlameAnimationMode(panelFlame, normalizedMode);
}

function resetPanelFlameState() {
  activeDetectionResult = null;
  activeGuardrailSnapshotId = null;
  activeTradeFeedback = null;
  shownGuardrailSnapshotIds = new Set();
  closedGuardrailSnapshotIds = new Set();
  applyFlameTheme("default");
  setPanelWarningActive(false);
  setPanelFeedbackActive(false);
}

function rememberGuardrailSnapshot(set, snapshotId) {
  if (!snapshotId) {
    return;
  }

  if (set.size >= 100) {
    set.delete(set.values().next().value);
  }

  set.add(snapshotId);
}

function isGuardrailSnapshotHandled(snapshotId) {
  return Boolean(
    snapshotId &&
      (shownGuardrailSnapshotIds.has(snapshotId) ||
        closedGuardrailSnapshotIds.has(snapshotId)),
  );
}

function isLoggedIn(auth) {
  return Boolean(auth?.accessToken && auth?.user);
}

function hasCompletedOnboarding(auth) {
  return Boolean(
    auth?.user?.personalDataConsentAgreed &&
      auth?.user?.onboardingCompleted,
  );
}

function canShowPanel(auth) {
  return isPanelAllowedPage() && isLoggedIn(auth) && hasCompletedOnboarding(auth);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function summarizeRuleForLog(rule) {
  return {
    ruleId: rule.ruleId,
    name: rule.name,
    isEnabled: rule.isEnabled,
    priority: rule.priority,
    riskLevel: rule.riskLevel,
    visualMode: rule.visualMode,
    warningTitle: rule.warningTitle,
    requiresPrivateApi: rule.requiresPrivateApi,
  };
}

function renderRuleRows(rules = []) {
  const userRules = Array.isArray(rules) ? rules : [];

  if (userRules.length === 0) {
    return `
      <article class="saltbread-rule-row saltbread-rule-row--empty">
        <span class="saltbread-rule-row__swatch" aria-hidden="true"></span>
        <span class="saltbread-rule-row__title">설정된 규칙 없음</span>
        <strong class="saltbread-rule-row__mode">대기</strong>
      </article>
    `;
  }

  return userRules.map((rule) => {
    const visualMode = normalizeFlameMode(rule.visualMode);
    const title = rule.warningTitle || rule.name || "이름 없는 규칙";
    const modeLabel = VISUAL_MODE_LABELS[visualMode] || visualMode;

    return `
      <article
        class="saltbread-rule-row"
        data-rule-id="${escapeHtml(rule.ruleId || "")}"
        data-rule-mode="${toDatasetFlameMode(visualMode)}"
        data-enabled="${String(rule.isEnabled !== false)}"
        title="${escapeHtml(rule.description || rule.warningMessage || title)}"
      >
        <span class="saltbread-rule-row__swatch" aria-hidden="true"></span>
        <span class="saltbread-rule-row__title">${escapeHtml(title)}</span>
        <strong class="saltbread-rule-row__mode">${escapeHtml(modeLabel)}</strong>
      </article>
    `;
  }).join("");
}

function renderGuardrailRulesFromCache(cache = {}) {
  const panel = document.getElementById(PANEL_ID);
  const list = panel?.querySelector("[data-guardrail-rule-list]");
  const count = panel?.querySelector("[data-guardrail-rule-count]");
  const rules = Array.isArray(cache.rules) ? cache.rules : [];

  if (!list || !count) {
    return;
  }

  list.innerHTML = renderRuleRows(rules);
  count.textContent = `${rules.length}개`;

  if (!guardrailRulesLogged && cache.fetchedAt) {
    guardrailRulesLogged = true;
    console.log(
      "[Saltbread] Loaded user guardrail rules",
      rules.map(summarizeRuleForLog),
    );
  }
}

function setPageGuardrailRulesState(state = {}) {
  const rules = Array.isArray(state.rules) ? state.rules : [];
  pageGuardrailRules = rules;
  pageGuardrailRulesState = {
    rules,
    source: state.source || (state.fetchedAt ? "cache" : "unloaded"),
    error: state.error || state.loadError || null,
    fetchedAt: state.fetchedAt || null,
    userId: state.userId || null,
  };
  renderGuardrailRulesFromCache(pageGuardrailRulesState);
  reviewPendingAttemptWithPageRules();
  return pageGuardrailRulesState;
}

function loadPageGuardrailRules() {
  if (guardrailRulesLoadPromise) {
    return guardrailRulesLoadPromise;
  }

  guardrailRulesLoadPromise = chrome.runtime
    .sendMessage({ type: "LOAD_GUARDRAIL_RULES" })
    .then((response) => {
      if (!response?.ok) {
        throw new Error(response?.error || "규칙을 불러오지 못했습니다.");
      }

      return setPageGuardrailRulesState(response.guardrailRules || {});
    })
    .catch((error) =>
      chrome.storage.local
        .get(GUARDRAIL_RULES_CACHE_KEY)
        .then((result) =>
          setPageGuardrailRulesState({
            ...(result[GUARDRAIL_RULES_CACHE_KEY] || {}),
            source: "cache",
            error:
              error instanceof Error
                ? error.message
                : "규칙을 불러오지 못했습니다.",
          }),
        ),
    );

  return guardrailRulesLoadPromise;
}

function createPanelFlame(host, options) {
  if (!host) {
    return null;
  }

  const animationOptions = {
    ...options,
    mode: toAnimationFlameMode(options?.mode),
  };
  const createAnimation =
    globalThis.FireguardFlameAnimation?.createFlameAnimation ||
    globalThis.createFlameAnimation ||
    (globalThis.FireMascot
      ? (target, nextOptions) => new globalThis.FireMascot(target, nextOptions)
      : null);

  if (createAnimation) {
    return createAnimation(host, animationOptions);
  }

  return null;
}

function setPanelWarningActive(isActive) {
  const panel = document.getElementById(PANEL_ID);

  if (panel) {
    panel.dataset.warningActive = String(isActive);
  }
}

function setPanelFeedbackActive(isActive) {
  const panel = document.getElementById(PANEL_ID);
  const rulesSection = panel?.querySelector("[data-panel-rules-section]");
  const feedbackSection = panel?.querySelector("[data-trade-feedback]");

  if (!panel || !rulesSection || !feedbackSection) {
    return;
  }

  panel.dataset.feedbackActive = String(isActive);
  rulesSection.hidden = isActive;
  feedbackSection.hidden = !isActive;
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
  panel.dataset.warningActive = "false";
  panel.dataset.feedbackActive = "false";
  panel.setAttribute("aria-label", "불씨 가드레일 규칙");
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

      <section
        class="saltbread-panel__section"
        aria-labelledby="saltbread-rules-title"
        data-panel-rules-section
      >
        <div class="saltbread-panel__section-heading">
          <h2 id="saltbread-rules-title">설정된 가드레일</h2>
          <span data-guardrail-rule-count>불러오는 중</span>
        </div>
        <div class="saltbread-rule-list" data-guardrail-rule-list>
          ${renderRuleRows([])}
        </div>
      </section>

      <section
        class="saltbread-panel__section saltbread-panel__feedback"
        aria-labelledby="saltbread-feedback-title"
        data-trade-feedback
        hidden
      >
        <div class="saltbread-panel__section-heading">
          <h2 id="saltbread-feedback-title">거래 피드백</h2>
          <span>선택</span>
        </div>
        <p class="saltbread-panel__feedback-copy">
          방금 거래를 어떻게 기록할까요?
        </p>
        <div class="saltbread-feedback-actions" aria-label="거래 피드백">
          <button
            class="saltbread-feedback-button saltbread-feedback-button--planned"
            type="button"
            data-assessment="PLANNED"
          >
            계획된 거래였어요
          </button>
          <button
            class="saltbread-feedback-button saltbread-feedback-button--emotional"
            type="button"
            data-assessment="EMOTIONAL"
          >
            감정적인 거래였어요
          </button>
          <button
            class="saltbread-feedback-button saltbread-feedback-button--dismiss"
            type="button"
            data-assessment="DISMISSED"
          >
            건너뛰기
          </button>
        </div>
      </section>

      <div class="saltbread-panel__actions" aria-label="거래 판단">
        <button
          class="saltbread-action-button saltbread-action-button--review"
          type="button"
        >
          주문 내용 다시 보기
        </button>
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
    .querySelector(".saltbread-action-button--review")
    .addEventListener("click", () => closeGuardrail("REVIEW"));
  panel
    .querySelector(".saltbread-action-button--history")
    .addEventListener("click", () => {
      closeGuardrail("REVIEW", { dispatchReview: false });
      openDashboard();
    });
  panel
    .querySelector(".saltbread-action-button--proceed")
    .addEventListener("click", () => {
      closeGuardrail("PROCEED");
      setPanelCollapsed(panel, true);
    });
  panel.querySelectorAll("[data-assessment]").forEach((button) => {
    button.addEventListener("click", () => {
      answerTradeFeedback(button.dataset.assessment);
    });
  });

  document.body.append(panel);
  panelFlame = createPanelFlame(
    panel.querySelector(".saltbread-panel__flame"),
    {
      mode: "default",
      label: "현재 감정 매매 상태를 보여주는 불꽃",
    },
  );
  collapsedPanelFlame = createPanelFlame(
    panel.querySelector(".saltbread-panel__collapsed-flame"),
    {
      mode: "default",
      label: "접힌 불씨의 현재 감정 매매 상태 불꽃",
    },
  );
  resetPanelFlameState();
  chrome.runtime.sendMessage({ type: "RESET_FLAME_STATE" }).catch(() => {});
  void loadPageGuardrailRules();
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
  const detail = event.detail || {};
  const expiresAt = Number(detail.expiresAt) || Date.now() + 180_000;
  behaviorState.demoOverride = {
    behaviorData: detail.behaviorData || null,
    currentOrder: detail.currentOrder || null,
    demoData: {
      recentOrders: Array.isArray(detail.recentOrders)
        ? detail.recentOrders
        : [],
      clientAverageBuyAmount:
        detail.clientAverageBuyAmount ??
        detail.behaviorData?.client_avg_buy_amount ??
        null,
      currentPrice: detail.currentPrice ?? null,
      marketData: detail.marketData || null,
      accounts: Array.isArray(detail.accounts) ? detail.accounts : [],
      rawClosedOrders: Array.isArray(detail.rawClosedOrders)
        ? detail.rawClosedOrders
        : [],
      rawOpenOrders: Array.isArray(detail.rawOpenOrders)
        ? detail.rawOpenOrders
        : [],
    },
    expiresAt,
  };

  if (typeof detail.market === "string") {
    behaviorState.market = detail.market;
  }

  renderBehaviorMetrics();
  setAnalysisStatus("데모 시나리오 데이터를 연결했습니다.", "loading");
}

function handleDetectNow(event) {
  if (!behaviorState || !isAppPage()) {
    return;
  }

  if (event) {
    acknowledgePageEvent(event);
  }

  if (isDemoPage()) {
    setAnalysisStatus("데모 주문 데이터를 확인하고 있어요.", "loading");
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
  behaviorState.demoOverride = null;
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
  const price = draft?.order_price ?? null;
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
    payload.snapshotTrigger || "OrderContextSnapshotDTO",
    payload,
    payload.capturedAt,
  );
  return payload;
}

function createLocalGuardrailResult(ruleEvaluation, snapshot) {
  if (!ruleEvaluation?.detected) {
    return null;
  }

  const flameMode = resolveVisualMode(ruleEvaluation.primaryRule);
  const detailedEvaluation = {
    ...ruleEvaluation,
    source: pageGuardrailRulesState.source,
    loadError: pageGuardrailRulesState.error,
    ruleCount: pageGuardrailRules.length,
  };

  return {
    detected: true,
    type: "USER_GUARDRAIL_RULE",
    message:
      ruleEvaluation.warningMessage ||
      "사용자 규칙에 해당하는 주문 조건이 감지되었습니다.",
    warningTitle: ruleEvaluation.warningTitle,
    riskLevel: ruleEvaluation.riskLevel,
    matchedRuleIds: ruleEvaluation.matchedRuleIds,
    primaryRuleId: ruleEvaluation.primaryRuleId,
    primaryRule: ruleEvaluation.primaryRule,
    visualMode: flameMode,
    flameMode,
    orderContextSnapshot: snapshot,
    ruleEvaluation: detailedEvaluation,
  };
}

function evaluatePageGuardrailRulesForSnapshot(snapshot) {
  const ruleEvaluation = evaluateGuardrailRules(pageGuardrailRules, snapshot);
  const evaluatedSnapshot = {
    ...snapshot,
    matchedRuleIdsAtSnapshot: ruleEvaluation.matchedRuleIds,
    primaryShownRuleId: ruleEvaluation.primaryRuleId,
    shownRuleIds: ruleEvaluation.primaryRuleId
      ? [ruleEvaluation.primaryRuleId]
      : [],
  };
  const result = createLocalGuardrailResult(
    ruleEvaluation,
    evaluatedSnapshot,
  );

  return { snapshot: evaluatedSnapshot, result, ruleEvaluation };
}

function showDetectedGuardrailResult(result, snapshot) {
  if (!result?.detected) {
    return false;
  }

  if (isGuardrailSnapshotHandled(snapshot?.snapshotId)) {
    return false;
  }

  dismissActiveTradeFeedback();
  activeDetectionResult = result;
  rememberGuardrailSnapshot(shownGuardrailSnapshotIds, snapshot.snapshotId);
  applyFlameTheme(result.visualMode || result.flameMode);
  showGuardrail(result, snapshot.snapshotId);
  activeGuardrailSnapshotId = snapshot.snapshotId;

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
  return true;
}

function clearActiveGuardrailResult() {
  activeDetectionResult = null;
  activeGuardrailSnapshotId = null;
  setPanelWarningActive(false);
}

function reviewPendingAttemptWithPageRules() {
  if (
    !pendingAttempt?.snapshot ||
    activeDetectionResult?.detected ||
    isGuardrailSnapshotHandled(pendingAttempt.snapshot.snapshotId)
  ) {
    return;
  }

  const { snapshot, result } = evaluatePageGuardrailRulesForSnapshot(
    pendingAttempt.snapshot,
  );
  pendingAttempt.snapshot = snapshot;

  if (result?.detected) {
    showDetectedGuardrailResult(result, snapshot);
  }
}

function beginOrderAttempt(orderButton) {
  if (pendingAttempt && !pendingAttempt.snapshotEmitted) {
    emitOrderContextSnapshot(pendingAttempt.snapshot, activeDetectionResult);
    pendingAttempt.snapshotEmitted = true;
  }
  const rawSnapshot = buildOrderContextSnapshot(
    orderButton,
    "ORDER_INTENT_CLICK",
  );
  const { snapshot, result } =
    evaluatePageGuardrailRulesForSnapshot(rawSnapshot);
  pendingAttempt = {
    attemptId: snapshot.attemptId,
    snapshot,
    snapshotEmitted: true,
    feedbackShownAt: null,
  };
  emitOrderContextSnapshot(snapshot, result);
  if (result?.detected) {
    showDetectedGuardrailResult(result, snapshot);
  } else {
    clearActiveGuardrailResult();
  }
  window.setTimeout(() => {
    if (pendingAttempt?.attemptId === snapshot.attemptId && !pendingAttempt.snapshotEmitted) {
      emitOrderContextSnapshot(snapshot, activeDetectionResult);
      pendingAttempt.snapshotEmitted = true;
    }
  }, 2500);
}

function closeGuardrail(action, options = {}) {
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
  rememberGuardrailSnapshot(closedGuardrailSnapshotIds, snapshotId);
  clearActiveGuardrailResult();
  setAnalysisStatus("데이터 수집 중...", "loading");
  if (action === "REVIEW" && options.dispatchReview !== false) {
    document.dispatchEvent(new CustomEvent("saltbread:demo-review-order"));
  }
}

function showGuardrail(result, snapshotId) {
  setPanelFeedbackActive(false);
  setPanelWarningActive(true);
  activeGuardrailSnapshotId = snapshotId;
}

function emitTradeFeedback(feedbackAttempt, assessment) {
  if (!feedbackAttempt?.attemptId) {
    return;
  }

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
}

function dismissActiveTradeFeedback() {
  if (activeTradeFeedback) {
    emitTradeFeedback(activeTradeFeedback, "DISMISSED");
  }

  activeTradeFeedback = null;
  setPanelFeedbackActive(false);
}

function answerTradeFeedback(assessment) {
  if (!activeTradeFeedback) {
    return;
  }

  emitTradeFeedback(activeTradeFeedback, assessment);
  activeTradeFeedback = null;
  setPanelFeedbackActive(false);
  setAnalysisStatus("주문·체결 데이터를 확인하고 있어요.", "loading");
}

function showTradeFeedback() {
  if (!pendingAttempt?.attemptId) return;

  if (activeDetectionResult?.detected) {
    closeGuardrail("PROCEED");
  }

  const feedbackAttempt = {
    ...pendingAttempt,
    feedbackShownAt: new Date().toISOString(),
  };
  pendingAttempt.feedbackShownAt = feedbackAttempt.feedbackShownAt;
  activeTradeFeedback = feedbackAttempt;
  setPanelFeedbackActive(true);
  setPanelWarningActive(false);
  setAnalysisStatus(
    "이번 거래는 어떤 거래였나요?",
    "feedback",
    null,
    "거래 피드백",
  );

  const panel = document.getElementById(PANEL_ID);
  if (panel) {
    setPanelCollapsed(panel, false);
  }
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
    showTradeFeedback();
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

  try {
    beginOrderAttempt(orderButton);
  } catch (error) {
    console.error("[Saltbread] Failed to capture ORDER_INTENT_CLICK", error);
    setLoggingStatus("주문 의도 스냅샷을 만들지 못했지만 행동 로그 수집은 계속합니다.");
  }

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
  if (!activeDetectionResult?.detected) {
    applyFlameTheme("default");
    setAnalysisStatus("주문·체결 데이터를 확인하고 있어요.", "loading");
  }

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
        demoData: getActiveDemoData(),
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

function getActiveDemoOverride() {
  if (
    !isDemoPage() ||
    !behaviorState?.demoOverride ||
    behaviorState.demoOverride.expiresAt <= Date.now()
  ) {
    return null;
  }

  return behaviorState.demoOverride;
}

function getActiveDemoData() {
  return getActiveDemoOverride()?.demoData || null;
}

function getBehaviorData() {
  const behavior = buildBehaviorSnapshot(behaviorState);
  const override = getActiveDemoOverride()?.behaviorData;

  return override ? { ...behavior, ...override } : behavior;
}

function renderBehaviorMetrics() {
  if (!behaviorState) {
    return;
  }

  getBehaviorData();
}

function setAnalysisStatus(message, state = "loading", type = null, title = null) {
  const status = document.querySelector(".saltbread-analysis-status");
  const badgeElement = status?.querySelector("[data-status-badge]");
  const titleElement = status?.querySelector("[data-status-title]");
  const messageElement = status?.querySelector("[data-status-message]");

  if (state === "loading" && activeDetectionResult?.detected) {
    return;
  }

  if (!status || !badgeElement || !titleElement || !messageElement) {
    return;
  }

  if (state === "loading") {
    applyFlameTheme("default");
  }

  status.dataset.state = state;
  setPanelWarningActive(state === "detected");

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

  if (state === "feedback") {
    badgeElement.textContent = "기록";
    titleElement.textContent = title || "거래 피드백";
    messageElement.textContent =
      message || "이번 거래를 어떻게 기록할지 선택해 주세요.";
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
  const demoOverride = getActiveDemoOverride();

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
      readOrderDraft() ||
      demoOverride?.currentOrder ||
      null,
    orderContextSnapshot: pendingAttempt?.snapshot || null,
    demoData: demoOverride?.demoData || null,
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
    demoOverride: null,
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
  activeTradeFeedback = null;
}

function syncPanel(auth) {
  if (!isDashboardPage() && canShowPanel(auth)) {
    createPanel(auth);
    return;
  }

  removePanel();
}

function refreshPanelState() {
  return chrome.runtime
    .sendMessage({ type: "GET_AUTH_STATE" })
    .then((response) => syncPanel(response?.ok ? response.auth : null))
    .catch(() => syncPanel(null));
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

    if (result?.detected) {
      let snapshot;
      if (result.orderContextSnapshot) {
        if (
          pendingAttempt?.snapshotEmitted &&
          pendingAttempt.snapshot?.snapshotId ===
            result.orderContextSnapshot.snapshotId
        ) {
          snapshot = result.orderContextSnapshot;
        } else {
          snapshot = emitOrderContextSnapshot(
            result.orderContextSnapshot,
            result,
          );
        }
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
      if (snapshot) {
        showDetectedGuardrailResult(result, snapshot);
      }
    } else {
      clearActiveGuardrailResult();
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

  if (changes[GUARDRAIL_RULES_CACHE_KEY]) {
    setPageGuardrailRulesState({
      ...(changes[GUARDRAIL_RULES_CACHE_KEY].newValue || {}),
      source: "cache",
    });
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
