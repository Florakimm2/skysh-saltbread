/* eslint-disable @typescript-eslint/no-require-imports */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  buildDailyTimeline,
  buildDailyInsightDiagnostics,
  buildFactSummaries,
  buildGuardrailSuggestionRequest,
  buildGuardrailSuggestions,
  buildInputHash,
  buildOrderFlows,
  buildSourceCounts,
  computeCancelledOrderVirtualPnl,
  computeEligibility,
  computeInsightDataAvailability,
  countAnsweredFeedbacksForDate,
  getDailyRange,
  getPendingAnalysisTargets,
  GUARDRAIL_FOLLOW_UP_WINDOW_MS,
  mergeAnalysisResults,
  sanitizeFieldAnalysisWithAvailability,
  sanitizeOverviewWithAvailability,
  selectReportByDate,
} = require("../backend/modules/insight/daily-core.js");
const {
  buildDailyInsightCtaViewModel,
  buildFlowSteps,
  buildKeyInsightCards,
  buildOrderFlowViewModels,
  buildReportHeroViewModel,
  buildVirtualPnlViewModel,
  getDailyInsightCtaViewState,
  getReportVersionNotice,
  reactionSentence,
} = require("../frontend/dashboard/daily-insight-view-model.js");

function feedback(id, attemptId, status, respondedAt, updatedAt = respondedAt) {
  return {
    feedbackId: id,
    attemptId,
    feedbackStatus: status,
    selfAssessment: status === "ANSWERED" ? "PLANNED" : null,
    feedbackShownAt: respondedAt,
    respondedAt,
    updatedAt,
  };
}

function guardrailSnapshot(id, capturedAt, overrides = {}) {
  return {
    snapshotId: id,
    userId: "u1",
    attemptId: null,
    snapshotTrigger: "GUARDRAIL_SHOWN",
    capturedAt,
    market: "KRW-BTC",
    side: "BUY",
    intentPrice: "100",
    intentQuantity: "2",
    intentAmount: null,
    tradePriceAtSnapshot: "100",
    shownRuleIds: ["r1"],
    updatedAt: capturedAt,
    ...overrides,
  };
}

function reaction(id, snapshotId, action, reactedAt) {
  return {
    reactionId: id,
    snapshotId,
    action,
    reactedAt,
    updatedAt: reactedAt,
  };
}

function baseReport(overrides = {}) {
  return {
    reportId: "2026-07-12",
    userId: "u1",
    date: "2026-07-12",
    timezone: "Asia/Seoul",
    status: "COMPLETED",
    inputHash: "hash",
    sourceCounts: {
      attempts: 34,
      guardrailSnapshots: 30,
      guardrailReactions: 8,
      answeredFeedbacks: 5,
      confirmedTrades: 0,
    },
    timeline: [],
    metrics: {
      cancelledOrderVirtualPnl: {
        status: "NO_MATCHING_DATA",
        window: { from: "2026-07-11T12:00:00.000Z", to: "2026-07-12T12:00:00.000Z" },
        sampleCount: 0,
        totalPositiveVirtualPnl: "0",
        totalNegativeVirtualPnl: "0",
        netVirtualPnl: "0",
        items: [],
        disclaimer: "",
      },
      waitingPriceEffect: {
        status: "NO_MATCHING_DATA",
        sampleCount: 0,
        items: [],
        disclaimer: "",
      },
      reducedExposure: {
        status: "NO_MATCHING_DATA",
        sampleCount: 0,
        totalReducedExposureAmount: "0",
        items: [],
        disclaimer: "",
      },
      feedbackPnlComparison: {
        status: "INSUFFICIENT_DATA",
        groups: {
          PLANNED: { sampleCount: 0, medianReturnRate: null },
          EMOTIONAL: { sampleCount: 0, medianReturnRate: null },
        },
        disclaimer: "",
      },
    },
    overview: {
      summary: "짧은 시간 안에 주문 시도가 반복됐고, 가드레일 이후 계속 진행한 기록이 있었어요.",
      flameStatus: "default",
      cards: [],
    },
    fieldAnalysis: {
      topics: [],
      oneLineAdvice: "주문을 다시 누르기 전에 기존 진입 기준을 확인해 보세요.",
    },
    suggestions: { newGuardrails: [], guardrailModifications: [] },
    suggestionStatus: "NOT_IMPLEMENTED",
    generatedAt: "2026-07-11T16:54:00.000Z",
    createdAt: "2026-07-11T16:54:00.000Z",
    updatedAt: "2026-07-11T16:54:00.000Z",
    errorCode: null,
    errorMessage: null,
    ...overrides,
  };
}

test("KST 날짜 범위를 00:00 이상 다음날 00:00 미만으로 계산한다", () => {
  assert.deepEqual(getDailyRange("2026-07-12", "Asia/Seoul"), {
    from: "2026-07-11T15:00:00.000Z",
    to: "2026-07-12T15:00:00.000Z",
  });
});

test("ANSWERED 개수는 집계하되 생성 가능 여부를 막지 않고 DISMISSED는 제외한다", () => {
  const records = [
    feedback("f1", "a1", "ANSWERED", "2026-07-11T15:10:00.000Z"),
    feedback("f2", "a2", "ANSWERED", "2026-07-11T16:10:00.000Z"),
    feedback("f3", "a3", "ANSWERED", "2026-07-11T17:10:00.000Z"),
    feedback("f4", "a4", "ANSWERED", "2026-07-11T18:10:00.000Z"),
    feedback("f5", "a5", "DISMISSED", "2026-07-11T19:10:00.000Z"),
  ];
  assert.equal(countAnsweredFeedbacksForDate(records, "2026-07-12"), 4);
  assert.equal(
    computeEligibility({
      date: "2026-07-12",
      timezone: "Asia/Seoul",
      feedbacks: records,
      report: null,
      inputHash: "a",
    }).eligible,
    true,
  );

  const five = [
    ...records,
    feedback("f6", "a6", "ANSWERED", "2026-07-12T01:10:00.000Z"),
  ];
  assert.equal(countAnsweredFeedbacksForDate(five, "2026-07-12"), 5);
  assert.equal(
    computeEligibility({
      date: "2026-07-12",
      timezone: "Asia/Seoul",
      feedbacks: five,
      report: null,
      inputHash: "a",
    }).eligible,
    true,
  );
});

test("동일 attemptId 피드백은 최신 유효 기록만 사용하고 새 inputHash면 STALE이다", () => {
  const records = [
    feedback("old", "a1", "ANSWERED", "2026-07-11T15:10:00.000Z", "2026-07-11T15:10:00.000Z"),
    feedback("new", "a1", "DISMISSED", "2026-07-11T15:11:00.000Z", "2026-07-11T15:12:00.000Z"),
    feedback("f2", "a2", "ANSWERED", "2026-07-11T16:10:00.000Z"),
    feedback("f3", "a3", "ANSWERED", "2026-07-11T17:10:00.000Z"),
    feedback("f4", "a4", "ANSWERED", "2026-07-11T18:10:00.000Z"),
    feedback("f5", "a5", "ANSWERED", "2026-07-11T19:10:00.000Z"),
    feedback("f6", "a6", "ANSWERED", "2026-07-11T20:10:00.000Z"),
  ];
  assert.equal(countAnsweredFeedbacksForDate(records, "2026-07-12"), 5);
  assert.equal(
    computeEligibility({
      date: "2026-07-12",
      timezone: "Asia/Seoul",
      feedbacks: records,
      report: {
        reportId: "2026-07-12",
        status: "COMPLETED",
        inputHash: "old-hash",
      },
      inputHash: "new-hash",
    }).reportStatus,
    "STALE",
  );
});

