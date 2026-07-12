import { adminDb } from "@/backend/infrastructure/firebase/firebase-admin";
import { canonicalRuleExpressionHash } from "@/backend/modules/guardrail/expression";
import type { UserGuardrailRuleDTO } from "@/backend/modules/guardrail/types";
import type {
  ConfirmedTradeLogDTO,
  GuardrailReactionDTO,
  OrderContextSnapshotDTO,
  TradeFeedbackDTO,
} from "@/backend/modules/logs/types";
import type { DailyInsightReport, DailyInsightSources } from "./daily-types";
import {
  AI_PROMPT_VERSION,
  ANALYSIS_VERSION,
  getDailyRange,
  isInRange,
  toIsoString,
  toTimeMs,
} from "./daily-core";

const usersRef = adminDb.collection("users");
const snapshotsRef = adminDb.collection("order_context_snapshots");
const reactionsRef = adminDb.collection("guardrail_reactions");
const feedbacksRef = adminDb.collection("trade_feedbacks");
const confirmedTradesRef = adminDb.collection("confirmed_trade_logs");
const rulesRef = adminDb.collection("user_guardrail_rules");

function getReportRef(userId: string, date: string) {
  return adminDb.collection("users").doc(userId).collection("dailyInsights").doc(date);
}

export function cleanUndefined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined),
  ) as T;
}

export function snapshotDocToDTO(
  id: string,
  data: FirebaseFirestore.DocumentData,
): OrderContextSnapshotDTO {
  return {
    snapshotId: data.snapshotId ?? id,
    userId: data.userId,
    attemptId: data.attemptId ?? null,
    snapshotTrigger: data.snapshotTrigger,
    capturedAt: toIsoString(data.capturedAt),
    orderTime: data.orderTime ?? null,
    orderTimeMinutes: data.orderTimeMinutes ?? null,
    market: data.market,
    side: data.side,
    orderMode: data.orderMode,
    entryPoint: data.entryPoint ?? "UNKNOWN",
    intentPrice: data.intentPrice ?? null,
    intentQuantity: data.intentQuantity ?? null,
    intentAmount: data.intentAmount ?? null,
    requestedBalanceRatio: data.requestedBalanceRatio ?? null,
    draftDurationMs: data.draftDurationMs ?? null,
    lastEditToSnapshotMs: data.lastEditToSnapshotMs ?? null,
    draftEditCount: data.draftEditCount ?? null,
    amountChangeRate: data.amountChangeRate ?? null,
    modeChangedToMarket: data.modeChangedToMarket ?? null,
    orderbookClickToSnapshotMs: data.orderbookClickToSnapshotMs ?? null,
    orderIntentCount1m: data.orderIntentCount1m ?? 0,
    actualOrderCreatedCount10m: data.actualOrderCreatedCount10m ?? null,
    sameSideIntentCount1m: data.sameSideIntentCount1m ?? 0,
    marketChangeCount5m: data.marketChangeCount5m ?? 0,
    sideChangeCount3m: data.sideChangeCount3m ?? 0,
    priceEditCount3m: data.priceEditCount3m ?? 0,
    quantityEditCount3m: data.quantityEditCount3m ?? 0,
    amountEditCount3m: data.amountEditCount3m ?? 0,
    inputRevertCount: data.inputRevertCount ?? 0,
    priceDirectionChangeCount: data.priceDirectionChangeCount ?? 0,
    priceChangeRate: data.priceChangeRate ?? null,
    orderModeChangeCount3m: data.orderModeChangeCount3m ?? 0,
    allocationPresetPercent: data.allocationPresetPercent ?? null,
    draftResetCount3m: data.draftResetCount3m ?? null,
    matchedRuleIdsAtSnapshot: data.matchedRuleIdsAtSnapshot ?? [],
    primaryShownRuleId: data.primaryShownRuleId ?? null,
    shownRuleIds: data.shownRuleIds ?? [],
    ruleSnapshot: data.ruleSnapshot ?? null,
    ruleSnapshots: data.ruleSnapshots ?? [],
    ruleEvaluationSnapshots: data.ruleEvaluationSnapshots ?? [],
    tradePriceAtSnapshot: data.tradePriceAtSnapshot ?? null,
    shortTermReturn5m: data.shortTermReturn5m ?? null,
    signedChangeRate: data.signedChangeRate ?? null,
    spreadRate: data.spreadRate ?? null,
    marketRiskFlags: data.marketRiskFlags ?? [],
    pricePositionIn5mRange: data.pricePositionIn5mRange ?? null,
    volumeSpikeRatio5m: data.volumeSpikeRatio5m ?? null,
    baseAssetAvgBuyPriceBeforeSnapshot: data.baseAssetAvgBuyPriceBeforeSnapshot ?? null,
    priceVsAvgBuyRateAtSnapshot: data.priceVsAvgBuyRateAtSnapshot ?? null,
    createdAt: toIsoString(data.createdAt),
    updatedAt: toIsoString(data.updatedAt),
  };
}

