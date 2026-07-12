/* eslint-disable @typescript-eslint/no-require-imports */
const crypto = require("crypto");
const Decimal = require("decimal.js");

const DEFAULT_TIMEZONE = "Asia/Seoul";
const REQUIRED_FEEDBACK_COUNT = 5;
const ANALYSIS_VERSION = "daily-v2";
const AI_PROMPT_VERSION = "daily-prompt-v3";
const GUARDRAIL_SUGGESTION_ALGORITHM_VERSION = "guardrail-suggestions-v2";
// 가드레일 반응 뒤 동일 market/side 주문 흐름이 이어졌는지 보는 보수적 유예 시간.
// 이 창 안에 ORDER_INTENT_CLICK 또는 ConfirmedTradeLog가 있으면 "진행하지 않음"으로 보지 않는다.
const GUARDRAIL_FOLLOW_UP_WINDOW_MS = 10 * 60 * 1000;
const VIRTUAL_PNL_DISCLAIMER =
  "Snapshot 당시 주문 입력값과 리포트 생성 시점의 시장 가격을 이용한 가상 계산이며 실제 체결가, 수수료, 슬리피지를 완전히 반영하지 않을 수 있습니다. 명시적인 주문 취소 이벤트가 없는 항목은 가드레일 반응과 이후 주문 기록을 이용한 추정 결과입니다.";

function toTimeMs(value) {
  if (!value) return 0;
  if (value instanceof Date) return value.getTime();
  if (typeof value === "object" && typeof value.toDate === "function") {
    return value.toDate().getTime();
  }
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

function toIsoString(value) {
  const ms = toTimeMs(value);
  return ms > 0 ? new Date(ms).toISOString() : new Date().toISOString();
}

function parseDateParts(date) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date || "");
  if (!match) {
    throw new Error("INVALID_REPORT_DATE");
  }
  return {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
  };
}

function getDailyRange(date, timezone = DEFAULT_TIMEZONE) {
  const { year, month, day } = parseDateParts(date);
  if (timezone !== "Asia/Seoul") {
    const from = new Date(Date.UTC(year, month - 1, day, 0, 0, 0, 0));
    const to = new Date(Date.UTC(year, month - 1, day + 1, 0, 0, 0, 0));
    return { from: from.toISOString(), to: to.toISOString() };
  }

  const kstOffsetMs = 9 * 60 * 60 * 1000;
  const from = new Date(Date.UTC(year, month - 1, day, 0, 0, 0, 0) - kstOffsetMs);
  const to = new Date(Date.UTC(year, month - 1, day + 1, 0, 0, 0, 0) - kstOffsetMs);
  return { from: from.toISOString(), to: to.toISOString() };
}

function isInRange(value, from, to, inclusiveTo = false) {
  const ms = toTimeMs(value);
  const fromMs = toTimeMs(from);
  const toMs = toTimeMs(to);
  if (ms < fromMs) return false;
  return inclusiveTo ? ms <= toMs : ms < toMs;
}

function latestByKey(records, keyFn, updatedAtFn) {
  const map = new Map();
  for (const record of records || []) {
    const key = keyFn(record);
    if (!key) continue;
    const current = map.get(key);
    if (!current || updatedAtFn(record) >= updatedAtFn(current)) {
      map.set(key, record);
    }
  }
  return Array.from(map.values());
}

function getLatestEffectiveFeedbacks(feedbacks) {
  return latestByKey(
    feedbacks,
    (feedback) => feedback.attemptId || feedback.feedbackId,
    (feedback) => toTimeMs(feedback.updatedAt || feedback.respondedAt),
  );
}

function countAnsweredFeedbacksForDate(feedbacks, date, timezone = DEFAULT_TIMEZONE) {
  const range = getDailyRange(date, timezone);
  return getLatestEffectiveFeedbacks(feedbacks).filter(
    (feedback) =>
      feedback.feedbackStatus === "ANSWERED" &&
      isInRange(feedback.respondedAt, range.from, range.to),
  ).length;
}

function computeEligibility(params) {
  const answeredFeedbackCount = countAnsweredFeedbacksForDate(
    params.feedbacks,
    params.date,
    params.timezone,
  );
  const report = params.report || null;
  const hasNewData = Boolean(
    report?.inputHash &&
      params.inputHash &&
      ["COMPLETED", "PARTIAL"].includes(report.status) &&
      report.inputHash !== params.inputHash,
  );
  const reportStatus = report
    ? hasNewData
      ? "STALE"
      : report.status
    : "NOT_CREATED";

  return {
    date: params.date,
    eligible: true,
    answeredFeedbackCount,
    requiredFeedbackCount: REQUIRED_FEEDBACK_COUNT,
    reportStatus,
    reportId: report?.reportId || null,
    hasNewData,
  };
}

function hasShownGuardrail(snapshot) {
  return (
    (Array.isArray(snapshot.shownRuleIds) && snapshot.shownRuleIds.length > 0) ||
    snapshot.primaryShownRuleId != null
  );
}

