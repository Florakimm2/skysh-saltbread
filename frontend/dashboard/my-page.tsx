"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type {
  RiskLevel,
  RuleCondition,
  RuleConditionGroup,
  RuleExpression,
  RuleOperand,
  RuleOperator,
  RuleFieldDefinition,
  UserGuardrailRuleDTO,
  VisualMode,
} from "@/backend/modules/guardrail/types";
import { RULE_FIELD_CATALOG } from "@/backend/modules/guardrail/catalog";
import FlameMascot, { type FlameMode } from "@/frontend/auth/flame-mascot";
import {
  buildConditionSentence,
  buildExpressionPreview,
} from "./rule-expression-format";
import PageHeader from "./page-header";
import { GuardrailIcon, UserIcon } from "./icons";
import styles from "./dashboard.module.css";

type Profile = {
  userId: string;
  email: string | null;
  displayName: string | null;
};

type DraftRule = Omit<
  UserGuardrailRuleDTO,
  "ruleId" | "userId" | "requiresPrivateApi" | "schemaVersion" | "createdAt" | "updatedAt"
> & {
  ruleId?: string;
};

type StatusMessage = {
  type: "success" | "error";
  message: string;
};

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

const TIME_OPERATOR_LABELS: Partial<Record<RuleOperator, string>> = {
  GT: "해당 시간 이후",
  GTE: "해당 시간 이상",
  LT: "해당 시간 이전",
  LTE: "해당 시간 이하",
  EQ: "해당 시간과 같음",
};

const RISK_LEVEL_META: Record<
  RiskLevel,
  {
    label: string;
    description: string;
  }
> = {
  LOW: {
    label: "낮은 위험",
    description: "참고 수준의 가벼운 알림",
  },
  MEDIUM: {
    label: "주의 필요",
    description: "주문 전에 한 번 더 확인할 필요가 있는 상황",
  },
  HIGH: {
    label: "높은 위험",
    description: "정한 원칙에서 벗어날 가능성이 커 강하게 확인할 상황",
  },
};

const VISUAL_MODE_META: Record<
  VisualMode,
  {
    label: string;
    animationMode: FlameMode;
    keywords: string[];
    description: string;
  }
> = {
  CURIOUS: {
    label: "확인",
    animationMode: "curious",
    keywords: ["확인", "관찰", "기본 점검"],
    description: "일반적인 확인이 필요한 주문 상황에 사용합니다.",
  },
  SURPRISED: {
    label: "급변",
    animationMode: "surprised",
    keywords: ["급등", "급락", "갑작스러운 변화"],
    description: "가격이나 거래량이 짧은 시간 안에 크게 변한 상황에 사용합니다.",
  },
  FAST_BURN: {
    label: "반복",
    animationMode: "fastBurn",
    keywords: ["반복 주문", "빠른 주문", "짧은 시간"],
    description: "짧은 시간 안에 주문이나 입력 수정이 반복되는 상황에 사용합니다.",
  },
  SCARED: {
    label: "위험",
    animationMode: "scared",
    keywords: ["공포 매도", "큰 손실", "높은 위험"],
    description: "급락이나 손실 구간에서 급하게 주문할 가능성이 큰 상황에 사용합니다.",
  },
  SAD: {
    label: "손실",
    animationMode: "sad",
    keywords: ["손실", "평균 매수가", "후회"],
    description: "평균 매수가 대비 손실이나 좋지 않은 체결 경험과 관련된 상황에 사용합니다.",
  },
};

const CATEGORY_LABELS: Record<RuleFieldDefinition["category"], string> = {
  ORDER_CONTEXT: "주문 상황",
  ORDER_INPUT: "주문 금액과 입력값",
  DRAFT_BEHAVIOR: "주문 작성 행동",
  RECENT_BEHAVIOR: "최근 반복 행동",
  MARKET: "시장 움직임",
  PRIVATE_ACCOUNT: "내 투자 정보",
  SYSTEM: "현재 규칙에 사용할 수 없는 항목",
};

const FIELD_ICON_LABELS: Partial<Record<RuleFieldDefinition["semanticType"], string>> = {
  ENUM: "선택",
  MARKET: "종목",
  PRICE: "가격",
  QUANTITY: "수량",
  AMOUNT: "금액",
  SIGNED_PERCENT: "%",
  NON_NEGATIVE_PERCENT: "%",
  RATIO_0_TO_1: "%",
  DURATION_MS: "초",
  COUNT: "회",
  MULTIPLIER: "배",
  BOOLEAN: "여부",
  FLAG_SET: "경보",
  ALLOCATION_PRESET: "버튼",
  TIME_OF_DAY: "시간",
};

function getFieldIconLabel(field: RuleFieldDefinition) {
  return FIELD_ICON_LABELS[field.semanticType] || "조건";
}

function getOperatorLabel(field: RuleFieldDefinition, operator: RuleOperator) {
  if (field.semanticType === "TIME_OF_DAY") {
    return TIME_OPERATOR_LABELS[operator] ?? OPERATOR_LABELS[operator];
  }

  return OPERATOR_LABELS[operator];
}

function FieldSemanticIcon({ semanticType }: { semanticType: RuleFieldDefinition["semanticType"] }) {
  const commonProps = {
    fill: "none",
    viewBox: "0 0 24 24",
    stroke: "currentColor",
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    strokeWidth: 1.9,
    "aria-hidden": true,
  };

  switch (semanticType) {
    case "MARKET":
      return (
        <svg {...commonProps}>
          <path d="M4 18h16" />
          <path d="M7 15V9l5-4 5 4v6" />
          <path d="M10 18v-5h4v5" />
        </svg>
      );
    case "PRICE":
    case "AMOUNT":
      return (
        <svg {...commonProps}>
          <path d="M12 3v18" />
          <path d="M17 7.5c-.8-1.1-2.4-1.8-4.3-1.8-2.3 0-4.2 1.1-4.2 2.8 0 1.6 1.5 2.3 4.1 2.8 2.8.6 4.4 1.3 4.4 3 0 1.8-1.9 3-4.5 3-2 0-3.8-.8-4.8-2" />
        </svg>
      );
    case "QUANTITY":
    case "COUNT":
      return (
        <svg {...commonProps}>
          <path d="M8 7h8" />
          <path d="M8 12h8" />
          <path d="M8 17h8" />
          <path d="M5 7h.01M5 12h.01M5 17h.01" />
        </svg>
      );
    case "SIGNED_PERCENT":
    case "NON_NEGATIVE_PERCENT":
    case "RATIO_0_TO_1":
      return (
        <svg {...commonProps}>
          <path d="m6 18 12-12" />
          <circle cx="7" cy="7" r="2" />
          <circle cx="17" cy="17" r="2" />
        </svg>
      );
    case "DURATION_MS":
    case "TIME_OF_DAY":
      return (
        <svg {...commonProps}>
          <circle cx="12" cy="13" r="7" />
          <path d="M12 13V9" />
          <path d="m12 13 3 2" />
          <path d="M9 3h6" />
        </svg>
      );
    case "BOOLEAN":
      return (
        <svg {...commonProps}>
          <path d="M5 12.5 9.5 17 19 7" />
        </svg>
      );
    case "FLAG_SET":
      return (
        <svg {...commonProps}>
          <path d="M6 20V5" />
          <path d="M6 5h11l-2 4 2 4H6" />
        </svg>
      );
    case "MULTIPLIER":
      return (
        <svg {...commonProps}>
          <path d="M7 7 17 17" />
          <path d="M17 7 7 17" />
        </svg>
      );
    case "ALLOCATION_PRESET":
      return (
        <svg {...commonProps}>
          <rect x="4" y="5" width="7" height="6" rx="2" />
          <rect x="13" y="5" width="7" height="6" rx="2" />
          <rect x="4" y="13" width="7" height="6" rx="2" />
          <rect x="13" y="13" width="7" height="6" rx="2" />
        </svg>
      );
    default:
      return (
        <svg {...commonProps}>
          <path d="M6 8h12" />
          <path d="M6 12h12" />
          <path d="M6 16h12" />
        </svg>
      );
  }
}

const RECOMMENDED_SITUATIONS = [
  {
    title: "가격이 갑자기 올랐을 때",
    field: "shortTermReturn5m",
    operator: "GTE" as RuleOperator,
    value: 0.08,
  },
  {
    title: "가격이 갑자기 떨어졌을 때",
    field: "shortTermReturn5m",
    operator: "LTE" as RuleOperator,
    value: -0.08,
  },
  {
    title: "큰 금액을 주문할 때",
    field: "requestedBalanceRatio",
    operator: "GTE" as RuleOperator,
    value: 0.5,
  },
  {
    title: "시장가로 급하게 바꿨을 때",
    field: "modeChangedToMarket",
    operator: "EQ" as RuleOperator,
    value: true,
  },
  {
    title: "짧은 시간 동안 주문을 반복했을 때",
    field: "sameSideIntentCount1m",
    operator: "GTE" as RuleOperator,
    value: 3,
  },
  {
    title: "주문 내용을 여러 번 수정했을 때",
    field: "draftEditCount",
    operator: "GTE" as RuleOperator,
    value: 3,
  },
  {
    title: "평균 매수가보다 손실 중일 때",
    field: "priceVsAvgBuyRateAtSnapshot",
    operator: "LTE" as RuleOperator,
    value: -0.05,
  },
  {
    title: "여러 종목을 빠르게 옮겨 다녔을 때",
    field: "marketChangeCount5m",
    operator: "GTE" as RuleOperator,
    value: 3,
  },
  {
    title: "거래량이 갑자기 늘었을 때",
    field: "volumeSpikeRatio5m",
    operator: "GTE" as RuleOperator,
    value: 3,
  },
];

