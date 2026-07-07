/* eslint-disable @typescript-eslint/no-require-imports */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");

function loadDetectService() {
  const sourcePath = path.join(
    __dirname,
    "../backend/modules/ext/detect/service.ts",
  );
  const source = fs.readFileSync(sourcePath, "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  const moduleHarness = { exports: {} };
  const context = {
    Date,
    exports: moduleHarness.exports,
    module: moduleHarness,
  };

  vm.runInNewContext(output, context);
  return moduleHarness.exports;
}

const { detectEmotionTrade } = loadDetectService();
const now = Date.parse("2026-06-28T10:30:00+09:00");

function minutesAgo(minutes) {
  return new Date(now - minutes * 60_000).toISOString();
}

function createInput(overrides = {}) {
  return {
    market: overrides.market || "KRW-BTC",
    current_price: 100,
    market_data: {
      price_change_rate_15m: 0.2,
      volume_change_rate_1m: 20,
      is_top3_volatility: false,
      has_warning_badge: false,
      ...overrides.market_data,
    },
    current_order: {
      order_side: "BUY",
      order_status: "WAIT",
      order_type: "LIMIT",
      order_price: 99,
      order_volume: 1,
      order_amount: 500,
      realized_loss_pct_1h: null,
      order_request_time: new Date(now).toISOString(),
      order_cancel_time: null,
      ...overrides.current_order,
    },
    behavior_data: {
      is_max_button_clicked: false,
      client_avg_buy_amount: 500,
      buy_click_count_1m: 1,
      input_edit_count: 1,
      page_stay_duration: 300,
      ...overrides.behavior_data,
    },
    recent_orders: overrides.recent_orders || [],
  };
}

function lossSell(minutes = 10) {
  return {
    market: "KRW-BTC",
    order_side: "SELL",
    order_status: "DONE",
    order_type: "MARKET",
    order_price: null,
    order_volume: 1,
    order_amount: 100,
    realized_loss_pct_1h: 4,
    order_request_time: minutesAgo(minutes),
    order_cancel_time: null,
  };
}

function cancelBuy(minutes, price) {
  return {
    market: "KRW-BTC",
    order_side: "BUY",
    order_status: "CANCEL",
    order_type: "LIMIT",
    order_price: price,
    order_volume: 1,
    order_amount: price,
    realized_loss_pct_1h: null,
    order_request_time: minutesAgo(minutes),
    order_cancel_time: minutesAgo(minutes),
  };
}

test("문서 기준의 정상 주문은 감정 매매로 감지하지 않는다", () => {
  const result = detectEmotionTrade(createInput());

  assert.equal(result.detected, false);
  assert.equal(result.type, null);
  assert.deepEqual(Array.from(result.matchedRuleIds), []);
  assert.equal(result.primaryRuleId, null);
  assert.equal(
    result.message,
    "현재 감정적 매매 패턴은 감지되지 않았어요.",
  );
});

test("FOMO는 급등·공격적 매수·빠른 진입이 모두 있어야 한다", () => {
  const detected = detectEmotionTrade(
    createInput({
      market_data: { price_change_rate_15m: 5 },
      current_order: { order_type: "MARKET", order_price: null },
      behavior_data: { page_stay_duration: 180 },
    }),
  );
  const notSurging = detectEmotionTrade(
    createInput({
      current_order: { order_type: "MARKET", order_price: null },
      behavior_data: { page_stay_duration: 180 },
    }),
  );

  assert.equal(detected.type, "FOMO_CHASING");
  assert.deepEqual(Array.from(detected.matchedRuleIds), ["CHASE_BUY_V1"]);
  assert.equal(detected.primaryRuleId, "CHASE_BUY_V1");
  assert.equal(notSurging.detected, false);
});

test("복수 매매는 3% 이상 손실 후 15분 내 재진입을 감지한다", () => {
  const result = detectEmotionTrade(
    createInput({
      current_order: { order_type: "MARKET", order_price: null },
      recent_orders: [lossSell(15)],
    }),
  );

  assert.equal(result.type, "REVENGE_TRADING");
});

test("망설임은 매수 입력 수정 4회 또는 최근 취소 3회를 감지한다", () => {
  const edited = detectEmotionTrade(
    createInput({ behavior_data: { input_edit_count: 4 } }),
  );
  const canceled = detectEmotionTrade(
    createInput({
      recent_orders: [
        cancelBuy(1, 97),
        cancelBuy(2, 96),
        cancelBuy(3, 95),
      ],
    }),
  );

  assert.equal(edited.type, "HESITATION");
  assert.equal(canceled.type, "HESITATION");
});

test("최대 금액은 급등 또는 최근 손실과 결합될 때만 감지한다", () => {
  const withoutContext = detectEmotionTrade(
    createInput({ behavior_data: { is_max_button_clicked: true } }),
  );
  const withSurge = detectEmotionTrade(
    createInput({
      market_data: { price_change_rate_15m: 5 },
      behavior_data: { is_max_button_clicked: true },
    }),
  );
  const withLoss = detectEmotionTrade(
    createInput({
      behavior_data: { is_max_button_clicked: true },
      recent_orders: [lossSell(15)],
    }),
  );

  assert.equal(withoutContext.detected, false);
  assert.equal(withSurge.type, "ALL_IN_IMPULSE");
  assert.equal(withLoss.type, "ALL_IN_IMPULSE");
});

test("금액 급증은 매수 금액이 최근 평균의 3배 이상일 때만 감지한다", () => {
  const belowThreshold = detectEmotionTrade(
    createInput({ current_order: { order_amount: 1499 } }),
  );
  const atThreshold = detectEmotionTrade(
    createInput({ current_order: { order_amount: 1500 } }),
  );

  assert.equal(belowThreshold.detected, false);
  assert.equal(atThreshold.type, "AMOUNT_SPIKE");
});

test("연속 시장가 매수는 1분 내 3회부터 감지한다", () => {
  const result = detectEmotionTrade(
    createInput({
      current_order: { order_type: "MARKET", order_price: null },
      behavior_data: { buy_click_count_1m: 3 },
    }),
  );

  assert.equal(result.type, "MACHINE_GUN_TRADING");
});

test("고위험 종목은 체류 30초 이내 진입만 감지한다", () => {
  const atThreshold = detectEmotionTrade(
    createInput({
      market_data: { is_top3_volatility: true },
      behavior_data: { page_stay_duration: 30 },
    }),
  );
  const overThreshold = detectEmotionTrade(
    createInput({
      market_data: { is_top3_volatility: true },
      behavior_data: { page_stay_duration: 30.01 },
    }),
  );

  assert.equal(atThreshold.type, "HIGH_RISK_HOPPING");
  assert.equal(overThreshold.detected, false);
});

test("매도 주문은 금액 급증이나 망설임으로 오탐하지 않는다", () => {
  const largeSell = detectEmotionTrade(
    createInput({
      current_order: { order_side: "SELL", order_amount: 1500 },
    }),
  );
  const editedSell = detectEmotionTrade(
    createInput({
      current_order: { order_side: "SELL" },
      behavior_data: { input_edit_count: 4 },
    }),
  );

  assert.equal(largeSell.detected, false);
  assert.equal(editedSell.detected, false);
});

test("테스트 페이지의 7개 데모가 의도한 패턴으로 모두 분류된다", () => {
  const scenarios = [
    {
      expected: "FOMO_CHASING",
      input: {
        market_data: {
          price_change_rate_15m: 6.2,
          volume_change_rate_1m: 340,
        },
        current_order: {
          order_type: "LIMIT",
          order_price: 106.5,
          order_amount: 1_200,
        },
        behavior_data: { page_stay_duration: 32 },
      },
    },
    {
      expected: "REVENGE_TRADING",
      input: {
        market_data: {
          price_change_rate_15m: 0.8,
          volume_change_rate_1m: 30,
        },
        current_order: {
          order_type: "MARKET",
          order_price: null,
          order_amount: 2_400,
        },
        behavior_data: { page_stay_duration: 48 },
        recent_orders: [lossSell(10)],
      },
    },
    {
      expected: "HESITATION",
      input: {
        market_data: {
          price_change_rate_15m: 1.1,
          volume_change_rate_1m: 25,
        },
        current_order: {
          order_price: 99.8,
          order_amount: 900,
        },
        behavior_data: {
          input_edit_count: 9,
          page_stay_duration: 165,
        },
        recent_orders: [
          cancelBuy(1, 97),
          cancelBuy(2, 96),
          cancelBuy(3, 95),
        ],
      },
    },
    {
      expected: "ALL_IN_IMPULSE",
      input: {
        market_data: {
          price_change_rate_15m: 6.1,
          volume_change_rate_1m: 180,
        },
        current_order: {
          order_type: "MARKET",
          order_price: null,
          order_amount: 9_800,
        },
        behavior_data: {
          is_max_button_clicked: true,
          page_stay_duration: 24,
        },
      },
    },
    {
      expected: "AMOUNT_SPIKE",
      input: {
        market_data: {
          price_change_rate_15m: 0.6,
          volume_change_rate_1m: 20,
        },
        current_order: { order_amount: 3_000 },
        behavior_data: { page_stay_duration: 92 },
      },
    },
    {
      expected: "MACHINE_GUN_TRADING",
      input: {
        market_data: {
          price_change_rate_15m: 2,
          volume_change_rate_1m: 90,
        },
        current_order: {
          order_type: "MARKET",
          order_price: null,
          order_amount: 450,
        },
        behavior_data: {
          buy_click_count_1m: 6,
          page_stay_duration: 58,
        },
      },
    },
    {
      expected: "HIGH_RISK_HOPPING",
      input: {
        market_data: {
          price_change_rate_15m: 3.4,
          volume_change_rate_1m: 140,
          is_top3_volatility: true,
          has_warning_badge: true,
        },
        current_order: {
          order_type: "MARKET",
          order_price: null,
          order_amount: 1_400,
        },
        behavior_data: { page_stay_duration: 14 },
      },
    },
  ];

  for (const [index, scenario] of scenarios.entries()) {
    const result = detectEmotionTrade(createInput(scenario.input));
    assert.equal(
      result.type,
      scenario.expected,
      `${index + 1}번 시나리오 분류`,
    );
  }
});
