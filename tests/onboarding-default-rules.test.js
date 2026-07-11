/* eslint-disable @typescript-eslint/no-require-imports */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");
const { evaluateGuardrailRules, RULE_FIELD_CATALOG } = require("../chrome-extension/data-core.js");

function loadOnboardingData() {
  const source = fs.readFileSync(
    path.join(__dirname, "../frontend/onboarding/onboarding-data.ts"),
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
    exports: moduleHarness.exports,
    module: moduleHarness,
    require() {
      return {};
    },
  };
  vm.runInNewContext(output, context);
  return moduleHarness.exports;
}

const { DEMO_PATTERNS, buildSavedRules } = loadOnboardingData();
const SUPPORTED_OPERATORS = new Set([
  "IS_NULL",
  "IS_NOT_NULL",
  "EQ",
  "NEQ",
  "GT",
  "GTE",
  "LT",
  "LTE",
  "IN",
  "NOT_IN",
]);

test("온보딩 기본 규칙은 1~3개 조건만 사용하고 개인 API 없이 평가 가능하다", () => {
  assert.equal(DEMO_PATTERNS.length, 3);

  for (const pattern of DEMO_PATTERNS) {
    assert.equal(pattern.requiresPrivateApi, false, pattern.id);
    assert.equal(pattern.expression.nodeType, "GROUP", pattern.id);
    assert.equal(pattern.expression.operator, "AND", pattern.id);
    assert.ok(pattern.expression.children.length >= 1, pattern.id);
    assert.ok(pattern.expression.children.length <= 3, pattern.id);

    for (const condition of pattern.expression.children) {
      const field = RULE_FIELD_CATALOG[condition.leftField];
      assert.equal(Boolean(field?.ruleEligible), true, condition.leftField);
      assert.equal(SUPPORTED_OPERATORS.has(condition.operator), true);
    }
  }
});

test("온보딩 기본 규칙은 현재 규칙 엔진에서 실제로 매칭된다", () => {
  const rules = buildSavedRules(
    "user-onboarding-test",
    ["chaseBuy", "panicSell", "repeatOrders"],
    {},
  );

  const chase = evaluateGuardrailRules(rules, {
    side: "BUY",
    orderMode: "MARKET",
    shortTermReturn5m: 0.052,
    orderIntentCount1m: 1,
  });
  assert.equal(chase.detected, true);
  assert.equal(chase.matchedRuleIds.includes("demo-chaseBuy-v1"), true);

  const sell = evaluateGuardrailRules(rules, {
    side: "SELL",
    orderMode: "MARKET",
    shortTermReturn5m: -0.061,
    orderIntentCount1m: 1,
  });
  assert.equal(sell.detected, true);
  assert.equal(sell.matchedRuleIds.includes("demo-panicSell-v1"), true);

  const repeat = evaluateGuardrailRules(rules, {
    side: "BUY",
    orderMode: "LIMIT",
    shortTermReturn5m: 0,
    orderIntentCount1m: 3,
  });
  assert.equal(repeat.detected, true);
  assert.equal(repeat.matchedRuleIds.includes("demo-repeatOrders-v1"), true);
});

test("온보딩 완료 payload는 선택한 규칙만 중복 없이 생성한다", () => {
  const rules = buildSavedRules(
    "user-onboarding-test",
    ["repeatOrders", "repeatOrders", "chaseBuy"],
    { repeatOrders: false },
  );
  const ids = rules.map((rule) => rule.ruleId);

  assert.equal(JSON.stringify(ids), JSON.stringify(["demo-chaseBuy-v1", "demo-repeatOrders-v1"]));
  assert.equal(rules.find((rule) => rule.ruleId === "demo-repeatOrders-v1").isEnabled, false);
});
