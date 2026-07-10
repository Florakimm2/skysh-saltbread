// backend/modules/guardrail/expression.ts
/* 조건식 검증 핵심 파일. 검증 내용 : 
1. 허용된 field만 사용 
2. 허용된 operator만 사용
3. IS_NULL / IS_NOT_NULL은 rightOperand 금지 
4. 그 외 operator는 rightOperand 필수
5. FIELD 비교는 같은 valueType만 허용 
6. LITERAL 값 타입 검증
7. requiresPrivateApi 자동 계산 */

import { ApiError } from "@/backend/common/api";
import { getRuleEligibleFieldDefinition } from "./catalog";
import type {
  RuleCondition,
  RuleExpression,
  RuleFieldDefinition,
  RuleOperand,
  RuleOperator,
} from "./types";

const NULL_OPERATORS: RuleOperator[] = ["IS_NULL", "IS_NOT_NULL"];

const COMPARISON_OPERATORS: RuleOperator[] = [
  "EQ",
  "NEQ",
  "GT",
  "GTE",
  "LT",
  "LTE",
  "IN",
  "NOT_IN",
];

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isDecimalString(value: string) {
  return /^-?\d+(\.\d+)?$/.test(value);
}

function assertOperatorAllowed(
  definition: RuleFieldDefinition,
  operator: RuleOperator,
) {
  if (!definition.supportedOperators.includes(operator)) {
    throw new ApiError(
      400,
      "INVALID_RULE_OPERATOR",
      `${definition.label}에 사용할 수 없는 조건입니다.`
    );
  }
}

function isKnownOperator(operator: string): operator is RuleOperator {
  return [...NULL_OPERATORS, ...COMPARISON_OPERATORS].includes(
    operator as RuleOperator,
  );
}

function allowedOptionValues(definition: RuleFieldDefinition) {
  return new Set(
    (definition.input.options || []).map((option) => String(option.value)),
  );
}

function assertFiniteNumber(value: unknown, message: string): asserts value is number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new ApiError(400, "INVALID_RULE_LITERAL", message);
  }
}

function assertNumberRange(definition: RuleFieldDefinition, value: number) {
  const { min, max, step } = definition.input;

  if (min !== undefined && value < min) {
    throw new ApiError(
      400,
      "INVALID_RULE_LITERAL_RANGE",
      `${definition.label} 값은 ${formatStorageValue(definition, min)} 이상이어야 합니다.`
    );
  }

  if (max !== undefined && value > max) {
    throw new ApiError(
      400,
      "INVALID_RULE_LITERAL_RANGE",
      `${definition.label} 값은 ${formatStorageValue(definition, max)} 이하여야 합니다.`
    );
  }

  if (definition.semanticType === "COUNT" || definition.semanticType === "DURATION_MS") {
    if (!Number.isInteger(value)) {
      throw new ApiError(
        400,
        "INVALID_RULE_LITERAL_RANGE",
        `${definition.label}에는 정수만 사용할 수 있습니다.`
      );
    }
  }

  if (step === 1 && !Number.isInteger(value)) {
    throw new ApiError(
      400,
      "INVALID_RULE_LITERAL_RANGE",
      `${definition.label}에는 정수만 사용할 수 있습니다.`
    );
  }
}

function formatStorageValue(definition: RuleFieldDefinition, value: number) {
  if (definition.input.storageUnit === "ratio") {
    return `${Number((value * 100).toFixed(8))}%`;
  }

  if (definition.input.storageUnit === "ms") {
    return `${value}ms`;
  }

  return String(value);
}

function assertDecimalRange(definition: RuleFieldDefinition, value: string) {
  if (!isDecimalString(value)) {
    throw new ApiError(
      400,
      "INVALID_RULE_LITERAL",
      `${definition.label}에는 올바른 숫자만 사용할 수 있습니다.`
    );
  }

  if (definition.input.min !== undefined && value.startsWith("-")) {
    throw new ApiError(
      400,
      "INVALID_RULE_LITERAL_RANGE",
      `${definition.label}에는 음수를 사용할 수 없습니다.`
    );
  }
}