test("최근 24시간 가상 손익은 범위, PROCEED, 실제 주문 후보를 보수적으로 제외한다", async () => {
  const generatedAt = "2026-07-12T12:00:00.000Z";
  const snapshots = [
    guardrailSnapshot("inside", "2026-07-11T12:00:00.000Z"),
    guardrailSnapshot("outside", "2026-07-11T11:59:59.000Z"),
    guardrailSnapshot("proceed", "2026-07-12T01:00:00.000Z"),
    guardrailSnapshot("ordered", "2026-07-12T02:00:00.000Z"),
    guardrailSnapshot("order-intent", "2026-07-12T02:05:00.000Z", {
      snapshotTrigger: "ORDER_INTENT_CLICK",
      attemptId: "attempt-1",
    }),
  ];
  const result = await computeCancelledOrderVirtualPnl({
    snapshots,
    reactions: [
      reaction("r1", "inside", "REVIEW", "2026-07-11T12:00:10.000Z"),
      reaction("r2", "outside", "REVIEW", "2026-07-11T12:00:10.000Z"),
      reaction("r3", "proceed", "PROCEED", "2026-07-12T01:00:10.000Z"),
      reaction("r4", "ordered", "CLOSE", "2026-07-12T02:00:10.000Z"),
    ],
    trades: [],
    generatedAt,
    getCurrentPrice: async () => "90",
  });
  assert.equal(result.status, "AVAILABLE");
  assert.equal(result.sampleCount, 1);
  assert.equal(result.items[0].snapshotId, "inside");
  assert.equal(result.items[0].classification, "INFERRED_NOT_PROCEEDED");
  assert.equal(result.items[0].virtualPnl, "-20");
});

test("ORDER_INTENT_CLICK이라도 shownRuleIds가 있으면 최근 24시간 가상 가격 효과 후보에 포함한다", async () => {
  const result = await computeCancelledOrderVirtualPnl({
    snapshots: [
      guardrailSnapshot("intent-with-rule", "2026-07-12T03:00:00.000Z", {
        snapshotTrigger: "ORDER_INTENT_CLICK",
        attemptId: "a1",
        shownRuleIds: ["r1"],
      }),
    ],
    reactions: [
      reaction("r1", "intent-with-rule", "REVIEW", "2026-07-12T03:00:01.000Z"),
    ],
    trades: [],
    generatedAt: "2026-07-12T12:00:00.000Z",
    getCurrentPrice: async () => "90",
  });
  assert.equal(result.status, "AVAILABLE");
  assert.equal(result.items[0].snapshotId, "intent-with-rule");
});

test("ORDER_INTENT_CLICK이고 shownRuleIds가 비어 있으면 가드레일 후보에서 제외한다", async () => {
  const result = await computeCancelledOrderVirtualPnl({
    snapshots: [
      guardrailSnapshot("intent-without-rule", "2026-07-12T03:00:00.000Z", {
        snapshotTrigger: "ORDER_INTENT_CLICK",
        attemptId: "a1",
        shownRuleIds: [],
        primaryShownRuleId: null,
      }),
    ],
    reactions: [
      reaction("r1", "intent-without-rule", "REVIEW", "2026-07-12T03:00:01.000Z"),
    ],
    trades: [],
    generatedAt: "2026-07-12T12:00:00.000Z",
    getCurrentPrice: async () => "90",
  });
  assert.equal(result.status, "NO_MATCHING_DATA");
});

test("GUARDRAIL_SHOWN과 shownRuleIds가 있으면 후보에 포함한다", async () => {
  const result = await computeCancelledOrderVirtualPnl({
    snapshots: [guardrailSnapshot("guardrail-shown", "2026-07-12T03:00:00.000Z")],
    reactions: [
      reaction("r1", "guardrail-shown", "CLOSE", "2026-07-12T03:00:01.000Z"),
    ],
    trades: [],
    generatedAt: "2026-07-12T12:00:00.000Z",
    getCurrentPrice: async () => "90",
  });
  assert.equal(result.status, "AVAILABLE");
  assert.equal(result.items[0].snapshotId, "guardrail-shown");
});

test("REVIEW 후 follow-up window 안에 ORDER_INTENT_CLICK이 있으면 진행하지 않음으로 분류하지 않는다", async () => {
  assert.equal(GUARDRAIL_FOLLOW_UP_WINDOW_MS, 10 * 60 * 1000);
  const result = await computeCancelledOrderVirtualPnl({
    snapshots: [
      guardrailSnapshot("reviewed", "2026-07-12T03:00:00.000Z"),
      guardrailSnapshot("follow-up", "2026-07-12T03:09:59.000Z", {
        snapshotTrigger: "ORDER_INTENT_CLICK",
        attemptId: "a2",
        shownRuleIds: [],
      }),
    ],
    reactions: [
      reaction("r1", "reviewed", "REVIEW", "2026-07-12T03:00:01.000Z"),
    ],
    trades: [],
    generatedAt: "2026-07-12T12:00:00.000Z",
    getCurrentPrice: async () => "90",
  });
  assert.equal(result.status, "NO_MATCHING_DATA");
});

test("CLOSE 후 실제 주문이 있으면 진행하지 않음으로 분류하지 않는다", async () => {
  const result = await computeCancelledOrderVirtualPnl({
    snapshots: [guardrailSnapshot("closed", "2026-07-12T03:00:00.000Z")],
    reactions: [
      reaction("r1", "closed", "CLOSE", "2026-07-12T03:00:01.000Z"),
    ],
    trades: [
      {
        tradeLogId: "t1",
        market: "KRW-BTC",
        side: "BUY",
        orderCreatedAt: "2026-07-12T03:05:00.000Z",
      },
    ],
    generatedAt: "2026-07-12T12:00:00.000Z",
    getCurrentPrice: async () => "90",
  });
  assert.equal(result.status, "NO_MATCHING_DATA");
});

test("개인 API 데이터가 없어도 후속 ORDER_INTENT_CLICK으로 주문 진행을 판별한다", async () => {
  const result = await computeCancelledOrderVirtualPnl({
    snapshots: [
      guardrailSnapshot("guardrail", "2026-07-12T03:00:00.000Z"),
      guardrailSnapshot("next-intent", "2026-07-12T03:03:00.000Z", {
        snapshotTrigger: "ORDER_INTENT_CLICK",
        attemptId: "a-next",
        shownRuleIds: [],
      }),
    ],
    reactions: [
      reaction("r1", "guardrail", "REVIEW", "2026-07-12T03:00:01.000Z"),
    ],
    trades: [],
    generatedAt: "2026-07-12T12:00:00.000Z",
    getCurrentPrice: async () => "90",
  });
  assert.equal(result.status, "NO_MATCHING_DATA");
});

test("연결 후보가 여러 개면 임의 연결하지 않고 제외한다", async () => {
  const result = await computeCancelledOrderVirtualPnl({
    snapshots: [
      guardrailSnapshot("guardrail", "2026-07-12T03:00:00.000Z"),
      guardrailSnapshot("candidate-1", "2026-07-12T03:03:00.000Z", {
        snapshotTrigger: "ORDER_INTENT_CLICK",
        attemptId: "a1",
        shownRuleIds: [],
      }),
      guardrailSnapshot("candidate-2", "2026-07-12T03:04:00.000Z", {
        snapshotTrigger: "ORDER_INTENT_CLICK",
        attemptId: "a2",
        shownRuleIds: [],
      }),
    ],
    reactions: [
      reaction("r1", "guardrail", "REVIEW", "2026-07-12T03:00:01.000Z"),
    ],
    trades: [],
    generatedAt: "2026-07-12T12:00:00.000Z",
    getCurrentPrice: async () => "90",
  });
  assert.equal(result.status, "NO_MATCHING_DATA");
});