export function reactionDocToDTO(
  id: string,
  data: FirebaseFirestore.DocumentData,
): GuardrailReactionDTO {
  return {
    reactionId: data.reactionId ?? id,
    userId: data.userId,
    snapshotId: data.snapshotId,
    action: data.action,
    reactedAt: toIsoString(data.reactedAt),
    reactionUiVersion: data.reactionUiVersion ?? "v1",
    createdAt: toIsoString(data.createdAt),
    updatedAt: toIsoString(data.updatedAt),
  };
}

export function feedbackDocToDTO(
  id: string,
  data: FirebaseFirestore.DocumentData,
): TradeFeedbackDTO {
  return {
    feedbackId: data.feedbackId ?? id,
    userId: data.userId,
    attemptId: data.attemptId,
    feedbackStatus: data.feedbackStatus,
    selfAssessment: data.selfAssessment ?? null,
    feedbackShownAt: toIsoString(data.feedbackShownAt),
    respondedAt: toIsoString(data.respondedAt),
    feedbackUiVersion: data.feedbackUiVersion ?? "v1",
    createdAt: toIsoString(data.createdAt),
    updatedAt: toIsoString(data.updatedAt),
  };
}

export function tradeDocToDTO(
  id: string,
  data: FirebaseFirestore.DocumentData,
): ConfirmedTradeLogDTO {
  return {
    tradeLogId: data.tradeLogId ?? id,
    userId: data.userId,
    attemptId: data.attemptId ?? null,
    upbitOrderUuid: data.upbitOrderUuid,
    orderCreatedAt: toIsoString(data.orderCreatedAt),
    market: data.market,
    side: data.side,
    ordType: data.ordType,
    limitPrice: data.limitPrice ?? null,
    requestedFunds: data.requestedFunds ?? null,
    requestedVolume: data.requestedVolume ?? null,
    timeInForce: data.timeInForce ?? null,
    state: data.state ?? null,
    executedVolume: data.executedVolume ?? null,
    executedFunds: data.executedFunds ?? null,
    paidFee: data.paidFee ?? null,
    remainingVolume: data.remainingVolume ?? null,
    outcomeObservedAt: data.outcomeObservedAt ? toIsoString(data.outcomeObservedAt) : null,
    createdAt: toIsoString(data.createdAt),
    updatedAt: toIsoString(data.updatedAt),
  };
}

export function ruleDocToDTO(
  id: string,
  data: FirebaseFirestore.DocumentData,
): UserGuardrailRuleDTO {
  return {
    ruleId: data.ruleId ?? id,
    userId: data.userId,
    name: data.name,
    description: data.description ?? null,
    isEnabled: data.isEnabled,
    priority: data.priority,
    riskLevel: data.riskLevel,
    visualMode: data.visualMode,
    expression: data.expression,
    warningTitle: data.warningTitle,
    warningMessage: data.warningMessage,
    requiresPrivateApi: data.requiresPrivateApi ?? false,
    schemaVersion: data.schemaVersion ?? "v1",
    createdAt: toIsoString(data.createdAt),
    updatedAt: toIsoString(data.updatedAt),
  };
}

export async function listOwnedDocs<T>(params: {
  collection: FirebaseFirestore.CollectionReference;
  userId: string;
  converter: (id: string, data: FirebaseFirestore.DocumentData) => T;
}) {
  const snapshot = await params.collection.where("userId", "==", params.userId).get();
  return snapshot.docs.map((doc) => params.converter(doc.id, doc.data()));
}

