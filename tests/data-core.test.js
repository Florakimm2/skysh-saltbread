/* eslint-disable @typescript-eslint/no-require-imports */
const test = require("node:test");
const assert = require("node:assert/strict");
const {
  buildBehaviorSnapshot,
  calculateAverageBuyAmount,
  calculateMarketData,
  createGuardrailRuleSnapshot,
  detectOrderActionSide,
  evaluateGuardrailRules,
  evaluateRuleExpression,
  getOrderTimeParts,
  mapUpbitOrder,
  parseMarket,
  resolveVisualMode,
  RULE_FIELD_CATALOG,
} = require("../chrome-extension/data-core.js");

test("capturedAt에서 KST 주문 시간을 파생한다", () => {
  assert.deepEqual(getOrderTimeParts("2026-07-08T00:00:00.000Z"), {
    orderTime: "09:00",
    orderTimeMinutes: 540,
  });
  assert.deepEqual(getOrderTimeParts("invalid"), {
    orderTime: null,
    orderTimeMinutes: null,
  });
});

test("매수하기와 매도하기를 주문 액션으로 구분한다", () => {
  assert.equal(detectOrderActionSide("매수하기"), "BUY");
  assert.equal(detectOrderActionSide("매수확인"), "BUY");
  assert.equal(detectOrderActionSide(" 매도하기 "), "SELL");
  assert.equal(detectOrderActionSide("매도확인"), "SELL");
  assert.equal(detectOrderActionSide("매수주문"), "BUY");
  assert.equal(detectOrderActionSide("매도"), "SELL");
  assert.equal(detectOrderActionSide("매수 탭"), null);
});

test("Upbit URL에서 현재 마켓을 추출한다", () => {
  assert.equal(
    parseMarket("https://upbit.com/exchange?code=CRIX.UPBIT.KRW-BTC"),
    "KRW-BTC",
  );
  assert.equal(
    parseMarket("https://upbit.com/exchange?market=krw-eth"),
    "KRW-ETH",
  );
});

test("최근 행동 데이터만 집계한다", () => {
  const now = Date.parse("2026-06-28T01:00:00Z");
  const behavior = buildBehaviorSnapshot(
    {
      market: "KRW-BTC",
      buyClicksByMarket: {
        "KRW-BTC": [now - 10_000, now - 70_000, now - 20_000],
      },
      inputEditTimestamps: [now - 10_000, now - 170_000, now - 190_000],
      maxClickedSinceLastOrder: true,
      clientAvgBuyAmount: 500_000,
      visibleDurationMs: 20_000,
      visibleSince: now - 5_000,
    },
    now,
  );

  assert.deepEqual(behavior, {
    is_max_button_clicked: true,
    client_avg_buy_amount: 500_000,
    buy_click_count_1m: 2,
    input_edit_count: 2,
    page_stay_duration: 25,
  });
});

test("분봉과 전체 티커에서 시장 파생 데이터를 계산한다", () => {
  const now = Date.parse("2026-06-28T01:20:30Z");
  const candles = Array.from({ length: 16 }, (_, index) => ({
    candle_date_time_utc: `2026-06-28T01:${String(19 - index).padStart(2, "0")}:00`,
    trade_price: index >= 14 ? 100 : 106,
    opening_price: 100,
    candle_acc_trade_volume: index === 0 ? 40 : 10,
  }));
  const result = calculateMarketData({
    market: "KRW-BTC",
    candles,
    tickers: [
      {
        market: "KRW-BTC",
        trade_price: 106,
        signed_change_rate: 0.1,
      },
      { market: "KRW-ETH", signed_change_rate: -0.2 },
      { market: "KRW-XRP", signed_change_rate: 0.15 },
      { market: "KRW-DOGE", signed_change_rate: 0.01 },
    ],
    marketDetails: [
      {
        market: "KRW-BTC",
        market_event: {
          warning: false,
          caution: { PRICE_FLUCTUATIONS: true },
        },
      },
    ],
    now,
  });

  assert.equal(result.current_price, 106);
  assert.equal(result.market_data.price_change_rate_15m, 6);
  assert.equal(result.market_data.volume_change_rate_1m, 300);
  assert.equal(result.market_data.is_top3_volatility, true);
  assert.equal(result.market_data.has_warning_badge, true);
});

