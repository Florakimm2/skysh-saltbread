const PANEL_ID = "saltbread-extension-panel";
const APP_URL = globalThis.SALTBREAD_CONFIG.appUrl;
const APP_ORIGINS = new Set([
  APP_URL,
  ...(globalThis.SALTBREAD_CONFIG.appOrigins || []),
]);
const BEHAVIOR_INPUT_DEBOUNCE_MS = 650;
const GUARDRAIL_RULES_CACHE_KEY = "guardrailRulesCache";
const DASHBOARD_RULE_SETTINGS_PATH = "/dashboard/my-page";
const MARKET_SNAPSHOT_CACHE_KEY = "marketSnapshotCache";
const PERSONAL_SNAPSHOT_CACHE_KEY = "personalSnapshotCache";
const SNAPSHOT_CACHE_MAX_AGE_MS = 2 * 60 * 1000;
const UPBIT_ORDER_DEBUG_KEY = "saltbread:upbit-order-debug";
const SALTBREAD_DEBUG_BRIDGE_SOURCE = "SALTBREAD_UPBIT_DEBUG_BRIDGE";
const SALTBREAD_DEBUG_STATE_EVENT = "SALTBREAD_UPBIT_DEBUG_STATE";
const SALTBREAD_DEMO_PAGE_SOURCE = "SALTBREAD_DEMO_PAGE";
const SALTBREAD_EXTENSION_SOURCE = "SALTBREAD_EXTENSION";
const SALTBREAD_DEMO_STATE_REQUEST = "REQUEST_DEMO_STATE";
const PANEL_INTRO_NOTICE_DURATION_MS = 5000;
const PANEL_INTRO_NOTICE_ANIMATION_MS = 320;
const UPBIT_CONFIRM_MODAL_WAIT_TIMEOUT_MS = 3000;
const UPBIT_CONFIRM_MODAL_POLL_INTERVAL_MS = 50;
const {
  buildBehaviorSnapshot,
  createGuardrailRuleSnapshot,
  detectOrderActionSide,
  evaluateGuardrailRules,
  evaluateRuleExpression,
  flattenExpressionEvaluation,
  formatConditionEvaluation: formatRuleConditionEvaluation,
  formatExpressionEvaluationSummary,
  getOrderTimeParts,
  parseMarket,
  resolveVisualMode,
  RULE_FIELD_CATALOG,
  toNumber,
} =
  globalThis.SaltbreadCore;
const VISUAL_MODE_LABELS = {
  DEFAULT: "기본",
  CURIOUS: "확인",
  SURPRISED: "급변",
  FAST_BURN: "반복",
  SCARED: "위험",
  SAD: "손실",
};
const RULE_FIELD_LABELS = {
  side: "주문 타입",
  orderMode: "주문 방식",
  snapshotTrigger: "감지 시점",
  signedChangeRate: "등락률",
  shortTermReturn5m: "5분 수익률",
  pricePositionIn5mRange: "5분 가격 위치",
  requestedBalanceRatio: "주문 비중",
  orderbookClickToSnapshotMs: "호가 클릭 후 경과 시간",
  intentPrice: "주문 가격",
  intentQuantity: "주문 수량",
  intentAmount: "주문 금액",
  tradePriceAtSnapshot: "현재가",
  baseAssetAvgBuyPriceBeforeSnapshot: "평균 매수가",
  priceVsAvgBuyRateAtSnapshot: "평균 매수가 대비 가격",
  actualOrderCreatedCount10m: "10분 주문 횟수",
  orderIntentCount1m: "1분 주문 시도 횟수",
  sameSideIntentCount1m: "같은 방향 주문 시도 횟수",
  marketChangeCount5m: "5분 종목 변경 횟수",
  sideChangeCount3m: "3분 매수/매도 변경 횟수",
  priceEditCount3m: "3분 가격 수정 횟수",
  quantityEditCount3m: "3분 수량 수정 횟수",
  amountEditCount3m: "3분 금액 수정 횟수",
  inputRevertCount: "입력 되돌림 횟수",
  priceDirectionChangeCount: "가격 방향 변경 횟수",
  priceChangeRate: "입력 가격 변화율",
  orderModeChangeCount3m: "3분 주문 방식 변경 횟수",
  allocationPresetPercent: "주문 비중 버튼",
  draftDurationMs: "주문 작성 시간",
  lastEditToSnapshotMs: "마지막 수정 후 경과 시간",
  draftEditCount: "주문 수정 횟수",
  amountChangeRate: "주문 금액 변화율",
  modeChangedToMarket: "시장가 전환 여부",
  spreadRate: "호가 차이",
  marketRiskFlags: "시장 경보",
  pricePositionIn5mRange: "5분 가격 위치",
  volumeSpikeRatio5m: "거래량 증가 배수",
  draftResetCount3m: "3분 주문 초기화 횟수",
  market: "거래 종목",
  entryPoint: "주문 시작 방식",
  orderTimeMinutes: "주문하는 시간",
  orderTime: "주문하는 시간",
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
let settledAttemptIds = new Set();
let feedbackCompletedAttemptIds = new Set();
let feedbackCompletedVisualLock = false;
let upbitOrderFlow = createIdleUpbitOrderFlow();
let handledUpbitConfirmKeys = new Set();
let pageGuardrailRules = [];
let pageGuardrailRulesState = {
  rules: [],
  source: "unloaded",
  error: null,
  fetchedAt: null,
};
let guardrailRulesLoadPromise = null;
let cachedMarketSnapshotCache = {};
let cachedPersonalSnapshotCache = {};
let latestDemoBridgeState = null;
let privateApiReady = false;
let extensionContextInvalidated = false;
let upbitModalObserver = null;
let upbitConfirmModalWaitTimerId = null;
let upbitConfirmModalWaitContext = null;
let panelIntroNoticeTimerId = null;
let panelIntroNoticeHideTimerId = null;
let lastOrderIntent = null;
let lastOrderContextSnapshot = null;
let lastDtoSnapshot = null;
let lastRuleEvaluation = null;
let lastModalClassification = null;
let lastExtractionResult = null;
const upbitOrderDebugState = {
  flowState: null,
  pendingAttempt: null,
  lastFormSubmit: null,
  lastModalClassification: null,
  lastExtractionResult: null,
  lastOrderIntentDto: null,
  lastAttemptLogDto: null,
  lastOrderContextSnapshot: null,
  lastDtoSnapshot: null,
  lastRuleEvaluation: null,
  lastDetectionResult: null,
  lastWarningUiApplied: null,
  lastTradeFeedbackDto: null,
  lastGuardrailReactionDto: null,
  lastSkipReason: null,
  lastSkipPayload: null,
  lastBackgroundMessagePayload: null,
  events: [],
};

function isRealUpbitExchangePage() {
  if (!isUpbitExchangePage()) {
    return false;
  }

  try {
    return location.protocol === "https:";
  } catch {
    return /^https:\/\//i.test(String(location.href || ""));
  }
}

function isUpbitOrderDebugEnabled() {
  try {
    return localStorage.getItem(UPBIT_ORDER_DEBUG_KEY) !== "false";
  } catch {
    return true;
  }
}

function isSensitiveDebugKey(key) {
  return /(?:access[_-]?token|refresh[_-]?token|authorization|access[_-]?key|secret[_-]?key|api[_-]?key|firebase[_-]?token|bearer)/i.test(
    String(key || ""),
  );
}

function sanitizeDebugPayload(value, seen = new WeakSet()) {
  if (value === null || value === undefined) {
    return value;
  }

  if (typeof value !== "object") {
    return value;
  }

  if (seen.has(value)) {
    return "[Circular]";
  }

  if (value instanceof Element) {
    return {
      tagName: value.tagName || null,
      textPreview: getModalTextPreview(value),
      id: value.id || null,
      className: String(value.className || ""),
      role: value.getAttribute?.("role") || null,
      dataset: { ...(value.dataset || {}) },
    };
  }

  seen.add(value);

  if (Array.isArray(value)) {
    const sanitizedArray = value.map((item) => sanitizeDebugPayload(item, seen));
    seen.delete(value);
    return sanitizedArray;
  }

  const sanitizedObject = Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      isSensitiveDebugKey(key)
        ? "[REDACTED]"
        : sanitizeDebugPayload(item, seen),
    ]),
  );
  seen.delete(value);
  return sanitizedObject;
}

function structuredCloneSafe(value) {
  try {
    return structuredClone(value);
  } catch {
    try {
      return JSON.parse(JSON.stringify(value));
    } catch {
      return value;
    }
  }
}

function publishUpbitDebugStateToPage() {
  if (!isRealUpbitExchangePage()) return;
  if (typeof window.postMessage !== "function") return;

  const state = sanitizeDebugPayload(
    structuredCloneSafe(upbitOrderDebugState),
  );

  window.postMessage(
    {
      source: SALTBREAD_DEBUG_BRIDGE_SOURCE,
      type: SALTBREAD_DEBUG_STATE_EVENT,
      state,
    },
    window.location.origin,
  );
}

function rememberUpbitDebugEvent(eventName, payload = {}) {
  const occurredAt = new Date().toISOString();
  const safePayload = sanitizeDebugPayload(payload);
  const event = {
    eventName,
    occurredAt,
    payload: safePayload,
  };

  upbitOrderDebugState.events.push(event);
  if (upbitOrderDebugState.events.length > 100) {
    upbitOrderDebugState.events.shift();
  }

  upbitOrderDebugState.flowState =
    safePayload.flowState || upbitOrderFlow?.state || null;
  upbitOrderDebugState.pendingAttempt = sanitizeDebugPayload(pendingAttempt);

  if (safePayload.pendingAttempt) {
    upbitOrderDebugState.pendingAttempt = safePayload.pendingAttempt;
  }

  switch (eventName) {
    case "UPBIT_FORM_SUBMIT_CLICKED":
      upbitOrderDebugState.lastFormSubmit = safePayload;
      break;
    case "UPBIT_MODAL_CLASSIFIED":
      upbitOrderDebugState.lastModalClassification = safePayload;
      break;
    case "UPBIT_ORDER_EXTRACTION_RESULT":
      upbitOrderDebugState.lastExtractionResult = safePayload;
      break;
    case "ORDER_INTENT_CLICK":
      upbitOrderDebugState.lastOrderIntentDto =
        safePayload.orderIntentDto || safePayload.dto || safePayload;
      upbitOrderDebugState.lastAttemptLogDto =
        safePayload.attemptLogDto ||
        safePayload.pendingAttempt ||
        sanitizeDebugPayload(pendingAttempt);
      break;
    case "UPBIT_ORDER_CONTEXT_SNAPSHOT_BUILT":
      upbitOrderDebugState.lastOrderContextSnapshot =
        safePayload.orderContextSnapshot || safePayload.snapshot || safePayload;
      break;
    case "UPBIT_DTO_SNAPSHOT_BUILT":
    case "DTO_SNAPSHOT":
      upbitOrderDebugState.lastDtoSnapshot = safePayload;
      break;
    case "UPBIT_RULE_EVALUATION_RESULT":
      upbitOrderDebugState.lastRuleEvaluation =
        safePayload.ruleEvaluation || safePayload.evaluation || safePayload;
      break;
    case "UPBIT_DETECTION_RESULT_RECEIVED":
      upbitOrderDebugState.lastDetectionResult = safePayload;
      break;
    case "UPBIT_WARNING_UI_APPLIED":
      upbitOrderDebugState.lastWarningUiApplied = safePayload;
      break;
    case "UPBIT_ORDER_CAPTURE_SKIPPED":
    case "UPBIT_WARNING_UI_SKIPPED":
      upbitOrderDebugState.lastSkipReason =
        safePayload.reason || safePayload.skipReason || null;
      upbitOrderDebugState.lastSkipPayload = safePayload;
      break;
    case "UPBIT_ORDER_ACTION_DETECTED_SENT":
    case "ORDER_ACTION_DETECTED":
      upbitOrderDebugState.lastBackgroundMessagePayload =
        safePayload.backgroundMessagePayload ||
        safePayload.message ||
        safePayload;
      break;
    case "UPBIT_TRADE_FEEDBACK_SUBMITTED":
      upbitOrderDebugState.lastTradeFeedbackDto =
        safePayload.tradeFeedbackDto || safePayload.feedback || safePayload;
      break;
    case "GuardrailReactionDTO":
      upbitOrderDebugState.lastGuardrailReactionDto =
        safePayload.guardrailReactionDto || safePayload.reaction || safePayload;
      break;
    default:
      break;
  }

  publishUpbitDebugStateToPage();
}

function debugUpbitOrder(eventName, payload = {}) {
  rememberUpbitDebugEvent(eventName, payload);

  if (!isRealUpbitExchangePage()) return;
  if (!isUpbitOrderDebugEnabled()) return;

  const time = new Date().toISOString();
  const safePayload = sanitizeDebugPayload(payload);

  try {
    console.groupCollapsed(`🔥 [불씨][UPBIT_ORDER] ${eventName} @ ${time}`);
    console.log("payload", safePayload);
    console.trace("trace");
    console.groupEnd();
  } catch {
    console.log(`[불씨][UPBIT_ORDER] ${eventName}`, safePayload);
  }
}

function installUpbitDebugHelper() {
  if (!isUpbitExchangePage()) {
    return;
  }

  window.__SALTBREAD_UPBIT_DEBUG__ = {
    getState() {
      upbitOrderDebugState.flowState = upbitOrderFlow?.state || null;
      upbitOrderDebugState.pendingAttempt = sanitizeDebugPayload(pendingAttempt);
      return structuredCloneSafe(upbitOrderDebugState);
    },
    print() {
      console.log(this.getState());
    },
    printLastRuleEvaluation() {
      const state = this.getState();
      console.log("lastRuleEvaluation", state.lastRuleEvaluation);
      if (state.lastRuleEvaluation?.conditionResults) {
        console.table(state.lastRuleEvaluation.conditionResults);
      }
    },
    printLastExtraction() {
      const state = this.getState();
      console.log("lastExtractionResult", state.lastExtractionResult);
    },
    printLastOrderIntent() {
      const state = this.getState();
      console.log("lastOrderIntentDto", state.lastOrderIntentDto);
    },
    enable() {
      localStorage.setItem(UPBIT_ORDER_DEBUG_KEY, "true");
    },
    disable() {
      localStorage.setItem(UPBIT_ORDER_DEBUG_KEY, "false");
    },
    clear() {
      upbitOrderDebugState.events = [];
      upbitOrderDebugState.lastRuleEvaluation = null;
      upbitOrderDebugState.lastExtractionResult = null;
      upbitOrderDebugState.lastOrderIntentDto = null;
      upbitOrderDebugState.lastOrderContextSnapshot = null;
      upbitOrderDebugState.lastWarningUiApplied = null;
      upbitOrderDebugState.lastSkipReason = null;
      upbitOrderDebugState.lastSkipPayload = null;
    },
  };
  publishUpbitDebugStateToPage();
}

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
  let hostname = location.hostname;

  if (!hostname) {
    try {
      hostname = new URL(location.href).hostname;
    } catch {
      hostname = String(location.href || "").match(/^https?:\/\/([^/]+)/i)?.[1] || "";
    }
  }

  return (
    ["upbit.com", "www.upbit.com"].includes(hostname) &&
    location.pathname.startsWith("/exchange")
  );
}

function isPanelAllowedPage() {
  return isDemoPage() || isUpbitExchangePage();
}

