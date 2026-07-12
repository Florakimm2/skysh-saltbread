import type {
  GuardrailModificationSuggestion,
  InsightDataAvailability,
  NewGuardrailSuggestion,
  OrderFlowViewModel,
} from "./daily-types";

export type WeeklyInsightPeriod = {
  weekKey: string;
  timezone: string;
  periodStart: string;
  periodEnd: string;
  periodState: "OPEN" | "CLOSED";
  isCurrentWeek: boolean;
};

export type WeeklyInsightStatusResponse = WeeklyInsightPeriod & {
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
  inputHashChanged: boolean;
};

export type WeeklyDailyBreakdown = {
  date: string;
  orderAttemptCount: number;
  shownGuardrailCount: number;
  proceedCount: number;
  reviewCount: number;
  closeCount: number;
  plannedFeedbackCount: number;
  regrettedFeedbackCount: number;
  confirmedTradeCount: number;
  active: boolean;
};

export type FlowLinkConfidence = "EXACT" | "INFERRED" | "UNRESOLVED";

export type WeeklyOrderFlowViewModel = OrderFlowViewModel & {
  linkConfidence?: FlowLinkConfidence;
  diagnostics?: Array<Record<string, unknown>>;
};

export type WeeklyTwentyFourHourVirtualOrderResult = {
  status: "AVAILABLE" | "NO_MATCHING_DATA" | "INSUFFICIENT_DATA" | "ERROR";
  sampleCount: number;
  notMaturedCount: number;
  missingPriceCount: number;
  missingEntryCount: number;
  netValue: string;
  items: Array<{
    snapshotId: string;
    capturedAt: string;
    targetAt: string;
    matchedPriceAt: string;
    market: string;
    side: "BUY" | "SELL";
    entryPrice: string;
    priceAt24h: string;
    quantity: string;
    value: string;
    returnRate: number;
    note: string;
  }>;
  disclaimer: string;
};

export type WeeklyInsightMetrics = {
  twentyFourHourVirtualOrderResult: WeeklyTwentyFourHourVirtualOrderResult;
  waitingPriceEffect: Record<string, unknown>;
  reducedExposure: Record<string, unknown>;
  feedbackPnlComparison: Record<string, unknown>;
};

export type WeeklyOverview = {
  summary: string;
  flameStatus: string;
  cards: Array<{
    title: string;
    description: string;
    severity: string;
    evidence?: Record<string, unknown>;
    evidenceConfidence?: string;
  }>;
};

export type WeeklyFieldAnalysis = {
  topics: Array<{
    topic_key: string;
    topic_label: string;
    headline: string;
    analysis: string;
    severity: string;
    evidence?: Record<string, unknown>;
  }>;
  oneLineAdvice: string;
};

export type StoredNewGuardrailSuggestion = NewGuardrailSuggestion;
export type StoredGuardrailModificationSuggestion = GuardrailModificationSuggestion;
export type StoredSuggestion =
  | StoredNewGuardrailSuggestion
  | StoredGuardrailModificationSuggestion;

export type SuggestionAnalysisResult = {
  status: "AVAILABLE" | "INSUFFICIENT_DATA" | "NO_SUGGESTION" | "ERROR";
  reasonCode: string | null;
  evidenceCount: number;
  activeDays: number;
  evaluationMode: "IN_SAMPLE" | "TEMPORAL_HOLDOUT" | null;
  suggestion: StoredSuggestion | null;
};

export type WeeklyInsightSources = {
  snapshots: import("@/backend/modules/logs/types").OrderContextSnapshotDTO[];
  reactions: import("@/backend/modules/logs/types").GuardrailReactionDTO[];
  feedbacks: import("@/backend/modules/logs/types").TradeFeedbackDTO[];
  trades: import("@/backend/modules/logs/types").ConfirmedTradeLogDTO[];
  rules: import("@/backend/modules/guardrail/types").UserGuardrailRuleDTO[];
  suggestionSnapshots?: import("@/backend/modules/logs/types").OrderContextSnapshotDTO[];
  suggestionReactions?: import("@/backend/modules/logs/types").GuardrailReactionDTO[];
  suggestionFeedbacks?: import("@/backend/modules/logs/types").TradeFeedbackDTO[];
  suggestionTrades?: import("@/backend/modules/logs/types").ConfirmedTradeLogDTO[];
  period?: WeeklyInsightPeriod & { periodEndExclusive?: string };
};

export type WeeklyInsightReport = {
  reportId: string;
  userId: string;
  weekKey: string;
  timezone: string;
  periodStart: string;
  periodEnd: string;
  periodState: "OPEN" | "CLOSED";
  reportStatus: "GENERATING" | "COMPLETED" | "PARTIAL" | "FAILED" | "STALE";
  reportVersion: number;
  inputHash: string;
  sourceCounts: {
    activeDays: number;
    snapshots: number;
    orderAttempts: number;
    shownGuardrails: number;
    reactions: number;
    proceedCount: number;
    reviewCount: number;
    closeCount: number;
    answeredFeedbacks: number;
    plannedFeedbacks: number;
    regrettedFeedbacks: number;
    dismissedFeedbacks: number;
    confirmedTrades: number;
    uniqueMarkets: number;
  };
  dailyBreakdown: WeeklyDailyBreakdown[];
  orderFlows: WeeklyOrderFlowViewModel[];
  metrics: WeeklyInsightMetrics;
  overview: WeeklyOverview | null;
  fieldAnalysis: WeeklyFieldAnalysis | null;
  dataAvailability: InsightDataAvailability;
  suggestionAnalysis: {
    newGuardrail: SuggestionAnalysisResult;
    modification: SuggestionAnalysisResult;
  };
  suggestions: {
    newGuardrail: StoredNewGuardrailSuggestion | null;
    modification: StoredGuardrailModificationSuggestion | null;
  };
  promptVersion: string;
  analysisVersion: string;
  algorithmVersion: string;
  weeklyReportSchemaVersion: string;
  generatedAt: string | null;
  createdAt: string;
  updatedAt: string;
  errorCode: string | null;
  errorMessage: string | null;
  debugSummary?: Record<string, unknown>;
};
