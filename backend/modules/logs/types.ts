// backend/modules/logs/types.ts

import type {
  RiskLevel,
  RuleExpression,
  RuleOperator,
  UserGuardrailRuleDTO,
  VisualMode,
} from "@/backend/modules/guardrail/types";

export type SnapshotTrigger = "GUARDRAIL_SHOWN" | "ORDER_INTENT_CLICK";

export type OrderSide = "BUY" | "SELL" | "UNKNOWN";

export type OrderMode =
  | "LIMIT"
  | "MARKET"
  | "BEST"
  | "RESERVED"
  | "UNKNOWN";

export type EntryPoint = "NORMAL" | "QUICK" | "REORDER" | "UNKNOWN";

export type GuardrailReactionAction = "PROCEED" | "REVIEW" | "CLOSE";

export type FeedbackStatus = "ANSWERED" | "DISMISSED";

export type SelfAssessment = "PLANNED" | "EMOTIONAL";

export type ConfirmedTradeSide = "BUY" | "SELL";

export type ConfirmedTradeOrdType =
  | "LIMIT"
  | "MARKET_BUY"
  | "MARKET_SELL"
  | "BEST";

export type TimeInForce = "IOC" | "FOK" | "POST_ONLY";

export type OrderOutcomeState =
  | "wait"
  | "watch"
  | "trade"
  | "done"
  | "cancel"
  | "prevented";

export type AllocationPresetPercent =
  | number
  | "CUSTOM"
  | null;

export type RuleEvaluationDataCategory =
  | "ORDER"
  | "BEHAVIOR"
  | "MARKET"
  | "ACCOUNT";

export interface RuleEvaluationConditionSnapshot {
  leftField: string;
  operator: RuleOperator;
  expectedValue: unknown;
  actualValue: unknown;
  matched: boolean;
  dataCategory: RuleEvaluationDataCategory;
}

export interface GuardrailRuleSnapshot {
  ruleId: string;
  name: string;
  description?: string | null;
  priority?: number;
  visualMode: VisualMode;
  riskLevel: RiskLevel;
  expression: RuleExpression;
  warningTitle?: string;
  warningMessage?: string;
}

export interface RuleEvaluationSnapshot
  extends Omit<GuardrailRuleSnapshot, "name"> {
  name?: string;
  ruleVersion?: string;
  ruleName: string;
  conditions: RuleEvaluationConditionSnapshot[];
}

export interface OrderContextSnapshotDTO {
  snapshotId: string;
  userId: string;

  attemptId: string | null;
  snapshotTrigger: SnapshotTrigger;
  capturedAt: string;
  orderTime: string | null;
  orderTimeMinutes: number | null;

  market: string;
  side: OrderSide;
  orderMode: OrderMode;
  entryPoint: EntryPoint;

  intentPrice: string | null;
  intentQuantity: string | null;
  intentAmount: string | null;
  requestedBalanceRatio: number | null;

  draftDurationMs: number | null;
  lastEditToSnapshotMs: number | null;
  draftEditCount: number | null;
  amountChangeRate: number | null;
  modeChangedToMarket: boolean | null;
  orderbookClickToSnapshotMs: number | null;

  orderIntentCount1m: number;
  actualOrderCreatedCount10m: number | null;
  sameSideIntentCount1m: number;
  marketChangeCount5m: number;
  sideChangeCount3m: number;
  priceEditCount3m: number;
  quantityEditCount3m: number;
  amountEditCount3m: number;
  inputRevertCount: number;
  priceDirectionChangeCount: number;
  priceChangeRate: number | null;
  orderModeChangeCount3m: number;
  allocationPresetPercent: AllocationPresetPercent;
  draftResetCount3m: number | null;

  matchedRuleIdsAtSnapshot: string[];
  primaryShownRuleId: string | null;
  shownRuleIds: string[];
  ruleSnapshot: GuardrailRuleSnapshot | null;
  ruleSnapshots: GuardrailRuleSnapshot[];
  ruleEvaluationSnapshots: RuleEvaluationSnapshot[];

