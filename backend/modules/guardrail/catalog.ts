// backend/modules/guardrail/catalog.ts

import type { RuleFieldDefinition, RuleOperator } from "./types";

const NUMERIC_OPERATORS: RuleOperator[] = [
  "EQ",
  "NEQ",
  "GT",
  "GTE",
  "LT",
  "LTE",
  "IS_NULL",
  "IS_NOT_NULL",
];
const ENUM_OPERATORS: RuleOperator[] = ["EQ", "NEQ", "IS_NULL", "IS_NOT_NULL"];
const ARRAY_OPERATORS: RuleOperator[] = [
  "IN",
  "NOT_IN",
  "IS_NULL",
  "IS_NOT_NULL",
];
const SYSTEM_OPERATORS: RuleOperator[] = ["IS_NULL", "IS_NOT_NULL"];

const snapshotTriggerOptions = [
  { label: "주문하려는 순간", value: "ORDER_INTENT_CLICK" },
  {
    label: "가드레일 표시 이후",
    value: "GUARDRAIL_SHOWN",
    hiddenInPicker: true,
  },
];

const sideOptions = [
  { label: "매수", value: "BUY" },
  { label: "매도", value: "SELL" },
  { label: "알 수 없음", value: "UNKNOWN", hiddenInPicker: true },
];

const orderModeOptions = [
  { label: "지정가", value: "LIMIT" },
  { label: "시장가", value: "MARKET" },
  { label: "최유리 주문", value: "BEST" },
  { label: "예약 주문", value: "RESERVED" },
  { label: "알 수 없음", value: "UNKNOWN", hiddenInPicker: true },
];

const entryPointOptions = [
  { label: "일반 주문", value: "NORMAL" },
  { label: "간편 주문", value: "QUICK" },
  { label: "다시 주문", value: "REORDER" },
  { label: "알 수 없음", value: "UNKNOWN", hiddenInPicker: true },
];

export const MARKET_RISK_FLAG_OPTIONS = [
  { label: "투자 유의", value: "WARNING" },
  { label: "가격 급변 주의", value: "CAUTION_PRICE_FLUCTUATIONS" },
  { label: "거래량 급증 주의", value: "CAUTION_TRADING_VOLUME_SOARING" },
  { label: "입금량 급증 주의", value: "CAUTION_DEPOSIT_AMOUNT_SOARING" },
  { label: "가격 차이 주의", value: "CAUTION_GLOBAL_PRICE_DIFFERENCES" },
  { label: "소수 계정 집중 주의", value: "CAUTION_CONCENTRATION_OF_SMALL_ACCOUNTS" },
] as const;

const allocationPresetOptions = [
  { label: "10%", value: 10 },
  { label: "25%", value: 25 },
  { label: "50%", value: 50 },
  { label: "100%", value: 100 },
  { label: "직접 입력 사용", value: "CUSTOM" },
];

function define(
  definition: Omit<RuleFieldDefinition, "key">,
): Omit<RuleFieldDefinition, "key"> {
  return definition;
}