test("Upbit 주문 응답을 detect DTO 형식으로 변환한다", () => {
  const order = mapUpbitOrder(
    {
      market: "KRW-BTC",
      side: "ask",
      state: "done",
      ord_type: "market",
      price: null,
      volume: "0.1",
      executed_volume: "0.1",
      executed_funds: "9000000",
      created_at: "2026-06-28T10:00:00+09:00",
    },
    { BTC: 100_000_000 },
  );

  assert.deepEqual(order, {
    market: "KRW-BTC",
    order_side: "SELL",
    order_status: "DONE",
    order_type: "MARKET",
    order_price: null,
    order_volume: 0.1,
    order_amount: 9_000_000,
    realized_loss_pct_1h: 10,
    order_request_time: "2026-06-28T10:00:00+09:00",
    order_cancel_time: null,
  });
});

test("최근 매수 체결 금액 평균을 계산한다", () => {
  const orders = [
    { side: "bid", executed_funds: "100000" },
    { side: "ask", executed_funds: "500000" },
    { side: "bid", executed_funds: "300000" },
  ];

  assert.equal(calculateAverageBuyAmount(orders), 200_000);
});

test("사용자 규칙 expression은 AND/OR와 null 조건을 판정한다", () => {
  const expression = {
    nodeType: "GROUP",
    operator: "OR",
    children: [
      {
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
            leftField: "requestedBalanceRatio",
            operator: "GTE",
            rightOperand: { operandType: "LITERAL", value: 0.7 },
          },
        ],
      },
      {
        nodeType: "CONDITION",
        leftField: "baseAssetAvgBuyPriceBeforeSnapshot",
        operator: "IS_NULL",
      },
    ],
  };

  assert.equal(
    evaluateRuleExpression(expression, {
      side: "BUY",
      requestedBalanceRatio: 0.8,
      baseAssetAvgBuyPriceBeforeSnapshot: "100",
    }),
    true,
  );
  assert.equal(
    evaluateRuleExpression(expression, {
      side: "SELL",
      requestedBalanceRatio: 0.8,
      baseAssetAvgBuyPriceBeforeSnapshot: null,
    }),
    true,
  );
  assert.equal(
    evaluateRuleExpression(expression, {
      side: "SELL",
      requestedBalanceRatio: 0.8,
      baseAssetAvgBuyPriceBeforeSnapshot: "100",
    }),
    false,
  );
});

test("사용자 규칙은 우선순위와 비활성 규칙을 반영한다", () => {
  const rules = [
    {
      ruleId: "disabled",
      isEnabled: false,
      priority: 0,
      visualMode: "SCARED",
      expression: {
        nodeType: "CONDITION",
        leftField: "side",
        operator: "EQ",
        rightOperand: { operandType: "LITERAL", value: "BUY" },
      },
    },
    {
      ruleId: "medium",
      isEnabled: true,
      priority: 10,
      visualMode: "CURIOUS",
      warningTitle: "중간",
      warningMessage: "중간 규칙",
      expression: {
        nodeType: "CONDITION",
        leftField: "side",
        operator: "EQ",
        rightOperand: { operandType: "LITERAL", value: "BUY" },
      },
    },
    {
      ruleId: "top",
      isEnabled: true,
      priority: 1,
      visualMode: "FAST_BURN",
      warningTitle: "우선",
      warningMessage: "우선 규칙",
      expression: {
        nodeType: "CONDITION",
        leftField: "orderMode",
        operator: "IN",
        rightOperand: { operandType: "LITERAL", value: ["MARKET", "BEST"] },
      },
    },
  ];
  const result = evaluateGuardrailRules(rules, {
    side: "BUY",
    orderMode: "MARKET",
  });

  assert.equal(result.detected, true);
  assert.deepEqual(result.matchedRuleIds, ["top", "medium"]);
  assert.equal(result.primaryRuleId, "top");
  assert.equal(result.visualMode, "FAST_BURN");
});