export async function loadDailyInsightSources(params: {
  userId: string;
  date: string;
  timezone: string;
  generatedAt?: string;
}): Promise<DailyInsightSources> {
  const generatedAt = params.generatedAt ?? new Date().toISOString();
  const range = getDailyRange(params.date, params.timezone);
  const virtualFrom = new Date(new Date(generatedAt).getTime() - 24 * 60 * 60 * 1000).toISOString();
  const suggestionFrom = new Date(new Date(generatedAt).getTime() - 90 * 24 * 60 * 60 * 1000).toISOString();

  const [allSnapshots, allReactions, allFeedbacks, allTrades, rules] = await Promise.all([
    listOwnedDocs({
      collection: snapshotsRef,
      userId: params.userId,
      converter: snapshotDocToDTO,
    }),
    listOwnedDocs({
      collection: reactionsRef,
      userId: params.userId,
      converter: reactionDocToDTO,
    }),
    listOwnedDocs({
      collection: feedbacksRef,
      userId: params.userId,
      converter: feedbackDocToDTO,
    }),
    listOwnedDocs({
      collection: confirmedTradesRef,
      userId: params.userId,
      converter: tradeDocToDTO,
    }),
    listOwnedDocs({
      collection: rulesRef,
      userId: params.userId,
      converter: ruleDocToDTO,
    }),
  ]);

  const snapshots = allSnapshots.filter(
    (snapshot) =>
      isInRange(snapshot.capturedAt, range.from, generatedAt, true) ||
      isInRange(snapshot.capturedAt, virtualFrom, generatedAt, true),
  );
  const reactions = allReactions.filter(
    (reaction) =>
      isInRange(reaction.reactedAt, range.from, generatedAt, true) ||
      isInRange(reaction.reactedAt, virtualFrom, generatedAt, true),
  );
  const feedbacks = allFeedbacks.filter((feedback) =>
    isInRange(feedback.respondedAt, range.from, generatedAt, true),
  );
  const trades = allTrades.filter((trade) =>
    isInRange(trade.orderCreatedAt, range.from, generatedAt, true),
  );
  const suggestionSnapshots = allSnapshots.filter((snapshot) =>
    isInRange(snapshot.capturedAt, suggestionFrom, generatedAt, true),
  );
  const suggestionReactions = allReactions.filter((reaction) =>
    isInRange(reaction.reactedAt, suggestionFrom, generatedAt, true),
  );
  const suggestionFeedbacks = allFeedbacks.filter((feedback) =>
    isInRange(feedback.respondedAt, suggestionFrom, generatedAt, true),
  );
  const suggestionTrades = allTrades.filter((trade) =>
    isInRange(trade.orderCreatedAt, suggestionFrom, generatedAt, true),
  );

  return {
    snapshots,
    reactions,
    feedbacks,
    trades,
    rules,
    suggestionSnapshots,
    suggestionReactions,
    suggestionFeedbacks,
    suggestionTrades,
  };
}

export async function getDailyInsightReport(params: {
  userId: string;
  date: string;
}): Promise<DailyInsightReport | null> {
  const snapshot = await getReportRef(params.userId, params.date).get();
  if (!snapshot.exists) return null;
  const data = snapshot.data() as DailyInsightReport | undefined;
  if (!data || data.userId !== params.userId) return null;
  return data;
}

export async function listDailyInsightReports(params: {
  userId: string;
  limit?: number;
}): Promise<DailyInsightReport[]> {
  const limit = Math.min(Math.max(params.limit ?? 20, 1), 50);
  const snapshot = await adminDb
    .collection("users")
    .doc(params.userId)
    .collection("dailyInsights")
    .orderBy("generatedAt", "desc")
    .limit(limit)
    .get();

  return snapshot.docs
    .map((doc) => doc.data() as DailyInsightReport)
    .filter((report) => report.userId === params.userId);
}

export async function getLatestDailyInsightReportForDate(params: {
  userId: string;
  date: string;
}): Promise<DailyInsightReport | null> {
  const snapshot = await adminDb
    .collection("users")
    .doc(params.userId)
    .collection("dailyInsights")
    .where("date", "==", params.date)
    .limit(50)
    .get();

  return snapshot.docs
    .map((doc) => doc.data() as DailyInsightReport)
    .filter((report) => report.userId === params.userId)
    .sort(
      (left, right) =>
        toTimeMs(right.generatedAt || right.updatedAt || right.createdAt) -
        toTimeMs(left.generatedAt || left.updatedAt || left.createdAt),
    )[0] ?? null;
}