const NULL_OPERATORS = new Set<RuleOperator>(["IS_NULL", "IS_NOT_NULL"]);

function createCondition(): RuleCondition {
  return createConditionForField("side", "EQ", "BUY");
}

function createGroup(): RuleConditionGroup {
  return {
    nodeType: "GROUP",
    operator: "AND",
    children: [createCondition()],
  };
}

function createDraftRule(priority: number): DraftRule {
  return {
    name: "새 가드레일 규칙",
    description: "",
    isEnabled: true,
    priority,
    riskLevel: "MEDIUM",
    visualMode: "CURIOUS",
    expression: createGroup(),
    warningTitle: "주문 전 확인",
    warningMessage: "내가 만든 규칙에 해당하는 주문 조건입니다.",
  };
}

function toDraft(rule: UserGuardrailRuleDTO): DraftRule {
  return {
    ruleId: rule.ruleId,
    name: rule.name,
    description: rule.description ?? "",
    isEnabled: rule.isEnabled,
    priority: rule.priority,
    riskLevel: rule.riskLevel,
    visualMode: rule.visualMode,
    expression: rule.expression,
    warningTitle: rule.warningTitle,
    warningMessage: rule.warningMessage,
  };
}

function serializeRule(
  draft: DraftRule,
  options: { includePriority?: boolean } = {},
) {
  const body = {
    name: draft.name,
    description: draft.description || null,
    isEnabled: draft.isEnabled,
    riskLevel: draft.riskLevel,
    visualMode: draft.visualMode,
    expression: draft.expression,
    warningTitle: draft.warningTitle,
    warningMessage: draft.warningMessage,
  };

  return options.includePriority ? { ...body, priority: draft.priority } : body;
}

function cloneExpression<T extends RuleExpression>(expression: T): T {
  return JSON.parse(JSON.stringify(expression)) as T;
}

function updateAtPath(
  expression: RuleExpression,
  path: number[],
  updater: (node: RuleExpression) => RuleExpression,
): RuleExpression {
  if (path.length === 0) return updater(expression);

  if (expression.nodeType !== "GROUP") return expression;

  const [index, ...rest] = path;
  return {
    ...expression,
    children: expression.children.map((child, childIndex) =>
      childIndex === index ? updateAtPath(child, rest, updater) : child,
    ),
  };
}

function removeAtPath(
  expression: RuleExpression,
  path: number[],
): RuleExpression {
  if (path.length === 0 || expression.nodeType !== "GROUP") return expression;
  const [index, ...rest] = path;

  if (rest.length === 0) {
    return {
      ...expression,
      children:
        expression.children.length > 1
          ? expression.children.filter((_, childIndex) => childIndex !== index)
          : expression.children,
    };
  }

  return {
    ...expression,
    children: expression.children.map((child, childIndex) =>
      childIndex === index ? removeAtPath(child, rest) : child,
    ),
  };
}

function insertChild(
  expression: RuleExpression,
  path: number[],
  child: RuleExpression,
): RuleExpression {
  return updateAtPath(expression, path, (node) =>
    node.nodeType === "GROUP"
      ? { ...node, children: [...node.children, child] }
      : node,
  );
}

function getExpressionAtPath(
  expression: RuleExpression,
  path: number[],
): RuleExpression | null {
  return path.reduce<RuleExpression | null>((node, index) => {
    if (!node || node.nodeType !== "GROUP") return null;
    return node.children[index] ?? null;
  }, expression);
}

function buildRightOperand(
  field: RuleFieldDefinition,
  operator: RuleOperator,
): RuleOperand {
  const firstOption = field.input.options?.find((option) => !option.hiddenInPicker);
  const defaultValue =
    operator === "IN" || operator === "NOT_IN"
      ? [String(firstOption?.value ?? "WARNING")]
      : field.valueType === "NUMBER"
        ? 0
        : field.valueType === "DECIMAL_STRING"
          ? "0"
          : field.valueType === "BOOLEAN"
            ? true
            : field.valueType === "MIXED_ENUM"
              ? firstOption?.value ?? "CUSTOM"
              : firstOption?.value ?? "";

  return {
    operandType: "LITERAL",
    value: defaultValue,
  };
}

function getDefaultOperator(field: RuleFieldDefinition) {
  return field.supportedOperators.find((operator) => !NULL_OPERATORS.has(operator)) ??
    field.supportedOperators[0] ??
    "EQ";
}

function createConditionForField(
  fieldKey = "side",
  operator?: RuleOperator,
  value?: string | number | boolean | string[] | null,
): RuleCondition {
  const field = SUPPORTED_FIELDS[fieldKey] || SUPPORTED_FIELDS.side;
  const nextOperator = operator ?? getDefaultOperator(field);

  if (NULL_OPERATORS.has(nextOperator)) {
    return {
      nodeType: "CONDITION",
      leftField: field.key,
      operator: nextOperator as "IS_NULL" | "IS_NOT_NULL",
    };
  }

  const defaultOperand = buildRightOperand(field, nextOperator) as Extract<
    RuleOperand,
    { operandType: "LITERAL" }
  >;

  return {
    nodeType: "CONDITION",
    leftField: field.key,
    operator: nextOperator as Exclude<RuleOperator, "IS_NULL" | "IS_NOT_NULL">,
    rightOperand: {
      operandType: "LITERAL",
      value: value !== undefined ? value : defaultOperand.value,
    },
  };
}

class ApiRequestError extends Error {
  code?: string;
  status: number;
  errors?: Array<{ path: string; message: string }>;

  constructor(params: {
    message: string;
    code?: string;
    status: number;
    errors?: Array<{ path: string; message: string }>;
  }) {
    super(params.message);
    this.name = "ApiRequestError";
    this.code = params.code;
    this.status = params.status;
    this.errors = params.errors;
  }
}

async function apiRequest<T>(path: string, options: RequestInit = {}) {
  const response = await fetch(path, {
    ...options,
    credentials: "same-origin",
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });
  const data = await response.json().catch(() => null);

  if (!response.ok || data?.ok === false) {
    throw new ApiRequestError({
      status: response.status,
      code: data?.code,
      message: data?.message || "요청을 처리하지 못했습니다.",
      errors: data?.errors,
    });
  }

  return data?.data as T;
}

function getApiErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

function formatStoredValue(field: RuleFieldDefinition, value: unknown) {
  if (value === null || value === undefined || value === "") return "";

  if (field.input.storageUnit === "minutes" && typeof value === "number") {
    const hour = Math.floor(value / 60);
    const minute = value % 60;
    return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
  }

  if (field.input.storageUnit === "ratio" && typeof value === "number") {
    return String(Number((value * 100).toFixed(8)));
  }

  if (field.input.storageUnit === "ms" && typeof value === "number") {
    return String(Number((value / 1000).toFixed(3)));
  }

  return Array.isArray(value) ? value.join(", ") : String(value);
}

function parseInputValue(field: RuleFieldDefinition, rawValue: string) {
  const trimmed = rawValue.trim().replaceAll(",", "");

  if (field.input.storageUnit === "minutes") {
    const match = trimmed.match(/^([01]\d|2[0-3]):([0-5]\d)$/);
    if (!match) return NaN;
    return Number(match[1]) * 60 + Number(match[2]);
  }

  if (field.input.storageUnit === "ratio") {
    const numeric = Number(trimmed);
    return Number.isFinite(numeric) ? numeric / 100 : NaN;
  }

  if (field.input.storageUnit === "ms") {
    const numeric = Number(trimmed);
    return Number.isFinite(numeric) ? Math.round(numeric * 1000) : NaN;
  }

  if (field.valueType === "NUMBER") {
    const numeric = Number(trimmed);
    return Number.isFinite(numeric) ? numeric : NaN;
  }

  return trimmed;
}

