/* eslint-disable @typescript-eslint/no-require-imports */
const test = require("node:test");
const assert = require("node:assert/strict");
const {
  buildBehaviorSnapshot,
  calculateAverageBuyAmount,
  calculateMarketData,
  detectOrderActionSide,
  evaluateGuardrailRules,
  evaluateRuleExpression,
  mapUpbitOrder,
  parseMarket,
  resolveFlameMode,
  resolveVisualMode,
} = require("../chrome-extension/data-core.js");

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

test("감정 매매 감지 결과와 주문 방향을 불꽃 모드로 바꾼다", () => {
  assert.equal(resolveFlameMode({ detected: true }, "BUY"), "pink");
  assert.equal(resolveFlameMode({ detected: true }, "SELL"), "blue");
  assert.equal(
    resolveFlameMode(
      { detected: true, type: "REVENGE_TRADING" },
      "BUY",
    ),
    "blue",
  );
  assert.equal(
    resolveFlameMode({ detected: true, type: "HESITATION" }, "BUY"),
    "blue",
  );
  assert.equal(resolveFlameMode({ detected: false }, "SELL"), "default");
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

test("visualMode는 DTO 값과 기존 alias를 모두 지원한다", () => {
  assert.equal(resolveVisualMode("SCARED"), "SCARED");
  assert.equal(resolveVisualMode("pink"), "SCARED");
  assert.equal(resolveVisualMode("blue"), "SAD");
  assert.equal(resolveVisualMode(null), "DEFAULT");
});