test("BUY/Sell 가격 방향과 intentAmount 기반 수량을 Decimal로 계산한다", async () => {
  const generatedAt = "2026-07-12T12:00:00.000Z";
  const buyRise = guardrailSnapshot("buy-rise", "2026-07-12T03:00:00.000Z", {
    intentQuantity: null,
    intentAmount: "300",
  });
  const sellRise = guardrailSnapshot("sell-rise", "2026-07-12T04:00:00.000Z", {
    side: "SELL",
    intentQuantity: "3",
  });
  const sellDrop = guardrailSnapshot("sell-drop", "2026-07-12T05:00:00.000Z", {
    side: "SELL",
    intentPrice: null,
    tradePriceAtSnapshot: "100",
    intentQuantity: "3",
  });
  const result = await computeCancelledOrderVirtualPnl({
    snapshots: [buyRise, sellRise, sellDrop],
    reactions: [
      reaction("r1", "buy-rise", "CLOSE", "2026-07-12T03:00:01.000Z"),
      reaction("r2", "sell-rise", "REVIEW", "2026-07-12T04:00:01.000Z"),
      reaction("r3", "sell-drop", "REVIEW", "2026-07-12T05:00:01.000Z"),
    ],
    trades: [],
    generatedAt,
    getCurrentPrice: async (market) => (market === "KRW-BTC" ? "120" : "120"),
  });
  const byId = Object.fromEntries(result.items.map((item) => [item.snapshotId, item]));
  assert.equal(byId["buy-rise"].virtualQuantity, "3");
  assert.equal(byId["buy-rise"].virtualPnl, "60");
  assert.equal(byId["sell-rise"].virtualPnl, "-60");
  assert.equal(byId["sell-drop"].priceQuality, "APPROXIMATED");
});

test("시장가 Snapshot은 tradePriceAtSnapshot을 가격 fallback으로 우선 사용한다", async () => {
  const result = await computeCancelledOrderVirtualPnl({
    snapshots: [
      guardrailSnapshot("market-buy", "2026-07-12T03:00:00.000Z", {
        orderMode: "MARKET",
        intentPrice: "1",
        tradePriceAtSnapshot: "100",
        intentQuantity: "2",
      }),
    ],
    reactions: [
      reaction("r1", "market-buy", "REVIEW", "2026-07-12T03:00:01.000Z"),
    ],
    trades: [],
    generatedAt: "2026-07-12T12:00:00.000Z",
    getCurrentPrice: async () => "90",
  });
  assert.equal(result.items[0].entryPrice, "100");
  assert.equal(result.items[0].priceQuality, "APPROXIMATED");
  assert.equal(result.items[0].virtualPnl, "-20");
});

test("시장별 현재가는 한 번만 조회하고 일부 ticker 실패는 전체 계산을 실패시키지 않는다", async () => {
  const calls = [];
  const result = await computeCancelledOrderVirtualPnl({
    snapshots: [
      guardrailSnapshot("btc-1", "2026-07-12T03:00:00.000Z"),
      guardrailSnapshot("btc-2", "2026-07-12T04:00:00.000Z"),
      guardrailSnapshot("eth-1", "2026-07-12T05:00:00.000Z", {
        market: "KRW-ETH",
      }),
    ],
    reactions: [
      reaction("r1", "btc-1", "REVIEW", "2026-07-12T03:00:01.000Z"),
      reaction("r2", "btc-2", "REVIEW", "2026-07-12T04:00:01.000Z"),
      reaction("r3", "eth-1", "REVIEW", "2026-07-12T05:00:01.000Z"),
    ],
    trades: [],
    generatedAt: "2026-07-12T12:00:00.000Z",
    getCurrentPrice: async (market) => {
      calls.push(market);
      if (market === "KRW-ETH") throw new Error("ticker failed");
      return "90";
    },
  });
  assert.equal(result.status, "AVAILABLE");
  assert.equal(result.sampleCount, 2);
  assert.deepEqual(calls.sort(), ["KRW-BTC", "KRW-ETH"]);
});

test("가격 또는 현재가가 없으면 INSUFFICIENT_DATA로 남긴다", async () => {
  const result = await computeCancelledOrderVirtualPnl({
    snapshots: [
      guardrailSnapshot("missing-entry", "2026-07-12T03:00:00.000Z", {
        intentPrice: null,
        tradePriceAtSnapshot: null,
      }),
      guardrailSnapshot("market-error", "2026-07-12T04:00:00.000Z"),
    ],
    reactions: [
      reaction("r1", "missing-entry", "CLOSE", "2026-07-12T03:00:01.000Z"),
      reaction("r2", "market-error", "REVIEW", "2026-07-12T04:00:01.000Z"),
    ],
    trades: [],
    generatedAt: "2026-07-12T12:00:00.000Z",
    getCurrentPrice: async () => {
      throw new Error("ticker failed");
    },
  });
  assert.equal(result.status, "INSUFFICIENT_DATA");
  assert.equal(result.sampleCount, 0);
});

test("타임라인은 발생 시각 오름차순으로 정렬하고 기존 연결 키를 유지한다", () => {
  const timeline = buildDailyTimeline({
    snapshots: [
      guardrailSnapshot("s1", "2026-07-12T02:00:00.000Z"),
      guardrailSnapshot("s2", "2026-07-12T01:00:00.000Z", {
        snapshotTrigger: "ORDER_INTENT_CLICK",
        attemptId: "a1",
      }),
    ],
    reactions: [reaction("r1", "s1", "REVIEW", "2026-07-12T02:00:01.000Z")],
    feedbacks: [feedback("f1", "a1", "ANSWERED", "2026-07-12T02:00:02.000Z")],
    trades: [],
  });
  assert.deepEqual(
    timeline.map((event) => event.type),
    ["ORDER_ATTEMPT", "GUARDRAIL_TRIGGERED", "GUARDRAIL_REACTION", "FEEDBACK_SUBMITTED"],
  );
  assert.equal(timeline[0].attemptId, "a1");
  assert.equal(timeline[1].snapshotId, "s1");
});

test("inputHash는 updatedAt과 피드백 상태 변화에 반응한다", () => {
  const base = {
    date: "2026-07-12",
    snapshots: [guardrailSnapshot("s1", "2026-07-12T01:00:00.000Z")],
    reactions: [],
    feedbacks: [feedback("f1", "a1", "ANSWERED", "2026-07-12T02:00:00.000Z")],
    trades: [],
    rules: [{ ruleId: "r1", updatedAt: "2026-07-12T00:00:00.000Z", isEnabled: true }],
  };
  const hash1 = buildInputHash(base);
  const hash2 = buildInputHash({
    ...base,
    feedbacks: [feedback("f1", "a1", "DISMISSED", "2026-07-12T02:00:00.000Z")],
  });
  assert.notEqual(hash1, hash2);
});

test("FastAPI 한쪽 실패 시 PARTIAL이고 성공한 응답은 유지한다", () => {
  const result = mergeAnalysisResults({
    existingReport: null,
    overview: {
      status: "fulfilled",
      value: { summary: "요약", flameStatus: "default", cards: [] },
    },
    fieldAnalysis: {
      status: "rejected",
      reason: new Error("field failed"),
    },
  });
  assert.equal(result.status, "PARTIAL");
  assert.equal(result.analysisStatus.overview, "COMPLETED");
  assert.equal(result.analysisStatus.fieldAnalysis, "FAILED");
  assert.equal(result.overview.summary, "요약");
  assert.equal(result.fieldAnalysis, null);
});