function getLinkedGuardrailReactions(sources) {
  const snapshotsById = new Map((sources.snapshots || []).map((snapshot) => [snapshot.snapshotId, snapshot]));
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

function sideLabel(side) {
  if (side === "BUY") return "매수";
  if (side === "SELL") return "매도";
  return "방향 미확인";
}

function buildDailyTimeline(params) {
  const events = [];

  for (const snapshot of params.snapshots || []) {
    const isGuardrail = snapshot.snapshotTrigger === "GUARDRAIL_SHOWN";
    events.push({
      id: `snapshot:${snapshot.snapshotId}`,
      type: isGuardrail ? "GUARDRAIL_TRIGGERED" : "ORDER_ATTEMPT",
      occurredAt: snapshot.capturedAt,
      snapshotId: snapshot.snapshotId,
      attemptId: snapshot.attemptId || null,
      tradeLogId: null,
      market: snapshot.market || null,
      side: snapshot.side || null,
      title: isGuardrail ? "가드레일 발생" : "주문 시도",
      description: isGuardrail
        ? `${snapshot.market} ${sideLabel(snapshot.side)} 주문에서 사용자가 세운 원칙이 표시됐어요.`
        : `${snapshot.market} ${sideLabel(snapshot.side)} 주문 의도가 기록됐어요.`,
      linkConfidence: "EXACT",
    });
  }

  const snapshotsById = new Map((params.snapshots || []).map((snapshot) => [snapshot.snapshotId, snapshot]));
  for (const reaction of getLinkedGuardrailReactions(params)) {
    const snapshot = snapshotsById.get(reaction.snapshotId);
    events.push({
      id: `reaction:${reaction.reactionId}`,
      type: "GUARDRAIL_REACTION",
      occurredAt: reaction.reactedAt,
      snapshotId: reaction.snapshotId,
      attemptId: snapshot?.attemptId || null,
      tradeLogId: null,
      market: snapshot?.market || null,
      side: snapshot?.side || null,
      title: "가드레일 선택",
      description: `사용자가 ${reaction.action === "PROCEED" ? "계속 진행" : reaction.action === "REVIEW" ? "주문 내용 다시 보기" : "가드레일 닫기"}를 선택했어요.`,
      linkConfidence: snapshot ? "EXACT" : "INFERRED",
    });
  }

  for (const feedback of params.feedbacks || []) {
    events.push({
      id: `feedback:${feedback.feedbackId}`,
      type: "FEEDBACK_SUBMITTED",
      occurredAt: feedback.respondedAt,
      snapshotId: null,
      attemptId: feedback.attemptId,
      tradeLogId: null,
      market: null,
      side: null,
      title: "피드백 작성",
      description:
        feedback.feedbackStatus === "ANSWERED"
          ? `사용자가 ${feedback.selfAssessment === "PLANNED" ? "계획적이었다고" : "후회가 남는 거래였다고"} 기록했어요.`
          : "사용자가 피드백을 건너뛰었어요.",
      linkConfidence: "EXACT",
    });
  }

  for (const trade of params.trades || []) {
    events.push({
      id: `trade-created:${trade.tradeLogId}`,
      type: "ORDER_CREATED",
      occurredAt: trade.orderCreatedAt,
      snapshotId: null,
      attemptId: trade.attemptId || null,
      tradeLogId: trade.tradeLogId,
      market: trade.market,
      side: trade.side,
      title: "실제 주문 확인",
      description: `${trade.market} ${sideLabel(trade.side)} 주문 UUID가 확인됐어요.`,
      linkConfidence: trade.attemptId ? "EXACT" : "INFERRED",
    });

    if (trade.outcomeObservedAt || trade.state) {
      events.push({
        id: `trade-updated:${trade.tradeLogId}`,
        type: "ORDER_UPDATED",
        occurredAt: trade.outcomeObservedAt || trade.updatedAt || trade.orderCreatedAt,
        snapshotId: null,
        attemptId: trade.attemptId || null,
        tradeLogId: trade.tradeLogId,
        market: trade.market,
        side: trade.side,
        title: "체결 결과 갱신",
        description: `주문 상태가 ${trade.state || "확인됨"} 상태로 갱신됐어요.`,
        linkConfidence: trade.attemptId ? "EXACT" : "INFERRED",
      });
    }
  }

  return events.sort((a, b) => toTimeMs(a.occurredAt) - toTimeMs(b.occurredAt));
}

function getRuleNameMap(rules) {
  const map = new Map();
  for (const rule of rules || []) {
    if (rule?.ruleId) map.set(rule.ruleId, rule.name || rule.warningTitle || rule.ruleId);
  }
  return map;
}

function reactionActionLabel(action) {
  if (action === "PROCEED") return "계속 진행을 선택했어요.";
  if (action === "REVIEW") return "주문 내용을 다시 확인했어요.";
  if (action === "CLOSE") return "경고 창을 닫았어요.";
  return null;
}

function feedbackLabel(feedback) {
  if (!feedback) return null;
  if (feedback.feedbackStatus === "DISMISSED") return "DISMISSED";
  if (feedback.selfAssessment === "PLANNED") return "PLANNED";
  if (feedback.selfAssessment === "EMOTIONAL") return "REGRETTED";
  return null;
}

function makeFlowId(event) {
  return event.attemptId || event.snapshotId || event.tradeLogId || event.id;
}

function buildOrderFlows(params) {
  const timeline = params.timeline || buildDailyTimeline(params);
  const ruleNames = getRuleNameMap(params.rules || []);
  const snapshotsById = new Map((params.snapshots || []).map((snapshot) => [snapshot.snapshotId, snapshot]));
  const latestFeedbackByAttempt = new Map(
    getLatestEffectiveFeedbacks(params.feedbacks || []).map((feedback) => [feedback.attemptId, feedback]),
  );
  const tradeByAttempt = new Map();
  const tradeById = new Map();
  for (const trade of params.trades || []) {
    if (trade.tradeLogId) tradeById.set(trade.tradeLogId, trade);
    if (trade.attemptId && !tradeByAttempt.has(trade.attemptId)) {
      tradeByAttempt.set(trade.attemptId, trade);
    }
  }

  const flowMap = new Map();

  function getFlow(key) {
    if (!flowMap.has(key)) {
      flowMap.set(key, {
        flowId: key,
        startedAt: null,
        market: null,
        side: null,
        attemptId: null,
        snapshotIds: [],
        guardrail: {
          shown: false,
          ruleIds: [],
          ruleNames: [],
          reaction: null,
        },
        feedback: null,
        trade: {
          availability: "NOT_CONFIRMED",
          state: null,
          executedFunds: null,
          executedVolume: null,
          paidFee: null,
        },
        events: [],
      });
    }
    return flowMap.get(key);
  }

  for (const event of timeline) {
    const key = makeFlowId(event);
    const flow = getFlow(key);
    flow.events.push(event);
    flow.startedAt =
      !flow.startedAt || toTimeMs(event.occurredAt) < toTimeMs(flow.startedAt)
        ? event.occurredAt
        : flow.startedAt;
    flow.market = flow.market || event.market || null;
    flow.side = flow.side || event.side || null;
    flow.attemptId = flow.attemptId || event.attemptId || null;

    if (event.snapshotId) {
      if (!flow.snapshotIds.includes(event.snapshotId)) {
        flow.snapshotIds.push(event.snapshotId);
      }
      const snapshot = snapshotsById.get(event.snapshotId);
      const shownRuleIds = Array.isArray(snapshot?.shownRuleIds) && snapshot.shownRuleIds.length > 0
        ? snapshot.shownRuleIds
        : [snapshot?.primaryShownRuleId].filter(Boolean);
      if (shownRuleIds.length > 0) {
        flow.guardrail.shown = true;
        for (const ruleId of shownRuleIds) {
          if (!flow.guardrail.ruleIds.includes(ruleId)) {
            flow.guardrail.ruleIds.push(ruleId);
            flow.guardrail.ruleNames.push(ruleNames.get(ruleId) || ruleId);
          }
        }
      }
    }

    if (event.type === "GUARDRAIL_REACTION") {
      const action = event.description.includes("계속 진행")
        ? "PROCEED"
        : event.description.includes("다시")
          ? "REVIEW"
          : event.description.includes("닫")
            ? "CLOSE"
            : null;
      flow.guardrail.reaction = action || flow.guardrail.reaction;
      const sentence = reactionActionLabel(action);
      if (sentence) {
        event.description = sentence;
      }
    }

    if (event.type === "FEEDBACK_SUBMITTED" && event.attemptId) {
      flow.feedback = feedbackLabel(latestFeedbackByAttempt.get(event.attemptId));
    }

    if ((event.type === "ORDER_CREATED" || event.type === "ORDER_UPDATED")) {
      const trade = event.tradeLogId ? tradeById.get(event.tradeLogId) : null;
      flow.trade = {
        availability: "CONFIRMED",
        state: trade?.state || null,
        executedFunds: trade?.executedFunds || null,
        executedVolume: trade?.executedVolume || null,
        paidFee: trade?.paidFee || null,
      };
    }
  }

  for (const flow of flowMap.values()) {
    const trade = flow.attemptId ? tradeByAttempt.get(flow.attemptId) : null;
    if (trade) {
      flow.trade = {
        availability: "CONFIRMED",
        state: trade.state || null,
        executedFunds: trade.executedFunds || null,
        executedVolume: trade.executedVolume || null,
        paidFee: trade.paidFee || null,
      };
    } else if (params.privateApiAvailable === false) {
      flow.trade.availability = "PRIVATE_API_UNAVAILABLE";
    }
  }

  return Array.from(flowMap.values())
    .map((flow) => ({
      ...flow,
      startedAt: flow.startedAt || new Date().toISOString(),
      events: flow.events.sort((a, b) => toTimeMs(a.occurredAt) - toTimeMs(b.occurredAt)),
    }))
    .sort((a, b) => {
      const score = (flow) =>
        (flow.feedback === "REGRETTED" ? 8 : 0) +
        (flow.guardrail.reaction === "PROCEED" ? 4 : 0) +
        (flow.trade.availability === "CONFIRMED" ? 2 : 0);
      return score(b) - score(a) || toTimeMs(b.startedAt) - toTimeMs(a.startedAt);
    });
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

function findOrderCandidatesAfter(snapshot, snapshots, trades, graceMs = GUARDRAIL_FOLLOW_UP_WINDOW_MS) {
  const startMs = toTimeMs(snapshot.capturedAt);
  const endMs = startMs + graceMs;
  const snapshotCandidates = (snapshots || []).filter((candidate) => {
    if (candidate.snapshotId === snapshot.snapshotId) return false;
    if (candidate.snapshotTrigger !== "ORDER_INTENT_CLICK") return false;
    const ms = toTimeMs(candidate.capturedAt);
    return (
      ms >= startMs &&
      ms <= endMs &&
      candidate.market === snapshot.market &&
      candidate.side === snapshot.side
    );
  });
  const tradeCandidates = (trades || []).filter((trade) => {
    const ms = toTimeMs(trade.orderCreatedAt);
    return (
      ms >= startMs &&
      ms <= endMs &&
      trade.market === snapshot.market &&
      trade.side === snapshot.side
    );
  });
  return [...snapshotCandidates, ...tradeCandidates];
}

function getLatestReaction(reactions) {
  return [...(reactions || [])].sort(
    (a, b) => toTimeMs(b.reactedAt || b.updatedAt) - toTimeMs(a.reactedAt || a.updatedAt),
  )[0] || null;
}

function resolveEntryPrice(snapshot) {
  const intentPrice = decimalOrNull(snapshot.intentPrice);
  const snapshotPrice = decimalOrNull(snapshot.tradePriceAtSnapshot);

  if (snapshot.orderMode === "MARKET" && snapshotPrice) {
    return {
      entryPrice: snapshotPrice,
      priceQuality: "APPROXIMATED",
    };
  }

  if (intentPrice) {
    return {
      entryPrice: intentPrice,
      priceQuality: "EXACT_INTENT",
    };
  }

  if (snapshotPrice) {
    return {
      entryPrice: snapshotPrice,
      priceQuality: "APPROXIMATED",
    };
  }

  return {
    entryPrice: null,
    priceQuality: null,
  };
}

function makeVirtualPnlNote(side, pnl) {
  const isPositive = pnl.gte(0);
  if (side === "BUY") {
    return isPositive
      ? "당시 매수했다면 현재 시점 기준으로 가격 상승 구간을 경험했을 수 있어요."
      : "당시 매수하지 않아 현재 시점 기준으로 발생했을 수 있는 가격 하락 노출을 피했어요.";
  }
  return isPositive
    ? "당시 매도했다면 현재까지 보유한 경우보다 유리한 가격 효과가 있었을 수 있어요."
    : "당시 매도했다면 이후 가격 상승 구간에는 참여하지 못했을 수 있어요.";
}

async function computeCancelledOrderVirtualPnl(params) {
  const to = params.generatedAt || new Date().toISOString();
  const from = new Date(toTimeMs(to) - 24 * 60 * 60 * 1000).toISOString();
  const reactionsBySnapshot = new Map();
  for (const reaction of params.reactions || []) {
    const list = reactionsBySnapshot.get(reaction.snapshotId) || [];
    list.push(reaction);
    reactionsBySnapshot.set(reaction.snapshotId, list);
  }

  const items = [];
  let hadInsufficientData = false;
  const priceCache = new Map();

  async function getCachedCurrentPrice(market) {
    if (!priceCache.has(market)) {
      priceCache.set(
        market,
        Promise.resolve()
          .then(() => params.getCurrentPrice(market))
          .then((price) => decimalOrNull(price))
          .catch(() => null),
      );
    }
    return priceCache.get(market);
  }

  for (const snapshot of params.snapshots || []) {
    if (!isInRange(snapshot.capturedAt, from, to, true)) continue;
    if (!hasShownGuardrail(snapshot)) continue;
    if (!["BUY", "SELL"].includes(snapshot.side)) continue;

    const reactions = reactionsBySnapshot.get(snapshot.snapshotId) || [];
    const latestReaction = getLatestReaction(reactions);
    if (!latestReaction) continue;
    if (latestReaction.action === "PROCEED") continue;
    if (!["REVIEW", "CLOSE"].includes(latestReaction.action)) continue;

    const orderCandidates = findOrderCandidatesAfter(
      snapshot,
      params.snapshots,
      params.trades,
      params.followUpWindowMs || GUARDRAIL_FOLLOW_UP_WINDOW_MS,
    );
    if (orderCandidates.length > 0) continue;

    const { entryPrice, priceQuality } = resolveEntryPrice(snapshot);
    if (!entryPrice) {
      hadInsufficientData = true;
      continue;
    }

    const directQuantity = decimalOrNull(snapshot.intentQuantity);
    const intentAmount = decimalOrNull(snapshot.intentAmount);
    const virtualQuantity = directQuantity || (intentAmount ? intentAmount.div(entryPrice) : null);
    if (!virtualQuantity) {
      hadInsufficientData = true;
      continue;
    }

    const currentPrice = await getCachedCurrentPrice(snapshot.market);

    if (!currentPrice) {
      hadInsufficientData = true;
      continue;
    }

    const priceDelta =
      snapshot.side === "BUY"
        ? currentPrice.minus(entryPrice)
        : entryPrice.minus(currentPrice);
    const virtualPnl = virtualQuantity.mul(priceDelta);
    const virtualReturnRate = priceDelta.div(entryPrice).toNumber();

    items.push({
      snapshotId: snapshot.snapshotId,
      capturedAt: snapshot.capturedAt,
      market: snapshot.market,
      side: snapshot.side,
      ruleIds: Array.isArray(snapshot.shownRuleIds) && snapshot.shownRuleIds.length > 0
        ? snapshot.shownRuleIds
        : [snapshot.primaryShownRuleId].filter(Boolean),
      classification: "INFERRED_NOT_PROCEEDED",
      entryPrice: entryPrice.toFixed(),
      currentPrice: currentPrice.toFixed(),
      virtualQuantity: virtualQuantity.toFixed(),
      virtualReturnRate,
      virtualPnl: virtualPnl.toFixed(),
      priceQuality,
      note: `${makeVirtualPnlNote(snapshot.side, virtualPnl)} 가드레일 반응 이후 동일한 주문 흐름이 확인되지 않았어요.`,
    });
  }

  if (items.length === 0) {
    return {
      status: hadInsufficientData ? "INSUFFICIENT_DATA" : "NO_MATCHING_DATA",
      window: { from, to },
      sampleCount: 0,
      totalPositiveVirtualPnl: "0",
      totalNegativeVirtualPnl: "0",
      netVirtualPnl: "0",
      items: [],
      disclaimer: VIRTUAL_PNL_DISCLAIMER,
    };
  }

  const totals = items.reduce(
    (acc, item) => {
      const pnl = new Decimal(item.virtualPnl);
      if (pnl.gte(0)) {
        acc.positive = acc.positive.plus(pnl);
      } else {
        acc.negative = acc.negative.plus(pnl);
      }
      acc.net = acc.net.plus(pnl);
      return acc;
    },
    { positive: new Decimal(0), negative: new Decimal(0), net: new Decimal(0) },
  );

  return {
    status: "AVAILABLE",
    window: { from, to },
    sampleCount: items.length,
    totalPositiveVirtualPnl: totals.positive.toFixed(),
    totalNegativeVirtualPnl: totals.negative.toFixed(),
    netVirtualPnl: totals.net.toFixed(),
    items,
    disclaimer: VIRTUAL_PNL_DISCLAIMER,
  };
}

function actualAveragePrice(trade) {
  const funds = decimalOrNull(trade.executedFunds);
  const volume = decimalOrNull(trade.executedVolume);
  if (!funds || !volume) return null;
  return funds.div(volume);
}

function findTradeForSnapshot(snapshot, trades) {
  const startMs = toTimeMs(snapshot.capturedAt);
  const candidates = (trades || []).filter((trade) => {
    if (trade.attemptId && snapshot.attemptId && trade.attemptId === snapshot.attemptId) return true;
    return (
      toTimeMs(trade.orderCreatedAt) >= startMs &&
      trade.market === snapshot.market &&
      trade.side === snapshot.side
    );
  });
  return candidates.length === 1 ? candidates[0] : null;
}

function computeWaitingPriceEffect(params) {
  const items = [];
  for (const snapshot of params.snapshots || []) {
    if (snapshot.snapshotTrigger !== "GUARDRAIL_SHOWN") continue;
    if (!["BUY", "SELL"].includes(snapshot.side)) continue;
    const originalPrice = decimalOrNull(snapshot.intentPrice) || decimalOrNull(snapshot.tradePriceAtSnapshot);
    if (!originalPrice) continue;
    const trade = findTradeForSnapshot(snapshot, params.trades);
    if (!trade) continue;
    const averagePrice = actualAveragePrice(trade);
    if (!averagePrice) continue;
    const effect =
      snapshot.side === "BUY"
        ? originalPrice.minus(averagePrice).div(originalPrice)
        : averagePrice.minus(originalPrice).div(originalPrice);
    items.push({
      snapshotId: snapshot.snapshotId,
      tradeLogId: trade.tradeLogId,
      market: snapshot.market,
      side: snapshot.side,
      originalPrice: originalPrice.toFixed(),
      actualAveragePrice: averagePrice.toFixed(),
      priceEffectRate: effect.toNumber(),
    });
  }
  return {
    status: items.length > 0 ? "AVAILABLE" : "NO_MATCHING_DATA",
    sampleCount: items.length,
    items,
    disclaimer: "이 결과는 수익 효과가 아니라 가드레일 이후 실제 체결된 가격의 관찰 비교입니다.",
  };
}

function computeReducedExposure(params) {
  const items = [];
  for (const snapshot of params.snapshots || []) {
    if (snapshot.snapshotTrigger !== "GUARDRAIL_SHOWN") continue;
    const originalIntentAmount = decimalOrNull(snapshot.intentAmount);
    if (!originalIntentAmount) continue;
    const trade = findTradeForSnapshot(snapshot, params.trades);
    if (!trade) continue;
    let actualOrderAmount = decimalOrNull(trade.requestedFunds) || decimalOrNull(trade.executedFunds);
    if (!actualOrderAmount && trade.side === "SELL") {
      const volume = decimalOrNull(trade.requestedVolume) || decimalOrNull(trade.executedVolume);
      const price = decimalOrNull(trade.limitPrice) || actualAveragePrice(trade);
      actualOrderAmount = volume && price ? volume.mul(price) : null;
    }
    if (!actualOrderAmount) continue;
    const reduced = Decimal.max(new Decimal(0), originalIntentAmount.minus(actualOrderAmount));
    if (reduced.lte(0)) continue;
    items.push({
      snapshotId: snapshot.snapshotId,
      tradeLogId: trade.tradeLogId,
      market: snapshot.market,
      side: snapshot.side,
      originalIntentAmount: originalIntentAmount.toFixed(),
      actualOrderAmount: actualOrderAmount.toFixed(),
      reducedExposureAmount: reduced.toFixed(),
    });
  }
  const total = items.reduce((sum, item) => sum.plus(item.reducedExposureAmount), new Decimal(0));
  return {
    status: items.length > 0 ? "AVAILABLE" : "NO_MATCHING_DATA",
    sampleCount: items.length,
    totalReducedExposureAmount: total.toFixed(),
    items,
    disclaimer: "경고 이후 주문 규모를 줄여 시장에 노출되는 금액을 낮춘 관찰값입니다. 손실 방지액이 아닙니다.",
  };
}

function median(values) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function computeFeedbackPnlComparison(params) {
  const feedbackByAttempt = new Map(
    getLatestEffectiveFeedbacks(params.feedbacks || [])
      .filter((feedback) => feedback.feedbackStatus === "ANSWERED")
      .map((feedback) => [feedback.attemptId, feedback]),
  );
  const groups = { PLANNED: [], EMOTIONAL: [] };
  for (const trade of params.trades || []) {
    if (!trade.attemptId) continue;
    const feedback = feedbackByAttempt.get(trade.attemptId);
    if (!feedback?.selfAssessment) continue;
    const averagePrice = actualAveragePrice(trade);
    const requestedPrice = decimalOrNull(trade.limitPrice);
    if (!averagePrice || !requestedPrice) continue;
    const rate =
      trade.side === "BUY"
        ? averagePrice.minus(requestedPrice).div(requestedPrice).neg()
        : averagePrice.minus(requestedPrice).div(requestedPrice);
    groups[feedback.selfAssessment].push(rate.toNumber());
  }

  function summarize(values) {
    const positives = values.filter((value) => value > 0).length;
    const negatives = values.filter((value) => value < 0).length;
    return {
      sampleCount: values.length,
      averageReturnRate:
        values.length > 0 ? values.reduce((sum, value) => sum + value, 0) / values.length : null,
      medianReturnRate: median(values),
      positiveResultRate: values.length > 0 ? positives / values.length : null,
      negativeResultRate: values.length > 0 ? negatives / values.length : null,
    };
  }

  const planned = summarize(groups.PLANNED);
  const emotional = summarize(groups.EMOTIONAL);
  const available = planned.sampleCount >= 2 && emotional.sampleCount >= 2;

  return {
    status: available ? "AVAILABLE" : "INSUFFICIENT_DATA",
    groups: {
      PLANNED: planned,
      EMOTIONAL: emotional,
    },
    disclaimer:
      "시장 상황, 종목, 주문 시점과 보유 기간을 통제하지 않은 단순 관찰 비교입니다. 이 결과만으로 특정 행동이 수익률을 높였다고 단정할 수 없습니다.",
  };
}

function buildSourceCounts(sources) {
  const guardrails = (sources.snapshots || []).filter(hasShownGuardrail).length;
  const reactions = getLinkedGuardrailReactions(sources).length;
  return {
    attempts: (sources.snapshots || []).filter((snapshot) => snapshot.snapshotTrigger === "ORDER_INTENT_CLICK").length,
    guardrails,
    reactions,
    guardrailSnapshots: guardrails,
    guardrailReactions: reactions,
    answeredFeedbacks: getLatestEffectiveFeedbacks(sources.feedbacks || []).filter(
      (feedback) => feedback.feedbackStatus === "ANSWERED",
    ).length,
    confirmedTrades: (sources.trades || []).length,
  };
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function buildInputHash(params) {
  const linkedReactions = getLinkedGuardrailReactions(params);
  const recordDigest = {
    date: params.date,
    aiPromptVersion: AI_PROMPT_VERSION,
    analysisVersion: ANALYSIS_VERSION,
    snapshots: (params.snapshots || []).map((item) => ({
      id: item.snapshotId,
      updatedAt: item.updatedAt,
      trigger: item.snapshotTrigger,
    })),
    reactions: linkedReactions.map((item) => ({
      id: item.reactionId,
      updatedAt: item.updatedAt,
      action: item.action,
    })),
    feedbacks: getLatestEffectiveFeedbacks(params.feedbacks || []).map((item) => ({
      id: item.feedbackId,
      attemptId: item.attemptId,
      updatedAt: item.updatedAt,
      status: item.feedbackStatus,
      selfAssessment: item.selfAssessment,
    })),
    trades: (params.trades || []).map((item) => ({
      id: item.tradeLogId,
      updatedAt: item.updatedAt,
      state: item.state,
      outcomeObservedAt: item.outcomeObservedAt,
    })),
    rules: (params.rules || []).map((item) => ({
      id: item.ruleId,
      updatedAt: item.updatedAt,
      isEnabled: item.isEnabled,
    })),
  };
  return crypto.createHash("sha256").update(stableJson(recordDigest)).digest("hex");
}

function hasMarketContext(snapshot) {
  return (
    snapshot.signedChangeRate != null ||
    snapshot.shortTermReturn5m != null ||
    snapshot.spreadRate != null ||
    snapshot.pricePositionIn5mRange != null ||
    snapshot.volumeSpikeRatio5m != null ||
    (Array.isArray(snapshot.marketRiskFlags) && snapshot.marketRiskFlags.length > 0)
  );
}

function computeInsightDataAvailability(sources) {
  const latestFeedbacks = getLatestEffectiveFeedbacks(sources.feedbacks || []);
  const answeredFeedbacks = latestFeedbacks.filter(
    (feedback) => feedback.feedbackStatus === "ANSWERED",
  );
  const snapshots = sources.snapshots || [];
  const trades = sources.trades || [];
  const markets = new Set(snapshots.map((snapshot) => snapshot.market).filter(Boolean));
  const linkedReactions = getLinkedGuardrailReactions(sources);
  const { reactionCount, proceedCount, reviewCount, closeCount } = countReactionActions(linkedReactions);
  const marketContextCount = snapshots.filter(hasMarketContext).length;
  const feeTrades = trades.filter(
    (trade) => decimalOrNull(trade.paidFee) && decimalOrNull(trade.executedFunds),
  );
  const personalTrades = trades.filter(
    (trade) => trade.state || decimalOrNull(trade.executedFunds) || decimalOrNull(trade.executedVolume),
  );
  const slippageTrades = trades.filter((trade) => {
    if (!actualAveragePrice(trade)) return false;
    const snapshot = (sources.snapshots || []).find(
      (candidate) =>
        trade.attemptId &&
        candidate.attemptId &&
        trade.attemptId === candidate.attemptId,
    );
    return Boolean(
      snapshot &&
        (decimalOrNull(snapshot.intentPrice) || decimalOrNull(snapshot.tradePriceAtSnapshot)),
    );
  });
  const timingSnapshots = snapshots.filter(
    (snapshot) =>
      snapshot.draftDurationMs != null ||
      snapshot.lastEditToSnapshotMs != null ||
      snapshot.orderbookClickToSnapshotMs != null,
  );

  return {
    planFeedback: {
      available: answeredFeedbacks.length > 0,
      sampleCount: answeredFeedbacks.length,
    },
    guardrailBehavior: {
      available: reactionCount > 0,
      shownGuardrailCount: snapshots.filter(hasShownGuardrail).length,
      reactionCount,
      proceedCount,
      reviewCount,
      closeCount,
    },
    orderInfo: {
      available: snapshots.length > 0,
      sampleCount: snapshots.length,
      uniqueMarketCount: markets.size,
    },
    behaviorTiming: {
      available: timingSnapshots.length > 0,
      sampleCount: timingSnapshots.length,
    },
    frequencyPattern: {
      available: snapshots.length > 0,
      sampleCount: snapshots.length,
    },
    marketContext: {
      available: marketContextCount > 0,
      sampleCount: marketContextCount,
    },
    personalTrade: {
      available: personalTrades.length > 0,
      sampleCount: personalTrades.length,
    },
    fee: {
      available: feeTrades.length > 0,
      sampleCount: feeTrades.length,
    },
    slippage: {
      available: slippageTrades.length > 0,
      sampleCount: slippageTrades.length,
    },
  };
}

function buildAvailabilitySummaryLines(availability) {
  return [
    "--- 데이터 상태 ---",
    `[데이터 상태-PLAN_FEEDBACK] ${availability.planFeedback.available ? "분석 가능" : "분석 불가"}. ANSWERED 피드백 ${availability.planFeedback.sampleCount}건.`,
    `[데이터 상태-GUARDRAIL_BEHAVIOR] ${availability.guardrailBehavior.available ? "분석 가능" : "분석 불가"}. 실제 표시된 가드레일 ${availability.guardrailBehavior.shownGuardrailCount || 0}건, 반응 ${availability.guardrailBehavior.reactionCount}건, PROCEED ${availability.guardrailBehavior.proceedCount}건, REVIEW ${availability.guardrailBehavior.reviewCount}건, CLOSE ${availability.guardrailBehavior.closeCount}건. PROCEED만 경고 후 계속 진행으로 본다.`,
    `[데이터 상태-ORDER_INFO] ${availability.orderInfo.available ? "분석 가능" : "분석 불가"}. 주문 스냅샷 ${availability.orderInfo.sampleCount}건, 고유 종목 ${availability.orderInfo.uniqueMarketCount}개.`,
    `[데이터 상태-MARKET_CONTEXT] ${availability.marketContext.available ? "분석 가능" : "분석 불가"}. 시장 Snapshot ${availability.marketContext.sampleCount}건.`,
    `[데이터 상태-PERSONAL_TRADE] ${availability.personalTrade.available ? "분석 가능" : "분석 불가"}. 실제 주문 결과 데이터 ${availability.personalTrade.sampleCount}건. 분석 불가면 체결 여부를 단정하지 않는다.`,
    `[데이터 상태-FEE] ${availability.fee.available ? "분석 가능" : "분석 불가"}. paidFee와 executedFunds가 있는 실제 주문 ${availability.fee.sampleCount}건.`,
    `[데이터 상태-SLIPPAGE] ${availability.slippage.available ? "분석 가능" : "분석 불가"}. 실제 평균 체결 가격과 기준 가격이 있는 주문 ${availability.slippage.sampleCount}건.`,
    `[명시 availability] uniqueMarketCount=${availability.orderInfo.uniqueMarketCount}, hasOrderTimingData=${availability.behaviorTiming.available}, hasFrequencyData=${availability.frequencyPattern.available}, hasMarketContextData=${availability.marketContext.available}, hasConfirmedTradeData=${availability.personalTrade.available}, hasFeeData=${availability.fee.available}, hasSlippageData=${availability.slippage.available}, shownGuardrailCount=${availability.guardrailBehavior.shownGuardrailCount || 0}, reactionCount=${availability.guardrailBehavior.reactionCount}.`,
    "분석 불가로 표시된 주제에 대해 긍정 또는 부정 결론을 만들지 않는다.",
    "표본 수가 0인 데이터에 대해 안정적이다, 위험하다, 좋다, 나쁘다를 말하지 않는다.",
    "데이터가 없다는 사실을 사용자 전략의 문제나 개선 필요성으로 연결하지 않는다.",
    "단일 종목 기록을 포트폴리오 분산 실패로 해석하지 않는다.",
    "실제 주문 결과가 없으면 체결 여부나 성과를 단정하지 않는다.",
  ];
}

function buildFactSummaries(params) {
  const metrics = params.metrics;
  const counts = params.sourceCounts;
  const availability =
    params.availability ||
    computeInsightDataAvailability({
      snapshots: [],
      reactions: [],
      feedbacks: [],
      trades: [],
      rules: [],
    });
  const lines = [
    "--- 관찰 ---",
    `오늘 주문 시도 ${counts.attempts}건과 가드레일 발생 ${counts.guardrailSnapshots}건이 기록됐다.`,
    counts.confirmedTrades > 0
      ? `가드레일 반응은 ${counts.guardrailReactions}건, 실제 주문 결과 데이터는 ${counts.confirmedTrades}건이었다.`
      : `가드레일 반응은 ${counts.guardrailReactions}건이다. 실제 주문 결과 데이터는 0건이며, 개인 API 미연결 또는 수집 실패 가능성이 있으므로 실제 체결 여부를 확인할 수 없다고 표현해야 한다.`,
    `고유 종목 수는 ${availability.orderInfo.uniqueMarketCount}개이며, 이 값만으로 전체 포트폴리오 분산을 평가하지 않는다.`,
    "--- 원칙 및 가드레일 기록 ---",
    counts.guardrailSnapshots > 0
      ? "가드레일 이후 사용자가 계속 진행, 다시 보기, 닫기 중 하나를 선택한 기록을 기준으로 흐름을 정리했다. PROCEED만 경고 후 계속 진행으로 표현하고 REVIEW/CLOSE를 경고 무시로 분류하지 않는다."
      : "오늘 실제로 표시된 가드레일 기록이 없어 가드레일 반응, 무시, PROCEED에 관한 결론을 만들지 않는다.",
    "--- 피드백 기록 ---",
    `ANSWERED 피드백은 ${counts.answeredFeedbacks}건이며, 내부 값 PLANNED는 계획적이었다고 답한 거래, EMOTIONAL은 후회가 남는 거래로 표시한다.`,
    ...buildAvailabilitySummaryLines(availability),
    "--- 계산 결과 ---",
    `최근 24시간 가드레일 이후 동일 주문 흐름이 확인되지 않은 주문의 현재 가상 가격 효과 표본은 ${metrics.cancelledOrderVirtualPnl.sampleCount}건이다. 이 값은 실제 수익이나 손실 방지액이 아니라 현재 가격과의 가상 비교다.`,
    `가상 가격 효과 합계는 상승 방향 ${metrics.cancelledOrderVirtualPnl.totalPositiveVirtualPnl}, 하락 방향 ${metrics.cancelledOrderVirtualPnl.totalNegativeVirtualPnl}, 순효과 ${metrics.cancelledOrderVirtualPnl.netVirtualPnl}이다.`,
    `경고 후 기다린 체결 가격 효과 표본은 ${metrics.waitingPriceEffect.sampleCount}건이다.`,
    `줄인 위험 노출액 표본은 ${metrics.reducedExposure.sampleCount}건이다.`,
    `계획적 거래와 후회가 남는 거래 비교 상태는 ${metrics.feedbackPnlComparison.status}이며, 표본이 부족하면 결론을 만들지 않는다.`,
    "--- 강제 규칙 ---",
    "제공된 관찰값과 계산 결과만 사용한다. 입력에 없는 사실, 횟수, 가격, 수익률, 원인을 생성하지 않는다.",
    "데이터 없음은 해당 행동이 발생하지 않았음을 뜻하지 않는다. 데이터가 부족하다는 사실을 사용자 전략 문제로 연결하지 않는다.",
    "가드레일 기록이 0이면 가드레일 반응, 무시, PROCEED에 관한 결론을 만들지 않는다. PROCEED가 0이면 경고 이후 계속 진행했다고 표현하지 않는다.",
    "REVIEW와 CLOSE는 경고 무시로 표현하지 않는다. 수수료 데이터가 없으면 수수료를 평가하지 않는다. 실제 평균 체결가가 없으면 슬리피지를 평가하지 않는다.",
    "하루 한 종목 기록으로 전체 포트폴리오가 분산되지 않았다고 판단하지 않는다. 하루 기록을 고정된 투자 성향으로 단정하지 않고 오늘의 주문 행동이라고 표현한다.",
    "금지 표현: 실제 주문은 체결되지 않았습니다, 실제 거래가 발생하지 않았습니다, 수수료 출혈, 슬리피지 손실 없이 정밀하게 진입, 거래 종목 다양성 부족, 리스크 분산에 부정적, 포트폴리오가 편중됨, 전략 개선이 필요, 충동 매매 가능성, 감정적 뇌동매매, 차분한 승부사, 귀를 닫은 트레이더.",
  ];
  return lines.slice(0, 50);
}

const FORBIDDEN_TEXT_REPLACEMENTS = [
  ["귀를 닫은 트레이더", "가드레일 이후 계속 진행한 기록"],
  ["귀를 연 트레이더", "가드레일을 다시 확인한 기록"],
  ["차분한 승부사", "계획을 확인한 기록"],
  ["감정적 뇌동매매", "후회가 남는 주문"],
  ["감정적 거래", "후회가 남는 거래"],
  ["감정적 진입", "후회가 남는 진입"],
  ["이성적 매매", "계획을 따른 주문"],
  ["수수료 출혈", "거래 비용 분석"],
  ["수수료 누수 경보", "거래 비용 분석"],
  ["시스템의 브레이크를 믿어보세요", "다음 주문 전 원칙을 다시 확인해 보세요"],
  ["심호흡", "진입 기준 확인"],
  ["실제 주문은 체결되지 않았습니다", "실제 주문 결과 데이터가 없어 체결 여부는 확인할 수 없어요"],
  ["실제 거래가 발생하지 않았습니다", "실제 주문 결과 데이터가 없어 체결 여부는 확인할 수 없어요"],
  ["슬리피지 손실 없이 정밀하게 진입했습니다", "체결 가격 분석 데이터가 부족해 평가하지 않았어요"],
  ["거래 종목의 다양성이 긍정적입니다", "거래 종목 수는 관찰값으로만 참고했어요"],
  ["거래 종목 다양성 부족", "오늘은 한 종목의 주문 기록이 수집됐어요"],
  ["리스크 분산에 부정적", "이 기록만으로 전체 투자 종목 구성을 판단하지 않았어요"],
  ["포트폴리오가 편중됨", "이 기록만으로 전체 투자 종목 구성을 판단하지 않았어요"],
  ["전략 개선이 필요하다", "기록이 더 쌓이면 더 정확하게 분석할 수 있어요"],
  ["전략 개선이 필요합니다", "기록이 더 쌓이면 더 정확하게 분석할 수 있어요"],
  ["충동 매매 가능성", "주문 작성 시간 데이터 부족"],
];

function sanitizeUserFacingText(text) {
  if (!text) return text;
  return FORBIDDEN_TEXT_REPLACEMENTS.reduce(
    (next, [before, after]) => next.split(before).join(after),
    String(text),
  );
}

function makeDataUnavailableCard(title, description) {
  return {
    title,
    description,
    severity: "unavailable",
  };
}

function computeEvidenceConfidence(sampleCount, availability) {
  if (sampleCount >= 30 && availability === "AVAILABLE") return "HIGH";
  if (sampleCount >= 10 && availability !== "UNAVAILABLE") return "MEDIUM";
  return "LOW";
}

function attachEvidence(card, evidence) {
  return {
    ...card,
    evidence,
    evidenceConfidence: computeEvidenceConfidence(
      evidence.sampleCount || 0,
      evidence.dataAvailability,
    ),
  };
}

function makeUnavailableEvidence(sourceFields, sampleCount = 0) {
  return {
    evidenceType: "OBSERVED",
    sourceFields,
    sampleCount,
    sourceRecordCount: sampleCount,
    dataAvailability: "UNAVAILABLE",
  };
}

function makeAiEvidence(sourceFields, sampleCount, availability = "AVAILABLE") {
  return {
    evidenceType: "AI_INTERPRETATION",
    sourceFields,
    sampleCount,
    sourceRecordCount: sampleCount,
    dataAvailability: availability,
  };
}

function guardrailUnavailableCard() {
  return attachEvidence(
    makeDataUnavailableCard(
      "오늘은 분석할 가드레일 기록이 없어요",
      "오늘 실제로 표시된 가드레일 기록이 없어 반응 패턴은 분석하지 않았어요.",
    ),
    makeUnavailableEvidence(["shownGuardrailCount", "reactionCount"], 0),
  );
}

function textHasGuardrailProceedClaim(text) {
  return /가드레일.*(무시|계속 진행|PROCEED|반복|따르지 않|경고 무시)|경고 이후.*(계속|진행|무시|따르지)|PROCEED/i.test(text);
}

function textHasPortfolioDiversificationClaim(text) {
  return /거래 종목 다양성 부족|리스크 분산에 부정적|포트폴리오가 편중|분산 실패|분산되지/i.test(text);
}

function dedupeCards(cards) {
  const seen = new Set();
  const result = [];
  for (const card of cards) {
    const key = `${card.title}:${card.description}:${card.severity}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(card);
  }
  return result;
}

function sanitizeOverviewWithAvailability(overview, availability) {
  if (!overview) return null;
  const guardrailUnavailable =
    availability.guardrailBehavior.reactionCount === 0 ||
    availability.guardrailBehavior.proceedCount === 0;
  const cards = dedupeCards((overview.cards || []).map((card) => {
    const text = `${card.title || ""} ${card.description || ""}`;
    if (
      (availability.guardrailBehavior.reactionCount === 0 ||
        availability.guardrailBehavior.proceedCount === 0) &&
      textHasGuardrailProceedClaim(text)
    ) {
      return guardrailUnavailableCard();
    }
    if (!availability.fee.available && /수수료|비용|fee/i.test(text)) {
      return attachEvidence(
        makeDataUnavailableCard(
          "거래 비용 분석 데이터 부족",
          "실제 체결 금액과 수수료 데이터가 없어 거래 비용은 분석하지 않았어요.",
        ),
        makeUnavailableEvidence(["paidFee", "executedFunds"], availability.fee.sampleCount),
      );
    }
    if (!availability.slippage.available && /슬리피지|체결가|타점|시장가/i.test(text)) {
      return attachEvidence(
        makeDataUnavailableCard(
          "체결 가격 분석 데이터 부족",
          "실제 평균 체결가 데이터가 없어 체결 가격 차이는 분석하지 않았어요.",
        ),
        makeUnavailableEvidence(["averageExecutedPrice", "intentPrice"], availability.slippage.sampleCount),
      );
    }
    if (!availability.personalTrade.available && /체결|손익|실제 주문|실제 거래|수익|손실/i.test(text)) {
      return attachEvidence(
        makeDataUnavailableCard(
          "실제 주문 결과 데이터 부족",
          "실제 주문 결과 데이터가 없어 체결 여부와 손익은 확인할 수 없어요.",
        ),
        makeUnavailableEvidence(["confirmedTrades"], availability.personalTrade.sampleCount),
      );
    }
    if (!availability.marketContext.available && /시장|급등|급락|과열|변동성|스프레드/i.test(text)) {
      return attachEvidence(
        makeDataUnavailableCard(
          "시장 상황 분석 데이터 부족",
          "시장 등락률, 스프레드, 거래량 같은 Snapshot 데이터가 부족해 시장 상황은 평가하지 않았어요.",
        ),
        makeUnavailableEvidence(["marketContext"], availability.marketContext.sampleCount),
      );
    }
    if (availability.orderInfo.uniqueMarketCount <= 1 && textHasPortfolioDiversificationClaim(text)) {
      return attachEvidence(
        {
          ...card,
          title: "오늘은 한 종목의 주문 기록이 수집됐어요",
          description: "이 기록만으로 전체 투자 종목 구성을 판단하지 않았어요.",
          severity: "unavailable",
        },
        makeUnavailableEvidence(["uniqueMarketCount"], availability.orderInfo.uniqueMarketCount),
      );
    }
    return {
      ...card,
      title: sanitizeUserFacingText(card.title),
      description: sanitizeUserFacingText(card.description),
      evidence: card.evidence || makeAiEvidence(
        ["dailyFactSummaries"],
        availability.planFeedback.sampleCount || availability.orderInfo.sampleCount || 0,
        "PARTIAL",
      ),
      evidenceConfidence: card.evidenceConfidence || computeEvidenceConfidence(
        availability.planFeedback.sampleCount || availability.orderInfo.sampleCount || 0,
        "PARTIAL",
      ),
    };
  }));

  const summary = guardrailUnavailable && textHasGuardrailProceedClaim(overview.summary)
    ? "오늘 실제로 표시된 가드레일 기록이 없어 반응 패턴은 분석하지 않았어요."
    : sanitizeUserFacingText(overview.summary);

  return {
    summary,
    flameStatus: sanitizeUserFacingText(overview.flameStatus),
    cards,
  };
}

function sanitizeFieldAnalysisWithAvailability(fieldAnalysis, availability) {
  if (!fieldAnalysis) return null;
  return {
    topics: (fieldAnalysis.topics || []).map((topic) => {
      const key = topic.topic_key;
      const unavailable =
        (key === "PERSONAL_API" && !availability.personalTrade.available) ||
        (key === "MARKET_CONTEXT" && !availability.marketContext.available) ||
        (key === "BEHAVIOR_TIMING" && !availability.behaviorTiming.available);
      const rawText = `${topic.headline || ""} ${topic.analysis || ""}`;
      const singleMarketDiversification =
        key === "ORDER_INFO" &&
        availability.orderInfo.uniqueMarketCount <= 1 &&
        textHasPortfolioDiversificationClaim(rawText);
      const marketContextVague =
        key === "MARKET_CONTEXT" &&
        availability.marketContext.available &&
        /분석.*제공되지|구체적인 분석.*제공|분석하지 않았/i.test(rawText);
      return {
        ...topic,
        topic_label: sanitizeUserFacingText(topic.topic_label),
        headline: singleMarketDiversification
          ? "한 종목 기록"
          : unavailable
          ? "분석 데이터 부족"
          : sanitizeUserFacingText(topic.headline),
        analysis: singleMarketDiversification
          ? "오늘은 한 종목의 주문 기록이 수집됐어요. 이 기록만으로 전체 투자 종목 구성을 판단하지 않았어요."
          : marketContextVague
            ? "시장 데이터는 수집됐지만 뚜렷한 공통 패턴은 확인되지 않았어요."
          : unavailable
          ? key === "PERSONAL_API"
            ? "실제 주문 API 데이터가 없어 체결 결과와 수수료를 분석하지 않았어요."
            : key === "BEHAVIOR_TIMING"
              ? "주문 작성 시간을 분석할 기록이 부족해요."
              : "시장 Snapshot 데이터가 부족해 시장 상황을 평가하지 않았어요."
          : sanitizeUserFacingText(topic.analysis),
        severity: unavailable || singleMarketDiversification ? "unavailable" : topic.severity,
        evidence: topic.evidence || makeAiEvidence(
          [key],
          unavailable ? 0 : availability.orderInfo.sampleCount || 0,
          unavailable ? "UNAVAILABLE" : "PARTIAL",
        ),
      };
    }),
    oneLineAdvice: sanitizeUserFacingText(fieldAnalysis.oneLineAdvice),
  };
}

function buildDailyInsightDiagnostics(params) {
  const sources = params.sources || {};
  const snapshots = sources.snapshots || [];
  const orderIntentSnapshots = snapshots.filter((snapshot) => snapshot.snapshotTrigger === "ORDER_INTENT_CLICK");
  const shownGuardrailSnapshots = snapshots.filter(hasShownGuardrail);
  const linkedReactions = getLinkedGuardrailReactions(sources);
  const reactionCounts = countReactionActions(linkedReactions);
  const latestFeedbacks = getLatestEffectiveFeedbacks(sources.feedbacks || []);
  const answeredFeedbacks = latestFeedbacks.filter((feedback) => feedback.feedbackStatus === "ANSWERED");
  const plannedFeedbacks = answeredFeedbacks.filter((feedback) => feedback.selfAssessment === "PLANNED");
  const regrettedFeedbacks = answeredFeedbacks.filter((feedback) => feedback.selfAssessment === "EMOTIONAL");
  const uniqueMarkets = new Set(snapshots.map((snapshot) => snapshot.market).filter(Boolean));
  const suggestionSnapshots = params.suggestionRequest?.snapshots || [];
  const suggestionFeedbacks = params.suggestionRequest?.feedbacks || [];
  const labeledAttemptIds = new Set(
    suggestionFeedbacks
      .filter((feedback) => feedback.feedback_status === "ANSWERED" && feedback.attempt_id)
      .map((feedback) => feedback.attempt_id),
  );
  const labeledSuggestionSampleCount = suggestionSnapshots.filter(
    (snapshot) =>
      snapshot.snapshot_trigger === "ORDER_INTENT_CLICK" &&
      snapshot.attempt_id &&
      labeledAttemptIds.has(snapshot.attempt_id),
  ).length;
  return {
    snapshotCount: snapshots.length,
    orderIntentSnapshotCount: orderIntentSnapshots.length,
    shownGuardrailSnapshotCount: shownGuardrailSnapshots.length,
    reactionCount: reactionCounts.reactionCount,
    proceedCount: reactionCounts.proceedCount,
    reviewCount: reactionCounts.reviewCount,
    closeCount: reactionCounts.closeCount,
    answeredFeedbackCount: answeredFeedbacks.length,
    plannedFeedbackCount: plannedFeedbacks.length,
    regrettedFeedbackCount: regrettedFeedbacks.length,
    confirmedTradeCount: (sources.trades || []).length,
    uniqueMarketCount: uniqueMarkets.size,
    labeledSuggestionSampleCount,
  };
}

function buildDailyReportDebugSummary(params) {
  return {
    generationDiagnostics: buildDailyInsightDiagnostics({
      sources: params.sources,
      suggestionRequest: params.suggestionRequest,
    }),
    sourceCounts: buildSourceCounts(params.sources),
    savedSourceCounts: params.report?.sourceCounts || null,
    timelineEventCount: (params.report?.timeline || []).length,
    metricSampleCounts: {
      cancelledOrderVirtualPnl:
        params.report?.metrics?.cancelledOrderVirtualPnl?.sampleCount ?? null,
      waitingPriceEffect:
        params.report?.metrics?.waitingPriceEffect?.sampleCount ?? null,
      reducedExposure: params.report?.metrics?.reducedExposure?.sampleCount ?? null,
    },
    factCount: (params.facts || []).length,
    analysisStatus: params.report?.analysisStatus || null,
  };
}

const SNAPSHOT_ANALYSIS_FIELDS = [
  ["market", "market"],
  ["side", "side"],
  ["orderMode", "order_mode"],
  ["snapshotTrigger", "snapshot_trigger"],
  ["entryPoint", "entry_point"],
  ["allocationPresetPercent", "allocation_preset_percent"],
  ["modeChangedToMarket", "mode_changed_to_market"],
  ["requestedBalanceRatio", "requested_balance_ratio"],
  ["draftDurationMs", "draft_duration_ms"],
  ["lastEditToSnapshotMs", "last_edit_to_snapshot_ms"],
  ["draftEditCount", "draft_edit_count"],
  ["amountChangeRate", "amount_change_rate"],
  ["orderbookClickToSnapshotMs", "orderbook_click_to_snapshot_ms"],
  ["orderIntentCount1m", "order_intent_count_1m"],
  ["actualOrderCreatedCount10m", "actual_order_created_count_10m"],
  ["sameSideIntentCount1m", "same_side_intent_count_1m"],
  ["marketChangeCount5m", "market_change_count_5m"],
  ["sideChangeCount3m", "side_change_count_3m"],
  ["priceEditCount3m", "price_edit_count_3m"],
  ["quantityEditCount3m", "quantity_edit_count_3m"],
  ["amountEditCount3m", "amount_edit_count_3m"],
  ["inputRevertCount", "input_revert_count"],
  ["priceDirectionChangeCount", "price_direction_change_count"],
  ["priceChangeRate", "price_change_rate"],
  ["orderModeChangeCount3m", "order_mode_change_count_3m"],
  ["draftResetCount3m", "draft_reset_count_3m"],
  ["shortTermReturn5m", "short_term_return_5m"],
  ["signedChangeRate", "signed_change_rate"],
  ["spreadRate", "spread_rate"],
  ["pricePositionIn5mRange", "price_position_in_5m_range"],
  ["volumeSpikeRatio5m", "volume_spike_ratio_5m"],
  ["priceVsAvgBuyRateAtSnapshot", "price_vs_avg_buy_rate_at_snapshot"],
];

function hashAnalysisId(value, prefix) {
  if (!value) return null;
  const digest = crypto
    .createHash("sha256")
    .update(`guardrail-suggestion:${prefix}:${value}`)
    .digest("hex")
    .slice(0, 32);
  return `${prefix}_${digest}`;
}

function compactSourceWindow(generatedAt, maxHistoryDays = 90) {
  const toAt = new Date(generatedAt);
  const fromAt = new Date(toAt.getTime() - maxHistoryDays * 24 * 60 * 60 * 1000);
  return {
    from_at: fromAt.toISOString(),
    to_at: toAt.toISOString(),
  };
}

function stripUndefinedDeep(value) {
  if (Array.isArray(value)) return value.map(stripUndefinedDeep);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, entry]) => entry !== undefined)
      .map(([key, entry]) => [key, stripUndefinedDeep(entry)]),
  );
}

function normalizeEnum(value, allowed, fallback) {
  return allowed.includes(value) ? value : fallback;
}

function normalizeNumeric(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function normalizeSnapshotForSuggestion(snapshot) {
  const record = {
    record_id: hashAnalysisId(String(snapshot.snapshotId || ""), "snapshot"),
    snapshot_id: hashAnalysisId(String(snapshot.snapshotId || ""), "snapshot"),
    attempt_id: hashAnalysisId(
      typeof snapshot.attemptId === "string" ? snapshot.attemptId : null,
      "attempt",
    ),
    captured_at: snapshot.capturedAt,
    matched_rule_ids_at_snapshot: Array.isArray(snapshot.matchedRuleIdsAtSnapshot)
      ? snapshot.matchedRuleIdsAtSnapshot
      : [],
    primary_shown_rule_id: snapshot.primaryShownRuleId || null,
    shown_rule_ids: Array.isArray(snapshot.shownRuleIds) ? snapshot.shownRuleIds : [],
  };

  for (const [sourceKey, targetKey] of SNAPSHOT_ANALYSIS_FIELDS) {
    let value = snapshot[sourceKey];
    if (sourceKey === "snapshotTrigger") {
      value = normalizeEnum(value, ["GUARDRAIL_SHOWN", "ORDER_INTENT_CLICK"], "ORDER_INTENT_CLICK");
    } else if (sourceKey === "side") {
      value = normalizeEnum(value, ["BUY", "SELL", "UNKNOWN"], "UNKNOWN");
    } else if (sourceKey === "orderMode") {
      value = normalizeEnum(value, ["LIMIT", "MARKET", "BEST", "RESERVED", "UNKNOWN"], "UNKNOWN");
    } else if (
      sourceKey !== "market" &&
      sourceKey !== "entryPoint" &&
      sourceKey !== "allocationPresetPercent" &&
      sourceKey !== "modeChangedToMarket"
    ) {
      value = normalizeNumeric(value);
    } else if (sourceKey === "modeChangedToMarket") {
      value = typeof value === "boolean" ? value : null;
    }
    if (value !== null && value !== undefined) {
      record[targetKey] = value;
    }
  }
  return stripUndefinedDeep(record);
}

function normalizeFieldCatalogForSuggestion(fieldCatalog) {
  return Object.fromEntries(
    Object.entries(fieldCatalog || {}).map(([key, definition]) => [
      key,
      stripUndefinedDeep({
        key: definition.key || key,
        value_type: definition.valueType,
        nullable: definition.nullable ?? true,
        rule_eligible: definition.ruleEligible ?? true,
        requires_private_api: definition.requiresPrivateApi ?? false,
        supported_operators: Array.isArray(definition.supportedOperators)
          ? definition.supportedOperators
          : [],
        comparison_group: definition.comparisonGroup ?? null,
        input: definition.input || {},
      }),
    ]),
  );
}

function normalizeRuleForSuggestion(rule) {
  return stripUndefinedDeep({
    rule_id: rule.ruleId,
    name: rule.name,
    description: rule.description ?? null,
    is_enabled: rule.isEnabled ?? true,
    priority: rule.priority ?? 999,
    risk_level: normalizeEnum(rule.riskLevel, ["LOW", "MEDIUM", "HIGH"], "MEDIUM"),
    visual_mode: normalizeEnum(
      rule.visualMode,
      ["CURIOUS", "SURPRISED", "FAST_BURN", "SCARED", "SAD"],
      "CURIOUS",
    ),
    expression: rule.expression,
    warning_title: rule.warningTitle || "주문 기준을 확인해 주세요.",
    warning_message: rule.warningMessage || "주문 전 기준을 다시 확인해 주세요.",
    requires_private_api: rule.requiresPrivateApi ?? false,
    schema_version: rule.schemaVersion || "v1",
    updated_at: rule.updatedAt ?? null,
  });
}

function buildGuardrailSuggestionRequest(params) {
  const maxRecords = params.maxRecords || 1000;
  const sourceWindow = compactSourceWindow(params.generatedAt, params.maxHistoryDays || 90);
  const sources = params.sources || {};
  const snapshots = [...(sources.snapshots || [])]
    .sort((left, right) => toTimeMs(left.capturedAt) - toTimeMs(right.capturedAt))
    .slice(-maxRecords)
    .map(normalizeSnapshotForSuggestion);
  const allowedSnapshotIds = new Set(
    snapshots.map((snapshot) => snapshot.snapshot_id).filter(Boolean),
  );
  const reactions = getLinkedGuardrailReactions(sources)
    .sort((left, right) => toTimeMs(left.reactedAt) - toTimeMs(right.reactedAt))
    .slice(-maxRecords)
    .map((reaction) => ({
      record_id: hashAnalysisId(reaction.reactionId, "reaction"),
      snapshot_id: hashAnalysisId(reaction.snapshotId, "snapshot"),
      action: normalizeEnum(reaction.action, ["PROCEED", "REVIEW", "CLOSE"], null),
      reacted_at: reaction.reactedAt,
    }))
    .filter((reaction) => reaction.action && allowedSnapshotIds.has(reaction.snapshot_id));
  const feedbacks = getLatestEffectiveFeedbacks(sources.feedbacks || [])
    .sort((left, right) => toTimeMs(left.respondedAt) - toTimeMs(right.respondedAt))
    .slice(-maxRecords)
    .map((feedback) => ({
      record_id: hashAnalysisId(feedback.feedbackId, "feedback"),
      attempt_id: hashAnalysisId(feedback.attemptId, "attempt"),
      feedback_status: normalizeEnum(feedback.feedbackStatus, ["ANSWERED", "DISMISSED"], "DISMISSED"),
      self_assessment: feedback.feedbackStatus === "ANSWERED"
        ? normalizeEnum(feedback.selfAssessment, ["PLANNED", "EMOTIONAL"], null)
        : null,
      responded_at: feedback.respondedAt,
    }));
  const confirmedTrades = [...(sources.trades || [])]
    .sort((left, right) => toTimeMs(left.orderCreatedAt) - toTimeMs(right.orderCreatedAt))
    .slice(-maxRecords)
    .map((trade) => ({
      record_id: hashAnalysisId(trade.tradeLogId, "trade"),
      attempt_id: hashAnalysisId(trade.attemptId, "attempt"),
      order_created_at: trade.orderCreatedAt,
      market: trade.market ?? null,
      side: normalizeEnum(trade.side, ["BUY", "SELL", "UNKNOWN"], "UNKNOWN"),
      ord_type: trade.ordType ?? null,
      state: trade.state ?? null,
      executed_volume: trade.executedVolume ?? null,
      executed_funds: trade.executedFunds ?? null,
      paid_fee: trade.paidFee ?? null,
      remaining_volume: trade.remainingVolume ?? null,
      outcome_observed_at: trade.outcomeObservedAt ?? null,
    }));

  return stripUndefinedDeep({
    analysis_date: params.date,
    timezone: params.timezone,
    source_window: sourceWindow,
    snapshots,
    reactions,
    feedbacks,
    confirmed_trades: confirmedTrades,
    current_rules: (sources.rules || []).map(normalizeRuleForSuggestion),
    field_catalog: normalizeFieldCatalogForSuggestion(params.fieldCatalog || {}),
    options: {
      max_history_days: params.maxHistoryDays || 90,
      max_records: maxRecords,
      min_total_labeled_samples: params.minTotalLabeledSamples || 20,
      min_regretted_samples: params.minRegrettedSamples || 5,
      min_cluster_samples: params.minClusterSamples || 5,
      max_new_suggestions: 1,
      max_modification_suggestions: 1,
      random_state: 42,
    },
  });
}

function quantile(values, q) {
  const sorted = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  const index = (sorted.length - 1) * q;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (index - lower);
}

function roundRate(value) {
  if (!Number.isFinite(value)) return 0;
  return Number(value.toFixed(4));
}

function expressionKey(expression) {
  return stableJson(expression);
}

function expressionMatchesSnapshot(expression, snapshot) {
  if (!expression || !snapshot) return false;
  if (expression.nodeType === "GROUP") {
    const results = (expression.children || []).map((child) => expressionMatchesSnapshot(child, snapshot));
    return expression.operator === "OR" ? results.some(Boolean) : results.every(Boolean);
  }
  if (expression.nodeType !== "CONDITION") return false;
  const left = snapshot[expression.leftField];
  if (expression.operator === "IS_NULL") return left == null;
  if (expression.operator === "IS_NOT_NULL") return left != null;
  const right =
    expression.rightOperand?.operandType === "FIELD"
      ? snapshot[expression.rightOperand.field]
      : expression.rightOperand?.value;
  if (expression.operator === "EQ") return left === right;
  if (expression.operator === "NEQ") return left !== right;
  const leftNumber = Number(left);
  const rightNumber = Number(right);
  if (!Number.isFinite(leftNumber) || !Number.isFinite(rightNumber)) return false;
  if (expression.operator === "GT") return leftNumber > rightNumber;
  if (expression.operator === "GTE") return leftNumber >= rightNumber;
  if (expression.operator === "LT") return leftNumber < rightNumber;
  if (expression.operator === "LTE") return leftNumber <= rightNumber;
  if (expression.operator === "IN") return Array.isArray(right) && right.includes(left);
  if (expression.operator === "NOT_IN") return Array.isArray(right) && !right.includes(left);
  return false;
}

function buildRuleSimulation(expression, snapshots, negativeAttemptIds) {
  const total = Math.max((snapshots || []).length, 1);
  const negativeTotal = Math.max(negativeAttemptIds.size, 1);
  const matched = (snapshots || []).filter((snapshot) => expressionMatchesSnapshot(expression, snapshot));
  const negativeMatched = matched.filter((snapshot) => snapshot.attemptId && negativeAttemptIds.has(snapshot.attemptId));
  const plannedMatched = matched.filter((snapshot) => snapshot.attemptId && !negativeAttemptIds.has(snapshot.attemptId));
  return {
    coverage: matched.length / total,
    precision: matched.length > 0 ? negativeMatched.length / matched.length : null,
    recall: negativeMatched.length / negativeTotal,
    falsePositiveRate: matched.length > 0 ? plannedMatched.length / matched.length : null,
  };
}

function createSuggestionRule(params) {
  const now = params.now || new Date().toISOString();
  return {
    ruleId: params.ruleId,
    userId: params.userId || "",
    name: params.name,
    description: params.description,
    isEnabled: true,
    priority: params.priority || 999,
    riskLevel: params.riskLevel || "MEDIUM",
    visualMode: params.visualMode || "CURIOUS",
    expression: params.expression,
    warningTitle: params.warningTitle,
    warningMessage: params.warningMessage,
    requiresPrivateApi: false,
    schemaVersion: "v1",
    createdAt: now,
    updatedAt: now,
  };
}

function buildGuardrailSuggestions(sources = {}) {
  const snapshots = sources.suggestionSnapshots || sources.snapshots || [];
  const feedbacks = getLatestEffectiveFeedbacks(sources.suggestionFeedbacks || sources.feedbacks || [])
    .filter((feedback) => feedback.feedbackStatus === "ANSWERED");
  const rules = sources.rules || [];
  const negativeAttemptIds = new Set(
    feedbacks
      .filter((feedback) => feedback.selfAssessment === "EMOTIONAL")
      .map((feedback) => feedback.attemptId)
      .filter(Boolean),
  );
  const plannedAttemptIds = new Set(
    feedbacks
      .filter((feedback) => feedback.selfAssessment === "PLANNED")
      .map((feedback) => feedback.attemptId)
      .filter(Boolean),
  );

  if (snapshots.length < 20 || feedbacks.length < 10 || negativeAttemptIds.size < 5) {
    return {
      newGuardrails: [],
      guardrailModifications: [],
      modifications: [],
      status: "INSUFFICIENT_DATA",
      disclaimer: "사용자 수락 전에는 가드레일을 자동 생성하거나 수정하지 않습니다.",
    };
  }

  const negativeSnapshots = snapshots.filter(
    (snapshot) => snapshot.attemptId && negativeAttemptIds.has(snapshot.attemptId),
  );
  const marketBuyNegatives = negativeSnapshots.filter(
    (snapshot) =>
      snapshot.side === "BUY" &&
      snapshot.orderMode === "MARKET" &&
      Number.isFinite(Number(snapshot.shortTermReturn5m)),
  );
  const newGuardrails = [];
  const existingExpressionKeys = new Set(rules.map((rule) => expressionKey(rule.expression)));

  if (marketBuyNegatives.length >= 5) {
    const values = marketBuyNegatives.map((snapshot) => Number(snapshot.shortTermReturn5m));
    const threshold = roundRate(quantile(values, 0.5) ?? 0.03);
    if (threshold > 0) {
      const expression = {
        nodeType: "GROUP",
        operator: "AND",
        children: [
          {
            nodeType: "CONDITION",
            leftField: "side",
            operator: "EQ",
            rightOperand: { operandType: "LITERAL", value: "BUY" },
          },
          {
            nodeType: "CONDITION",
            leftField: "orderMode",
            operator: "EQ",
            rightOperand: { operandType: "LITERAL", value: "MARKET" },
          },
          {
            nodeType: "CONDITION",
            leftField: "shortTermReturn5m",
            operator: "GTE",
            rightOperand: { operandType: "LITERAL", value: threshold },
          },
        ],
      };
      if (!existingExpressionKeys.has(expressionKey(expression))) {
        const simulation = buildRuleSimulation(expression, snapshots, negativeAttemptIds);
        if ((simulation.precision ?? 0) >= 0.5 && simulation.coverage > 0) {
          newGuardrails.push({
            suggestionId: `new-guardrail-market-buy-${String(threshold).replace(".", "_")}`,
            type: "NEW_GUARDRAIL",
            status: "PENDING",
            title: "빠른 시장가 매수 확인",
            rationale: "빠른 시장가 매수와 후회가 남는다고 기록한 주문이 비슷한 상황에서 반복됐어요.",
            evidenceCount: marketBuyNegatives.length,
            confidence: Math.min(0.9, Math.max(0.55, simulation.precision ?? 0.55)),
            proposedRule: createSuggestionRule({
              ruleId: `suggested-${crypto.createHash("sha1").update(expressionKey(expression)).digest("hex").slice(0, 12)}`,
              userId: rules[0]?.userId || snapshots[0]?.userId || "",
              name: "빠른 시장가 매수 확인",
              description: "최근 짧은 구간 상승 뒤 시장가 매수하려는 순간을 다시 확인합니다.",
              riskLevel: "MEDIUM",
              visualMode: "SURPRISED",
              expression,
              warningTitle: "시장가 매수 전 기준을 확인해 볼까요?",
              warningMessage: "최근 짧은 구간 상승 뒤 시장가 매수하려는 흐름이 반복됐어요. 처음 세운 진입 기준과 주문 금액을 한 번 더 확인해 보세요.",
            }),
            representativeValues: {
              side: "BUY",
              orderMode: "MARKET",
              shortTermReturn5mMedian: threshold,
            },
            simulation,
          });
        }
      }
    }
  }

  const guardrailModifications = [];
  for (const rule of rules) {
    const triggeredSnapshots = snapshots.filter((snapshot) => {
      const shown = Array.isArray(snapshot.shownRuleIds) && snapshot.shownRuleIds.includes(rule.ruleId);
      const matched = Array.isArray(snapshot.matchedRuleIdsAtSnapshot) && snapshot.matchedRuleIdsAtSnapshot.includes(rule.ruleId);
      return shown || matched;
    });
    if (triggeredSnapshots.length < 10) continue;
    const plannedHits = triggeredSnapshots.filter(
      (snapshot) => snapshot.attemptId && plannedAttemptIds.has(snapshot.attemptId),
    ).length;
    const negativeHits = triggeredSnapshots.filter(
      (snapshot) => snapshot.attemptId && negativeAttemptIds.has(snapshot.attemptId),
    ).length;
    if (plannedHits < negativeHits || plannedHits / triggeredSnapshots.length < 0.5) continue;
    const rateCondition = findRateCondition(rule.expression);
    if (!rateCondition) continue;
    const currentThreshold = Number(rateCondition.rightOperand?.value);
    if (!Number.isFinite(currentThreshold)) continue;
    const values = triggeredSnapshots
      .map((snapshot) => Number(snapshot[rateCondition.leftField]))
      .filter((value) => Number.isFinite(value));
    const proposedThreshold = roundRate(Math.max(currentThreshold, quantile(values, 0.75) ?? currentThreshold));
    if (proposedThreshold <= currentThreshold) continue;
    const proposedExpression = replaceConditionValue(rule.expression, rateCondition.leftField, proposedThreshold);
    const currentSimulation = buildRuleSimulation(rule.expression, snapshots, negativeAttemptIds);
    const proposedSimulation = buildRuleSimulation(proposedExpression, snapshots, negativeAttemptIds);
    if ((proposedSimulation.falsePositiveRate ?? 1) > (currentSimulation.falsePositiveRate ?? 1)) continue;
    guardrailModifications.push({
      suggestionId: `modify-${rule.ruleId}-${String(proposedThreshold).replace(".", "_")}`,
      type: "MODIFY_GUARDRAIL",
      status: "PENDING",
      guardrailId: rule.ruleId,
      title: `${rule.name} 조건 조정`,
      rationale: "계획적이었다고 답한 주문에서도 이 가드레일이 자주 발생해 임계값을 보수적으로 조정해 볼 수 있어요.",
      evidenceCount: triggeredSnapshots.length,
      confidence: 0.6,
      currentRule: rule,
      proposedRule: {
        ...rule,
        expression: proposedExpression,
        updatedAt: new Date().toISOString(),
      },
      diff: [
        {
          path: `expression.${rateCondition.leftField}`,
          before: currentThreshold,
          after: proposedThreshold,
          reason: "발생 기록의 상위 분위수 기준으로 잦은 경고를 줄이는 후보입니다.",
        },
      ],
      currentSimulation,
      proposedSimulation,
    });
  }

  const status =
    newGuardrails.length > 0 || guardrailModifications.length > 0
      ? "AVAILABLE"
      : "NO_SUGGESTION";
  return {
    newGuardrails,
    guardrailModifications,
    modifications: guardrailModifications,
    status,
    disclaimer: "사용자 수락 전에는 가드레일을 자동 생성하거나 수정하지 않습니다.",
  };
}

function findRateCondition(expression) {
  if (!expression) return null;
  if (
    expression.nodeType === "CONDITION" &&
    ["signedChangeRate", "shortTermReturn5m", "pricePositionIn5mRange", "requestedBalanceRatio", "volumeSpikeRatio5m", "spreadRate"].includes(expression.leftField) &&
    ["GT", "GTE"].includes(expression.operator) &&
    expression.rightOperand?.operandType === "LITERAL" &&
    Number.isFinite(Number(expression.rightOperand.value))
  ) {
    return expression;
  }
  if (expression.nodeType === "GROUP") {
    for (const child of expression.children || []) {
      const found = findRateCondition(child);
      if (found) return found;
    }
  }
  return null;
}

function replaceConditionValue(expression, leftField, value) {
  if (expression.nodeType === "GROUP") {
    return {
      ...expression,
      children: (expression.children || []).map((child) => replaceConditionValue(child, leftField, value)),
    };
  }
  if (
    expression.nodeType === "CONDITION" &&
    expression.leftField === leftField &&
    expression.rightOperand?.operandType === "LITERAL"
  ) {
    return {
      ...expression,
      rightOperand: {
        ...expression.rightOperand,
        value,
      },
    };
  }
  return expression;
}

function getPendingAnalysisTargets(report, inputHash) {
  if (!report || report.inputHash !== inputHash) {
    return {
      overview: true,
      fieldAnalysis: true,
    };
  }

  return {
    overview: !(report.analysisStatus?.overview === "COMPLETED" && report.overview),
    fieldAnalysis: !(
      report.analysisStatus?.fieldAnalysis === "COMPLETED" &&
      report.fieldAnalysis
    ),
  };
}

function mergeAnalysisResults(params) {
  const overview =
    params.overview.status === "fulfilled"
      ? params.overview.value
      : params.existingReport?.overview ?? null;
  const fieldAnalysis =
    params.fieldAnalysis.status === "fulfilled"
      ? params.fieldAnalysis.value
      : params.existingReport?.fieldAnalysis ?? null;
  const analysisStatus = {
    overview: overview ? "COMPLETED" : "FAILED",
    fieldAnalysis: fieldAnalysis ? "COMPLETED" : "FAILED",
  };
  const status =
    analysisStatus.overview === "COMPLETED" &&
    analysisStatus.fieldAnalysis === "COMPLETED"
      ? "COMPLETED"
      : analysisStatus.overview === "COMPLETED" ||
          analysisStatus.fieldAnalysis === "COMPLETED"
        ? "PARTIAL"
        : "FAILED";

  return {
    status,
    overview,
    fieldAnalysis,
    analysisStatus,
  };
}

function selectReportByDate(reports, date) {
  return (reports || []).find((report) => report.date === date) || null;
}

module.exports = {
  AI_PROMPT_VERSION,
  ANALYSIS_VERSION,
  DEFAULT_TIMEZONE,
  GUARDRAIL_SUGGESTION_ALGORITHM_VERSION,
  GUARDRAIL_FOLLOW_UP_WINDOW_MS,
  REQUIRED_FEEDBACK_COUNT,
  VIRTUAL_PNL_DISCLAIMER,
  buildDailyInsightDiagnostics,
  buildDailyTimeline,
  buildOrderFlows,
  buildDailyReportDebugSummary,
  buildAvailabilitySummaryLines,
  buildFactSummaries,
  buildGuardrailSuggestionRequest,
  buildGuardrailSuggestions,
  buildInputHash,
  buildSourceCounts,
  computeCancelledOrderVirtualPnl,
  computeEligibility,
  computeFeedbackPnlComparison,
  computeInsightDataAvailability,
  computeReducedExposure,
  computeWaitingPriceEffect,
  countAnsweredFeedbacksForDate,
  getDailyRange,
  getLatestEffectiveFeedbacks,
  getPendingAnalysisTargets,
  isInRange,
  mergeAnalysisResults,
  sanitizeFieldAnalysisWithAvailability,
  sanitizeOverviewWithAvailability,
  sanitizeUserFacingText,
  selectReportByDate,
  stableJson,
  toIsoString,
  toTimeMs,
};