test("주문하는 시간 조건은 분 단위 숫자로 비교한다", () => {
  const morning = {
    nodeType: "CONDITION",
    leftField: "orderTimeMinutes",
    operator: "GTE",
    rightOperand: { operandType: "LITERAL", value: 540 },
  };
  const beforeEvening = {
    nodeType: "CONDITION",
    leftField: "orderTimeMinutes",
    operator: "LT",
    rightOperand: { operandType: "LITERAL", value: 1080 },
  };
  const lateNightRange = {
    nodeType: "GROUP",
    operator: "OR",
    children: [
      {
        nodeType: "CONDITION",
        leftField: "orderTimeMinutes",
        operator: "GTE",
        rightOperand: { operandType: "LITERAL", value: 1380 },
      },
      {
        nodeType: "CONDITION",
        leftField: "orderTimeMinutes",
        operator: "LTE",
        rightOperand: { operandType: "LITERAL", value: 120 },
      },
    ],
  };

  assert.equal(evaluateRuleExpression(morning, { orderTimeMinutes: 540 }), true);
  assert.equal(evaluateRuleExpression(morning, { orderTimeMinutes: 539 }), false);
  assert.equal(
    evaluateRuleExpression(beforeEvening, { orderTimeMinutes: 1079 }),
    true,
  );
  assert.equal(
    evaluateRuleExpression(beforeEvening, { orderTimeMinutes: 1080 }),
    false,
  );
  assert.equal(
    evaluateRuleExpression(lateNightRange, { orderTimeMinutes: 1410 }),
    true,
  );
  assert.equal(
    evaluateRuleExpression(lateNightRange, { orderTimeMinutes: 90 }),
    true,
  );
  assert.equal(
    evaluateRuleExpression(lateNightRange, { orderTimeMinutes: 720 }),
    false,
  );
  assert.equal(evaluateRuleExpression(morning, {}), false);
});

test("가드레일 규칙 snapshot은 경고 당시 표시와 조건 정보를 포함한다", () => {
  const expression = {
    nodeType: "CONDITION",
    leftField: "orderMode",
    operator: "EQ",
    rightOperand: { operandType: "LITERAL", value: "MARKET" },
  };
  const snapshot = createGuardrailRuleSnapshot({
    ruleId: "market-buy-warning",
    name: "시장가 매수 확인",
    description: "시장가 주문 전 확인",
    priority: 3,
    riskLevel: "HIGH",
    visualMode: "FAST_BURN",
    expression,
    warningTitle: "시장가 주문이에요",
    warningMessage: "가격 변동을 한 번 더 확인해 주세요.",
    isEnabled: true,
  });

  assert.deepEqual(snapshot, {
    ruleId: "market-buy-warning",
    name: "시장가 매수 확인",
    description: "시장가 주문 전 확인",
    priority: 3,
    riskLevel: "HIGH",
    visualMode: "FAST_BURN",
    expression,
    warningTitle: "시장가 주문이에요",
    warningMessage: "가격 변동을 한 번 더 확인해 주세요.",
  });
});

test("snapshot 기반 시장·개인·행동 규칙 6종을 평가한다", () => {
  const rules = [
    {
      ruleId: "rapid-buy",
      isEnabled: true,
      priority: 1,
      expression: {
        nodeType: "GROUP",
        operator: "AND",
        children: [
          {
            nodeType: "CONDITION",
            leftField: "signedChangeRate",
            operator: "GTE",
            rightOperand: { operandType: "LITERAL", value: 0.1 },
          },
          {
            nodeType: "CONDITION",
            leftField: "side",
            operator: "EQ",
            rightOperand: { operandType: "LITERAL", value: "BUY" },
          },
        ],
      },
    },
    {
      ruleId: "short-return-market",
      isEnabled: true,
      priority: 2,
      expression: {
        nodeType: "GROUP",
        operator: "AND",
        children: [
          {
            nodeType: "CONDITION",
            leftField: "shortTermReturn5m",
            operator: "GTE",
            rightOperand: { operandType: "LITERAL", value: 0.05 },
          },
          {
            nodeType: "CONDITION",
            leftField: "orderMode",
            operator: "EQ",
            rightOperand: { operandType: "LITERAL", value: "MARKET" },
          },
        ],
      },
    },
    {
      ruleId: "large-balance-ratio",
      isEnabled: true,
      priority: 3,
      expression: {
        nodeType: "CONDITION",
        leftField: "requestedBalanceRatio",
        operator: "GTE",
        rightOperand: { operandType: "LITERAL", value: 0.5 },
      },
    },
    {
      ruleId: "many-orders",
      isEnabled: true,
      priority: 4,
      expression: {
        nodeType: "CONDITION",
        leftField: "actualOrderCreatedCount10m",
        operator: "GTE",
        rightOperand: { operandType: "LITERAL", value: 3 },
      },
    },
    {
      ruleId: "loss-sell",
      isEnabled: true,
      priority: 5,
      expression: {
        nodeType: "GROUP",
        operator: "AND",
        children: [
          {
            nodeType: "CONDITION",
            leftField: "priceVsAvgBuyRateAtSnapshot",
            operator: "LTE",
            rightOperand: { operandType: "LITERAL", value: -0.08 },
          },
          {
            nodeType: "CONDITION",
            leftField: "side",
            operator: "EQ",
            rightOperand: { operandType: "LITERAL", value: "SELL" },
          },
        ],
      },
    },
    {
      ruleId: "repeat-intent",
      isEnabled: true,
      priority: 6,
      expression: {
        nodeType: "CONDITION",
        leftField: "orderIntentCount1m",
        operator: "GTE",
        rightOperand: { operandType: "LITERAL", value: 3 },
      },
    },
  ];

  const buyResult = evaluateGuardrailRules(rules, {
    side: "BUY",
    orderMode: "MARKET",
    signedChangeRate: 0.11,
    shortTermReturn5m: 0.06,
    requestedBalanceRatio: 0.5,
    actualOrderCreatedCount10m: 3,
    priceVsAvgBuyRateAtSnapshot: -0.09,
    orderIntentCount1m: 3,
  });
  assert.deepEqual(buyResult.matchedRuleIds, [
    "rapid-buy",
    "short-return-market",
    "large-balance-ratio",
    "many-orders",
    "repeat-intent",
  ]);

  const sellResult = evaluateGuardrailRules(rules, {
    side: "SELL",
    orderMode: "LIMIT",
    priceVsAvgBuyRateAtSnapshot: -0.09,
    orderIntentCount1m: 1,
  });
  assert.deepEqual(sellResult.matchedRuleIds, ["loss-sell"]);

  const missingDataResult = evaluateGuardrailRules(rules, {
    side: "BUY",
    orderMode: "MARKET",
  });
  assert.equal(missingDataResult.detected, false);
});

