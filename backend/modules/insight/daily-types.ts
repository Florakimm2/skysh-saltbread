import type {
  ConfirmedTradeLogDTO,
  GuardrailReactionDTO,
  OrderContextSnapshotDTO,
  TradeFeedbackDTO,
} from "@/backend/modules/logs/types";
import type { UserGuardrailRuleDTO } from "@/backend/modules/guardrail/types";

export type LinkConfidence = "EXACT" | "INFERRED";

export type DailyTimelineEventType =
  | "GUARDRAIL_TRIGGERED"
  | "GUARDRAIL_REACTION"
  | "ORDER_ATTEMPT"
  | "FEEDBACK_SUBMITTED"
  | "ORDER_CREATED"
  | "ORDER_UPDATED";

export type DailyTimelineEvent = {
  id: string;
  type: DailyTimelineEventType;
  occurredAt: string;
  snapshotId: string | null;
  attemptId: string | null;
  tradeLogId: string | null;
  market: string | null;
  side: "BUY" | "SELL" | "UNKNOWN" | null;
  title: string;
  description: string;
  linkConfidence: LinkConfidence;
};

export type DailyInsightEligibility = {
  date: string;
  eligible: boolean;
  answeredFeedbackCount: number;
  requiredFeedbackCount: 5;
  reportStatus:
    | "NOT_CREATED"
    | "GENERATING"
    | "COMPLETED"
    | "PARTIAL"
    | "FAILED"
    | "STALE";
  reportId: string | null;
  hasNewData: boolean;
};

export type CancelledOrderVirtualPnlItem = {
  snapshotId: string;
  capturedAt: string;
  market: string;
  side: "BUY" | "SELL";
  ruleIds: string[];
  classification: "CONFIRMED_CANCELLED" | "INFERRED_NOT_PROCEEDED";
  entryPrice: string;
  currentPrice: string;
  virtualQuantity: string;
  virtualReturnRate: number;
  virtualPnl: string;
  priceQuality: "EXACT_INTENT" | "APPROXIMATED";
  note: string;
};

export type CancelledOrderVirtualPnlMetric = {
  status: "AVAILABLE" | "NO_MATCHING_DATA" | "INSUFFICIENT_DATA" | "ERROR";
  window: { from: string; to: string };
  sampleCount: number;
  totalPositiveVirtualPnl: string;
  totalNegativeVirtualPnl: string;
  netVirtualPnl: string;
  items: CancelledOrderVirtualPnlItem[];
  disclaimer: string;
};

export type WaitingPriceEffectMetric = {
  status: "AVAILABLE" | "NO_MATCHING_DATA" | "INSUFFICIENT_DATA" | "ERROR";
  sampleCount: number;
  items: Array<Record<string, unknown>>;
  disclaimer: string;
};

export type ReducedExposureMetric = {
  status: "AVAILABLE" | "NO_MATCHING_DATA" | "INSUFFICIENT_DATA" | "ERROR";
  sampleCount: number;
  totalReducedExposureAmount: string;
  items: Array<Record<string, unknown>>;
  disclaimer: string;
};

export type FeedbackPnlComparisonMetric = {
  status: "AVAILABLE" | "INSUFFICIENT_DATA" | "NO_MATCHING_DATA" | "ERROR";
  groups: {
    PLANNED: Record<string, number | null>;
    EMOTIONAL: Record<string, number | null>;
  };
  disclaimer: string;
};

export type InsightDataAvailability = {
  planFeedback: {
    available: boolean;
    sampleCount: number;
  };
  guardrailBehavior: {
    available: boolean;
    shownGuardrailCount?: number;
    reactionCount: number;
    proceedCount: number;
    reviewCount: number;
    closeCount: number;
  };
  orderInfo: {
    available: boolean;
    sampleCount: number;
    uniqueMarketCount: number;
  };
  behaviorTiming: {
    available: boolean;
    sampleCount: number;
  };
  frequencyPattern: {
    available: boolean;
    sampleCount: number;
  };
  marketContext: {
    available: boolean;
    sampleCount: number;
  };
  personalTrade: {
    available: boolean;
    sampleCount: number;
  };
  fee: {
    available: boolean;
    sampleCount: number;
  };
  slippage: {
    available: boolean;
    sampleCount: number;
  };
};

