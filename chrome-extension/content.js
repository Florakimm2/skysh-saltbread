const PANEL_ID = "saltbread-extension-panel";
const APP_URL = globalThis.SALTBREAD_CONFIG.appUrl;
const APP_ORIGINS = new Set([
  APP_URL,
  ...(globalThis.SALTBREAD_CONFIG.appOrigins || []),
]);
const BEHAVIOR_INPUT_DEBOUNCE_MS = 650;
const GUARDRAIL_RULES_CACHE_KEY = "guardrailRulesCache";
const MARKET_SNAPSHOT_CACHE_KEY = "marketSnapshotCache";
const PERSONAL_SNAPSHOT_CACHE_KEY = "personalSnapshotCache";
const SNAPSHOT_CACHE_MAX_AGE_MS = 2 * 60 * 1000;
const {
  buildBehaviorSnapshot,
  detectOrderActionSide,
  evaluateGuardrailRules,
  evaluateRuleExpression,
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
let cachedMarketSnapshotCache = {};
let cachedPersonalSnapshotCache = {};
let privateApiReady = false;
let extensionContextInvalidated = false;

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
  setFlameAnimationMode(collapsedPanelFlame, normalizedMode);
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

function buildConditionDescription(condition, snapshot) {
  const label = getRuleFieldLabel(condition.leftField);
  const leftValue = getRuleFieldValue(snapshot, condition.leftField);
  const rightValue = getRuleOperandValue(condition.rightOperand, snapshot);
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

function renderDetectedStatusMessage(messageElement, message, result = null) {
  const descriptions = buildMatchedRuleDescriptions(result);
  messageElement.replaceChildren();
  messageElement.append(document.createTextNode(message));

  if (descriptions.length === 0) {
    return;
  }

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
        <span class="saltbread-rule-row__title">설정된 규칙 없음</span>
        <strong class="saltbread-rule-row__mode">대기</strong>
      </article>
    `;
  }

  return userRules.map((rule) => {
    const visualMode = normalizeFlameMode(rule.visualMode);
    const title = rule.warningTitle || rule.name || "이름 없는 규칙";
    const modeLabel = VISUAL_MODE_LABELS[visualMode] || visualMode;
    const requiresPrivateApi = Boolean(rule.requiresPrivateApi);
    const isPrivateApiReady = !requiresPrivateApi || privateApiReady;
    const description = rule.description || rule.warningMessage || title;
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
        title="${escapeHtml(titleText)}"
      >
        <span class="saltbread-rule-row__title">${escapeHtml(title)}</span>
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
  safeRuntimeSendMessage({ type: "RESET_FLAME_STATE" }).catch(() => {});
  void loadPageGuardrailRules();
  void refreshPrivateApiReadyState();
  startBehaviorTracking();
}

function openDashboard() {
  safeRuntimeSendMessage({ type: "OPEN_DASHBOARD" });
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

function isUpbitOrderNoticeDialogText(text) {
  const normalized = String(text || "").replace(/\s/g, "");
  return /부족|실패|오류|거절|취소되었습니다|제한/.test(normalized);
}

function detectOrderTypeFromText(text) {
  const normalized = String(text || "").replace(/\s/g, "");

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
  const side = detectOrderSideFromConfirmText(normalizedText(dialog));
  const buttonText = normalizedText(button);
  const isConfirmButton =
    /^(확인|매수확인|매도확인|주문하기|매수|매도)$/.test(buttonText);

  if (!dialog || !side || !isConfirmButton) {
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

function inputMatchesLabel(input, panel, labelPattern) {
  const directLabels = [
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

    if (/주문총액|매수금액|매도금액|총주문금액|주문금액|총액|금액/.test(normalized)) {
      return { eventType: "AMOUNT_INPUT", field: "amount" };
    }

    if (/매수가격|매도가격|주문가격|가격/.test(normalized)) {
      return { eventType: "PRICE_INPUT", field: "price" };
    }

    if (/주문수량|매수수량|매도수량|수량/.test(normalized)) {
      return { eventType: "QUANTITY_INPUT", field: "quantity" };
    }
  }

  return null;
}

function detectOrderType(panel, contextElement = null) {
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

    return isSelected && /시장가|지정가/.test(normalizedText(control));
  });

  if (normalizedText(selectedControl).includes("시장가")) {
    return "MARKET";
  }

  if (normalizedText(selectedControl).includes("지정가")) {
    return "LIMIT";
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
  const marketData = detail.marketData || {};
  const market = detail.market || detail.currentOrder?.market || behaviorState?.market;
  const tradePrice = firstDefined(
    detail.currentPrice,
    marketData.tradePrice,
    marketData.tradePriceAtSnapshot,
    marketData.currentPrice,
    marketData.current_price,
  );
  const signedChangeRate = firstDefined(
    marketData.signedChangeRate,
    marketData.signed_change_rate,
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
    fetchedAt,
    freshnessMs: 0,
    source: "demo-page",
  };
}

function createDemoPersonalSnapshot(detail) {
  const market = detail.market || detail.currentOrder?.market || behaviorState?.market;
  const balances = Array.isArray(detail.accounts) ? detail.accounts : [];
  const openOrders = Array.isArray(detail.rawOpenOrders) ? detail.rawOpenOrders : [];
  const recentTrades = Array.isArray(detail.rawClosedOrders)
    ? detail.rawClosedOrders
    : [];
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
    recentOrders: Array.isArray(detail.recentOrders) ? detail.recentOrders : [],
    recentTrades,
    baseAssetAvgBuyPrice:
      baseAssetAvgBuyPrice === undefined || baseAssetAvgBuyPrice === null
        ? null
        : String(baseAssetAvgBuyPrice),
    actualOrderCreatedCount10m: countRecentRawOrders10m(
      [...openOrders, ...recentTrades],
    ),
    fetchedAt,
    freshnessMs: 0,
    source: "demo-page",
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

function handleDemoScenario(event) {
  if (!behaviorState || !isAppPage()) {
    return;
  }

  acknowledgePageEvent(event);
  const detail = event.detail || {};
  const expiresAt = Number(detail.expiresAt) || Date.now() + 180_000;
  const demoMarketSnapshot = createDemoMarketSnapshot(detail);
  const demoPersonalSnapshot = createDemoPersonalSnapshot(detail);
  const demoMarket = demoMarketSnapshot.market || detail.market || "UNKNOWN";
  const currentOrder = withAuthoritativeOrderMarket(
    detail.currentOrder || null,
    demoMarket,
  );
  const marketData = {
    ...(detail.marketData || {}),
    market: demoMarket,
  };
  behaviorState.demoOverride = {
    behaviorData: detail.behaviorData || null,
    currentOrder,
    demoMarketSnapshot,
    demoPersonalSnapshot,
    demoData: {
      market: demoMarket,
      recentOrders: Array.isArray(detail.recentOrders)
        ? detail.recentOrders
        : [],
      clientAverageBuyAmount:
        detail.clientAverageBuyAmount ??
        detail.behaviorData?.client_avg_buy_amount ??
        null,
      currentPrice: detail.currentPrice ?? null,
      marketData,
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

  behaviorState.market = demoMarket;
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
}

function buildOrderContextSnapshot(orderButton, snapshotTrigger) {
  const panel = findOrderPanel(orderButton);
  const draft = readOrderDraft(orderButton);
  const capturedAt = new Date().toISOString();
  const now = Date.now();
  const market = isDemoPage()
    ? getDemoOverrideMarket() ||
      draft?.market ||
      behaviorState?.market ||
      parseMarket(location.href)
    : draft?.market || behaviorState?.market || parseMarket(location.href);
  const side = draft?.order_side || detectOrderSide(panel, orderButton) || "UNKNOWN";
  const orderMode = draft?.order_type || detectOrderType(panel, orderButton) || "UNKNOWN";
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

  if (result.type !== "USER_GUARDRAIL_RULE") {
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
    result,
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
    mergeCachedSnapshotsIntoOrderContext(pendingAttempt.snapshot),
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
  const snapshotWithCache = mergeCachedSnapshotsIntoOrderContext(rawSnapshot);
  const { snapshot, result } =
    evaluatePageGuardrailRulesForSnapshot(snapshotWithCache);
  emitOrderContextSnapshotDebug(snapshot);
  pendingAttempt = {
    attemptId: snapshot.attemptId,
    snapshot,
    snapshotEmitted: true,
    feedbackShownAt: null,
    feedbackRespondedAt: null,
  };
  emitOrderContextSnapshot(snapshot, result);
  let warningShown = false;
  if (result?.detected) {
    warningShown = showDetectedGuardrailResult(result, snapshot);
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
  sendBackendLogMessage("SAVE_TRADE_FEEDBACK", feedback);
}

function dismissActiveTradeFeedback() {
  if (activeTradeFeedback) {
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

  const respondedAt = new Date().toISOString();
  emitTradeFeedback(activeTradeFeedback, assessment);
  if (pendingAttempt?.attemptId === activeTradeFeedback.attemptId) {
    pendingAttempt.feedbackRespondedAt = respondedAt;
  }
  activeTradeFeedback = null;
  setPanelFeedbackActive(false);
  setAnalysisStatus("주문·체결 데이터를 확인하고 있어요.", "loading");
}

function showTradeFeedback() {
  if (!pendingAttempt?.attemptId) return;
  if (pendingAttempt.feedbackRespondedAt) return;
  if (activeTradeFeedback?.attemptId === pendingAttempt.attemptId) return;

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

function ensurePendingAttemptForConfirmedOrder(orderButton) {
  if (pendingAttempt?.attemptId) {
    return pendingAttempt;
  }

  const rawSnapshot = buildOrderContextSnapshot(
    orderButton,
    "ORDER_INTENT_CLICK",
  );
  const snapshotWithCache = mergeCachedSnapshotsIntoOrderContext(rawSnapshot);
  const { snapshot, result } =
    evaluatePageGuardrailRulesForSnapshot(snapshotWithCache);

  emitOrderContextSnapshotDebug(snapshot);
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

function notifyOrderActionDetectedForConfirmedOrder(orderButton) {
  const orderPanel = findOrderPanel(orderButton);
  const orderDraft = withAuthoritativeOrderMarket(
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

  safeRuntimeSendMessage({
      type: "ORDER_ACTION_DETECTED",
      payload: {
        market: behaviorState.market,
        sessionId: behaviorState.sessionId,
        pageUrl: location.href,
        currentOrder: orderDraft,
        behaviorData,
        orderContextSnapshot: pendingAttempt?.snapshot || null,
        demoData: getActiveDemoData(),
        refreshAlreadyRequested: true,
      },
    })
    .then((response) => {
      if (!response?.ok && response?.error && !activeTradeFeedback) {
        setAnalysisStatus(response.error, "error");
      }
    });

  startNewOrderSession();
  syncOrderType(orderPanel, false);
}

function handleUpbitOrderConfirmClick(orderButton) {
  ensurePendingAttemptForConfirmedOrder(orderButton);
  sendSnapshotRefreshMessage(
    "ORDER_CONFIRM_MODAL",
    pendingAttempt?.snapshot?.market || behaviorState?.market,
  );
  showTradeFeedback();
  notifyOrderActionDetectedForConfirmedOrder(orderButton);
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

  const upbitConfirmButton = findUpbitOrderConfirmButton(event.target);
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
  pendingAttempt = null;
  activeDetectionResult = null;
  activeGuardrailSnapshotId = null;
  activeTradeFeedback = null;
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
  activeTradeFeedback = null;
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

    if (shouldIgnoreDetectionResultForActiveWarning(result)) {
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
    if (hasActiveGuardrailWarning()) {
      return;
    }
    applyFlameTheme(changes.flameTheme.newValue?.mode);
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

refreshPanelState();

window.setInterval(() => {
  if (location.href === currentPageUrl) {
    return;
  }

  currentPageUrl = location.href;
  refreshPanelState();
}, 500);