function validateLiteralValue(field: RuleFieldDefinition, value: unknown) {
  if (field.valueType === "DECIMAL_STRING") {
    if (typeof value !== "string" || !/^\d+(\.\d+)?$/.test(value)) {
      return `${field.label}에는 숫자만 입력할 수 있어요.`;
    }
    return null;
  }

  if (field.valueType === "NUMBER") {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      return field.input.storageUnit === "minutes"
        ? `${field.label}을 24시간 형식으로 입력해 주세요.`
        : `${field.label}에는 숫자만 입력할 수 있어요.`;
    }
    if (field.input.min !== undefined && value < field.input.min) {
      if (field.input.storageUnit === "ratio") {
        return `${Number(field.input.min * 100)}% 이상으로 입력해 주세요.`;
      }
      return `${field.input.min} 이상으로 입력해 주세요.`;
    }
    if (field.input.max !== undefined && value > field.input.max) {
      if (field.input.storageUnit === "ratio") {
        return `${Number(field.input.max * 100)}% 이하로 입력해 주세요.`;
      }
      return `${field.input.max} 이하로 입력해 주세요.`;
    }
    if (
      (field.semanticType === "COUNT" || field.semanticType === "DURATION_MS") &&
      !Number.isInteger(value)
    ) {
      return field.semanticType === "COUNT"
        ? "횟수에는 0 이상의 정수만 입력할 수 있어요."
        : "시간은 밀리초 단위 정수로 저장되어야 해요.";
    }

    if (field.semanticType === "TIME_OF_DAY" && !Number.isInteger(value)) {
      return "시간은 00:00부터 23:59 사이로 입력해 주세요.";
    }
  }

  if (field.valueType === "MIXED_ENUM") {
    const allowed = new Set((field.input.options || []).map((option) => String(option.value)));
    if (value !== null && !allowed.has(String(value))) {
      return "정해진 주문 비율 버튼만 선택할 수 있어요.";
    }
  }

  return null;
}

function TypeAwareValueInput({
  field,
  condition,
  operand,
  onChange,
}: {
  field: RuleFieldDefinition;
  condition: RuleCondition;
  operand: Extract<RuleOperand, { operandType: "LITERAL" }>;
  onChange: (value: string | number | boolean | string[] | null) => void;
}) {
  const literalValue = operand.value;
  const [durationUnit, setDurationUnit] = useState<"MILLISECOND" | "SECOND" | "MINUTE">("SECOND");

  if (field.input.control === "BOOLEAN_SELECT") {
    return (
      <select
        value={String(literalValue)}
        onChange={(event) => onChange(event.target.value === "true")}
      >
        {(field.input.options || []).map((option) => (
          <option key={String(option.value)} value={String(option.value)}>
            {option.label}
          </option>
        ))}
      </select>
    );
  }

  if (
    field.input.control === "SELECT" ||
    field.input.control === "PRESET_SELECT"
  ) {
    return (
      <select
        value={String(literalValue)}
        onChange={(event) => {
          const option = field.input.options?.find(
            (item) => String(item.value) === event.target.value,
          );
          onChange(option?.value ?? event.target.value);
        }}
      >
        {(field.input.options || [])
          .filter((option) => !option.hiddenInPicker)
          .map((option) => (
            <option key={String(option.value)} value={String(option.value)}>
              {option.label}
            </option>
          ))}
      </select>
    );
  }

  if (field.input.control === "FLAG_MULTI_SELECT") {
    const values = Array.isArray(literalValue) ? literalValue.map(String) : [];
    return (
      <div className={styles.flagOptionList}>
        {(field.input.options || []).map((option) => {
          const optionValue = String(option.value);
          return (
            <label key={optionValue}>
              <input
                type="checkbox"
                checked={values.includes(optionValue)}
                onChange={(event) => {
                  const nextValues = event.target.checked
                    ? [...values, optionValue]
                    : values.filter((value) => value !== optionValue);
                  onChange(nextValues);
                }}
              />
              <span>{option.label}</span>
            </label>
          );
        })}
      </div>
    );
  }

  if (field.input.control === "MARKET_SELECT") {
    return (
      <input
        value={String(literalValue ?? "")}
        list="market-code-examples"
        placeholder="예: KRW-DOGE"
        pattern="^(KRW|BTC|USDT)-[A-Za-z0-9]+$"
        onChange={(event) => onChange(event.target.value.trim().toUpperCase())}
      />
    );
  }

  if (field.input.control === "COUNT_STEPPER") {
    const value = typeof literalValue === "number" ? literalValue : 0;
    return (
      <div className={styles.countStepper}>
        <button type="button" onClick={() => onChange(Math.max(0, value - 1))}>
          -
        </button>
        <input
          inputMode="numeric"
          value={String(literalValue ?? "")}
          onChange={(event) => {
            const nextValue = event.target.value;
            if (nextValue === "") {
              onChange(NaN);
              return;
            }
            if (/^\d+$/.test(nextValue)) {
              onChange(Number(nextValue));
            }
          }}
        />
        <button type="button" onClick={() => onChange(value + 1)}>
          +
        </button>
        <span>회</span>
      </div>
    );
  }

  if (field.input.control === "DURATION") {
    const divisor =
      durationUnit === "MINUTE"
        ? 60_000
        : durationUnit === "SECOND"
          ? 1000
          : 1;
    const displayValue =
      typeof literalValue === "number"
        ? String(Number((literalValue / divisor).toFixed(3)))
        : "";

    return (
      <div className={styles.durationInput}>
        <input
          inputMode="decimal"
          min={0}
          step={durationUnit === "MILLISECOND" ? 1 : 0.1}
          value={displayValue}
          onChange={(event) => {
            const numeric = Number(event.target.value);
            onChange(Number.isFinite(numeric) ? Math.round(numeric * divisor) : NaN);
          }}
        />
        <select
          value={durationUnit}
          onChange={(event) =>
            setDurationUnit(event.target.value as "MILLISECOND" | "SECOND" | "MINUTE")
          }
          aria-label="시간 단위"
        >
          <option value="MILLISECOND">밀리초</option>
          <option value="SECOND">초</option>
          <option value="MINUTE">분</option>
        </select>
      </div>
    );
  }

  if (field.input.control === "PERCENT") {
    const displayValue = formatStoredValue(field, literalValue);
    return (
      <div className={styles.percentInput}>
        <input
          inputMode="decimal"
          min={
            field.input.min !== undefined
              ? field.input.min * 100
              : undefined
          }
          max={
            field.input.max !== undefined
              ? field.input.max * 100
              : undefined
          }
          step={(field.input.step ?? 0.01) * 100}
          value={displayValue}
          onChange={(event) => onChange(parseInputValue(field, event.target.value))}
        />
        <span>%</span>
        {field.semanticType === "RATIO_0_TO_1" ? (
          <input
            type="range"
            min={0}
            max={100}
            step={1}
            value={Number(displayValue) || 0}
            onChange={(event) => onChange(Number(event.target.value) / 100)}
          />
        ) : null}
      </div>
    );
  }

  if (field.input.control === "TIME") {
    return (
      <input
        type="time"
        step={60}
        value={formatStoredValue(field, literalValue)}
        onChange={(event) => onChange(parseInputValue(field, event.target.value))}
      />
    );
  }

  const unit =
    field.input.displayUnit && condition.operator !== "EQ"
      ? field.input.displayUnit
      : field.input.displayUnit;

  return (
    <div className={styles.valueWithUnit}>
      <input
        inputMode={field.valueType === "DECIMAL_STRING" ? "decimal" : "text"}
        min={field.input.min}
        step={field.input.step}
        value={String(literalValue ?? "")}
        onChange={(event) =>
          onChange(
            field.valueType === "NUMBER"
              ? parseInputValue(field, event.target.value)
              : event.target.value.replaceAll(",", ""),
          )
        }
      />
      {unit ? <span>{unit}</span> : null}
    </div>
  );
}

function collectExpressionErrors(expression: RuleExpression): string[] {
  if (expression.nodeType === "GROUP") {
    if (expression.children.length === 0) {
      return ["조건을 하나 이상 추가해 주세요."];
    }

    return expression.children.flatMap(collectExpressionErrors);
  }

  const field =
    SUPPORTED_FIELDS[expression.leftField] ||
    SYSTEM_FIELDS[expression.leftField];

  if (!field?.ruleEligible) {
    return [`${field?.label || expression.leftField}은 현재 규칙에 사용할 수 없는 항목이에요.`];
  }

  if (!field.supportedOperators.includes(expression.operator)) {
    return [`${field.label}에 사용할 수 없는 조건이에요.`];
  }

  if (NULL_OPERATORS.has(expression.operator)) {
    return [];
  }

  if (!("rightOperand" in expression)) {
    return [`${field.label}의 값을 입력해 주세요.`];
  }

  if (expression.rightOperand.operandType === "FIELD") {
    const rightField = SUPPORTED_FIELDS[expression.rightOperand.field];
    if (
      !rightField ||
      !field.comparisonGroup ||
      field.comparisonGroup !== rightField.comparisonGroup
    ) {
      return ["의미가 같은 항목끼리만 비교할 수 있어요."];
    }
    return [];
  }

  const error = validateLiteralValue(field, expression.rightOperand.value);
  return error ? [error] : [];
}