test("PARTIAL 재시도는 같은 inputHash에서 실패한 분석만 호출 대상으로 남긴다", () => {
  const pending = getPendingAnalysisTargets(
    {
      inputHash: "hash-1",
      analysisStatus: { overview: "COMPLETED", fieldAnalysis: "FAILED" },
      overview: { summary: "요약", flameStatus: "default", cards: [] },
      fieldAnalysis: null,
    },
    "hash-1",
  );
  assert.deepEqual(pending, {
    overview: false,
    fieldAnalysis: true,
  });
});

test("과거 리포트 선택은 저장된 목록에서 해당 날짜 상세를 고른다", () => {
  const reports = [
    { date: "2026-07-12", reportId: "2026-07-12" },
    { date: "2026-07-11", reportId: "2026-07-11" },
  ];
  assert.equal(selectReportByDate(reports, "2026-07-11").reportId, "2026-07-11");
  assert.equal(selectReportByDate(reports, "2026-07-10"), null);
});

test("메인 대시보드 조회 코드는 FastAPI 호출 함수를 import하지 않는다", () => {
  const pagePath = path.join(__dirname, "../app/dashboard/page.tsx");
  const source = fs.readFileSync(pagePath, "utf8");
  assert.equal(source.includes("requestDashboardInsight"), false);
  assert.equal(source.includes("requestDailyInsightFastApi"), false);
  assert.equal(source.includes("FASTAPI"), false);
  assert.equal(source.includes("/api/insights/daily/generate"), false);
});

function readDashboardFile(relativePath) {
  return fs.readFileSync(path.join(__dirname, "..", relativePath), "utf8");
}

function cssBlock(source, selector) {
  const start = source.indexOf(`${selector} {`);
  assert.notEqual(start, -1, `${selector} block should exist`);
  const end = source.indexOf("\n}", start);
  assert.notEqual(end, -1, `${selector} block should close`);
  return source.slice(start, end);
}

test("사이드바 브랜드는 일반 상태 사각형을 제거하고 focus-visible은 유지한다", () => {
  const sidebar = readDashboardFile("frontend/dashboard/sidebar.tsx");
  const css = readDashboardFile("frontend/dashboard/dashboard.module.css");
  const brand = cssBlock(css, ".brand");
  const brandMark = cssBlock(css, ".brandMark");

  assert.equal(sidebar.includes("CALM INVESTING"), false);
  assert.equal(sidebar.includes("WITH GUARDRAIL"), true);
  assert.equal(sidebar.includes("내가 세운 투자 원칙을"), true);
  assert.equal(sidebar.includes("주문 순간까지 이어가세요"), true);
  assert.match(brand, /border:\s*0;/);
  assert.match(brand, /outline:\s*0;/);
  assert.match(brand, /box-shadow:\s*none;/);
  assert.match(brand, /background:\s*transparent;/);
  assert.match(brandMark, /border:\s*0;/);
  assert.match(css, /\.brand:focus-visible[\s\S]*outline:\s*3px solid/);
});

test("메인 히어로는 원칙 중심 문구와 compact 높이 스타일을 사용한다", () => {
  const overview = readDashboardFile("frontend/dashboard/dashboard-overview.tsx");
  const css = readDashboardFile("frontend/dashboard/dashboard.module.css");
  const welcomeCard = cssBlock(css, ".welcomeCard");

  assert.equal(overview.includes("CALM INVESTING"), false);
  assert.equal(overview.includes("차분한 투자"), false);
  assert.equal(overview.includes("서두르지 않아도 괜찮아요"), false);
  assert.equal(overview.includes("내가 세운 투자 원칙,"), true);
  assert.equal(overview.includes("주문 순간까지 이어가 볼까요?"), true);
  assert.equal(overview.includes("주문 기록과 가드레일 인사이트를 한곳에서 확인해요."), true);
  assert.equal(css.includes("--dashboard-core-height"), false);
  assert.equal(css.includes("minmax(510px"), false);
  assert.match(welcomeCard, /min-height:\s*clamp\(300px,\s*28vw,\s*340px\);/);
});

test("최근 AI 인사이트 카드는 내부 상태와 legacy 문구를 표시용 ViewModel에서 정리한다", () => {
  const overview = readDashboardFile("frontend/dashboard/dashboard-overview.tsx");
  const viewModel = readDashboardFile("frontend/dashboard/latest-insight-card-view-model.ts");
  const css = readDashboardFile("frontend/dashboard/dashboard.module.css");

  assert.equal(overview.includes("overview.flameStatus"), false);
  assert.equal(overview.includes("sad ·"), false);
  assert.equal(viewModel.includes("sad: \"돌아보기\""), true);
  assert.equal(viewModel.includes("fastBurn: \"반복 주문 주의\""), true);
  assert.equal(viewModel.includes("가드레일 이후 계속 진행한 기록"), true);
  assert.equal(viewModel.includes("후회가 남는다고 기록한 주문"), true);
  assert.equal(overview.includes("오늘 기록에서 발견한 패턴"), true);
  assert.equal(overview.includes("다음 주문에서 확인할 것"), true);
  assert.equal((overview.match(/viewModel\.primaryCard \?/g) || []).length, 1);
  assert.equal(overview.includes("overview?.cards.map"), false);
  assert.match(css, /-webkit-line-clamp:\s*3;/);
});

test("최근 AI 인사이트 정량 지표는 실제 값 우선이고 내부 상태 코드를 렌더링하지 않는다", () => {
  const viewModel = readDashboardFile("frontend/dashboard/latest-insight-card-view-model.ts");
  const overview = readDashboardFile("frontend/dashboard/dashboard-overview.tsx");

  assert.equal(overview.includes("AVAILABLE"), false);
  assert.equal(overview.includes("NO_MATCHING_DATA"), false);
  assert.equal(overview.includes("INSUFFICIENT_DATA"), false);
  assert.equal(viewModel.includes("formatKrw(firstItem?.virtualPnl ?? cancelled?.netVirtualPnl)"), true);
  assert.equal(viewModel.includes("formatPercent(firstItem.virtualReturnRate)"), true);
  assert.equal(viewModel.includes("비교 가능한 가격 효과가 아직 없어요."), true);
  assert.equal(overview.includes("실제 주문은 체결되지 않았습니다"), false);
  assert.equal(overview.includes("실제 거래가 발생하지 않았습니다"), false);
});

test("CTA 상태 ViewModel은 피드백 개수와 기존 리포트에 막히지 않고 새 생성을 안내한다", () => {
  const base = {
    date: "2026-07-12",
    eligible: false,
    answeredFeedbackCount: 4,
    requiredFeedbackCount: 5,
    reportStatus: "NOT_CREATED",
    reportId: null,
    hasNewData: false,
  };
  assert.equal(getDailyInsightCtaViewState(base, null), "READY_TO_GENERATE");
  const baseView = buildDailyInsightCtaViewModel(base, null);
  assert.equal(baseView.primaryAction, "AI 인사이트 생성하기");
  assert.equal(baseView.showProgress, false);

  const ready = {
    ...base,
    eligible: true,
    answeredFeedbackCount: 5,
  };
  const readyView = buildDailyInsightCtaViewModel(ready, null);
  assert.equal(getDailyInsightCtaViewState(ready, null), "READY_TO_GENERATE");
  assert.equal(readyView.title, "오늘의 일간 리포트");
  assert.equal(`${readyView.title} ${readyView.message}`.includes("더 쌓이면"), false);

  assert.equal(getDailyInsightCtaViewState({ ...ready, reportStatus: "GENERATING" }, null), "GENERATING");
  assert.equal(getDailyInsightCtaViewState({ ...ready, reportStatus: "COMPLETED", reportId: "2026-07-12" }, baseReport()), "READY_TO_GENERATE");
  assert.equal(getDailyInsightCtaViewState({ ...ready, reportStatus: "PARTIAL", reportId: "2026-07-12" }, baseReport({ status: "PARTIAL" })), "READY_TO_GENERATE");
  assert.equal(getDailyInsightCtaViewState({ ...ready, reportStatus: "FAILED" }, null), "READY_TO_GENERATE");
  assert.equal(getDailyInsightCtaViewState({ ...ready, reportStatus: "STALE", hasNewData: true }, baseReport()), "READY_TO_GENERATE");
});