  tradePriceAtSnapshot: string | null;
  shortTermReturn5m: number | null;
  signedChangeRate: number | null;
  spreadRate: number | null;
  marketRiskFlags: string[];
  pricePositionIn5mRange: number | null;
  volumeSpikeRatio5m: number | null;
  baseAssetAvgBuyPriceBeforeSnapshot: string | null;
  priceVsAvgBuyRateAtSnapshot: number | null;

  createdAt: string;
  updatedAt: string;
}

export interface GuardrailReactionDTO {
  reactionId: string;
  userId: string;

  snapshotId: string;
  action: GuardrailReactionAction;
  reactedAt: string;
  reactionUiVersion: string;

  createdAt: string;
  updatedAt: string;
}

export interface TradeFeedbackDTO {
  feedbackId: string;
  userId: string;

  attemptId: string;
  feedbackStatus: FeedbackStatus;
  selfAssessment: SelfAssessment | null;
  feedbackShownAt: string;
  respondedAt: string;
  feedbackUiVersion: string;

  createdAt: string;
  updatedAt: string;
}

export interface ConfirmedTradeLogDTO {
  tradeLogId: string;
  userId: string;

  attemptId: string | null;
  upbitOrderUuid: string;
  orderCreatedAt: string;

  market: string;
  side: ConfirmedTradeSide;
  ordType: ConfirmedTradeOrdType;

  limitPrice: string | null;
  requestedFunds: string | null;
  requestedVolume: string | null;
  timeInForce: TimeInForce | null;

  state: OrderOutcomeState | null;
  executedVolume: string | null;
  executedFunds: string | null;
  paidFee: string | null;
  remainingVolume: string | null;
  outcomeObservedAt: string | null;

  createdAt: string;
  updatedAt: string;
}

export interface OrderOutcomePatchDTO {
  upbitOrderUuid: string;
  state: OrderOutcomeState;
  executedVolume: string | null;
  executedFunds: string | null;
  paidFee: string | null;
  remainingVolume: string | null;
  outcomeObservedAt: string;
}

export type RuleHistorySource =
  | "EVALUATION_SNAPSHOT"
  | "MISSING_RULE";

export interface RuleConditionResultDTO {
  leftField: string;
  fieldLabel: string;
  operator: RuleOperator;
  operatorLabel: string;
  expectedValue: unknown;
  actualValue: unknown;
  matched: boolean | null;
  dataCategory: RuleEvaluationDataCategory;
  dataCategoryLabel: string;
  unavailableReason: string | null;
}

export type EnrichedRuleData = Pick<
  UserGuardrailRuleDTO,
  | "ruleId"
  | "name"
  | "description"
  | "riskLevel"
  | "visualMode"
  | "warningTitle"
  | "warningMessage"
  | "expression"
  | "schemaVersion"
  | "updatedAt"
> & {
  ruleVersion?: string;
  historySource: RuleHistorySource;
  historyNotice: string;
  conditionResults: RuleConditionResultDTO[];
};

export type GuardrailTimelineItem =
  | {
      type: "WARNING";
      id: string;
      occurredAt: string;
      snapshot: OrderContextSnapshotDTO;
      rule?: EnrichedRuleData;
      shownRules: EnrichedRuleData[];
      reaction?: GuardrailReactionDTO | null;
    }
  | {
      type: "FEEDBACK";
      id: string;
      occurredAt: string;
      feedback: TradeFeedbackDTO;
      relatedSnapshot?: OrderContextSnapshotDTO | null;
    };

export interface GuardrailTimelineResponse {
  items: GuardrailTimelineItem[];
  nextCursor: string | null;
  totalCount: number;
  warningCount: number;
  feedbackCount: number;
}

export type LogListParams = {
  userId: string;
  limit?: number;
  market?: string;
  from?: string;
  to?: string;
  attemptId?: string;
  snapshotId?: string;
  upbitOrderUuid?: string;
};