export type InsightEvidence = {
  evidenceType: "OBSERVED" | "CALCULATED" | "AI_INTERPRETATION";
  sourceFields: string[];
  sampleCount: number;
  sourceRecordCount: number;
  dataAvailability: "AVAILABLE" | "PARTIAL" | "UNAVAILABLE";
};

export type EvidenceConfidence = "LOW" | "MEDIUM" | "HIGH";

export type OrderFlowViewModel = {
  flowId: string;
  startedAt: string;
  market: string | null;
  side: "BUY" | "SELL" | "UNKNOWN" | null;
  attemptId: string | null;
  snapshotIds: string[];
  guardrail: {
    shown: boolean;
    ruleIds: string[];
    ruleNames: string[];
    reaction: "PROCEED" | "REVIEW" | "CLOSE" | null;
  };
  feedback: "PLANNED" | "REGRETTED" | "DISMISSED" | null;
  trade: {
    availability:
      | "CONFIRMED"
      | "NOT_CONFIRMED"
      | "PRIVATE_API_UNAVAILABLE";
    state: string | null;
    executedFunds: string | null;
    executedVolume: string | null;
    paidFee: string | null;
  };
  events: DailyTimelineEvent[];
};

export type RuleSimulationResult = {
  triggerCount?: number;
  support?: number;
  coverage: number;
  precision: number | null;
  recall: number | null;
  falsePositiveRate: number | null;
  plannedTriggerRate?: number | null;
  regrettedCaptureRate?: number | null;
  lift?: number | null;
};

export type StoredSuggestionStatus =
  | "PENDING"
  | "ACCEPTED"
  | "DISMISSED"
  | "EXPIRED";

export type SuggestionExplanation = {
  title: string;
  rationale: string;
  evidenceSummary: string;
  expectedChange: string;
  caution: string;
  ruleName: string;
  ruleDescription: string;
  warningTitle: string;
  warningMessage: string;
};

export type StoredSuggestionMeta = {
  suggestionId: string;
  candidateKey: string;
  status: StoredSuggestionStatus;
  createdAt: string;
  acceptedAt: string | null;
  dismissedAt: string | null;
  acceptedRuleId: string | null;
};

export type NewGuardrailSuggestion = {
  candidateKey?: string;
  suggestionId: string;
  type: "NEW_GUARDRAIL";
  status: StoredSuggestionStatus;
  createdAt?: string;
  acceptedAt?: string | null;
  dismissedAt?: string | null;
  acceptedRuleId?: string | null;
  title: string;
  rationale: string;
  explanation?: SuggestionExplanation;
  evidenceCount: number;
  confidence: number;
  proposedRule: UserGuardrailRuleDTO;
  representativeValues: Record<string, unknown>;
  simulation: RuleSimulationResult;
  evaluationMode?: "IN_SAMPLE" | "TEMPORAL_HOLDOUT";
  sourceWindow?: { fromAt: string; toAt: string };
};

export type GuardrailModificationSuggestion = {
  candidateKey?: string;
  suggestionId: string;
  type: "MODIFY_GUARDRAIL";
  status: StoredSuggestionStatus;
  createdAt?: string;
  acceptedAt?: string | null;
  dismissedAt?: string | null;
  acceptedRuleId?: string | null;
  guardrailId: string;
  ruleId?: string;
  baseRuleHash?: string;
  title: string;
  rationale: string;
  explanation?: SuggestionExplanation;
  evidenceCount: number;
  confidence: number;
  currentRule?: UserGuardrailRuleDTO;
  proposedRule: UserGuardrailRuleDTO;
  diff: Array<{
    path: string;
    before: unknown;
    after: unknown;
    reason: string;
  }>;
  representativeValues?: Record<string, unknown>;
  currentSimulation: RuleSimulationResult;
  proposedSimulation: RuleSimulationResult;
  evaluationMode?: "IN_SAMPLE" | "TEMPORAL_HOLDOUT";
  sourceWindow?: { fromAt: string; toAt: string };
};

