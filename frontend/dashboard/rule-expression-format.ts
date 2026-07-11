import { RULE_FIELD_CATALOG } from "@/backend/modules/guardrail/catalog";
import type {
  RuleCondition,
  RuleExpression,
  RuleFieldDefinition,
  RuleOperand,
  RuleOperator,
} from "@/backend/modules/guardrail/types";

const SUPPORTED_FIELDS = Object.fromEntries(
  Object.entries(RULE_FIELD_CATALOG).filter(([, field]) => field.ruleEligible),
) as Record<string, RuleFieldDefinition>;

const SYSTEM_FIELDS = Object.fromEntries(
  Object.entries(RULE_FIELD_CATALOG).filter(([, field]) => !field.ruleEligible),
) as Record<string, RuleFieldDefinition>;

const OPERATOR_LABELS: Record<RuleOperator, string> = {
  EQ: "같음",
  NEQ: "같지 않음",
  GT: "초과",
  GTE: "이상",
  LT: "미만",
  LTE: "이하",
  IN: "포함할 때",
  NOT_IN: "포함하지 않을 때",
  IS_NULL: "값이 없을 때",
  IS_NOT_NULL: "값이 있을 때",
};

const OPERATOR_PHRASES: Partial<Record<RuleOperator, string>> = {
  GT: "초과",
  GTE: "이상",
  LT: "미만",
  LTE: "이하",
};

function hasFinalConsonant(text: string) {
  const last = text.trim().at(-1);
  if (!last) return false;
  const code = last.charCodeAt(0);
  if (code < 0xac00 || code > 0xd7a3) return false;
  return (code - 0xac00) % 28 !== 0;
}

function subjectParticle(text: string) {
  return hasFinalConsonant(text) ? "이" : "가";
}

function formatNumberWithComma(value: string | number) {
  const numeric =
    typeof value === "number"
      ? value
      : Number(String(value).replaceAll(",", ""));

  if (!Number.isFinite(numeric)) {
    return String(value);
  }

  return new Intl.NumberFormat("ko-KR", {
    maximumFractionDigits: 8,
  }).format(numeric);
}

function formatDurationValue(ms: number) {
  if (ms % 60_000 === 0) {
    return `${formatNumberWithComma(ms / 60_000)}분`;
  }

  if (ms % 1000 === 0) {
    return `${formatNumberWithComma(ms / 1000)}초`;
  }

  return `${formatNumberWithComma(ms)}밀리초`;
}

