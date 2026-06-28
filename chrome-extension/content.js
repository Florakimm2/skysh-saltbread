const PANEL_ID = "saltbread-extension-panel";
const METRIC_DEFINITIONS = [
  {
    id: "amount-edits",
    label: "금액 입력 수정",
    initialValue: "0회",
    description: "현재 주문 전 변경 횟수",
  },
  {
    id: "dwell-time",
    label: "사이트 체류 시간",
    initialValue: "00:00:00",
    description: "거래 화면이 보인 시간",
  },
];

let behaviorState = null;
let behaviorTimerId = null;

function isLoggedIn(auth) {
  return Boolean(auth?.accessToken && auth?.user);
}

function renderMetricCards() {
  return METRIC_DEFINITIONS.map(
    ({ id, label, initialValue, description }) => `
      <article class="saltbread-metric-card" data-metric="${id}">
        <span class="saltbread-metric-card__label">${label}</span>
        <strong class="saltbread-metric-card__value">${initialValue}</strong>
        <span class="saltbread-metric-card__description">${description}</span>
      </article>
    `,
  ).join("");
}

function removePanel() {
  document.getElementById(PANEL_ID)?.remove();
  stopBehaviorTracking();
}

function createPanel(auth) {
  if (document.getElementById(PANEL_ID)) {
    return;
  }

  // fixed 요소로 추가해 Upbit 페이지의 너비와 배치를 변경하지 않습니다.
  const panel = document.createElement("aside");
  panel.id = PANEL_ID;
  panel.setAttribute("aria-label", "Saltbread 행동 데이터");
  panel.innerHTML = `
    <button
      class="saltbread-panel__reopen"
      type="button"
      aria-label="Saltbread 패널 열기"
      aria-hidden="true"
      title="패널 열기"
    >
      <span aria-hidden="true"></span>
    </button>

    <div class="saltbread-panel__body">
      <div class="saltbread-panel__header">
        <span class="saltbread-panel__badge" aria-hidden="true">S</span>
        <div class="saltbread-panel__title">
          <strong>Saltbread</strong>
          <span>행동 데이터</span>
        </div>
        <button
          class="saltbread-panel__collapse"
          type="button"
          aria-label="Saltbread 패널 접기"
          title="패널 접기"
        >
          <span aria-hidden="true"></span>
        </button>
      </div>

      <p class="saltbread-panel__account"></p>

      <div class="saltbread-analysis-status" aria-label="분석 상태">
        <span class="saltbread-analysis-status__dot" aria-hidden="true"></span>
        <span>데이터 수집 중...</span>
      </div>

      <section class="saltbread-panel__section" aria-labelledby="saltbread-metrics-title">
        <div class="saltbread-panel__section-heading">
          <h2 id="saltbread-metrics-title">실시간 행동 데이터</h2>
          <span>이 탭에서만 집계</span>
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

  document.body.append(panel);
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
}

function isAmountInput(target) {
  if (!(target instanceof HTMLInputElement) || target.closest(`#${PANEL_ID}`)) {
    return false;
  }

  const orderPanel = target.closest("article");
  const orderPanelText = orderPanel?.textContent?.replace(/\s/g, "") || "";

  // Upbit 주문 영역의 의미 텍스트를 사용해 동적인 클래스명에 의존하지 않습니다.
  return (
    orderPanelText.includes("주문총액") &&
    orderPanelText.includes("주문수량") &&
    (orderPanelText.includes("매수가격") ||
      orderPanelText.includes("매도가격"))
  );
}

function isOrderSubmitButton(target) {
  if (!(target instanceof Element)) {
    return false;
  }

  const button = target.closest("button, [role='button']");

  if (!button || button.closest(`#${PANEL_ID}`)) {
    return false;
  }

  const orderPanelText =
    button.closest("article")?.textContent?.replace(/\s/g, "") || "";
  const buttonText = button.textContent?.replace(/\s/g, "") || "";

  return (
    orderPanelText.includes("주문총액") &&
    /^(매수|매도)(하기)?$/.test(buttonText)
  );
}

function handleAmountInput(event) {
  if (!behaviorState || !isAmountInput(event.target)) {
    return;
  }

  behaviorState.currentAmountEditCount += 1;
  renderBehaviorMetrics();
}

function handleOrderSubmit(event) {
  if (!behaviorState || !isOrderSubmitButton(event.target)) {
    return;
  }

  behaviorState.lastOrderAmountEditCount =
    behaviorState.currentAmountEditCount;
  behaviorState.currentAmountEditCount = 0;
  renderBehaviorMetrics();
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

function getVisibleDurationMs() {
  if (!behaviorState) {
    return 0;
  }

  const currentVisibleDuration = behaviorState.visibleSince
    ? Date.now() - behaviorState.visibleSince
    : 0;

  return behaviorState.visibleDurationMs + currentVisibleDuration;
}

function formatDuration(durationMs) {
  const totalSeconds = Math.floor(durationMs / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  return [hours, minutes, seconds]
    .map((value) => String(value).padStart(2, "0"))
    .join(":");
}

function renderBehaviorMetrics() {
  if (!behaviorState) {
    return;
  }

  const panel = document.getElementById(PANEL_ID);
  const amountCard = panel?.querySelector('[data-metric="amount-edits"]');
  const dwellTimeCard = panel?.querySelector('[data-metric="dwell-time"]');

  if (!amountCard || !dwellTimeCard) {
    return;
  }

  amountCard.querySelector(".saltbread-metric-card__value").textContent =
    `${behaviorState.currentAmountEditCount}회`;
  amountCard.querySelector(".saltbread-metric-card__description").textContent =
    behaviorState.lastOrderAmountEditCount === null
      ? "현재 주문 전 변경 횟수"
      : `최근 주문 전 ${behaviorState.lastOrderAmountEditCount}회`;
  dwellTimeCard.querySelector(".saltbread-metric-card__value").textContent =
    formatDuration(getVisibleDurationMs());
}

function startBehaviorTracking() {
  if (behaviorState) {
    return;
  }

  behaviorState = {
    currentAmountEditCount: 0,
    lastOrderAmountEditCount: null,
    visibleDurationMs: 0,
    visibleSince: document.hidden ? null : Date.now(),
  };

  document.addEventListener("input", handleAmountInput, true);
  document.addEventListener("click", handleOrderSubmit, true);
  document.addEventListener("visibilitychange", handleVisibilityChange);
  behaviorTimerId = window.setInterval(renderBehaviorMetrics, 1000);
  renderBehaviorMetrics();
}

function stopBehaviorTracking() {
  if (!behaviorState) {
    return;
  }

  document.removeEventListener("input", handleAmountInput, true);
  document.removeEventListener("click", handleOrderSubmit, true);
  document.removeEventListener("visibilitychange", handleVisibilityChange);
  window.clearInterval(behaviorTimerId);
  behaviorTimerId = null;
  behaviorState = null;
}

function syncPanel(auth) {
  if (isLoggedIn(auth)) {
    createPanel(auth);
    return;
  }

  removePanel();
}

// 팝업에서 로그인·로그아웃할 때 열린 거래 화면에도 즉시 반영합니다.
chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === "local" && changes.auth) {
    syncPanel(changes.auth.newValue);
  }
});

chrome.storage.local.get("auth").then(({ auth }) => syncPanel(auth));