export async function getLatestCompletedDailyInsightReport(userId: string) {
  const reports = await listDailyInsightReports({ userId, limit: 20 });
  return (
    reports.find((report) => report.status === "COMPLETED") ??
    reports.find(
      (report) => report.status === "PARTIAL" && report.overview !== null,
    ) ??
    null
  );
}

export async function tryStartDailyReportGeneration(params: {
  userId: string;
  reportId: string;
  date: string;
  timezone: string;
  inputHash: string;
  sourceCounts: DailyInsightReport["sourceCounts"];
}): Promise<{ started: true } | { started: false; report: DailyInsightReport }> {
  const reportRef = getReportRef(params.userId, params.reportId);
  const now = new Date().toISOString();
  let existingReport: DailyInsightReport | null = null;
  let started = false;

  await adminDb.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(reportRef);
    const data = snapshot.data() as DailyInsightReport | undefined;
    if (snapshot.exists && data) {
      const updatedAtMs = new Date(data.updatedAt || data.createdAt).getTime();
      const isFreshGenerating =
        data.status === "GENERATING" &&
        Number.isFinite(updatedAtMs) &&
        Date.now() - updatedAtMs < 10 * 60 * 1000;

      if (isFreshGenerating) {
        existingReport = data;
        return;
      }
    }

    const baseReport: DailyInsightReport = {
      reportId: params.reportId,
      userId: params.userId,
      date: params.date,
      timezone: params.timezone,
      status: "GENERATING",
      analysisStatus: {
        overview: "FAILED",
        fieldAnalysis: "FAILED",
      },
      promptVersion: AI_PROMPT_VERSION,
      analysisVersion: ANALYSIS_VERSION,
      inputHash: params.inputHash,
      sourceCounts: params.sourceCounts,
      timeline: [],
      orderFlows: [],
      metrics: {
        cancelledOrderVirtualPnl: {
          status: "NO_MATCHING_DATA",
          window: { from: now, to: now },
          sampleCount: 0,
          totalPositiveVirtualPnl: "0",
          totalNegativeVirtualPnl: "0",
          netVirtualPnl: "0",
          items: [],
          disclaimer: "",
        },
        waitingPriceEffect: {
          status: "NO_MATCHING_DATA",
          sampleCount: 0,
          items: [],
          disclaimer: "",
        },
        reducedExposure: {
          status: "NO_MATCHING_DATA",
          sampleCount: 0,
          totalReducedExposureAmount: "0",
          items: [],
          disclaimer: "",
        },
        feedbackPnlComparison: {
          status: "INSUFFICIENT_DATA",
          groups: {
            PLANNED: {},
            EMOTIONAL: {},
          },
          disclaimer: "",
        },
      },
      dataAvailability: undefined,
      overview: null,
      fieldAnalysis: null,
      suggestions: {
        newGuardrail: null,
        modification: null,
        newGuardrails: [],
        modifications: [],
        guardrailModifications: [],
      },
      suggestionStatus: "NOT_IMPLEMENTED",
      suggestionDiagnostics: undefined,
      generatedAt: null,
      createdAt: now,
      updatedAt: now,
      errorCode: null,
      errorMessage: null,
    };

    transaction.set(reportRef, cleanUndefined(baseReport));
    started = true;
  });

  if (!started && existingReport) {
    return { started: false, report: existingReport };
  }

  return { started: true };
}

export async function saveCompletedDailyInsightReport(report: DailyInsightReport) {
  const now = new Date().toISOString();
  const nextReport: DailyInsightReport = {
    ...report,
    status: "COMPLETED",
    generatedAt: report.generatedAt ?? now,
    updatedAt: now,
    errorCode: null,
    errorMessage: null,
  };
  await getReportRef(report.userId, report.reportId || report.date).set(cleanUndefined(nextReport));
  return nextReport;
}

export async function saveDailyInsightReport(report: DailyInsightReport) {
  const now = new Date().toISOString();
  const nextReport: DailyInsightReport = {
    ...report,
    generatedAt: report.generatedAt ?? now,
    updatedAt: now,
    errorCode: report.status === "FAILED" ? report.errorCode : null,
    errorMessage: report.status === "FAILED" ? report.errorMessage : null,
  };
  await getReportRef(report.userId, report.reportId || report.date).set(cleanUndefined(nextReport));
  return nextReport;
}