const catalog = {
  snapshotTrigger: define({
    label: "규칙을 확인할 시점",
    shortDescription: "주문하려는 순간처럼 규칙을 검사할 타이밍입니다.",
    detailedDescription:
      "새 규칙은 규칙 판정 전에 알 수 있는 주문하려는 순간만 선택할 수 있습니다.",
    category: "ORDER_CONTEXT",
    valueType: "STRING",
    semanticType: "ENUM",
    nullable: false,
    ruleEligible: true,
    requiresPrivateApi: false,
    supportedOperators: ENUM_OPERATORS,
    input: { control: "SELECT", options: snapshotTriggerOptions },
    comparisonGroup: "SNAPSHOT_TRIGGER",
    keywords: ["시점", "순간", "trigger", "snapshot"],
  }),
  market: define({
    label: "거래 종목",
    shortDescription: "주문하려는 코인과 거래 시장입니다.",
    category: "ORDER_CONTEXT",
    valueType: "STRING",
    semanticType: "MARKET",
    nullable: false,
    ruleEligible: true,
    requiresPrivateApi: false,
    supportedOperators: ENUM_OPERATORS,
    input: { control: "MARKET_SELECT" },
    comparisonGroup: "MARKET",
    keywords: ["종목", "코인", "market", "DOGE", "BTC"],
  }),
  side: define({
    label: "매수·매도 방향",
    shortDescription: "매수 주문인지 매도 주문인지 확인합니다.",
    category: "ORDER_CONTEXT",
    valueType: "STRING",
    semanticType: "ENUM",
    nullable: false,
    ruleEligible: true,
    requiresPrivateApi: false,
    supportedOperators: ENUM_OPERATORS,
    input: { control: "SELECT", options: sideOptions },
    comparisonGroup: "ORDER_SIDE",
    keywords: ["매수", "매도", "방향", "side", "BUY", "SELL"],
  }),
  orderMode: define({
    label: "주문 방식",
    shortDescription: "지정가, 시장가, 최유리 주문 등을 확인합니다.",
    category: "ORDER_CONTEXT",
    valueType: "STRING",
    semanticType: "ENUM",
    nullable: false,
    ruleEligible: true,
    requiresPrivateApi: false,
    supportedOperators: ENUM_OPERATORS,
    input: { control: "SELECT", options: orderModeOptions },
    comparisonGroup: "ORDER_MODE",
    keywords: ["시장가", "지정가", "주문 방식", "mode", "orderMode"],
  }),
  entryPoint: define({
    label: "주문 시작 방식",
    shortDescription: "일반 주문, 간편 주문, 다시 주문을 구분합니다.",
    category: "ORDER_CONTEXT",
    valueType: "STRING",
    semanticType: "ENUM",
    nullable: false,
    ruleEligible: true,
    requiresPrivateApi: false,
    supportedOperators: ENUM_OPERATORS,
    input: { control: "SELECT", options: entryPointOptions },
    comparisonGroup: "ENTRY_POINT",
    keywords: ["일반 주문", "간편 주문", "다시 주문", "entryPoint"],
  }),

  intentPrice: define({
    label: "입력한 주문 가격",
    shortDescription: "주문창에 입력한 가격입니다.",
    category: "ORDER_INPUT",
    valueType: "DECIMAL_STRING",
    semanticType: "PRICE",
    nullable: true,
    ruleEligible: true,
    requiresPrivateApi: false,
    supportedOperators: NUMERIC_OPERATORS,
    input: { control: "DECIMAL", min: 0, step: 0.00000001, displayUnit: "원" },
    comparisonGroup: "PRICE",
    keywords: ["가격", "입력 가격", "intentPrice"],
  }),
  intentQuantity: define({
    label: "입력한 주문 수량",
    shortDescription: "주문창에 입력한 코인 수량입니다.",
    category: "ORDER_INPUT",
    valueType: "DECIMAL_STRING",
    semanticType: "QUANTITY",
    nullable: true,
    ruleEligible: true,
    requiresPrivateApi: false,
    supportedOperators: NUMERIC_OPERATORS,
    input: { control: "DECIMAL", min: 0, step: 0.00000001, displayUnit: "개" },
    comparisonGroup: "QUANTITY",
    keywords: ["수량", "코인 개수", "intentQuantity"],
  }),
  intentAmount: define({
    label: "입력한 주문 금액",
    shortDescription: "주문창에 입력한 총 주문 금액입니다.",
    category: "ORDER_INPUT",
    valueType: "DECIMAL_STRING",
    semanticType: "AMOUNT",
    nullable: true,
    ruleEligible: true,
    requiresPrivateApi: false,
    supportedOperators: NUMERIC_OPERATORS,
    input: { control: "DECIMAL", min: 0, step: 1, displayUnit: "원" },
    comparisonGroup: "AMOUNT",
    keywords: ["금액", "주문 금액", "큰 금액", "intentAmount"],
  }),
  requestedBalanceRatio: define({
    label: "사용 가능 자산 중 주문 비율",
    shortDescription: "사용 가능한 금액이나 보유 수량 중 얼마나 주문하려는지 봅니다.",
    category: "ORDER_INPUT",
    valueType: "NUMBER",
    semanticType: "RATIO_0_TO_1",
    nullable: true,
    ruleEligible: true,
    requiresPrivateApi: false,
    supportedOperators: NUMERIC_OPERATORS,
    input: { control: "PERCENT", min: 0, max: 1, step: 0.01, displayUnit: "%", storageUnit: "ratio" },
    comparisonGroup: "RATE",
    keywords: ["비율", "주문 비중", "자산", "잔고", "requestedBalanceRatio"],
  }),
  allocationPresetPercent: define({
    label: "선택한 주문 비율 버튼",
    shortDescription: "10%, 25%, 50%, 100% 버튼 또는 직접 입력 사용 여부입니다.",
    category: "ORDER_INPUT",
    valueType: "MIXED_ENUM",
    semanticType: "ALLOCATION_PRESET",
    nullable: true,
    ruleEligible: true,
    requiresPrivateApi: false,
    supportedOperators: ENUM_OPERATORS,
    input: { control: "PRESET_SELECT", options: allocationPresetOptions },
    comparisonGroup: "ALLOCATION_PRESET",
    keywords: ["비율 버튼", "프리셋", "10%", "25%", "50%", "allocationPresetPercent"],
  }),

  draftDurationMs: define({
    label: "주문 작성에 걸린 시간",
    shortDescription: "이번 주문을 작성하기 시작한 뒤 주문하려는 순간까지 걸린 시간입니다.",
    category: "DRAFT_BEHAVIOR",
    valueType: "NUMBER",
    semanticType: "DURATION_MS",
    nullable: true,
    ruleEligible: true,
    requiresPrivateApi: false,
    supportedOperators: NUMERIC_OPERATORS,
    input: { control: "DURATION", min: 0, step: 1000, displayUnit: "초", storageUnit: "ms" },
    comparisonGroup: "DURATION",
    keywords: ["시간", "작성 시간", "빠르게", "draftDurationMs"],
  }),
  lastEditToSnapshotMs: define({
    label: "마지막 수정 후 주문까지 걸린 시간",
    shortDescription: "마지막으로 값을 고친 뒤 주문하려는 순간까지의 시간입니다.",
    category: "DRAFT_BEHAVIOR",
    valueType: "NUMBER",
    semanticType: "DURATION_MS",
    nullable: true,
    ruleEligible: true,
    requiresPrivateApi: false,
    supportedOperators: NUMERIC_OPERATORS,
    input: { control: "DURATION", min: 0, step: 1000, displayUnit: "초", storageUnit: "ms" },
    comparisonGroup: "DURATION",
    keywords: ["마지막 수정", "급하게", "시간", "lastEditToSnapshotMs"],
  }),
  draftEditCount: define({
    label: "이번 주문에서 내용을 수정한 횟수",
    shortDescription: "이번 주문 작성 중 가격, 수량, 금액을 고친 횟수입니다.",
    category: "DRAFT_BEHAVIOR",
    valueType: "NUMBER",
    semanticType: "COUNT",
    nullable: true,
    ruleEligible: true,
    requiresPrivateApi: false,
    supportedOperators: NUMERIC_OPERATORS,
    input: { control: "COUNT_STEPPER", min: 0, step: 1, displayUnit: "회" },
    comparisonGroup: "COUNT",
    keywords: ["수정", "횟수", "draftEditCount"],
  }),
  amountChangeRate: define({
    label: "처음보다 주문 금액이 변한 정도",
    shortDescription: "처음 입력한 금액에 비해 최종 금액이 얼마나 변했는지 봅니다.",
    category: "DRAFT_BEHAVIOR",
    valueType: "NUMBER",
    semanticType: "SIGNED_PERCENT",
    nullable: true,
    ruleEligible: true,
    requiresPrivateApi: false,
    supportedOperators: NUMERIC_OPERATORS,
    input: { control: "PERCENT", min: -1, step: 0.01, displayUnit: "%", storageUnit: "ratio" },
    comparisonGroup: "RATE",
    keywords: ["금액 변화", "증가", "감소", "amountChangeRate"],
  }),
  modeChangedToMarket: define({
    label: "시장가 주문으로 바꿨는지",
    shortDescription: "주문 작성 중 시장가 주문으로 변경했는지 확인합니다.",
    category: "DRAFT_BEHAVIOR",
    valueType: "BOOLEAN",
    semanticType: "BOOLEAN",
    nullable: true,
    ruleEligible: true,
    requiresPrivateApi: false,
    supportedOperators: ENUM_OPERATORS,
    input: {
      control: "BOOLEAN_SELECT",
      options: [
        { label: "시장가로 변경했을 때", value: true },
        { label: "시장가로 변경하지 않았을 때", value: false },
      ],
    },
    comparisonGroup: "BOOLEAN",
    keywords: ["시장가", "바꿨는지", "modeChangedToMarket"],
  }),
  orderbookClickToSnapshotMs: define({
    label: "호가 클릭 후 주문까지 걸린 시간",
    shortDescription: "호가를 누른 뒤 주문하려는 순간까지 걸린 시간입니다.",
    category: "DRAFT_BEHAVIOR",
    valueType: "NUMBER",
    semanticType: "DURATION_MS",
    nullable: true,
    ruleEligible: true,
    requiresPrivateApi: false,
    supportedOperators: NUMERIC_OPERATORS,
    input: { control: "DURATION", min: 0, step: 1000, displayUnit: "초", storageUnit: "ms" },
    comparisonGroup: "DURATION",
    keywords: ["호가", "클릭", "시간", "orderbookClickToSnapshotMs"],
  }),

  orderIntentCount1m: defineCount("최근 1분 주문 시도 횟수", "최근 1분 동안 주문하려고 누른 횟수입니다.", "RECENT_BEHAVIOR", ["반복 주문", "주문 시도", "orderIntentCount1m"]),
  actualOrderCreatedCount10m: defineCount("최근 10분 실제 주문 횟수", "개인 API로 확인한 최근 10분 실제 주문 생성 횟수입니다.", "PRIVATE_ACCOUNT", ["실제 주문", "개인 API", "actualOrderCreatedCount10m"], true, true),
  sameSideIntentCount1m: defineCount("같은 방향으로 반복 주문한 횟수", "최근 1분 동안 같은 매수 또는 매도 방향으로 주문하려 한 횟수입니다.", "RECENT_BEHAVIOR", ["반복", "같은 방향", "sameSideIntentCount1m"]),
  marketChangeCount5m: defineCount("최근 5분 거래 종목 변경 횟수", "최근 5분 동안 다른 종목으로 옮겨 간 횟수입니다.", "RECENT_BEHAVIOR", ["종목 변경", "옮겨", "marketChangeCount5m"]),
  sideChangeCount3m: defineCount("최근 3분 매수·매도 변경 횟수", "최근 3분 동안 매수와 매도를 바꾼 횟수입니다.", "RECENT_BEHAVIOR", ["매수 매도 변경", "sideChangeCount3m"]),
  priceEditCount3m: defineCount("최근 3분 가격 수정 횟수", "최근 3분 동안 가격을 수정한 횟수입니다.", "RECENT_BEHAVIOR", ["가격 수정", "priceEditCount3m"]),
  quantityEditCount3m: defineCount("최근 3분 수량 수정 횟수", "최근 3분 동안 수량을 수정한 횟수입니다.", "RECENT_BEHAVIOR", ["수량 수정", "quantityEditCount3m"]),
  amountEditCount3m: defineCount("최근 3분 주문 금액 수정 횟수", "최근 3분 동안 주문 금액을 수정한 횟수입니다.", "RECENT_BEHAVIOR", ["금액 수정", "amountEditCount3m"]),
  inputRevertCount: defineCount("이전 입력값으로 되돌린 횟수", "입력값을 이전 값으로 되돌린 횟수입니다.", "RECENT_BEHAVIOR", ["되돌림", "inputRevertCount"]),
  priceDirectionChangeCount: defineCount("가격을 올렸다 내린 횟수", "가격 수정 방향이 바뀐 횟수입니다.", "RECENT_BEHAVIOR", ["가격 방향", "priceDirectionChangeCount"]),
  orderModeChangeCount3m: defineCount("최근 3분 주문 방식 변경 횟수", "최근 3분 동안 주문 방식을 바꾼 횟수입니다.", "RECENT_BEHAVIOR", ["주문 방식 변경", "orderModeChangeCount3m"]),
  draftResetCount3m: defineCount("최근 3분 주문 내용 초기화 횟수", "최근 3분 동안 주문 내용을 초기화한 횟수입니다.", "RECENT_BEHAVIOR", ["초기화", "draftResetCount3m"], false, true),
  priceChangeRate: defineRate("처음보다 주문 가격이 변한 정도", "처음 입력한 가격에 비해 최종 가격이 얼마나 변했는지 봅니다.", "RECENT_BEHAVIOR", ["가격 변화", "priceChangeRate"], -1),

  tradePriceAtSnapshot: define({
    label: "현재 시장 가격",
    shortDescription: "주문하려는 순간의 공개 시장 가격입니다.",
    category: "MARKET",
    valueType: "DECIMAL_STRING",
    semanticType: "PRICE",
    nullable: true,
    ruleEligible: true,
    requiresPrivateApi: false,
    supportedOperators: NUMERIC_OPERATORS,
    input: { control: "DECIMAL", min: 0, step: 0.00000001, displayUnit: "원" },
    comparisonGroup: "PRICE",
    keywords: ["현재가", "시장 가격", "tradePriceAtSnapshot"],
  }),
  shortTermReturn5m: defineRate("최근 5분 가격 변화", "최근 5분 동안 가격이 얼마나 오르거나 내렸는지 봅니다.", "MARKET", ["급등", "급락", "5분", "shortTermReturn5m"], -1),
  signedChangeRate: defineRate("전일 대비 가격 변화", "전일 종가와 비교한 현재 가격 변화율입니다.", "MARKET", ["전일 대비", "등락률", "signedChangeRate"], -1),
  spreadRate: defineRate("매수·매도 호가 차이", "가장 좋은 매수·매도 호가의 차이를 비율로 봅니다.", "MARKET", ["스프레드", "호가 차이", "spreadRate"], 0, "NON_NEGATIVE_PERCENT"),
  marketRiskFlags: define({
    label: "시장 경보",
    shortDescription: "투자 유의나 거래량 급증 같은 시장 경보를 확인합니다.",
    category: "MARKET",
    valueType: "STRING_ARRAY",
    semanticType: "FLAG_SET",
    nullable: false,
    ruleEligible: true,
    requiresPrivateApi: false,
    supportedOperators: ARRAY_OPERATORS,
    input: { control: "FLAG_MULTI_SELECT", options: [...MARKET_RISK_FLAG_OPTIONS] },
    comparisonGroup: "FLAG_SET",
    keywords: ["경보", "투자 유의", "급변", "거래량", "marketRiskFlags"],
  }),
  pricePositionIn5mRange: define({
    label: "최근 5분 가격대에서 현재 위치",
    shortDescription: "최근 5분 가격 범위에서 현재 가격이 어느 위치인지 봅니다.",
    category: "MARKET",
    valueType: "NUMBER",
    semanticType: "RATIO_0_TO_1",
    nullable: true,
    ruleEligible: true,
    requiresPrivateApi: false,
    supportedOperators: NUMERIC_OPERATORS,
    input: { control: "PERCENT", min: 0, max: 1, step: 0.01, displayUnit: "%", storageUnit: "ratio" },
    comparisonGroup: "RATE",
    keywords: ["가격 위치", "고점", "저점", "pricePositionIn5mRange"],
  }),
  volumeSpikeRatio5m: define({
    label: "최근 거래량 증가 배수",
    shortDescription: "최근 거래량이 평소보다 몇 배인지 봅니다.",
    category: "MARKET",
    valueType: "NUMBER",
    semanticType: "MULTIPLIER",
    nullable: true,
    ruleEligible: true,
    requiresPrivateApi: false,
    supportedOperators: NUMERIC_OPERATORS,
    input: { control: "DECIMAL", min: 0, step: 0.1, displayUnit: "배" },
    comparisonGroup: "MULTIPLIER",
    keywords: ["거래량", "배", "급증", "volumeSpikeRatio5m"],
  }),
  baseAssetAvgBuyPriceBeforeSnapshot: define({
    label: "내 평균 매수가",
    shortDescription: "개인 API로 확인한 해당 코인의 평균 매수가입니다.",
    category: "PRIVATE_ACCOUNT",
    valueType: "DECIMAL_STRING",
    semanticType: "PRICE",
    nullable: true,
    ruleEligible: true,
    requiresPrivateApi: true,
    supportedOperators: NUMERIC_OPERATORS,
    input: { control: "DECIMAL", min: 0, step: 0.00000001, displayUnit: "원" },
    comparisonGroup: "PRICE",
    keywords: ["평균 매수가", "손실", "개인 API", "baseAssetAvgBuyPriceBeforeSnapshot"],
  }),
  priceVsAvgBuyRateAtSnapshot: defineRate(
    "평균 매수가 대비 현재 손익률",
    "현재 가격이 내 평균 매수가보다 얼마나 높거나 낮은지 봅니다.",
    "PRIVATE_ACCOUNT",
    ["평균 매수가", "손익률", "손실", "개인 API", "priceVsAvgBuyRateAtSnapshot"],
    -1,
    "SIGNED_PERCENT",
    true,
  ),

  snapshotId: defineSystem("snapshotId", "Snapshot 자체 식별자는 규칙 결과와 무관한 관리용 값입니다.", "IDENTIFIER"),
  attemptId: defineSystem("attemptId", "주문 시도 연결용 식별자는 규칙 조건으로 쓰지 않습니다.", "IDENTIFIER", true),
  capturedAt: defineSystem("capturedAt", "저장 시각은 서버 관리 값이므로 규칙 조건에서 제외합니다.", "DATETIME"),
  matchedRuleIdsAtSnapshot: defineSystem("matchedRuleIdsAtSnapshot", "이미 매칭된 규칙 목록은 규칙 판정 결과이므로 조건으로 쓰지 않습니다.", "FLAG_SET"),
  primaryShownRuleId: defineSystem("primaryShownRuleId", "대표로 표시된 규칙은 판정 결과이므로 조건으로 쓰지 않습니다.", "IDENTIFIER", true),
  shownRuleIds: defineSystem("shownRuleIds", "표시된 규칙 목록은 판정 결과이므로 조건으로 쓰지 않습니다.", "FLAG_SET"),
} as const;

