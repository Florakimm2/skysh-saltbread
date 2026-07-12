/* eslint-disable @typescript-eslint/no-require-imports */
const crypto = require("crypto");
const Decimal = require("decimal.js");
const {
  DEFAULT_TIMEZONE,
  GUARDRAIL_SUGGESTION_ALGORITHM_VERSION,
  buildGuardrailSuggestionRequest,
  buildOrderFlows,
  computeFeedbackPnlComparison,
  computeInsightDataAvailability,
  computeReducedExposure,
  computeWaitingPriceEffect,
  getLatestEffectiveFeedbacks,
  isInRange,
  sanitizeFieldAnalysisWithAvailability,
  sanitizeOverviewWithAvailability,
  stableJson,
  toIsoString,
  toTimeMs,
} = require("./daily-core");

const REQUIRED_WEEKLY_FEEDBACK_COUNT = 5;
const WEEKLY_REPORT_SCHEMA_VERSION = "weekly-schema-v1";
const WEEKLY_ANALYSIS_VERSION = "weekly-v1";
const WEEKLY_PROMPT_VERSION = "weekly-prompt-v1";
const WEEKLY_GUARDRAIL_SUGGESTION_ALGORITHM_VERSION =
  GUARDRAIL_SUGGESTION_ALGORITHM_VERSION;
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const PRICE_LOOKUP_TOLERANCE_MS = 2 * HOUR_MS;

function pad2(value) {
  return String(value).padStart(2, "0");
}

function toKstDateString(value) {
  const kst = new Date(toTimeMs(value) + KST_OFFSET_MS);
  return `${kst.getUTCFullYear()}-${pad2(kst.getUTCMonth() + 1)}-${pad2(kst.getUTCDate())}`;
}

function formatKoreanPeriodDate(value) {
  const kst = new Date(toTimeMs(value) + KST_OFFSET_MS);
  return `${kst.getUTCMonth() + 1}월 ${kst.getUTCDate()}일`;
}

function getIsoWeekKeyFromLocalDateMs(localDateMs) {
  const date = new Date(localDateMs);
  const target = Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate(),
  );
  const dayNumber = (new Date(target).getUTCDay() + 6) % 7;
  const thursday = target - dayNumber * DAY_MS + 3 * DAY_MS;
  const isoYear = new Date(thursday).getUTCFullYear();
  const firstThursdayBase = Date.UTC(isoYear, 0, 4);
  const firstThursdayDayNumber =
    (new Date(firstThursdayBase).getUTCDay() + 6) % 7;
  const firstThursday =
    firstThursdayBase - firstThursdayDayNumber * DAY_MS + 3 * DAY_MS;
  const week = 1 + Math.round((thursday - firstThursday) / (7 * DAY_MS));
  return `${isoYear}-W${pad2(week)}`;
}

function weekKeyToLocalMondayMs(weekKey) {
  const match = /^(\d{4})-W(\d{2})$/.exec(weekKey || "");
  if (!match) throw new Error("INVALID_WEEK_KEY");
  const isoYear = Number(match[1]);
  const isoWeek = Number(match[2]);
  if (isoWeek < 1 || isoWeek > 53) throw new Error("INVALID_WEEK_KEY");
  const jan4 = Date.UTC(isoYear, 0, 4);
  const jan4DayNumber = (new Date(jan4).getUTCDay() + 6) % 7;
  return jan4 - jan4DayNumber * DAY_MS + (isoWeek - 1) * 7 * DAY_MS;
}

function getWeeklyPeriod(params = {}) {
  const timezone = params.timezone || DEFAULT_TIMEZONE;
  if (timezone !== "Asia/Seoul") {
    throw new Error("UNSUPPORTED_WEEKLY_TIMEZONE");
  }
  const nowMs = toTimeMs(params.now || new Date());
  const weekKey = params.weekKey || getIsoWeekKeyFromLocalDateMs(nowMs + KST_OFFSET_MS);
  const localMondayMs = weekKeyToLocalMondayMs(weekKey);
  const periodStartMs = localMondayMs - KST_OFFSET_MS;
  const periodEndExclusiveMs = periodStartMs + 7 * DAY_MS;
  const periodEndInclusiveMs = periodEndExclusiveMs - 1;
  const currentWeekKey = getIsoWeekKeyFromLocalDateMs(nowMs + KST_OFFSET_MS);
  return {
    weekKey,
    timezone,
    periodStart: new Date(periodStartMs).toISOString(),
    periodEnd: new Date(periodEndInclusiveMs).toISOString(),
    periodEndExclusive: new Date(periodEndExclusiveMs).toISOString(),
    periodState: nowMs < periodEndExclusiveMs ? "OPEN" : "CLOSED",
    isCurrentWeek: weekKey === currentWeekKey,
  };
}

