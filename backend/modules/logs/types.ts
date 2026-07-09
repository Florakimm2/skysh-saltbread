// backend/modules/logs/types.ts

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

export interface OrderContextSnapshotDTO {
  snapshotId: string;
  userId: string;

  attemptId: string | null;
  snapshotTrigger: SnapshotTrigger;
  capturedAt: string;

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