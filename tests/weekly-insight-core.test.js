/* eslint-disable @typescript-eslint/no-require-imports */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { buildDailyTimeline } = require("../backend/modules/insight/daily-core.js");
const {
  buildWeeklyDailyBreakdown,
  buildWeeklyFactSummaries,
  buildWeeklyGuardrailSuggestionRequest,
  buildWeeklyInputHash,
  buildWeeklyMetrics,
  buildWeeklyOrderFlows,
  buildWeeklySourceCounts,
  computeTwentyFourHourVirtualOrderResult,
  getPreviousWeeklyPeriod,
  getWeeklyPeriod,
  REQUIRED_WEEKLY_FEEDBACK_COUNT,
  sanitizeWeeklyFieldAnalysis,
  sanitizeWeeklyOverview,
} = require("../backend/modules/insight/weekly-core.js");

function snapshot(id, capturedAt, overrides = {}) {
  return {
    snapshotId: id,
    userId: "u1",
    attemptId: `attempt-${id}`,
    snapshotTrigger: "ORDER_INTENT_CLICK",
    capturedAt,
    market: "KRW-BTC",
    side: "BUY",
    orderMode: "LIMIT",
    intentPrice: "100",
    intentQuantity: "2",
    intentAmount: null,
    tradePriceAtSnapshot: "100",
    shownRuleIds: [],
    primaryShownRuleId: null,
    updatedAt: capturedAt,
    ...overrides,
  };
}