function emitExtensionDebug(category, kind, payload, occurredAt = null) {
  if (shouldIgnoreDebugPayload(kind, payload)) {
    return;
  }

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

function firstDefined(...values) {
  return values.find((value) => value !== undefined && value !== null);
}

function ratioFromPercentLike(value) {
  const numeric = toNumber(value);
  return numeric === null ? null : numeric / 100;
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
    PINK: "FAST_BURN",
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

function applyFlameTheme(mode, options = {}) {
  const normalizedMode = normalizeFlameMode(mode);

  if (
    !options.force &&
    normalizedMode !== "DEFAULT" &&
    shouldBlockWarningOrVisualUpdate(options.attemptId || null)
  ) {
    return false;
  }

  const panel = document.getElementById(PANEL_ID);

  if (panel) {
    panel.dataset.flameMode = toDatasetFlameMode(normalizedMode);
  }

  setFlameAnimationMode(panelFlame, normalizedMode);
  setFlameAnimationMode(collapsedPanelFlame, normalizedMode);
  return true;
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

function rememberSettledAttempt(attemptId) {
  if (!attemptId) {
    return;
  }

  if (settledAttemptIds.size >= 100) {
    settledAttemptIds.delete(settledAttemptIds.values().next().value);
  }

  settledAttemptIds.add(attemptId);
}

function rememberFeedbackCompletedAttempt(attemptId) {
  if (!attemptId) {
    return;
  }

  rememberSettledAttempt(attemptId);

  if (feedbackCompletedAttemptIds.size >= 100) {
    feedbackCompletedAttemptIds.delete(
      feedbackCompletedAttemptIds.values().next().value,
    );
  }

  feedbackCompletedAttemptIds.add(attemptId);
  feedbackCompletedVisualLock = true;
}

function unlockFeedbackCompletedVisualStateForNewAttempt() {
  feedbackCompletedVisualLock = false;
}

function getAttemptIdFromPayload(payload) {
  return (
    payload?.orderContextSnapshot?.attemptId ||
    payload?.orderContext?.attemptId ||
    payload?.snapshot?.attemptId ||
    payload?.attemptId ||
    null
  );
}

function shouldIgnoreIncomingAttempt(incomingAttemptId) {
  if (!incomingAttemptId) {
    return false;
  }

  if (settledAttemptIds.has(incomingAttemptId)) {
    return true;
  }

  if (feedbackCompletedAttemptIds.has(incomingAttemptId)) {
    return true;
  }

  return Boolean(
    pendingAttempt?.attemptId &&
      pendingAttempt.attemptId !== incomingAttemptId,
  );
}

function shouldBlockWarningOrVisualUpdate(incomingAttemptId = null) {
  if (shouldIgnoreIncomingAttempt(incomingAttemptId)) {
    return true;
  }

  if (!feedbackCompletedVisualLock) {
    return false;
  }

  if (!incomingAttemptId) {
    return true;
  }

  return feedbackCompletedAttemptIds.has(incomingAttemptId);
}

function shouldIgnoreDebugPayload(kind, payload) {
  const debugKind = payload?.kind || kind;

  if (
    debugKind !== "ORDER_CONTEXT_WITH_SNAPSHOTS" &&
    debugKind !== "DTO_DEBUG_SNAPSHOT"
  ) {
    return false;
  }

  return shouldBlockWarningOrVisualUpdate(getAttemptIdFromPayload(payload));
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

function getRuleFieldLabel(field) {
  return RULE_FIELD_LABELS[field] || field || "조건";
}

function getRuleFieldValue(snapshot, field) {
  return snapshot && Object.prototype.hasOwnProperty.call(snapshot, field)
    ? snapshot[field]
    : null;
}

function getRuleOperandValue(operand, snapshot) {
  if (!operand || typeof operand !== "object") {
    return null;
  }

  if (operand.operandType === "FIELD") {
    return getRuleFieldValue(snapshot, operand.field);
  }

  return operand.value ?? null;
}

function formatRuleValue(value, field = null) {
  if (value === null || value === undefined || value === "") {
    return "없음";
  }

  if (Array.isArray(value)) {
    return value.map((item) => formatRuleValue(item, field)).join(", ");
  }

  if (typeof value === "boolean") {
    return value ? "예" : "아니요";
  }

  const numeric = toNumber(value);
  const fieldType = RULE_FIELD_CATALOG?.[field]?.valueType || null;

  if (numeric !== null && fieldType === "NUMBER") {
    if (field === "orderTimeMinutes") {
      const normalized = Math.max(0, Math.min(1439, Math.trunc(numeric)));
      const hour = Math.floor(normalized / 60);
      const minute = normalized % 60;
      return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
    }

    if (
      /Rate|Ratio|ChangeRate|Return|Position/.test(String(field || "")) &&
      Math.abs(numeric) <= 10
    ) {
      return `${Number((numeric * 100).toFixed(2))}%`;
    }

    if (/Ms$/.test(String(field || ""))) {
      return `${Number((numeric / 1000).toFixed(1))}초`;
    }

    return String(Number(numeric.toFixed(4)));
  }

  return String(value);
}

function emitDetectionPipelineTrace(stage, fields = {}) {
  const attemptId =
    fields.attemptId ||
    fields.orderSnapshot?.attemptId ||
    fields.orderContextSnapshot?.attemptId ||
    pendingAttempt?.attemptId ||
    null;
  const market =
    fields.market ||
    fields.orderSnapshot?.market ||
    fields.orderContextSnapshot?.market ||
    behaviorState?.market ||
    parseMarket(location.href);
  const dataSource = fields.dataSource || (isDemoPage() ? "DEMO" : "UPBIT");
  const capturedAt = fields.capturedAt || new Date().toISOString();

  emitExtensionDebug("behavior", "DETECTION_PIPELINE_TRACE", {
    type: "DETECTION_PIPELINE_TRACE",
    attemptId,
    dataSource,
    market,
    stage,
    capturedAt,
    ...fields,
  }, capturedAt);
  debugUpbitOrder("DETECTION_PIPELINE_TRACE", {
    type: "DETECTION_PIPELINE_TRACE",
    attemptId,
    dataSource,
    market,
    stage,
    capturedAt,
    ...fields,
  });
}

function collectMatchedRuleConditions(expression, snapshot) {
  if (!expression || typeof expression !== "object") {
    return [];
  }

  if (expression.nodeType === "CONDITION") {
    return evaluateRuleExpression(expression, snapshot) ? [expression] : [];
  }

  if (expression.nodeType !== "GROUP") {
    return [];
  }

  const children = Array.isArray(expression.children)
    ? expression.children
    : [];

  return children.flatMap((child) =>
    collectMatchedRuleConditions(child, snapshot),
  );
}

function buildConditionDescription(condition, snapshot, values = {}) {
  const label = getRuleFieldLabel(condition.leftField);
  const leftValue = Object.prototype.hasOwnProperty.call(values, "actualValue")
    ? values.actualValue
    : getRuleFieldValue(snapshot, condition.leftField);
  const rightValue = Object.prototype.hasOwnProperty.call(values, "expectedValue")
    ? values.expectedValue
    : getRuleOperandValue(condition.rightOperand, snapshot);
  const leftText = formatRuleValue(leftValue, condition.leftField);
  const rightField = condition.rightOperand?.field || condition.leftField;
  const rightText = formatRuleValue(rightValue, rightField);
  const rightLabel = condition.rightOperand?.field
    ? getRuleFieldLabel(condition.rightOperand.field)
    : null;

  if (condition.operator === "IS_NULL") {
    return {
      parts: [{ text: `${label}이 비어 있어요.` }],
    };
  }

  if (condition.operator === "IS_NOT_NULL") {
    return {
      parts: [{ text: `${label}이 들어 있어요.` }],
    };
  }

  if (condition.operator === "EQ") {
    return {
      parts: [
        { text: `${label}이 ` },
        { text: leftText, emphasis: true },
        { text: " 에요." },
      ],
    };
  }

  if (condition.operator === "NEQ") {
    return {
      parts: [
        { text: `${label}이 ` },
        { text: rightText, emphasis: true },
        { text: "이 아니에요. 현재 값은 " },
        { text: leftText, emphasis: true },
        { text: " 에요." },
      ],
    };
  }

  if (condition.operator === "GT" || condition.operator === "GTE") {
    if (condition.leftField === "orderTimeMinutes") {
      return {
        parts: [
          { text: `${label}이 ` },
          { text: rightText, emphasis: true },
          { text: condition.operator === "GT" ? " 이후예요." : " 이상이에요." },
        ],
      };
    }

    return {
      parts: [
        { text: `${label}이 ` },
        { text: leftText, emphasis: true },
        { text: `로 ${rightLabel ? `${rightLabel} ` : ""}` },
        { text: rightText, emphasis: true },
        {
          text: condition.operator === "GT"
            ? "보다 커요."
            : "보다 크거나 같아요.",
        },
      ],
    };
  }

  if (condition.operator === "LT" || condition.operator === "LTE") {
    if (condition.leftField === "orderTimeMinutes") {
      return {
        parts: [
          { text: `${label}이 ` },
          { text: rightText, emphasis: true },
          { text: condition.operator === "LT" ? " 이전이에요." : " 이하예요." },
        ],
      };
    }

    return {
      parts: [
        { text: `${label}이 ` },
        { text: leftText, emphasis: true },
        { text: `로 ${rightLabel ? `${rightLabel} ` : ""}` },
        { text: rightText, emphasis: true },
        {
          text: condition.operator === "LT"
            ? "보다 작아요."
            : "보다 작거나 같아요.",
        },
      ],
    };
  }

  if (condition.operator === "IN" || condition.operator === "NOT_IN") {
    return {
      parts: [
        { text: `${label}이 ` },
        { text: leftText, emphasis: true },
        {
          text: condition.operator === "IN"
            ? "로 허용된 값 "
            : "로 제외된 값 ",
        },
        { text: rightText, emphasis: true },
        {
          text: condition.operator === "IN"
            ? " 중 하나예요."
            : "에 포함되지 않아요.",
        },
      ],
    };
  }

  return {
    parts: [
      { text: `${label}이 ` },
      { text: leftText, emphasis: true },
      { text: `이고 기준값은 ` },
      { text: rightText, emphasis: true },
      { text: " 에요." },
    ],
  };
}

function buildMatchedRuleDescriptions(result) {
  const snapshot = result?.orderContextSnapshot;
  const matchedRuleIds = new Set(result?.ruleEvaluation?.matchedRuleIds || []);
  const conditionResults = Array.isArray(result?.ruleEvaluation?.conditionResults)
    ? result.ruleEvaluation.conditionResults
    : [];

  if (conditionResults.length > 0) {
    return conditionResults
      .filter((conditionResult) =>
        conditionResult.matched &&
          (!conditionResult.ruleId || matchedRuleIds.has(conditionResult.ruleId)),
      )
      .map((conditionResult) => ({
        ruleId: conditionResult.ruleId || null,
        ruleTitle: conditionResult.ruleName || "가드레일",
        ...buildConditionDescription(
          {
            leftField: conditionResult.leftField || conditionResult.field,
            operator: conditionResult.operator,
            rightOperand: { operandType: "LITERAL", value: conditionResult.expectedValue },
          },
          snapshot,
          {
            actualValue: conditionResult.actualValue,
            expectedValue: conditionResult.expectedValue,
          },
        ),
      }));
  }

  const matchedRules = Array.isArray(result?.ruleEvaluation?.matchedRules)
    ? result.ruleEvaluation.matchedRules
    : result?.primaryRule
      ? [result.primaryRule]
      : [];

  return matchedRules.flatMap((rule) => {
    const conditions = collectMatchedRuleConditions(rule.expression, snapshot);
    const ruleTitle = rule.warningTitle || rule.name || "가드레일";

    return conditions.map((condition) => ({
      ruleId: rule.ruleId || null,
      ruleTitle,
      ...buildConditionDescription(condition, snapshot),
    }));
  });
}

function getPrimaryExpressionEvaluation(result) {
  const ruleEvaluation = result?.ruleEvaluation || result?.evaluation || null;
  const primaryRuleId =
    result?.primaryRuleId ||
    ruleEvaluation?.primaryRuleId ||
    result?.primaryRule?.ruleId ||
    ruleEvaluation?.primaryRule?.ruleId ||
    null;
  const expressionResults = Array.isArray(ruleEvaluation?.expressionResults)
    ? ruleEvaluation.expressionResults
    : [];
  const byPrimaryId = expressionResults.find(
    (item) => item?.ruleId && item.ruleId === primaryRuleId,
  );
  const matchedExpression = expressionResults.find((item) => item?.matched);

  return byPrimaryId || matchedExpression || null;
}

function createConditionEvaluationRow(conditionResult) {
  const formatted = formatRuleConditionEvaluation
    ? formatRuleConditionEvaluation(conditionResult)
    : null;
  const row = document.createElement("div");
  row.className = "saltbread-condition-row";
  row.dataset.matched = String(Boolean(conditionResult?.matched));

  const icon = document.createElement("span");
  icon.className = "saltbread-condition-row__icon";
  icon.textContent = conditionResult?.matched ? "✓" : "–";
  icon.setAttribute(
    "aria-label",
    conditionResult?.matched ? "충족" : "미충족",
  );

  const body = document.createElement("span");
  body.className = "saltbread-condition-row__body";

  const title = document.createElement("strong");
  title.className = "saltbread-condition-row__title";
  title.textContent =
    formatted?.description ||
    `${getRuleFieldLabel(conditionResult?.leftField || conditionResult?.field)} 조건`;

  const meta = document.createElement("span");
  meta.className = "saltbread-condition-row__meta";
  meta.textContent = [
    formatted?.criteriaText ? `기준 ${formatted.criteriaText}` : null,
    formatted?.actualText ? `당시 ${formatted.actualText}` : null,
  ].filter(Boolean).join(" · ");

  const actualSentence = document.createElement("span");
  actualSentence.className = "saltbread-condition-row__sentence";
  actualSentence.textContent =
    formatted?.actualSentence ||
    "이 기록에는 당시 판정값이 저장되지 않았어요.";

  body.append(title, meta, actualSentence);
  row.append(icon, body);
  return row;
}

function renderExpressionEvaluationNode(node, depth = 0) {
  if (!node || typeof node !== "object") {
    return document.createDocumentFragment();
  }

  if (node.nodeType === "CONDITION") {
    return createConditionEvaluationRow(node.condition || node);
  }

  const group = document.createElement("div");
  group.className = "saltbread-condition-group";
  group.dataset.operator = node.operator || "AND";
  group.style.setProperty("--condition-depth", String(Math.min(depth, 3)));

  const label = document.createElement("span");
  label.className = "saltbread-condition-group__label";
  label.textContent =
    node.operator === "OR"
      ? "다음 조건 중 하나 이상을 만족할 때"
      : "다음 조건을 모두 만족할 때";
  group.append(label);

  (Array.isArray(node.children) ? node.children : []).forEach((child) => {
    group.append(renderExpressionEvaluationNode(child, depth + 1));
  });

  return group;
}

function renderWarningReason(messageElement, result) {
  const expressionEvaluation = getPrimaryExpressionEvaluation(result);
  const expressionTree = expressionEvaluation?.expression || null;
  const flattened = flattenExpressionEvaluation
    ? flattenExpressionEvaluation(expressionTree)
    : [];
  const primaryRule =
    result?.primaryRule ||
    result?.ruleEvaluation?.primaryRule ||
    expressionEvaluation ||
    null;
  const matchedConditions = flattened.filter((condition) => condition?.matched);

  if (!expressionTree && flattened.length === 0) {
    return false;
  }

  const section = document.createElement("section");
  section.className = "saltbread-warning-reason";
  section.setAttribute("aria-label", "경고 기준");

  const heading = document.createElement("strong");
  heading.className = "saltbread-warning-reason__heading";
  heading.textContent = "왜 이 경고가 표시됐나요?";

  const ruleName = document.createElement("span");
  ruleName.className = "saltbread-warning-reason__rule";
  ruleName.textContent = primaryRule?.ruleName || primaryRule?.name
    ? `이번에 감지된 규칙 · ${primaryRule.ruleName || primaryRule.name}`
    : "이번에 감지된 규칙";

  const summary = document.createElement("p");
  summary.className = "saltbread-warning-reason__summary";
  summary.textContent = formatExpressionEvaluationSummary
    ? formatExpressionEvaluationSummary(expressionTree)
    : `설정한 조건 ${flattened.length || matchedConditions.length}개가 충족됐어요.`;

  section.append(heading, ruleName, summary);

  if (flattened.length > 3) {
    const preview = document.createElement("div");
    preview.className = "saltbread-condition-list saltbread-condition-list--preview";
    flattened.slice(0, 3).forEach((condition) => {
      preview.append(createConditionEvaluationRow(condition));
    });
    section.append(preview);

    const details = document.createElement("details");
    details.className = "saltbread-condition-details";
    const detailsSummary = document.createElement("summary");
    detailsSummary.textContent = `경고 기준 자세히 보기 ${flattened.length}개`;
    details.append(detailsSummary, renderExpressionEvaluationNode(expressionTree));
    section.append(details);
  } else {
    const list = document.createElement("div");
    list.className = "saltbread-condition-list";
    list.append(renderExpressionEvaluationNode(expressionTree));
    section.append(list);
  }

  messageElement.append(section);
  return true;
}

function renderDetectedStatusMessage(messageElement, message, result = null) {
  messageElement.replaceChildren();
  messageElement.append(document.createTextNode(message));

  const renderedReason = renderWarningReason(messageElement, result);
  if (!renderedReason) {
    const descriptions = buildMatchedRuleDescriptions(result);
    if (descriptions.length > 0) {
      messageElement.append(document.createElement("br"));
      messageElement.append(document.createElement("br"));

      const list = document.createElement("span");
      list.className = "saltbread-rule-match-list";

      descriptions.forEach((description) => {
        const line = document.createElement("span");
        line.className = "saltbread-rule-match-line";

        description.parts.forEach((part) => {
          const node = document.createElement(part.emphasis ? "strong" : "span");
          node.textContent = part.text;
          line.append(node);
        });

        list.append(line);
      });

      messageElement.append(list);
    }
  }

  const disclaimer = document.createElement("span");
  disclaimer.className = "saltbread-warning-disclaimer";
  disclaimer.textContent =
    "이 경고는 투자 추천이 아니라, 내가 설정한 규칙에 대한 알림입니다.";
  messageElement.append(disclaimer);
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

function getRuleDisplayTitle(rule) {
  return (
    rule?.name ||
    rule?.title ||
    rule?.ruleTitle ||
    rule?.label ||
    "이름 없는 규칙"
  );
}

function renderRuleRows(rules = []) {
  const userRules = Array.isArray(rules) ? rules : [];
  const activePrimaryRuleId =
    activeDetectionResult?.primaryRuleId ||
    activeDetectionResult?.ruleEvaluation?.primaryRuleId ||
    activeDetectionResult?.primaryRule?.ruleId ||
    null;
  const activeMatchedRuleIds = new Set(
    activeDetectionResult?.matchedRuleIds ||
      activeDetectionResult?.ruleEvaluation?.matchedRuleIds ||
      [],
  );

  if (userRules.length === 0) {
    return `
      <article class="saltbread-rule-row saltbread-rule-row--empty">
        <span class="saltbread-rule-row__title">설정된 규칙 없음</span>
        <strong class="saltbread-rule-row__mode">대기</strong>
      </article>
    `;
  }

  return userRules.map((rule) => {
    const visualMode = normalizeFlameMode(rule.visualMode);
    const title = getRuleDisplayTitle(rule);
    const modeLabel = VISUAL_MODE_LABELS[visualMode] || visualMode;
    const requiresPrivateApi = Boolean(rule.requiresPrivateApi);
    const isPrivateApiReady = !requiresPrivateApi || privateApiReady;
    const description = rule.description || rule.warningMessage || title;
    const isDetectedRule =
      Boolean(rule.ruleId) &&
      (rule.ruleId === activePrimaryRuleId || activeMatchedRuleIds.has(rule.ruleId));
    const apiNotice =
      requiresPrivateApi && !privateApiReady
        ? "개인 API 연결 시 감시 가능"
        : requiresPrivateApi
          ? "개인 API 기반 규칙"
          : "";
    const titleText = [description, apiNotice].filter(Boolean).join(" · ");

    return `
      <article
        class="saltbread-rule-row"
        data-rule-id="${escapeHtml(rule.ruleId || "")}"
        data-rule-mode="${toDatasetFlameMode(visualMode)}"
        data-enabled="${String(rule.isEnabled !== false)}"
        data-private-api-required="${String(requiresPrivateApi)}"
        data-private-api-ready="${String(isPrivateApiReady)}"
        data-detected-rule="${String(isDetectedRule)}"
        title="${escapeHtml(titleText)}"
      >
        <span class="saltbread-rule-row__flame-icon" aria-hidden="true">🔥</span>
        <span class="saltbread-rule-row__title">${escapeHtml(title)}</span>
        ${isDetectedRule ? `<span class="saltbread-rule-row__detected-badge">이번 경고</span>` : ""}
        <strong class="saltbread-rule-row__mode">${escapeHtml(modeLabel)}</strong>
        ${requiresPrivateApi ? `<span class="saltbread-rule-row__api-badge">API</span>` : ""}
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

function refreshPrivateApiReadyState() {
  return safeRuntimeSendMessage({ type: "GET_UPBIT_CREDENTIAL_STATUS" })
    .then((response) => {
      const status = response?.status || {};
      privateApiReady = Boolean(status.configured && status.unlocked);
      renderGuardrailRulesFromCache(pageGuardrailRulesState);
      return privateApiReady;
    })
    .catch(() => {
      privateApiReady = false;
      renderGuardrailRulesFromCache(pageGuardrailRulesState);
      return false;
    });
}

function isExtensionContextInvalidatedError(error) {
  return /Extension context invalidated/i.test(String(error?.message || error));
}

function markExtensionContextInvalidated() {
  extensionContextInvalidated = true;
  if (behaviorTimerId) {
    window.clearInterval(behaviorTimerId);
    behaviorTimerId = null;
  }
}

function safeRuntimeSendMessage(message) {
  try {
    if (extensionContextInvalidated) {
      return Promise.resolve({
        ok: false,
        error: "확장 프로그램이 새로고침되었습니다. 페이지를 새로고침해 주세요.",
      });
    }

    if (!chrome?.runtime?.sendMessage) {
      return Promise.resolve({ ok: false, error: "확장 프로그램 연결이 끊겼습니다." });
    }

    return Promise.resolve(chrome.runtime.sendMessage(message)).catch((error) => {
      if (isExtensionContextInvalidatedError(error)) {
        markExtensionContextInvalidated();
        return {
          ok: false,
          error: "확장 프로그램이 새로고침되었습니다. 페이지를 새로고침해 주세요.",
        };
      }

      console.warn("[Saltbread] chrome.runtime.sendMessage failed", error);
      return {
        ok: false,
        error: error?.message || "확장 프로그램과 연결할 수 없습니다.",
      };
    });
  } catch (error) {
    if (isExtensionContextInvalidatedError(error)) {
      markExtensionContextInvalidated();
    } else {
      console.warn("[Saltbread] chrome.runtime.sendMessage failed", error);
    }

    return Promise.resolve({
      ok: false,
      error: "확장 프로그램이 새로고침되었습니다. 페이지를 새로고침해 주세요.",
    });
  }
}

function safeStorageLocalGet(keys) {
  try {
    if (extensionContextInvalidated) {
      return Promise.resolve({});
    }

    if (!chrome?.storage?.local?.get) {
      return Promise.resolve({});
    }

    return Promise.resolve(chrome.storage.local.get(keys)).catch((error) => {
      if (isExtensionContextInvalidatedError(error)) {
        markExtensionContextInvalidated();
      } else {
        console.warn("[Saltbread] chrome.storage.local.get failed", error);
      }

      return {};
    });
  } catch (error) {
    if (isExtensionContextInvalidatedError(error)) {
      markExtensionContextInvalidated();
    } else {
      console.warn("[Saltbread] chrome.storage.local.get failed", error);
    }

    return Promise.resolve({});
  }
}

function loadPageGuardrailRules() {
  if (guardrailRulesLoadPromise) {
    return guardrailRulesLoadPromise;
  }

  guardrailRulesLoadPromise = safeRuntimeSendMessage({
      type: "LOAD_GUARDRAIL_RULES",
    })
    .then((response) => {
      if (!response?.ok) {
        throw new Error(response?.error || "규칙을 불러오지 못했습니다.");
      }

      return setPageGuardrailRulesState(response.guardrailRules || {});
    })
    .catch((error) =>
      safeStorageLocalGet(GUARDRAIL_RULES_CACHE_KEY)
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

function clearPanelIntroNoticeTimers() {
  if (panelIntroNoticeTimerId) {
    window.clearTimeout(panelIntroNoticeTimerId);
    panelIntroNoticeTimerId = null;
  }

  if (panelIntroNoticeHideTimerId) {
    window.clearTimeout(panelIntroNoticeHideTimerId);
    panelIntroNoticeHideTimerId = null;
  }
}

function schedulePanelIntroNotice(panel) {
  const notice = panel?.querySelector("[data-panel-intro-notice]");
  if (!notice) {
    return;
  }

  clearPanelIntroNoticeTimers();
  notice.hidden = false;
  notice.classList?.remove?.("is-hiding");
  panelIntroNoticeTimerId = window.setTimeout(() => {
    notice.classList?.add?.("is-hiding");
    panelIntroNoticeTimerId = null;
    panelIntroNoticeHideTimerId = window.setTimeout(() => {
      notice.hidden = true;
      notice.classList?.remove?.("is-hiding");
      panelIntroNoticeHideTimerId = null;
    }, PANEL_INTRO_NOTICE_ANIMATION_MS);
  }, PANEL_INTRO_NOTICE_DURATION_MS);
}

function removePanel() {
  clearPanelIntroNoticeTimers();
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
          <span class="saltbread-panel__subtitle">${escapeHtml(auth?.user?.email || "행동 데이터")}</span>
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

      <section class="saltbread-panel-intro-notice" data-panel-intro-notice aria-live="polite">
        <span class="saltbread-panel-intro-notice__icon" aria-hidden="true">▦</span>
        <div>
          <strong>가드레일이 활성화되어 있어요</strong>
          <p>
            불씨는 수익률을 보장하는 서비스가 아니라, 내가 정한 원칙을 주문 순간에 확인하도록 돕는 투자 보조 도구예요. 주문 전 가드레일 안내를 확인해 주세요.
          </p>
        </div>
      </section>

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
            원칙을 지킨 거래였어요
          </button>
          <button
            class="saltbread-feedback-button saltbread-feedback-button--emotional"
            type="button"
            data-assessment="EMOTIONAL"
          >
            후회했던 거래였어요
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

      <section
        class="saltbread-panel__section saltbread-panel__daily-insight"
        aria-labelledby="saltbread-daily-insight-title"
        data-daily-insight
        hidden
      >
        <div class="saltbread-panel__section-heading">
          <h2 id="saltbread-daily-insight-title">오늘의 AI 인사이트</h2>
          <span data-daily-insight-status>대기</span>
        </div>
        <p class="saltbread-panel__daily-insight-copy" data-daily-insight-copy></p>
        <button
          class="saltbread-daily-insight-button"
          type="button"
          data-daily-insight-generate
          hidden
        >
          AI 인사이트 생성
        </button>
      </section>

      <div class="saltbread-panel__actions" aria-label="거래 판단">
        <button
          class="saltbread-action-button saltbread-action-button--review"
          type="button"
        >
          주문 내용 다시 보기
        </button>
        <button
          class="saltbread-action-button saltbread-action-button--rule-check"
          type="button"
        >
          규칙 점검하기
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
    .querySelector(".saltbread-action-button--rule-check")
    .addEventListener("click", openRuleSettings);
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
  panel
    .querySelector("[data-daily-insight-generate]")
    ?.addEventListener("click", openDailyInsightDashboardFromPanel);

  document.body.append(panel);
  panelFlame = createPanelFlame(
    panel.querySelector(".saltbread-panel__flame"),
    {
      mode: "default",
      label: "현재 가드레일 상태를 보여주는 불꽃",
    },
  );
  collapsedPanelFlame = createPanelFlame(
    panel.querySelector(".saltbread-panel__collapsed-flame"),
    {
      mode: "default",
      label: "접힌 불씨의 현재 가드레일 상태 불꽃",
    },
  );
  resetPanelFlameState();
  safeRuntimeSendMessage({ type: "RESET_FLAME_STATE" }).catch(() => {});
  schedulePanelIntroNotice(panel);
  void loadPageGuardrailRules();
  void refreshDailyInsightStatus();
  void refreshPrivateApiReadyState();
  startBehaviorTracking();
}

function openDashboardPage(path = "/dashboard") {
  safeRuntimeSendMessage({ type: "OPEN_DASHBOARD", payload: { path } });
}

function renderDailyInsightStatus(status) {
  const section = document.querySelector("[data-daily-insight]");
  const statusLabel = section?.querySelector("[data-daily-insight-status]");
  const copy = section?.querySelector("[data-daily-insight-copy]");
  const button = section?.querySelector("[data-daily-insight-generate]");

  if (!section || !statusLabel || !copy || !button || !status) {
    return;
  }

  let title = "";
  let message = "";
  let buttonText = "";
  let dashboardPath = "/dashboard/ai-insights?focus=today";

  if (status.reportStatus === "GENERATING") {
    title = "오늘의 AI 인사이트를 만들고 있어요";
    message = "대시보드에서 생성 상태를 확인할 수 있어요.";
    buttonText = "생성 상태 보기";
  } else if (status.reportStatus === "FAILED") {
    title = "오늘의 AI 인사이트를 만들 수 있어요!";
    message = "대시보드에서 리포트 생성 상태를 다시 확인해 보세요.";
    buttonText = "대시보드에서 생성하기";
  } else if (status.hasNewData || status.reportStatus === "STALE") {
    title = "리포트 이후 새로운 기록이 쌓였어요";
    message = "대시보드에서 기존 리포트와 최신 생성 옵션을 확인할 수 있어요.";
    buttonText = "AI 인사이트 보기";
  } else if (status.eligible && status.reportStatus === "NOT_CREATED") {
    title = "오늘의 AI 인사이트를 만들 수 있어요!";
    message = "오늘 쌓인 주문 기록과 가드레일을 일간 리포트로 확인해 보세요.";
    buttonText = "대시보드에서 생성하기";
  } else if (status.reportStatus === "COMPLETED" || status.reportStatus === "PARTIAL") {
    title = "오늘의 AI 인사이트가 준비됐어요!";
    message = "주문 흐름과 가드레일의 가격 효과를 리포트에서 확인해 보세요.";
    buttonText = "오늘 리포트 보기";
    dashboardPath = `/dashboard/ai-insights?report=${encodeURIComponent(status.date || "")}`;
  } else {
    if (
      Number.isFinite(status.requiredFeedbackCount) &&
      Number.isFinite(status.answeredFeedbackCount) &&
      status.requiredFeedbackCount - status.answeredFeedbackCount <= 2 &&
      status.requiredFeedbackCount > status.answeredFeedbackCount
    ) {
      title = "AI 인사이트 준비 중";
      message = `피드백이 ${status.requiredFeedbackCount - status.answeredFeedbackCount}개 더 쌓이면 오늘의 AI 인사이트를 만들 수 있어요.`;
      section.hidden = false;
      statusLabel.textContent = title;
      copy.textContent = message;
      button.hidden = true;
      return;
    }
    section.hidden = true;
    return;
  }

  section.hidden = false;
  statusLabel.textContent = title;
  copy.textContent = message;
  button.hidden = !buttonText;
  button.textContent = buttonText || "AI 인사이트 보기";
  button.dataset.reportDate = status.date || "";
  button.dataset.dashboardPath = dashboardPath;
}

function refreshDailyInsightStatus() {
  safeRuntimeSendMessage({ type: "GET_DAILY_INSIGHT_STATUS" })
    .then((response) => {
      if (response?.ok) {
        renderDailyInsightStatus(response.data);
      }
    })
    .catch(() => {});
}

function openDailyInsightDashboardFromPanel() {
  const button = document.querySelector("[data-daily-insight-generate]");
  openDashboardPage(button?.dataset?.dashboardPath || "/dashboard/ai-insights?focus=today");
}

function openRuleSettings() {
  closeGuardrail("REVIEW", { dispatchReview: false });
  openDashboardPage(DASHBOARD_RULE_SETTINGS_PATH);
}

function setPanelCollapsed(panel, isCollapsed) {
  if (!panel) {
    return;
  }

  panel.dataset.collapsed = String(isCollapsed);
  panel.classList.toggle("is-collapsed", isCollapsed);
  const body = panel.querySelector(".saltbread-panel__body");
  const reopen = panel.querySelector(".saltbread-panel__reopen");
  const collapsedControls = panel.querySelector(
    ".saltbread-panel__collapsed-controls",
  );

  if (body) {
    body.inert = isCollapsed;
    body.setAttribute("aria-hidden", String(isCollapsed));
  }
  reopen?.setAttribute("aria-hidden", String(!isCollapsed));
  collapsedControls?.setAttribute("aria-hidden", String(!isCollapsed));
}

function isSaltbreadPanelCollapsed(panel) {
  if (!panel) {
    return null;
  }

  if (panel.dataset?.collapsed !== undefined) {
    return panel.dataset.collapsed === "true";
  }

  return Boolean(panel.classList?.contains?.("is-collapsed"));
}

function openSaltbreadPanel(options = {}) {
  const panel = document.getElementById(PANEL_ID);

  if (!panel) {
    return false;
  }

  setPanelCollapsed(panel, false);
  debugUpbitOrder("UPBIT_PANEL_OPENED_FOR_WARNING", {
    source: options.source || null,
    reason: options.reason || "detected_guardrail",
    panelOpen: true,
    panelCollapsed: false,
    flowState: upbitOrderFlow.state,
  });
  return true;
}

function getWarningStatusElement() {
  return document.querySelector(".saltbread-analysis-status");
}

function scrollWarningIntoView() {
  getWarningStatusElement()?.scrollIntoView?.({
    block: "nearest",
    inline: "nearest",
  });
}

function focusGuardrailWarning() {
  const status = getWarningStatusElement();

  if (!status) {
    return;
  }

  status.setAttribute?.("tabindex", "-1");
  status.focus?.({ preventScroll: true });
}

function getActivePanelView(panel = document.getElementById(PANEL_ID)) {
  const status = getWarningStatusElement();

  if (panel?.dataset?.feedbackActive === "true") {
    return "FEEDBACK";
  }

  if (
    panel?.dataset?.warningActive === "true" ||
    status?.dataset?.state === "detected"
  ) {
    return "WARNING";
  }

  return status?.dataset?.state ? String(status.dataset.state).toUpperCase() : null;
}

function getWarningUiDebugState(attemptId = null) {
  const panel = document.getElementById(PANEL_ID);
  const status = getWarningStatusElement();
  const renderedTitle =
    status?.querySelector("[data-status-title]")?.textContent || null;
  const renderedMessage =
    status?.querySelector("[data-status-message]")?.textContent || null;
  const panelCollapsed = isSaltbreadPanelCollapsed(panel);
  const activeView = getActivePanelView(panel);
  const warningCardExists = Boolean(
    status &&
      status.dataset?.state === "detected" &&
      activeView === "WARNING" &&
      renderedTitle,
  );

  return {
    panelExists: Boolean(panel),
    panelOpen: Boolean(panel && panelCollapsed === false),
    panelCollapsed,
    warningCardExists,
    renderedTitle,
    renderedMessage,
    renderedVisualMode: panel?.dataset?.flameMode || null,
    activeView,
    activeWarningAttemptId:
      getAttemptIdFromPayload(activeDetectionResult) ||
      pendingAttempt?.attemptId ||
      null,
    feedbackShownAt: pendingAttempt?.feedbackShownAt || null,
    confirmClickedAt: pendingAttempt?.confirmClickedAt || null,
    feedbackRespondedAt: pendingAttempt?.feedbackRespondedAt || null,
    settledAttemptIdsIncludes: attemptId
      ? settledAttemptIds.has(attemptId)
      : false,
    feedbackCompletedAttemptIdsIncludes: attemptId
      ? feedbackCompletedAttemptIds.has(attemptId)
      : false,
  };
}

function normalizedText(element) {
  if (!element) {
    return "";
  }

  return [
    element.textContent,
    element.getAttribute?.("aria-label"),
    element.getAttribute?.("title"),
    element.getAttribute?.("value"),
  ]
    .filter(Boolean)
    .join(" ")
    .replace(/\s/g, "");
}

function normalizeButtonText(element) {
  return (element?.innerText || element?.textContent || "")
    .replace(/\s+/g, " ")
    .trim();
}

function isOrderConfirmButton(button) {
  const text = normalizeButtonText(button);
  return text === "매수 확인" || text === "매도 확인";
}

function getConfirmButtonSide(button) {
  const text = normalizeButtonText(button);
  if (text === "매수 확인") return "BUY";
  if (text === "매도 확인") return "SELL";
  return null;
}

function isGenericOkButton(button) {
  return normalizeButtonText(button) === "확인";
}

function isInitialOrderFormButton(button) {
  const text = normalizeButtonText(button);
  return text === "매수" || text === "매도";
}

function createIdleUpbitOrderFlow() {
  return {
    state: "IDLE",
    attemptId: null,
    formRoot: null,
    modalRoot: null,
    market: null,
    side: null,
    orderMode: null,
    intentPrice: null,
    intentQuantity: null,
    intentAmount: null,
    modalOpenedAtRounded: null,
    confirmKey: null,
    intentCaptured: false,
  };
}

function resetUpbitOrderFlow() {
  upbitOrderFlow = createIdleUpbitOrderFlow();
}

function rememberUpbitConfirmKey(confirmKey) {
  if (!confirmKey) {
    return;
  }

  if (handledUpbitConfirmKeys.size >= 100) {
    handledUpbitConfirmKeys.delete(handledUpbitConfirmKeys.values().next().value);
  }

  handledUpbitConfirmKeys.add(confirmKey);
}

function getModalTextPreview(modalRoot) {
  const text = (modalRoot?.innerText || modalRoot?.textContent || "")
    .replace(/\s+/g, " ")
    .trim();
  return text.slice(0, 240);
}

function getModalButtonTexts(modalRoot) {
  return getButtonsInRoot(modalRoot)
    .map((button) => normalizeButtonText(button))
    .filter(Boolean);
}

function emitUpbitFlowDebug(eventType, fields = {}) {
  const occurredAt = fields.occurredAt || new Date().toISOString();
  const modalRoot = fields.modalRoot || upbitOrderFlow.modalRoot || null;
  const payload = {
    eventType,
    attemptId: fields.attemptId ?? upbitOrderFlow.attemptId ?? null,
    market:
      fields.market ?? upbitOrderFlow.market ?? behaviorState?.market ??
      parseMarket(location.href),
    side: fields.side ?? upbitOrderFlow.side ?? null,
    orderMode: fields.orderMode ?? upbitOrderFlow.orderMode ?? null,
    intentPrice: fields.intentPrice ?? upbitOrderFlow.intentPrice ?? null,
    intentQuantity:
      fields.intentQuantity ?? upbitOrderFlow.intentQuantity ?? null,
    intentAmount: fields.intentAmount ?? upbitOrderFlow.intentAmount ?? null,
    valid: fields.valid ?? null,
    buttonText: fields.buttonText ?? null,
    clickedElementText: fields.clickedElementText ?? fields.buttonText ?? null,
    modalTextPreview:
      fields.modalTextPreview ?? getModalTextPreview(modalRoot),
    modalButtonTexts: fields.modalButtonTexts ?? getModalButtonTexts(modalRoot),
    previousFlowState: fields.previousFlowState ?? null,
    nextFlowState:
      fields.nextFlowState ?? fields.flowState ?? upbitOrderFlow.state,
    reason: fields.reason ?? null,
    flowState: fields.flowState ?? upbitOrderFlow.state,
    occurredAt,
    ...fields,
  };
  delete payload.modalRoot;

  emitExtensionDebug("behavior", eventType, payload, occurredAt);
  debugUpbitOrder(eventType, payload);
}

function emitUpbitOrderCaptureSkipped(reason, fields = {}) {
  emitUpbitFlowDebug("UPBIT_ORDER_CAPTURE_SKIPPED", {
    ...fields,
    reason,
    valid: false,
  });
}

function findOrderPanel(element) {
  let candidate = element;
  let fallback = null;

  while (candidate && candidate !== document.body) {
    const text = normalizedText(candidate);
    const inputCount = candidate.querySelectorAll?.("input").length || 0;
    const keywordCount = [
      text.includes("주문"),
      text.includes("가격"),
      text.includes("수량"),
      text.includes("총액") || text.includes("금액"),
      text.includes("주문가능") || text.includes("보유") || text.includes("가능"),
      text.includes("시장가") || text.includes("지정가"),
      text.includes("주문총액"),
      text.includes("주문수량"),
      text.includes("매수가격") || text.includes("매도가격"),
    ].filter(Boolean).length;
    const hasOrderSideText = /매수|매도/.test(text);

    if (
      inputCount > 0 &&
      (keywordCount >= 2 || (keywordCount >= 1 && hasOrderSideText))
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

const ORDER_ACTION_BUTTON_SELECTOR =
  "button, [role='button'], a, [class*='button'], [class*='Button'], [class*='btn'], [class*='Btn']";
const UPBIT_ORDER_DIALOG_SELECTOR =
  "#QuoteOrderConfirmPopup, #modal, #checkVerifMethodModal, [role='dialog'], [aria-modal='true'], [data-testid='popupWrapper']";

function detectOrderSideFromConfirmText(text) {
  const normalized = String(text || "").replace(/\s/g, "");

  if (/매도(?:주문|확인|주문안내|주문을|주문하기)/.test(normalized)) {
    return "SELL";
  }

  if (/매수(?:주문|확인|주문안내|주문을|주문하기)/.test(normalized)) {
    return "BUY";
  }

  const hasBuy = normalized.includes("매수");
  const hasSell = normalized.includes("매도");

  if (hasBuy && !hasSell) {
    return "BUY";
  }

  if (hasSell && !hasBuy) {
    return "SELL";
  }

  return null;
}

function findUpbitOrderDialog(element) {
  if (!(element instanceof Element)) {
    return null;
  }

  const dialog = element.closest(UPBIT_ORDER_DIALOG_SELECTOR);

  if (!dialog) {
    return null;
  }

  const dialogText = normalizedText(dialog);

  if (isUpbitOrderNoticeDialogText(dialogText)) {
    return null;
  }

  return detectOrderSideFromConfirmText(dialogText)
    ? dialog
    : null;
}

function findUpbitModalRoot(element) {
  if (!(element instanceof Element)) {
    return null;
  }

  return element.closest(UPBIT_ORDER_DIALOG_SELECTOR);
}

function isVisibleUpbitModalRoot(modalRoot) {
  if (!modalRoot) {
    return false;
  }

  if (modalRoot.hidden || modalRoot.getAttribute?.("hidden") !== null) {
    return false;
  }

  if (modalRoot.getAttribute?.("aria-hidden") === "true") {
    return false;
  }

  const text = normalizedText(modalRoot);
  return Boolean(text);
}

function findActiveUpbitOrderModal() {
  const candidates = [
    ...(document.querySelectorAll?.(UPBIT_ORDER_DIALOG_SELECTOR) || []),
  ];

  return (
    candidates.find((candidate) => {
      if (!(candidate instanceof Element)) {
        return false;
      }

      if (!isVisibleUpbitModalRoot(candidate)) {
        return false;
      }

      const classification = classifyUpbitModal(candidate);
      return classification.classification !== "UNKNOWN";
    }) || null
  );
}

function isUpbitOrderNoticeDialogText(text) {
  const normalized = String(text || "").replace(/\s/g, "");
  return /부족|실패|오류|거절|취소되었습니다|제한/.test(normalized);
}

function getButtonsInRoot(root) {
  return root
    ? [...root.querySelectorAll(ORDER_ACTION_BUTTON_SELECTOR)]
    : [];
}

function modalHasOnlyGenericOkButton(modalRoot, clickedButton = null) {
  const buttons = [
    ...getButtonsInRoot(modalRoot),
    ...(clickedButton ? [clickedButton] : []),
  ];
  return (
    buttons.some(isGenericOkButton) &&
    !buttons.some(isOrderConfirmButton)
  );
}

function readNumberAfterLabels(root, labelAlternatives) {
  if (!root) {
    return null;
  }

  const text = (root.innerText || root.textContent || "")
    .replace(/\s+/g, " ")
    .trim();

  for (const label of labelAlternatives) {
    const escapedLabel = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const match = text.match(
      new RegExp(`${escapedLabel}[^\\d.-]*(-?[\\d,]+(?:\\.\\d+)?)`),
    );
    const value = match ? toNumber(match[1]) : null;

    if (value !== null) {
      return value;
    }
  }

  return null;
}

function findPriceValue(root) {
  return (
    findInputValueByTestIds(root, ["order-price-input"]) ??
    findInputValue(root, /매수가격|매도가격|주문가격|가격/) ??
    readNumberAfterLabels(root, ["매수가격", "매도가격", "주문가격", "가격"])
  );
}

function findQuantityValue(root) {
  return (
    findInputValueByTestIds(root, ["volume-input"]) ??
    findInputValue(root, /주문수량|매수수량|매도수량|수량/) ??
    readNumberAfterLabels(root, ["주문수량", "매수수량", "매도수량", "수량"])
  );
}

function findAmountValue(root) {
  return (
    findInputValueByTestIds(root, ["total-input"]) ??
    findInputValue(
      root,
      /주문총액|매수금액|매도금액|총주문금액|주문금액|총액|금액/,
    ) ??
    readNumberAfterLabels(root, [
      "주문총액",
      "매수금액",
      "매도금액",
      "총주문금액",
      "주문금액",
      "총액",
      "금액",
    ])
  );
}

function firstNumberFromRoots(roots, reader) {
  for (const root of roots) {
    const value = reader(root);

    if (value !== null && value !== undefined) {
      return value;
    }
  }

  return null;
}

function getTextPreview(root) {
  return (root?.innerText || root?.textContent || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 500);
}

function getElementDataset(element) {
  return element?.dataset ? { ...element.dataset } : {};
}

function getNearbyLabelText(input, panel) {
  const labels = [
    input.getAttribute?.("aria-label"),
    input.getAttribute?.("placeholder"),
    input.getAttribute?.("title"),
    ...[...(input.labels || [])].map((label) => label.textContent),
  ].filter(Boolean);
  let candidate = input.parentElement;

  for (let depth = 0; candidate && candidate !== panel && depth < 4; depth += 1) {
    labels.push(candidate.textContent || "");
    candidate = candidate.parentElement;
  }

  return labels.join(" ").replace(/\s+/g, " ").trim().slice(0, 240);
}

function describeInputCandidate(input, panel, labelPattern, chosenValue) {
  const value = readInputNumber(input);
  const nearbyLabelText = getNearbyLabelText(input, panel);
  const labelMatched =
    labelPattern.test(
      [
        input.getAttribute?.("aria-label"),
        input.getAttribute?.("placeholder"),
        input.getAttribute?.("title"),
        nearbyLabelText,
      ]
        .filter(Boolean)
        .join(" ")
        .replace(/\s/g, ""),
    );
  const chosen =
    labelMatched &&
    value !== null &&
    chosenValue !== null &&
    chosenValue !== undefined &&
    value === chosenValue;

  return {
    value: input.value ?? null,
    placeholder: input.getAttribute?.("placeholder") || null,
    ariaLabel: input.getAttribute?.("aria-label") || null,
    name: input.getAttribute?.("name") || input.name || null,
    id: input.id || input.getAttribute?.("id") || null,
    className: String(input.className || ""),
    nearbyLabelText,
    chosen,
    reason: chosen
      ? "label_and_value_match"
      : labelMatched
        ? value === null
          ? "label_matched_but_empty_or_invalid"
          : "label_matched_not_selected"
        : "label_not_matched",
  };
}

function collectInputCandidates(roots, labelPattern, chosenValue) {
  return roots.flatMap((root) => {
    if (!root?.querySelectorAll) {
      return [];
    }

    return [...root.querySelectorAll("input")].map((input) =>
      describeInputCandidate(input, root, labelPattern, chosenValue),
    );
  });
}

function describeOrderModeCandidates(formRoot, modalRoot) {
  const controls = [
    ...new Set([
      ...[
        ...(formRoot?.querySelectorAll?.("button, [role='tab'], [role='radio']") || []),
        ...(modalRoot?.querySelectorAll?.("button, [role='tab'], [role='radio']") || []),
      ],
    ]),
  ];

  return controls
    .map((control) => {
      const text = normalizeButtonText(control) || normalizedText(control);
      const ariaSelected = control.getAttribute?.("aria-selected") || null;
      const ariaChecked = control.getAttribute?.("aria-checked") || null;
      const className = String(control.className || "");
      const role = control.getAttribute?.("role") || null;
      const selectedBy =
        ariaSelected === "true"
          ? "aria-selected"
          : ariaChecked === "true"
            ? "aria-checked"
            : control.dataset?.state === "active"
              ? "data-state"
              : /(^|\s)(active|selected|on)(\s|$)/i.test(className)
                ? "class"
                : null;
      const isSelected = Boolean(selectedBy);

      return {
        text,
        ariaSelected,
        ariaChecked,
        className,
        role,
        dataset: getElementDataset(control),
        isSelected,
        reason: isSelected ? `selected_by_${selectedBy}` : "not_selected",
      };
    })
    .filter((candidate) => /시장가|지정가|최유리/.test(candidate.text));
}

function buildUpbitOrderExtraction({ button, formRoot, modalRoot }) {
  const side = getConfirmButtonSide(button);
  const roots = [modalRoot, formRoot].filter(Boolean);
  const modalText = normalizedText(modalRoot);
  const formText = normalizedText(formRoot);
  const orderMode =
    firstDefined(
      detectOrderTypeFromText(modalText),
      detectOrderType(formRoot, button),
      detectOrderTypeFromText(formText),
    ) || "UNKNOWN";
  const rawPrice = firstNumberFromRoots(roots, findPriceValue);
  const rawQuantity = firstNumberFromRoots(roots, findQuantityValue);
  const rawAmount = firstNumberFromRoots(roots, findAmountValue);
  const computedAmount =
    rawAmount ?? (rawPrice !== null && rawQuantity !== null
      ? rawPrice * rawQuantity
      : null);
  const final =
    side === "BUY" && orderMode === "MARKET"
      ? {
          side,
          orderMode,
          intentPrice: null,
          intentQuantity: rawQuantity ?? null,
          intentAmount: rawAmount ?? computedAmount,
        }
      : side === "SELL" && orderMode === "MARKET"
        ? {
            side,
            orderMode,
            intentPrice: null,
            intentQuantity: rawQuantity ?? null,
            intentAmount: rawAmount ?? null,
          }
        : {
            side,
            orderMode,
            intentPrice: rawPrice ?? null,
            intentQuantity: rawQuantity ?? null,
            intentAmount: computedAmount,
          };
  const selectedTabCandidates = describeOrderModeCandidates(formRoot, modalRoot);
  const extraction = {
    formRootTextPreview: getTextPreview(formRoot),
    modalRootTextPreview: getTextPreview(modalRoot),
    selectedTabCandidates,
    orderModeTextCandidates: ["지정가", "시장가", "최유리"].filter((text) =>
      `${modalText}${formText}`.includes(text),
    ),
    amountInputCandidates: collectInputCandidates(
      roots,
      /주문총액|매수금액|매도금액|총주문금액|주문금액|총액|금액/,
      rawAmount,
    ),
    priceInputCandidates: collectInputCandidates(
      roots,
      /매수가격|매도가격|주문가격|가격/,
      rawPrice,
    ),
    quantityInputCandidates: collectInputCandidates(
      roots,
      /주문수량|매수수량|매도수량|수량/,
      rawQuantity,
    ),
    final,
  };

  lastExtractionResult = extraction;
  debugUpbitOrder("UPBIT_ORDER_MODE_CANDIDATES", extraction);
  debugUpbitOrder("UPBIT_SELECTED_ORDER_MODE_DETECTED", {
    ...extraction,
    selectedOrderMode: orderMode,
  });
  debugUpbitOrder("UPBIT_MARKET_BUY_AMOUNT_CANDIDATES", extraction);
  debugUpbitOrder("UPBIT_ORDER_INPUT_CANDIDATES", extraction);
  debugUpbitOrder("UPBIT_ORDER_EXTRACTION_RESULT", extraction);

  return {
    market: behaviorState?.market || parseMarket(location.href),
    ...final,
    valid: true,
    extraction,
  };
}

function collectUpbitOrderIntent({ button, formRoot, modalRoot }) {
  const { extraction, ...intent } = buildUpbitOrderExtraction({
    button,
    formRoot,
    modalRoot,
  });
  return intent;
}

function buildUpbitConfirmKey(intent, modalOpenedAtRounded) {
  return [
    intent.market,
    intent.side,
    intent.orderMode,
    intent.intentPrice ?? "",
    intent.intentQuantity ?? "",
    intent.intentAmount ?? "",
    modalOpenedAtRounded,
  ].join("|");
}

function findOrderConfirmButtonInModal(modalRoot) {
  return getButtonsInRoot(modalRoot).find(isOrderConfirmButton) || null;
}

function classifyUpbitModal(modalRoot, clickedButton = null) {
  const modalText = normalizedText(modalRoot);
  const buttonTexts = getModalButtonTexts(modalRoot);
  const clickedText = clickedButton ? normalizeButtonText(clickedButton) : null;
  const hasConfirmButton =
    buttonTexts.some((text) => text === "매수 확인" || text === "매도 확인") ||
    (clickedButton && isOrderConfirmButton(clickedButton));
  const hasGenericOk =
    buttonTexts.includes("확인") ||
    (clickedButton && isGenericOkButton(clickedButton));
  const isNotice = isUpbitOrderNoticeDialogText(modalText);
  const side = detectOrderSideFromConfirmText(modalText);
  const orderMode = detectOrderTypeFromText(modalText);
  const classification = isNotice || (hasGenericOk && !hasConfirmButton && !upbitOrderFlow.intentCaptured)
    ? "VALIDATION"
    : /완료|접수|주문되었습니다|체결|주문이완료/.test(modalText) ||
        (hasGenericOk && !hasConfirmButton && upbitOrderFlow.intentCaptured)
      ? "COMPLETION"
      : hasConfirmButton || side
        ? "CONFIRM"
        : "UNKNOWN";
  const result = {
    classification,
    side,
    orderMode,
    buttonText: clickedText,
    modalTextPreview: getModalTextPreview(modalRoot),
    modalButtonTexts: buttonTexts,
    reason: isNotice
      ? "notice_text"
      : hasConfirmButton
        ? "confirm_button"
        : hasGenericOk
          ? "generic_ok_button"
          : side
            ? "side_text"
            : "unknown_modal",
  };

  lastModalClassification = result;
  return result;
}

function handleUpbitValidationModalOpen(options = {}) {
  const modalRoot = options.modalRoot || null;
  const classification =
    options.classification ||
    (modalRoot ? classifyUpbitModal(modalRoot) : null) ||
    {};
  const previousFlowState = upbitOrderFlow.state;
  const attemptId =
    options.attemptId ||
    upbitOrderFlow.attemptId ||
    pendingAttempt?.attemptId ||
    createUuid();
  const market =
    upbitOrderFlow.market ||
    pendingAttempt?.snapshot?.market ||
    behaviorState?.market ||
    parseMarket(location.href);
  const side =
    classification.side ||
    upbitOrderFlow.side ||
    pendingAttempt?.snapshot?.side ||
    null;
  const orderMode =
    classification.orderMode ||
    upbitOrderFlow.orderMode ||
    pendingAttempt?.snapshot?.orderMode ||
    null;

  upbitOrderFlow = {
    ...upbitOrderFlow,
    state: "VALIDATION_MODAL_OPEN",
    attemptId,
    modalRoot,
    market,
    side,
    orderMode,
  };

  emitUpbitFlowDebug("UPBIT_VALIDATION_MODAL_OPEN", {
    attemptId,
    market,
    side,
    orderMode,
    modalRoot,
    previousFlowState,
    nextFlowState: "VALIDATION_MODAL_OPEN",
    reason: "validation_or_insufficient_balance",
    source: options.source || null,
    modalTextPreview: classification.modalTextPreview,
    modalButtonTexts: classification.modalButtonTexts,
  });
  debugUpbitOrder("UPBIT_FEEDBACK_SKIPPED_VALIDATION_MODAL", {
    attemptId,
    market,
    side,
    orderMode,
    reason: "validation_modal",
    flowState: "VALIDATION_MODAL_OPEN",
    source: options.source || null,
    modalTextPreview: classification.modalTextPreview,
    modalButtonTexts: classification.modalButtonTexts,
  });
}

function handleUpbitCompletionModalOpen(options = {}) {
  const modalRoot = options.modalRoot || null;
  const classification =
    options.classification ||
    (modalRoot ? classifyUpbitModal(modalRoot) : null) ||
    {};

  emitUpbitFlowDebug("UPBIT_ORDER_COMPLETION_MODAL_OPEN", {
    attemptId:
      options.attemptId ||
      upbitOrderFlow.attemptId ||
      pendingAttempt?.attemptId ||
      null,
    market:
      upbitOrderFlow.market ||
      pendingAttempt?.snapshot?.market ||
      behaviorState?.market ||
      parseMarket(location.href),
    side:
      classification.side ||
      upbitOrderFlow.side ||
      pendingAttempt?.snapshot?.side ||
      null,
    orderMode:
      classification.orderMode ||
      upbitOrderFlow.orderMode ||
      pendingAttempt?.snapshot?.orderMode ||
      null,
    modalRoot,
    previousFlowState: upbitOrderFlow.state,
    nextFlowState: "ORDER_COMPLETION_MODAL_OPEN",
    source: options.source || null,
    modalTextPreview: classification.modalTextPreview,
    modalButtonTexts: classification.modalButtonTexts,
  });
}

function createOrderDraftFromSnapshot(snapshot) {
  if (!snapshot) {
    return null;
  }

  return {
    market: snapshot.market,
    order_side: snapshot.side,
    order_status: "WAIT",
    order_type: snapshot.orderMode,
    order_price: toNumber(snapshot.intentPrice),
    order_volume: toNumber(snapshot.intentQuantity),
    order_amount: toNumber(snapshot.intentAmount),
    realized_loss_pct_1h: null,
    order_request_time: snapshot.capturedAt || new Date().toISOString(),
    order_time: snapshot.orderTime || null,
    order_time_minutes: snapshot.orderTimeMinutes ?? null,
    order_cancel_time: null,
  };
}

function detectOrderTypeFromText(text) {
  const normalized = String(text || "").replace(/\s/g, "");

  if (normalized.includes("최유리")) {
    return "BEST";
  }

  if (normalized.includes("시장가")) {
    return "MARKET";
  }

  if (normalized.includes("지정가")) {
    return "LIMIT";
  }

  return null;
}

function findUpbitOrderConfirmButton(target) {
  if (!(target instanceof Element)) {
    return null;
  }

  const button = target.closest(ORDER_ACTION_BUTTON_SELECTOR);

  if (!button || button.closest(`#${PANEL_ID}`)) {
    return null;
  }

  const dialog = findUpbitOrderDialog(button);
  const side = getConfirmButtonSide(button);

  if (!dialog || !side || !isOrderConfirmButton(button)) {
    return null;
  }

  button.dataset.saltbreadOrderAction = side;
  button.dataset.saltbreadOrderConfirm = "upbit";
  return button;
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

  const button = target.closest(ORDER_ACTION_BUTTON_SELECTOR);

  if (
    !button ||
    button.closest(`#${PANEL_ID}`) ||
    button.getAttribute("role") === "tab" ||
    button.closest("[role='tablist']")
  ) {
    return null;
  }

  const upbitConfirmButton = findUpbitOrderConfirmButton(button);

  if (upbitConfirmButton) {
    return upbitConfirmButton;
  }

  const buttonText = normalizedText(button);
  const explicitSide = button.dataset.saltbreadOrderAction;
  const orderSide =
    ["BUY", "SELL"].includes(explicitSide) ? explicitSide : detectOrderActionSide(
      buttonText,
    );
  const isConfirmAction = /^(매수확인|매도확인)$/.test(buttonText);
  const panel = findOrderPanel(button);

  return orderSide && (panel || isConfirmAction)
    ? button
    : null;
}

function emitIgnoredOrderButtonDebug(target) {
  if (!(target instanceof Element)) {
    return;
  }

  const button = target.closest(ORDER_ACTION_BUTTON_SELECTOR);

  if (!button || button.closest(`#${PANEL_ID}`)) {
    return;
  }

  const buttonText = normalizedText(button);
  const orderSide = detectOrderActionSide(buttonText);

  if (!orderSide) {
    return;
  }

  emitExtensionDebug("behavior", "ORDER_BUTTON_CANDIDATE_IGNORED", {
    kind: "ORDER_BUTTON_CANDIDATE_IGNORED",
    market: behaviorState?.market || parseMarket(location.href),
    buttonText,
    orderSide,
    role: button.getAttribute?.("role") || null,
    hasPanel: Boolean(findOrderPanel(button)),
    pageUrl: location.href,
    occurredAt: new Date().toISOString(),
  });
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

function isUpbitOrderbookClickTarget(target) {
  if (!isUpbitExchangePage() || !(target instanceof Element)) {
    return false;
  }

  const row = target.closest("[data-showbunchtooltip='true']");
  if (!row) {
    return false;
  }

  const text = normalizedText(row);
  return /[0-9,]+(?:\.\d+)?/.test(text);
}

function findInputValueByTestIds(panel, testIds = []) {
  if (!panel?.querySelector) {
    return null;
  }

  for (const testId of testIds) {
    const input = panel.querySelector(`input[data-testid="${testId}"]`);
    const value = readInputNumber(input);

    if (value !== null) {
      return value;
    }
  }

  return null;
}

function inputMatchesLabel(input, panel, labelPattern) {
  const directLabels = [
    input.getAttribute("data-testid"),
    input.getAttribute("aria-label"),
    input.getAttribute("placeholder"),
    input.getAttribute("title"),
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
    input.getAttribute("data-testid"),
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

    if (/total-input|주문총액|매수금액|매도금액|총주문금액|주문금액|총액|금액/.test(normalized)) {
      return { eventType: "AMOUNT_INPUT", field: "amount" };
    }

    if (/order-price-input|매수가격|매도가격|주문가격|가격/.test(normalized)) {
      return { eventType: "PRICE_INPUT", field: "price" };
    }

    if (/volume-input|주문수량|매수수량|매도수량|수량/.test(normalized)) {
      return { eventType: "QUANTITY_INPUT", field: "quantity" };
    }
  }

  return null;
}

function detectOrderType(panel, contextElement = null) {
  const modalOrderType = detectOrderTypeFromText(
    normalizedText(findUpbitModalRoot(contextElement)),
  );

  if (modalOrderType) {
    return modalOrderType;
  }

  if (!panel) {
    return detectOrderTypeFromText(
      normalizedText(findUpbitOrderDialog(contextElement) || contextElement),
    );
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

    return isSelected && /시장가|지정가|최유리/.test(normalizedText(control));
  });

  const selectedOrderType = detectOrderTypeFromText(normalizedText(selectedControl));
  if (selectedOrderType) {
    return selectedOrderType;
  }

  return detectOrderTypeFromText(
    normalizedText(findUpbitOrderDialog(contextElement)),
  );
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

  const price = findInputValue(panel, /매수가격|매도가격|주문가격|가격/);
  const quantity = findInputValue(
    panel,
    /주문수량|매수수량|매도수량|수량/,
  );
  const explicitAmount = findInputValue(
    panel,
    /주문총액|매수금액|매도금액|총주문금액|주문금액|총액|금액/,
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

  safeRuntimeSendMessage({
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

function sendBackendLogMessage(type, payload) {
  if (!payload) {
    return;
  }

  safeRuntimeSendMessage({ type, payload })
    .then((response) => {
      if (!response?.ok) {
        setLoggingStatus(response?.error || "로그를 저장하지 못했습니다.");
      }
    })
    .catch(() =>
      setLoggingStatus("로그 서버와 연결할 수 없습니다."),
    );
}

function sendSnapshotRefreshMessage(reason, market = null) {
  if (isDemoPage()) {
    return;
  }

  safeRuntimeSendMessage({
      type: "REFRESH_SNAPSHOTS_NOW",
      payload: {
        reason,
        market: market || behaviorState?.market || parseMarket(location.href),
        pageUrl: location.href,
      },
    })
    .catch(() => {});
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
    /시장가|지정가|최유리/.test(
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
  const price = findInputValue(panel, /매수가격|매도가격|주문가격|가격/);
  const volume = findInputValue(panel, /주문수량|매수수량|매도수량|수량/);
  const explicitAmount = findInputValue(
    panel,
    /주문총액|매수금액|매도금액|총주문금액|주문금액|총액|금액/,
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
  emitDetectionPipelineTrace("BEHAVIOR_UPDATED", {
    dataSource: isDemoPage() ? "DEMO" : "UPBIT",
    market: behaviorState.market,
    behaviorSnapshot: {
      draftEditCount: behaviorState.draftEditCount,
      inputEditTimestampsByField: Object.fromEntries(
        Object.entries(behaviorState.inputEditTimestampsByField || {})
          .map(([field, timestamps]) => [field, timestamps.length]),
      ),
    },
  });
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

function countRecentRawOrders10m(rawOrders, now = Date.now()) {
  return (Array.isArray(rawOrders) ? rawOrders : []).filter((order) => {
    const createdAt = Date.parse(
      order?.created_at || order?.createdAt || order?.order_request_time || "",
    );
    return Number.isFinite(createdAt) && now - createdAt <= 10 * 60_000;
  }).length;
}

function normalizeMarketRiskFlags(marketData = {}) {
  if (Array.isArray(marketData.marketRiskFlags)) {
    return marketData.marketRiskFlags;
  }

  if (Array.isArray(marketData.market_risk_flags)) {
    return marketData.market_risk_flags;
  }

  return marketData.has_warning_badge ? ["WARNING"] : [];
}

function createDemoMarketSnapshot(detail) {
  const sourceSnapshot = detail.marketSnapshot || detail.marketData || {};
  const marketData = {
    ...sourceSnapshot,
    ...(detail.marketData || {}),
  };
  const market =
    detail.market ||
    sourceSnapshot.market ||
    detail.currentOrder?.market ||
    behaviorState?.market;
  const tradePrice = firstDefined(
    detail.currentPrice,
    sourceSnapshot.current_price,
    sourceSnapshot.currentPrice,
    sourceSnapshot.tradePriceAtSnapshot,
    sourceSnapshot.tradePrice,
    sourceSnapshot.ticker?.trade_price,
    sourceSnapshot.ticker?.tradePrice,
    marketData.tradePrice,
    marketData.tradePriceAtSnapshot,
    marketData.currentPrice,
    marketData.current_price,
    marketData.ticker?.trade_price,
  );
  const signedChangeRate = firstDefined(
    marketData.signedChangeRate,
    marketData.signed_change_rate,
    marketData.ticker?.signed_change_rate,
    marketData.ticker?.signedChangeRate,
    marketData.price_change_rate_15m_decimal,
    ratioFromPercentLike(marketData.priceChangeRate15m),
    ratioFromPercentLike(marketData.price_change_rate_15m),
    ratioFromPercentLike(marketData.priceChangeRate15mPercent),
  );
  const shortTermReturn5m = firstDefined(
    marketData.shortTermReturn5m,
    marketData.short_term_return_5m,
    marketData.shortTermReturn,
    marketData.price_change_rate_5m_decimal,
    ratioFromPercentLike(marketData.priceChangeRate5m),
    ratioFromPercentLike(marketData.price_change_rate_5m),
    ratioFromPercentLike(marketData.priceChangeRate5mPercent),
    ratioFromPercentLike(marketData.price_change_rate_15m),
  );
  const volumeSpikeRatio5m = firstDefined(
    marketData.volumeSpikeRatio5m,
    marketData.volume_spike_ratio_5m,
    ratioFromPercentLike(marketData.volume_change_rate_1m),
  );
  const fetchedAt = new Date().toISOString();

  return {
    market: market || "UNKNOWN",
    tradePrice: decimalString(tradePrice),
    current_price: toNumber(tradePrice),
    currentPrice: toNumber(tradePrice),
    tradePriceAtSnapshot: decimalString(tradePrice),
    signedChangeRate: signedChangeRate ?? null,
    shortTermReturn5m: shortTermReturn5m ?? null,
    spreadRate: firstDefined(marketData.spreadRate, marketData.spread_rate) ?? null,
    marketRiskFlags: normalizeMarketRiskFlags(marketData),
    pricePositionIn5mRange:
      firstDefined(
        marketData.pricePositionIn5mRange,
        marketData.price_position_in_5m_range,
      ) ?? null,
    volumeSpikeRatio5m: volumeSpikeRatio5m ?? null,
    market_data: sourceSnapshot,
    fetchedAt,
    freshnessMs: 0,
    source: "demo-data",
  };
}

function filterDemoOrdersByMarket(orders, market) {
  if (!Array.isArray(orders)) {
    return [];
  }

  if (!market) {
    return orders;
  }

  return orders.filter((order) => order?.market === market);
}

function attachDemoOrderMarket(orders, market) {
  if (!Array.isArray(orders)) {
    return [];
  }

  return orders.map((order) =>
    order && market && !order.market ? { ...order, market } : order,
  );
}

function createDemoPersonalSnapshot(detail) {
  const accountSnapshot = detail.accountSnapshot || detail.personalSnapshot || {};
  const market =
    detail.market ||
    accountSnapshot.market ||
    detail.currentOrder?.market ||
    behaviorState?.market;
  const balances = Array.isArray(detail.accounts)
    ? detail.accounts
    : Array.isArray(accountSnapshot.accounts)
      ? accountSnapshot.accounts
      : Array.isArray(accountSnapshot.balances)
        ? accountSnapshot.balances
        : [];
  const allOrders = attachDemoOrderMarket([
    ...(Array.isArray(detail.orders) ? detail.orders : []),
    ...(Array.isArray(accountSnapshot.orders) ? accountSnapshot.orders : []),
  ], market);
  const openOrders = filterDemoOrdersByMarket(
    attachDemoOrderMarket(
      Array.isArray(detail.rawOpenOrders)
        ? detail.rawOpenOrders
        : Array.isArray(accountSnapshot.rawOpenOrders)
          ? accountSnapshot.rawOpenOrders
          : allOrders.filter((order) =>
              ["wait", "watch"].includes(String(order?.state || "").toLowerCase()),
            ),
      market,
    ),
    market,
  );
  const recentTrades = filterDemoOrdersByMarket(
    attachDemoOrderMarket(
      Array.isArray(detail.rawClosedOrders)
        ? detail.rawClosedOrders
        : Array.isArray(accountSnapshot.rawClosedOrders)
          ? accountSnapshot.rawClosedOrders
          : allOrders.filter((order) =>
              !["wait", "watch"].includes(String(order?.state || "").toLowerCase()),
            ),
      market,
    ),
    market,
  );
  const baseCurrency = String(market || "").split("-")[1];
  const baseAccount = balances.find((account) => account?.currency === baseCurrency);
  const baseAssetAvgBuyPrice = firstDefined(
    baseAccount?.avg_buy_price,
    baseAccount?.avgBuyPrice,
    detail.baseAssetAvgBuyPrice,
    detail.base_asset_avg_buy_price,
    detail.clientAverageBuyPrice,
    detail.client_average_buy_price,
  );
  const fetchedAt = new Date().toISOString();

  return {
    market: market || "UNKNOWN",
    balances,
    openOrders,
    accounts: balances,
    recentOrders: filterDemoOrdersByMarket(
      attachDemoOrderMarket(
        Array.isArray(detail.recentOrders)
          ? detail.recentOrders
          : Array.isArray(accountSnapshot.recentOrders)
            ? accountSnapshot.recentOrders
            : allOrders,
        market,
      ),
      market,
    ),
    recentTrades,
    rawOpenOrders: openOrders,
    rawClosedOrders: recentTrades,
    baseAssetAvgBuyPrice:
      baseAssetAvgBuyPrice === undefined || baseAssetAvgBuyPrice === null
        ? null
        : String(baseAssetAvgBuyPrice),
    actualOrderCreatedCount10m: countRecentRawOrders10m(
      [...openOrders, ...recentTrades],
    ),
    fetchedAt,
    freshnessMs: 0,
    personalDataSource: "demo-data",
    demoPersonalAvailable: true,
    privateDataAvailable: false,
    source: "demo-data",
  };
}

function getDemoOverrideMarket(override = getActiveDemoOverride()) {
  return (
    override?.demoMarketSnapshot?.market ||
    override?.currentOrder?.market ||
    override?.demoData?.market ||
    override?.demoData?.marketData?.market ||
    null
  );
}

function getAuthoritativeMarket() {
  const demoMarket = isDemoPage() ? getDemoOverrideMarket() : null;
  return demoMarket || behaviorState?.market || parseMarket(location.href);
}

function withAuthoritativeOrderMarket(order, market = getAuthoritativeMarket()) {
  if (!order || !market) {
    return order || null;
  }

  return { ...order, market };
}

function normalizeDemoBridgeDetail(input = {}) {
  const state = input.state || input.payload || input.detail || input;
  const marketSnapshot =
    state.marketSnapshot ||
    (["DEMO_MARKET_SNAPSHOT", "MARKET_SNAPSHOT"].includes(input.type)
      ? input.payload
      : null);
  const accountSnapshot =
    state.accountSnapshot ||
    state.personalSnapshot ||
    (["DEMO_PERSONAL_SNAPSHOT", "ACCOUNT_SNAPSHOT"].includes(input.type)
      ? input.payload
      : null);
  const orderCreated =
    input.type === "DEMO_ORDER_CREATED" || input.type === "ORDER_CREATED"
      ? input.payload
      : null;
  const orders = [
    ...(Array.isArray(state.orders) ? state.orders : []),
    ...(orderCreated ? [orderCreated] : []),
  ];
  const market =
    state.market ||
    marketSnapshot?.market ||
    accountSnapshot?.market ||
    state.currentOrder?.market ||
    orderCreated?.market ||
    behaviorState?.market;

  return {
    ...state,
    market,
    marketSnapshot,
    accountSnapshot,
    orders: attachDemoOrderMarket(orders, market),
    currentOrder: state.currentOrder || orderCreated
      ? withAuthoritativeOrderMarket(state.currentOrder || orderCreated, market)
      : null,
    behaviorData: state.behaviorData || null,
    updatedAt: state.updatedAt || new Date().toISOString(),
  };
}

function getDemoBridgeDebugPayload(type, override = null, source = null) {
  const marketSnapshot = override?.demoMarketSnapshot || null;
  const personalSnapshot = override?.demoPersonalSnapshot || null;
  const orders = override?.demoData?.recentOrders || [];

  return {
    type,
    source,
    market:
      marketSnapshot?.market ||
      personalSnapshot?.market ||
      override?.demoData?.market ||
      latestDemoBridgeState?.market ||
      null,
    hasPayload: true,
    hasMarketSnapshot: Boolean(marketSnapshot),
    hasPersonalSnapshot: Boolean(personalSnapshot),
    accountCount: personalSnapshot?.accounts?.length || 0,
    orderCount: orders.length,
    fields: {
      tradePriceAtSnapshot: marketSnapshot?.tradePriceAtSnapshot ?? null,
      signedChangeRate: marketSnapshot?.signedChangeRate ?? null,
      shortTermReturn5m: marketSnapshot?.shortTermReturn5m ?? null,
      spreadRate: marketSnapshot?.spreadRate ?? null,
      pricePositionIn5mRange:
        marketSnapshot?.pricePositionIn5mRange ?? null,
      volumeSpikeRatio5m: marketSnapshot?.volumeSpikeRatio5m ?? null,
    },
  };
}

function emitDemoBridgeDebug(kind, payload) {
  emitExtensionDebug("behavior", kind, {
    kind,
    ...payload,
  });
}

function buildDemoOverrideFromState(state = {}) {
  const detail = normalizeDemoBridgeDetail(state);
  const demoMarketSnapshot = createDemoMarketSnapshot(detail);
  const demoPersonalSnapshot = createDemoPersonalSnapshot(detail);
  const demoMarket = demoMarketSnapshot.market || detail.market || "UNKNOWN";
  const currentOrder = withAuthoritativeOrderMarket(
    detail.currentOrder || null,
    demoMarket,
  );
  const marketData = {
    ...(detail.marketSnapshot || {}),
    ...(detail.marketData || {}),
    market: demoMarket,
    currentPrice:
      detail.currentPrice ??
      detail.marketSnapshot?.currentPrice ??
      detail.marketSnapshot?.current_price ??
      detail.marketSnapshot?.tradePriceAtSnapshot ??
      demoMarketSnapshot.currentPrice ??
      null,
    tradePriceAtSnapshot:
      detail.marketSnapshot?.tradePriceAtSnapshot ??
      demoMarketSnapshot.tradePriceAtSnapshot ??
      demoMarketSnapshot.tradePrice ??
      null,
    signedChangeRate:
      detail.marketSnapshot?.signedChangeRate ??
      demoMarketSnapshot.signedChangeRate ??
      null,
    shortTermReturn5m:
      detail.marketSnapshot?.shortTermReturn5m ??
      demoMarketSnapshot.shortTermReturn5m ??
      null,
    spreadRate:
      detail.marketSnapshot?.spreadRate ??
      demoMarketSnapshot.spreadRate ??
      null,
    pricePositionIn5mRange:
      detail.marketSnapshot?.pricePositionIn5mRange ??
      demoMarketSnapshot.pricePositionIn5mRange ??
      null,
    volumeSpikeRatio5m:
      detail.marketSnapshot?.volumeSpikeRatio5m ??
      demoMarketSnapshot.volumeSpikeRatio5m ??
      null,
    marketRiskFlags:
      detail.marketSnapshot?.marketRiskFlags ||
      demoMarketSnapshot.marketRiskFlags ||
      [],
  };
  const accounts =
    demoPersonalSnapshot.accounts || demoPersonalSnapshot.balances || [];
  const rawClosedOrders = demoPersonalSnapshot.rawClosedOrders || [];
  const rawOpenOrders = demoPersonalSnapshot.rawOpenOrders || [];
  const recentOrders = demoPersonalSnapshot.recentOrders || [];

  return {
    behaviorData: detail.behaviorData || null,
    currentOrder,
    demoMarketSnapshot,
    demoPersonalSnapshot,
    demoData: {
      market: demoMarket,
      personalDataSource: "demo-data",
      demoPersonalAvailable: true,
      currentPrice: marketData.currentPrice,
      marketData,
      accounts,
      recentOrders,
      rawClosedOrders,
      rawOpenOrders,
      updatedAt: detail.updatedAt || new Date().toISOString(),
      clientAverageBuyAmount:
        detail.clientAverageBuyAmount ??
        detail.behaviorData?.client_avg_buy_amount ??
        null,
    },
    expiresAt: Number(detail.expiresAt) || Date.now() + 180_000,
  };
}

function applyDemoOverrideState(state = {}, source = "demo-state") {
  if (!behaviorState || !isDemoPage()) {
    return;
  }

  const normalizedState = normalizeDemoBridgeDetail(state);
  latestDemoBridgeState = {
    ...latestDemoBridgeState,
    ...normalizedState,
  };
  const previousOrders = behaviorState.demoOverride?.demoData || {};
  const previousOverride = behaviorState.demoOverride || {};
  const mergedState = {
    ...normalizedState,
    market:
      normalizedState.market ||
      getDemoOverrideMarket(previousOverride) ||
      latestDemoBridgeState?.market,
    marketSnapshot:
      normalizedState.marketSnapshot ||
      previousOverride.demoMarketSnapshot ||
      latestDemoBridgeState?.marketSnapshot ||
      null,
    accountSnapshot:
      normalizedState.accountSnapshot ||
      previousOverride.demoPersonalSnapshot ||
      latestDemoBridgeState?.accountSnapshot ||
      null,
    currentOrder:
      normalizedState.currentOrder ||
      previousOverride.currentOrder ||
      latestDemoBridgeState?.currentOrder ||
      null,
    behaviorData:
      normalizedState.behaviorData ||
      previousOverride.behaviorData ||
      latestDemoBridgeState?.behaviorData ||
      null,
    orders: [
      ...(Array.isArray(previousOrders.rawClosedOrders)
        ? previousOrders.rawClosedOrders
        : []),
      ...(Array.isArray(previousOrders.rawOpenOrders)
        ? previousOrders.rawOpenOrders
        : []),
      ...(Array.isArray(previousOrders.recentOrders)
        ? previousOrders.recentOrders
        : []),
      ...(Array.isArray(state.orders) ? state.orders : []),
    ],
  };
  const override = buildDemoOverrideFromState(mergedState);
  behaviorState.demoOverride = override;
  behaviorState.market = override.demoMarketSnapshot.market;
  latestDemoBridgeState = {
    ...latestDemoBridgeState,
    market: behaviorState.market,
    marketSnapshot: override.demoMarketSnapshot,
    accountSnapshot: override.demoPersonalSnapshot,
    orders: override.demoData.recentOrders,
    currentOrder: override.currentOrder,
    behaviorData: override.behaviorData,
    updatedAt: latestDemoBridgeState?.updatedAt || new Date().toISOString(),
  };
  const debugPayload = getDemoBridgeDebugPayload(
    normalizedState.type || state.type || source,
    override,
    source,
  );
  if (override.demoMarketSnapshot) {
    emitDemoBridgeDebug("DEMO_MARKET_SNAPSHOT_CACHED", debugPayload);
  }
  if (override.demoPersonalSnapshot) {
    emitDemoBridgeDebug("DEMO_PERSONAL_SNAPSHOT_CACHED", debugPayload);
  }
  if (state.type === "ORDER_CREATED" || state.type === "DEMO_ORDER_CREATED") {
    emitDemoBridgeDebug("DEMO_ORDER_CREATED_CACHED", debugPayload);
  }
  debugUpbitOrder("DEMO_SNAPSHOT_BRIDGE_UPDATED", {
    source,
    market: behaviorState.market,
    hasMarketSnapshot: Boolean(override.demoMarketSnapshot),
    hasPersonalSnapshot: Boolean(override.demoPersonalSnapshot),
    accountsLength: override.demoData.accounts.length,
    recentOrdersLength: override.demoData.recentOrders.length,
  });
  emitDetectionPipelineTrace("RAW_DATA_CAPTURED", {
    dataSource: "DEMO",
    market: behaviorState.market,
    marketSnapshot: override.demoMarketSnapshot || null,
    personalSnapshot: override.demoPersonalSnapshot || null,
    orderSnapshot: override.currentOrder || null,
    behaviorSnapshot: override.behaviorData || null,
    source,
  });
}

function handleDemoScenario(event) {
  if (!behaviorState || !isAppPage()) {
    return;
  }

  acknowledgePageEvent(event);
  const detail = event.detail || {};
  behaviorState.demoOverride = buildDemoOverrideFromState(detail);

  behaviorState.market = behaviorState.demoOverride.demoMarketSnapshot.market;
  if (toNumber(detail.orderbookClickToSnapshotMs) !== null) {
    behaviorState.lastOrderbookClickAt =
      Date.now() - Math.max(0, toNumber(detail.orderbookClickToSnapshotMs));
  }

  renderBehaviorMetrics();
  registerCurrentContext();
  sendSnapshotRefreshMessage("DEMO_SCENARIO", behaviorState.market);
  reviewPendingAttemptWithPageRules();
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
  safeRuntimeSendMessage({
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
  safeRuntimeSendMessage({ type: "RESET_DEMO_STATE" }).catch(() => {});
}

function updateLocalSnapshotCaches(values = {}) {
  if (Object.prototype.hasOwnProperty.call(values, MARKET_SNAPSHOT_CACHE_KEY)) {
    cachedMarketSnapshotCache = values[MARKET_SNAPSHOT_CACHE_KEY] || {};
  }

  if (Object.prototype.hasOwnProperty.call(values, PERSONAL_SNAPSHOT_CACHE_KEY)) {
    cachedPersonalSnapshotCache = values[PERSONAL_SNAPSHOT_CACHE_KEY] || {};
  }
}

function loadLocalSnapshotCaches() {
  safeStorageLocalGet([MARKET_SNAPSHOT_CACHE_KEY, PERSONAL_SNAPSHOT_CACHE_KEY])
    .then(updateLocalSnapshotCaches)
    .catch(() => {});
}

function getCachedSnapshot(cache, market) {
  if (!market) {
    return null;
  }

  return cache?.[market] || null;
}

function isFreshCachedSnapshot(snapshot) {
  if (!snapshot?.fetchedAt) {
    return false;
  }

  const fetchedAtMs = Date.parse(snapshot.fetchedAt);
  return (
    Number.isFinite(fetchedAtMs) &&
    Date.now() - fetchedAtMs <= SNAPSHOT_CACHE_MAX_AGE_MS
  );
}

function findPersonalBalance(personalSnapshot, currency) {
  return (personalSnapshot?.balances || []).find(
    (balance) => balance?.currency === currency,
  );
}

function getDemoSnapshotOverride(snapshot) {
  const override = getActiveDemoOverride();

  if (!override?.demoMarketSnapshot) {
    return { marketSnapshot: null, personalSnapshot: null };
  }

  const demoMarket = getDemoOverrideMarket(override);
  if (demoMarket && snapshot.market !== demoMarket) {
    emitExtensionDebug("behavior", "MARKET_MISMATCH", {
      kind: "MARKET_MISMATCH",
      source: "demo-snapshot-override",
      expectedMarket: demoMarket,
      actualMarket: snapshot.market,
      usedForRuleEvaluation: false,
      message: "데모 페이지에서는 URL/backend cache market 대신 demo scenario market을 사용합니다.",
    }, snapshot.capturedAt);
  }

  return {
    marketSnapshot: {
      ...override.demoMarketSnapshot,
      market: demoMarket || override.demoMarketSnapshot.market,
    },
    personalSnapshot:
      override.demoPersonalSnapshot
        ? {
            ...override.demoPersonalSnapshot,
            market: demoMarket || override.demoPersonalSnapshot.market,
          }
        : null,
  };
}

function getDemoCacheDebugPayload(resolvedMarket) {
  const override = getActiveDemoOverride();
  const demoMarket = getDemoOverrideMarket(override);

  return {
    resolvedMarket: resolvedMarket || null,
    demoMarketCacheKeys: demoMarket ? [demoMarket] : [],
    demoPersonalCacheKeys: demoMarket && override?.demoPersonalSnapshot
      ? [demoMarket]
      : [],
    latestDemoStateMarket: latestDemoBridgeState?.market || null,
    latestDemoStateUpdatedAt: latestDemoBridgeState?.updatedAt || null,
  };
}

function emitDemoCacheMissDebug(kind, resolvedMarket) {
  emitDemoBridgeDebug(kind, getDemoCacheDebugPayload(resolvedMarket));
}

function getSnapshotsForOrderContext(snapshot) {
  if (isDemoPage()) {
    const demoSnapshots = getDemoSnapshotOverride(snapshot);
    const freshMarketSnapshot = isFreshCachedSnapshot(
      demoSnapshots.marketSnapshot,
    )
      ? demoSnapshots.marketSnapshot
      : null;
    const freshPersonalSnapshot = isFreshCachedSnapshot(
      demoSnapshots.personalSnapshot,
    )
      ? demoSnapshots.personalSnapshot
      : null;

    if (!freshMarketSnapshot) {
      emitDemoCacheMissDebug("DEMO_MARKET_SNAPSHOT_CACHE_MISS", snapshot.market);
    }

    if (!freshPersonalSnapshot) {
      emitDemoCacheMissDebug("DEMO_PERSONAL_SNAPSHOT_CACHE_MISS", snapshot.market);
    }

    return {
      ...demoSnapshots,
      freshMarketSnapshot,
      freshPersonalSnapshot,
    };
  }

  const marketSnapshot =
    getCachedSnapshot(cachedMarketSnapshotCache, snapshot.market);
  const personalSnapshot =
    getCachedSnapshot(cachedPersonalSnapshotCache, snapshot.market);

  const freshMarketSnapshot = isFreshCachedSnapshot(marketSnapshot)
    ? marketSnapshot
    : null;
  const freshPersonalSnapshot = isFreshCachedSnapshot(personalSnapshot)
    ? personalSnapshot
    : null;

  return {
    marketSnapshot,
    personalSnapshot,
    freshMarketSnapshot,
    freshPersonalSnapshot,
  };
}

function mergeCachedSnapshotsIntoOrderContext(snapshot) {
  const authoritativeMarket = isDemoPage()
    ? getDemoOverrideMarket() || snapshot.market
    : snapshot.market;
  const normalizedSnapshot =
    authoritativeMarket && authoritativeMarket !== snapshot.market
      ? { ...snapshot, market: authoritativeMarket }
      : snapshot;
  const {
    freshMarketSnapshot,
    freshPersonalSnapshot,
  } = getSnapshotsForOrderContext(normalizedSnapshot);
  const tradePrice = toNumber(freshMarketSnapshot?.tradePrice);
  const intentAmount = toNumber(normalizedSnapshot.intentAmount);
  const intentQuantity = toNumber(normalizedSnapshot.intentQuantity);
  const baseCurrency = String(normalizedSnapshot.market || "").split("-")[1];
  const balance = normalizedSnapshot.side === "BUY"
    ? findPersonalBalance(freshPersonalSnapshot, "KRW")
    : findPersonalBalance(freshPersonalSnapshot, baseCurrency);
  const availableBalance = toNumber(balance?.balance);
  const requested =
    normalizedSnapshot.side === "BUY" ? intentAmount : intentQuantity;
  const baseAvgBuyPrice = toNumber(
    freshPersonalSnapshot?.baseAssetAvgBuyPrice,
  );
  const requestedBalanceRatio =
    normalizedSnapshot.requestedBalanceRatio ??
    (availableBalance && requested !== null
      ? Math.max(0, Math.min(1, requested / availableBalance))
      : null);

  return {
    ...normalizedSnapshot,
    tradePriceAtSnapshot:
      normalizedSnapshot.tradePriceAtSnapshot ??
      freshMarketSnapshot?.tradePrice ??
      null,
    shortTermReturn5m:
      normalizedSnapshot.shortTermReturn5m ??
      freshMarketSnapshot?.shortTermReturn5m ??
      null,
    signedChangeRate:
      normalizedSnapshot.signedChangeRate ??
      freshMarketSnapshot?.signedChangeRate ??
      null,
    spreadRate:
      normalizedSnapshot.spreadRate ?? freshMarketSnapshot?.spreadRate ?? null,
    marketRiskFlags:
      normalizedSnapshot.marketRiskFlags?.length
        ? normalizedSnapshot.marketRiskFlags
        : freshMarketSnapshot?.marketRiskFlags || [],
    pricePositionIn5mRange:
      normalizedSnapshot.pricePositionIn5mRange ??
      freshMarketSnapshot?.pricePositionIn5mRange ??
      null,
    volumeSpikeRatio5m:
      normalizedSnapshot.volumeSpikeRatio5m ??
      freshMarketSnapshot?.volumeSpikeRatio5m ??
      null,
    actualOrderCreatedCount10m:
      normalizedSnapshot.actualOrderCreatedCount10m ??
      freshPersonalSnapshot?.actualOrderCreatedCount10m ??
      null,
    baseAssetAvgBuyPriceBeforeSnapshot:
      normalizedSnapshot.baseAssetAvgBuyPriceBeforeSnapshot ??
      freshPersonalSnapshot?.baseAssetAvgBuyPrice ??
      null,
    priceVsAvgBuyRateAtSnapshot:
      normalizedSnapshot.priceVsAvgBuyRateAtSnapshot ??
      (baseAvgBuyPrice && tradePrice
        ? (tradePrice - baseAvgBuyPrice) / baseAvgBuyPrice
        : null),
    requestedBalanceRatio,
  };
}

function getSnapshotFreshnessMs(snapshot) {
  if (!snapshot?.fetchedAt) {
    return null;
  }

  const fetchedAtMs = Date.parse(snapshot.fetchedAt);
  return Number.isFinite(fetchedAtMs) ? Date.now() - fetchedAtMs : null;
}

function emitOrderContextSnapshotDebug(snapshot) {
  if (shouldBlockWarningOrVisualUpdate(snapshot?.attemptId)) {
    return;
  }

  const {
    freshMarketSnapshot,
    freshPersonalSnapshot,
  } = getSnapshotsForOrderContext(snapshot);

  emitExtensionDebug("behavior", "ORDER_CONTEXT_WITH_SNAPSHOTS", {
    kind: "ORDER_CONTEXT_WITH_SNAPSHOTS",
    market: snapshot.market,
    snapshotId: snapshot.snapshotId,
    attemptId: snapshot.attemptId,
    hasMarketSnapshot: Boolean(freshMarketSnapshot),
    marketSnapshotSource: freshMarketSnapshot?.source || null,
    marketSnapshotFreshnessMs: getSnapshotFreshnessMs(freshMarketSnapshot),
    hasPersonalSnapshot: Boolean(freshPersonalSnapshot),
    personalSnapshotSource: freshPersonalSnapshot?.source || null,
    personalSnapshotFreshnessMs: getSnapshotFreshnessMs(freshPersonalSnapshot),
    mergedFields: {
      tradePriceAtSnapshot: snapshot.tradePriceAtSnapshot,
      signedChangeRate: snapshot.signedChangeRate,
      shortTermReturn5m: snapshot.shortTermReturn5m,
      requestedBalanceRatio: snapshot.requestedBalanceRatio,
      actualOrderCreatedCount10m: snapshot.actualOrderCreatedCount10m,
      baseAssetAvgBuyPriceBeforeSnapshot:
        snapshot.baseAssetAvgBuyPriceBeforeSnapshot,
      priceVsAvgBuyRateAtSnapshot: snapshot.priceVsAvgBuyRateAtSnapshot,
    },
  }, snapshot.capturedAt);
  debugUpbitOrder("UPBIT_ORDER_CONTEXT_SNAPSHOT_BUILT", {
    attemptId: snapshot.attemptId,
    orderContextSnapshot: snapshot,
    marketSnapshot: freshMarketSnapshot || null,
    personalSnapshot: freshPersonalSnapshot || null,
  });
}

function buildOrderContextSnapshot(orderButton, snapshotTrigger, options = {}) {
  const panel = options.formRoot || findOrderPanel(orderButton);
  const draft = Object.prototype.hasOwnProperty.call(options, "draft")
    ? options.draft
    : readOrderDraft(orderButton);
  const capturedAt = new Date().toISOString();
  const orderTimeParts = getOrderTimeParts(capturedAt);
  const now = Date.now();
  const market = isDemoPage()
    ? getDemoOverrideMarket() ||
      options.market ||
      draft?.market ||
      behaviorState?.market ||
      parseMarket(location.href)
    : options.market || draft?.market || behaviorState?.market || parseMarket(location.href);
  const side =
    options.side || draft?.order_side || detectOrderSide(panel, orderButton) ||
    "UNKNOWN";
  const orderMode =
    options.orderMode || draft?.order_type || detectOrderType(panel, orderButton) ||
    "UNKNOWN";
  const price = Object.prototype.hasOwnProperty.call(options, "intentPrice")
    ? options.intentPrice
    : draft?.order_price ?? null;
  const amount = Object.prototype.hasOwnProperty.call(options, "intentAmount")
    ? options.intentAmount
    : draft?.order_amount ?? null;
  const quantity = Object.prototype.hasOwnProperty.call(options, "intentQuantity")
    ? options.intentQuantity
    : draft?.order_volume ?? null;
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
      options.attemptId ||
      (snapshotTrigger === "ORDER_INTENT_CLICK" ? createUuid() : null),
    dataSource: isDemoPage() ? "DEMO" : "UPBIT",
    marketSource: isDemoPage() ? "DEMO_PAGE" : "UPBIT_PUBLIC_API",
    orderSource: isDemoPage() ? "DEMO_PAGE" : "UPBIT_DOM",
    behaviorSource: isDemoPage() ? "DEMO_INTERACTION" : "UPBIT_INTERACTION",
    personalSource: isDemoPage()
      ? "DEMO_PAGE"
      : cachedPersonalSnapshotCache?.[market]
        ? "UPBIT_PERSONAL_API"
        : "UNAVAILABLE",
    snapshotTrigger,
    capturedAt,
    orderTime: orderTimeParts.orderTime,
    orderTimeMinutes: orderTimeParts.orderTimeMinutes,
    market: market || "UNKNOWN",
    side,
    orderMode,
    entryPoint: "NORMAL",
    intentPrice: decimalString(price),
    intentQuantity: decimalString(quantity),
    intentAmount: decimalString(amount),
    valid: options.valid ?? true,
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
    ruleSnapshot: null,
    ruleSnapshots: [],
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

function validateSnapshotSourceConsistency(snapshot) {
  const dataSource = snapshot?.dataSource || (isDemoPage() ? "DEMO" : "UPBIT");
  const expectedSources = dataSource === "DEMO"
    ? {
        marketSource: "DEMO_PAGE",
        orderSource: "DEMO_PAGE",
        behaviorSource: "DEMO_INTERACTION",
        personalSource: "DEMO_PAGE",
      }
    : {
        marketSource: "UPBIT_PUBLIC_API",
        orderSource: "UPBIT_DOM",
        behaviorSource: "UPBIT_INTERACTION",
      };
  const mismatches = Object.entries(expectedSources)
    .filter(([field, expected]) => snapshot?.[field] !== expected)
    .map(([field, expected]) => ({
      field,
      expected,
      actual: snapshot?.[field] ?? null,
    }));

  if (
    dataSource === "UPBIT" &&
    !["UPBIT_PERSONAL_API", "UNAVAILABLE"].includes(snapshot?.personalSource)
  ) {
    mismatches.push({
      field: "personalSource",
      expected: "UPBIT_PERSONAL_API|UNAVAILABLE",
      actual: snapshot?.personalSource ?? null,
    });
  }

  if (mismatches.length > 0) {
    emitDetectionPipelineTrace("DATA_SOURCE_MISMATCH", {
      attemptId: snapshot?.attemptId || null,
      dataSource,
      market: snapshot?.market || null,
      mismatches,
      orderSnapshot: snapshot || null,
    });
    return false;
  }

  return true;
}

function emitOrderContextSnapshot(snapshot, detection = null) {
  const matchedRuleIds = detection?.matchedRuleIds || [];
  const primaryRuleId = detection?.primaryRuleId || null;
  const ruleSnapshots = Array.isArray(detection?.ruleEvaluation?.matchedRules)
    ? detection.ruleEvaluation.matchedRules
        .map((rule) => createGuardrailRuleSnapshot(rule))
        .filter(Boolean)
    : [];
  const ruleSnapshot =
    ruleSnapshots.find((item) => item.ruleId === primaryRuleId) ||
    ruleSnapshots[0] ||
    null;
  const payload = {
    ...snapshot,
    matchedRuleIdsAtSnapshot: matchedRuleIds,
    primaryShownRuleId: primaryRuleId,
    shownRuleIds: primaryRuleId ? [primaryRuleId] : [],
    ruleSnapshot,
    ruleSnapshots,
  };
  payload.ruleEvaluationSnapshots = buildRuleEvaluationSnapshots(
    detection?.ruleEvaluation,
    payload,
  );
  emitDetectionPipelineTrace("GUARDRAIL_LOG_SAVED", {
    attemptId: payload.attemptId,
    dataSource: payload.dataSource,
    market: payload.market,
    orderSnapshot: payload,
  });
  emitExtensionDebug(
    "behavior",
    payload.snapshotTrigger || "OrderContextSnapshotDTO",
    payload,
    payload.capturedAt,
  );
  sendBackendLogMessage("SAVE_ORDER_CONTEXT_SNAPSHOT", payload);
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

function collectRuleConditionsForDebug(expression) {
  if (!expression || typeof expression !== "object") {
    return [];
  }

  if (expression.nodeType === "CONDITION") {
    return [expression];
  }

  if (expression.nodeType !== "GROUP") {
    return [];
  }

  return (Array.isArray(expression.children) ? expression.children : [])
    .flatMap(collectRuleConditionsForDebug);
}

function buildRuleConditionResultsForDebug(rules, snapshot) {
  return (Array.isArray(rules) ? rules : [])
    .filter((rule) => rule?.isEnabled !== false)
    .flatMap((rule) =>
      collectRuleConditionsForDebug(rule.expression).map((condition) => {
        const actualValue = getRuleFieldValue(snapshot, condition.leftField);
        const expectedValue = getRuleOperandValue(
          condition.rightOperand,
          snapshot,
        );

        return {
          ruleId: rule.ruleId || null,
          ruleName: rule.name || rule.warningTitle || rule.title || null,
          leftField: condition.leftField,
          operator: condition.operator,
          expectedValue,
          actualValue,
          actualType: actualValue === null ? "null" : typeof actualValue,
          pass: evaluateRuleExpression(condition, snapshot),
        };
      }),
    );
}

function getRuleEvaluationDataCategory(field) {
  if (
    [
      "draftDurationMs",
      "lastEditToSnapshotMs",
      "draftEditCount",
      "amountChangeRate",
      "modeChangedToMarket",
      "orderbookClickToSnapshotMs",
      "orderIntentCount1m",
      "sameSideIntentCount1m",
      "marketChangeCount5m",
      "sideChangeCount3m",
      "priceEditCount3m",
      "quantityEditCount3m",
      "amountEditCount3m",
      "inputRevertCount",
      "priceDirectionChangeCount",
      "priceChangeRate",
      "orderModeChangeCount3m",
      "draftResetCount3m",
    ].includes(field)
  ) {
    return "BEHAVIOR";
  }

  if (
    [
      "tradePriceAtSnapshot",
      "shortTermReturn5m",
      "signedChangeRate",
      "spreadRate",
      "marketRiskFlags",
      "pricePositionIn5mRange",
      "volumeSpikeRatio5m",
    ].includes(field)
  ) {
    return "MARKET";
  }

  if (
    [
      "actualOrderCreatedCount10m",
      "baseAssetAvgBuyPriceBeforeSnapshot",
      "priceVsAvgBuyRateAtSnapshot",
    ].includes(field)
  ) {
    return "ACCOUNT";
  }

  return "ORDER";
}

function buildRuleEvaluationSnapshots(ruleEvaluation, snapshot) {
  const matchedRules = Array.isArray(ruleEvaluation?.matchedRules)
    ? ruleEvaluation.matchedRules
    : [];
  const conditionResults = Array.isArray(ruleEvaluation?.conditionResults)
    ? ruleEvaluation.conditionResults
    : [];

  return matchedRules.map((rule) => {
    const evaluatedConditions = conditionResults
      .filter((condition) => condition.ruleId === rule.ruleId)
      .map((condition) => ({
        leftField: condition.leftField || condition.field,
        operator: condition.operator,
        expectedValue: condition.expectedValue,
        actualValue: condition.actualValue,
        matched: Boolean(condition.matched ?? condition.pass),
        dataCategory: getRuleEvaluationDataCategory(
          condition.leftField || condition.field,
        ),
      }));
    const fallbackConditions = collectRuleConditionsForDebug(rule.expression)
      .map((condition) => ({
        leftField: condition.leftField,
        operator: condition.operator,
        expectedValue: getRuleOperandValue(condition.rightOperand, snapshot),
        actualValue: getRuleFieldValue(snapshot, condition.leftField),
        matched: evaluateRuleExpression(condition, snapshot),
        dataCategory: getRuleEvaluationDataCategory(condition.leftField),
      }));

    return {
      ...(createGuardrailRuleSnapshot(rule) || {}),
      ruleId: rule.ruleId,
      ruleVersion: rule.schemaVersion || "v1",
      ruleName: rule.name || rule.warningTitle || "이름 없는 규칙",
      description: rule.description || rule.warningMessage || null,
      visualMode: rule.visualMode || "CURIOUS",
      riskLevel: rule.riskLevel || "MEDIUM",
      expression: rule.expression,
      conditions: evaluatedConditions.length > 0
        ? evaluatedConditions
        : fallbackConditions,
    };
  });
}

function evaluatePageGuardrailRulesForSnapshot(snapshot) {
  const baseRuleEvaluation = evaluateGuardrailRules(pageGuardrailRules, snapshot);
  const ruleSnapshots = Array.isArray(baseRuleEvaluation.matchedRules)
    ? baseRuleEvaluation.matchedRules
        .map((rule) => createGuardrailRuleSnapshot(rule))
        .filter(Boolean)
    : [];
  const ruleSnapshot =
    ruleSnapshots.find((item) => item.ruleId === baseRuleEvaluation.primaryRuleId) ||
    ruleSnapshots[0] ||
    null;
  const evaluatedSnapshot = {
    ...snapshot,
    matchedRuleIdsAtSnapshot: baseRuleEvaluation.matchedRuleIds,
    primaryShownRuleId: baseRuleEvaluation.primaryRuleId,
    shownRuleIds: baseRuleEvaluation.primaryRuleId
      ? [baseRuleEvaluation.primaryRuleId]
      : [],
    ruleSnapshot,
    ruleSnapshots,
  };
  const ruleEvaluation = {
    ...baseRuleEvaluation,
    conditionResults:
      baseRuleEvaluation.conditionResults ||
      buildRuleConditionResultsForDebug(pageGuardrailRules, evaluatedSnapshot),
  };
  lastRuleEvaluation = ruleEvaluation;
  const result = createLocalGuardrailResult(
    ruleEvaluation,
    evaluatedSnapshot,
  );

  debugUpbitOrder("UPBIT_RULE_EVALUATION_RESULT", {
    attemptId: evaluatedSnapshot.attemptId,
    market: evaluatedSnapshot.market,
    side: evaluatedSnapshot.side,
    orderMode: evaluatedSnapshot.orderMode,
    orderType: evaluatedSnapshot.orderType,
    orderContextSnapshot: evaluatedSnapshot,
    ruleEvaluation,
    matchedRules: ruleEvaluation.matchedRules || [],
    primaryRule: ruleEvaluation.primaryRule || null,
    conditionResults: ruleEvaluation.conditionResults || [],
    snapshotCoreFields: {
      side: evaluatedSnapshot?.side,
      orderMode: evaluatedSnapshot?.orderMode,
      orderType: evaluatedSnapshot?.orderType,
      order_mode: evaluatedSnapshot?.order_mode,
      intentPrice: evaluatedSnapshot?.intentPrice,
      intentQuantity: evaluatedSnapshot?.intentQuantity,
      intentAmount: evaluatedSnapshot?.intentAmount,
    },
  });
  emitDetectionPipelineTrace("RULE_EVALUATED", {
    attemptId: evaluatedSnapshot.attemptId,
    dataSource: evaluatedSnapshot.dataSource,
    market: evaluatedSnapshot.market,
    evaluation: ruleEvaluation,
  });
  return { snapshot: evaluatedSnapshot, result, ruleEvaluation };
}

function showDetectedGuardrailResult(result, snapshot, options = {}) {
  const attemptId =
    getAttemptIdFromPayload(result) || snapshot?.attemptId || null;
  const source =
    options.source ||
    result?.source ||
    (upbitOrderFlow.state === "CONFIRM_MODAL_OPEN"
      ? "UPBIT_CONFIRM_MODAL_OPEN"
      : "ORDER_INTENT_CLICK");
  const renderMode = options.renderMode || result?.renderMode || "WARNING_ONLY";
  const flowStateBefore = upbitOrderFlow.state;
  const primaryRule = result?.primaryRule || result?.ruleEvaluation?.primaryRule || null;
  const warningDebugBase = {
    source,
    renderMode,
    attemptId,
    detected: Boolean(result?.detected),
    primaryRuleId:
      result?.primaryRuleId ||
      result?.ruleEvaluation?.primaryRuleId ||
      primaryRule?.ruleId ||
      null,
    primaryRuleName: primaryRule?.name || null,
    visualMode:
      result?.visualMode ||
      result?.flameMode ||
      result?.ruleEvaluation?.visualMode ||
      primaryRule?.visualMode ||
      null,
    warningTitle:
      result?.warningTitle ||
      result?.ruleEvaluation?.warningTitle ||
      primaryRule?.warningTitle ||
      null,
    warningMessage:
      result?.message ||
      result?.warningMessage ||
      result?.ruleEvaluation?.warningMessage ||
      primaryRule?.warningMessage ||
      null,
    flowStateBefore,
  };

  const emitSkipped = (reason) => {
    const flowStateAfter = upbitOrderFlow.state;
    debugUpbitOrder("UPBIT_WARNING_UI_SKIPPED", {
      ...warningDebugBase,
      reason,
      flowStateAfter,
      ...getWarningUiDebugState(attemptId),
    });
    return false;
  };

  if (
    source === "UPBIT_CONFIRM_MODAL_OPEN" &&
    !warningDebugBase.primaryRuleId &&
    result?.detected
  ) {
    return emitSkipped("NO_PRIMARY_RULE");
  }

  if (shouldBlockWarningOrVisualUpdate(attemptId)) {
    if (feedbackCompletedAttemptIds.has(attemptId)) {
      return emitSkipped("ATTEMPT_ALREADY_FEEDBACK_COMPLETED");
    }
    if (settledAttemptIds.has(attemptId)) {
      return emitSkipped("ATTEMPT_ALREADY_SETTLED");
    }
    if (pendingAttempt?.attemptId && pendingAttempt.attemptId !== attemptId) {
      return emitSkipped("STALE_ATTEMPT");
    }
    return emitSkipped("UNKNOWN");
  }

  if (!result?.detected) {
    return emitSkipped("UNKNOWN");
  }

  if (result.type !== "USER_GUARDRAIL_RULE") {
    return emitSkipped("UNKNOWN");
  }

  if (isGuardrailSnapshotHandled(snapshot?.snapshotId)) {
    return emitSkipped("DUPLICATE_WARNING_ALREADY_APPLIED");
  }

  activeDetectionResult = result;
  activeGuardrailSnapshotId = snapshot?.snapshotId || null;
  renderGuardrailRulesFromCache(pageGuardrailRulesState);

  const panelBeforeApply = document.getElementById(PANEL_ID);
  if (!panelBeforeApply) {
    return emitSkipped("NO_PANEL_ROOT");
  }

  if (
    activeTradeFeedback?.attemptId &&
    activeTradeFeedback.attemptId === attemptId
  ) {
    return emitSkipped("ACTIVE_FEEDBACK_VIEW");
  }

  if (
    activeTradeFeedback?.attemptId &&
    activeTradeFeedback.attemptId !== attemptId
  ) {
    clearActiveFeedbackViewForNewAttempt(attemptId);
  }

  rememberGuardrailSnapshot(shownGuardrailSnapshotIds, snapshot.snapshotId);
  applyFlameTheme(result.visualMode || result.flameMode, { attemptId });
  showGuardrail(result, snapshot.snapshotId);

  openSaltbreadPanel({
    source: `${source}_DETECTED_GUARDRAIL`,
    reason: "detected_guardrail",
  });

  setAnalysisStatus(
    result.message || "설정한 가드레일 기준에 맞는 주문을 감지했어요.",
    "detected",
    result.type,
    result.warningTitle || result.primaryRule?.warningTitle || null,
    result,
  );
  focusGuardrailWarning();
  scrollWarningIntoView();

  const uiState = getWarningUiDebugState(attemptId);
  if (!uiState.warningCardExists) {
    return emitSkipped("PANEL_RENDER_FAILED");
  }

  const appliedAt = new Date().toISOString();

  if (source === "UPBIT_CONFIRM_MODAL_OPEN") {
    upbitOrderFlow = {
      ...upbitOrderFlow,
      state: "GUARDRAIL_SHOWN",
      attemptId,
    };
  }

  if (pendingAttempt?.attemptId === attemptId) {
    pendingAttempt.guardrailShownAt = pendingAttempt.guardrailShownAt || appliedAt;
    pendingAttempt.warningAppliedAt = pendingAttempt.warningAppliedAt || appliedAt;
    pendingAttempt.feedbackShownAt = null;
    pendingAttempt.feedbackRespondedAt = null;
  }

  const flowStateAfter = upbitOrderFlow.state;

  debugUpbitOrder("UPBIT_WARNING_UI_APPLIED", {
    ...warningDebugBase,
    appliedAt,
    flowStateAfter,
    panelFlameMode: uiState.renderedVisualMode,
    panelStatusState:
      document.querySelector(".saltbread-analysis-status")?.dataset?.state ||
      null,
    ...uiState,
  });
  emitDetectionPipelineTrace("WARNING_UI_RENDERED", {
    attemptId,
    dataSource: snapshot?.dataSource || (isDemoPage() ? "DEMO" : "UPBIT"),
    market: snapshot?.market || null,
    orderSnapshot: snapshot || null,
    ruleEvaluation: result?.ruleEvaluation || null,
    warningUi: uiState,
  });
  return true;
}

function clearActiveGuardrailResult() {
  activeDetectionResult = null;
  activeGuardrailSnapshotId = null;
  setPanelWarningActive(false);
  renderGuardrailRulesFromCache(pageGuardrailRulesState);
}

function clearActiveFeedbackViewForNewAttempt(nextAttemptId = null) {
  if (
    activeTradeFeedback?.attemptId &&
    activeTradeFeedback.attemptId !== nextAttemptId
  ) {
    activeTradeFeedback = null;
    setPanelFeedbackActive(false);
  }
}

function clearActiveWarningForNewAttempt(nextAttemptId = null) {
  const activeAttemptId = getAttemptIdFromPayload(activeDetectionResult);

  if (activeAttemptId && activeAttemptId !== nextAttemptId) {
    clearActiveGuardrailResult();
  }
}

function reviewPendingAttemptWithPageRules() {
  if (
    !pendingAttempt?.snapshot ||
    shouldBlockWarningOrVisualUpdate(pendingAttempt.snapshot.attemptId) ||
    activeDetectionResult?.detected ||
    isGuardrailSnapshotHandled(pendingAttempt.snapshot.snapshotId)
  ) {
    return;
  }

  const { snapshot, result } = evaluatePageGuardrailRulesForSnapshot(
    mergeCachedSnapshotsIntoOrderContext(pendingAttempt.snapshot),
  );
  pendingAttempt.snapshot = snapshot;

  if (result?.detected) {
    showDetectedGuardrailResult(result, snapshot);
  }
}

function beginOrderAttempt(orderButton, options = {}) {
  if (pendingAttempt && !pendingAttempt.snapshotEmitted) {
    emitOrderContextSnapshot(pendingAttempt.snapshot, activeDetectionResult);
    pendingAttempt.snapshotEmitted = true;
  }
  const previousAttemptId = pendingAttempt?.attemptId || null;
  if (previousAttemptId && previousAttemptId !== options.attemptId) {
    rememberSettledAttempt(previousAttemptId);
  }
  unlockFeedbackCompletedVisualStateForNewAttempt();
  const rawSnapshot = buildOrderContextSnapshot(
    orderButton,
    "ORDER_INTENT_CLICK",
    options,
  );
  validateSnapshotSourceConsistency(rawSnapshot);
  const snapshotWithCache = mergeCachedSnapshotsIntoOrderContext(rawSnapshot);
  const { snapshot, result } =
    evaluatePageGuardrailRulesForSnapshot(snapshotWithCache);
  if (previousAttemptId && previousAttemptId !== snapshot.attemptId) {
    clearActiveFeedbackViewForNewAttempt(snapshot.attemptId);
    clearActiveWarningForNewAttempt(snapshot.attemptId);
  }
  emitOrderContextSnapshotDebug(snapshot);
  emitDetectionPipelineTrace("SNAPSHOT_CREATED", {
    attemptId: snapshot.attemptId,
    dataSource: snapshot.dataSource,
    market: snapshot.market,
    orderSnapshot: snapshot,
  });
  lastOrderIntent = {
    attemptId: snapshot.attemptId,
    market: snapshot.market,
    side: snapshot.side,
    orderMode: snapshot.orderMode,
    intentPrice: snapshot.intentPrice,
    intentQuantity: snapshot.intentQuantity,
    intentAmount: snapshot.intentAmount,
    valid: snapshot.valid,
  };
  lastOrderContextSnapshot = snapshot;
  pendingAttempt = {
    attemptId: snapshot.attemptId,
    snapshot,
    snapshotEmitted: true,
    guardrailShownAt: null,
    warningAppliedAt: null,
    confirmClickedAt: null,
    feedbackShownAt: null,
    feedbackRespondedAt: null,
  };
  debugUpbitOrder("ORDER_INTENT_CLICK", {
    attemptId: snapshot.attemptId,
    dto: lastOrderIntent,
    rawOrderData: options.draft || null,
    extraction: lastExtractionResult,
    orderContextSnapshot: snapshot,
    ruleEvaluation: result?.ruleEvaluation || lastRuleEvaluation,
    matchedRules: result?.ruleEvaluation?.matchedRules || [],
    primaryRule: result?.ruleEvaluation?.primaryRule || null,
  });
  emitOrderContextSnapshot(snapshot, result);
  let warningShown = false;
  if (result?.detected) {
    warningShown = showDetectedGuardrailResult(result, snapshot, {
      source: options.guardrailSource || options.source || null,
      renderMode: options.renderMode || "WARNING_ONLY",
    });
  } else {
    clearActiveGuardrailResult();
  }
  window.setTimeout(() => {
    if (pendingAttempt?.attemptId === snapshot.attemptId && !pendingAttempt.snapshotEmitted) {
      emitOrderContextSnapshot(snapshot, activeDetectionResult);
      pendingAttempt.snapshotEmitted = true;
    }
  }, 2500);
  sendSnapshotRefreshMessage("ORDER_INTENT_CLICK", snapshot.market);
  return Boolean(warningShown);
}

function closeGuardrail(action, options = {}) {
  const snapshotId = activeGuardrailSnapshotId;
  if (snapshotId) {
    const reaction = {
      reactionId: createUuid(),
      snapshotId,
      action,
      reactedAt: new Date().toISOString(),
      reactionUiVersion: "v1",
    };

    emitExtensionDebug("behavior", "GuardrailReactionDTO", reaction);
    debugUpbitOrder("GuardrailReactionDTO", {
      guardrailReactionDto: reaction,
      action,
    });
    sendBackendLogMessage("SAVE_GUARDRAIL_REACTION", reaction);
  }
  rememberGuardrailSnapshot(closedGuardrailSnapshotIds, snapshotId);
  clearActiveGuardrailResult();
  setAnalysisStatus("데이터 수집 중...", "loading");
  if (action === "REVIEW" && options.dispatchReview !== false) {
    document.dispatchEvent(new CustomEvent("saltbread:demo-review-order"));
  }
  if (action === "PROCEED") {
    sendSnapshotRefreshMessage("GUARDRAIL_PROCEED");
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

  const feedback = {
    feedbackId: createUuid(),
    attemptId: feedbackAttempt.attemptId,
    feedbackStatus:
      assessment === "DISMISSED" ? "DISMISSED" : "ANSWERED",
    selfAssessment:
      assessment === "DISMISSED" ? null : assessment,
    feedbackShownAt: feedbackAttempt.feedbackShownAt,
    respondedAt: new Date().toISOString(),
    feedbackUiVersion: "v1",
  };

  emitExtensionDebug("behavior", "TradeFeedbackDTO", feedback);
  debugUpbitOrder("UPBIT_TRADE_FEEDBACK_SUBMITTED", {
    attemptId: feedback.attemptId,
    tradeFeedbackDto: feedback,
    feedbackStatus: feedback.feedbackStatus,
    selfAssessment: feedback.selfAssessment,
  });
  sendBackendLogMessage("SAVE_TRADE_FEEDBACK", feedback);
  return feedback;
}

function dismissActiveTradeFeedback() {
  if (activeTradeFeedback) {
    rememberSettledAttempt(activeTradeFeedback.attemptId);
    emitTradeFeedback(activeTradeFeedback, "DISMISSED");
    if (pendingAttempt?.attemptId === activeTradeFeedback.attemptId) {
      pendingAttempt.feedbackRespondedAt = new Date().toISOString();
    }
  }

  activeTradeFeedback = null;
  setPanelFeedbackActive(false);
}

function answerTradeFeedback(assessment) {
  if (!activeTradeFeedback) {
    return;
  }

  const previousFlowState = upbitOrderFlow.state;
  const respondedAt = new Date().toISOString();
  const completedAttemptId = activeTradeFeedback.attemptId;
  rememberFeedbackCompletedAttempt(activeTradeFeedback.attemptId);
  emitTradeFeedback(activeTradeFeedback, assessment);
  if (pendingAttempt?.attemptId === activeTradeFeedback.attemptId) {
    pendingAttempt.feedbackRespondedAt = respondedAt;
  }
  if (upbitOrderFlow.attemptId === completedAttemptId) {
    upbitOrderFlow = {
      ...upbitOrderFlow,
      state: "FEEDBACK_COMPLETED",
    };
  }
  activeTradeFeedback = null;
  setPanelFeedbackActive(false);
  clearActiveGuardrailResult();
  applyFlameTheme("default", { force: true });
  setAnalysisStatus("주문·체결 데이터를 확인하고 있어요.", "loading");
  emitUpbitFlowDebug("UPBIT_FEEDBACK_COMPLETED", {
    attemptId: completedAttemptId,
    previousFlowState,
    nextFlowState: "FEEDBACK_COMPLETED",
    reason: assessment,
  });
  window.setTimeout(refreshDailyInsightStatus, 1200);
}

function showTradeFeedback(options = {}) {
  const source = options.source || null;

  if (!pendingAttempt?.attemptId) {
    debugUpbitOrder("UPBIT_FEEDBACK_SKIPPED_NO_PENDING_ATTEMPT", {
      reason: "NO_PENDING_ATTEMPT",
      source,
      flowState: upbitOrderFlow.state,
    });
    return;
  }

  if (pendingAttempt.feedbackRespondedAt) {
    debugUpbitOrder("UPBIT_ORDER_CAPTURE_SKIPPED", {
      reason: "feedback_already_completed",
      source,
      attemptId: pendingAttempt.attemptId,
      flowState: upbitOrderFlow.state,
    });
    return;
  }

  if (activeTradeFeedback?.attemptId === pendingAttempt.attemptId) {
    return;
  }

  if (activeDetectionResult?.detected && source !== "UPBIT_CONFIRM_CLICK") {
    debugUpbitOrder("UPBIT_FEEDBACK_SKIPPED_ACTIVE_WARNING", {
      reason: "ACTIVE_GUARDRAIL_WARNING",
      source,
      attemptId: pendingAttempt.attemptId,
      detected: true,
      primaryRuleId:
        activeDetectionResult.primaryRuleId ||
        activeDetectionResult.primaryRule?.ruleId ||
        null,
      visualMode:
        activeDetectionResult.visualMode ||
        activeDetectionResult.flameMode ||
        null,
      flowState: upbitOrderFlow.state,
    });
    return;
  }

  const feedbackAttempt = {
    ...pendingAttempt,
    feedbackShownAt: new Date().toISOString(),
  };
  pendingAttempt.feedbackShownAt = feedbackAttempt.feedbackShownAt;
  rememberSettledAttempt(feedbackAttempt.attemptId);
  activeTradeFeedback = feedbackAttempt;
  const previousFlowState = upbitOrderFlow.state;
  upbitOrderFlow = {
    ...upbitOrderFlow,
    state: "FEEDBACK_SHOWN",
    attemptId: feedbackAttempt.attemptId,
  };
  setPanelFeedbackActive(true);
  setPanelWarningActive(false);
  clearActiveGuardrailResult();
  setAnalysisStatus(
    "이번 거래는 어떤 거래였나요?",
    "feedback",
    null,
    "거래 피드백",
  );
  emitUpbitFlowDebug("UPBIT_FEEDBACK_SHOWN", {
    attemptId: feedbackAttempt.attemptId,
    market: feedbackAttempt.snapshot?.market,
    side: feedbackAttempt.snapshot?.side,
    orderMode: feedbackAttempt.snapshot?.orderMode,
    intentPrice: feedbackAttempt.snapshot?.intentPrice,
    intentQuantity: feedbackAttempt.snapshot?.intentQuantity,
    intentAmount: feedbackAttempt.snapshot?.intentAmount,
    previousFlowState,
    nextFlowState: "FEEDBACK_SHOWN",
    flowState: "FEEDBACK_SHOWN",
    source,
  });
  if (source === "UPBIT_CONFIRM_CLICK") {
    emitUpbitFlowDebug("UPBIT_FEEDBACK_SHOWN_AFTER_CONFIRM_CLICK", {
      attemptId: feedbackAttempt.attemptId,
      market: feedbackAttempt.snapshot?.market,
      side: feedbackAttempt.snapshot?.side,
      orderMode: feedbackAttempt.snapshot?.orderMode,
      intentPrice: feedbackAttempt.snapshot?.intentPrice,
      intentQuantity: feedbackAttempt.snapshot?.intentQuantity,
      intentAmount: feedbackAttempt.snapshot?.intentAmount,
      previousFlowState,
      nextFlowState: "FEEDBACK_SHOWN",
      flowState: "FEEDBACK_SHOWN",
      source,
    });
  }

  const panel = document.getElementById(PANEL_ID);
  if (panel) {
    setPanelCollapsed(panel, false);
  }
}

function ensurePendingAttemptForConfirmedOrder(orderButton, options = {}) {
  if (pendingAttempt?.attemptId) {
    return pendingAttempt;
  }

  unlockFeedbackCompletedVisualStateForNewAttempt();
  const rawSnapshot = buildOrderContextSnapshot(
    orderButton,
    "ORDER_INTENT_CLICK",
    options,
  );
  validateSnapshotSourceConsistency(rawSnapshot);
  const snapshotWithCache = mergeCachedSnapshotsIntoOrderContext(rawSnapshot);
  const { snapshot, result } =
    evaluatePageGuardrailRulesForSnapshot(snapshotWithCache);

  emitOrderContextSnapshotDebug(snapshot);
  lastOrderIntent = {
    attemptId: snapshot.attemptId,
    market: snapshot.market,
    side: snapshot.side,
    orderMode: snapshot.orderMode,
    intentPrice: snapshot.intentPrice,
    intentQuantity: snapshot.intentQuantity,
    intentAmount: snapshot.intentAmount,
    valid: snapshot.valid,
  };
  lastOrderContextSnapshot = snapshot;
  debugUpbitOrder("ORDER_INTENT_CLICK", {
    attemptId: snapshot.attemptId,
    dto: lastOrderIntent,
    rawOrderData: options.draft || null,
    extraction: lastExtractionResult,
    orderContextSnapshot: snapshot,
    ruleEvaluation: result?.ruleEvaluation || lastRuleEvaluation,
    matchedRules: result?.ruleEvaluation?.matchedRules || [],
    primaryRule: result?.ruleEvaluation?.primaryRule || null,
  });
  pendingAttempt = {
    attemptId: snapshot.attemptId,
    snapshot,
    snapshotEmitted: true,
    feedbackShownAt: null,
    feedbackRespondedAt: null,
  };
  emitOrderContextSnapshot(snapshot, result);
  return pendingAttempt;
}

function notifyOrderActionDetectedForConfirmedOrder(orderButton, options = {}) {
  const orderPanel = options.formRoot || findOrderPanel(orderButton);
  const orderDraft = withAuthoritativeOrderMarket(
    options.orderDraft ||
      readOrderDraft(orderButton) ||
      pendingAttempt?.snapshot?.currentOrder ||
      null,
  );
  const behaviorData = getBehaviorData();

  if (orderDraft) {
    behaviorState.lastOrder = orderDraft;
  }
  behaviorState.lastOrderBehavior = behaviorData;
  behaviorState.lastOrderAt = Date.now();
  behaviorState.lastOrderSessionId = behaviorState.sessionId;

  const backgroundMessagePayload = {
    market: behaviorState.market,
    sessionId: behaviorState.sessionId,
    pageUrl: location.href,
    currentOrder: orderDraft,
    behaviorData,
    orderContextSnapshot: pendingAttempt?.snapshot || null,
    demoData: getActiveDemoData(),
    refreshAlreadyRequested: true,
  };
  emitUpbitFlowDebug("UPBIT_ORDER_ACTION_DETECTED_SENT", {
    attemptId: pendingAttempt?.attemptId || null,
    market: backgroundMessagePayload.market,
    side: pendingAttempt?.snapshot?.side || null,
    orderMode: pendingAttempt?.snapshot?.orderMode || null,
    intentPrice: pendingAttempt?.snapshot?.intentPrice || null,
    intentQuantity: pendingAttempt?.snapshot?.intentQuantity || null,
    intentAmount: pendingAttempt?.snapshot?.intentAmount || null,
    backgroundMessagePayload,
  });
  debugUpbitOrder("ORDER_ACTION_DETECTED", {
    attemptId: pendingAttempt?.attemptId || null,
    orderIntentDto: lastOrderIntent,
    attemptLogDto: pendingAttempt,
    orderContextSnapshot: pendingAttempt?.snapshot || null,
    marketSnapshot: lastDtoSnapshot?.market || null,
    personalSnapshot: lastDtoSnapshot?.personal || null,
    ruleEvaluation: lastRuleEvaluation,
    matchedRules: lastRuleEvaluation?.matchedRules || [],
    primaryRule: lastRuleEvaluation?.primaryRule || null,
    backgroundMessagePayload,
  });

  safeRuntimeSendMessage({
      type: "ORDER_ACTION_DETECTED",
      payload: backgroundMessagePayload,
    })
    .then((response) => {
      if (!response?.ok && response?.error && !activeTradeFeedback) {
        setAnalysisStatus(response.error, "error");
      }
    });

  startNewOrderSession();
  syncOrderType(orderPanel, false);
}

function scanAndHandleUpbitOrderModal(options = {}) {
  if (!isUpbitExchangePage()) {
    return false;
  }

  const modalRoot = options.modalRoot || findActiveUpbitOrderModal();

  if (!modalRoot) {
    return false;
  }

  const classification =
    options.classification || classifyUpbitModal(modalRoot);
  emitUpbitFlowDebug("UPBIT_MODAL_MUTATION_DETECTED", {
    ...classification,
    modalRoot,
    source: options.source || null,
  });
  emitUpbitFlowDebug("UPBIT_MODAL_CLASSIFIED", {
    ...classification,
    modalRoot,
    source: options.source || null,
  });

  if (classification.classification === "CONFIRM") {
    const confirmButton = findOrderConfirmButtonInModal(modalRoot);

    if (!confirmButton) {
      emitUpbitOrderCaptureSkipped("button_text_not_confirm", {
        ...classification,
        modalRoot,
        source: options.source || null,
        reason: "confirm_modal_missing_confirm_button",
      });
      return false;
    }

    if (options.source === "FORM_SUBMIT_POLLING") {
      debugUpbitOrder("UPBIT_CONFIRM_MODAL_EARLY_DETECTED", {
        attemptId: options.attemptId || upbitOrderFlow.attemptId || null,
        source: options.source,
        tickCount: options.tickCount ?? null,
        detectionLagMs: options.detectionLagMs ?? null,
        modalTextPreview: classification.modalTextPreview,
        modalButtonTexts: classification.modalButtonTexts,
      });
    }

    handleUpbitConfirmModalOpen(confirmButton, modalRoot, {
      attemptId: options.attemptId || upbitOrderFlow.attemptId || null,
      source: options.source || "MODAL_SCAN",
      classification,
    });
    return true;
  }

  if (classification.classification === "VALIDATION") {
    handleUpbitValidationModalOpen({
      attemptId: options.attemptId || upbitOrderFlow.attemptId || null,
      modalRoot,
      classification,
      source: options.source || "MODAL_SCAN",
    });
    return true;
  }

  if (classification.classification === "COMPLETION") {
    handleUpbitCompletionModalOpen({
      attemptId: options.attemptId || upbitOrderFlow.attemptId || null,
      modalRoot,
      classification,
      source: options.source || "MODAL_SCAN",
    });
    return true;
  }

  return false;
}

function stopUpbitConfirmModalWaitLoop(reason = "stopped") {
  if (upbitConfirmModalWaitTimerId !== null) {
    window.clearTimeout?.(upbitConfirmModalWaitTimerId);
  }

  if (upbitConfirmModalWaitContext) {
    debugUpbitOrder("UPBIT_CONFIRM_MODAL_WAIT_STOPPED", {
      attemptId: upbitConfirmModalWaitContext.attemptId,
      reason,
    });
  }

  upbitConfirmModalWaitTimerId = null;
  upbitConfirmModalWaitContext = null;
}

function startUpbitConfirmModalWaitLoop(context = {}) {
  stopUpbitConfirmModalWaitLoop("restart");

  const startedAt = Date.now();
  const waitContext = {
    ...context,
    startedAt,
  };
  upbitConfirmModalWaitContext = waitContext;

  debugUpbitOrder("UPBIT_CONFIRM_MODAL_WAIT_STARTED", {
    attemptId: context.attemptId,
    market: context.market,
    side: context.side,
    orderMode: context.orderMode,
    source: context.source,
    startedAt: new Date(startedAt).toISOString(),
  });

  let tickCount = 0;

  const tick = () => {
    tickCount += 1;

    if (upbitConfirmModalWaitContext !== waitContext) {
      return;
    }

    if (
      !pendingAttempt?.attemptId ||
      pendingAttempt.attemptId !== context.attemptId
    ) {
      debugUpbitOrder("UPBIT_CONFIRM_MODAL_WAIT_STOPPED", {
        attemptId: context.attemptId,
        reason: "STALE_ATTEMPT",
        tickCount,
      });
      upbitConfirmModalWaitTimerId = null;
      upbitConfirmModalWaitContext = null;
      return;
    }

    const handled = scanAndHandleUpbitOrderModal({
      attemptId: context.attemptId,
      source: "FORM_SUBMIT_POLLING",
      tickCount,
      detectionLagMs: Date.now() - startedAt,
    });

    if (handled) {
      upbitConfirmModalWaitTimerId = null;
      upbitConfirmModalWaitContext = null;
      return;
    }

    if (Date.now() - startedAt >= UPBIT_CONFIRM_MODAL_WAIT_TIMEOUT_MS) {
      debugUpbitOrder("UPBIT_CONFIRM_MODAL_WAIT_TIMEOUT", {
        attemptId: context.attemptId,
        elapsedMs: Date.now() - startedAt,
        tickCount,
      });
      upbitConfirmModalWaitTimerId = null;
      upbitConfirmModalWaitContext = null;
      return;
    }

    upbitConfirmModalWaitTimerId = window.setTimeout(
      tick,
      UPBIT_CONFIRM_MODAL_POLL_INTERVAL_MS,
    );
  };

  upbitConfirmModalWaitTimerId = window.setTimeout(tick, 0);
}

function scheduleUpbitConfirmModalRafScans(context = {}) {
  if (typeof window.requestAnimationFrame !== "function") {
    return;
  }

  window.requestAnimationFrame(() => {
    scanAndHandleUpbitOrderModal({
      attemptId: context.attemptId,
      source: "FORM_SUBMIT_RAF_1",
    });

    window.requestAnimationFrame(() => {
      scanAndHandleUpbitOrderModal({
        attemptId: context.attemptId,
        source: "FORM_SUBMIT_RAF_2",
      });
    });
  });
}

function handleUpbitConfirmModalOpen(orderButton, modalRoot = null, options = {}) {
  const previousFlowState = upbitOrderFlow.state;
  const formRoot = upbitOrderFlow.formRoot || findOrderPanel(orderButton);
  const normalizedOpenedAt =
    upbitOrderFlow.modalOpenedAtRounded ||
    Math.floor(Date.now() / 1000) * 1000;
  const intent = collectUpbitOrderIntent({
    button: orderButton,
    formRoot,
    modalRoot,
  });
  const reusablePendingAttemptId = pendingAttempt?.feedbackRespondedAt
    ? null
    : pendingAttempt?.attemptId;
  const attemptId =
    options.attemptId ||
    upbitOrderFlow.attemptId ||
    reusablePendingAttemptId ||
    createUuid();
  const confirmKey = buildUpbitConfirmKey(intent, normalizedOpenedAt);
  const buttonText = normalizeButtonText(orderButton);
  const source = options.source || "MODAL_OBSERVER";
  const commonDebugFields = {
    ...intent,
    attemptId,
    buttonText,
    clickedElementText: buttonText,
    modalRoot,
    confirmKey,
    previousFlowState,
    source,
  };

  if (!formRoot) {
    emitUpbitOrderCaptureSkipped("missing_form_root", commonDebugFields);
  }

  if (!intent.market) {
    emitUpbitOrderCaptureSkipped("missing_market", commonDebugFields);
    return;
  }

  if (!intent.side) {
    emitUpbitOrderCaptureSkipped("missing_side", commonDebugFields);
    return;
  }

  if (!intent.orderMode || intent.orderMode === "UNKNOWN") {
    emitUpbitOrderCaptureSkipped("missing_order_mode", commonDebugFields);
    return;
  }

  if (
    intent.side === "BUY" &&
    intent.orderMode === "MARKET" &&
    intent.intentAmount === null
  ) {
    emitUpbitOrderCaptureSkipped(
      "missing_intent_amount_for_market_buy",
      commonDebugFields,
    );
    return;
  }

  if (
    upbitOrderFlow.intentCaptured &&
    upbitOrderFlow.confirmKey === confirmKey &&
    pendingAttempt?.attemptId === attemptId
  ) {
    if (pendingAttempt.warningAppliedAt) {
      debugUpbitOrder("UPBIT_CONFIRM_MODAL_DUPLICATE_SKIPPED", {
        ...commonDebugFields,
        flowState: upbitOrderFlow.state,
        warningAppliedAt: pendingAttempt.warningAppliedAt,
      });
      emitUpbitOrderCaptureSkipped("duplicate_confirm_key", {
        ...commonDebugFields,
        flowState: upbitOrderFlow.state,
      });
      return pendingAttempt;
    }

    debugUpbitOrder("UPBIT_CONFIRM_MODAL_DUPLICATE_SKIPPED", {
      ...commonDebugFields,
      flowState: upbitOrderFlow.state,
      reason: "duplicate_without_warning_reapplying",
    });
  }

  upbitOrderFlow = {
    ...upbitOrderFlow,
    state: "CONFIRM_MODAL_OPEN",
    attemptId,
    formRoot,
    modalRoot,
    modalOpenedAtRounded: normalizedOpenedAt,
    confirmKey,
    ...intent,
  };

  emitUpbitFlowDebug("UPBIT_CONFIRM_MODAL_OPEN", {
    ...commonDebugFields,
    nextFlowState: "CONFIRM_MODAL_OPEN",
  });

  const rawSnapshotOptions = {
    attemptId,
    formRoot,
    draft: null,
    guardrailSource: source === "CONFIRM_CLICK_HANDLER"
      ? "CONFIRM_CLICK_HANDLER"
      : "UPBIT_CONFIRM_MODAL_OPEN",
    renderMode: "WARNING_ONLY",
    ...intent,
  };
  const warningShown = beginOrderAttempt(orderButton, rawSnapshotOptions);
  const nextFlowState = warningShown
    ? "GUARDRAIL_SHOWN"
    : "CONFIRM_MODAL_OPEN";
  upbitOrderFlow = {
    ...upbitOrderFlow,
    state: nextFlowState,
    intentCaptured: true,
  };

  emitUpbitFlowDebug("UPBIT_CONFIRM_ORDER_INTENT_CAPTURED", {
    ...commonDebugFields,
    flowState: upbitOrderFlow.state,
    nextFlowState,
    snapshotId: pendingAttempt?.snapshot?.snapshotId || null,
  });
  stopUpbitConfirmModalWaitLoop("handled_confirm_modal");

  sendSnapshotRefreshMessage(
    "ORDER_CONFIRM_MODAL",
    pendingAttempt?.snapshot?.market || behaviorState?.market,
  );
  return pendingAttempt;
}

function handleUpbitOrderConfirmClick(orderButton, modalRoot = null) {
  const modal = modalRoot || findUpbitModalRoot(orderButton);
  let openedAttempt = pendingAttempt?.snapshot ? pendingAttempt : null;
  const modalClassification = modal ? classifyUpbitModal(modal, orderButton) : null;
  const wasLateConfirmModalOpen = !openedAttempt;
  const hadPriorWarningBeforeConfirmClick = Boolean(
    pendingAttempt?.warningAppliedAt,
  );

  if (wasLateConfirmModalOpen) {
    debugUpbitOrder("UPBIT_CONFIRM_MODAL_LATE_DETECTED_ON_CONFIRM_CLICK", {
      attemptId: upbitOrderFlow.attemptId || pendingAttempt?.attemptId || null,
      source: "CONFIRM_CLICK_HANDLER",
      hasPendingAttempt: Boolean(pendingAttempt),
      hasSnapshot: Boolean(pendingAttempt?.snapshot),
      warningAppliedAt: pendingAttempt?.warningAppliedAt ?? null,
      modalTextPreview: modalClassification?.modalTextPreview ||
        getModalTextPreview(modal),
      modalButtonTexts:
        modalClassification?.modalButtonTexts || getModalButtonTexts(modal),
    });
    openedAttempt = handleUpbitConfirmModalOpen(orderButton, modal, {
      attemptId: upbitOrderFlow.attemptId || pendingAttempt?.attemptId || null,
      source: "CONFIRM_CLICK_HANDLER",
      classification: modalClassification,
    });
  }
  const buttonText = normalizeButtonText(orderButton);
  const attemptId =
    openedAttempt?.attemptId || upbitOrderFlow.attemptId || createUuid();
  const confirmClickedAt = new Date().toISOString();
  const confirmKey =
    upbitOrderFlow.confirmKey ||
    buildUpbitConfirmKey(
      collectUpbitOrderIntent({
        button: orderButton,
        formRoot: upbitOrderFlow.formRoot || findOrderPanel(orderButton),
        modalRoot: modal,
      }),
      upbitOrderFlow.modalOpenedAtRounded ||
        Math.floor(Date.now() / 1000) * 1000,
    );

  if (!pendingAttempt?.attemptId) {
    emitUpbitOrderCaptureSkipped("missing_pending_attempt", {
      attemptId,
      buttonText,
      modalRoot: modal,
      flowState: upbitOrderFlow.state,
    });
    return;
  }

  if (!hadPriorWarningBeforeConfirmClick) {
    debugUpbitOrder("UPBIT_CONFIRM_CLICK_WITHOUT_PRIOR_WARNING", {
      attemptId,
      modalTextPreview: modalClassification?.modalTextPreview ||
        getModalTextPreview(modal),
      modalButtonTexts:
        modalClassification?.modalButtonTexts || getModalButtonTexts(modal),
      hasSnapshot: Boolean(pendingAttempt?.snapshot),
      hasRuleEvaluation: Boolean(lastRuleEvaluation),
      warningAppliedAt: pendingAttempt?.warningAppliedAt ?? null,
    });
  }

  if (pendingAttempt.confirmClickedAt || handledUpbitConfirmKeys.has(confirmKey)) {
    emitUpbitOrderCaptureSkipped("duplicate_confirm_key", {
      attemptId,
      buttonText,
      modalRoot: modal,
      confirmKey,
      flowState: upbitOrderFlow.state,
    });
    emitUpbitFlowDebug("UPBIT_CONFIRM_BUTTON_CLICKED", {
      attemptId,
      buttonText,
      clickedElementText: buttonText,
      modalRoot: modal,
      confirmKey,
      ignored: true,
      reason: "duplicate_confirm_key",
    });
    return;
  }

  const previousFlowState = upbitOrderFlow.state;
  pendingAttempt.confirmClickedAt = confirmClickedAt;
  const warningLeadTimeMs = pendingAttempt.warningAppliedAt
    ? Date.now() - Date.parse(pendingAttempt.warningAppliedAt)
    : null;
  upbitOrderFlow = {
    ...upbitOrderFlow,
    state: "CONFIRM_CLICKED",
    attemptId,
    confirmKey,
  };
  rememberUpbitConfirmKey(confirmKey);

  emitUpbitFlowDebug("UPBIT_CONFIRM_BUTTON_CLICKED", {
    attemptId,
    market: pendingAttempt.snapshot?.market,
    side: pendingAttempt.snapshot?.side,
    orderMode: pendingAttempt.snapshot?.orderMode,
    intentPrice: pendingAttempt.snapshot?.intentPrice,
    intentQuantity: pendingAttempt.snapshot?.intentQuantity,
    intentAmount: pendingAttempt.snapshot?.intentAmount,
    buttonText,
    clickedElementText: buttonText,
    modalRoot: modal,
    confirmKey,
    previousFlowState,
    nextFlowState: "CONFIRM_CLICKED",
    warningAppliedAt: pendingAttempt.warningAppliedAt ?? null,
    warningLeadTimeMs,
    warningWasVisibleBeforeConfirmClick:
      typeof warningLeadTimeMs === "number" && warningLeadTimeMs >= 300,
  });

  notifyOrderActionDetectedForConfirmedOrder(orderButton, {
    formRoot: upbitOrderFlow.formRoot || findOrderPanel(orderButton),
    orderDraft: createOrderDraftFromSnapshot(pendingAttempt?.snapshot),
  });
  debugUpbitOrder("UPBIT_FEEDBACK_REQUESTED_AFTER_CONFIRM_CLICK", {
    attemptId,
    warningAppliedAt: pendingAttempt.warningAppliedAt ?? null,
    warningLeadTimeMs,
    activeViewBeforeFeedback: getActivePanelView(),
    source: "UPBIT_CONFIRM_CLICK",
  });
  showTradeFeedback({ source: "UPBIT_CONFIRM_CLICK" });
}

function handleUpbitInitialOrderFormClick(orderButton) {
  const previousFlowState = upbitOrderFlow.state;
  const formRoot = findOrderPanel(orderButton);

  if (!formRoot) {
    emitUpbitOrderCaptureSkipped("missing_form_root", {
      buttonText: normalizeButtonText(orderButton),
      clickedElementText: normalizeButtonText(orderButton),
      previousFlowState,
    });
    return false;
  }

  const buttonText = normalizeButtonText(orderButton);
  const side = buttonText === "매수" ? "BUY" : "SELL";
  const orderMode =
    detectOrderType(formRoot, orderButton) ||
    detectOrderTypeFromText(normalizedText(formRoot)) ||
    null;
  const attemptId = createUuid();

  rememberSettledAttempt(upbitOrderFlow.attemptId);
  rememberSettledAttempt(pendingAttempt?.attemptId);
  pendingAttempt = {
    attemptId,
    snapshot: null,
    snapshotEmitted: true,
    guardrailShownAt: null,
    warningAppliedAt: null,
    confirmClickedAt: null,
    feedbackShownAt: null,
    feedbackRespondedAt: null,
  };
  upbitOrderFlow = {
    ...createIdleUpbitOrderFlow(),
    state: "FORM_SUBMIT_CLICKED",
    attemptId,
    formRoot,
    market: behaviorState?.market || parseMarket(location.href),
    side,
    orderMode,
  };

  emitUpbitFlowDebug("UPBIT_FORM_SUBMIT_CLICKED", {
    attemptId,
    market: upbitOrderFlow.market,
    side,
    orderMode,
    buttonText,
    clickedElementText: buttonText,
    previousFlowState,
    nextFlowState: "FORM_SUBMIT_CLICKED",
    flowState: upbitOrderFlow.state,
  });
  setAnalysisStatus("주문 확인 팝업을 확인하고 있어요.", "loading");
  startUpbitConfirmModalWaitLoop({
    attemptId,
    market: upbitOrderFlow.market,
    side,
    orderMode,
    source: "FORM_SUBMIT_CLICKED",
    startedAt: Date.now(),
  });
  scheduleUpbitConfirmModalRafScans({
    attemptId,
    market: upbitOrderFlow.market,
    side,
    orderMode,
  });
  return true;
}

function handleUpbitValidationModalAck(button, modalRoot) {
  const previousFlowState = upbitOrderFlow.state;
  const buttonText = normalizeButtonText(button);
  const modalSide =
    upbitOrderFlow.side || detectOrderSideFromConfirmText(normalizedText(modalRoot));
  const orderMode =
    upbitOrderFlow.orderMode || detectOrderTypeFromText(normalizedText(modalRoot));
  const attemptId = upbitOrderFlow.attemptId || createUuid();
  const market =
    upbitOrderFlow.market || behaviorState?.market || parseMarket(location.href);

  upbitOrderFlow = {
    ...upbitOrderFlow,
    state: "VALIDATION_MODAL_OPEN",
    attemptId,
    modalRoot,
    market,
    side: modalSide,
    orderMode,
  };

  emitUpbitFlowDebug("UPBIT_VALIDATION_MODAL_OPEN", {
    attemptId,
    market,
    side: modalSide,
    orderMode,
    buttonText,
    clickedElementText: buttonText,
    modalRoot,
    previousFlowState,
    nextFlowState: "VALIDATION_MODAL_OPEN",
    reason: "validation_or_insufficient_balance",
  });
  emitUpbitFlowDebug("UPBIT_VALIDATION_MODAL_ACK", {
    attemptId,
    market,
    side: modalSide,
    orderMode,
    buttonText,
    clickedElementText: buttonText,
    modalRoot,
    previousFlowState: "VALIDATION_MODAL_OPEN",
    nextFlowState: "SETTLED",
    reason: "validation_or_insufficient_balance",
  });
  debugUpbitOrder("UPBIT_FEEDBACK_SKIPPED_VALIDATION_MODAL", {
    attemptId,
    market,
    side: modalSide,
    orderMode,
    buttonText,
    clickedElementText: buttonText,
    reason: "validation_modal",
    flowState: "VALIDATION_MODAL_OPEN",
  });
  emitUpbitOrderCaptureSkipped("validation_modal", {
    attemptId,
    market,
    side: modalSide,
    orderMode,
    buttonText,
    clickedElementText: buttonText,
    modalRoot,
    previousFlowState: "VALIDATION_MODAL_OPEN",
  });

  rememberSettledAttempt(attemptId);
  upbitOrderFlow = {
    ...upbitOrderFlow,
    state: "SETTLED",
  };
  emitUpbitFlowDebug("UPBIT_ORDER_FLOW_SETTLED", {
    attemptId,
    market,
    side: modalSide,
    orderMode,
    buttonText,
    modalRoot,
    reason: "validation_or_insufficient_balance",
  });
  pendingAttempt = null;
  resetUpbitOrderFlow();
}

function handleUpbitOrderCompletionAck(button, modalRoot) {
  const previousFlowState = upbitOrderFlow.state;
  const buttonText = normalizeButtonText(button);
  const attemptId =
    upbitOrderFlow.attemptId || pendingAttempt?.attemptId ||
    activeTradeFeedback?.attemptId || null;
  const market =
    upbitOrderFlow.market || pendingAttempt?.snapshot?.market ||
    behaviorState?.market || parseMarket(location.href);
  const side = upbitOrderFlow.side || pendingAttempt?.snapshot?.side || null;
  const orderMode =
    upbitOrderFlow.orderMode || pendingAttempt?.snapshot?.orderMode || null;

  upbitOrderFlow = {
    ...upbitOrderFlow,
    state: "ORDER_COMPLETION_MODAL_OPEN",
    attemptId,
    modalRoot,
    market,
    side,
    orderMode,
  };
  emitUpbitFlowDebug("UPBIT_ORDER_COMPLETION_MODAL_OPEN", {
    attemptId,
    market,
    side,
    orderMode,
    buttonText,
    clickedElementText: buttonText,
    modalRoot,
    previousFlowState,
    nextFlowState: "ORDER_COMPLETION_MODAL_OPEN",
  });
  emitUpbitFlowDebug("UPBIT_ORDER_COMPLETION_ACK", {
    attemptId,
    market,
    side,
    orderMode,
    buttonText,
    clickedElementText: buttonText,
    modalRoot,
    previousFlowState: "ORDER_COMPLETION_MODAL_OPEN",
    nextFlowState: "SETTLED",
  });
  debugUpbitOrder("UPBIT_FEEDBACK_SKIPPED_COMPLETION_MODAL", {
    attemptId,
    market,
    side,
    orderMode,
    buttonText,
    clickedElementText: buttonText,
    reason: "completion_modal",
    flowState: "ORDER_COMPLETION_MODAL_OPEN",
  });
  emitUpbitOrderCaptureSkipped("completion_modal", {
    attemptId,
    market,
    side,
    orderMode,
    buttonText,
    clickedElementText: buttonText,
    modalRoot,
    previousFlowState: "ORDER_COMPLETION_MODAL_OPEN",
  });

  rememberSettledAttempt(attemptId);
  upbitOrderFlow = {
    ...upbitOrderFlow,
    state: "SETTLED",
  };
  emitUpbitFlowDebug("UPBIT_ORDER_FLOW_SETTLED", {
    attemptId,
    market,
    side,
    orderMode,
    buttonText,
    modalRoot,
    reason: "order_completion_ack",
  });
}

function handleUpbitDomClick(event) {
  if (!isUpbitExchangePage() || !(event.target instanceof Element)) {
    return false;
  }

  const button = event.target.closest(ORDER_ACTION_BUTTON_SELECTOR);

  if (!button || button.closest(`#${PANEL_ID}`)) {
    return false;
  }

  const modalRoot = findUpbitModalRoot(button);

  if (modalRoot) {
    const modalClassification = classifyUpbitModal(modalRoot, button);
    emitUpbitFlowDebug("UPBIT_MODAL_MUTATION_DETECTED", {
      ...modalClassification,
      modalRoot,
      clickedElementText: normalizeButtonText(button),
    });
    emitUpbitFlowDebug("UPBIT_MODAL_CLASSIFIED", {
      ...modalClassification,
      modalRoot,
      clickedElementText: normalizeButtonText(button),
    });

    if (isOrderConfirmButton(button)) {
      handleUpbitOrderConfirmClick(button, modalRoot);
      return true;
    }

    if (isGenericOkButton(button)) {
      const isValidationAck =
        modalHasOnlyGenericOkButton(modalRoot, button) &&
        !upbitOrderFlow.intentCaptured &&
        ["IDLE", "FORM_SUBMIT_CLICKED", "VALIDATION_MODAL_OPEN"].includes(
          upbitOrderFlow.state,
        );

      if (
        isValidationAck
      ) {
        emitUpbitOrderCaptureSkipped("generic_ok_button", {
          buttonText: normalizeButtonText(button),
          clickedElementText: normalizeButtonText(button),
          modalRoot,
          reason: "validation_modal",
        });
        handleUpbitValidationModalAck(button, modalRoot);
      } else {
        emitUpbitOrderCaptureSkipped("generic_ok_button", {
          buttonText: normalizeButtonText(button),
          clickedElementText: normalizeButtonText(button),
          modalRoot,
          reason: "completion_modal",
        });
        handleUpbitOrderCompletionAck(button, modalRoot);
      }
      return true;
    }

    emitUpbitOrderCaptureSkipped("button_text_not_confirm", {
      buttonText: normalizeButtonText(button),
      clickedElementText: normalizeButtonText(button),
      modalRoot,
    });
    return ["닫기", "취소"].includes(normalizeButtonText(button));
  }

  if (
    isInitialOrderFormButton(button) &&
    button.getAttribute("role") !== "tab" &&
    !button.closest("[role='tablist']")
  ) {
    return handleUpbitInitialOrderFormClick(button);
  }

  if (/확인|매수|매도/.test(normalizeButtonText(button))) {
    emitUpbitOrderCaptureSkipped("missing_modal_root", {
      buttonText: normalizeButtonText(button),
      clickedElementText: normalizeButtonText(button),
    });
  }

  return false;
}

function startUpbitModalObserver() {
  if (
    upbitModalObserver ||
    !isRealUpbitExchangePage() ||
    typeof MutationObserver !== "function" ||
    !document.body
  ) {
    return;
  }

  upbitModalObserver = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (
        mutation.type === "attributes" &&
        mutation.target instanceof Element
      ) {
        const modalRoot = mutation.target.matches?.(UPBIT_ORDER_DIALOG_SELECTOR)
          ? mutation.target
          : mutation.target.closest?.(UPBIT_ORDER_DIALOG_SELECTOR);

        if (modalRoot) {
          scanAndHandleUpbitOrderModal({
            modalRoot,
            source: "MUTATION_OBSERVER_ATTRIBUTES",
          });
          continue;
        }
      }

      for (const node of mutation.addedNodes || []) {
        if (!(node instanceof Element)) {
          continue;
        }

        const modalRoot =
          node.matches?.(UPBIT_ORDER_DIALOG_SELECTOR)
            ? node
            : node.querySelector?.(UPBIT_ORDER_DIALOG_SELECTOR);

        if (!modalRoot) {
          continue;
        }

        scanAndHandleUpbitOrderModal({
          modalRoot,
          source: "MUTATION_OBSERVER_CHILD_LIST",
        });
      }
    }
  });
  upbitModalObserver.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: [
      "style",
      "class",
      "aria-hidden",
      "hidden",
      "data-state",
      "data-open",
    ],
  });
}

function stopUpbitModalObserver() {
  upbitModalObserver?.disconnect?.();
  upbitModalObserver = null;
}

function handleDemoContext(event) {
  if (!isDemoPage()) return;
  acknowledgePageEvent(event);
}

function handleDemoOrderEvent(event) {
  if (!isDemoPage()) return;
  acknowledgePageEvent(event);
  applyDemoOverrideState(event.detail || {}, "demo-order-event");
}

function handleDemoBridgeEvent(event) {
  if (!isDemoPage()) return;
  const detail = event.detail || {};
  if (detail.source && detail.source !== SALTBREAD_DEMO_PAGE_SOURCE) {
    return;
  }
  emitDemoBridgeDebug("DEMO_BRIDGE_MESSAGE_RECEIVED", {
    type: detail.type || null,
    source: "custom-event",
    market: detail.payload?.market || detail.market || null,
    hasPayload: Boolean(detail.payload || detail),
  });
  applyDemoOverrideState(detail, "demo-custom-event");
}

function handleDemoBridgeMessage(event) {
  if (!isDemoPage()) return;
  if (event.source && event.source !== window) return;

  const data = event.data || {};
  if (data.source !== SALTBREAD_DEMO_PAGE_SOURCE) {
    return;
  }

  if (
    ![
      "DEMO_STATE",
      "DEMO_STATE_SYNC",
      "DEMO_MARKET_SNAPSHOT",
      "MARKET_SNAPSHOT",
      "DEMO_PERSONAL_SNAPSHOT",
      "ACCOUNT_SNAPSHOT",
      "DEMO_ORDER_CREATED",
      "ORDER_CREATED",
      "ORDER_UPDATED",
      "ORDER_INTENT_CLICK",
    ].includes(data.type)
  ) {
    return;
  }

  emitDemoBridgeDebug("DEMO_BRIDGE_MESSAGE_RECEIVED", {
    type: data.type,
    source: "postMessage",
    market: data.payload?.market || data.state?.market || null,
    hasPayload: Boolean(data.payload || data.state),
  });
  if (data.type === "DEMO_STATE_SYNC") {
    emitDemoBridgeDebug("DEMO_STATE_SYNC_RECEIVED", {
      type: data.type,
      source: "postMessage",
      market: data.payload?.market || null,
      hasPayload: Boolean(data.payload),
      hasMarketSnapshot: Boolean(data.payload?.marketSnapshot),
      hasPersonalSnapshot: Boolean(data.payload?.accountSnapshot),
      accountCount: data.payload?.accountSnapshot?.accounts?.length || 0,
      orderCount: data.payload?.orders?.length || 0,
    });
  }
  applyDemoOverrideState(data, `postMessage:${data.type}`);
}

function requestDemoStateSync() {
  if (!isDemoPage()) return;

  try {
    window.postMessage(
      {
        source: SALTBREAD_EXTENSION_SOURCE,
        type: SALTBREAD_DEMO_STATE_REQUEST,
      },
      "*",
    );
  } catch {}
}

function hydrateDemoStateFromPageGlobal() {
  if (!isDemoPage()) return;

  try {
    const state = window.__SALTBREAD_DEMO_STATE__;
    if (state && typeof state === "object") {
      applyDemoOverrideState(state, "window.__SALTBREAD_DEMO_STATE__");
    }
  } catch {
    // Content scripts may run in an isolated world; postMessage/custom events cover that case.
  }
}

function handleDocumentClick(event) {
  if (!behaviorState) {
    return;
  }

  if (handleUpbitDomClick(event)) {
    return;
  }

  const upbitConfirmButton = isDemoPage()
    ? null
    : findUpbitOrderConfirmButton(event.target);
  if (upbitConfirmButton) {
    try {
      handleUpbitOrderConfirmClick(upbitConfirmButton);
      return;
    } catch (error) {
      console.error("[Saltbread] Failed to capture Upbit confirm click", error);
      setLoggingStatus("확인 팝업 스냅샷을 만들지 못했지만 행동 로그 수집은 계속합니다.");
    }
  }

  const confirmButton = event.target instanceof Element
    ? event.target.closest("[data-saltbread-order-confirm]")
    : null;
  if (confirmButton) {
    sendSnapshotRefreshMessage("ORDER_CONFIRM_MODAL");
    showTradeFeedback();
    return;
  }

  const orderbookTarget = event.target instanceof Element
    ? event.target.closest("[data-saltbread-orderbook-price]")
    : null;
  if (orderbookTarget || isUpbitOrderbookClickTarget(event.target)) {
    behaviorState.lastOrderbookClickAt = Date.now();
    emitDetectionPipelineTrace("BEHAVIOR_UPDATED", {
      dataSource: isDemoPage() ? "DEMO" : "UPBIT",
      market: behaviorState.market,
      behaviorSnapshot: {
        orderbookClicked: true,
        lastOrderbookClickAt: behaviorState.lastOrderbookClickAt,
      },
    });
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
    emitIgnoredOrderButtonDebug(event.target);
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
  const orderDraft = withAuthoritativeOrderMarket(readOrderDraft(orderButton));

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

    if (
      pendingAttempt?.snapshot?.snapshotTrigger === "ORDER_INTENT_CLICK" &&
      ["BUY", "SELL"].includes(pendingAttempt.snapshot.side)
    ) {
      syncOrderType(orderPanel, false);
      sendSnapshotRefreshMessage(
        "ORDER_DRAFT_UNAVAILABLE",
        pendingAttempt.snapshot.market,
      );
      setAnalysisStatus(
        "주문 확인 팝업을 확인하고 있어요.",
        "loading",
      );
      return;
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

  safeRuntimeSendMessage({
      type: "ORDER_ACTION_DETECTED",
      payload: {
        market: behaviorState.market,
        sessionId: submittedSessionId,
        pageUrl: location.href,
        currentOrder: orderDraft,
        behaviorData,
        orderContextSnapshot: pendingAttempt?.snapshot || null,
        demoData: getActiveDemoData(),
        refreshAlreadyRequested: true,
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
    sendSnapshotRefreshMessage("TAB_ACTIVE_RETURN");
  }

  renderBehaviorMetrics();
}

function syncCurrentMarket() {
  if (!behaviorState) {
    return;
  }

  if (isDemoPage() && getActiveDemoOverride()) {
    const demoMarket = getDemoOverrideMarket();
    if (demoMarket) {
      behaviorState.market = demoMarket;
    }
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
  behaviorState.lastOrderbookClickAt = null;
  behaviorState.firstAmount = null;
  behaviorState.lastAmount = null;
  behaviorState.draftStartedAt = null;
  behaviorState.lastEditAt = null;
  behaviorState.draftEditCount = 0;
  behaviorState.inputRevertCount = 0;
  behaviorState.priceDirectionChangeCount = 0;
  rememberSettledAttempt(pendingAttempt?.attemptId);
  rememberSettledAttempt(activeTradeFeedback?.attemptId);
  pendingAttempt = null;
  activeDetectionResult = null;
  activeGuardrailSnapshotId = null;
  activeTradeFeedback = null;
  resetUpbitOrderFlow();
  setPanelWarningActive(false);
  setPanelFeedbackActive(false);
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
  if (!behaviorState || extensionContextInvalidated) {
    return;
  }

  getBehaviorData();
}

function setAnalysisStatus(
  message,
  state = "loading",
  type = null,
  title = null,
  detectionResult = null,
) {
  if (
    state === "detected" &&
    shouldBlockWarningOrVisualUpdate(getAttemptIdFromPayload(detectionResult))
  ) {
    return;
  }

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
      title || "설정된 가드레일 감지";
    renderDetectedStatusMessage(messageElement, message, detectionResult);
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
  const market = getAuthoritativeMarket();
  const currentOrder = withAuthoritativeOrderMarket(
    behaviorState?.lastOrder ||
      demoOverride?.currentOrder ||
      readOrderDraft() ||
      null,
    market,
  );

  return {
    market,
    sessionId:
      hasRecentOrder && behaviorState.lastOrderSessionId
        ? behaviorState.lastOrderSessionId
        : behaviorState?.sessionId,
    pageUrl: location.href,
    behaviorData,
    currentOrder,
    orderContextSnapshot: pendingAttempt?.snapshot || null,
    demoData: demoOverride?.demoData || null,
  };
}

function registerCurrentContext() {
  if (extensionContextInvalidated) {
    return;
  }

  if (isDemoPage()) {
    return;
  }

  const snapshot = getContextSnapshot();

  if (!snapshot.market) {
    setAnalysisStatus("현재 종목을 확인하고 있어요.", "loading");
    return;
  }

  safeRuntimeSendMessage({ type: "REGISTER_MARKET_CONTEXT", payload: snapshot })
    .catch(() => {});
}

function startBehaviorTracking() {
  if (behaviorState || extensionContextInvalidated) {
    return;
  }

  installUpbitDebugHelper();
  startUpbitModalObserver();
  loadLocalSnapshotCaches();

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
  document.addEventListener("saltbread:demo-state", handleDemoBridgeEvent);
  document.addEventListener("saltbread:demo-market-snapshot", handleDemoBridgeEvent);
  document.addEventListener("saltbread:demo-personal-snapshot", handleDemoBridgeEvent);
  window.addEventListener?.("saltbread:demo-bridge", handleDemoBridgeEvent);
  window.addEventListener?.("message", handleDemoBridgeMessage);
  document.addEventListener("visibilitychange", handleVisibilityChange);
  syncCurrentOrderType(false);
  behaviorTimerId = window.setInterval(() => {
    if (extensionContextInvalidated) {
      window.clearInterval(behaviorTimerId);
      behaviorTimerId = null;
      return;
    }

    syncCurrentMarket();
    syncCurrentOrderType(true);
    renderBehaviorMetrics();
  }, 1000);
  if (!extensionContextInvalidated) {
    renderBehaviorMetrics();
    hydrateDemoStateFromPageGlobal();
    requestDemoStateSync();
    registerCurrentContext();
  }
}

function stopBehaviorTracking() {
  if (!behaviorState) {
    return;
  }

  stopUpbitModalObserver();
  document.removeEventListener("input", handleAmountInput, true);
  document.removeEventListener("click", handleDocumentClick, true);
  document.removeEventListener("saltbread:demo-scenario", handleDemoScenario);
  document.removeEventListener("saltbread:detect-now", handleDetectNow);
  document.removeEventListener("saltbread:demo-reset", handleDemoReset);
  document.removeEventListener("saltbread:demo-context", handleDemoContext);
  document.removeEventListener("saltbread:demo-order-event", handleDemoOrderEvent);
  document.removeEventListener("saltbread:demo-state", handleDemoBridgeEvent);
  document.removeEventListener("saltbread:demo-market-snapshot", handleDemoBridgeEvent);
  document.removeEventListener("saltbread:demo-personal-snapshot", handleDemoBridgeEvent);
  window.removeEventListener?.("saltbread:demo-bridge", handleDemoBridgeEvent);
  window.removeEventListener?.("message", handleDemoBridgeMessage);
  document.removeEventListener("visibilitychange", handleVisibilityChange);
  for (const pending of behaviorState.pendingInputEvents.values()) {
    window.clearTimeout(pending.timerId);
  }
  window.clearInterval(behaviorTimerId);
  behaviorTimerId = null;
  behaviorState = null;
  rememberSettledAttempt(pendingAttempt?.attemptId);
  rememberSettledAttempt(activeTradeFeedback?.attemptId);
  pendingAttempt = null;
  activeDetectionResult = null;
  activeGuardrailSnapshotId = null;
  activeTradeFeedback = null;
  resetUpbitOrderFlow();
}

function syncPanel(auth) {
  if (!isDashboardPage() && canShowPanel(auth)) {
    createPanel(auth);
    return;
  }

  removePanel();
}

function hasActiveGuardrailWarning() {
  return Boolean(activeDetectionResult?.detected && activeGuardrailSnapshotId);
}

function shouldIgnoreDetectionResultForActiveWarning(result) {
  const resultAttemptId = result?.orderContextSnapshot?.attemptId;

  if (result?.detected && shouldBlockWarningOrVisualUpdate(resultAttemptId)) {
    return true;
  }

  if (shouldIgnoreIncomingAttempt(resultAttemptId)) {
    return true;
  }

  if (
    resultAttemptId &&
    pendingAttempt?.attemptId === resultAttemptId &&
    pendingAttempt.feedbackShownAt
  ) {
    return true;
  }

  if (
    resultAttemptId &&
    activeTradeFeedback?.attemptId === resultAttemptId
  ) {
    return true;
  }

  if (!hasActiveGuardrailWarning()) {
    return false;
  }

  if (!result?.detected) {
    return true;
  }

  const resultSnapshotId = result.orderContextSnapshot?.snapshotId;

  if (resultSnapshotId && resultSnapshotId !== activeGuardrailSnapshotId) {
    return true;
  }

  return Boolean(resultSnapshotId === activeGuardrailSnapshotId);
}

function refreshPanelState() {
  return safeRuntimeSendMessage({ type: "GET_AUTH_STATE" })
    .then((response) => syncPanel(response?.ok ? response.auth : null))
    .catch(() => syncPanel(null));
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (extensionContextInvalidated) {
    return false;
  }

  if (message?.type === "GET_CONTEXT_SNAPSHOT") {
    sendResponse(getContextSnapshot());
    return false;
  }

  if (message?.type === "ORDER_DATA_UPDATED" && behaviorState) {
    debugUpbitOrder("ORDER_DATA_UPDATED", {
      messageType: message.type,
      payload: message.payload,
      attemptId: pendingAttempt?.attemptId || null,
      market: message.payload?.market || behaviorState.market,
    });
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
    debugUpbitOrder("UPBIT_DETECTION_RESULT_RECEIVED", {
      messageType: message.type,
      attemptId: getAttemptIdFromPayload(result),
      market: result?.orderContextSnapshot?.market || behaviorState?.market,
      side: result?.orderContextSnapshot?.side || null,
      orderMode: result?.orderContextSnapshot?.orderMode || null,
      intentPrice: result?.orderContextSnapshot?.intentPrice || null,
      intentQuantity: result?.orderContextSnapshot?.intentQuantity || null,
      intentAmount: result?.orderContextSnapshot?.intentAmount || null,
      payload: result,
      ruleEvaluation: result?.ruleEvaluation || null,
      matchedRules: result?.ruleEvaluation?.matchedRules || [],
      primaryRule: result?.ruleEvaluation?.primaryRule || null,
    });

    if (shouldIgnoreDetectionResultForActiveWarning(result)) {
      emitUpbitOrderCaptureSkipped("stale_attempt", {
        attemptId: getAttemptIdFromPayload(result),
        reason: "stale_attempt",
      });
      return false;
    }

    if (result?.detected && result.type !== "USER_GUARDRAIL_RULE") {
      return false;
    }

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
    if (hasActiveGuardrailWarning()) {
      return false;
    }
    applyFlameTheme("default");
    setAnalysisStatus(message.payload?.message || "데이터 수집에 실패했습니다.", "error");
    return false;
  }

  if (message?.type === "BEHAVIOR_EVENT_STATUS") {
    setLoggingStatus(message.payload?.message || "");
  }

  if (message?.type === "LOG_SAVE_STATUS") {
    setLoggingStatus(message.payload?.message || "");
  }

  if (message?.type === "DEBUG_DATA_UPDATED") {
    if (
      shouldIgnoreDebugPayload(
        message.payload?.kind || "COLLECTED_DATA",
        message.payload?.data,
      )
    ) {
      return false;
    }

    emitExtensionDebug(
      message.payload?.category || "market",
      message.payload?.kind || "COLLECTED_DATA",
      message.payload?.data,
      message.payload?.occurredAt,
    );
  }

  if (message?.type === "DTO_DEBUG_SNAPSHOT") {
    if (shouldIgnoreDebugPayload("DTO_DEBUG_SNAPSHOT", message.payload)) {
      return false;
    }

    lastDtoSnapshot = message.payload;
    lastOrderContextSnapshot =
      message.payload?.orderContext || lastOrderContextSnapshot;
    lastRuleEvaluation =
      message.payload?.ruleEvaluation || lastRuleEvaluation;
    debugUpbitOrder("UPBIT_DTO_SNAPSHOT_BUILT", {
      attemptId: message.payload?.orderContext?.attemptId || null,
      attemptLogDto: pendingAttempt,
      orderContextSnapshot: message.payload?.orderContext || null,
      marketSnapshot: message.payload?.market || null,
      personalSnapshot: message.payload?.personal || null,
      ruleEvaluation: message.payload?.ruleEvaluation || null,
      matchedRules: message.payload?.ruleEvaluation?.matchedRules || [],
      primaryRule: message.payload?.ruleEvaluation?.primaryRule || null,
    });
    debugUpbitOrder("DTO_SNAPSHOT", {
      attemptId: message.payload?.orderContext?.attemptId || null,
      attemptLogDto: pendingAttempt,
      orderContextSnapshot: message.payload?.orderContext || null,
      marketSnapshot: message.payload?.market || null,
      personalSnapshot: message.payload?.personal || null,
      ruleEvaluation: message.payload?.ruleEvaluation || null,
      matchedRules: message.payload?.ruleEvaluation?.matchedRules || [],
      primaryRule: message.payload?.ruleEvaluation?.primaryRule || null,
      backgroundMessagePayload: message.payload,
    });
    console.log("[Saltbread DTO Debug]", sanitizeDebugPayload(message.payload));
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
  if (extensionContextInvalidated) {
    return;
  }

  if (areaName !== "local") {
    return;
  }

  if (changes.auth) {
    refreshPanelState();
  }

  if (changes.flameTheme) {
    const flameTheme = changes.flameTheme.newValue || {};
    const incomingMode = normalizeFlameMode(flameTheme.mode);
    const shouldSkipFlameTheme =
      incomingMode !== "DEFAULT" &&
      shouldBlockWarningOrVisualUpdate(flameTheme.attemptId || null);

    if (!shouldSkipFlameTheme && !hasActiveGuardrailWarning()) {
      applyFlameTheme(flameTheme.mode, {
        attemptId: flameTheme.attemptId || null,
      });
    }
  }

  if (changes[GUARDRAIL_RULES_CACHE_KEY]) {
    setPageGuardrailRulesState({
      ...(changes[GUARDRAIL_RULES_CACHE_KEY].newValue || {}),
      source: "cache",
    });
  }

  updateLocalSnapshotCaches(
    Object.fromEntries(
      [MARKET_SNAPSHOT_CACHE_KEY, PERSONAL_SNAPSHOT_CACHE_KEY]
        .filter((key) => changes[key])
        .map((key) => [key, changes[key].newValue]),
    ),
  );
});

installUpbitDebugHelper();
refreshPanelState();

window.setInterval(() => {
  if (location.href === currentPageUrl) {
    return;
  }

  currentPageUrl = location.href;
  refreshPanelState();
}, 500);