export async function saveFailedDailyInsightReport(params: {
  userId: string;
  reportId: string;
  date: string;
  timezone: string;
  inputHash: string;
  sourceCounts: DailyInsightReport["sourceCounts"];
  errorCode: string;
  errorMessage: string;
}) {
  const existing = await getDailyInsightReport({
    userId: params.userId,
    date: params.reportId,
  });
  const now = new Date().toISOString();
  const failedReport: DailyInsightReport = {
    reportId: params.reportId,
    userId: params.userId,
    date: params.date,
    timezone: params.timezone,
    status: "FAILED",
    analysisStatus: existing?.analysisStatus ?? {
      overview: existing?.overview ? "COMPLETED" : "FAILED",
      fieldAnalysis: existing?.fieldAnalysis ? "COMPLETED" : "FAILED",
    },
    promptVersion: existing?.promptVersion ?? AI_PROMPT_VERSION,
    analysisVersion: existing?.analysisVersion ?? ANALYSIS_VERSION,
    inputHash: params.inputHash,
    sourceCounts: params.sourceCounts,
    timeline: existing?.timeline ?? [],
    orderFlows: existing?.orderFlows ?? [],
    metrics: existing?.metrics ?? {
      cancelledOrderVirtualPnl: {
        status: "ERROR",
        window: { from: now, to: now },
        sampleCount: 0,
        totalPositiveVirtualPnl: "0",
        totalNegativeVirtualPnl: "0",
        netVirtualPnl: "0",
        items: [],
        disclaimer: "",
      },
      waitingPriceEffect: {
        status: "ERROR",
        sampleCount: 0,
        items: [],
        disclaimer: "",
      },
      reducedExposure: {
        status: "ERROR",
        sampleCount: 0,
        totalReducedExposureAmount: "0",
        items: [],
        disclaimer: "",
      },
      feedbackPnlComparison: {
        status: "ERROR",
        groups: { PLANNED: {}, EMOTIONAL: {} },
        disclaimer: "",
      },
    },
    dataAvailability: existing?.dataAvailability,
    overview: existing?.overview ?? null,
    fieldAnalysis: existing?.fieldAnalysis ?? null,
    suggestions: existing?.suggestions ?? {
      newGuardrail: null,
      modification: null,
      newGuardrails: [],
      modifications: [],
      guardrailModifications: [],
    },
    suggestionStatus: existing?.suggestionStatus ?? "NOT_IMPLEMENTED",
    suggestionDiagnostics: existing?.suggestionDiagnostics,
    generatedAt: existing?.generatedAt ?? now,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    errorCode: params.errorCode,
    errorMessage: params.errorMessage,
  };
  await getReportRef(params.userId, params.reportId).set(cleanUndefined(failedReport));
  return failedReport;
}

export async function findDailyInsightSuggestion(params: {
  userId: string;
  date?: string;
  suggestionId: string;
}): Promise<{
  report: DailyInsightReport;
  suggestion: NonNullable<DailyInsightReport["suggestions"]>["newGuardrails"][number] | NonNullable<DailyInsightReport["suggestions"]>["guardrailModifications"][number];
} | null> {
  const reports = params.date
    ? [await getDailyInsightReport({ userId: params.userId, date: params.date })].filter(
        Boolean,
      ) as DailyInsightReport[]
    : await listDailyInsightReports({ userId: params.userId, limit: 50 });
  for (const report of reports) {
    if (report.suggestions?.newGuardrail?.suggestionId === params.suggestionId) {
      return { report, suggestion: report.suggestions.newGuardrail };
    }
    if (report.suggestions?.modification?.suggestionId === params.suggestionId) {
      return { report, suggestion: report.suggestions.modification };
    }

    const newGuardrail = (report.suggestions?.newGuardrails || []).find(
      (suggestion) => suggestion.suggestionId === params.suggestionId,
    );
    if (newGuardrail) return { report, suggestion: newGuardrail };

    const modifications = [
      ...(report.suggestions?.guardrailModifications || []),
      ...(report.suggestions?.modifications || []),
    ];
    const modification = modifications.find(
      (suggestion) => suggestion.suggestionId === params.suggestionId,
    );
    if (modification) return { report, suggestion: modification };
  }
  return null;
}