test("데이터 availability는 개인 주문 데이터 부재와 시장 Snapshot 존재를 구분한다", () => {
  const snapshots = Array.from({ length: 34 }, (_, index) =>
    guardrailSnapshot(`s${index}`, `2026-07-12T03:${String(index).padStart(2, "0")}:00.000Z`, {
      snapshotTrigger: "ORDER_INTENT_CLICK",
      attemptId: `a${index}`,
      shownRuleIds: index < 30 ? ["r1"] : [],
      signedChangeRate: index === 0 ? 0.01 : null,
      shortTermReturn5m: index === 0 ? -0.02 : null,
    }),
  );
  const availability = computeInsightDataAvailability({
    snapshots,
    reactions: [],
    feedbacks: [
      feedback("f1", "a1", "ANSWERED", "2026-07-12T03:01:00.000Z"),
      feedback("f2", "a2", "ANSWERED", "2026-07-12T03:02:00.000Z"),
      feedback("f3", "a3", "ANSWERED", "2026-07-12T03:03:00.000Z"),
      feedback("f4", "a4", "ANSWERED", "2026-07-12T03:04:00.000Z"),
      feedback("f5", "a5", "ANSWERED", "2026-07-12T03:05:00.000Z"),
    ],
    trades: [],
    rules: [],
  });
  assert.equal(availability.personalTrade.available, false);
  assert.equal(availability.fee.available, false);
  assert.equal(availability.slippage.available, false);
  assert.equal(availability.marketContext.available, true);
  assert.equal(availability.orderInfo.uniqueMarketCount, 1);

  const facts = buildFactSummaries({
    sourceCounts: {
      attempts: 34,
      guardrailSnapshots: 30,
      guardrailReactions: 0,
      answeredFeedbacks: 5,
      confirmedTrades: 0,
    },
    metrics: baseReport().metrics,
    availability,
  }).join("\n");
  assert.match(facts, /체결 여부를 확인할 수 없다고 표현/);
  assert.match(facts, /\[데이터 상태-MARKET_CONTEXT\] 분석 가능/);
  assert.match(facts, /\[데이터 상태-FEE\] 분석 불가/);
  assert.match(facts, /PROCEED만 경고 후 계속 진행/);
});

test("AI 결과 후처리는 데이터 없는 수수료·슬리피지·체결 단정을 데이터 부족 카드로 바꾼다", () => {
  const availability = {
    planFeedback: { available: true, sampleCount: 5 },
    guardrailBehavior: { available: true, reactionCount: 3, proceedCount: 1, reviewCount: 1, closeCount: 1 },
    orderInfo: { available: true, sampleCount: 34, uniqueMarketCount: 1 },
    behaviorTiming: { available: true, sampleCount: 34 },
    frequencyPattern: { available: true, sampleCount: 34 },
    marketContext: { available: true, sampleCount: 1 },
    personalTrade: { available: false, sampleCount: 0 },
    fee: { available: false, sampleCount: 0 },
    slippage: { available: false, sampleCount: 0 },
  };
  const sanitized = sanitizeOverviewWithAvailability(
    {
      summary: "실제 주문은 체결되지 않았습니다. 감정적 뇌동매매 없이 차분한 승부사입니다.",
      flameStatus: "default",
      cards: [
        { title: "수수료 출혈", description: "수수료 출혈이 큽니다.", severity: "high" },
        { title: "정밀한 타점", description: "슬리피지 손실 없이 정밀하게 진입했습니다.", severity: "low" },
        { title: "체결 결과", description: "실제 거래가 발생하지 않았습니다.", severity: "low" },
      ],
    },
    availability,
  );
  const text = JSON.stringify(sanitized);
  assert.equal(text.includes("수수료 출혈"), false);
  assert.equal(text.includes("슬리피지 손실 없이"), false);
  assert.equal(text.includes("실제 주문은 체결되지"), false);
  assert.match(text, /거래 비용 분석 데이터 부족/);
  assert.match(text, /체결 가격 분석 데이터 부족/);
  assert.match(text, /실제 주문 결과 데이터 부족/);
});

test("분야별 분석 후처리는 개인 API 데이터 부족을 체결 불가 단정 대신 분석하지 않음으로 표시한다", () => {
  const result = sanitizeFieldAnalysisWithAvailability(
    {
      topics: [
        {
          topic_key: "PERSONAL_API",
          topic_label: "개인 계좌 기반 분석",
          headline: "안정적",
          analysis: "실제 주문은 체결되지 않았습니다.",
          severity: "good",
        },
      ],
      oneLineAdvice: "심호흡을 해보세요.",
    },
    {
      personalTrade: { available: false, sampleCount: 0 },
      marketContext: { available: true, sampleCount: 1 },
    },
  );
  assert.equal(result.topics[0].severity, "unavailable");
  assert.match(result.topics[0].analysis, /실제 주문 API 데이터가 없어/);
  assert.equal(result.oneLineAdvice.includes("심호흡"), false);
});

test("정량 지표 ViewModel은 AVAILABLE에서 실제 금액·수익률·종목을 표시하고 내부 상태 코드를 숨긴다", () => {
  const view = buildVirtualPnlViewModel({
    status: "AVAILABLE",
    sampleCount: 1,
    totalPositiveVirtualPnl: "0",
    totalNegativeVirtualPnl: "-12400",
    netVirtualPnl: "-12400",
    items: [
      {
        snapshotId: "s1",
        capturedAt: "2026-07-11T16:20:00.000Z",
        market: "KRW-BTC",
        side: "BUY",
        entryPrice: "145000000",
        currentPrice: "141500000",
        virtualReturnRate: -0.0241379,
        virtualPnl: "-12400",
        note: "가드레일 반응 이후 동일한 주문 흐름이 확인되지 않았어요.",
      },
    ],
  });
  const text = JSON.stringify(view);
  assert.match(text, /BTC · KRW-BTC/);
  assert.match(text, /145,000,000원/);
  assert.match(text, /-2.41%/);
  assert.match(text, /-12,400원/);
  assert.equal(text.includes("AVAILABLE"), false);

  const empty = buildVirtualPnlViewModel({ status: "NO_MATCHING_DATA", sampleCount: 0, items: [] });
  assert.equal(JSON.stringify(empty).includes("NO_MATCHING_DATA"), false);
});

test("SELL 가상 가격 효과는 공매도 수익이 아니라 상대 가격 효과로 표시한다", () => {
  const view = buildVirtualPnlViewModel({
    status: "AVAILABLE",
    sampleCount: 1,
    totalPositiveVirtualPnl: "0",
    totalNegativeVirtualPnl: "-10",
    netVirtualPnl: "-10",
    items: [
      {
        snapshotId: "s1",
        capturedAt: "2026-07-11T16:20:00.000Z",
        market: "KRW-BTC",
        side: "SELL",
        entryPrice: "100",
        currentPrice: "110",
        virtualReturnRate: -0.1,
        virtualPnl: "-10",
      },
    ],
  });
  assert.match(view.items[0].sellNotice, /공매도 수익이 아니라/);
});

test("리포트 Hero는 confirmedTrades 0과 개인 API 불명확 상태를 미체결로 단정하지 않는다", () => {
  const hero = buildReportHeroViewModel(
    baseReport({
      dataAvailability: {
        personalTrade: { available: false, sampleCount: 0 },
      },
    }),
  );
  assert.deepEqual(hero.badges.includes("실제 주문 데이터 없음"), true);
  assert.equal(JSON.stringify(hero).includes("체결되지"), false);
});