function defineCount(
  label: string,
  shortDescription: string,
  category: RuleFieldDefinition["category"],
  keywords: string[],
  requiresPrivateApi = false,
  nullable = false,
) {
  return define({
    label,
    shortDescription,
    category,
    valueType: "NUMBER",
    semanticType: "COUNT",
    nullable,
    ruleEligible: true,
    requiresPrivateApi,
    supportedOperators: NUMERIC_OPERATORS,
    input: { control: "COUNT_STEPPER", min: 0, step: 1, displayUnit: "회" },
    comparisonGroup: "COUNT",
    keywords,
  });
}

function defineRate(
  label: string,
  shortDescription: string,
  category: RuleFieldDefinition["category"],
  keywords: string[],
  min = -1,
  semanticType: RuleFieldDefinition["semanticType"] = "SIGNED_PERCENT",
  requiresPrivateApi = false,
) {
  return define({
    label,
    shortDescription,
    category,
    valueType: "NUMBER",
    semanticType,
    nullable: true,
    ruleEligible: true,
    requiresPrivateApi,
    supportedOperators: NUMERIC_OPERATORS,
    input: { control: "PERCENT", min, step: 0.01, displayUnit: "%", storageUnit: "ratio" },
    comparisonGroup: "RATE",
    keywords,
  });
}