function getPreviousWeeklyPeriod(params = {}) {
  const current = getWeeklyPeriod(params);
  const previousStart = new Date(toTimeMs(current.periodStart) - 7 * DAY_MS);
  return getWeeklyPeriod({
    ...params,
    now: params.now || new Date(),
    weekKey: getIsoWeekKeyFromLocalDateMs(previousStart.getTime() + KST_OFFSET_MS),
  });
}

function hasShownGuardrail(snapshot) {
  return (
    (Array.isArray(snapshot.shownRuleIds) && snapshot.shownRuleIds.length > 0) ||
    snapshot.primaryShownRuleId != null
  );
}

function getLinkedGuardrailReactions(sources) {
  const snapshotsById = new Map(
    (sources.snapshots || []).map((snapshot) => [snapshot.snapshotId, snapshot]),
  );
  return (sources.reactions || []).filter((reaction) => {
    const snapshot = snapshotsById.get(reaction.snapshotId);
    return Boolean(snapshot && hasShownGuardrail(snapshot));
  });
}

function countReactionActions(reactions) {
  return {
    reactionCount: reactions.length,
    proceedCount: reactions.filter((reaction) => reaction.action === "PROCEED").length,
    reviewCount: reactions.filter((reaction) => reaction.action === "REVIEW").length,
    closeCount: reactions.filter((reaction) => reaction.action === "CLOSE").length,
  };
}

function buildWeeklySourceCounts(sources) {
  const snapshots = sources.snapshots || [];
  const linkedReactions = getLinkedGuardrailReactions(sources);
  const reactionCounts = countReactionActions(linkedReactions);
  const latestFeedbacks = getLatestEffectiveFeedbacks(sources.feedbacks || []);
  const answeredFeedbacks = latestFeedbacks.filter(
    (feedback) => feedback.feedbackStatus === "ANSWERED",
  );
  const dailyBreakdown = buildWeeklyDailyBreakdown({
    period: sources.period,
    sources,
  });
  return {
    activeDays: dailyBreakdown.filter((day) => day.active).length,
    snapshots: snapshots.length,
    orderAttempts: snapshots.filter(
      (snapshot) => snapshot.snapshotTrigger === "ORDER_INTENT_CLICK",
    ).length,
    shownGuardrails: snapshots.filter(hasShownGuardrail).length,
    reactions: linkedReactions.length,
    proceedCount: reactionCounts.proceedCount,
    reviewCount: reactionCounts.reviewCount,
    closeCount: reactionCounts.closeCount,
    answeredFeedbacks: answeredFeedbacks.length,
    plannedFeedbacks: answeredFeedbacks.filter(
      (feedback) => feedback.selfAssessment === "PLANNED",
    ).length,
    regrettedFeedbacks: answeredFeedbacks.filter(
      (feedback) => feedback.selfAssessment === "EMOTIONAL",
    ).length,
    dismissedFeedbacks: latestFeedbacks.filter(
      (feedback) => feedback.feedbackStatus === "DISMISSED",
    ).length,
    confirmedTrades: (sources.trades || []).length,
    uniqueMarkets: new Set(snapshots.map((snapshot) => snapshot.market).filter(Boolean)).size,
  };
}

