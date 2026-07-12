const CURRENT_PROMPT_VERSION = "daily-prompt-v3";
const CURRENT_ANALYSIS_VERSION = "daily-v2";

function clampNumber(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function getDailyInsightCtaViewState(eligibility) {
  if (!eligibility) return "READY_TO_GENERATE";
  if (eligibility.reportStatus === "GENERATING") return "GENERATING";
  return "READY_TO_GENERATE";
}

function buildDailyInsightCtaViewModel(eligibility, todayReport) {
  const state = getDailyInsightCtaViewState(eligibility, todayReport);
  const required = eligibility?.requiredFeedbackCount || 5;
  const answered = eligibility?.answeredFeedbackCount || 0;
  const progress = clampNumber(answered / required, 0, 1);

  const base = {
    state,
    answered,
    required,
    progress,
    primaryAction: null,
    secondaryAction: null,
    meta: null,
    showProgress: false,
    steps: [],
  };

  if (state === "NEED_MORE_FEEDBACK") {
    return {
      ...base,
      showProgress: false,
      title: "오늘의 일간 리포트",
      message: "버튼을 누르면 현재 저장된 기록으로 새 AI 인사이트를 생성해요.",
      meta: `피드백 ${answered}건`,
      primaryAction: "AI 인사이트 생성하기",
    };
  }
  if (state === "READY_TO_GENERATE") {
    return {
      ...base,
      title: "오늘의 일간 리포트",
      message: "버튼을 누르면 현재 저장된 기록으로 새 AI 인사이트를 생성해요.",
      primaryAction: "AI 인사이트 생성하기",
    };
  }
  if (state === "GENERATING") {
    return {
      ...base,
      title: "오늘의 일간 리포트를 생성하고 있어요…",
      message: null,
      primaryAction: "생성 중",
    };
  }
  if (state === "COMPLETED") {
    return {
      ...base,
      title: "오늘의 일간 리포트가 준비됐어요.",
      message: todayReport?.generatedAt ? `${formatTimeKorean(todayReport.generatedAt)} 생성` : null,
      primaryAction: "오늘 리포트 열기",
    };
  }
  if (state === "PARTIAL") {
    return {
      ...base,
      title: "일부 분석만 완료됐어요.",
      message: "완료된 결과는 먼저 확인할 수 있어요.",
      primaryAction: "완료된 결과 보기",
      secondaryAction: "실패한 분석 다시 시도",
    };
  }
  if (state === "FAILED") {
    return {
      ...base,
      title: "리포트를 생성하지 못했어요.",
      message: null,
      primaryAction: "다시 시도",
    };
  }
  return {
    ...base,
    title: "리포트 이후 새로운 기록이 쌓였어요.",
    message: null,
    primaryAction: "기존 리포트 보기",
    secondaryAction: "최신 기록으로 다시 생성",
  };
}

function formatDateKorean(date) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date || "");
  if (!match) return date || "";
  return `${Number(match[1])}년 ${Number(match[2])}월 ${Number(match[3])}일`;
}

function formatTimeKorean(value) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "생성 시각 없음";
  const kst = new Date(parsed.getTime() + 9 * 60 * 60 * 1000);
  const hour24 = kst.getUTCHours();
  const minute = String(kst.getUTCMinutes()).padStart(2, "0");
  const period = hour24 < 12 ? "오전" : "오후";
  const hour12 = hour24 % 12 || 12;
  return `${period} ${hour12}:${minute}`;
}

function formatPercent(rate) {
  if (rate == null || !Number.isFinite(Number(rate))) return "-";
  return `${Number(rate) >= 0 ? "+" : ""}${(Number(rate) * 100).toFixed(2)}%`;
}

function formatKrw(value) {
  if (value == null || value === "") return "-";
  const number = Number(value);
  if (!Number.isFinite(number)) return String(value);
  const rounded = Math.round(number);
  return `${new Intl.NumberFormat("ko-KR").format(rounded)}원`;
}

function formatDecimal(value) {
  if (value == null || value === "") return "-";
  const number = Number(value);
  if (!Number.isFinite(number)) return String(value);
  return new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 8 }).format(number);
}

function getSideLabel(side) {
  if (side === "BUY") return "매수";
  if (side === "SELL") return "매도";
  return "방향 미확인";
}

function getMarketLabel(market) {
  if (!market) return "종목 미확인";
  const asset = market.startsWith("KRW-") ? market.slice(4) : market;
  return `${asset} · ${market}`;
}