function defineSystem(
  label: string,
  shortDescription: string,
  semanticType: RuleFieldDefinition["semanticType"],
  nullable = false,
) {
  return define({
    label,
    shortDescription,
    category: "SYSTEM",
    valueType: semanticType === "FLAG_SET" ? "STRING_ARRAY" : "STRING",
    semanticType,
    nullable,
    ruleEligible: false,
    requiresPrivateApi: false,
    supportedOperators: SYSTEM_OPERATORS,
    input: { control: "SELECT" },
    keywords: [label],
  });
}

export const RULE_FIELD_CATALOG = Object.fromEntries(
  Object.entries(catalog).map(([key, definition]) => [
    key,
    { key, ...definition },
  ]),
) as {
  [K in keyof typeof catalog]: RuleFieldDefinition & { key: K };
};

export type RuleFieldName = keyof typeof RULE_FIELD_CATALOG;

export const RULE_ELIGIBLE_FIELD_CATALOG = Object.fromEntries(
  Object.entries(RULE_FIELD_CATALOG).filter(([, definition]) => definition.ruleEligible),
) as Record<string, RuleFieldDefinition>;

export function getRuleFieldDefinition(field: string) {
  return RULE_FIELD_CATALOG[field as RuleFieldName];
}

export function getRuleEligibleFieldDefinition(field: string) {
  const definition = getRuleFieldDefinition(field);
  return definition?.ruleEligible ? definition : undefined;
}
