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
import { getRuleFieldDefinition } from "./catalog";
import type {
  RuleCondition,
  RuleExpression,
  RuleFieldDefinition,
  RuleOperand,
  RuleOperator,
  RuleValueType,
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

const ORDER_OPERATORS: RuleOperator[] = ["GT", "GTE", "LT", "LTE"];

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isDecimalString(value: string) {
  return /^-?\d+(\.\d+)?$/.test(value);
}

function assertOperatorAllowed(valueType: RuleValueType, operator: RuleOperator) {
  if (NULL_OPERATORS.includes(operator)) return;

  if (!COMPARISON_OPERATORS.includes(operator)) {
    throw new ApiError(
      400,
      "INVALID_RULE_OPERATOR",
      `허용되지 않은 operator입니다: ${operator}`
    );
  }

  if (valueType === "BOOLEAN") {
    if (!["EQ", "NEQ"].includes(operator)) {
      throw new ApiError(
        400,
        "INVALID_RULE_OPERATOR",
        `BOOLEAN 필드는 EQ, NEQ만 사용할 수 있습니다.`
      );
    }
  }

  if (valueType === "STRING") {
    if (!["EQ", "NEQ", "IN", "NOT_IN"].includes(operator)) {
      throw new ApiError(
        400,
        "INVALID_RULE_OPERATOR",
        `STRING 필드는 EQ, NEQ, IN, NOT_IN만 사용할 수 있습니다.`
      );
    }
  }

  if (
    (valueType === "NUMBER" || valueType === "DECIMAL_STRING") &&
    !COMPARISON_OPERATORS.includes(operator)
  ) {
    throw new ApiError(
      400,
      "INVALID_RULE_OPERATOR",
      `${valueType} 필드에 사용할 수 없는 operator입니다.`
    );
  }
}

function assertLiteralValueType(params: {
  valueType: RuleValueType;
  operator: RuleOperator;
  value: string | number | boolean | string[];
}) {
  const { valueType, operator, value } = params;

  if (operator === "IN" || operator === "NOT_IN") {
    if (!Array.isArray(value)) {
      throw new ApiError(
        400,
        "INVALID_RULE_LITERAL",
        `${operator} operator의 LITERAL value는 배열이어야 합니다.`
      );
    }

    if (valueType === "STRING") {
      if (!value.every((item) => typeof item === "string")) {
        throw new ApiError(
          400,
          "INVALID_RULE_LITERAL",
          "STRING IN 비교값은 string[]이어야 합니다."
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

  if (valueType === "NUMBER" && typeof value !== "number") {
    throw new ApiError(
      400,
      "INVALID_RULE_LITERAL",
      "NUMBER 필드의 LITERAL value는 number여야 합니다."
    );
  }

  if (valueType === "BOOLEAN" && typeof value !== "boolean") {
    throw new ApiError(
      400,
      "INVALID_RULE_LITERAL",
      "BOOLEAN 필드의 LITERAL value는 boolean이어야 합니다."
    );
  }

  if (valueType === "DECIMAL_STRING") {
    if (typeof value !== "string" || !isDecimalString(value)) {
      throw new ApiError(
        400,
        "INVALID_RULE_LITERAL",
        "DECIMAL_STRING 필드의 LITERAL value는 decimal string이어야 합니다."
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
      valueType: leftFieldDefinition.valueType,
      operator,
      value: rightOperand.value,
    });

    return {
      requiresPrivateApi: false,
    };
  }

  if (rightOperand.operandType === "FIELD") {
    const rightFieldDefinition = getRuleFieldDefinition(rightOperand.field);

    if (!rightFieldDefinition) {
      throw new ApiError(
        400,
        "INVALID_RULE_FIELD",
        `허용되지 않은 FIELD rightOperand.field입니다: ${rightOperand.field}`
      );
    }

    if (rightFieldDefinition.valueType !== leftFieldDefinition.valueType) {
      throw new ApiError(
        400,
        "INVALID_RULE_FIELD_TYPE",
        `FIELD 비교는 같은 valueType끼리만 가능합니다. left=${leftFieldDefinition.valueType}, right=${rightFieldDefinition.valueType}`
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
  const leftFieldDefinition = getRuleFieldDefinition(condition.leftField);

  if (!leftFieldDefinition) {
    throw new ApiError(
      400,
      "INVALID_RULE_FIELD",
      `허용되지 않은 leftField입니다: ${condition.leftField}`
    );
  }

  assertOperatorAllowed(leftFieldDefinition.valueType, condition.operator);

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