function getSeverityLabel(severity) {
  if (severity === "critical") return "꼭 확인";
  if (severity === "high" || severity === "warning") return "주의";
  if (severity === "medium" || severity === "caution") return "살펴보기";
  if (severity === "unavailable") return "데이터 부족";
  return "안정적";
}

function normalizeReport(report) {
  if (!report) return null;
  return {
    ...report,
    analysisStatus: report.analysisStatus || {
      overview: report.overview ? "COMPLETED" : "FAILED",
      fieldAnalysis: report.fieldAnalysis ? "COMPLETED" : "FAILED",
    },
    suggestionStatus: report.suggestionStatus || "NOT_IMPLEMENTED",
    dataAvailability: report.dataAvailability || null,
    overview: report.overview || null,
    fieldAnalysis: report.fieldAnalysis || null,
    timeline: report.timeline || [],
  };
}

function getReportVersionNotice(report) {
  if (!report) return null;
  if (
    report.promptVersion &&
    report.analysisVersion &&
    report.promptVersion === CURRENT_PROMPT_VERSION &&
    report.analysisVersion === CURRENT_ANALYSIS_VERSION
  ) {
    return null;
  }
  return {
    title: "이전 분석 기준으로 생성된 리포트",
    message: "최신 기준으로 다시 생성하면 더 정확한 결과를 볼 수 있어요.",
    action: "최신 기준으로 다시 생성",
  };
}

function buildReportHeroViewModel(report) {
  const normalized = normalizeReport(report);
  if (!normalized) return null;
  const counts = normalized.sourceCounts || {};
  const personalTradeAvailable = normalized.dataAvailability?.personalTrade?.available;
  const confirmedTrades = counts.confirmedTrades || 0;
  return {
    dateLabel: formatDateKorean(normalized.date),
    title: "오늘의 주문 리포트",
    statusBadge: normalized.status === "PARTIAL" ? "일부 분석만 완료" : null,
    flameStatus: normalized.overview?.flameStatus || "default",
    summary: normalized.overview?.summary || "저장된 주문 기록을 기준으로 리포트를 만들었어요.",
    advice:
      normalized.fieldAnalysis?.oneLineAdvice ||
      normalized.overview?.cards?.[0]?.description ||
      "다음 주문 전, 처음 세운 기준을 한 번 확인해 보세요.",
    badges: [
      `피드백 ${counts.answeredFeedbacks || 0}`,
      `주문 시도 ${counts.attempts || 0}`,
      `가드레일 ${counts.guardrailSnapshots || 0}`,
      confirmedTrades > 0 || personalTradeAvailable
        ? `확인된 실제 주문 ${confirmedTrades}건`
        : "실제 주문 데이터 없음",
    ],
    versionNotice: getReportVersionNotice(normalized),
  };
}

function getGuardrailActionCounts(report) {
  const events = report?.timeline || [];
  const reactionEvents = events.filter((event) => event.type === "GUARDRAIL_REACTION");
  const proceed = reactionEvents.filter((event) => event.description.includes("계속 진행")).length;
  return {
    total: reactionEvents.length,
    proceed,
  };
}

function buildVirtualPnlViewModel(metric) {
  if (!metric || metric.status !== "AVAILABLE") {
    return {
      available: false,
      title: "비교할 주문이 없어요",
      message: "최근 24시간 동안 조건을 만족하는 ‘진행하지 않은 주문’이 확인되지 않았어요.",
      summaryRows: [],
      items: [],
    };
  }
  return {
    available: true,
    title: "진행하지 않은 주문의 현재 가격 효과",
    message: `${metric.sampleCount}건을 리포트 생성 시점의 현재 가격과 비교한 가상 결과예요.`,
    summaryRows: [
      ["비교 주문", `${metric.sampleCount}건`],
      ["상승 방향 효과", formatKrw(metric.totalPositiveVirtualPnl)],
      ["하락 방향 효과", formatKrw(metric.totalNegativeVirtualPnl)],
      ["순 가격 효과", formatKrw(metric.netVirtualPnl)],
    ],
    items: (metric.items || []).map((item) => ({
      key: item.snapshotId,
      title: `${getMarketLabel(item.market)} · ${getSideLabel(item.side)}`,
      time: formatTimeKorean(item.capturedAt),
      rows: [
        ["당시 가격", formatKrw(item.entryPrice)],
        ["현재 가격", formatKrw(item.currentPrice)],
        ["가격 변화", formatPercent(item.virtualReturnRate)],
        ["가상 가격 효과", formatKrw(item.virtualPnl)],
      ],
      note:
        item.note ||
        "가드레일 반응 이후 10분 동안 동일한 주문 흐름이 확인되지 않았어요.",
      sellNotice:
        item.side === "SELL"
          ? "매도 항목은 공매도 수익이 아니라 당시 매도와 현재 보유를 비교한 상대적인 가격 효과입니다."
          : null,
    })),
  };
}

