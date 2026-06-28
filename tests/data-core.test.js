/* eslint-disable @typescript-eslint/no-require-imports */
const test = require("node:test");
const assert = require("node:assert/strict");
const {
  buildBehaviorSnapshot,
  calculateAverageBuyAmount,
  calculateMarketData,
  mapUpbitOrder,
  parseMarket,
  resolveFlameMode,
} = require("../chrome-extension/data-core.js");

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