test("주문 흐름 ViewModel은 같은 attemptId 이벤트를 묶고 PROCEED 문구 문법을 고친다", () => {
  const timeline = buildDailyTimeline({
    snapshots: [
      guardrailSnapshot("s1", "2026-07-12T01:00:00.000Z", {
        snapshotTrigger: "ORDER_INTENT_CLICK",
        attemptId: "a1",
      }),
    ],
    reactions: [reaction("r1", "s1", "PROCEED", "2026-07-12T01:00:01.000Z")],
    feedbacks: [feedback("f1", "a1", "ANSWERED", "2026-07-12T01:00:02.000Z")],
    trades: [],
  });
  const grouped = buildOrderFlowViewModels(baseReport({ timeline }));
  assert.equal(grouped.visibleFlows.length, 1);
  assert.equal(grouped.visibleFlows[0].events.length, 3);
  assert.equal(reactionSentence("PROCEED"), "계속 진행을 선택했어요.");
  assert.deepEqual(buildFlowSteps(grouped.visibleFlows[0]).includes("계속 진행을 선택했어요."), true);
});

test("주문 흐름은 기본 5개만 표시하고 나머지와 연결되지 않은 이벤트를 분리한다", () => {
  const timeline = Array.from({ length: 7 }, (_, index) => ({
    id: `e${index}`,
    type: "ORDER_ATTEMPT",
    occurredAt: `2026-07-12T01:0${index}:00.000Z`,
    snapshotId: `s${index}`,
    attemptId: `a${index}`,
    tradeLogId: null,
    market: "KRW-BTC",
    side: "BUY",
    title: "주문 시도",
    description: "주문 의도가 기록됐어요.",
    linkConfidence: "EXACT",
  }));
  timeline.push({
    id: "unlinked",
    type: "FEEDBACK_SUBMITTED",
    occurredAt: "2026-07-12T01:10:00.000Z",
    snapshotId: null,
    attemptId: null,
    tradeLogId: null,
    market: null,
    side: null,
    title: "피드백 작성",
    description: "연결되지 않은 기록",
    linkConfidence: "EXACT",
  });
  const grouped = buildOrderFlowViewModels(baseReport({ timeline }));
  assert.equal(grouped.visibleFlows.length, 5);
  assert.equal(grouped.hiddenFlows.length, 2);
  assert.equal(grouped.unlinkedEvents.length, 1);
});

test("핵심 카드 ViewModel은 PROCEED만 가드레일 이후 계속 진행으로 계산한다", () => {
  const timeline = [
    {
      id: "p",
      type: "GUARDRAIL_REACTION",
      occurredAt: "2026-07-12T01:00:00.000Z",
      snapshotId: "s1",
      attemptId: null,
      tradeLogId: null,
      market: "KRW-BTC",
      side: "BUY",
      title: "가드레일 선택",
      description: "사용자가 계속 진행을 선택했어요.",
      linkConfidence: "EXACT",
    },
    {
      id: "r",
      type: "GUARDRAIL_REACTION",
      occurredAt: "2026-07-12T01:01:00.000Z",
      snapshotId: "s2",
      attemptId: null,
      tradeLogId: null,
      market: "KRW-BTC",
      side: "BUY",
      title: "가드레일 선택",
      description: "사용자가 주문 내용 다시 보기를 선택했어요.",
      linkConfidence: "EXACT",
    },
  ];
  const cards = buildKeyInsightCards(baseReport({ timeline }));
  assert.equal(cards[0].value, "1회 중 2회");
});

test("신규 optional field가 없는 기존 리포트도 렌더링 ViewModel을 만들고 이전 분석 배지를 표시한다", () => {
  const legacy = baseReport();
  delete legacy.analysisStatus;
  delete legacy.suggestionStatus;
  delete legacy.dataAvailability;
  delete legacy.promptVersion;
  delete legacy.analysisVersion;
  const hero = buildReportHeroViewModel(legacy);
  const notice = getReportVersionNotice(legacy);
  assert.equal(hero.title, "오늘의 주문 리포트");
  assert.match(notice.title, /이전 분석 기준/);
});

test("대표 시나리오는 생성 가능, 단정 금지, 단일 종목 다양성 칭찬 금지를 만족한다", async () => {
  const generatedAt = "2026-07-12T12:00:00.000Z";
  const snapshots = Array.from({ length: 34 }, (_, index) =>
    guardrailSnapshot(`scenario-${index}`, index === 0
      ? "2026-07-12T03:00:00.000Z"
      : `2026-07-12T04:${String(index).padStart(2, "0")}:00.000Z`, {
      snapshotTrigger: "ORDER_INTENT_CLICK",
      attemptId: `scenario-a${index}`,
      shownRuleIds: index < 30 ? ["r1"] : [],
      intentPrice: "145000000",
      intentQuantity: "0.003542857142857142",
      tradePriceAtSnapshot: "145000000",
      signedChangeRate: index === 0 ? 0.01 : null,
    }),
  );
  const reactions = [
    reaction("scenario-r0", "scenario-0", "REVIEW", "2026-07-12T03:00:10.000Z"),
    ...Array.from({ length: 7 }, (_, index) =>
      reaction(`scenario-r${index + 1}`, `scenario-${index + 1}`, index % 2 ? "REVIEW" : "PROCEED", `2026-07-12T03:0${index + 1}:10.000Z`),
    ),
  ];
  const virtual = await computeCancelledOrderVirtualPnl({
    snapshots,
    reactions,
    trades: [],
    generatedAt,
    getCurrentPrice: async () => "141500000",
  });
  const report = baseReport({
    timeline: buildDailyTimeline({
      snapshots,
      reactions,
      feedbacks: [
        feedback("sf1", "scenario-a1", "ANSWERED", "2026-07-12T04:01:00.000Z"),
        { ...feedback("sf2", "scenario-a2", "ANSWERED", "2026-07-12T04:02:00.000Z"), selfAssessment: "EMOTIONAL" },
        { ...feedback("sf3", "scenario-a3", "ANSWERED", "2026-07-12T04:03:00.000Z"), selfAssessment: "EMOTIONAL" },
        feedback("sf4", "scenario-a4", "ANSWERED", "2026-07-12T04:04:00.000Z"),
        { ...feedback("sf5", "scenario-a5", "ANSWERED", "2026-07-12T04:05:00.000Z"), selfAssessment: "EMOTIONAL" },
      ],
      trades: [],
    }),
    metrics: {
      ...baseReport().metrics,
      cancelledOrderVirtualPnl: virtual,
    },
  });
  const status = computeEligibility({
    date: "2026-07-12",
    timezone: "Asia/Seoul",
    feedbacks: [
      feedback("sf1", "scenario-a1", "ANSWERED", "2026-07-12T04:01:00.000Z"),
      feedback("sf2", "scenario-a2", "ANSWERED", "2026-07-12T04:02:00.000Z"),
      feedback("sf3", "scenario-a3", "ANSWERED", "2026-07-12T04:03:00.000Z"),
      feedback("sf4", "scenario-a4", "ANSWERED", "2026-07-12T04:04:00.000Z"),
      feedback("sf5", "scenario-a5", "ANSWERED", "2026-07-12T04:05:00.000Z"),
    ],
    report: null,
    inputHash: "scenario",
  });
  assert.equal(buildDailyInsightCtaViewModel(status, null).title, "오늘의 일간 리포트");
  assert.equal(virtual.sampleCount, 1);
  const view = buildVirtualPnlViewModel(virtual);
  const text = JSON.stringify({ hero: buildReportHeroViewModel(report), view });
  assert.match(text, /BTC · KRW-BTC/);
  assert.match(text, /145,000,000원/);
  assert.match(text, /141,500,000원/);
  assert.equal(text.includes("체결되지"), false);
  assert.equal(text.includes("수수료 출혈"), false);
  assert.equal(text.includes("슬리피지 손실 없이"), false);
  assert.equal(text.includes("거래 종목의 다양성이 긍정적"), false);
  assert.equal(buildOrderFlowViewModels(report).visibleFlows.length <= 5, true);
});