function guardrailSnapshot(id, capturedAt, overrides = {}) {
  return snapshot(id, capturedAt, {
    snapshotTrigger: "GUARDRAIL_SHOWN",
    shownRuleIds: ["rule-1"],
    primaryShownRuleId: "rule-1",
    attemptId: null,
    ...overrides,
  });
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

function feedback(id, attemptId, status, respondedAt, selfAssessment = "PLANNED") {
  return {
    feedbackId: id,
    attemptId,
    feedbackStatus: status,
    selfAssessment: status === "ANSWERED" ? selfAssessment : null,
    feedbackShownAt: respondedAt,
    respondedAt,
    updatedAt: respondedAt,
  };
}

function baseAvailability(overrides = {}) {
  return {
    planFeedback: { available: true, sampleCount: 6 },
    guardrailBehavior: {
      available: false,
      shownGuardrailCount: 0,
      reactionCount: 0,
      proceedCount: 0,
      reviewCount: 0,
      closeCount: 0,
    },
    orderInfo: { available: true, sampleCount: 10, uniqueMarketCount: 1 },
    behaviorTiming: { available: false, sampleCount: 0 },
    frequencyPattern: { available: true, sampleCount: 10 },
    marketContext: { available: true, sampleCount: 1 },
    personalTrade: { available: false, sampleCount: 0 },
    fee: { available: false, sampleCount: 0 },
    slippage: { available: false, sampleCount: 0 },
    ...overrides,
  };
}

test("KST 주간 범위는 월요일 00:00부터 일요일 23:59:59.999까지 계산한다", () => {
  assert.deepEqual(
    getWeeklyPeriod({
      weekKey: "2026-W28",
      timezone: "Asia/Seoul",
      now: "2026-07-12T14:59:59.999Z",
    }),
    {
      weekKey: "2026-W28",
      timezone: "Asia/Seoul",
      periodStart: "2026-07-05T15:00:00.000Z",
      periodEnd: "2026-07-12T14:59:59.999Z",
      periodEndExclusive: "2026-07-12T15:00:00.000Z",
      periodState: "OPEN",
      isCurrentWeek: true,
    },
  );

  const closed = getWeeklyPeriod({
    weekKey: "2026-W28",
    timezone: "Asia/Seoul",
    now: "2026-07-12T15:00:00.000Z",
  });
  assert.equal(closed.periodState, "CLOSED");
  assert.equal(closed.isCurrentWeek, false);
  assert.equal(
    getPreviousWeeklyPeriod({
      timezone: "Asia/Seoul",
      now: "2026-07-12T15:00:00.000Z",
    }).weekKey,
    "2026-W28",
  );
});

test("연말 ISO week와 월 변경 주차를 안정적으로 계산한다", () => {
  const yearEnd = getWeeklyPeriod({
    timezone: "Asia/Seoul",
    now: "2021-01-03T14:59:59.999Z",
  });
  assert.equal(yearEnd.weekKey, "2020-W53");
  assert.equal(yearEnd.periodStart, "2020-12-27T15:00:00.000Z");
  assert.equal(yearEnd.periodEnd, "2021-01-03T14:59:59.999Z");

  const monthBoundary = getWeeklyPeriod({
    timezone: "Asia/Seoul",
    now: "2026-08-01T03:00:00.000Z",
  });
  assert.equal(monthBoundary.weekKey, "2026-W31");
  assert.equal(monthBoundary.periodStart, "2026-07-26T15:00:00.000Z");
});

test("주간 생성 조건은 ANSWERED 5개이며 DISMISSED는 제외한다", () => {
  const period = getWeeklyPeriod({
    weekKey: "2026-W28",
    timezone: "Asia/Seoul",
    now: "2026-07-10T00:00:00.000Z",
  });
  const sources = {
    period,
    snapshots: [],
    reactions: [],
    trades: [],
    feedbacks: [
      feedback("f1", "a1", "ANSWERED", "2026-07-06T01:00:00.000Z"),
      feedback("f2", "a2", "ANSWERED", "2026-07-06T02:00:00.000Z"),
      feedback("f3", "a3", "ANSWERED", "2026-07-07T03:00:00.000Z"),
      feedback("f4", "a4", "ANSWERED", "2026-07-08T04:00:00.000Z"),
      feedback("f5", "a5", "DISMISSED", "2026-07-09T05:00:00.000Z"),
    ],
  };
  assert.equal(buildWeeklySourceCounts(sources).answeredFeedbacks, 4);
  sources.feedbacks.push(feedback("f6", "a6", "ANSWERED", "2026-07-10T06:00:00.000Z"));
  assert.equal(buildWeeklySourceCounts(sources).answeredFeedbacks, REQUIRED_WEEKLY_FEEDBACK_COUNT);
});

test("가드레일 표시가 0이면 reaction과 PROCEED/REVIEW/CLOSE도 0으로 집계한다", () => {
  const sources = {
    snapshots: [
      snapshot("s1", "2026-07-06T01:00:00.000Z"),
      snapshot("s2", "2026-07-06T02:00:00.000Z"),
    ],
    reactions: [reaction("r-orphan", "missing", "PROCEED", "2026-07-06T02:01:00.000Z")],
    feedbacks: [],
    trades: [],
  };
  const counts = buildWeeklySourceCounts({
    ...sources,
    period: getWeeklyPeriod({ weekKey: "2026-W28", timezone: "Asia/Seoul" }),
  });
  assert.equal(counts.shownGuardrails, 0);
  assert.equal(counts.reactions, 0);
  assert.equal(counts.proceedCount, 0);
  assert.equal(counts.reviewCount, 0);
  assert.equal(counts.closeCount, 0);
});

test("주간 일별 집계는 활동 없는 날을 0으로 유지한다", () => {
  const period = getWeeklyPeriod({
    weekKey: "2026-W28",
    timezone: "Asia/Seoul",
    now: "2026-07-12T00:00:00.000Z",
  });
  const breakdown = buildWeeklyDailyBreakdown({
    period,
    sources: {
      snapshots: [
        snapshot("monday", "2026-07-06T01:00:00.000Z"),
        guardrailSnapshot("wednesday", "2026-07-08T01:00:00.000Z"),
      ],
      reactions: [reaction("r1", "wednesday", "REVIEW", "2026-07-08T01:01:00.000Z")],
      feedbacks: [feedback("f1", "attempt-monday", "ANSWERED", "2026-07-06T02:00:00.000Z")],
      trades: [],
    },
  });
  assert.equal(breakdown.length, 7);
  assert.deepEqual(
    breakdown.map((day) => day.date),
    ["2026-07-06", "2026-07-07", "2026-07-08", "2026-07-09", "2026-07-10", "2026-07-11", "2026-07-12"],
  );
  assert.equal(breakdown[1].active, false);
  assert.equal(breakdown[1].orderAttemptCount, 0);
  assert.equal(breakdown[2].shownGuardrailCount, 1);
  assert.equal(breakdown[2].reviewCount, 1);
});

test("주간 주문 흐름은 시간순 정렬하고 snapshot rule name 교차 재사용을 막는다", () => {
  const snapshots = [
    snapshot("late", "2026-07-06T03:00:00.000Z", {
      side: "BUY",
      shownRuleIds: ["buy-rule"],
      primaryShownRuleId: "buy-rule",
      ruleSnapshots: [
        {
          ruleId: "buy-rule",
          name: "매수 규칙",
          expression: {
            nodeType: "CONDITION",
            leftField: "side",
            operator: "EQ",
            rightOperand: { operandType: "LITERAL", value: "BUY" },
          },
        },
      ],
    }),
    snapshot("early", "2026-07-06T01:00:00.000Z", {
      side: "SELL",
      shownRuleIds: ["buy-rule"],
      primaryShownRuleId: "buy-rule",
      ruleSnapshots: [
        {
          ruleId: "buy-rule",
          name: "매수 규칙",
          expression: {
            nodeType: "CONDITION",
            leftField: "side",
            operator: "EQ",
            rightOperand: { operandType: "LITERAL", value: "BUY" },
          },
        },
      ],
    }),
  ];
  const timeline = buildDailyTimeline({ snapshots, reactions: [], feedbacks: [], trades: [] });
  const flows = buildWeeklyOrderFlows({
    snapshots,
    reactions: [],
    feedbacks: [],
    trades: [],
    rules: [{ ruleId: "buy-rule", name: "전역 규칙 이름" }],
    timeline,
  });

  assert.deepEqual(flows.map((flow) => flow.snapshotIds[0]), ["early", "late"]);
  assert.deepEqual(flows[0].guardrail.ruleNames, []);
  assert.deepEqual(flows[1].guardrail.ruleNames, ["매수 규칙"]);
  assert.equal(flows[0].diagnostics.some((item) => item.type === "RULE_SIDE_MISMATCH"), true);
});

test("24시간 가상 주문 결과는 T+24h 가격만 사용하고 미성숙 기록을 제외한다", async () => {
  const calls = [];
  const result = await computeTwentyFourHourVirtualOrderResult({
    snapshots: [
      snapshot("buy", "2026-07-06T01:00:00.000Z", { side: "BUY", intentPrice: "100", intentQuantity: "2" }),
      snapshot("sell", "2026-07-06T02:00:00.000Z", { side: "SELL", intentPrice: "100", intentQuantity: "3" }),
      snapshot("not-matured", "2026-07-07T02:30:00.000Z", { side: "BUY", intentPrice: "100", intentQuantity: "1" }),
    ],
    generatedAt: "2026-07-07T02:00:00.000Z",
    getPriceNear: async (market, targetAt) => {
      calls.push({ market, targetAt });
      return { price: targetAt === "2026-07-07T01:00:00.000Z" ? "90" : "110", matchedAt: targetAt };
    },
  });
  assert.equal(result.status, "AVAILABLE");
  assert.equal(result.sampleCount, 2);
  assert.equal(result.notMaturedCount, 1);
  assert.deepEqual(calls.map((call) => call.targetAt), [
    "2026-07-07T01:00:00.000Z",
    "2026-07-07T02:00:00.000Z",
  ]);
  assert.equal(result.items[0].value, "-20");
  assert.equal(result.items[1].value, "-30");
  assert.match(result.items[0].note, /가상 가격 하락/);
  assert.equal(JSON.stringify(result).includes("피했"), false);
});

test("주간 fact 입력은 관찰값과 계산값만 담고 가드레일 0건 모순 문구를 만들지 않는다", () => {
  const period = getWeeklyPeriod({ weekKey: "2026-W28", timezone: "Asia/Seoul" });
  const sourceCounts = {
    activeDays: 1,
    snapshots: 10,
    orderAttempts: 10,
    shownGuardrails: 0,
    reactions: 0,
    proceedCount: 0,
    reviewCount: 0,
    closeCount: 0,
    answeredFeedbacks: 6,
    plannedFeedbacks: 3,
    regrettedFeedbacks: 3,
    dismissedFeedbacks: 0,
    confirmedTrades: 0,
    uniqueMarkets: 1,
  };
  const metrics = buildWeeklyMetrics({
    sources: { snapshots: [], reactions: [], feedbacks: [], trades: [] },
    twentyFourHourVirtualOrderResult: {
      status: "NO_MATCHING_DATA",
      sampleCount: 0,
      notMaturedCount: 0,
      missingPriceCount: 0,
      missingEntryCount: 0,
      netValue: "0",
      items: [],
      disclaimer: "",
    },
  });
  const facts = buildWeeklyFactSummaries({
    period,
    sourceCounts,
    dailyBreakdown: buildWeeklyDailyBreakdown({ period, sources: {} }),
    metrics,
    availability: baseAvailability(),
  }).join("\n");

  assert.match(facts, /주문 시도 10회/);
  assert.match(facts, /실제 표시된 가드레일 0회/);
  assert.match(facts, /실제 주문 데이터가 없으면 체결, 미체결, 주문 실패, 수수료, 손익을 단정하지 않는다/);
  assert.match(facts, /한 종목의 주문 기록만으로 전체 포트폴리오 분산을 평가하지 않는다/);
  assert.equal(/PROCEED.*반복/.test(facts), false);
});

test("주간 후처리는 가드레일·체결·단일 종목 과잉 해석을 저장 전에 교체한다", () => {
  const overview = sanitizeWeeklyOverview(
    {
      summary: "가드레일 이후 계속 진행한 비율이 높았어요.",
      flameStatus: "default",
      cards: [
        {
          title: "PROCEED 반복",
          description: "경고를 무시했습니다.",
          severity: "warning",
        },
      ],
    },
    baseAvailability(),
    { activeDays: 1, answeredFeedbacks: 6, uniqueMarkets: 1 },
  );
  assert.match(overview.summary, /이번 주 기록은 일부 거래일에 집중/);
  assert.equal(JSON.stringify(overview).includes("PROCEED 반복"), false);

  const field = sanitizeWeeklyFieldAnalysis(
    {
      topics: [
        {
          topic_key: "ORDER_INFO",
          topic_label: "주문 정보",
          headline: "거래 종목 다양성 부족",
          analysis: "리스크 분산에 부정적이고 포트폴리오가 편중됨.",
          severity: "warning",
        },
        {
          topic_key: "BEHAVIOR_TIMING",
          topic_label: "주문 시간",
          headline: "충동 매매",
          analysis: "전략 개선이 필요합니다.",
          severity: "warning",
        },
        {
          topic_key: "PERSONAL_API",
          topic_label: "실제 주문",
          headline: "수수료 안정",
          analysis: "수수료와 체결이 안정적입니다.",
          severity: "good",
        },
      ],
      oneLineAdvice: "오늘 전략 개선이 필요합니다.",
    },
    baseAvailability(),
    { uniqueMarkets: 1 },
  );
  const text = JSON.stringify(field);
  assert.equal(text.includes("거래 종목 다양성 부족"), false);
  assert.equal(text.includes("리스크 분산에 부정적"), false);
  assert.equal(text.includes("충동 매매"), false);
  assert.equal(text.includes("수수료와 체결이 안정"), false);
  assert.match(text, /이번 주에는 한 종목의 주문 기록이 수집됐어요/);
  assert.match(text, /주문 작성 시간을 비교할 기록이 충분하지 않아요/);
  assert.match(text, /실제 주문 데이터가 없어 체결 결과와 수수료는 분석하지 않았어요/);
});

test("주간 inputHash는 weekKey와 버전·원본 updatedAt 변화에 반응한다", () => {
  const period = getWeeklyPeriod({ weekKey: "2026-W28", timezone: "Asia/Seoul" });
  const sources = {
    snapshots: [snapshot("s1", "2026-07-06T01:00:00.000Z", { updatedAt: "2026-07-06T01:00:00.000Z" })],
    reactions: [],
    feedbacks: [feedback("f1", "attempt-s1", "ANSWERED", "2026-07-06T02:00:00.000Z")],
    trades: [],
    rules: [{ ruleId: "rule-1", updatedAt: "2026-07-01T00:00:00.000Z", isEnabled: true }],
  };
  const hash = buildWeeklyInputHash({ period, sources });
  const nextHash = buildWeeklyInputHash({
    period,
    sources: {
      ...sources,
      snapshots: [snapshot("s1", "2026-07-06T01:00:00.000Z", { updatedAt: "2026-07-06T01:01:00.000Z" })],
    },
  });
  const otherWeekHash = buildWeeklyInputHash({
    period: getWeeklyPeriod({ weekKey: "2026-W29", timezone: "Asia/Seoul" }),
    sources,
  });
  assert.notEqual(hash, nextHash);
  assert.notEqual(hash, otherWeekHash);
});

test("주간 가드레일 제안 payload는 snake_case 계약과 weekly 기간 필드를 가진다", () => {
  const period = getWeeklyPeriod({
    weekKey: "2026-W28",
    timezone: "Asia/Seoul",
    now: "2026-07-12T00:00:00.000Z",
  });
  const payload = buildWeeklyGuardrailSuggestionRequest({
    period,
    generatedAt: "2026-07-12T15:00:00.000Z",
    sources: {
      snapshots: [snapshot("s1", "2026-07-06T01:00:00.000Z")],
      reactions: [],
      feedbacks: [feedback("f1", "attempt-s1", "ANSWERED", "2026-07-06T02:00:00.000Z")],
      trades: [],
      rules: [],
    },
    fieldCatalog: {
      signedChangeRate: {
        key: "signedChangeRate",
        valueType: "NUMBER",
        nullable: true,
        ruleEligible: true,
        requiresPrivateApi: false,
        supportedOperators: ["EQ", "NEQ", "GT"],
        comparisonGroup: "RATE",
        input: { control: "PERCENT" },
      },
    },
  });
  assert.equal(payload.analysis_date, "2026-W28");
  assert.equal(payload.week_key, "2026-W28");
  assert.equal(payload.period_start, "2026-07-05T15:00:00.000Z");
  assert.equal(payload.period_end, "2026-07-12T14:59:59.999Z");
  assert.equal(payload.snapshots[0].snapshot_trigger, "ORDER_INTENT_CLICK");
  assert.equal(payload.confirmed_trades.length, 0);
  assert.equal(payload.field_catalog.signedChangeRate.value_type, "NUMBER");
  assert.equal(JSON.stringify(payload).includes("snapshotTrigger"), false);

  const fixture = JSON.parse(
    fs.readFileSync(path.join(__dirname, "fixtures/weekly-guardrail-suggestion-request.json"), "utf8"),
  );
  assert.equal(fixture.week_key, payload.week_key);
  assert.equal(fixture.period_start, payload.period_start);
  assert.equal(fixture.period_end, payload.period_end);
});

test("Extension과 AI 인사이트 화면은 주간 API만 신규 흐름에 사용한다", () => {
  const background = fs.readFileSync(path.join(__dirname, "../chrome-extension/background.js"), "utf8");
  const content = fs.readFileSync(path.join(__dirname, "../chrome-extension/content.js"), "utf8");
  const page = fs.readFileSync(path.join(__dirname, "../frontend/dashboard/ai-insights-page.tsx"), "utf8");
  const actions = fs.readFileSync(path.join(__dirname, "../frontend/dashboard/weekly-insight-actions.tsx"), "utf8");
  const dashboard = fs.readFileSync(path.join(__dirname, "../frontend/dashboard/dashboard-overview.tsx"), "utf8");
  const combinedExtension = `${background}\n${content}`;

  assert.match(combinedExtension, /\/api\/insights\/weekly\/status/);
  assert.equal(combinedExtension.includes("/api/insights/weekly/generate"), false);
  assert.equal(combinedExtension.includes("GET_DAILY_INSIGHT_STATUS"), false);
  assert.match(content, /data-weekly-insight/);
  assert.match(content, /\/dashboard\/ai-insights\?week=/);
  assert.match(page, /저장된 주간 리포트/);
  assert.match(actions, /\/api\/insights\/weekly\/generate/);
  assert.equal(page.includes("/api/insights/daily/generate"), false);
  assert.equal(actions.includes("/api/insights/daily/generate"), false);
  assert.match(dashboard, /지난주 AI 인사이트|이번 주 AI 인사이트/);
});

test("FastAPI weekly contract fixture는 schema validation 정보를 드러내지 않는 작은 payload다", () => {
  const fixture = JSON.parse(
    fs.readFileSync(path.join(__dirname, "fixtures/weekly-guardrail-suggestion-request.json"), "utf8"),
  );
  assert.equal(fixture.week_key, "2026-W28");
  assert.equal(fixture.snapshots.length, 6);
  assert.equal(fixture.feedbacks.length, 6);
  assert.equal(fixture.reactions.length, 0);
  assert.equal(fixture.confirmed_trades.length, 0);
  assert.equal(JSON.stringify(fixture).includes("Firebase"), false);
  assert.equal(JSON.stringify(fixture).includes("upbit-order"), false);
  assert.equal(JSON.stringify(fixture).includes("apiKey"), false);
});