test("사용자 규칙은 decimal string FIELD 비교와 NOT_IN을 처리한다", () => {
  assert.equal(
    evaluateRuleExpression(
      {
        nodeType: "CONDITION",
        leftField: "tradePriceAtSnapshot",
        operator: "LT",
        rightOperand: {
          operandType: "FIELD",
          field: "baseAssetAvgBuyPriceBeforeSnapshot",
        },
      },
      {
        tradePriceAtSnapshot: "99.99",
        baseAssetAvgBuyPriceBeforeSnapshot: "100.00",
      },
    ),
    true,
  );
  assert.equal(
    evaluateRuleExpression(
      {
        nodeType: "CONDITION",
        leftField: "orderMode",
        operator: "NOT_IN",
        rightOperand: { operandType: "LITERAL", value: ["LIMIT"] },
      },
      { orderMode: "MARKET" },
    ),
    true,
  );
});

test("content snapshot 숫자·불리언 필드는 문자열이 아니라 타입에 맞게 비교한다", () => {
  assert.equal(
    evaluateRuleExpression(
      {
        nodeType: "CONDITION",
        leftField: "orderIntentCount1m",
        operator: "GT",
        rightOperand: { operandType: "LITERAL", value: 2 },
      },
      { orderIntentCount1m: 10 },
    ),
    true,
  );
  assert.equal(
    evaluateRuleExpression(
      {
        nodeType: "CONDITION",
        leftField: "modeChangedToMarket",
        operator: "EQ",
        rightOperand: { operandType: "LITERAL", value: true },
      },
      { modeChangedToMarket: true },
    ),
    true,
  );
  assert.equal(
    evaluateRuleExpression(
      {
        nodeType: "CONDITION",
        leftField: "spreadRate",
        operator: "LT",
        rightOperand: { operandType: "LITERAL", value: 0.01 },
      },
      { spreadRate: 0.001 },
    ),
    true,
  );
});