function buildKeyInsightCards(report) {
  const normalized = normalizeReport(report);
  if (!normalized) return [];
  const guardrail = getGuardrailActionCounts(normalized);
  const virtual = buildVirtualPnlViewModel(normalized.metrics?.cancelledOrderVirtualPnl);
  const topCard = pickImportantCard(normalized);
  return [
    {
      key: "guardrail",
      title: "가드레일 이후 계속 진행",
      value: guardrail.total > 0 ? `${guardrail.proceed}회 중 ${guardrail.total}회` : "기록 없음",
      description:
        guardrail.total > 0
          ? guardrail.proceed > guardrail.total / 2
            ? "오늘은 경고 후 주문을 이어간 비율이 높았어요."
            : "오늘은 경고 후 주문을 다시 확인하거나 닫은 기록이 더 많았어요."
          : "가드레일 반응 기록이 아직 충분하지 않아요.",
    },
    {
      key: "virtual-pnl",
      title: virtual.title,
      value: virtual.available
        ? `${formatKrw(normalized.metrics.cancelledOrderVirtualPnl.netVirtualPnl)} · ${formatPercent(normalized.metrics.cancelledOrderVirtualPnl.items?.[0]?.virtualReturnRate)}`
        : "비교 기록 없음",
      description: virtual.available
        ? normalized.metrics.cancelledOrderVirtualPnl.items?.[0]?.note
        : virtual.message,
    },
    {
      key: "next",
      title: "다음 주문에서 확인할 것",
      value: "",
      description:
        normalized.fieldAnalysis?.oneLineAdvice ||
        topCard?.description ||
        "같은 방향의 주문을 다시 누르기 전에 처음 세운 진입 조건을 확인해 보세요.",
    },
  ];
}

function pickImportantCard(report) {
  const priority = new Map([
    ["critical", 0],
    ["high", 1],
    ["medium", 2],
    ["warning", 1],
    ["caution", 2],
    ["low", 3],
    ["unavailable", 4],
  ]);
  return [...(report?.overview?.cards || [])].sort(
    (a, b) => (priority.get(a.severity) ?? 9) - (priority.get(b.severity) ?? 9),
  )[0] || null;
}

function pickDashboardMetric(report) {
  const normalized = normalizeReport(report);
  if (!normalized) return null;
  const cancelled = buildVirtualPnlViewModel(normalized.metrics?.cancelledOrderVirtualPnl);
  if (cancelled.available) {
    return `현재 가상 가격 효과 ${formatKrw(normalized.metrics.cancelledOrderVirtualPnl.netVirtualPnl)}`;
  }
  const waiting = normalized.metrics?.waitingPriceEffect;
  if (waiting?.status === "AVAILABLE") return `기다린 체결 가격 효과 ${waiting.sampleCount}건`;
  const reduced = normalized.metrics?.reducedExposure;
  if (reduced?.status === "AVAILABLE") return `줄인 위험 노출액 ${formatKrw(reduced.totalReducedExposureAmount)}`;
  if (normalized.metrics?.feedbackPnlComparison?.status === "AVAILABLE") {
    return "계획적 거래와 후회가 남는 거래를 비교했어요.";
  }
  return null;
}

function reactionLabel(description) {
  if (!description) return null;
  if (description.includes("계속 진행")) return "PROCEED";
  if (description.includes("다시")) return "REVIEW";
  if (description.includes("닫")) return "CLOSE";
  return null;
}

function reactionSentence(action) {
  if (action === "PROCEED") return "계속 진행을 선택했어요.";
  if (action === "REVIEW") return "주문 내용을 다시 확인했어요.";
  if (action === "CLOSE") return "경고 창을 닫았어요.";
  return null;
}