export async function updateDailyInsightSuggestionStatus(params: {
  userId: string;
  date: string;
  suggestionId: string;
  status: "ACCEPTED" | "DISMISSED" | "EXPIRED";
  acceptedRuleId?: string | null;
}) {
  const reportRef = getReportRef(params.userId, params.date);
  const now = new Date().toISOString();
  let updatedReport: DailyInsightReport | null = null;

  await adminDb.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(reportRef);
    const report = snapshot.data() as DailyInsightReport | undefined;
    if (!snapshot.exists || !report || report.userId !== params.userId) return;

    const markOne = <T extends {
      suggestionId: string;
      status: string;
      acceptedAt?: string | null;
      dismissedAt?: string | null;
      acceptedRuleId?: string | null;
    } | null | undefined>(item: T): T =>
      item?.suggestionId === params.suggestionId
        ? {
            ...item,
            status: params.status,
            acceptedAt: params.status === "ACCEPTED" ? now : item.acceptedAt ?? null,
            dismissedAt: params.status === "DISMISSED" ? now : item.dismissedAt ?? null,
            acceptedRuleId:
              params.status === "ACCEPTED"
                ? params.acceptedRuleId ?? item.acceptedRuleId ?? null
                : item.acceptedRuleId ?? null,
          } as T
        : item;

    const mark = <T extends {
      suggestionId: string;
      status: string;
      acceptedAt?: string | null;
      dismissedAt?: string | null;
      acceptedRuleId?: string | null;
    }>(items: T[] = []) =>
      items.map((item) =>
        item.suggestionId === params.suggestionId
          ? markOne(item)
          : item,
      );

    const guardrailModifications = mark(report.suggestions?.guardrailModifications || []);
    const modifications = mark(report.suggestions?.modifications || guardrailModifications);
    updatedReport = {
      ...report,
      suggestions: {
        newGuardrail: markOne(report.suggestions?.newGuardrail),
        modification: markOne(report.suggestions?.modification),
        newGuardrails: mark(report.suggestions?.newGuardrails || []),
        guardrailModifications,
        modifications,
      },
      updatedAt: now,
    };
    transaction.set(reportRef, cleanUndefined(updatedReport));
  });

  return updatedReport;
}

export async function saveGuardrailSuggestionHistory(params: {
  userId: string;
  suggestionId: string;
  action: "ACCEPTED" | "DISMISSED";
  payload: Record<string, unknown>;
}) {
  const now = new Date().toISOString();
  await adminDb
    .collection("users")
    .doc(params.userId)
    .collection("guardrailSuggestionHistory")
    .doc(`${params.suggestionId}-${params.action.toLowerCase()}`)
    .set({
      suggestionId: params.suggestionId,
      action: params.action,
      payload: params.payload,
      createdAt: now,
    });
}

export async function listDismissedSuggestionCandidateKeys(params: {
  userId: string;
  since: string;
}) {
  const snapshot = await adminDb
    .collection("users")
    .doc(params.userId)
    .collection("guardrailSuggestionHistory")
    .get();
  const sinceMs = new Date(params.since).getTime();
  const keys = new Set<string>();
  for (const doc of snapshot.docs) {
    const data = doc.data();
    if (data.action !== "DISMISSED") continue;
    const createdAtMs = toTimeMs(data.createdAt);
    if (Number.isFinite(sinceMs) && createdAtMs < sinceMs) continue;
    const candidateKey = data.payload?.candidateKey;
    if (typeof candidateKey === "string" && candidateKey) {
      keys.add(candidateKey);
    }
  }
  return keys;
}

function getSuggestionFromReport(report: DailyInsightReport, suggestionId: string) {
  if (report.suggestions?.newGuardrail?.suggestionId === suggestionId) {
    return report.suggestions.newGuardrail;
  }
  if (report.suggestions?.modification?.suggestionId === suggestionId) {
    return report.suggestions.modification;
  }
  return (
    (report.suggestions?.newGuardrails || []).find(
      (suggestion) => suggestion.suggestionId === suggestionId,
    ) ||
    (report.suggestions?.guardrailModifications || []).find(
      (suggestion) => suggestion.suggestionId === suggestionId,
    ) ||
    (report.suggestions?.modifications || []).find(
      (suggestion) => suggestion.suggestionId === suggestionId,
    ) ||
    null
  );
}

