/* eslint-disable @typescript-eslint/no-require-imports */
const test = require("node:test");
const assert = require("node:assert/strict");
const cryptoModule = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");

function loadTradingEngine() {
  const source = fs.readFileSync(
    path.join(__dirname, "../frontend/demo/trading-engine.ts"),
    "utf8",
  );
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  const moduleHarness = { exports: {} };
  const context = {
    crypto: cryptoModule.webcrypto,
    Date,
    exports: moduleHarness.exports,
    module: moduleHarness,
    Number,
    Object,
    String,
  };
  vm.runInNewContext(output, context);
  return moduleHarness.exports;
}

const {
  cancelOrder,
  createInitialPortfolio,
  settleOpenOrders,
  submitOrder,
  validateOrder,
} = loadTradingEngine();

const quote = {
  bestAsk: 100_000,
  bestBid: 99_000,
  askSize: 0.05,
  bidSize: 0.05,
};

test("데모 계좌는 새 세션마다 1천만원으로 시작한다", () => {
  const portfolio = createInitialPortfolio();
  assert.equal(portfolio.krw.balance, 10_000_000);
  assert.equal(portfolio.krw.locked, 0);
  assert.deepEqual(Object.keys(portfolio.assets), []);
});

test("시장가 매수는 즉시 체결되고 수수료와 평균 매수가를 반영한다", () => {
  const result = submitOrder(
    createInitialPortfolio(),
    {
      market: "KRW-BTC",
      side: "BUY",
      orderType: "MARKET",
      price: 0,
      volume: 0,
      amount: 100_000,
    },
    quote,
  );

  assert.equal(result.order.state, "done");
  assert.equal(result.order.executed_funds, "100000");
  assert.equal(result.order.paid_fee, "50");
  assert.equal(result.portfolio.krw.balance, 9_899_950);
  assert.equal(result.portfolio.assets.BTC.balance, 1);
  assert.equal(result.portfolio.assets.BTC.avgBuyPrice, 100_000);
});

test("비시장성 지정가는 자산을 잠그고 호가 도달 시 부분·전체 체결된다", () => {
  const submitted = submitOrder(
    createInitialPortfolio(),
    {
      market: "KRW-BTC",
      side: "BUY",
      orderType: "LIMIT",
      price: 90_000,
      volume: 0.1,
      amount: 9_000,
    },
    quote,
  );
  assert.equal(submitted.order.state, "wait");
  assert.ok(submitted.portfolio.krw.locked > 9_000);

  const partial = settleOpenOrders(submitted.portfolio, "KRW-BTC", {
    ...quote,
    bestAsk: 89_000,
  });
  assert.equal(partial.orders[0].state, "trade");
  assert.equal(partial.orders[0].executed_volume, "0.05");

  const completed = settleOpenOrders(partial, "KRW-BTC", {
    ...quote,
    bestAsk: 88_000,
  });
  assert.equal(completed.orders[0].state, "done");
  assert.equal(completed.orders[0].remaining_volume, "0");
  assert.equal(completed.krw.locked, 0);
});

test("미체결 주문 취소와 잔고 부족 검증이 가상 자산만 변경한다", () => {
  const submitted = submitOrder(
    createInitialPortfolio(),
    {
      market: "KRW-BTC",
      side: "BUY",
      orderType: "LIMIT",
      price: 90_000,
      volume: 0.1,
      amount: 9_000,
    },
    quote,
  );
  const canceled = cancelOrder(
    submitted.portfolio,
    submitted.order.uuid,
  );
  assert.equal(canceled.orders[0].state, "cancel");
  assert.equal(canceled.krw.balance, 10_000_000);
  assert.equal(canceled.krw.locked, 0);

  assert.deepEqual(
    JSON.parse(
      JSON.stringify(
        validateOrder(
          createInitialPortfolio(),
          {
            market: "KRW-BTC",
            side: "SELL",
            orderType: "MARKET",
            price: 0,
            volume: 1,
            amount: 99_000,
          },
          quote,
        ),
      ),
    ),
    { ok: false, reason: "ASSET_SHORTAGE" },
  );
});
