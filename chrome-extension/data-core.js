(function initializeSaltbreadCore(globalScope) {
  const MINUTE_MS = 60_000;
  const PRICE_GROUP = "PRICE";
  const RATE_GROUP = "RATE";
  const COUNT_GROUP = "COUNT";
  const DURATION_GROUP = "DURATION";
  const RULE_FIELD_CATALOG = {
    snapshotTrigger: { valueType: "STRING", requiresPrivateApi: false, ruleEligible: true, comparisonGroup: "SNAPSHOT_TRIGGER" },
    market: { valueType: "STRING", requiresPrivateApi: false, ruleEligible: true, comparisonGroup: "MARKET" },
    side: { valueType: "STRING", requiresPrivateApi: false, ruleEligible: true, comparisonGroup: "ORDER_SIDE" },
    orderMode: { valueType: "STRING", requiresPrivateApi: false, ruleEligible: true, comparisonGroup: "ORDER_MODE" },
    entryPoint: { valueType: "STRING", requiresPrivateApi: false, ruleEligible: true, comparisonGroup: "ENTRY_POINT" },
    orderTimeMinutes: { valueType: "NUMBER", requiresPrivateApi: false, ruleEligible: true, comparisonGroup: "TIME_OF_DAY" },
    intentPrice: { valueType: "DECIMAL_STRING", requiresPrivateApi: false, ruleEligible: true, comparisonGroup: PRICE_GROUP },
    intentQuantity: { valueType: "DECIMAL_STRING", requiresPrivateApi: false, ruleEligible: true, comparisonGroup: "QUANTITY" },
    intentAmount: { valueType: "DECIMAL_STRING", requiresPrivateApi: false, ruleEligible: true, comparisonGroup: "AMOUNT" },
    requestedBalanceRatio: { valueType: "NUMBER", requiresPrivateApi: false, ruleEligible: true, comparisonGroup: RATE_GROUP },
    allocationPresetPercent: { valueType: "MIXED_ENUM", requiresPrivateApi: false, ruleEligible: true, comparisonGroup: "ALLOCATION_PRESET" },
    draftDurationMs: { valueType: "NUMBER", requiresPrivateApi: false, ruleEligible: true, comparisonGroup: DURATION_GROUP },
    lastEditToSnapshotMs: { valueType: "NUMBER", requiresPrivateApi: false, ruleEligible: true, comparisonGroup: DURATION_GROUP },
    draftEditCount: { valueType: "NUMBER", requiresPrivateApi: false, ruleEligible: true, comparisonGroup: COUNT_GROUP },
    amountChangeRate: { valueType: "NUMBER", requiresPrivateApi: false, ruleEligible: true, comparisonGroup: RATE_GROUP },
    modeChangedToMarket: { valueType: "BOOLEAN", requiresPrivateApi: false, ruleEligible: true, comparisonGroup: "BOOLEAN" },
    orderbookClickToSnapshotMs: { valueType: "NUMBER", requiresPrivateApi: false, ruleEligible: true, comparisonGroup: DURATION_GROUP },
    orderIntentCount1m: { valueType: "NUMBER", requiresPrivateApi: false, ruleEligible: true, comparisonGroup: COUNT_GROUP },
    actualOrderCreatedCount10m: { valueType: "NUMBER", requiresPrivateApi: true, ruleEligible: true, comparisonGroup: COUNT_GROUP },
    sameSideIntentCount1m: { valueType: "NUMBER", requiresPrivateApi: false, ruleEligible: true, comparisonGroup: COUNT_GROUP },
    marketChangeCount5m: { valueType: "NUMBER", requiresPrivateApi: false, ruleEligible: true, comparisonGroup: COUNT_GROUP },
    sideChangeCount3m: { valueType: "NUMBER", requiresPrivateApi: false, ruleEligible: true, comparisonGroup: COUNT_GROUP },
    priceEditCount3m: { valueType: "NUMBER", requiresPrivateApi: false, ruleEligible: true, comparisonGroup: COUNT_GROUP },
    quantityEditCount3m: { valueType: "NUMBER", requiresPrivateApi: false, ruleEligible: true, comparisonGroup: COUNT_GROUP },
    amountEditCount3m: { valueType: "NUMBER", requiresPrivateApi: false, ruleEligible: true, comparisonGroup: COUNT_GROUP },
    inputRevertCount: { valueType: "NUMBER", requiresPrivateApi: false, ruleEligible: true, comparisonGroup: COUNT_GROUP },
    priceDirectionChangeCount: { valueType: "NUMBER", requiresPrivateApi: false, ruleEligible: true, comparisonGroup: COUNT_GROUP },
    priceChangeRate: { valueType: "NUMBER", requiresPrivateApi: false, ruleEligible: true, comparisonGroup: RATE_GROUP },
    orderModeChangeCount3m: { valueType: "NUMBER", requiresPrivateApi: false, ruleEligible: true, comparisonGroup: COUNT_GROUP },
    draftResetCount3m: { valueType: "NUMBER", requiresPrivateApi: false, ruleEligible: true, comparisonGroup: COUNT_GROUP },
    tradePriceAtSnapshot: { valueType: "DECIMAL_STRING", requiresPrivateApi: false, ruleEligible: true, comparisonGroup: PRICE_GROUP },
    shortTermReturn5m: { valueType: "NUMBER", requiresPrivateApi: false, ruleEligible: true, comparisonGroup: RATE_GROUP },
    signedChangeRate: { valueType: "NUMBER", requiresPrivateApi: false, ruleEligible: true, comparisonGroup: RATE_GROUP },
    spreadRate: { valueType: "NUMBER", requiresPrivateApi: false, ruleEligible: true, comparisonGroup: RATE_GROUP },
    marketRiskFlags: { valueType: "STRING_ARRAY", requiresPrivateApi: false, ruleEligible: true, comparisonGroup: "FLAG_SET" },
    pricePositionIn5mRange: { valueType: "NUMBER", requiresPrivateApi: false, ruleEligible: true, comparisonGroup: RATE_GROUP },
    volumeSpikeRatio5m: { valueType: "NUMBER", requiresPrivateApi: false, ruleEligible: true, comparisonGroup: "MULTIPLIER" },
    baseAssetAvgBuyPriceBeforeSnapshot: {
      valueType: "DECIMAL_STRING",
      requiresPrivateApi: true,
      ruleEligible: true,
      comparisonGroup: PRICE_GROUP,
    },
    priceVsAvgBuyRateAtSnapshot: { valueType: "NUMBER", requiresPrivateApi: true, ruleEligible: true, comparisonGroup: RATE_GROUP },
    snapshotId: { valueType: "STRING", requiresPrivateApi: false, ruleEligible: false },
    attemptId: { valueType: "STRING", requiresPrivateApi: false, ruleEligible: false },
    dataSource: { valueType: "STRING", requiresPrivateApi: false, ruleEligible: false },
    marketSource: { valueType: "STRING", requiresPrivateApi: false, ruleEligible: false },
    orderSource: { valueType: "STRING", requiresPrivateApi: false, ruleEligible: false },
    behaviorSource: { valueType: "STRING", requiresPrivateApi: false, ruleEligible: false },
    personalSource: { valueType: "STRING", requiresPrivateApi: false, ruleEligible: false },
    capturedAt: { valueType: "STRING", requiresPrivateApi: false, ruleEligible: false },
    orderTime: { valueType: "STRING", requiresPrivateApi: false, ruleEligible: false },
    matchedRuleIdsAtSnapshot: { valueType: "STRING_ARRAY", requiresPrivateApi: false, ruleEligible: false },
    primaryShownRuleId: { valueType: "STRING", requiresPrivateApi: false, ruleEligible: false },
    shownRuleIds: { valueType: "STRING_ARRAY", requiresPrivateApi: false, ruleEligible: false },
  };
  const VISUAL_MODES = new Set([
    "DEFAULT",
    "CURIOUS",
    "SURPRISED",
    "FAST_BURN",
    "SCARED",
    "SAD",
  ]);
  const RULE_FIELD_DISPLAY_METADATA = {
    snapshotTrigger: { label: "규칙을 확인할 시점", semanticType: "ENUM", options: { ORDER_INTENT_CLICK: "주문하려는 순간", GUARDRAIL_SHOWN: "가드레일 표시 이후" } },
    market: { label: "거래 종목", semanticType: "MARKET" },
    side: { label: "매수·매도 방향", semanticType: "ENUM", options: { BUY: "매수", SELL: "매도", UNKNOWN: "알 수 없음" } },
    orderMode: { label: "주문 방식", semanticType: "ENUM", options: { LIMIT: "지정가", MARKET: "시장가", BEST: "최유리 주문", RESERVED: "예약 주문", UNKNOWN: "알 수 없음" } },
    entryPoint: { label: "주문 시작 방식", semanticType: "ENUM", options: { NORMAL: "일반 주문", QUICK: "간편 주문", REORDER: "다시 주문", UNKNOWN: "알 수 없음" } },
    orderTimeMinutes: { label: "주문하는 시간", semanticType: "TIME_OF_DAY", storageUnit: "minutes" },
    intentPrice: { label: "입력한 주문 가격", semanticType: "PRICE", displayUnit: "원" },
    intentQuantity: { label: "입력한 주문 수량", semanticType: "QUANTITY", displayUnit: "개" },
    intentAmount: { label: "입력한 주문 금액", semanticType: "AMOUNT", displayUnit: "원" },
    requestedBalanceRatio: { label: "사용 가능 자산 중 주문 비율", semanticType: "RATIO_0_TO_1", storageUnit: "ratio", displayUnit: "%" },
    allocationPresetPercent: { label: "선택한 주문 비율 버튼", semanticType: "ALLOCATION_PRESET", options: { 10: "10%", 25: "25%", 50: "50%", 100: "100%", CUSTOM: "직접 입력 사용" } },
    draftDurationMs: { label: "주문 작성에 걸린 시간", semanticType: "DURATION_MS", storageUnit: "ms" },
    lastEditToSnapshotMs: { label: "마지막 수정 후 주문까지 걸린 시간", semanticType: "DURATION_MS", storageUnit: "ms" },
    draftEditCount: { label: "이번 주문에서 내용을 수정한 횟수", semanticType: "COUNT", displayUnit: "회" },
    amountChangeRate: { label: "처음보다 주문 금액이 변한 정도", semanticType: "SIGNED_PERCENT", storageUnit: "ratio", displayUnit: "%" },
    modeChangedToMarket: { label: "시장가 주문으로 바꿨는지", semanticType: "BOOLEAN", options: { true: "시장가로 변경했을 때", false: "시장가로 변경하지 않았을 때" } },
    orderbookClickToSnapshotMs: { label: "호가 클릭 후 주문까지 걸린 시간", semanticType: "DURATION_MS", storageUnit: "ms" },
    orderIntentCount1m: { label: "최근 1분 주문 시도 횟수", semanticType: "COUNT", displayUnit: "회" },
    actualOrderCreatedCount10m: { label: "최근 10분 실제 주문 횟수", semanticType: "COUNT", displayUnit: "회" },
    sameSideIntentCount1m: { label: "같은 방향으로 반복 주문한 횟수", semanticType: "COUNT", displayUnit: "회" },
    marketChangeCount5m: { label: "최근 5분 거래 종목 변경 횟수", semanticType: "COUNT", displayUnit: "회" },
    sideChangeCount3m: { label: "최근 3분 매수·매도 변경 횟수", semanticType: "COUNT", displayUnit: "회" },
    priceEditCount3m: { label: "최근 3분 가격 수정 횟수", semanticType: "COUNT", displayUnit: "회" },
    quantityEditCount3m: { label: "최근 3분 수량 수정 횟수", semanticType: "COUNT", displayUnit: "회" },
    amountEditCount3m: { label: "최근 3분 주문 금액 수정 횟수", semanticType: "COUNT", displayUnit: "회" },
    inputRevertCount: { label: "이전 입력값으로 되돌린 횟수", semanticType: "COUNT", displayUnit: "회" },
    priceDirectionChangeCount: { label: "가격을 올렸다 내린 횟수", semanticType: "COUNT", displayUnit: "회" },
    priceChangeRate: { label: "처음보다 주문 가격이 변한 정도", semanticType: "SIGNED_PERCENT", storageUnit: "ratio", displayUnit: "%" },
    orderModeChangeCount3m: { label: "최근 3분 주문 방식 변경 횟수", semanticType: "COUNT", displayUnit: "회" },
    draftResetCount3m: { label: "최근 3분 주문 내용 초기화 횟수", semanticType: "COUNT", displayUnit: "회" },
    tradePriceAtSnapshot: { label: "현재 시장 가격", semanticType: "PRICE", displayUnit: "원" },
    shortTermReturn5m: { label: "최근 5분 가격 변화", semanticType: "SIGNED_PERCENT", storageUnit: "ratio", displayUnit: "%" },
    signedChangeRate: { label: "전일 대비 가격 변화", semanticType: "SIGNED_PERCENT", storageUnit: "ratio", displayUnit: "%" },
    spreadRate: { label: "매수·매도 호가 차이", semanticType: "NON_NEGATIVE_PERCENT", storageUnit: "ratio", displayUnit: "%" },
    marketRiskFlags: {
      label: "시장 경보",
      semanticType: "FLAG_SET",
      options: {
        WARNING: "투자 유의",
        CAUTION_PRICE_FLUCTUATIONS: "가격 급변 주의",
        CAUTION_TRADING_VOLUME_SOARING: "거래량 급증 주의",
        CAUTION_DEPOSIT_AMOUNT_SOARING: "입금량 급증 주의",
        CAUTION_GLOBAL_PRICE_DIFFERENCES: "가격 차이 주의",
        CAUTION_CONCENTRATION_OF_SMALL_ACCOUNTS: "소수 계정 집중 주의",
      },
    },
    pricePositionIn5mRange: { label: "최근 5분 가격대에서 현재 위치", semanticType: "RATIO_0_TO_1", storageUnit: "ratio", displayUnit: "%" },
    volumeSpikeRatio5m: { label: "최근 거래량 증가 배수", semanticType: "MULTIPLIER", displayUnit: "배" },
    baseAssetAvgBuyPriceBeforeSnapshot: { label: "내 평균 매수가", semanticType: "PRICE", displayUnit: "원" },
    priceVsAvgBuyRateAtSnapshot: { label: "평균 매수가 대비 현재 손익률", semanticType: "SIGNED_PERCENT", storageUnit: "ratio", displayUnit: "%" },
  };
  const OPERATOR_LABELS = {
    EQ: "같음",
    NEQ: "같지 않음",
    GT: "초과",
    GTE: "이상",
    LT: "미만",
    LTE: "이하",
    IN: "포함",
    NOT_IN: "포함하지 않음",
    IS_NULL: "값 없음",
    IS_NOT_NULL: "값 있음",
  };
  const OPERATOR_CRITERIA_PHRASES = {
    GT: "초과",
    GTE: "이상",
    LT: "미만",
    LTE: "이하",
  };

  Object.entries(RULE_FIELD_DISPLAY_METADATA).forEach(([field, metadata]) => {
    if (RULE_FIELD_CATALOG[field]) {
      Object.assign(RULE_FIELD_CATALOG[field], metadata);
    }
  });

  function toNumber(value) {
    if (typeof value === "number") {
      return Number.isFinite(value) ? value : null;
    }

    if (typeof value !== "string") {
      return null;
    }

    const normalized = value.replaceAll(",", "").replace(/[^\d.-]/g, "");
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : null;
  }

  function hasFinalConsonant(text) {
    const last = String(text || "").trim().at(-1);
    if (!last) return false;
    const code = last.charCodeAt(0);
    if (code < 0xac00 || code > 0xd7a3) return false;
    return (code - 0xac00) % 28 !== 0;
  }

  function subjectParticle(text) {
    return hasFinalConsonant(text) ? "이" : "가";
  }

  function formatNumberWithComma(value, maximumFractionDigits = 8) {
    const numeric = toNumber(value);
    if (numeric === null) {
      return String(value ?? "");
    }

    return new Intl.NumberFormat("ko-KR", {
      maximumFractionDigits,
    }).format(numeric);
  }

  function formatDurationValue(ms) {
    const numeric = toNumber(ms);
    if (numeric === null) {
      return String(ms ?? "");
    }

    if (numeric === 0) {
      return "0초";
    }

    if (Math.abs(numeric) >= 60_000 && numeric % 60_000 === 0) {
      return `${formatNumberWithComma(numeric / 60_000, 2)}분`;
    }

    if (Math.abs(numeric) >= 1000) {
      return `${formatNumberWithComma(Number((numeric / 1000).toFixed(2)), 2)}초`;
    }

    return `${formatNumberWithComma(numeric, 0)}밀리초`;
  }

  function formatMinutesValue(minutes) {
    const numeric = toNumber(minutes);
    if (numeric === null) {
      return String(minutes ?? "");
    }

    const normalized = Math.max(0, Math.min(1439, Math.trunc(numeric)));
    const hour = Math.floor(normalized / 60);
    const minute = normalized % 60;
    return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
  }

  function getRuleFieldDefinition(field) {
    return RULE_FIELD_CATALOG[field] || {
      label: field || "조건",
      semanticType: "TEXT",
      valueType: "STRING",
      input: {},
    };
  }

  function formatRuleFieldValue(field, value, options = {}) {
    const definition = getRuleFieldDefinition(field);
    const metadata = RULE_FIELD_DISPLAY_METADATA[field] || definition || {};

    if (value === null || value === undefined || value === "") {
      if (options.missingReason === "MISSING_PERSONAL_DATA" || definition.requiresPrivateApi) {
        return "업비트 개인 API 연결 필요";
      }
      if (options.historyMissing) {
        return "이 기록에는 당시 판정값이 저장되지 않았어요";
      }
      return "당시 값을 확인할 수 없어요";
    }

    if (Array.isArray(value)) {
      return value.length
        ? value.map((item) => formatRuleFieldValue(field, item, options)).join(", ")
        : "없음";
    }

    const optionLabel = metadata.options?.[String(value)];
    if (optionLabel) {
      return optionLabel;
    }

    if (typeof value === "boolean") {
      if (metadata.semanticType === "BOOLEAN") {
        return value ? "해당함" : "해당하지 않음";
      }
      return value ? "예" : "아니요";
    }

    if (metadata.storageUnit === "minutes" || metadata.semanticType === "TIME_OF_DAY") {
      return formatMinutesValue(value);
    }

    if (metadata.storageUnit === "ms" || metadata.semanticType === "DURATION_MS") {
      return formatDurationValue(value);
    }

    if (
      metadata.storageUnit === "ratio" ||
      metadata.semanticType === "SIGNED_PERCENT" ||
      metadata.semanticType === "NON_NEGATIVE_PERCENT" ||
      metadata.semanticType === "RATIO_0_TO_1"
    ) {
      const numeric = toNumber(value);
      return numeric === null
        ? String(value)
        : `${formatNumberWithComma(Number((numeric * 100).toFixed(4)), 4)}%`;
    }

    if (
      metadata.semanticType === "PRICE" ||
      metadata.semanticType === "AMOUNT"
    ) {
      return `${formatNumberWithComma(value)}${metadata.displayUnit || "원"}`;
    }

    if (
      metadata.semanticType === "QUANTITY" ||
      metadata.semanticType === "COUNT" ||
      metadata.semanticType === "MULTIPLIER"
    ) {
      return `${formatNumberWithComma(value)}${metadata.displayUnit || ""}`;
    }

    return String(value);
  }

  function formatOperatorLabel(operator) {
    return OPERATOR_LABELS[operator] || operator || "";
  }

  function formatConditionCriteria(conditionOrResult) {
    const field = conditionOrResult?.leftField || conditionOrResult?.field;
    const operator = conditionOrResult?.operator;
    const expectedValue = Object.prototype.hasOwnProperty.call(conditionOrResult || {}, "expectedValue")
      ? conditionOrResult.expectedValue
      : resolveOperandValue(conditionOrResult?.rightOperand, {});
    const expectedText = formatRuleFieldValue(field, expectedValue, conditionOrResult);

    if (operator === "IS_NULL") {
      return "값 없음";
    }

    if (operator === "IS_NOT_NULL") {
      return "값 있음";
    }

    if (operator === "EQ") {
      return expectedText;
    }

    if (operator === "NEQ") {
      return `${expectedText} 아님`;
    }

    if (operator === "IN") {
      return `${expectedText} 중 하나`;
    }

    if (operator === "NOT_IN") {
      return `${expectedText} 제외`;
    }

    return `${expectedText} ${OPERATOR_CRITERIA_PHRASES[operator] || formatOperatorLabel(operator)}`;
  }

  function formatConditionDescription(condition) {
    const field = condition?.leftField || condition?.field;
    const definition = getRuleFieldDefinition(field);
    const label = definition.label || field || "조건";
    const particle = subjectParticle(label);
    const expectedValue = resolveOperandValue(condition?.rightOperand, {});
    const criteria = formatConditionCriteria({
      ...condition,
      expectedValue,
    });

    if (condition?.operator === "IS_NULL") {
      return `${label}을 확인할 수 없을 때`;
    }

    if (condition?.operator === "IS_NOT_NULL") {
      return `${label}을 확인할 수 있을 때`;
    }

    if (condition?.operator === "EQ") {
      if (field === "side") return `${criteria} 주문일 때`;
      if (field === "orderMode") return `${criteria} 주문일 때`;
      return `${label}${particle} ${criteria}일 때`;
    }

    if (condition?.operator === "NEQ") {
      return `${label}${particle} ${criteria}일 때`;
    }

    if (definition.semanticType === "DURATION_MS" && condition?.operator === "LTE") {
      return `${label}${particle} ${formatRuleFieldValue(field, expectedValue)} 이내일 때`;
    }

    if (definition.semanticType === "TIME_OF_DAY") {
      const expected = formatRuleFieldValue(field, expectedValue);
      if (condition?.operator === "GT" || condition?.operator === "GTE") {
        return `${label}${particle} ${expected} 이후일 때`;
      }
      if (condition?.operator === "LT" || condition?.operator === "LTE") {
        return `${label}${particle} ${expected} 이전일 때`;
      }
    }

    return `${label}${particle} ${criteria}일 때`;
  }

  function formatConditionActualSentence(conditionResult) {
    const field = conditionResult?.leftField || conditionResult?.field;
    const definition = getRuleFieldDefinition(field);
    const actualText = formatRuleFieldValue(field, conditionResult?.actualValue, conditionResult);

    if (conditionResult?.missingReason === "MISSING_PERSONAL_DATA") {
      return "업비트 개인 API 연결이 필요한 조건이에요.";
    }

    if (
      conditionResult?.actualValue === null ||
      conditionResult?.actualValue === undefined ||
      conditionResult?.actualValue === ""
    ) {
      return "이 기록에는 당시 판정값이 저장되지 않았어요.";
    }

    if (definition.semanticType === "DURATION_MS") {
      return `경고 당시 ${actualText}가 걸렸어요.`;
    }

    if (field === "side") {
      return `경고 당시 ${actualText} 주문이었어요.`;
    }

    if (field === "orderMode") {
      return `경고 당시 ${actualText} 주문이었어요.`;
    }

    return `경고 당시 ${actualText}였어요.`;
  }

  function formatConditionEvaluation(conditionResult) {
    const field = conditionResult?.leftField || conditionResult?.field;
    const definition = getRuleFieldDefinition(field);
    const title = definition.label || field || "조건";
    const criteriaText = formatConditionCriteria(conditionResult);
    const actualText = formatRuleFieldValue(field, conditionResult?.actualValue, conditionResult);
    const description = formatConditionDescription({
      nodeType: "CONDITION",
      leftField: field,
      operator: conditionResult?.operator,
      rightOperand: { operandType: "LITERAL", value: conditionResult?.expectedValue },
    });

    return {
      title,
      criteriaText,
      actualText,
      description,
      actualSentence: formatConditionActualSentence(conditionResult),
      matched: Boolean(conditionResult?.matched ?? conditionResult?.pass),
      missingReason: conditionResult?.missingReason || null,
      operatorLabel: formatOperatorLabel(conditionResult?.operator),
    };
  }

  function formatExpressionEvaluationSummary(expressionResult) {
    const conditions = flattenExpressionEvaluation(expressionResult);

    if (!expressionResult) {
      return "설정한 규칙 조합이 충족됐어요.";
    }

    if (expressionResult.nodeType === "GROUP") {
      if (expressionResult.operator === "OR") {
        const matchedCount = conditions.filter((condition) => condition.matched).length;
        return `설정한 조건 ${conditions.length}개 중 ${Math.max(1, matchedCount)}개 이상이 충족됐어요.`;
      }

      return `설정한 조건 ${conditions.length}개를 모두 만족했어요.`;
    }

    return "설정한 조건이 충족됐어요.";
  }

  function normalizeDecimalParts(value) {
    const raw = String(value ?? "").trim();
    const match = raw.match(/^(-?)(\d+)(?:\.(\d+))?$/);

    if (!match) {
      return null;
    }

    const sign = match[1] === "-" ? -1 : 1;
    const integer = match[2].replace(/^0+(?=\d)/, "") || "0";
    const fraction = (match[3] || "").replace(/0+$/g, "");
    const isZero = integer === "0" && fraction.length === 0;

    return {
      sign: isZero ? 1 : sign,
      integer: isZero ? "0" : integer,
      fraction,
    };
  }

  function comparePositiveDecimal(left, right) {
    if (left.integer.length !== right.integer.length) {
      return left.integer.length > right.integer.length ? 1 : -1;
    }

    if (left.integer !== right.integer) {
      return left.integer > right.integer ? 1 : -1;
    }

    const fractionLength = Math.max(
      left.fraction.length,
      right.fraction.length,
    );
    const leftFraction = left.fraction.padEnd(fractionLength, "0");
    const rightFraction = right.fraction.padEnd(fractionLength, "0");

    if (leftFraction === rightFraction) {
      return 0;
    }

    return leftFraction > rightFraction ? 1 : -1;
  }

  function compareDecimalStrings(leftValue, rightValue) {
    const left = normalizeDecimalParts(leftValue);
    const right = normalizeDecimalParts(rightValue);

    if (!left || !right) {
      return null;
    }

    if (left.sign !== right.sign) {
      return left.sign > right.sign ? 1 : -1;
    }

    const positiveComparison = comparePositiveDecimal(left, right);
    return left.sign > 0 ? positiveComparison : -positiveComparison;
  }

  function normalizeVisualMode(mode) {
    const normalized = String(mode || "DEFAULT").trim().toUpperCase();
    const aliases = {
      DEFAULT: "DEFAULT",
      AUTO: "DEFAULT",
      BLUE: "SAD",
      PINK: "FAST_BURN",
    };
    const resolved = aliases[normalized] || normalized;

    return VISUAL_MODES.has(resolved) ? resolved : "DEFAULT";
  }

  function resolveVisualMode(ruleOrMode) {
    if (typeof ruleOrMode === "string") {
      return normalizeVisualMode(ruleOrMode);
    }

    return normalizeVisualMode(ruleOrMode?.visualMode);
  }

  function parseMarket(url) {
    try {
      const parsedUrl = new URL(url);
      const candidates = [
        parsedUrl.searchParams.get("code"),
        parsedUrl.searchParams.get("market"),
        parsedUrl.pathname,
        parsedUrl.hash,
      ].filter(Boolean);

      for (const candidate of candidates) {
        const match = candidate.match(/(?:CRIX\.UPBIT\.)?((?:KRW|BTC|USDT)-[A-Z0-9]+)/i);

        if (match) {
          return match[1].toUpperCase();
        }
      }
    } catch {
      return null;
    }

    return null;
  }

  function detectOrderActionSide(text) {
    const normalized = String(text || "")
      .replace(/\s/g, "")
      .replace(/[\u200B-\u200D\uFEFF]/g, "");

    if (/^매수(하기|주문|확인)?$/.test(normalized)) {
      return "BUY";
    }

    if (/^매도(하기|주문|확인)?$/.test(normalized)) {
      return "SELL";
    }

    return null;
  }

  function pruneTimestamps(timestamps, windowMs, now = Date.now()) {
    return timestamps.filter(
      (timestamp) => timestamp <= now && timestamp >= now - windowMs,
    );
  }

  function candleTime(candle) {
    const raw =
      candle.candle_date_time_utc ||
      candle.candle_date_time_kst ||
      candle.timestamp;

    if (typeof raw === "number") {
      return raw;
    }

    if (!raw) {
      return 0;
    }

    const isUtc = candle.candle_date_time_utc === raw;
    return Date.parse(`${raw}${isUtc && !/[z+-]\d*$/i.test(raw) ? "Z" : ""}`);
  }

  function calculateMarketData({
    market,
    candles,
    tickers,
    marketDetails,
    orderbook = null,
    now = Date.now(),
  }) {
    const sortedCandles = [...candles].sort(
      (left, right) => candleTime(right) - candleTime(left),
    );
    const currentTicker = tickers.find((ticker) => ticker.market === market);
    const currentPrice =
      toNumber(currentTicker?.trade_price) ??
      toNumber(sortedCandles[0]?.trade_price) ??
      0;
    const referenceThreshold = now - 15 * MINUTE_MS;
    const referenceCandle =
      sortedCandles.find((candle) => candleTime(candle) <= referenceThreshold) ||
      sortedCandles.at(-1);
    const referencePrice =
      toNumber(referenceCandle?.trade_price) ??
      toNumber(referenceCandle?.opening_price);
    const priceChangeRate15m =
      referencePrice && currentPrice
        ? ((currentPrice - referencePrice) / referencePrice) * 100
        : 0;

    const completedCandles = sortedCandles.filter(
      (candle) => candleTime(candle) + MINUTE_MS <= now,
    );
    const volumeCandles =
      completedCandles.length >= 2 ? completedCandles : sortedCandles;
    const latestVolume = toNumber(volumeCandles[0]?.candle_acc_trade_volume) ?? 0;
    const previousVolumes = volumeCandles
      .slice(1, 11)
      .map((candle) => toNumber(candle.candle_acc_trade_volume))
      .filter((volume) => volume !== null);
    const averagePreviousVolume =
      previousVolumes.length > 0
        ? previousVolumes.reduce((sum, volume) => sum + volume, 0) /
          previousVolumes.length
        : 0;
    const volumeChangeRate1m =
      averagePreviousVolume > 0
        ? ((latestVolume - averagePreviousVolume) / averagePreviousVolume) * 100
        : 0;
    const lastFiveCandles = sortedCandles
      .filter((candle) => candleTime(candle) >= now - 5 * MINUTE_MS)
      .slice(0, 5);
    const fiveMinuteReference =
      sortedCandles.find((candle) => candleTime(candle) <= now - 5 * MINUTE_MS) ||
      sortedCandles.at(-1);
    const fiveMinuteReferencePrice =
      toNumber(fiveMinuteReference?.trade_price) ??
      toNumber(fiveMinuteReference?.opening_price);
    const shortTermReturn5m =
      fiveMinuteReferencePrice && currentPrice
        ? (currentPrice - fiveMinuteReferencePrice) / fiveMinuteReferencePrice
        : null;
    const rangePrices = lastFiveCandles.flatMap((candle) => [
      toNumber(candle.high_price) ?? toNumber(candle.trade_price),
      toNumber(candle.low_price) ?? toNumber(candle.trade_price),
    ]).filter((value) => value !== null);
    const minPrice5m = rangePrices.length ? Math.min(...rangePrices) : null;
    const maxPrice5m = rangePrices.length ? Math.max(...rangePrices) : null;
    const pricePositionIn5mRange =
      minPrice5m !== null &&
      maxPrice5m !== null &&
      maxPrice5m > minPrice5m &&
      currentPrice
        ? (currentPrice - minPrice5m) / (maxPrice5m - minPrice5m)
        : null;
    const recentFiveVolumes = completedCandles
      .slice(0, 5)
      .map((candle) => toNumber(candle.candle_acc_trade_volume))
      .filter((volume) => volume !== null);
    const previousFiveVolumes = completedCandles
      .slice(5, 10)
      .map((candle) => toNumber(candle.candle_acc_trade_volume))
      .filter((volume) => volume !== null);
    const recentFiveVolumeSum = recentFiveVolumes.reduce(
      (sum, volume) => sum + volume,
      0,
    );
    const previousFiveAverage =
      previousFiveVolumes.length > 0
        ? previousFiveVolumes.reduce((sum, volume) => sum + volume, 0) /
          previousFiveVolumes.length
        : 0;
    const volumeSpikeRatio5m =
      previousFiveAverage > 0
        ? recentFiveVolumeSum / (previousFiveAverage * Math.max(1, recentFiveVolumes.length))
        : null;
    const firstOrderbookUnit = orderbook?.orderbook_units?.[0];
    const bestAsk = toNumber(firstOrderbookUnit?.ask_price);
    const bestBid = toNumber(firstOrderbookUnit?.bid_price);
    const spreadRate =
      bestAsk && bestBid && bestAsk > 0 ? (bestAsk - bestBid) / bestAsk : null;

    const topThreeMarkets = [...tickers]
      .sort(
        (left, right) =>
          Math.abs(toNumber(right.signed_change_rate) ?? 0) -
          Math.abs(toNumber(left.signed_change_rate) ?? 0),
      )
      .slice(0, 3)
      .map((ticker) => ticker.market);
    const marketDetail = marketDetails.find(
      (detail) => detail.market === market,
    );
    const cautionValues = Object.values(
      marketDetail?.market_event?.caution || {},
    );
    const hasWarningBadge = Boolean(
      marketDetail?.market_event?.warning ||
        cautionValues.some((value) => value === true),
    );
    const marketRiskFlags = [
      marketDetail?.market_event?.warning ? "WARNING" : null,
      ...Object.entries(marketDetail?.market_event?.caution || {})
        .filter(([, value]) => value === true)
        .map(([key]) => `CAUTION_${key}`),
    ].filter(Boolean);

    return {
      current_price: currentPrice,
      tradePriceAtSnapshot: currentPrice ? String(currentPrice) : null,
      shortTermReturn5m:
        shortTermReturn5m === null ? null : Number(shortTermReturn5m.toFixed(6)),
      signedChangeRate:
        toNumber(currentTicker?.signed_change_rate) ?? null,
      spreadRate: spreadRate === null ? null : Number(spreadRate.toFixed(8)),
      marketRiskFlags,
      pricePositionIn5mRange:
        pricePositionIn5mRange === null
          ? null
          : Number(Math.max(0, Math.min(1, pricePositionIn5mRange)).toFixed(6)),
      volumeSpikeRatio5m:
        volumeSpikeRatio5m === null
          ? null
          : Number(volumeSpikeRatio5m.toFixed(4)),
      orderbook,
      market_data: {
        price_change_rate_15m: Number(priceChangeRate15m.toFixed(4)),
        volume_change_rate_1m: Number(volumeChangeRate1m.toFixed(4)),
        is_top3_volatility: topThreeMarkets.includes(market),
        has_warning_badge: hasWarningBadge,
      },
    };
  }

  function mapOrderStatus(state) {
    if (state === "done") {
      return "DONE";
    }

    if (state === "cancel" || state === "prevented") {
      return "CANCEL";
    }

    return "WAIT";
  }

  function mapOrderType(orderType) {
    return orderType === "limit" || orderType === "best" ? "LIMIT" : "MARKET";
  }

  function mapOrderSide(side) {
    return String(side).toLowerCase() === "ask" ? "SELL" : "BUY";
  }

  function getOrderTimeParts(timestamp) {
    const date = new Date(timestamp);

    if (Number.isNaN(date.getTime())) {
      return {
        orderTime: null,
        orderTimeMinutes: null,
      };
    }

    const kst = new Date(date.getTime() + 9 * 60 * MINUTE_MS);
    const hour = kst.getUTCHours();
    const minute = kst.getUTCMinutes();

    return {
      orderTime: `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`,
      orderTimeMinutes: hour * 60 + minute,
    };
  }

  function mapUpbitOrder(order, averageBuyPrices = {}) {
    const side = mapOrderSide(order.side);
    const executedVolume = toNumber(order.executed_volume) ?? 0;
    const executedFunds = toNumber(order.executed_funds) ?? 0;
    const requestedPrice = toNumber(order.price);
    const requestedVolume = toNumber(order.volume);
    const averageFillPrice =
      executedVolume > 0 ? executedFunds / executedVolume : null;
    const marketCurrency = String(order.market || "").split("-")[1];
    const averageBuyPrice = toNumber(averageBuyPrices[marketCurrency]);
    const realizedLoss =
      side === "SELL" && averageBuyPrice && averageFillPrice
        ? Math.max(
            0,
            ((averageBuyPrice - averageFillPrice) / averageBuyPrice) * 100,
          )
        : null;
    const isLimit = mapOrderType(order.ord_type) === "LIMIT";
    const amount =
      executedFunds ||
      (side === "BUY" && !isLimit ? requestedPrice : 0) ||
      (requestedPrice && requestedVolume
        ? requestedPrice * requestedVolume
        : null);

    return {
      market: order.market,
      order_side: side,
      order_status: mapOrderStatus(order.state),
      order_type: mapOrderType(order.ord_type),
      order_price: isLimit ? requestedPrice : null,
      order_volume: requestedVolume ?? (executedVolume || null),
      order_amount: amount,
      realized_loss_pct_1h:
        realizedLoss === null ? null : Number(realizedLoss.toFixed(4)),
      order_request_time: order.created_at,
      order_cancel_time: null,
    };
  }

  function calculateAverageBuyAmount(orders, limit = 10) {
    const amounts = orders
      .filter((order) => mapOrderSide(order.side) === "BUY")
      .map((order) => toNumber(order.executed_funds))
      .filter((amount) => amount !== null && amount > 0)
      .slice(0, limit);

    if (amounts.length === 0) {
      return null;
    }

    return amounts.reduce((sum, amount) => sum + amount, 0) / amounts.length;
  }

  function getRuleFieldValue(context, field) {
    return context && Object.prototype.hasOwnProperty.call(context, field)
      ? context[field]
      : null;
  }

  function resolveOperandValue(operand, context) {
    if (!operand || typeof operand !== "object") {
      return undefined;
    }

    if (operand.operandType === "LITERAL") {
      return operand.value;
    }

    if (operand.operandType === "FIELD") {
      return getRuleFieldValue(context, operand.field);
    }

    return undefined;
  }

  function compareRuleValues(valueType, leftValue, rightValue) {
    if (leftValue === null || leftValue === undefined) {
      return null;
    }

    if (rightValue === null || rightValue === undefined) {
      return null;
    }

    if (valueType === "NUMBER") {
      const leftNumber = toNumber(leftValue);
      const rightNumber = toNumber(rightValue);

      if (leftNumber === null || rightNumber === null) {
        return null;
      }

      return leftNumber === rightNumber ? 0 : leftNumber > rightNumber ? 1 : -1;
    }

    if (valueType === "DECIMAL_STRING") {
      return compareDecimalStrings(String(leftValue), String(rightValue));
    }

    if (valueType === "BOOLEAN") {
      if (typeof leftValue !== "boolean" || typeof rightValue !== "boolean") {
        return null;
      }

      return leftValue === rightValue ? 0 : leftValue ? 1 : -1;
    }

    if (valueType === "MIXED_ENUM") {
      const leftMixed = leftValue === null ? null : String(leftValue);
      const rightMixed = rightValue === null ? null : String(rightValue);
      return leftMixed === rightMixed ? 0 : leftMixed > rightMixed ? 1 : -1;
    }

    const leftString = String(leftValue);
    const rightString = String(rightValue);
    return leftString === rightString ? 0 : leftString > rightString ? 1 : -1;
  }

  function areComparableFields(leftField, rightField) {
    const leftDefinition = RULE_FIELD_CATALOG[leftField];
    const rightDefinition = RULE_FIELD_CATALOG[rightField];

    if (!leftDefinition?.ruleEligible || !rightDefinition?.ruleEligible) {
      return false;
    }

    return Boolean(
      leftDefinition.comparisonGroup &&
        leftDefinition.comparisonGroup === rightDefinition.comparisonGroup,
    );
  }

  function evaluateArrayCondition(leftValue, operator, rightValue) {
    if (!Array.isArray(leftValue)) {
      return false;
    }

    if (operator === "IS_NOT_NULL") {
      return leftValue.length > 0;
    }

    if (operator === "IS_NULL") {
      return false;
    }

    const expected = Array.isArray(rightValue) ? rightValue.map(String) : [];
    const actual = leftValue.map(String);
    const matched = expected.some((value) => actual.includes(value));

    if (operator === "IN") {
      return matched;
    }

    if (operator === "NOT_IN") {
      return !matched;
    }

    return false;
  }

  function evaluateRuleCondition(condition, context) {
    if (!condition || condition.nodeType !== "CONDITION") {
      return false;
    }

    const fieldDefinition = RULE_FIELD_CATALOG[condition.leftField] || null;

    if (!fieldDefinition?.ruleEligible) {
      return false;
    }

    const leftValue = getRuleFieldValue(context, condition.leftField);

    if (fieldDefinition.valueType === "STRING_ARRAY") {
      if (condition.operator === "IS_NULL") {
        return leftValue === null || leftValue === undefined;
      }

      const rightValue = resolveOperandValue(condition.rightOperand, context);
      return evaluateArrayCondition(leftValue, condition.operator, rightValue);
    }

    if (condition.operator === "IS_NULL") {
      return leftValue === null || leftValue === undefined;
    }

    if (condition.operator === "IS_NOT_NULL") {
      return leftValue !== null && leftValue !== undefined;
    }

    if (leftValue === null || leftValue === undefined) {
      return false;
    }

    const rightValue = resolveOperandValue(condition.rightOperand, context);

    if (
      condition.rightOperand?.operandType === "FIELD" &&
      !areComparableFields(condition.leftField, condition.rightOperand.field)
    ) {
      return false;
    }

    if (condition.operator === "IN" || condition.operator === "NOT_IN") {
      const values = Array.isArray(rightValue) ? rightValue.map(String) : [];
      const matched = values.includes(String(leftValue));
      return condition.operator === "IN" ? matched : !matched;
    }

    const comparison = compareRuleValues(
      fieldDefinition.valueType,
      leftValue,
      rightValue,
    );

    if (comparison === null) {
      return false;
    }

    if (condition.operator === "EQ") return comparison === 0;
    if (condition.operator === "NEQ") return comparison !== 0;
    if (condition.operator === "GT") return comparison > 0;
    if (condition.operator === "GTE") return comparison >= 0;
    if (condition.operator === "LT") return comparison < 0;
    if (condition.operator === "LTE") return comparison <= 0;

    return false;
  }

  function evaluateRuleExpression(expression, context) {
    if (!expression || typeof expression !== "object") {
      return false;
    }

    if (expression.nodeType === "CONDITION") {
      return evaluateRuleCondition(expression, context);
    }

    if (expression.nodeType === "GROUP") {
      const children = Array.isArray(expression.children)
        ? expression.children
        : [];

      if (children.length === 0) {
        return false;
      }

      if (expression.operator === "OR") {
        return children.some((child) => evaluateRuleExpression(child, context));
      }

      return children.every((child) => evaluateRuleExpression(child, context));
    }

    return false;
  }

  function collectRuleConditions(expression) {
    if (!expression || typeof expression !== "object") {
      return [];
    }

    if (expression.nodeType === "CONDITION") {
      return [expression];
    }

    if (expression.nodeType !== "GROUP") {
      return [];
    }

    return (Array.isArray(expression.children) ? expression.children : [])
      .flatMap(collectRuleConditions);
  }

  function getRuleValueSource(field) {
    if (
      [
        "tradePriceAtSnapshot",
        "shortTermReturn5m",
        "signedChangeRate",
        "spreadRate",
        "marketRiskFlags",
        "pricePositionIn5mRange",
        "volumeSpikeRatio5m",
      ].includes(field)
    ) {
      return `marketSnapshot.${field}`;
    }

    if (
      [
        "draftDurationMs",
        "lastEditToSnapshotMs",
        "draftEditCount",
        "amountChangeRate",
        "modeChangedToMarket",
        "orderbookClickToSnapshotMs",
        "orderIntentCount1m",
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
      ].includes(field)
    ) {
      return `behaviorSnapshot.${field}`;
    }

    if (
      [
        "actualOrderCreatedCount10m",
        "baseAssetAvgBuyPriceBeforeSnapshot",
        "priceVsAvgBuyRateAtSnapshot",
      ].includes(field)
    ) {
      return `personalSnapshot.${field}`;
    }

    return `orderSnapshot.${field}`;
  }

  function evaluateRuleConditionWithResult(rule, condition, context) {
    const fieldDefinition = RULE_FIELD_CATALOG[condition?.leftField] || null;
    const actualValue = getRuleFieldValue(context, condition?.leftField);
    const expectedValue = resolveOperandValue(condition?.rightOperand, context);
    const unsupported = !fieldDefinition?.ruleEligible;
    const missingPersonalData =
      fieldDefinition?.requiresPrivateApi &&
      (actualValue === null || actualValue === undefined);
    const invalidComparableField =
      condition?.rightOperand?.operandType === "FIELD" &&
      !areComparableFields(condition.leftField, condition.rightOperand.field);
    const matched = unsupported || invalidComparableField
      ? false
      : evaluateRuleExpression(condition, context);

    const result = {
      ruleId: rule?.ruleId || null,
      ruleName: rule?.name || rule?.warningTitle || rule?.title || null,
      field: condition?.leftField || null,
      leftField: condition?.leftField || null,
      operator: condition?.operator || null,
      expectedValue,
      actualValue,
      matched,
      pass: matched,
      valueSource: getRuleValueSource(condition?.leftField),
      missingReason: missingPersonalData
        ? "MISSING_PERSONAL_DATA"
        : unsupported
          ? "UNSUPPORTED_RULE_FIELD"
          : actualValue === null || actualValue === undefined
            ? "REQUIRED_FIELD_MISSING"
            : invalidComparableField
              ? "INVALID_NORMALIZED_VALUE"
              : null,
    };
    const formatted = formatConditionEvaluation(result);

    return {
      ...result,
      fieldLabel: formatted.title,
      operatorLabel: formatted.operatorLabel,
      formattedExpectedValue: formatted.criteriaText,
      formattedActualValue: formatted.actualText,
      description: formatted.description,
      actualSentence: formatted.actualSentence,
    };
  }

  function buildRuleConditionResults(rules, context) {
    return (Array.isArray(rules) ? rules : [])
      .filter((rule) => rule?.isEnabled !== false)
      .flatMap((rule) =>
        collectRuleConditions(rule.expression).map((condition) =>
          evaluateRuleConditionWithResult(rule, condition, context),
        ),
      );
  }

  function buildExpressionEvaluationResult(rule, expression, context) {
    if (!expression || typeof expression !== "object") {
      return null;
    }

    if (expression.nodeType === "CONDITION") {
      const condition = evaluateRuleConditionWithResult(rule, expression, context);
      return {
        nodeType: "CONDITION",
        matched: condition.matched,
        condition,
      };
    }

    if (expression.nodeType !== "GROUP") {
      return null;
    }

    const children = (Array.isArray(expression.children) ? expression.children : [])
      .map((child) => buildExpressionEvaluationResult(rule, child, context))
      .filter(Boolean);
    const matched = expression.operator === "OR"
      ? children.some((child) => child.matched)
      : children.length > 0 && children.every((child) => child.matched);

    return {
      nodeType: "GROUP",
      operator: expression.operator === "OR" ? "OR" : "AND",
      matched,
      children,
    };
  }

  function flattenExpressionEvaluation(result) {
    if (!result || typeof result !== "object") {
      return [];
    }

    if (result.nodeType === "CONDITION") {
      return result.condition ? [result.condition] : [];
    }

    return (Array.isArray(result.children) ? result.children : [])
      .flatMap(flattenExpressionEvaluation);
  }

  function evaluateGuardrailRules(rules, context) {
    const enabledRules = Array.isArray(rules)
      ? rules.filter((rule) => rule?.isEnabled !== false)
      : [];
    const matchedRules = enabledRules
      .filter((rule) => evaluateRuleExpression(rule.expression, context))
      .sort((left, right) => {
        const priorityDiff = Number(left.priority || 0) - Number(right.priority || 0);
        return priorityDiff || String(left.createdAt || "").localeCompare(
          String(right.createdAt || ""),
        );
      });
    const primaryRule = matchedRules[0] || null;

    return {
      detected: matchedRules.length > 0,
      matchedRules,
      matchedRuleIds: matchedRules.map((rule) => rule.ruleId),
      expressionResults: enabledRules.map((rule) => ({
        ruleId: rule.ruleId || null,
        ruleName: rule.name || rule.warningTitle || rule.title || null,
        matched: evaluateRuleExpression(rule.expression, context),
        expression: buildExpressionEvaluationResult(rule, rule.expression, context),
      })),
      primaryRule,
      primaryRuleId: primaryRule?.ruleId || null,
      warningTitle: primaryRule?.warningTitle || null,
      warningMessage: primaryRule?.warningMessage || null,
      riskLevel: primaryRule?.riskLevel || null,
      visualMode: resolveVisualMode(primaryRule),
      conditionResults: buildRuleConditionResults(enabledRules, context),
    };
  }

  function createGuardrailRuleSnapshot(rule) {
    if (!rule || typeof rule !== "object" || !rule.ruleId) {
      return null;
    }

    return {
      ruleId: String(rule.ruleId),
      name: String(rule.name || rule.warningTitle || "이름 없는 규칙"),
      description:
        rule.description === undefined || rule.description === null
          ? null
          : String(rule.description),
      priority:
        Number.isFinite(Number(rule.priority)) ? Number(rule.priority) : undefined,
      riskLevel: ["LOW", "MEDIUM", "HIGH"].includes(rule.riskLevel)
        ? rule.riskLevel
        : "MEDIUM",
      visualMode: normalizeVisualMode(rule.visualMode) === "DEFAULT"
        ? "CURIOUS"
        : normalizeVisualMode(rule.visualMode),
      expression: rule.expression,
      warningTitle: rule.warningTitle ? String(rule.warningTitle) : undefined,
      warningMessage: rule.warningMessage ? String(rule.warningMessage) : undefined,
    };
  }

  function buildBehaviorSnapshot(state, now = Date.now()) {
    const currentMarket = state.market;
    const buyClicks = pruneTimestamps(
      state.buyClicksByMarket[currentMarket] || [],
      MINUTE_MS,
      now,
    );
    const edits = pruneTimestamps(state.inputEditTimestamps, 3 * MINUTE_MS, now);
    const visibleDuration =
      state.visibleDurationMs +
      (state.visibleSince ? Math.max(0, now - state.visibleSince) : 0);

    return {
      is_max_button_clicked: Boolean(state.maxClickedSinceLastOrder),
      client_avg_buy_amount: state.clientAvgBuyAmount ?? null,
      buy_click_count_1m: buyClicks.length,
      input_edit_count: edits.length,
      page_stay_duration: Number((visibleDuration / 1000).toFixed(2)),
    };
  }

  const api = {
    MINUTE_MS,
    buildBehaviorSnapshot,
    calculateAverageBuyAmount,
    calculateMarketData,
    createGuardrailRuleSnapshot,
    detectOrderActionSide,
    evaluateGuardrailRules,
    evaluateRuleExpression,
    flattenExpressionEvaluation,
    formatConditionDescription,
    formatConditionEvaluation,
    formatExpressionEvaluationSummary,
    formatOperatorLabel,
    formatRuleFieldValue,
    buildRuleConditionResults,
    getOrderTimeParts,
    mapOrderSide,
    mapOrderStatus,
    mapOrderType,
    mapUpbitOrder,
    parseMarket,
    pruneTimestamps,
    resolveVisualMode,
    RULE_FIELD_CATALOG,
    toNumber,
  };

  globalScope.SaltbreadCore = api;

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(typeof globalThis === "undefined" ? this : globalThis);