function markSuggestionAccepted(
  report: DailyInsightReport,
  suggestionId: string,
  acceptedRuleId: string,
  now: string,
) {
  const markOne = <T extends {
    suggestionId: string;
    status: string;
    acceptedAt?: string | null;
    acceptedRuleId?: string | null;
  } | null | undefined>(item: T): T =>
    item?.suggestionId === suggestionId
      ? {
          ...item,
          status: "ACCEPTED",
          acceptedAt: now,
          acceptedRuleId,
        } as T
      : item;
  const mark = <T extends {
    suggestionId: string;
    status: string;
    acceptedAt?: string | null;
    acceptedRuleId?: string | null;
  }>(items: T[] = []) => items.map((item) => markOne(item));
  return {
    ...report,
    suggestions: {
      newGuardrail: markOne(report.suggestions?.newGuardrail),
      modification: markOne(report.suggestions?.modification),
      newGuardrails: mark(report.suggestions?.newGuardrails || []),
      guardrailModifications: mark(report.suggestions?.guardrailModifications || []),
      modifications: mark(report.suggestions?.modifications || []),
    },
    updatedAt: now,
  };
}

export async function acceptNewGuardrailSuggestionInTransaction(params: {
  userId: string;
  date: string;
  suggestionId: string;
  requiresPrivateApi: boolean;
}): Promise<{ status: "ACCEPTED"; rule: UserGuardrailRuleDTO }> {
  const reportRef = getReportRef(params.userId, params.date);
  const now = new Date().toISOString();
  const newRuleRef = rulesRef.doc();
  let acceptedRule: UserGuardrailRuleDTO | null = null;

  await adminDb.runTransaction(async (transaction) => {
    const reportSnapshot = await transaction.get(reportRef);
    const report = reportSnapshot.data() as DailyInsightReport | undefined;
    if (!reportSnapshot.exists || !report || report.userId !== params.userId) {
      throw new Error("SUGGESTION_NOT_FOUND");
    }
    const suggestion = getSuggestionFromReport(report, params.suggestionId);
    if (!suggestion || suggestion.type !== "NEW_GUARDRAIL") {
      throw new Error("SUGGESTION_NOT_FOUND");
    }
    if (suggestion.status === "ACCEPTED" && suggestion.acceptedRuleId) {
      const existingAccepted = await transaction.get(rulesRef.doc(suggestion.acceptedRuleId));
      if (existingAccepted.exists) {
        acceptedRule = ruleDocToDTO(existingAccepted.id, existingAccepted.data() ?? {});
        return;
      }
    }
    if (suggestion.status !== "PENDING") {
      throw new Error("SUGGESTION_ALREADY_HANDLED");
    }

    const rulesSnapshot = await transaction.get(
      rulesRef.where("userId", "==", params.userId),
    );
    const duplicate = rulesSnapshot.docs.find(
      (doc) => doc.data().sourceSuggestionCandidateKey === suggestion.candidateKey,
    );
    if (duplicate) {
      acceptedRule = ruleDocToDTO(duplicate.id, duplicate.data());
      transaction.set(
        reportRef,
        cleanUndefined(markSuggestionAccepted(report, params.suggestionId, duplicate.id, now)),
      );
      return;
    }

    const maxPriority = rulesSnapshot.docs.reduce(
      (max, doc) => Math.max(max, Number(doc.data().priority || 0)),
      0,
    );
    const proposed = suggestion.proposedRule;
    const data = {
      ruleId: newRuleRef.id,
      userId: params.userId,
      name: proposed.name,
      description: proposed.description ?? null,
      isEnabled: true,
      priority: maxPriority + 1,
      riskLevel: proposed.riskLevel,
      visualMode: proposed.visualMode,
      expression: proposed.expression,
      warningTitle: proposed.warningTitle,
      warningMessage: proposed.warningMessage,
      requiresPrivateApi: params.requiresPrivateApi,
      schemaVersion: "v1",
      sourceSuggestionCandidateKey: suggestion.candidateKey,
      createdAt: now,
      updatedAt: now,
    };
    transaction.set(newRuleRef, cleanUndefined(data));
    transaction.set(
      reportRef,
      cleanUndefined(markSuggestionAccepted(report, params.suggestionId, newRuleRef.id, now)),
    );
    transaction.set(
      usersRef
        .doc(params.userId)
        .collection("guardrailSuggestionHistory")
        .doc(`${params.suggestionId}-accepted`),
      {
        suggestionId: params.suggestionId,
        candidateKey: suggestion.candidateKey,
        action: "ACCEPTED",
        payload: { type: "NEW_GUARDRAIL", createdRuleId: newRuleRef.id },
        createdAt: now,
      },
    );
    acceptedRule = ruleDocToDTO(newRuleRef.id, data);
  });

  if (!acceptedRule) throw new Error("SUGGESTION_ACCEPT_FAILED");
  return { status: "ACCEPTED", rule: acceptedRule };
}