function formatMinutesValue(minutes: number) {
  const normalized = Math.max(0, Math.min(1439, Math.trunc(minutes)));
  const hour = Math.floor(normalized / 60);
  const minute = normalized % 60;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

export function formatOperatorLabel(operator: RuleOperator) {
  return OPERATOR_LABELS[operator] ?? operator;
}

export function formatFieldValue(
  fieldKey: string,
  value: unknown,
  options: { missingReason?: string | null; historyMissing?: boolean } = {},
) {
  const field =
    SUPPORTED_FIELDS[fieldKey] || SYSTEM_FIELDS[fieldKey] || SUPPORTED_FIELDS.side;

  if (value === null || value === undefined || value === "") {
    if (options.missingReason === "MISSING_PERSONAL_DATA" || field.requiresPrivateApi) {
      return "업비트 개인 API 연결 필요";
    }
    if (options.historyMissing) {
      return "이 기록에는 당시 판정값이 저장되지 않았어요";
    }
    return "당시 값을 확인할 수 없어요";
  }

  return describeLiteralValue(field, value);
}

function describeLiteralValue(field: RuleFieldDefinition, value: unknown) {
  if (Array.isArray(value)) {
    return value
      .map((item) => {
        const option = field.input.options?.find(
          (candidate) => String(candidate.value) === String(item),
        );
        return option?.label || String(item);
      })
      .join(", ");
  }

  const option = field.input.options?.find(
    (candidate) => String(candidate.value) === String(value),
  );

  if (option) return option.label;

  if (field.input.storageUnit === "ratio" && typeof value === "number") {
    return `${Number((value * 100).toFixed(4))}%`;
  }

  if (field.input.storageUnit === "ms" && typeof value === "number") {
    return formatDurationValue(value);
  }

  if (field.input.storageUnit === "minutes" && typeof value === "number") {
    return formatMinutesValue(value);
  }

  if (
    (field.semanticType === "PRICE" || field.semanticType === "AMOUNT") &&
    (typeof value === "string" || typeof value === "number")
  ) {
    return `${formatNumberWithComma(value)}${field.input.displayUnit || "원"}`;
  }

  if (
    (field.semanticType === "COUNT" ||
      field.semanticType === "QUANTITY" ||
      field.semanticType === "MULTIPLIER") &&
    (typeof value === "string" || typeof value === "number")
  ) {
    return `${formatNumberWithComma(value)}${field.input.displayUnit || ""}`;
  }

  if (typeof value === "boolean") return value ? "해당함" : "해당하지 않음";

  return `${value ?? ""}${field.input.displayUnit || ""}`;
}

function describeValue(field: RuleFieldDefinition, operand?: RuleOperand) {
  if (!operand) return "";

  if (operand.operandType === "FIELD") {
    const rightField =
      SUPPORTED_FIELDS[operand.field] || SYSTEM_FIELDS[operand.field];
    return rightField?.label || operand.field;
  }

  const value = operand.value;
  return describeLiteralValue(field, value);
}

export function buildConditionSentence(condition: RuleCondition) {
  const field =
    SUPPORTED_FIELDS[condition.leftField] ||
    SYSTEM_FIELDS[condition.leftField] ||
    SUPPORTED_FIELDS.side;

  if (condition.operator === "IS_NULL") {
    return `${field.label}에 확인 가능한 값이 없을 때`;
  }

  if (condition.operator === "IS_NOT_NULL") {
    return `${field.label}에 확인 가능한 값이 있을 때`;
  }

  const operand =
    "rightOperand" in condition ? condition.rightOperand : undefined;
  const valueText = describeValue(field, operand);
  const particle = subjectParticle(field.label);

  if (field.semanticType === "BOOLEAN" && condition.operator === "EQ") {
    return valueText.endsWith("때") || valueText.endsWith("경우")
      ? valueText
      : `${field.label}${particle} ${valueText}일 때`;
  }

  if (condition.operator === "EQ") {
    if (valueText.endsWith("때") || valueText.endsWith("경우")) {
      return `${field.label}${particle} ${valueText}`;
    }
    return `${field.label}${particle} ${valueText}일 때`;
  }

  if (condition.operator === "NEQ") {
    return `${field.label}${particle} ${valueText} 아닐 때`;
  }

  if (condition.operator === "IN") {
    return `${field.label}에 ${valueText}이 포함될 때`;
  }

  if (condition.operator === "NOT_IN") {
    return `${field.label}에 ${valueText}이 포함되지 않을 때`;
  }

  const operatorPhrase =
    OPERATOR_PHRASES[condition.operator] ?? OPERATOR_LABELS[condition.operator];

  if (field.semanticType === "TIME_OF_DAY") {
    if (condition.operator === "GT") {
      return `${field.label}${particle} ${valueText} 이후일 때`;
    }
    if (condition.operator === "LT") {
      return `${field.label}${particle} ${valueText} 이전일 때`;
    }
  }

  if (field.semanticType === "DURATION_MS" && condition.operator === "LTE") {
    return `${field.label}${particle} ${valueText} 이내일 때`;
  }

  return `${field.label}${particle} ${valueText} ${operatorPhrase}일 때`;
}

export const formatConditionDescription = buildConditionSentence;

export function buildExpressionPreview(expression: RuleExpression): string {
  if (expression.nodeType === "CONDITION") {
    return buildConditionSentence(expression);
  }

  const header =
    expression.operator === "OR"
      ? "다음 조건 중 하나 이상을 만족할 때"
      : "다음 조건을 모두 만족할 때";
  const body = expression.children
    .map((child) => `- ${buildExpressionPreview(child).replaceAll("\n", "\n  ")}`)
    .join("\n");

  return `${header}\n${body}`;
}

export const formatRuleExpression = buildExpressionPreview;

export function formatConditionEvaluation(condition: {
  leftField: string;
  operator: RuleOperator;
  expectedValue?: unknown;
  actualValue?: unknown;
  matched?: boolean | null;
  missingReason?: string | null;
  unavailableReason?: string | null;
}) {
  const description = buildConditionSentence({
    nodeType: "CONDITION",
    leftField: condition.leftField,
    operator: condition.operator,
    rightOperand: {
      operandType: "LITERAL",
      value: condition.expectedValue as string | number | boolean | string[] | null,
    },
  } as RuleCondition);
  const missingReason = condition.missingReason ?? condition.unavailableReason ?? null;
  const actualText = formatFieldValue(condition.leftField, condition.actualValue, {
    missingReason,
  });
  const expectedText = formatFieldValue(condition.leftField, condition.expectedValue);
  const criteriaText =
    condition.operator === "IS_NULL" || condition.operator === "IS_NOT_NULL"
      ? formatOperatorLabel(condition.operator)
      : condition.operator === "EQ"
        ? expectedText
        : condition.operator === "NEQ"
          ? `${expectedText} 아님`
          : condition.operator === "IN"
            ? `${expectedText} 중 하나`
            : condition.operator === "NOT_IN"
              ? `${expectedText} 제외`
              : `${expectedText} ${
                  OPERATOR_PHRASES[condition.operator] ??
                  formatOperatorLabel(condition.operator)
                }`.trim();

  return {
    description,
    criteriaText,
    actualText,
    actualSentence:
      missingReason === "MISSING_PERSONAL_DATA"
        ? "업비트 개인 API 연결이 필요한 조건이에요."
        : condition.actualValue === null ||
            condition.actualValue === undefined ||
            condition.actualValue === ""
          ? "이 기록에는 당시 판정값이 저장되지 않았어요."
          : `경고 당시 ${actualText}였어요.`,
    matched: Boolean(condition.matched),
  };
}