test("Extension은 일간 리포트 생성 API를 호출하지 않고 대시보드 query로 안내한다", () => {
  const background = fs.readFileSync(path.join(__dirname, "../chrome-extension/background.js"), "utf8");
  const content = fs.readFileSync(path.join(__dirname, "../chrome-extension/content.js"), "utf8");
  const combined = `${background}\n${content}`;

  assert.equal(combined.includes("/api/insights/daily/generate"), false);
  assert.equal(combined.includes("GENERATE_DAILY_INSIGHT"), false);
  assert.match(content, /GET_DAILY_INSIGHT_STATUS/);
  assert.match(content, /\/dashboard\/ai-insights\?focus=today/);
  assert.match(content, /\/dashboard\/ai-insights\?report=/);
});

test("AI 인사이트 페이지는 저장 리포트 목록과 데스크톱 모달을 사용하고 inline detail을 렌더링하지 않는다", () => {
  const page = readDashboardFile("frontend/dashboard/ai-insights-page.tsx");
  const css = readDashboardFile("frontend/dashboard/dashboard.module.css");

  assert.match(page, /저장된 일간 리포트/);
  assert.match(page, /role="dialog"/);
  assert.match(page, /aria-modal="true"/);
  assert.match(page, /new URLSearchParams\(searchParams\.toString\(\)\)/);
  assert.equal(page.includes("selectedReport ? (\n        <section"), false);
  assert.match(css, /width:\s*min\(1180px,\s*calc\(100vw - 80px\)\);/);
  assert.match(css, /height:\s*min\(88vh,\s*940px\);/);
});

test("백엔드 orderFlows는 attempt, snapshot, feedback, trade를 하나의 흐름으로 묶는다", () => {
  const snapshots = [
    guardrailSnapshot("s1", "2026-07-12T01:00:00.000Z", {
      snapshotTrigger: "ORDER_INTENT_CLICK",
      attemptId: "a1",
      shownRuleIds: ["r1"],
    }),
  ];
  const feedbacks = [
    { ...feedback("f1", "a1", "ANSWERED", "2026-07-12T01:00:02.000Z"), selfAssessment: "EMOTIONAL" },
  ];
  const trades = [
    {
      tradeLogId: "t1",
      attemptId: "a1",
      market: "KRW-BTC",
      side: "BUY",
      orderCreatedAt: "2026-07-12T01:00:03.000Z",
      state: "done",
      executedFunds: "1000",
      executedVolume: "10",
      paidFee: "0.5",
    },
  ];
  const timeline = buildDailyTimeline({
    snapshots,
    reactions: [reaction("r1", "s1", "REVIEW", "2026-07-12T01:00:01.000Z")],
    feedbacks,
    trades,
  });
  const flows = buildOrderFlows({
    snapshots,
    reactions: [reaction("r1", "s1", "REVIEW", "2026-07-12T01:00:01.000Z")],
    feedbacks,
    trades,
    rules: [{ ruleId: "r1", name: "반복 주문" }],
    timeline,
  });
  assert.equal(flows.length, 1);
  assert.equal(flows[0].attemptId, "a1");
  assert.equal(flows[0].guardrail.reaction, "REVIEW");
  assert.equal(flows[0].feedback, "REGRETTED");
  assert.equal(flows[0].trade.availability, "CONFIRMED");
  assert.deepEqual(flows[0].guardrail.ruleNames, ["반복 주문"]);
});

test("가드레일 제안은 데이터 부족이면 후보를 만들지 않고 충분할 때 RuleDTO 후보를 만든다", () => {
  const insufficient = buildGuardrailSuggestions({
    snapshots: [guardrailSnapshot("s1", "2026-07-12T01:00:00.000Z")],
    feedbacks: [],
    rules: [],
  });
  assert.equal(insufficient.status, "INSUFFICIENT_DATA");
  assert.equal(insufficient.newGuardrails.length, 0);

  const suggestionSnapshots = Array.from({ length: 24 }, (_, index) =>
    guardrailSnapshot(`s${index}`, `2026-07-01T01:${String(index).padStart(2, "0")}:00.000Z`, {
      snapshotTrigger: "ORDER_INTENT_CLICK",
      attemptId: `a${index}`,
      orderMode: "MARKET",
      side: "BUY",
      shortTermReturn5m: index < 12 ? 0.04 : 0.01,
      shownRuleIds: [],
    }),
  );
  const suggestionFeedbacks = Array.from({ length: 12 }, (_, index) => ({
    ...feedback(`f${index}`, `a${index}`, "ANSWERED", `2026-07-01T02:${String(index).padStart(2, "0")}:00.000Z`),
    selfAssessment: index < 8 ? "EMOTIONAL" : "PLANNED",
  }));
  const available = buildGuardrailSuggestions({
    suggestionSnapshots,
    suggestionFeedbacks,
    rules: [],
  });
  assert.equal(available.status, "AVAILABLE");
  assert.equal(available.newGuardrails[0].type, "NEW_GUARDRAIL");
  assert.equal(available.newGuardrails[0].status, "PENDING");
  assert.equal(available.newGuardrails[0].proposedRule.expression.nodeType, "GROUP");
});

function currentNoGuardrailSources() {
  const snapshots = Array.from({ length: 10 }, (_, index) =>
    guardrailSnapshot(`s${index}`, `2026-07-12T0${index}:00:00.000Z`, {
      snapshotTrigger: "ORDER_INTENT_CLICK",
      attemptId: `a${index}`,
      shownRuleIds: [],
      primaryShownRuleId: null,
      orderMode: "LIMIT",
      entryPoint: "NORMAL",
      allocationPresetPercent: "CUSTOM",
      modeChangedToMarket: false,
      requestedBalanceRatio: 0.1,
      orderIntentCount1m: 1,
      sameSideIntentCount1m: 1,
      shortTermReturn5m: index === 0 ? 0.01 : undefined,
      signedChangeRate: index === 0 ? 0.02 : undefined,
    }),
  );
  const feedbacks = Array.from({ length: 6 }, (_, index) => ({
    ...feedback(`f${index}`, `a${index}`, "ANSWERED", `2026-07-12T1${index}:00:00.000Z`),
    selfAssessment: index < 3 ? "PLANNED" : "EMOTIONAL",
  }));
  return { snapshots, reactions: [], feedbacks, trades: [], rules: [] };
}

test("sourceCounts guardrail 0이면 linked reaction과 proceed/review/close도 0이다", () => {
  const sources = currentNoGuardrailSources();
  sources.reactions = [
    reaction("orphan", "missing-snapshot", "PROCEED", "2026-07-12T01:00:00.000Z"),
  ];
  const counts = buildSourceCounts(sources);
  const availability = computeInsightDataAvailability(sources);
  const timeline = buildDailyTimeline(sources);

  assert.equal(counts.guardrails, 0);
  assert.equal(counts.guardrailSnapshots, 0);
  assert.equal(counts.reactions, 0);
  assert.equal(counts.guardrailReactions, 0);
  assert.equal(availability.guardrailBehavior.shownGuardrailCount, 0);
  assert.equal(availability.guardrailBehavior.reactionCount, 0);
  assert.equal(availability.guardrailBehavior.proceedCount, 0);
  assert.equal(availability.guardrailBehavior.reviewCount, 0);
  assert.equal(availability.guardrailBehavior.closeCount, 0);
  assert.equal(timeline.some((event) => event.type === "GUARDRAIL_REACTION"), false);
});

