// backend/modules/guardrail/types.ts

export type RiskLevel = "LOW" | "MEDIUM" | "HIGH";

export type VisualMode =
  | "CURIOUS"
  | "SURPRISED"
  | "FAST_BURN"
  | "SCARED"
  | "SAD";

export type SchemaVersion = "v1";

export type RuleValueType = "STRING" | "NUMBER" | "DECIMAL_STRING" | "BOOLEAN";

export type RuleOperator =
  | "IS_NULL"
  | "IS_NOT_NULL"
  | "EQ"
  | "NEQ"
  | "GT"
  | "GTE"
  | "LT"
  | "LTE"
  | "IN"
  | "NOT_IN";

export type RuleOperand =
  | {
      operandType: "LITERAL";
      value: string | number | boolean | string[];
    }
  | {
      operandType: "FIELD";
      field: string;
    };

export type RuleCondition =
  | {
      nodeType: "CONDITION";
      leftField: string;
      operator: "IS_NULL" | "IS_NOT_NULL";
    }
  | {
      nodeType: "CONDITION";
      leftField: string;
      operator: Exclude<RuleOperator, "IS_NULL" | "IS_NOT_NULL">;
      rightOperand: RuleOperand;
    };

export type RuleConditionGroup = {
  nodeType: "GROUP";
  operator: "AND" | "OR";
  children: RuleExpression[];
};

export type RuleExpression = RuleCondition | RuleConditionGroup;

export type RuleFieldDefinition = {
  valueType: RuleValueType;
  requiresPrivateApi: boolean;
};

export type UserDTO = {
  userId: string;
  email: string | null;
  displayName: string | null;
  timezone: string;

  personalDataConsentAgreed: boolean;
  personalDataConsentAgreedAt: string | null;
  personalDataConsentVersion: string | null;

  onboardingCompleted: boolean;
  onboardingCompletedAt: string | null;

  createdAt: string;
  updatedAt: string;
};

export type UserGuardrailRuleDTO = {
  ruleId: string;
  userId: string;

  name: string;
  description: string | null;

  isEnabled: boolean;
  priority: number;

  riskLevel: RiskLevel;
  visualMode: VisualMode;

  expression: RuleExpression;

  warningTitle: string;
  warningMessage: string;

  requiresPrivateApi: boolean;

  schemaVersion: SchemaVersion;
  createdAt: string;
  updatedAt: string;
};

export type UserGuardrailRuleCreateRequest = {
  name: string;
  description: string | null;

  isEnabled: boolean;
  priority: number;

  riskLevel: RiskLevel;
  visualMode: VisualMode;

  expression: RuleExpression;

  warningTitle: string;
  warningMessage: string;
};

export type UserGuardrailRulePatchRequest = Partial<
  UserGuardrailRuleCreateRequest
>;