function buildOrderFlowViewModels(report) {
  const events = [...(report?.timeline || [])].sort(
    (a, b) => new Date(a.occurredAt).getTime() - new Date(b.occurredAt).getTime(),
  );
  const flowMap = new Map();
  const unlinkedEvents = [];

  function getFlow(key) {
    if (!flowMap.has(key)) {
      flowMap.set(key, {
        flowId: key,
        startedAt: null,
        endedAt: null,
        market: null,
        side: null,
        attemptId: null,
        snapshotId: null,
        guardrail: { shown: false, ruleNames: [], reaction: null },
        feedback: null,
        confirmedTrade: null,
        events: [],
      });
    }
    return flowMap.get(key);
  }

  for (const event of events) {
    const key = event.attemptId || event.snapshotId || event.tradeLogId;
    if (!key) {
      unlinkedEvents.push(event);
      continue;
    }
    const flow = getFlow(key);
    flow.events.push(event);
    flow.startedAt = flow.startedAt && flow.startedAt < event.occurredAt ? flow.startedAt : event.occurredAt;
    flow.endedAt = event.occurredAt;
    flow.market = flow.market || event.market;
    flow.side = flow.side || event.side;
    flow.attemptId = flow.attemptId || event.attemptId;
    flow.snapshotId = flow.snapshotId || event.snapshotId;
    if (event.type === "GUARDRAIL_TRIGGERED") flow.guardrail.shown = true;
    if (event.type === "GUARDRAIL_REACTION") {
      flow.guardrail.reaction = reactionLabel(event.description);
    }
    if (event.type === "FEEDBACK_SUBMITTED") {
      if (event.description.includes("계획적")) flow.feedback = "PLANNED";
      else if (event.description.includes("후회")) flow.feedback = "REGRETTED";
      else flow.feedback = "DISMISSED";
    }
    if (event.type === "ORDER_CREATED" || event.type === "ORDER_UPDATED") {
      flow.confirmedTrade = {
        status: event.title,
        executedFunds: null,
        executedVolume: null,
      };
    }
  }

  const flows = Array.from(flowMap.values()).sort(
    (a, b) => new Date(b.startedAt || 0).getTime() - new Date(a.startedAt || 0).getTime(),
  );
  const important = [...flows].sort((a, b) => {
    const score = (flow) =>
      (flow.feedback ? 4 : 0) + (flow.guardrail.shown ? 2 : 0) + (flow.confirmedTrade ? 1 : 0);
    return score(b) - score(a) || new Date(b.startedAt || 0).getTime() - new Date(a.startedAt || 0).getTime();
  });
  return {
    visibleFlows: important.slice(0, 5),
    hiddenFlows: important.slice(5),
    unlinkedEvents,
  };
}

function buildFlowSteps(flow) {
  const steps = ["주문 시도"];
  if (flow.guardrail.shown) steps.push("가드레일 표시");
  const reaction = reactionSentence(flow.guardrail.reaction);
  if (reaction) steps.push(reaction);
  if (flow.feedback === "PLANNED") steps.push("계획적이었다고 기록");
  if (flow.feedback === "REGRETTED") steps.push("후회가 남는 거래로 기록");
  if (flow.feedback === "DISMISSED") steps.push("피드백 건너뜀");
  if (flow.confirmedTrade || flow.trade?.availability === "CONFIRMED") {
    steps.push("실제 주문 정보 확인");
  }
  return steps;
}

function buildReportListItem(report, selectedReportId) {
  const normalized = normalizeReport(report);
  const summary = normalized?.overview?.summary || "요약이 저장된 리포트입니다.";
  const generatedAt = normalized.generatedAt || normalized.updatedAt || normalized.createdAt;
  return {
    key: normalized.reportId || normalized.date,
    date: normalized.date,
    dateLabel: formatDateKorean(normalized.date).replace(/\d{4}년\s*/, ""),
    statusLabel: normalized.status === "PARTIAL" ? "일부 완료" : "완료",
    meta: `생성 ${formatTimeKorean(generatedAt)} · 피드백 ${normalized.sourceCounts?.answeredFeedbacks || 0} · 시도 ${normalized.sourceCounts?.attempts || 0} · 가드레일 ${normalized.sourceCounts?.guardrailSnapshots || 0}`,
    summary,
    selected: selectedReportId === (normalized.reportId || normalized.date),
  };
}

module.exports = {
  CURRENT_ANALYSIS_VERSION,
  CURRENT_PROMPT_VERSION,
  buildDailyInsightCtaViewModel,
  buildFlowSteps,
  buildKeyInsightCards,
  buildOrderFlowViewModels,
  buildReportHeroViewModel,
  buildReportListItem,
  buildVirtualPnlViewModel,
  formatDateKorean,
  formatDecimal,
  formatKrw,
  formatPercent,
  formatTimeKorean,
  getDailyInsightCtaViewState,
  getMarketLabel,
  getReportVersionNotice,
  getSeverityLabel,
  getSideLabel,
  normalizeReport,
  pickDashboardMetric,
  pickImportantCard,
  reactionSentence,
};