test("가드레일 기록 0이면 PROCEED 카드와 요약을 고정 데이터 부족 문구로 바꾼다", () => {
  const sources = currentNoGuardrailSources();
  const availability = computeInsightDataAvailability(sources);
  const sanitized = sanitizeOverviewWithAvailability(
    {
      summary: "가드레일 이후 계속 진행한 비율이 높았어요.",
      flameStatus: "default",
      cards: [
        {
          title: "가드레일 이후 계속 진행한 비율이 높았어요",
          description: "PROCEED 기록이 반복되고 있습니다.",
          severity: "high",
        },
      ],
    },
    availability,
  );
  const text = JSON.stringify(sanitized);
  assert.equal(text.includes("PROCEED 기록이 반복"), false);
  assert.equal(text.includes("계속 진행한 비율"), false);
  assert.match(text, /오늘은 분석할 가드레일 기록이 없어요/);
  assert.equal(sanitized.cards[0].severity, "unavailable");
  assert.equal(sanitized.cards[0].evidence.sampleCount, 0);
});

test("현재 데이터 fixture는 sourceCounts, facts, suggestion payload가 같은 일간 집합을 사용한다", () => {
  const sources = currentNoGuardrailSources();
  const sourceCounts = buildSourceCounts(sources);
  const availability = computeInsightDataAvailability(sources);
  const payload = buildGuardrailSuggestionRequest({
    date: "2026-07-12",
    timezone: "Asia/Seoul",
    generatedAt: "2026-07-12T15:00:00.000Z",
    sources,
    fieldCatalog: {
      signedChangeRate: {
        key: "signedChangeRate",
        valueType: "NUMBER",
        nullable: true,
        ruleEligible: true,
        requiresPrivateApi: false,
        supportedOperators: ["EQ", "NEQ", "GT", "GTE", "LT", "LTE", "IS_NULL", "IS_NOT_NULL"],
        comparisonGroup: "RATE",
        input: { control: "PERCENT" },
      },
    },
  });
  const diagnostics = buildDailyInsightDiagnostics({ sources, suggestionRequest: payload });
  const facts = buildFactSummaries({
    sourceCounts,
    metrics: baseReport().metrics,
    availability,
  }).join("\n");

  assert.equal(sourceCounts.attempts, 10);
  assert.equal(sourceCounts.guardrails, 0);
  assert.equal(sourceCounts.answeredFeedbacks, 6);
  assert.equal(sourceCounts.confirmedTrades, 0);
  assert.equal(payload.snapshots.length, sourceCounts.attempts);
  assert.equal(payload.reactions.length, sourceCounts.guardrailReactions);
  assert.equal(payload.feedbacks.length, sourceCounts.answeredFeedbacks);
  assert.equal(payload.confirmed_trades.length, sourceCounts.confirmedTrades);
  assert.equal(diagnostics.labeledSuggestionSampleCount, 6);
  assert.match(facts, /체결 여부를 확인할 수 없다고 표현/);
  assert.match(facts, /가드레일 기록이 없어/);
});

test("가드레일 suggestion payload builder는 공통 fixture와 동일한 snake_case 계약을 만든다", () => {
  const fixture = JSON.parse(
    fs.readFileSync(path.join(__dirname, "fixtures/guardrail-suggestion-request.json"), "utf8"),
  );
  const payload = buildGuardrailSuggestionRequest({
    date: "2026-07-12",
    timezone: "Asia/Seoul",
    generatedAt: "2026-07-12T15:00:00.000Z",
    sources: currentNoGuardrailSources(),
    fieldCatalog: {
      signedChangeRate: {
        key: "signedChangeRate",
        valueType: "NUMBER",
        nullable: true,
        ruleEligible: true,
        requiresPrivateApi: false,
        supportedOperators: ["EQ", "NEQ", "GT", "GTE", "LT", "LTE", "IS_NULL", "IS_NOT_NULL"],
        comparisonGroup: "RATE",
        input: { control: "PERCENT" },
      },
    },
  });
  assert.deepEqual(payload, fixture);
});

test("분야별 후처리는 단일 종목·타이밍 부족·시장 문맥 문구를 과잉 해석하지 않는다", () => {
  const result = sanitizeFieldAnalysisWithAvailability(
    {
      topics: [
        {
          topic_key: "ORDER_INFO",
          topic_label: "주문 정보 분석",
          headline: "거래 종목 다양성 부족",
          analysis: "리스크 분산에 부정적이고 포트폴리오가 편중됨.",
          severity: "warning",
        },
        {
          topic_key: "BEHAVIOR_TIMING",
          topic_label: "주문 작성 행동",
          headline: "충동 매매 가능성",
          analysis: "전략 개선이 필요하다.",
          severity: "warning",
        },
        {
          topic_key: "MARKET_CONTEXT",
          topic_label: "시장 상황 맥락",
          headline: "분석 미제공",
          analysis: "시장 데이터가 있지만 구체적인 분석은 제공되지 않는다.",
          severity: "caution",
        },
        {
          topic_key: "PERSONAL_API",
          topic_label: "개인 계좌 기반 분석",
          headline: "수수료 평가",
          analysis: "수수료가 낮고 체결도 안정적입니다.",
          severity: "good",
        },
      ],
      oneLineAdvice: "전략 개선이 필요하다.",
    },
    {
      planFeedback: { available: true, sampleCount: 6 },
      guardrailBehavior: { available: false, shownGuardrailCount: 0, reactionCount: 0, proceedCount: 0, reviewCount: 0, closeCount: 0 },
      orderInfo: { available: true, sampleCount: 10, uniqueMarketCount: 1 },
      behaviorTiming: { available: false, sampleCount: 0 },
      frequencyPattern: { available: true, sampleCount: 10 },
      marketContext: { available: true, sampleCount: 1 },
      personalTrade: { available: false, sampleCount: 0 },
      fee: { available: false, sampleCount: 0 },
      slippage: { available: false, sampleCount: 0 },
    },
  );
  const text = JSON.stringify(result);
  assert.equal(text.includes("거래 종목 다양성 부족"), false);
  assert.equal(text.includes("리스크 분산에 부정적"), false);
  assert.equal(text.includes("포트폴리오가 편중"), false);
  assert.equal(text.includes("충동 매매 가능성"), false);
  assert.equal(text.includes("전략 개선이 필요"), false);
  assert.equal(text.includes("구체적인 분석은 제공되지"), false);
  assert.match(text, /오늘은 한 종목의 주문 기록이 수집됐어요/);
  assert.match(text, /주문 작성 시간을 분석할 기록이 부족해요/);
  assert.match(text, /시장 데이터는 수집됐지만 뚜렷한 공통 패턴/);
  assert.match(text, /실제 주문 API 데이터가 없어/);
});

test("오래된 overview 카드는 새 리포트 생성 결과에 재사용되지 않는다", () => {
  const oldReport = baseReport({
    overview: {
      summary: "이전 카드",
      flameStatus: "default",
      cards: [{ title: "이전", description: "이전", severity: "high" }],
    },
  });
  const result = mergeAnalysisResults({
    existingReport: oldReport,
    overview: {
      status: "fulfilled",
      value: { summary: "새 요약", flameStatus: "default", cards: [] },
    },
    fieldAnalysis: {
      status: "fulfilled",
      value: { topics: [], oneLineAdvice: "새 조언" },
    },
  });
  assert.equal(result.overview.summary, "새 요약");
  assert.equal(result.overview.cards.length, 0);
});