export type DailyInsightReport = {
  reportId: string;
  userId: string;
  date: string;
  timezone: string;
  status: "GENERATING" | "COMPLETED" | "PARTIAL" | "FAILED";
  analysisStatus?: {
    overview: "COMPLETED" | "FAILED";
    fieldAnalysis: "COMPLETED" | "FAILED";
  };
  promptVersion?: string;
  analysisVersion?: string;
  inputHash: string;
  sourceCounts: {
    attempts: number;
    guardrails?: number;
    reactions?: number;
    guardrailSnapshots: number;
    guardrailReactions: number;
    answeredFeedbacks: number;
    confirmedTrades: number;
  };
  timeline: DailyTimelineEvent[];
  orderFlows?: OrderFlowViewModel[];
  metrics: {
    cancelledOrderVirtualPnl: CancelledOrderVirtualPnlMetric;
    waitingPriceEffect: WaitingPriceEffectMetric;
    reducedExposure: ReducedExposureMetric;
    feedbackPnlComparison: FeedbackPnlComparisonMetric;
  };
  dataAvailability?: InsightDataAvailability;
  overview: {
    summary: string;
    flameStatus: string;
    cards: Array<{
      title: string;
      description: string;
      severity: string;
      evidence?: InsightEvidence;
      evidenceConfidence?: EvidenceConfidence;
    }>;
  } | null;
  fieldAnalysis: {
    topics: Array<{
      topic_key: string;
      topic_label: string;
      headline: string;
      analysis: string;
      severity: string;
      evidence?: InsightEvidence;
    }>;
    oneLineAdvice: string;
  } | null;
  suggestions: {
    newGuardrail?: NewGuardrailSuggestion | null;
    modification?: GuardrailModificationSuggestion | null;
    newGuardrails: NewGuardrailSuggestion[];
    modifications?: GuardrailModificationSuggestion[];
    guardrailModifications: GuardrailModificationSuggestion[];
  };
  suggestionStatus?:
    | "NOT_IMPLEMENTED"
    | "INSUFFICIENT_DATA"
    | "NO_SUGGESTION"
    | "AVAILABLE"
    | "ERROR";
  suggestionDiagnostics?: {
    status:
      | "AVAILABLE"
      | "INSUFFICIENT_DATA"
      | "NO_SUGGESTION"
      | "ERROR";
    errorCode: string | null;
    errorStage: string | null;
    totalSnapshotCount: number;
    labeledSampleCount: number;
    regrettedSampleCount: number;
    shownGuardrailCount: number;
    analyzableRuleCount: number;
    usedFeatureCount: number;
    algorithmVersion: string;
  };
  generatedAt: string | null;
  createdAt: string;
  updatedAt: string;
  errorCode: string | null;
  errorMessage: string | null;
  debugSummary?: Record<string, unknown>;
};

export type DailyInsightSources = {
  snapshots: OrderContextSnapshotDTO[];
  reactions: GuardrailReactionDTO[];
  feedbacks: TradeFeedbackDTO[];
  trades: ConfirmedTradeLogDTO[];
  rules: UserGuardrailRuleDTO[];
  suggestionSnapshots?: OrderContextSnapshotDTO[];
  suggestionReactions?: GuardrailReactionDTO[];
  suggestionFeedbacks?: TradeFeedbackDTO[];
  suggestionTrades?: ConfirmedTradeLogDTO[];
};