function expressionUsesPrivateApi(expression: RuleExpression): boolean {
  if (expression.nodeType === "GROUP") {
    return expression.children.some(expressionUsesPrivateApi);
  }

  const leftField = SUPPORTED_FIELDS[expression.leftField];
  const rightField =
    "rightOperand" in expression && expression.rightOperand.operandType === "FIELD"
      ? SUPPORTED_FIELDS[expression.rightOperand.field]
      : null;

  return Boolean(leftField?.requiresPrivateApi || rightField?.requiresPrivateApi);
}

function RuleListCardContent({ rule }: { rule: UserGuardrailRuleDTO }) {
  return (
    <>
      <strong>{rule.name}</strong>
      <span>
        {rule.isEnabled ? "사용 중" : "꺼짐"} ·{" "}
        {RISK_LEVEL_META[rule.riskLevel].label}
      </span>
      {rule.requiresPrivateApi ? (
        <em>개인 API 연결 후 전체 조건 판정 가능</em>
      ) : null}
      <small>{buildExpressionPreview(rule.expression)}</small>
    </>
  );
}

function ChevronUpIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="m6 15 6-6 6 6" />
    </svg>
  );
}

function ChevronDownIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

function ConditionEditor({
  condition,
  path,
  onChange,
  onDelete,
  onDuplicate,
  onOpenFieldPicker,
}: {
  condition: RuleCondition;
  path: number[];
  onChange: (path: number[], next: RuleExpression) => void;
  onDelete: (path: number[]) => void;
  onDuplicate: (path: number[]) => void;
  onOpenFieldPicker: (path: number[], target: "left" | "right") => void;
}) {
  const field =
    SUPPORTED_FIELDS[condition.leftField] ||
    SYSTEM_FIELDS[condition.leftField] ||
    SUPPORTED_FIELDS.side;
  const isUnsupportedField = !field.ruleEligible;
  const operators = field.supportedOperators;
  const hasRightOperand = !NULL_OPERATORS.has(condition.operator);
  const rightOperand = "rightOperand" in condition ? condition.rightOperand : null;

  function patch(next: Partial<RuleCondition>) {
    onChange(path, { ...condition, ...next } as RuleExpression);
  }

  function changeOperator(operator: RuleOperator) {
    if (NULL_OPERATORS.has(operator)) {
      onChange(path, {
        nodeType: "CONDITION",
        leftField: condition.leftField,
        operator: operator as "IS_NULL" | "IS_NOT_NULL",
      });
      return;
    }

    onChange(path, {
      nodeType: "CONDITION",
      leftField: condition.leftField,
      operator: operator as Exclude<RuleOperator, "IS_NULL" | "IS_NOT_NULL">,
      rightOperand:
        rightOperand || buildRightOperand(field, operator),
    });
  }

  function changeLeftField(leftField: string) {
    const nextField = SUPPORTED_FIELDS[leftField];
    onChange(path, createConditionForField(leftField, getDefaultOperator(nextField)));
  }

  function renderOperand() {
    if (!hasRightOperand || !rightOperand) return null;

    if (rightOperand.operandType === "FIELD") {
      const compatibleFields = Object.entries(SUPPORTED_FIELDS).filter(
        ([, definition]) =>
          definition.comparisonGroup &&
          definition.comparisonGroup === field.comparisonGroup,
      );

      return (
        <label className={styles.ruleMiniField}>
          <span>다른 항목과 비교</span>
          <div className={styles.ruleInlineControls}>
            <select
              value={rightOperand.field}
              onChange={(event) =>
                patch({
                  rightOperand: {
                    operandType: "FIELD",
                    field: event.target.value,
                  },
                } as Partial<RuleCondition>)
              }
            >
              {compatibleFields.map(([key, definition]) => (
                  <option key={key} value={key}>
                    {definition.label}
                  </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => onOpenFieldPicker(path, "right")}
            >
              찾기
            </button>
          </div>
        </label>
      );
    }

    const literalError = validateLiteralValue(field, rightOperand.value);

    return (
      <label className={styles.ruleMiniField}>
        <span>값</span>
        <TypeAwareValueInput
          field={field}
          condition={condition}
          operand={rightOperand}
          onChange={(value) =>
            patch({
              rightOperand: {
                operandType: "LITERAL",
                value,
              },
            } as Partial<RuleCondition>)
          }
        />
        {literalError ? (
          <small className={styles.ruleInputError}>{literalError}</small>
        ) : null}
      </label>
    );
  }

  const naturalSentence = buildConditionSentence(condition);

  return (
    <div
      className={`${styles.ruleCondition} ${
        isUnsupportedField ? styles.ruleConditionError : ""
      }`}
    >
      <label className={styles.ruleMiniField}>
        <span>항목</span>
        <div className={styles.ruleInlineControls}>
          <select
            value={condition.leftField}
            onChange={(event) => changeLeftField(event.target.value)}
          >
            {Object.entries(SUPPORTED_FIELDS).map(([key, definition]) => (
              <option key={key} value={key}>
                {definition.label}
              </option>
            ))}
            {isUnsupportedField ? (
              <option value={condition.leftField}>{field.label}</option>
            ) : null}
          </select>
          <button type="button" onClick={() => onOpenFieldPicker(path, "left")}>
            찾기
          </button>
        </div>
        {isUnsupportedField ? (
          <small className={styles.ruleInputError}>
            현재 규칙에 사용할 수 없는 항목이에요. 다른 항목으로 바꿔 주세요.
          </small>
        ) : null}
      </label>
      <label className={styles.ruleMiniField}>
        <span>조건</span>
        <select
          value={condition.operator}
          onChange={(event) => changeOperator(event.target.value as RuleOperator)}
        >
          {operators.map((operator) => (
            <option key={operator} value={operator}>
              {getOperatorLabel(field, operator)}
            </option>
          ))}
        </select>
      </label>
      {hasRightOperand && rightOperand ? (
        <label className={styles.ruleMiniField}>
          <span>입력 방식</span>
          <select
            value={rightOperand.operandType}
            onChange={(event) => {
              const operandType = event.target.value as RuleOperand["operandType"];
              const compatibleField = Object.entries(SUPPORTED_FIELDS).find(
                ([, definition]) =>
                  definition.comparisonGroup &&
                  definition.comparisonGroup === field.comparisonGroup,
              )?.[0];
              patch({
                rightOperand:
                  operandType === "FIELD"
                    ? {
                        operandType: "FIELD",
                        field: compatibleField || condition.leftField,
                      }
                    : buildRightOperand(field, condition.operator),
              } as Partial<RuleCondition>);
            }}
          >
            <option value="LITERAL">직접 입력</option>
            <option value="FIELD">다른 항목과 비교</option>
          </select>
        </label>
      ) : null}
      {renderOperand()}
      <div className={styles.ruleNodeActions}>
        <button type="button" onClick={() => onDuplicate(path)}>
          복제
        </button>
        <button type="button" onClick={() => onDelete(path)}>
          삭제
        </button>
      </div>
      <p className={styles.conditionPreview}>{naturalSentence}</p>
      {field.requiresPrivateApi ? (
        <p className={styles.privateApiNote}>
          이 조건은 업비트 개인 API가 연결되면 자동으로 판정을 시작해요.
          지금 규칙을 먼저 만들어둘 수 있습니다.
        </p>
      ) : null}
    </div>
  );
}

function ExpressionEditor({
  expression,
  path,
  onChange,
  onDelete,
  onDuplicate,
  onOpenFieldPicker,
}: {
  expression: RuleExpression;
  path: number[];
  onChange: (path: number[], next: RuleExpression) => void;
  onDelete: (path: number[]) => void;
  onDuplicate: (path: number[]) => void;
  onOpenFieldPicker: (path: number[], target: "left" | "right") => void;
}) {
  if (expression.nodeType === "CONDITION") {
    return (
      <ConditionEditor
        condition={expression}
        path={path}
        onChange={onChange}
        onDelete={onDelete}
        onDuplicate={onDuplicate}
        onOpenFieldPicker={onOpenFieldPicker}
      />
    );
  }

  return (
    <div className={styles.ruleGroup}>
      <div className={styles.ruleGroupHeader}>
        <div className={styles.segmentedControl}>
          {(["AND", "OR"] as const).map((operator) => (
            <button
              key={operator}
              type="button"
              className={expression.operator === operator ? styles.isSelected : ""}
              onClick={() =>
                onChange(path, {
                  ...expression,
                  operator,
                })
              }
            >
              {operator === "AND"
                ? "모든 조건을 만족할 때"
                : "조건 중 하나라도 만족할 때"}
            </button>
          ))}
        </div>
        <div className={styles.ruleNodeActions}>
          <button type="button" onClick={() => onChange(path, {
            ...expression,
            children: [...expression.children, createCondition()],
          })}>
            + 조건 추가
          </button>
          <button type="button" onClick={() => onChange(path, {
            ...expression,
            children: [...expression.children, createGroup()],
          })}>
            조건 묶음 추가
          </button>
          {path.length > 0 ? (
            <button type="button" onClick={() => onDelete(path)}>
              그룹 삭제
            </button>
          ) : null}
        </div>
      </div>
      <div className={styles.ruleGroupChildren}>
        {expression.children.map((child, index) => (
          <ExpressionEditor
            key={`${path.join(".")}-${index}`}
            expression={child}
            path={[...path, index]}
            onChange={onChange}
            onDelete={onDelete}
            onDuplicate={onDuplicate}
            onOpenFieldPicker={onOpenFieldPicker}
          />
        ))}
      </div>
    </div>
  );
}

export default function MyPage({
  initialProfile,
  initialRules,
}: {
  initialProfile: Profile;
  initialRules: UserGuardrailRuleDTO[];
}) {
  const [profile, setProfile] = useState(initialProfile);
  const [rules, setRules] = useState(initialRules);
  const [selectedRuleId, setSelectedRuleId] = useState<string | null>(
    initialRules[0]?.ruleId ?? null,
  );
  const [draft, setDraft] = useState<DraftRule>(
    initialRules[0] ? toDraft(initialRules[0]) : createDraftRule(1),
  );
  const [displayName, setDisplayName] = useState(
    initialProfile.displayName ?? "",
  );
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newPasswordConfirm, setNewPasswordConfirm] = useState("");
  const [profileStatus, setProfileStatus] = useState<{
    type: "success" | "error";
    message: string;
  } | null>(null);
  const [ruleStatus, setRuleStatus] = useState<StatusMessage | null>(null);
  const [orderStatus, setOrderStatus] = useState<StatusMessage | null>(null);
  const [isProfileSaving, setIsProfileSaving] = useState(false);
  const [isRuleSaving, setIsRuleSaving] = useState(false);
  const [isOrderSaving, setIsOrderSaving] = useState(false);
  const [isOrderAnimating, setIsOrderAnimating] = useState(false);
  const [jsonText, setJsonText] = useState("");
  const [visualPickerOpen, setVisualPickerOpen] = useState(false);
  const [savedOrderRuleIds, setSavedOrderRuleIds] = useState(
    initialRules.map((rule) => rule.ruleId),
  );
  const [fieldPicker, setFieldPicker] = useState<{
    path: number[];
    target: "left" | "right";
  } | null>(null);
  const rulesRef = useRef(rules);
  const ruleItemRefs = useRef(new Map<string, HTMLElement>());
  const [fieldSearch, setFieldSearch] = useState("");
  const [fieldCategory, setFieldCategory] = useState<RuleFieldDefinition["category"] | "ALL">("ALL");
  const selectedRule = useMemo(
    () => rules.find((rule) => rule.ruleId === selectedRuleId) ?? null,
    [rules, selectedRuleId],
  );
  const expressionErrors = useMemo(
    () => collectExpressionErrors(draft.expression),
    [draft.expression],
  );
  const usesPrivateApi = useMemo(
    () => expressionUsesPrivateApi(draft.expression),
    [draft.expression],
  );
  const fieldPickerNode = useMemo(
    () =>
      fieldPicker
        ? getExpressionAtPath(draft.expression, fieldPicker.path)
        : null,
    [draft.expression, fieldPicker],
  );
  const rightOperandComparisonGroup =
    fieldPicker?.target === "right" && fieldPickerNode?.nodeType === "CONDITION"
      ? SUPPORTED_FIELDS[fieldPickerNode.leftField]?.comparisonGroup
      : null;
  const wantsPasswordChange = Boolean(
    currentPassword || newPassword || newPasswordConfirm,
  );
  const isProfileDirty =
    displayName.trim() !== (profile.displayName ?? "") || wantsPasswordChange;
  const isDraftDirty = useMemo(() => {
    if (!draft.ruleId) return true;
    const savedRule = rules.find((rule) => rule.ruleId === draft.ruleId);
    if (!savedRule) return true;
    return (
      JSON.stringify(serializeRule(draft)) !==
      JSON.stringify(serializeRule(toDraft(savedRule)))
    );
  }, [draft, rules]);
  const orderDirty = useMemo(
    () =>
      rules.map((rule) => rule.ruleId).join("\u001f") !==
      savedOrderRuleIds.join("\u001f"),
    [rules, savedOrderRuleIds],
  );

  useEffect(() => {
    rulesRef.current = rules;
  }, [rules]);

  useEffect(() => {
    if (ruleStatus?.type !== "success") return;
    const timeoutId = window.setTimeout(() => setRuleStatus(null), 4000);
    return () => window.clearTimeout(timeoutId);
  }, [ruleStatus]);

  useEffect(() => {
    if (orderStatus?.type !== "success") return;
    const timeoutId = window.setTimeout(() => setOrderStatus(null), 4000);
    return () => window.clearTimeout(timeoutId);
  }, [orderStatus]);

  function selectRule(rule: UserGuardrailRuleDTO) {
    setSelectedRuleId(rule.ruleId);
    setDraft(toDraft(rule));
    setRuleStatus(null);
  }

  function createNewRule() {
    setSelectedRuleId(null);
    setDraft(createDraftRule(rules.length + 1));
    setRuleStatus(null);
  }

  function updateDraft(patch: Partial<DraftRule>) {
    setDraft((current) => ({ ...current, ...patch }));
  }

  function updateExpression(path: number[], next: RuleExpression) {
    setDraft((current) => ({
      ...current,
      expression: updateAtPath(current.expression, path, () => next),
    }));
  }

  function duplicateExpression(path: number[]) {
    setDraft((current) => {
      const source = getExpressionAtPath(current.expression, path);

      if (!source || path.length === 0) return current;

      const parentPath = path.slice(0, -1);
      return {
        ...current,
        expression: insertChild(
          current.expression,
          parentPath,
          cloneExpression(source),
        ),
      };
    });
  }

  function chooseField(field: string) {
    if (!fieldPicker) return;
    if (
      fieldPicker.target === "right" &&
      rightOperandComparisonGroup &&
      SUPPORTED_FIELDS[field].comparisonGroup !== rightOperandComparisonGroup
    ) {
      return;
    }

    setDraft((current) => ({
      ...current,
      expression: updateAtPath(current.expression, fieldPicker.path, (node) => {
        if (node.nodeType !== "CONDITION") return node;

        if (fieldPicker.target === "left") {
          const nextField = SUPPORTED_FIELDS[field];
          return createConditionForField(field, getDefaultOperator(nextField));
        }

        if (!("rightOperand" in node) || NULL_OPERATORS.has(node.operator)) {
          return node;
        }

        return {
          ...node,
          rightOperand: {
            operandType: "FIELD",
            field,
          },
        };
      }),
    }));
    setFieldPicker(null);
  }

  function chooseRecommendedSituation(item: (typeof RECOMMENDED_SITUATIONS)[number]) {
    if (!fieldPicker) return;

    setDraft((current) => ({
      ...current,
      expression: updateAtPath(current.expression, fieldPicker.path, (node) => {
        if (node.nodeType !== "CONDITION") return node;
        return createConditionForField(item.field, item.operator, item.value);
      }),
    }));
    setFieldPicker(null);
  }

  function withNormalizedPriorities(nextRules: UserGuardrailRuleDTO[]) {
    return nextRules.map((rule, index) => ({
      ...rule,
      priority: index + 1,
    }));
  }

  function setRuleItemRef(ruleId: string, node: HTMLElement | null) {
    if (node) {
      ruleItemRefs.current.set(ruleId, node);
      return;
    }
    ruleItemRefs.current.delete(ruleId);
  }

  function syncDraftPriority(nextRules: UserGuardrailRuleDTO[]) {
    setDraft((current) => {
      if (!current.ruleId) return current;
      const nextRule = nextRules.find((rule) => rule.ruleId === current.ruleId);
      return nextRule ? { ...current, priority: nextRule.priority } : current;
    });
  }

  function applyLocalRuleOrder(nextRules: UserGuardrailRuleDTO[]) {
    const normalizedRules = withNormalizedPriorities(nextRules);
    rulesRef.current = normalizedRules;
    setRules(normalizedRules);
    syncDraftPriority(normalizedRules);
    setOrderStatus(null);
  }

  async function persistRulePriorities(nextRules: UserGuardrailRuleDTO[]) {
    return apiRequest<UserGuardrailRuleDTO[]>("/api/me/guardrail-rules/reorder", {
      method: "POST",
      body: JSON.stringify({
        ruleIds: nextRules.map((rule) => rule.ruleId),
      }),
    });
  }

  function prefersReducedMotion() {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }

  function captureRuleRects() {
    return new Map(
      Array.from(ruleItemRefs.current.entries()).map(([ruleId, node]) => [
        ruleId,
        node.getBoundingClientRect(),
      ]),
    );
  }

  function animateRuleSwap(previousRects: Map<string, DOMRect>) {
    if (prefersReducedMotion()) {
      setIsOrderAnimating(false);
      return;
    }

    window.requestAnimationFrame(() => {
      const animations = Array.from(ruleItemRefs.current.entries()).flatMap(
        ([ruleId, node]) => {
          const previousRect = previousRects.get(ruleId);
          if (!previousRect) return [];
          const nextRect = node.getBoundingClientRect();
          const deltaY = previousRect.top - nextRect.top;
          if (Math.abs(deltaY) < 1) return [];

          return [
            node.animate(
              [
                { transform: `translate3d(0, ${deltaY}px, 0)` },
                { transform: "translate3d(0, 0, 0)" },
              ],
              {
                duration: 220,
                easing: "cubic-bezier(0.2, 0, 0, 1)",
              },
            ),
          ];
        },
      );

      if (animations.length === 0) {
        setIsOrderAnimating(false);
        return;
      }

      void Promise.allSettled(animations.map((animation) => animation.finished))
        .then(() => setIsOrderAnimating(false));
    });
  }

  function moveRuleByOffset(ruleId: string, offset: number) {
    if (isOrderSaving || isOrderAnimating) return;

    const currentRules = rulesRef.current;
    const currentIndex = currentRules.findIndex((rule) => rule.ruleId === ruleId);
    const targetIndex = currentIndex + offset;
    if (currentIndex < 0 || targetIndex < 0 || targetIndex >= currentRules.length) {
      return;
    }

    const nextRules = [...currentRules];
    [nextRules[currentIndex], nextRules[targetIndex]] = [
      nextRules[targetIndex],
      nextRules[currentIndex],
    ];
    const previousRects = captureRuleRects();
    setIsOrderAnimating(true);
    applyLocalRuleOrder(nextRules);
    animateRuleSwap(previousRects);
  }

  function restoreSavedRuleOrder() {
    const currentRules = rulesRef.current;
    const savedIndexById = new Map(
      savedOrderRuleIds.map((ruleId, index) => [ruleId, index]),
    );
    const restoredRules = [...currentRules].sort((left, right) => {
      const leftIndex = savedIndexById.get(left.ruleId) ?? Number.MAX_SAFE_INTEGER;
      const rightIndex = savedIndexById.get(right.ruleId) ?? Number.MAX_SAFE_INTEGER;
      return leftIndex - rightIndex || left.priority - right.priority;
    });
    applyLocalRuleOrder(restoredRules);
    setOrderStatus(null);
  }

  async function saveRuleOrder() {
    if (!orderDirty || isOrderSaving || isOrderAnimating) return;

    const normalizedRules = withNormalizedPriorities(rulesRef.current);
    setIsOrderSaving(true);
    setOrderStatus(null);

    try {
      const savedRules = await persistRulePriorities(normalizedRules);
      const nextRules = withNormalizedPriorities(savedRules);
      applyLocalRuleOrder(nextRules);
      setSavedOrderRuleIds(nextRules.map((rule) => rule.ruleId));
      setOrderStatus({
        type: "success",
        message: "규칙 순서가 저장되었습니다.",
      });
    } catch (error) {
      setOrderStatus({
        type: "error",
        message: getApiErrorMessage(error, "규칙 순서를 저장하지 못했습니다."),
      });
    } finally {
      setIsOrderSaving(false);
    }
  }

  function handleRuleCardClick(rule: UserGuardrailRuleDTO) {
    selectRule(rule);
  }

  async function saveProfile() {
    setProfileStatus(null);
    const body: Record<string, string> = {};
    const changingPassword = wantsPasswordChange;

    if (displayName.trim() !== (profile.displayName ?? "")) {
      body.displayName = displayName.trim();
    }

    if (changingPassword) {
      if (!currentPassword) {
        setProfileStatus({
          type: "error",
          message: "현재 비밀번호를 입력해 주세요.",
        });
        return;
      }

      if (newPassword.length < 8) {
        setProfileStatus({
          type: "error",
          message: "새 비밀번호는 8자 이상이어야 합니다.",
        });
        return;
      }

      if (newPassword !== newPasswordConfirm) {
        setProfileStatus({
          type: "error",
          message: "새 비밀번호가 일치하지 않습니다.",
        });
        return;
      }

      body.currentPassword = currentPassword;
      body.newPassword = newPassword;
    }

    if (Object.keys(body).length === 0) {
      setProfileStatus({
        type: "error",
        message: "변경된 계정 정보가 없습니다.",
      });
      return;
    }

    setIsProfileSaving(true);

    try {
      const nextProfile = await apiRequest<Profile>("/api/me/profile", {
        method: "PATCH",
        body: JSON.stringify(body),
      });
      setProfile(nextProfile);
      setDisplayName(nextProfile.displayName ?? "");
      setCurrentPassword("");
      setNewPassword("");
      setNewPasswordConfirm("");
      setProfileStatus({
        type: "success",
        message:
          changingPassword && body.displayName
            ? "계정 정보와 비밀번호가 저장되었습니다."
            : changingPassword
              ? "비밀번호가 변경되었습니다."
              : "계정 정보가 저장되었습니다.",
      });
    } catch (error) {
      const message =
        changingPassword &&
        error instanceof ApiRequestError &&
        (error.status === 401 ||
          error.message.includes("비밀번호가 올바르지 않습니다") ||
          error.message.includes("이메일 또는 비밀번호가 올바르지 않습니다"))
          ? "현재 비밀번호가 올바르지 않습니다."
          : getApiErrorMessage(error, "계정 정보를 저장하지 못했습니다.");
      setProfileStatus({
        type: "error",
        message,
      });
    } finally {
      setIsProfileSaving(false);
    }
  }

  async function saveRule() {
    setRuleStatus(null);

    try {
      if (expressionErrors.length > 0) {
        setRuleStatus({
          type: "error",
          message: expressionErrors[0],
        });
        return;
      }

      const isExistingRule = Boolean(draft.ruleId);
      const body = serializeRule(draft, { includePriority: !isExistingRule });
      setIsRuleSaving(true);
      const savedRule = isExistingRule
        ? await apiRequest<UserGuardrailRuleDTO>(
            `/api/me/guardrail-rules/${draft.ruleId}`,
            {
              method: "PATCH",
              body: JSON.stringify(body),
            },
          )
        : await apiRequest<UserGuardrailRuleDTO>("/api/me/guardrail-rules", {
            method: "POST",
            body: JSON.stringify(body),
          });

      const currentRules = rulesRef.current;
      const existingRule = currentRules.find(
        (rule) => rule.ruleId === savedRule.ruleId,
      );
      const localSavedRule = {
        ...savedRule,
        priority: existingRule?.priority ?? currentRules.length + 1,
      };
      const nextRules = withNormalizedPriorities(
        existingRule
          ? currentRules.map((rule) =>
              rule.ruleId === savedRule.ruleId ? localSavedRule : rule,
            )
          : [...currentRules, localSavedRule],
      );

      rulesRef.current = nextRules;
      setRules(nextRules);
      if (!existingRule) {
        setSavedOrderRuleIds((current) => [...current, savedRule.ruleId]);
      }
      setSelectedRuleId(savedRule.ruleId);
      setDraft(
        toDraft(
          nextRules.find((rule) => rule.ruleId === savedRule.ruleId) ??
            localSavedRule,
        ),
      );
      setRuleStatus({
        type: "success",
        message: "규칙이 저장되었습니다.",
      });
    } catch (error) {
      setRuleStatus({
        type: "error",
        message: getApiErrorMessage(error, "규칙 저장 실패"),
      });
    } finally {
      setIsRuleSaving(false);
    }
  }

  async function deleteRule() {
    if (!draft.ruleId) return;
    if (!window.confirm("이 규칙을 삭제할까요?")) return;

    try {
      await apiRequest<null>(`/api/me/guardrail-rules/${draft.ruleId}`, {
        method: "DELETE",
      });
      const deletedRuleId = draft.ruleId;
      const nextRules = withNormalizedPriorities(
        rulesRef.current.filter((rule) => rule.ruleId !== deletedRuleId),
      );
      rulesRef.current = nextRules;
      setRules(nextRules);
      setSavedOrderRuleIds((current) =>
        current.filter((ruleId) => ruleId !== deletedRuleId),
      );
      setSelectedRuleId(nextRules[0]?.ruleId ?? null);
      setDraft(nextRules[0] ? toDraft(nextRules[0]) : createDraftRule(1));
      setRuleStatus({
        type: "success",
        message: "규칙을 삭제했습니다.",
      });
    } catch (error) {
      setRuleStatus({
        type: "error",
        message: getApiErrorMessage(error, "규칙 삭제에 실패했습니다."),
      });
    }
  }

  function importJson() {
    try {
      const parsed = JSON.parse(jsonText);
      const expression = parsed.expression ?? parsed;

      if (!expression?.nodeType) {
        throw new Error("expression JSON을 찾지 못했습니다.");
      }

      setDraft((current) => ({
        ...current,
        name: parsed.name ?? current.name,
        description: parsed.description ?? current.description,
        isEnabled: parsed.isEnabled ?? current.isEnabled,
        priority: parsed.priority ?? current.priority,
        riskLevel: parsed.riskLevel ?? current.riskLevel,
        visualMode: parsed.visualMode ?? current.visualMode,
        warningTitle: parsed.warningTitle ?? current.warningTitle,
        warningMessage: parsed.warningMessage ?? current.warningMessage,
        expression,
      }));
      setRuleStatus({
        type: "success",
        message: "JSON을 편집기에 불러왔습니다.",
      });
    } catch (error) {
      setRuleStatus({
        type: "error",
        message: getApiErrorMessage(error, "JSON import 실패"),
      });
    }
  }

  return (
    <>
      <datalist id="market-code-examples">
        <option value="KRW-BTC" />
        <option value="KRW-ETH" />
        <option value="KRW-DOGE" />
        <option value="BTC-ETH" />
        <option value="USDT-BTC" />
      </datalist>
      <PageHeader
        eyebrow="My Page"
        title="나만의 투자 가드레일 만들기"
        description="어떤 상황에서 한 번 더 확인할지 조건을 정해보세요."
      />

      <div className={styles.myPageGrid}>
        <section className={`${styles.panel} ${styles.profilePanel}`}>
          <header className={styles.panelHeader}>
            <div className={styles.panelTitleGroup}>
              <span className={styles.panelIcon}>
                <UserIcon />
              </span>
              <h2 className={styles.panelTitle}>내 계정</h2>
            </div>
            <span className={styles.panelMeta}>
              {profile.email ?? "이메일 없음"}
            </span>
          </header>
          <div className={styles.profileForm}>
            <label>
              <span>닉네임</span>
              <input
                value={displayName}
                minLength={2}
                maxLength={20}
                onChange={(event) => setDisplayName(event.target.value)}
              />
            </label>
            <label>
              <span>현재 비밀번호</span>
              <input
                type="password"
                value={currentPassword}
                autoComplete="current-password"
                onChange={(event) => setCurrentPassword(event.target.value)}
              />
            </label>
            <label>
              <span>새 비밀번호</span>
              <input
                type="password"
                value={newPassword}
                autoComplete="new-password"
                onChange={(event) => setNewPassword(event.target.value)}
              />
            </label>
            <label>
              <span>새 비밀번호 확인</span>
              <input
                type="password"
                value={newPasswordConfirm}
                autoComplete="new-password"
                onChange={(event) => setNewPasswordConfirm(event.target.value)}
              />
            </label>
            <button
              type="button"
              onClick={saveProfile}
              disabled={!isProfileDirty || isProfileSaving}
            >
              {isProfileSaving ? "저장 중" : "저장"}
            </button>
            {profileStatus ? (
              <p
                className={`${styles.inlineStatus} ${
                  profileStatus.type === "success"
                    ? styles.inlineStatusSuccess
                    : styles.inlineStatusError
                }`}
                role={profileStatus.type === "error" ? "alert" : "status"}
              >
                <span aria-hidden="true">
                  {profileStatus.type === "success" ? "✓" : "!"}
                </span>
                {profileStatus.message}
              </p>
            ) : null}
          </div>
        </section>

        <section className={`${styles.panel} ${styles.ruleWorkbench}`}>
          <header className={styles.panelHeader}>
            <div className={styles.panelTitleGroup}>
              <span className={styles.panelIcon}>
                <GuardrailIcon />
              </span>
              <h2 className={styles.panelTitle}>규칙 만들기</h2>
            </div>
            <button className={styles.panelLinkButton} type="button" onClick={createNewRule}>
              새 규칙
            </button>
          </header>

          <div className={styles.ruleLayout}>
            <aside className={styles.ruleList}>
              {rules.length === 0 ? (
                <p>아직 저장된 규칙이 없습니다.</p>
              ) : (
                rules.map((rule, index) => {
                  const isFirst = index === 0;
                  const isLast = index === rules.length - 1;
                  const disableMoveButtons = isOrderSaving || isOrderAnimating;

                  return (
                  <article
                    key={rule.ruleId}
                    ref={(node) => setRuleItemRef(rule.ruleId, node)}
                    aria-current={
                      selectedRule?.ruleId === rule.ruleId ? "true" : undefined
                    }
                    className={`${styles.ruleListItem} ${
                      selectedRule?.ruleId === rule.ruleId
                        ? styles.ruleListItemActive
                        : ""
                    } ${!rule.isEnabled ? styles.ruleListItemDisabled : ""}`}
                  >
                    <button
                      type="button"
                      className={styles.ruleListButton}
                      onClick={() => handleRuleCardClick(rule)}
                    >
                      <RuleListCardContent rule={rule} />
                    </button>
                    <span className={styles.ruleMoveActions}>
                      <button
                        type="button"
                        aria-label="규칙 위로 이동"
                        disabled={isFirst || disableMoveButtons}
                        onClick={() => moveRuleByOffset(rule.ruleId, -1)}
                      >
                        <ChevronUpIcon />
                      </button>
                      <button
                        type="button"
                        aria-label="규칙 아래로 이동"
                        disabled={isLast || disableMoveButtons}
                        onClick={() => moveRuleByOffset(rule.ruleId, 1)}
                      >
                        <ChevronDownIcon />
                      </button>
                    </span>
                  </article>
                  );
                })
              )}
              {orderDirty ? (
                <div className={styles.ruleOrderPrompt}>
                  <strong>규칙 순서가 변경되었습니다.</strong>
                  <p>
                    {isOrderSaving
                      ? "순서를 저장하는 중입니다."
                      : "이 순서를 저장할까요?"}
                  </p>
                  <div className={styles.ruleOrderActions}>
                    <button
                      type="button"
                      className={styles.ruleOrderPrimaryButton}
                      onClick={saveRuleOrder}
                      disabled={isOrderSaving || isOrderAnimating}
                    >
                      {isOrderSaving ? "저장 중" : "순서 저장"}
                    </button>
                    <button
                      type="button"
                      onClick={restoreSavedRuleOrder}
                      disabled={isOrderSaving || isOrderAnimating}
                    >
                      변경 취소
                    </button>
                  </div>
                </div>
              ) : orderStatus ? (
                <p
                  className={`${styles.inlineStatus} ${
                    orderStatus.type === "success"
                      ? styles.inlineStatusSuccess
                      : styles.inlineStatusError
                  } ${styles.ruleOrderStatus}`}
                  role={orderStatus.type === "error" ? "alert" : "status"}
                >
                  <span aria-hidden="true">
                    {orderStatus.type === "success" ? "✓" : "!"}
                  </span>
                  {orderStatus.message}
                </p>
              ) : null}
            </aside>

            <div className={styles.ruleEditor}>
              <div className={styles.ruleMetaGrid}>
                <label>
                  <span>규칙 이름</span>
                  <input
                    value={draft.name}
                    onChange={(event) => updateDraft({ name: event.target.value })}
                  />
                </label>
                <label>
                  <span>규칙 설명</span>
                  <input
                    value={draft.description ?? ""}
                    onChange={(event) =>
                      updateDraft({ description: event.target.value })
                    }
                  />
                </label>
                <div className={styles.ruleMetaSection}>
                  <span>위험도</span>
                  <div className={styles.riskChoiceGrid}>
                    {(Object.keys(RISK_LEVEL_META) as RiskLevel[]).map((riskLevel) => (
                      <button
                        key={riskLevel}
                        type="button"
                        className={
                          draft.riskLevel === riskLevel ? styles.riskChoiceSelected : ""
                        }
                        data-risk-level={riskLevel}
                        onClick={() => updateDraft({ riskLevel })}
                      >
                        <strong>{RISK_LEVEL_META[riskLevel].label}</strong>
                        <small>{RISK_LEVEL_META[riskLevel].description}</small>
                      </button>
                    ))}
                  </div>
                </div>
                <div className={styles.ruleMetaSection}>
                  <span>불꽃 모드</span>
                  <button
                    type="button"
                    className={styles.visualModeSummary}
                    onClick={() => setVisualPickerOpen(true)}
                  >
                    <span className={styles.visualModePreview} aria-hidden="true">
                      <FlameMascot
                        mode={VISUAL_MODE_META[draft.visualMode].animationMode}
                        size="100%"
                        speed={draft.visualMode === "FAST_BURN" ? "fast" : "slow"}
                      />
                    </span>
                    <span className={styles.visualModeSummaryCopy}>
                      <strong>{VISUAL_MODE_META[draft.visualMode].label}</strong>
                      <span className={styles.visualModeSummaryKeywords}>
                        {VISUAL_MODE_META[draft.visualMode].keywords.join(" · ")}
                      </span>
                      <small>{VISUAL_MODE_META[draft.visualMode].description}</small>
                    </span>
                  </button>
                </div>
                <div className={styles.ruleMetaSection}>
                  <span>규칙 활성화</span>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={draft.isEnabled}
                    aria-label="규칙 활성화 상태"
                    className={`${styles.ruleSwitch} ${
                      draft.isEnabled ? styles.ruleSwitchOn : ""
                    }`}
                    onClick={() => updateDraft({ isEnabled: !draft.isEnabled })}
                  >
                    <span aria-hidden="true" />
                    <strong>{draft.isEnabled ? "사용 중" : "사용 안 함"}</strong>
                  </button>
                </div>
              </div>

              <div className={styles.warningEditor}>
                <label>
                  <span>경고 제목</span>
                  <input
                    value={draft.warningTitle}
                    onChange={(event) =>
                      updateDraft({ warningTitle: event.target.value })
                    }
                  />
                </label>
                <label>
                  <span>경고 메시지</span>
                  <textarea
                    value={draft.warningMessage}
                    onChange={(event) =>
                      updateDraft({ warningMessage: event.target.value })
                    }
                  />
                </label>
              </div>

              <ExpressionEditor
                expression={draft.expression}
                path={[]}
                onChange={updateExpression}
                onDelete={(path) =>
                  updateDraft({
                    expression: removeAtPath(draft.expression, path),
                  })
                }
                onDuplicate={duplicateExpression}
                onOpenFieldPicker={(path, target) =>
                  setFieldPicker({ path, target })
                }
              />

              <div className={styles.naturalPreview}>
                <strong>규칙 미리보기</strong>
                <p>{buildExpressionPreview(draft.expression)}</p>
                {usesPrivateApi ? (
                  <small>
                    이 규칙은 내 평균 매수가 또는 실제 주문 내역을 사용해요.
                    개인 API를 연결하면 자동으로 판정을 시작합니다.
                  </small>
                ) : null}
                {expressionErrors[0] ? (
                  <small className={styles.ruleInputError}>
                    {expressionErrors[0]}
                  </small>
                ) : null}
              </div>

              <div className={styles.ruleJsonTools}>
                <textarea
                  value={jsonText}
                  placeholder="규칙 JSON 또는 expression JSON을 붙여넣으세요."
                  onChange={(event) => setJsonText(event.target.value)}
                />
                <div>
                  <button type="button" onClick={importJson}>
                    JSON import
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      setJsonText(
                        JSON.stringify(
                          serializeRule(draft, { includePriority: true }),
                          null,
                          2,
                        ),
                      )
                    }
                  >
                    JSON export
                  </button>
                </div>
              </div>

              {ruleStatus ? (
                <div className={styles.ruleEditorStatusWrap}>
                  <p
                    className={`${styles.inlineStatus} ${
                      ruleStatus.type === "success"
                        ? styles.inlineStatusSuccess
                        : styles.inlineStatusError
                    } ${styles.ruleEditorStatus}`}
                    role={ruleStatus.type === "error" ? "alert" : "status"}
                  >
                    <span aria-hidden="true">
                      {ruleStatus.type === "success" ? "✓" : "!"}
                    </span>
                    {ruleStatus.message}
                  </p>
                </div>
              ) : null}

              <div className={styles.ruleEditorActions}>
                <button
                  type="button"
                  onClick={saveRule}
                  disabled={
                    expressionErrors.length > 0 ||
                    isRuleSaving ||
                    !isDraftDirty
                  }
                >
                  {isRuleSaving ? "저장 중" : "규칙 저장"}
                </button>
                {draft.ruleId ? (
                  <button
                    type="button"
                    className={styles.ruleDeleteButton}
                    onClick={deleteRule}
                    disabled={isRuleSaving}
                  >
                    삭제
                  </button>
                ) : null}
              </div>
            </div>
          </div>
        </section>
      </div>

      {visualPickerOpen ? (
        <div className={styles.fieldPickerBackdrop} role="dialog" aria-modal="true">
          <div className={`${styles.fieldPicker} ${styles.visualModePicker}`}>
            <header>
              <div>
                <span>불꽃 모드</span>
                <strong>어떤 불꽃으로 알려줄까요?</strong>
                <p>확장 프로그램에서 실제로 사용하는 애니메이션과 표시명을 기준으로 선택합니다.</p>
              </div>
              <button type="button" onClick={() => setVisualPickerOpen(false)}>
                닫기
              </button>
            </header>
            <div className={styles.visualModeGrid}>
              {(Object.keys(VISUAL_MODE_META) as VisualMode[]).map((visualMode) => {
                const meta = VISUAL_MODE_META[visualMode];
                const isSelected = draft.visualMode === visualMode;

                return (
                  <button
                    key={visualMode}
                    type="button"
                    className={isSelected ? styles.visualModeCardSelected : ""}
                    onClick={() => {
                      updateDraft({ visualMode });
                      setVisualPickerOpen(false);
                    }}
                  >
                    <span className={styles.visualModeCardFlame} aria-hidden="true">
                      <FlameMascot
                        mode={meta.animationMode}
                        size="100%"
                        speed={visualMode === "FAST_BURN" ? "fast" : "slow"}
                      />
                    </span>
                    <span className={styles.visualModeCardCopy}>
                      <strong>
                        {meta.label}
                        {isSelected ? <span aria-hidden="true"> ✓</span> : null}
                      </strong>
                      <span>{meta.keywords.join(" · ")}</span>
                      <p>{meta.description}</p>
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      ) : null}

      {fieldPicker ? (
        <div className={styles.fieldPickerBackdrop} role="dialog" aria-modal="true">
          <div className={styles.fieldPicker}>
            <header>
              <div>
                <span>조건 항목</span>
                <strong>어떤 상황을 확인할까요?</strong>
                <p>주문할 때 한 번 더 확인하고 싶은 항목을 선택해 주세요.</p>
              </div>
              <button type="button" onClick={() => setFieldPicker(null)}>
                닫기
              </button>
            </header>
            <div className={styles.fieldPickerToolbar}>
              <input
                value={fieldSearch}
                placeholder="예: 급등, 반복 주문, 시장가, 평균 매수가"
                onChange={(event) => setFieldSearch(event.target.value)}
              />
              <div className={styles.fieldCategoryTabs}>
                <button
                  type="button"
                  className={fieldCategory === "ALL" ? styles.isSelected : ""}
                  onClick={() => setFieldCategory("ALL")}
                >
                  전체
                </button>
                {(
                  [
                    "ORDER_CONTEXT",
                    "ORDER_INPUT",
                    "DRAFT_BEHAVIOR",
                    "RECENT_BEHAVIOR",
                    "MARKET",
                    "PRIVATE_ACCOUNT",
                  ] as const
                ).map((category) => (
                  <button
                    key={category}
                    type="button"
                    className={fieldCategory === category ? styles.isSelected : ""}
                    onClick={() => setFieldCategory(category)}
                    data-category={category}
                  >
                    {CATEGORY_LABELS[category]}
                  </button>
                ))}
              </div>
            </div>
            {fieldPicker.target === "left" ? (
              <div className={styles.recommendedSituations}>
                {RECOMMENDED_SITUATIONS.map((item) => (
                  <button
                    key={item.title}
                    type="button"
                    onClick={() => chooseRecommendedSituation(item)}
                  >
                    {item.title}
                  </button>
                ))}
              </div>
            ) : null}
            <div className={styles.fieldPickerGrid}>
              {Object.entries(SUPPORTED_FIELDS)
                .filter(([key, field]) => {
                  const query = fieldSearch.trim().toLowerCase();
                  const matchesSearch =
                    !query ||
                    [
                      key,
                      field.label,
                      field.shortDescription,
                      ...field.keywords,
                    ]
                      .join(" ")
                      .toLowerCase()
                      .includes(query);
                  const matchesCategory =
                    fieldCategory === "ALL" || field.category === fieldCategory;
                  return matchesSearch && matchesCategory;
                })
                .map(([key, field]) => {
                const isDisabled =
                  rightOperandComparisonGroup !== null &&
                  field.comparisonGroup !== rightOperandComparisonGroup;

                return (
                  <button
                    key={key}
                    type="button"
                    disabled={isDisabled}
                    onClick={() => chooseField(key)}
                    data-category={field.category}
                  >
                    <span className={styles.fieldItemHeader}>
                      <span className={styles.fieldItemIcon} aria-hidden="true">
                        <FieldSemanticIcon semanticType={field.semanticType} />
                        <span>{getFieldIconLabel(field)}</span>
                      </span>
                      <span className={styles.fieldItemTitle}>
                        <strong>{field.label}</strong>
                        <small>
                          {CATEGORY_LABELS[field.category]}
                          {field.input.displayUnit ? ` · ${field.input.displayUnit}` : ""}
                          {field.requiresPrivateApi ? " · 개인 API 데이터" : ""}
                        </small>
                      </span>
                    </span>
                    <p>{field.shortDescription}</p>
                    <small>
                      저장 형식: {field.semanticType === "RATIO_0_TO_1" ? "비율" : field.input.displayUnit || "선택값"}
                    </small>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