function buildWeeklyDailyBreakdown(params) {
  const period = params.period || getWeeklyPeriod();
  const sources = params.sources || {};
  const latestFeedbacks = getLatestEffectiveFeedbacks(sources.feedbacks || []);
  const reactions = getLinkedGuardrailReactions(sources);
  const days = [];
  for (let index = 0; index < 7; index += 1) {
    const fromMs = toTimeMs(period.periodStart) + index * DAY_MS;
    const toMs = fromMs + DAY_MS;
    const date = toKstDateString(fromMs);
    const snapshots = (sources.snapshots || []).filter(
      (snapshot) => toTimeMs(snapshot.capturedAt) >= fromMs && toTimeMs(snapshot.capturedAt) < toMs,
    );
    const dayReactions = reactions.filter(
      (reaction) => toTimeMs(reaction.reactedAt) >= fromMs && toTimeMs(reaction.reactedAt) < toMs,
    );
    const feedbacks = latestFeedbacks.filter(
      (feedback) => toTimeMs(feedback.respondedAt) >= fromMs && toTimeMs(feedback.respondedAt) < toMs,
    );
    const answered = feedbacks.filter((feedback) => feedback.feedbackStatus === "ANSWERED");
    const trades = (sources.trades || []).filter(
      (trade) => toTimeMs(trade.orderCreatedAt) >= fromMs && toTimeMs(trade.orderCreatedAt) < toMs,
    );
    const breakdown = {
      date,
      orderAttemptCount: snapshots.filter(
        (snapshot) => snapshot.snapshotTrigger === "ORDER_INTENT_CLICK",
      ).length,
      shownGuardrailCount: snapshots.filter(hasShownGuardrail).length,
      proceedCount: dayReactions.filter((reaction) => reaction.action === "PROCEED").length,
      reviewCount: dayReactions.filter((reaction) => reaction.action === "REVIEW").length,
      closeCount: dayReactions.filter((reaction) => reaction.action === "CLOSE").length,
      plannedFeedbackCount: answered.filter(
        (feedback) => feedback.selfAssessment === "PLANNED",
      ).length,
      regrettedFeedbackCount: answered.filter(
        (feedback) => feedback.selfAssessment === "EMOTIONAL",
      ).length,
      confirmedTradeCount: trades.length,
      active: false,
    };
    breakdown.active =
      breakdown.orderAttemptCount > 0 ||
      breakdown.shownGuardrailCount > 0 ||
      breakdown.plannedFeedbackCount > 0 ||
      breakdown.regrettedFeedbackCount > 0 ||
      breakdown.confirmedTradeCount > 0;
    days.push(breakdown);
  }
  return days;
}

function extractSideLiteral(expression) {
  if (!expression || typeof expression !== "object") return null;
  if (
    expression.nodeType === "CONDITION" &&
    expression.leftField === "side" &&
    expression.operator === "EQ" &&
    expression.rightOperand?.operandType === "LITERAL"
  ) {
    return expression.rightOperand.value;
  }
  if (expression.nodeType === "GROUP") {
    const values = new Set(
      (expression.children || []).map(extractSideLiteral).filter(Boolean),
    );
    return values.size === 1 ? [...values][0] : null;
  }
  return null;
}

function getSnapshotRuleSnapshot(snapshot, ruleId) {
  const candidates = [
    ...(Array.isArray(snapshot.ruleSnapshots) ? snapshot.ruleSnapshots : []),
    ...(Array.isArray(snapshot.ruleEvaluationSnapshots) ? snapshot.ruleEvaluationSnapshots : []),
    snapshot.ruleSnapshot,
  ].filter(Boolean);
  return candidates.find((rule) => rule.ruleId === ruleId) || null;
}

function buildWeeklyOrderFlows(params) {
  const diagnostics = [];
  const baseFlows = buildOrderFlows(params);
  const snapshotsById = new Map(
    (params.snapshots || []).map((snapshot) => [snapshot.snapshotId, snapshot]),
  );
  return baseFlows
    .map((flow) => {
      const ruleIds = [];
      const ruleNames = [];
      for (const snapshotId of flow.snapshotIds || []) {
        const snapshot = snapshotsById.get(snapshotId);
        const shownRuleIds = Array.isArray(snapshot?.shownRuleIds) && snapshot.shownRuleIds.length > 0
          ? snapshot.shownRuleIds
          : [snapshot?.primaryShownRuleId].filter(Boolean);
        for (const ruleId of shownRuleIds) {
          const ruleSnapshot = getSnapshotRuleSnapshot(snapshot, ruleId);
          if (!ruleSnapshot) continue;
          const expressionSide = extractSideLiteral(ruleSnapshot.expression);
          if (
            expressionSide &&
            flow.side &&
            ["BUY", "SELL"].includes(expressionSide) &&
            expressionSide !== flow.side
          ) {
            diagnostics.push({
              type: "RULE_SIDE_MISMATCH",
              flowId: flow.flowId,
              snapshotId,
              ruleId,
              flowSide: flow.side,
              ruleSide: expressionSide,
            });
            continue;
          }
          if (!ruleIds.includes(ruleId)) {
            ruleIds.push(ruleId);
            ruleNames.push(ruleSnapshot.name || ruleSnapshot.ruleName || ruleId);
          }
        }
      }
      const linkConfidence = (flow.events || []).every((event) => event.linkConfidence === "EXACT")
        ? "EXACT"
        : (flow.events || []).some((event) => event.linkConfidence === "INFERRED")
          ? "INFERRED"
          : "UNRESOLVED";
      return {
        ...flow,
        linkConfidence,
        guardrail: {
          ...flow.guardrail,
          shown: ruleIds.length > 0 || flow.guardrail.shown,
          ruleIds,
          ruleNames,
        },
      };
    })
    .sort((left, right) => toTimeMs(left.startedAt) - toTimeMs(right.startedAt))
    .map((flow) => ({ ...flow, diagnostics }));
}

function decimalOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  try {
    const decimal = new Decimal(value);
    return decimal.isFinite() && decimal.gt(0) ? decimal : null;
  } catch {
    return null;
  }
}

function resolveEntry(snapshot) {
  const intentPrice = decimalOrNull(snapshot.intentPrice);
  const tradePriceAtSnapshot = decimalOrNull(snapshot.tradePriceAtSnapshot);
  const entryPrice =
    snapshot.orderMode === "MARKET"
      ? tradePriceAtSnapshot || intentPrice
      : intentPrice || tradePriceAtSnapshot;
  if (!entryPrice) return null;
  const quantity =
    decimalOrNull(snapshot.intentQuantity) ||
    (decimalOrNull(snapshot.intentAmount)
      ? decimalOrNull(snapshot.intentAmount).div(entryPrice)
      : null);
  if (!quantity) return null;
  return { entryPrice, quantity };
}

function makeTwentyFourHourNote(side, value) {
  const absolute = value.abs().toFixed();
  if (side === "BUY") {
    return value.lt(0)
      ? `당시 주문했다면 24시간 후 약 ${absolute}원의 가상 가격 하락이 있었어요.`
      : `당시 주문했다면 24시간 후 약 ${absolute}원의 가상 가격 상승이 있었어요.`;
  }
  return value.lt(0)
    ? `당시 매도했다면 24시간 후 보유 대비 약 ${absolute}원의 불리한 가격 차이가 있었어요.`
    : `당시 매도했다면 24시간 후 보유 대비 약 ${absolute}원의 유리한 가격 차이가 있었어요.`;
}

async function computeTwentyFourHourVirtualOrderResult(params) {
  const generatedAtMs = toTimeMs(params.generatedAt || new Date());
  const items = [];
  let notMaturedCount = 0;
  let missingPriceCount = 0;
  let missingEntryCount = 0;
  const snapshots = (params.snapshots || []).filter(
    (snapshot) =>
      snapshot.snapshotTrigger === "ORDER_INTENT_CLICK" &&
      ["BUY", "SELL"].includes(snapshot.side),
  );

  for (const snapshot of snapshots) {
    const capturedAtMs = toTimeMs(snapshot.capturedAt);
    const targetMs = capturedAtMs + DAY_MS;
    if (targetMs > generatedAtMs) {
      notMaturedCount += 1;
      continue;
    }
    const entry = resolveEntry(snapshot);
    if (!entry) {
      missingEntryCount += 1;
      continue;
    }
    const priceAt24h = await params
      .getPriceNear(snapshot.market, new Date(targetMs).toISOString(), {
        toleranceMs: params.toleranceMs || PRICE_LOOKUP_TOLERANCE_MS,
      })
      .catch(() => null);
    const price = decimalOrNull(priceAt24h?.price ?? priceAt24h);
    if (!price) {
      missingPriceCount += 1;
      continue;
    }
    const delta =
      snapshot.side === "BUY"
        ? price.minus(entry.entryPrice)
        : entry.entryPrice.minus(price);
    const amount = entry.quantity.mul(delta);
    items.push({
      snapshotId: snapshot.snapshotId,
      capturedAt: snapshot.capturedAt,
      targetAt: new Date(targetMs).toISOString(),
      matchedPriceAt: priceAt24h?.matchedAt || new Date(targetMs).toISOString(),
      market: snapshot.market,
      side: snapshot.side,
      entryPrice: entry.entryPrice.toFixed(),
      priceAt24h: price.toFixed(),
      quantity: entry.quantity.toFixed(),
      value: amount.toFixed(),
      returnRate: delta.div(entry.entryPrice).toNumber(),
      note: makeTwentyFourHourNote(snapshot.side, amount),
    });
  }

  const net = items.reduce((sum, item) => sum.plus(item.value), new Decimal(0));
  return {
    status: items.length > 0 ? "AVAILABLE" : missingEntryCount || missingPriceCount ? "INSUFFICIENT_DATA" : "NO_MATCHING_DATA",
    sampleCount: items.length,
    notMaturedCount,
    missingPriceCount,
    missingEntryCount,
    netValue: net.toFixed(),
    items,
    disclaimer:
      "각 주문 시도 시점의 입력 가격과 24시간 후 공개 시장 가격을 비교한 가상 결과입니다. 명시적인 주문 취소나 가드레일의 인과 효과를 뜻하지 않습니다.",
  };
}

