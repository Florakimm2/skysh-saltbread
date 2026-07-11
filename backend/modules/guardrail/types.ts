// backend/modules/guardrail/types.ts

export type RiskLevel = "LOW" | "MEDIUM" | "HIGH";

export type VisualMode =
  | "CURIOUS"
  | "SURPRISED"
  | "FAST_BURN"
  | "SCARED"
  | "SAD";

export type SchemaVersion = "v1";

export type RuleValueType =
  | "STRING"
  | "NUMBER"
  | "DECIMAL_STRING"
  | "BOOLEAN"
  | "STRING_ARRAY"
  | "MIXED_ENUM";

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
      value: string | number | boolean | string[] | null;
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
  key: string;
  label: string;
  shortDescription: string;
  detailedDescription?: string;
  category:
    | "ORDER_CONTEXT"
    | "ORDER_INPUT"
    | "DRAFT_BEHAVIOR"
    | "RECENT_BEHAVIOR"
    | "MARKET"
    | "PRIVATE_ACCOUNT"
    | "SYSTEM";
  valueType: RuleValueType;
  semanticType:
    | "ENUM"
    | "MARKET"
    | "PRICE"
    | "QUANTITY"
    | "AMOUNT"
    | "SIGNED_PERCENT"
    | "NON_NEGATIVE_PERCENT"
    | "RATIO_0_TO_1"
    | "DURATION_MS"
    | "COUNT"
    | "MULTIPLIER"
    | "BOOLEAN"
    | "FLAG_SET"
    | "ALLOCATION_PRESET"
    | "IDENTIFIER"
    | "DATETIME"
    | "TIME_OF_DAY";
  nullable: boolean;
  ruleEligible: boolean;
  requiresPrivateApi: boolean;
  supportedOperators: RuleOperator[];
  input: {
    control:
      | "SELECT"
      | "MARKET_SELECT"
      | "DECIMAL"
      | "PERCENT"
      | "DURATION"
      | "COUNT_STEPPER"
      | "BOOLEAN_SELECT"
      | "FLAG_MULTI_SELECT"
      | "PRESET_SELECT"
      | "TIME";
    min?: number;
    max?: number;
    step?: number;
    options?: Array<{
      label: string;
      value: string | number | boolean;
      hiddenInPicker?: boolean;
    }>;
    displayUnit?: string;
    storageUnit?: string;
  };
  comparisonGroup?: string;
  keywords: string[];
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

export type UserGuardrailRuleReorderRequest = {
  ruleIds: string[];
};