function assertLiteralValueType(params: {
  definition: RuleFieldDefinition;
  operator: RuleOperator;
  value: string | number | boolean | string[] | null;
}) {
  const { definition, operator, value } = params;
  const valueType = definition.valueType;

  if (operator === "IN" || operator === "NOT_IN") {
    if (!Array.isArray(value)) {
      throw new ApiError(
        400,
        "INVALID_RULE_LITERAL",
        `${operator} operator의 LITERAL value는 배열이어야 합니다.`
      );
    }

    if (valueType === "STRING" || valueType === "STRING_ARRAY") {
      if (!value.every((item) => typeof item === "string")) {
        throw new ApiError(
          400,
          "INVALID_RULE_LITERAL",
          "배열 비교값은 string[]이어야 합니다."
        );
      }

      const allowedValues = allowedOptionValues(definition);
      if (
        allowedValues.size > 0 &&
        !value.every((item) => allowedValues.has(String(item)))
      ) {
        throw new ApiError(
          400,
          "INVALID_RULE_LITERAL",
          `${definition.label}에 허용되지 않은 값이 있습니다.`
        );
      }
      return;
    }

    throw new ApiError(
      400,
      "INVALID_RULE_LITERAL",
      `${valueType} 필드는 IN, NOT_IN LITERAL 배열 비교를 지원하지 않습니다.`
    );
  }

  if (valueType === "STRING" && typeof value !== "string") {
    throw new ApiError(
      400,
      "INVALID_RULE_LITERAL",
      "STRING 필드의 LITERAL value는 string이어야 합니다."
    );
  }

  if (valueType === "STRING" && typeof value === "string") {
    const allowedValues = allowedOptionValues(definition);
    if (allowedValues.size > 0 && !allowedValues.has(String(value))) {
      throw new ApiError(
        400,
        "INVALID_RULE_LITERAL",
        `${definition.label}에 허용되지 않은 값입니다.`
      );
    }
  }

  if (valueType === "NUMBER") {
    assertFiniteNumber(
      value,
      "NUMBER 필드의 LITERAL value는 유한한 number여야 합니다.",
    );
    assertNumberRange(definition, value);
  }

  if (valueType === "BOOLEAN" && typeof value !== "boolean") {
    throw new ApiError(
      400,
      "INVALID_RULE_LITERAL",
      "BOOLEAN 필드의 LITERAL value는 boolean이어야 합니다."
    );
  }

  if (valueType === "DECIMAL_STRING") {
    if (typeof value !== "string") {
      throw new ApiError(
        400,
        "INVALID_RULE_LITERAL",
        "DECIMAL_STRING 필드의 LITERAL value는 decimal string이어야 합니다."
      );
    }
    assertDecimalRange(definition, value);
  }

  if (valueType === "MIXED_ENUM") {
    const allowedValues = allowedOptionValues(definition);
    if (value !== null && !allowedValues.has(String(value))) {
      throw new ApiError(
        400,
        "INVALID_RULE_LITERAL",
        `${definition.label}에 허용되지 않은 값입니다.`
      );
    }
  }
}