function median(values) {
  const sorted = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

function buildWeeklyMetrics(params) {
  const waiting = computeWaitingPriceEffect(params.sources);
  const waitingRates = (waiting.items || [])
    .map((item) => Number(item.priceEffectRate))
    .filter(Number.isFinite);
  const reduced = computeReducedExposure(params.sources);
  const reducedAmounts = (reduced.items || [])
    .map((item) => Number(item.reducedExposureAmount))
    .filter(Number.isFinite);
  return {
    twentyFourHourVirtualOrderResult: params.twentyFourHourVirtualOrderResult,
    waitingPriceEffect: {
      ...waiting,
      medianPriceDifferenceRate: median(waitingRates),
      favorableCount: waitingRates.filter((value) => value > 0).length,
      unfavorableCount: waitingRates.filter((value) => value < 0).length,
    },
    reducedExposure: {
      ...reduced,
      medianReducedExposureAmount: median(reducedAmounts),
    },
    feedbackPnlComparison: computeFeedbackPnlComparison(params.sources),
  };
}

function buildWeeklyInputHash(params) {
  const sources = params.sources || {};
  const recordDigest = {
    weekKey: params.period.weekKey,
    periodStart: params.period.periodStart,
    periodEnd: params.period.periodEnd,
    promptVersion: WEEKLY_PROMPT_VERSION,
    analysisVersion: WEEKLY_ANALYSIS_VERSION,
    algorithmVersion: WEEKLY_GUARDRAIL_SUGGESTION_ALGORITHM_VERSION,
    weeklyReportSchemaVersion: WEEKLY_REPORT_SCHEMA_VERSION,
    snapshots: (sources.snapshots || []).map((item) => ({
      id: item.snapshotId,
      updatedAt: item.updatedAt,
      trigger: item.snapshotTrigger,
    })),
    reactions: getLinkedGuardrailReactions(sources).map((item) => ({
      id: item.reactionId,
      updatedAt: item.updatedAt,
      action: item.action,
    })),
    feedbacks: getLatestEffectiveFeedbacks(sources.feedbacks || []).map((item) => ({
      id: item.feedbackId,
      attemptId: item.attemptId,
      updatedAt: item.updatedAt,
      status: item.feedbackStatus,
      selfAssessment: item.selfAssessment,
    })),
    trades: (sources.trades || []).map((item) => ({
      id: item.tradeLogId,
      updatedAt: item.updatedAt,
      state: item.state,
      outcomeObservedAt: item.outcomeObservedAt,
    })),
    rules: (sources.rules || []).map((item) => ({
      id: item.ruleId,
      updatedAt: item.updatedAt,
      isEnabled: item.isEnabled,
    })),
  };
  return crypto.createHash("sha256").update(stableJson(recordDigest)).digest("hex");
}

function buildWeeklyFactSummaries(params) {
  const { period, sourceCounts, dailyBreakdown, metrics, availability } = params;
  const periodLabel = `${formatKoreanPeriodDate(period.periodStart)} ~ ${formatKoreanPeriodDate(period.periodEnd)}`;
  return [
    "--- 주간 기간 ---",
    `${periodLabel}. 주간 상태는 ${period.periodState === "OPEN" ? "진행 중" : "종료"}이며 활동일은 ${sourceCounts.activeDays}일이다.`,
    "--- 관찰 ---",
    `주문 시도 ${sourceCounts.orderAttempts}회, 실제 표시된 가드레일 ${sourceCounts.shownGuardrails}회, 가드레일 반응 ${sourceCounts.reactions}회.`,
    `PROCEED ${sourceCounts.proceedCount}회, REVIEW ${sourceCounts.reviewCount}회, CLOSE ${sourceCounts.closeCount}회.`,
    `답변 피드백 ${sourceCounts.answeredFeedbacks}회, 계획적 거래 ${sourceCounts.plannedFeedbacks}회, 후회가 남는 거래 ${sourceCounts.regrettedFeedbacks}회, 건너뛴 피드백 ${sourceCounts.dismissedFeedbacks}회.`,
    `확인된 실제 주문 데이터 ${sourceCounts.confirmedTrades}회, 고유 거래 종목 ${sourceCounts.uniqueMarkets}개.`,
    "--- 일별 집계 ---",
    ...dailyBreakdown.map(
      (day) =>
        `${day.date}: 주문 시도 ${day.orderAttemptCount}, 가드레일 ${day.shownGuardrailCount}, PROCEED ${day.proceedCount}, REVIEW ${day.reviewCount}, CLOSE ${day.closeCount}, 계획 피드백 ${day.plannedFeedbackCount}, 후회 피드백 ${day.regrettedFeedbackCount}, 실제 주문 ${day.confirmedTradeCount}.`,
    ),
    "--- 계산 ---",
    `24시간 가상 주문 결과 비교 표본 ${metrics.twentyFourHourVirtualOrderResult.sampleCount}건, 24시간 비교 시점 미도래 ${metrics.twentyFourHourVirtualOrderResult.notMaturedCount}건, 순 가상 가격 변화 ${metrics.twentyFourHourVirtualOrderResult.netValue}.`,
    `기다린 가격 효과 비교 표본 ${metrics.waitingPriceEffect.sampleCount}건, 유리한 방향 ${metrics.waitingPriceEffect.favorableCount || 0}건, 불리한 방향 ${metrics.waitingPriceEffect.unfavorableCount || 0}건.`,
    `줄인 주문 금액 비교 표본 ${metrics.reducedExposure.sampleCount}건, 총 ${metrics.reducedExposure.totalReducedExposureAmount || 0}.`,
    `피드백별 결과 비교 상태 ${metrics.feedbackPnlComparison.status}. 같은 결과 기준을 가진 표본만 비교한다.`,
    "--- 분석 가능 여부 ---",
    `주문 행동: ${availability.orderInfo.available ? "가능" : "불가"}. 가드레일 반응: ${availability.guardrailBehavior.available ? "가능" : "불가"}. 수수료: ${availability.fee.available ? "가능" : "불가"}. 실제 체결 성과: ${availability.personalTrade.available ? "가능" : "불가"}. 시장 맥락: ${availability.marketContext.available ? "부분 가능" : "불가"}.`,
    "--- 강제 규칙 ---",
    "제공된 관찰값과 계산 결과만 사용한다. 입력에 없는 사실, 횟수, 가격, 수익률, 원인을 생성하지 않는다.",
    "이번 주 주문 행동, 이번 주 기록에서 반복된 패턴, 다음 주에 확인할 원칙이라는 표현을 사용한다.",
    "고정된 투자 성격, 충동적 투자자, 감정적 투자자, 이성적인 투자자, 귀를 닫은 트레이더라고 표현하지 않는다.",
    sourceCounts.activeDays < 3 || sourceCounts.answeredFeedbacks < 10
      ? "활동일이 3일 미만이거나 답변 피드백이 10건 미만이면 주간 반복 성향으로 단정하지 말고 이번 주에 관찰된 참고 패턴이라고 표현한다."
      : "여러 거래일에서 반복된 주문 방식을 신중하게 표현할 수 있다.",
    sourceCounts.uniqueMarkets <= 1
      ? "한 종목의 주문 기록만으로 전체 포트폴리오 분산을 평가하지 않는다."
      : "고유 종목 수는 관찰값으로만 사용한다.",
    sourceCounts.confirmedTrades <= 0
      ? "실제 주문 데이터가 없으면 체결, 미체결, 주문 실패, 수수료, 손익을 단정하지 않는다."
      : "실제 주문 데이터가 있는 항목만 체결 결과로 표현한다.",
  ].slice(0, 80);
}

function sanitizeWeeklyOverview(overview, availability, sourceCounts) {
  const sanitized = sanitizeOverviewWithAvailability(overview, availability);
  if (!sanitized) return null;
  const replaceDaily = (text) =>
    String(text || "")
      .replace(/오늘/g, "이번 주")
      .replace(/하루/g, "이번 주 기록");
  return {
    ...sanitized,
    summary:
      sourceCounts.activeDays < 3
        ? "이번 주 기록은 일부 거래일에 집중되어 있어 주간 반복 패턴으로 단정하지 않았어요. 이번 주에 관찰된 참고 패턴만 정리했어요."
        : replaceDaily(sanitized.summary),
    cards: (sanitized.cards || []).map((card) => ({
      ...card,
      title: replaceDaily(card.title),
      description: replaceDaily(card.description),
    })),
  };
}

function sanitizeWeeklyFieldAnalysis(fieldAnalysis, availability, sourceCounts) {
  const sanitized = sanitizeFieldAnalysisWithAvailability(fieldAnalysis, availability);
  if (!sanitized) return null;
  return {
    ...sanitized,
    topics: (sanitized.topics || []).map((topic) => {
      if (sourceCounts.uniqueMarkets <= 1 && topic.topic_key === "ORDER_INFO") {
        return {
          ...topic,
          headline: "한 종목 기록",
          analysis:
            "이번 주에는 한 종목의 주문 기록이 수집됐어요. 이 기록만으로 전체 투자 종목 구성을 판단하지 않았어요.",
          severity: "unavailable",
        };
      }
      if (!availability.behaviorTiming.available && topic.topic_key === "BEHAVIOR_TIMING") {
        return {
          ...topic,
          headline: "주문 작성 시간 데이터 부족",
          analysis: "주문 작성 시간을 비교할 기록이 충분하지 않아요.",
          severity: "unavailable",
        };
      }
      if (!availability.personalTrade.available && topic.topic_key === "PERSONAL_API") {
        return {
          ...topic,
          headline: "실제 주문 데이터 부족",
          analysis: "실제 주문 데이터가 없어 체결 결과와 수수료는 분석하지 않았어요.",
          severity: "unavailable",
        };
      }
      return {
        ...topic,
        headline: String(topic.headline || "").replace(/오늘/g, "이번 주"),
        analysis: String(topic.analysis || "").replace(/오늘/g, "이번 주"),
      };
    }),
    oneLineAdvice: String(sanitized.oneLineAdvice || "").replace(/오늘/g, "이번 주"),
  };
}

function buildWeeklyGuardrailSuggestionRequest(params) {
  const request = buildGuardrailSuggestionRequest({
    date: params.period.weekKey,
    timezone: params.period.timezone,
    generatedAt: params.generatedAt,
    sources: params.sources,
    fieldCatalog: params.fieldCatalog,
    maxHistoryDays: params.maxHistoryDays || 90,
    minTotalLabeledSamples: params.minTotalLabeledSamples || 20,
    minRegrettedSamples: params.minRegrettedSamples || 5,
    minClusterSamples: params.minClusterSamples || 5,
  });
  return {
    ...request,
    week_key: params.period.weekKey,
    period_start: params.period.periodStart,
    period_end: params.period.periodEnd,
  };
}

module.exports = {
  PRICE_LOOKUP_TOLERANCE_MS,
  REQUIRED_WEEKLY_FEEDBACK_COUNT,
  WEEKLY_ANALYSIS_VERSION,
  WEEKLY_GUARDRAIL_SUGGESTION_ALGORITHM_VERSION,
  WEEKLY_PROMPT_VERSION,
  WEEKLY_REPORT_SCHEMA_VERSION,
  buildWeeklyDailyBreakdown,
  buildWeeklyFactSummaries,
  buildWeeklyGuardrailSuggestionRequest,
  buildWeeklyInputHash,
  buildWeeklyMetrics,
  buildWeeklyOrderFlows,
  buildWeeklySourceCounts,
  computeInsightDataAvailability,
  computeTwentyFourHourVirtualOrderResult,
  getPreviousWeeklyPeriod,
  getWeeklyPeriod,
  isInRange,
  sanitizeWeeklyFieldAnalysis,
  sanitizeWeeklyOverview,
  toIsoString,
  toKstDateString,
  toTimeMs,
};