test("사용자 규칙은 배열 경보와 allocation preset을 판정한다", () => {
  assert.equal(
    evaluateRuleExpression(
      {
        nodeType: "CONDITION",
        leftField: "marketRiskFlags",
        operator: "IN",
        rightOperand: {
          operandType: "LITERAL",
          value: ["WARNING", "CAUTION_TRADING_VOLUME_SOARING"],
        },
      },
      { marketRiskFlags: ["CAUTION_TRADING_VOLUME_SOARING"] },
    ),
    true,
  );
  assert.equal(
    evaluateRuleExpression(
      {
        nodeType: "CONDITION",
        leftField: "marketRiskFlags",
        operator: "NOT_IN",
        rightOperand: {
          operandType: "LITERAL",
          value: ["WARNING"],
        },
      },
      { marketRiskFlags: [] },
    ),
    true,
  );
  assert.equal(
    evaluateRuleExpression(
      {
        nodeType: "CONDITION",
        leftField: "allocationPresetPercent",
        operator: "EQ",
        rightOperand: {
          operandType: "LITERAL",
          value: "CUSTOM",
        },
      },
      { allocationPresetPercent: "CUSTOM" },
    ),
    true,
  );
});

test("사용자 규칙은 의미가 맞는 FIELD 비교만 판정한다", () => {
  assert.equal(
    evaluateRuleExpression(
      {
        nodeType: "CONDITION",
        leftField: "tradePriceAtSnapshot",
        operator: "LT",
        rightOperand: {
          operandType: "FIELD",
          field: "baseAssetAvgBuyPriceBeforeSnapshot",
        },
      },
      {
        tradePriceAtSnapshot: "20",
        baseAssetAvgBuyPriceBeforeSnapshot: "100",
      },
    ),
    true,
  );
  assert.equal(
    evaluateRuleExpression(
      {
        nodeType: "CONDITION",
        leftField: "draftDurationMs",
        operator: "GT",
        rightOperand: {
          operandType: "FIELD",
          field: "priceChangeRate",
        },
      },
      {
        draftDurationMs: 5000,
        priceChangeRate: 0.1,
      },
    ),
    false,
  );
});

test("개인 API 값이 null이면 해당 조건만 false이고 OR 공개 조건은 계속 판정한다", () => {
  const expression = {
    nodeType: "GROUP",
    operator: "OR",
    children: [
      {
        nodeType: "CONDITION",
        leftField: "baseAssetAvgBuyPriceBeforeSnapshot",
        operator: "GT",
        rightOperand: { operandType: "LITERAL", value: "100" },
      },
      {
        nodeType: "CONDITION",
        leftField: "sameSideIntentCount1m",
        operator: "GTE",
        rightOperand: { operandType: "LITERAL", value: 3 },
      },
    ],
  };

  assert.equal(
    evaluateRuleExpression(expression, {
      baseAssetAvgBuyPriceBeforeSnapshot: null,
      sameSideIntentCount1m: 3,
    }),
    true,
  );
});

test("규칙 엔진 카탈로그는 OrderContextSnapshotDTO 규칙 대상 필드를 포함한다", () => {
  const expectedFields = [
    "snapshotTrigger",
    "market",
    "side",
    "orderMode",
    "entryPoint",
    "intentPrice",
    "intentQuantity",
    "intentAmount",
    "requestedBalanceRatio",
    "allocationPresetPercent",
    "draftDurationMs",
    "lastEditToSnapshotMs",
    "draftEditCount",
    "amountChangeRate",
    "modeChangedToMarket",
    "orderbookClickToSnapshotMs",
    "orderIntentCount1m",
    "actualOrderCreatedCount10m",
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
    "tradePriceAtSnapshot",
    "shortTermReturn5m",
    "signedChangeRate",
    "spreadRate",
    "marketRiskFlags",
    "pricePositionIn5mRange",
    "volumeSpikeRatio5m",
    "baseAssetAvgBuyPriceBeforeSnapshot",
    "priceVsAvgBuyRateAtSnapshot",
  ];

  for (const field of expectedFields) {
    assert.equal(Boolean(RULE_FIELD_CATALOG[field]?.ruleEligible), true, field);
  }

  for (const field of [
    "snapshotId",
    "attemptId",
    "capturedAt",
    "matchedRuleIdsAtSnapshot",
    "primaryShownRuleId",
    "shownRuleIds",
  ]) {
    assert.equal(RULE_FIELD_CATALOG[field]?.ruleEligible, false, field);
  }
});

test("visualMode는 DTO 값과 기존 alias를 모두 지원한다", () => {
  assert.equal(resolveVisualMode("SCARED"), "SCARED");
  assert.equal(resolveVisualMode("pink"), "FAST_BURN");
  assert.equal(resolveVisualMode("FAST_BURN"), "FAST_BURN");
  assert.equal(resolveVisualMode("blue"), "SAD");
  assert.equal(resolveVisualMode(null), "DEFAULT");
});