function validateRightOperand(params: {
  leftFieldDefinition: RuleFieldDefinition;
  operator: RuleOperator;
  rightOperand: RuleOperand;
}) {
  const { leftFieldDefinition, operator, rightOperand } = params;

  if (!isPlainObject(rightOperand)) {
    throw new ApiError(
      400,
      "INVALID_RULE_OPERAND",
      "rightOperand 형식이 올바르지 않습니다."
    );
  }

  if (rightOperand.operandType === "LITERAL") {
    assertLiteralValueType({
      definition: leftFieldDefinition,
      operator,
      value: rightOperand.value,
    });

    return {
      requiresPrivateApi: false,
    };
  }

  if (rightOperand.operandType === "FIELD") {
    const rightFieldDefinition = getRuleEligibleFieldDefinition(rightOperand.field);

    if (!rightFieldDefinition) {
      throw new ApiError(
        400,
        "INVALID_RULE_FIELD",
        `허용되지 않은 FIELD rightOperand.field입니다: ${rightOperand.field}`
      );
    }

    if (
      !leftFieldDefinition.comparisonGroup ||
      leftFieldDefinition.comparisonGroup !== rightFieldDefinition.comparisonGroup
    ) {
      throw new ApiError(
        400,
        "INVALID_RULE_FIELD_TYPE",
        "서로 의미가 같은 항목끼리만 비교할 수 있습니다."
      );
    }

    return {
      requiresPrivateApi: rightFieldDefinition.requiresPrivateApi,
    };
  }

  throw new ApiError(
    400,
    "INVALID_RULE_OPERAND",
    "rightOperand.operandType은 LITERAL 또는 FIELD여야 합니다."
  );
}

function validateCondition(condition: RuleCondition) {
  const leftFieldDefinition = getRuleEligibleFieldDefinition(condition.leftField);

  if (!leftFieldDefinition) {
    throw new ApiError(
      400,
      "INVALID_RULE_FIELD",
      `허용되지 않은 leftField입니다: ${condition.leftField}`
    );
  }

  if (!isKnownOperator(condition.operator)) {
    throw new ApiError(
      400,
      "INVALID_RULE_OPERATOR",
      `허용되지 않은 operator입니다: ${condition.operator}`
    );
  }

  assertOperatorAllowed(leftFieldDefinition, condition.operator);

  let requiresPrivateApi = leftFieldDefinition.requiresPrivateApi;

  if (NULL_OPERATORS.includes(condition.operator)) {
    if ("rightOperand" in condition) {
      throw new ApiError(
        400,
        "INVALID_RULE_OPERAND",
        `${condition.operator} operator는 rightOperand를 가질 수 없습니다.`
      );
    }

    return {
      requiresPrivateApi,
    };
  }

  if (!("rightOperand" in condition)) {
    throw new ApiError(
      400,
      "INVALID_RULE_OPERAND",
      `${condition.operator} operator는 rightOperand가 필요합니다.`
    );
  }

  const rightResult = validateRightOperand({
    leftFieldDefinition,
    operator: condition.operator,
    rightOperand: condition.rightOperand,
  });

  requiresPrivateApi =
    requiresPrivateApi || rightResult.requiresPrivateApi;

  return {
    requiresPrivateApi,
  };
}

export function validateRuleExpression(expression: RuleExpression): {
  requiresPrivateApi: boolean;
} {
  if (!isPlainObject(expression)) {
    throw new ApiError(
      400,
      "INVALID_RULE_EXPRESSION",
      "expression은 객체여야 합니다."
    );
  }

  if (expression.nodeType === "CONDITION") {
    return validateCondition(expression);
  }

  if (expression.nodeType === "GROUP") {
    if (!["AND", "OR"].includes(expression.operator)) {
      throw new ApiError(
        400,
        "INVALID_RULE_GROUP_OPERATOR",
        "GROUP operator는 AND 또는 OR이어야 합니다."
      );
    }

    if (!Array.isArray(expression.children) || expression.children.length === 0) {
      throw new ApiError(
        400,
        "INVALID_RULE_GROUP_CHILDREN",
        "GROUP children은 1개 이상이어야 합니다."
      );
    }

    const childrenResults = expression.children.map((child) =>
      validateRuleExpression(child)
    );

    return {
      requiresPrivateApi: childrenResults.some(
        (result) => result.requiresPrivateApi
      ),
    };
  }

  throw new ApiError(
    400,
    "INVALID_RULE_EXPRESSION",
    "expression.nodeType은 CONDITION 또는 GROUP이어야 합니다."
  );
}