export async function acceptModificationSuggestionInTransaction(params: {
  userId: string;
  date: string;
  suggestionId: string;
  requiresPrivateApi: boolean;
}): Promise<{ status: "ACCEPTED"; rule: UserGuardrailRuleDTO }> {
  const reportRef = getReportRef(params.userId, params.date);
  const now = new Date().toISOString();
  let acceptedRule: UserGuardrailRuleDTO | null = null;

  await adminDb.runTransaction(async (transaction) => {
    const reportSnapshot = await transaction.get(reportRef);
    const report = reportSnapshot.data() as DailyInsightReport | undefined;
    if (!reportSnapshot.exists || !report || report.userId !== params.userId) {
      throw new Error("SUGGESTION_NOT_FOUND");
    }
    const suggestion = getSuggestionFromReport(report, params.suggestionId);
    if (!suggestion || suggestion.type !== "MODIFY_GUARDRAIL") {
      throw new Error("SUGGESTION_NOT_FOUND");
    }
    const ruleId = suggestion.ruleId || suggestion.guardrailId;
    if (!ruleId) throw new Error("RULE_NOT_FOUND");
    const ruleRef = rulesRef.doc(ruleId);
    const ruleSnapshot = await transaction.get(ruleRef);
    if (!ruleSnapshot.exists || ruleSnapshot.data()?.userId !== params.userId) {
      throw new Error("RULE_NOT_FOUND");
    }
    const currentRule = ruleDocToDTO(ruleSnapshot.id, ruleSnapshot.data() ?? {});
    if (suggestion.status === "ACCEPTED") {
      acceptedRule = currentRule;
      return;
    }
    if (suggestion.status !== "PENDING") {
      throw new Error("SUGGESTION_ALREADY_HANDLED");
    }
    if (
      suggestion.baseRuleHash &&
      canonicalRuleExpressionHash(currentRule.expression) !== suggestion.baseRuleHash
    ) {
      throw new Error("RULE_VERSION_CONFLICT");
    }
    const proposed = suggestion.proposedRule;
    const patch = {
      expression: proposed.expression,
      description: proposed.description ?? currentRule.description ?? null,
      warningTitle: proposed.warningTitle,
      warningMessage: proposed.warningMessage,
      requiresPrivateApi: params.requiresPrivateApi,
      riskLevel:
        proposed.riskLevel !== currentRule.riskLevel ? proposed.riskLevel : currentRule.riskLevel,
      visualMode:
        proposed.visualMode !== currentRule.visualMode ? proposed.visualMode : currentRule.visualMode,
      updatedAt: now,
    };
    transaction.set(ruleRef, cleanUndefined(patch), { merge: true });
    transaction.set(
      reportRef,
      cleanUndefined(markSuggestionAccepted(report, params.suggestionId, ruleId, now)),
    );
    transaction.set(
      usersRef.doc(params.userId).collection("guardrailRuleChangeHistory").doc(),
      {
        ruleId,
        suggestionId: params.suggestionId,
        candidateKey: suggestion.candidateKey ?? null,
        before: currentRule,
        diff: suggestion.diff ?? [],
        createdAt: now,
      },
    );
    transaction.set(
      usersRef
        .doc(params.userId)
        .collection("guardrailSuggestionHistory")
        .doc(`${params.suggestionId}-accepted`),
      {
        suggestionId: params.suggestionId,
        candidateKey: suggestion.candidateKey ?? null,
        action: "ACCEPTED",
        payload: { type: "MODIFY_GUARDRAIL", guardrailId: ruleId },
        createdAt: now,
      },
    );
    acceptedRule = {
      ...currentRule,
      ...patch,
      updatedAt: now,
    };
  });

  if (!acceptedRule) throw new Error("SUGGESTION_ACCEPT_FAILED");
  return { status: "ACCEPTED", rule: acceptedRule };
}
