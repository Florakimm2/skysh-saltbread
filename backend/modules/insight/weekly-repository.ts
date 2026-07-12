import { adminDb } from "@/backend/infrastructure/firebase/firebase-admin";
import { canonicalRuleExpressionHash } from "@/backend/modules/guardrail/expression";
import type { UserGuardrailRuleDTO } from "@/backend/modules/guardrail/types";
import {
  cleanUndefined,
  feedbackDocToDTO,
  listOwnedDocs,
  reactionDocToDTO,
  ruleDocToDTO,
  snapshotDocToDTO,
  tradeDocToDTO,
} from "./daily-repository";
import type { WeeklyInsightPeriod, WeeklyInsightReport, WeeklyInsightSources } from "./weekly-types";
import {
  getWeeklyPeriod,
  isInRange,
  toIsoString,
  toTimeMs,
  WEEKLY_ANALYSIS_VERSION,
  WEEKLY_GUARDRAIL_SUGGESTION_ALGORITHM_VERSION,
  WEEKLY_PROMPT_VERSION,
  WEEKLY_REPORT_SCHEMA_VERSION,
} from "./weekly-core";

const usersRef = adminDb.collection("users");
const snapshotsRef = adminDb.collection("order_context_snapshots");
const reactionsRef = adminDb.collection("guardrail_reactions");
const feedbacksRef = adminDb.collection("trade_feedbacks");
const confirmedTradesRef = adminDb.collection("confirmed_trade_logs");
const rulesRef = adminDb.collection("user_guardrail_rules");

function weeklyReportRef(userId: string, weekKey: string) {
  return usersRef.doc(userId).collection("weeklyInsights").doc(weekKey);
}

function emptySuggestionAnalysis(status: WeeklyInsightReport["suggestionAnalysis"]["newGuardrail"]["status"]) {
  return {
    status,
    reasonCode: status === "INSUFFICIENT_DATA" ? "not_analyzed_yet" : null,
    evidenceCount: 0,
    activeDays: 0,
    evaluationMode: null,
    suggestion: null,
  };
}

function emptyMetrics(now: string): WeeklyInsightReport["metrics"] {
  return {
    twentyFourHourVirtualOrderResult: {
      status: "NO_MATCHING_DATA",
      sampleCount: 0,
      notMaturedCount: 0,
      missingPriceCount: 0,
      missingEntryCount: 0,
      netValue: "0",
      items: [],
      disclaimer: "",
    },
    waitingPriceEffect: {
      status: "NO_MATCHING_DATA",
      sampleCount: 0,
      items: [],
      disclaimer: "",
      generatedAt: now,
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
      groups: { PLANNED: {}, EMOTIONAL: {} },
      disclaimer: "",
    },
  };
}

export async function loadWeeklyInsightSources(params: {
  userId: string;
  weekKey: string;
  timezone: string;
  generatedAt?: string;
  suggestionHistoryDays?: number;
}): Promise<WeeklyInsightSources> {
  const generatedAt = params.generatedAt ?? new Date().toISOString();
  const period = getWeeklyPeriod({
    weekKey: params.weekKey,
    timezone: params.timezone,
    now: generatedAt,
  }) as WeeklyInsightPeriod & { periodEndExclusive: string };
  const suggestionFrom = new Date(
    new Date(generatedAt).getTime() -
      (params.suggestionHistoryDays ?? 90) * 24 * 60 * 60 * 1000,
  ).toISOString();

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

  return {
    snapshots: allSnapshots.filter((snapshot) =>
      isInRange(snapshot.capturedAt, period.periodStart, period.periodEndExclusive),
    ),
    reactions: allReactions.filter((reaction) =>
      isInRange(reaction.reactedAt, period.periodStart, period.periodEndExclusive),
    ),
    feedbacks: allFeedbacks.filter((feedback) =>
      isInRange(feedback.respondedAt, period.periodStart, period.periodEndExclusive),
    ),
    trades: allTrades.filter((trade) =>
      isInRange(trade.orderCreatedAt, period.periodStart, period.periodEndExclusive),
    ),
    rules,
    suggestionSnapshots: allSnapshots.filter((snapshot) =>
      isInRange(snapshot.capturedAt, suggestionFrom, generatedAt, true),
    ),
    suggestionReactions: allReactions.filter((reaction) =>
      isInRange(reaction.reactedAt, suggestionFrom, generatedAt, true),
    ),
    suggestionFeedbacks: allFeedbacks.filter((feedback) =>
      isInRange(feedback.respondedAt, suggestionFrom, generatedAt, true),
    ),
    suggestionTrades: allTrades.filter((trade) =>
      isInRange(trade.orderCreatedAt, suggestionFrom, generatedAt, true),
    ),
    period,
  };
}

export async function getWeeklyInsightReport(params: {
  userId: string;
  weekKey: string;
}): Promise<WeeklyInsightReport | null> {
  const snapshot = await weeklyReportRef(params.userId, params.weekKey).get();
  if (!snapshot.exists) return null;
  const data = snapshot.data() as WeeklyInsightReport | undefined;
  return data?.userId === params.userId ? data : null;
}

export async function listWeeklyInsightReports(params: {
  userId: string;
  limit?: number;
}): Promise<WeeklyInsightReport[]> {
  const limit = Math.min(Math.max(params.limit ?? 20, 1), 50);
  const snapshot = await usersRef
    .doc(params.userId)
    .collection("weeklyInsights")
    .orderBy("generatedAt", "desc")
    .limit(limit)
    .get();
  const latestByWeek = new Map<string, WeeklyInsightReport>();
  for (const doc of snapshot.docs) {
    const report = doc.data() as WeeklyInsightReport;
    if (report.userId !== params.userId) continue;
    const current = latestByWeek.get(report.weekKey);
    if (!current || toTimeMs(report.updatedAt) >= toTimeMs(current.updatedAt)) {
      latestByWeek.set(report.weekKey, report);
    }
  }
  return [...latestByWeek.values()].sort(
    (left, right) =>
      toTimeMs(right.generatedAt || right.updatedAt || right.createdAt) -
      toTimeMs(left.generatedAt || left.updatedAt || left.createdAt),
  );
}

export async function getLatestWeeklyInsight(params: { userId: string }) {
  const reports = await listWeeklyInsightReports({ userId: params.userId, limit: 20 });
  return (
    reports.find((report) => report.reportStatus === "COMPLETED") ??
    reports.find((report) => report.reportStatus === "PARTIAL" && report.overview) ??
    null
  );
}

export async function tryStartWeeklyReportGeneration(params: {
  userId: string;
  period: {
    weekKey: string;
    timezone: string;
    periodStart: string;
    periodEnd: string;
    periodState: "OPEN" | "CLOSED";
  };
  inputHash: string;
  sourceCounts: WeeklyInsightReport["sourceCounts"];
  dailyBreakdown: WeeklyInsightReport["dailyBreakdown"];
}): Promise<{ started: true; reportVersion: number } | { started: false; report: WeeklyInsightReport }> {
  const reportRef = weeklyReportRef(params.userId, params.period.weekKey);
  const now = new Date().toISOString();
  let existingReport: WeeklyInsightReport | null = null;
  let nextVersion = 1;
  let started = false;

  await adminDb.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(reportRef);
    const existing = snapshot.data() as WeeklyInsightReport | undefined;
    if (snapshot.exists && existing) {
      const isSameHashCompleted =
        existing.inputHash === params.inputHash &&
        ["COMPLETED", "PARTIAL"].includes(existing.reportStatus);
      const isFreshGenerating =
        existing.reportStatus === "GENERATING" &&
        Date.now() - toTimeMs(existing.updatedAt || existing.createdAt) < 10 * 60 * 1000;
      if (isSameHashCompleted || isFreshGenerating) {
        existingReport = existing;
        return;
      }
      nextVersion = Math.max(1, (existing.reportVersion || 1) + 1);
      if (existing.reportStatus !== "GENERATING") {
        transaction.set(
          reportRef.collection("versions").doc(String(existing.reportVersion || 1)),
          cleanUndefined(existing),
        );
      }
    }

    const baseReport: WeeklyInsightReport = {
      reportId: params.period.weekKey,
      userId: params.userId,
      weekKey: params.period.weekKey,
      timezone: params.period.timezone,
      periodStart: params.period.periodStart,
      periodEnd: params.period.periodEnd,
      periodState: params.period.periodState,
      reportStatus: "GENERATING",
      reportVersion: nextVersion,
      inputHash: params.inputHash,
      sourceCounts: params.sourceCounts,
      dailyBreakdown: params.dailyBreakdown,
      orderFlows: [],
      metrics: emptyMetrics(now),
      overview: null,
      fieldAnalysis: null,
      dataAvailability: {
        planFeedback: { available: false, sampleCount: 0 },
        guardrailBehavior: {
          available: false,
          shownGuardrailCount: 0,
          reactionCount: 0,
          proceedCount: 0,
          reviewCount: 0,
          closeCount: 0,
        },
        orderInfo: { available: false, sampleCount: 0, uniqueMarketCount: 0 },
        behaviorTiming: { available: false, sampleCount: 0 },
        frequencyPattern: { available: false, sampleCount: 0 },
        marketContext: { available: false, sampleCount: 0 },
        personalTrade: { available: false, sampleCount: 0 },
        fee: { available: false, sampleCount: 0 },
        slippage: { available: false, sampleCount: 0 },
      },
      suggestionAnalysis: {
        newGuardrail: emptySuggestionAnalysis("INSUFFICIENT_DATA"),
        modification: emptySuggestionAnalysis("INSUFFICIENT_DATA"),
      },
      suggestions: { newGuardrail: null, modification: null },
      promptVersion: WEEKLY_PROMPT_VERSION,
      analysisVersion: WEEKLY_ANALYSIS_VERSION,
      algorithmVersion: WEEKLY_GUARDRAIL_SUGGESTION_ALGORITHM_VERSION,
      weeklyReportSchemaVersion: WEEKLY_REPORT_SCHEMA_VERSION,
      generatedAt: null,
      createdAt: snapshot.exists && existing ? existing.createdAt : now,
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
  return { started: true, reportVersion: nextVersion };
}

export async function saveWeeklyInsightReport(report: WeeklyInsightReport) {
  const reportRef = weeklyReportRef(report.userId, report.weekKey);
  const now = new Date().toISOString();
  await adminDb.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(reportRef);
    const existing = snapshot.data() as WeeklyInsightReport | undefined;
    if (
      snapshot.exists &&
      existing &&
      existing.inputHash !== report.inputHash &&
      existing.reportStatus !== "GENERATING"
    ) {
      transaction.set(
        reportRef.collection("versions").doc(String(existing.reportVersion || 1)),
        cleanUndefined(existing),
      );
    }
    transaction.set(
      reportRef,
      cleanUndefined({
        ...report,
        generatedAt: report.generatedAt ?? now,
        updatedAt: now,
      }),
    );
  });
  return {
    ...report,
    generatedAt: report.generatedAt ?? now,
    updatedAt: now,
  };
}

export async function saveFailedWeeklyInsightReport(params: {
  userId: string;
  period: {
    weekKey: string;
    timezone: string;
    periodStart: string;
    periodEnd: string;
    periodState: "OPEN" | "CLOSED";
  };
  inputHash: string;
  sourceCounts: WeeklyInsightReport["sourceCounts"];
  dailyBreakdown: WeeklyInsightReport["dailyBreakdown"];
  reportVersion: number;
  errorCode: string;
  errorMessage: string;
}) {
  const now = new Date().toISOString();
  return saveWeeklyInsightReport({
    reportId: params.period.weekKey,
    userId: params.userId,
    weekKey: params.period.weekKey,
    timezone: params.period.timezone,
    periodStart: params.period.periodStart,
    periodEnd: params.period.periodEnd,
    periodState: params.period.periodState,
    reportStatus: "FAILED",
    reportVersion: params.reportVersion,
    inputHash: params.inputHash,
    sourceCounts: params.sourceCounts,
    dailyBreakdown: params.dailyBreakdown,
    orderFlows: [],
    metrics: emptyMetrics(now),
    overview: null,
    fieldAnalysis: null,
    dataAvailability: {
      planFeedback: { available: false, sampleCount: 0 },
      guardrailBehavior: {
        available: false,
        shownGuardrailCount: 0,
        reactionCount: 0,
        proceedCount: 0,
        reviewCount: 0,
        closeCount: 0,
      },
      orderInfo: { available: false, sampleCount: 0, uniqueMarketCount: 0 },
      behaviorTiming: { available: false, sampleCount: 0 },
      frequencyPattern: { available: false, sampleCount: 0 },
      marketContext: { available: false, sampleCount: 0 },
      personalTrade: { available: false, sampleCount: 0 },
      fee: { available: false, sampleCount: 0 },
      slippage: { available: false, sampleCount: 0 },
    },
    suggestionAnalysis: {
      newGuardrail: emptySuggestionAnalysis("ERROR"),
      modification: emptySuggestionAnalysis("ERROR"),
    },
    suggestions: { newGuardrail: null, modification: null },
    promptVersion: WEEKLY_PROMPT_VERSION,
    analysisVersion: WEEKLY_ANALYSIS_VERSION,
    algorithmVersion: WEEKLY_GUARDRAIL_SUGGESTION_ALGORITHM_VERSION,
    weeklyReportSchemaVersion: WEEKLY_REPORT_SCHEMA_VERSION,
    generatedAt: now,
    createdAt: now,
    updatedAt: now,
    errorCode: params.errorCode,
    errorMessage: params.errorMessage,
  });
}

function getSuggestionFromReport(report: WeeklyInsightReport, suggestionId: string) {
  if (report.suggestions.newGuardrail?.suggestionId === suggestionId) {
    return report.suggestions.newGuardrail;
  }
  if (report.suggestions.modification?.suggestionId === suggestionId) {
    return report.suggestions.modification;
  }
  return null;
}

function markSuggestion(
  report: WeeklyInsightReport,
  suggestionId: string,
  patch: Record<string, unknown>,
) {
  const markOne = <T extends { suggestionId: string } | null>(suggestion: T): T =>
    suggestion?.suggestionId === suggestionId
      ? ({ ...suggestion, ...patch } as T)
      : suggestion;
  return {
    ...report,
    suggestions: {
      newGuardrail: markOne(report.suggestions.newGuardrail),
      modification: markOne(report.suggestions.modification),
    },
    suggestionAnalysis: {
      newGuardrail:
        report.suggestionAnalysis.newGuardrail.suggestion?.suggestionId === suggestionId
          ? {
              ...report.suggestionAnalysis.newGuardrail,
              suggestion: markOne(report.suggestionAnalysis.newGuardrail.suggestion),
            }
          : report.suggestionAnalysis.newGuardrail,
      modification:
        report.suggestionAnalysis.modification.suggestion?.suggestionId === suggestionId
          ? {
              ...report.suggestionAnalysis.modification,
              suggestion: markOne(report.suggestionAnalysis.modification.suggestion),
            }
          : report.suggestionAnalysis.modification,
    },
    updatedAt: new Date().toISOString(),
  };
}

export async function updateWeeklyInsightSuggestionStatus(params: {
  userId: string;
  weekKey: string;
  suggestionId: string;
  status: "ACCEPTED" | "DISMISSED";
  acceptedRuleId?: string | null;
}) {
  const reportRef = weeklyReportRef(params.userId, params.weekKey);
  const now = new Date().toISOString();
  let updated: WeeklyInsightReport | null = null;
  await adminDb.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(reportRef);
    const report = snapshot.data() as WeeklyInsightReport | undefined;
    if (!snapshot.exists || !report || report.userId !== params.userId) return;
    updated = markSuggestion(report, params.suggestionId, {
      status: params.status,
      acceptedAt: params.status === "ACCEPTED" ? now : null,
      dismissedAt: params.status === "DISMISSED" ? now : null,
      acceptedRuleId: params.acceptedRuleId ?? null,
    });
    transaction.set(reportRef, cleanUndefined(updated));
  });
  return updated;
}

export async function findWeeklyInsightSuggestion(params: {
  userId: string;
  weekKey: string;
  suggestionId: string;
}) {
  const report = await getWeeklyInsightReport(params);
  if (!report) return null;
  const suggestion = getSuggestionFromReport(report, params.suggestionId);
  return suggestion ? { report, suggestion } : null;
}

export async function acceptWeeklyNewGuardrailSuggestionInTransaction(params: {
  userId: string;
  weekKey: string;
  suggestionId: string;
  requiresPrivateApi: boolean;
}): Promise<{ status: "ACCEPTED"; rule: UserGuardrailRuleDTO }> {
  const reportRef = weeklyReportRef(params.userId, params.weekKey);
  const now = new Date().toISOString();
  const newRuleRef = rulesRef.doc();
  let acceptedRule: UserGuardrailRuleDTO | null = null;

  await adminDb.runTransaction(async (transaction) => {
    const reportSnapshot = await transaction.get(reportRef);
    const report = reportSnapshot.data() as WeeklyInsightReport | undefined;
    if (!reportSnapshot.exists || !report || report.userId !== params.userId) {
      throw new Error("SUGGESTION_NOT_FOUND");
    }
    const suggestion = getSuggestionFromReport(report, params.suggestionId);
    if (!suggestion || suggestion.type !== "NEW_GUARDRAIL") {
      throw new Error("SUGGESTION_NOT_FOUND");
    }
    if (suggestion.status !== "PENDING") {
      throw new Error("SUGGESTION_ALREADY_HANDLED");
    }
    const rulesSnapshot = await transaction.get(rulesRef.where("userId", "==", params.userId));
    const duplicate = rulesSnapshot.docs.find(
      (doc) => doc.data().sourceSuggestionCandidateKey === suggestion.candidateKey,
    );
    if (duplicate) {
      acceptedRule = ruleDocToDTO(duplicate.id, duplicate.data());
      transaction.set(
        reportRef,
        cleanUndefined(markSuggestion(report, params.suggestionId, {
          status: "ACCEPTED",
          acceptedAt: now,
          acceptedRuleId: duplicate.id,
        })),
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
      cleanUndefined(markSuggestion(report, params.suggestionId, {
        status: "ACCEPTED",
        acceptedAt: now,
        acceptedRuleId: newRuleRef.id,
      })),
    );
    transaction.set(usersRef.doc(params.userId).collection("guardrailSuggestionHistory").doc(`${params.suggestionId}-accepted`), {
      suggestionId: params.suggestionId,
      candidateKey: suggestion.candidateKey,
      action: "ACCEPTED",
      payload: { type: "NEW_GUARDRAIL", createdRuleId: newRuleRef.id },
      createdAt: now,
    });
    acceptedRule = ruleDocToDTO(newRuleRef.id, data);
  });

  if (!acceptedRule) throw new Error("SUGGESTION_ACCEPT_FAILED");
  return { status: "ACCEPTED", rule: acceptedRule };
}

export async function acceptWeeklyModificationSuggestionInTransaction(params: {
  userId: string;
  weekKey: string;
  suggestionId: string;
  requiresPrivateApi: boolean;
}): Promise<{ status: "ACCEPTED"; rule: UserGuardrailRuleDTO }> {
  const reportRef = weeklyReportRef(params.userId, params.weekKey);
  const now = new Date().toISOString();
  let acceptedRule: UserGuardrailRuleDTO | null = null;
  await adminDb.runTransaction(async (transaction) => {
    const reportSnapshot = await transaction.get(reportRef);
    const report = reportSnapshot.data() as WeeklyInsightReport | undefined;
    if (!reportSnapshot.exists || !report || report.userId !== params.userId) {
      throw new Error("SUGGESTION_NOT_FOUND");
    }
    const suggestion = getSuggestionFromReport(report, params.suggestionId);
    if (!suggestion || suggestion.type !== "MODIFY_GUARDRAIL") {
      throw new Error("SUGGESTION_NOT_FOUND");
    }
    if (suggestion.status !== "PENDING") {
      throw new Error("SUGGESTION_ALREADY_HANDLED");
    }
    const ruleId = suggestion.ruleId || suggestion.guardrailId;
    const ruleRef = rulesRef.doc(ruleId);
    const ruleSnapshot = await transaction.get(ruleRef);
    if (!ruleSnapshot.exists || ruleSnapshot.data()?.userId !== params.userId) {
      throw new Error("RULE_NOT_FOUND");
    }
    const currentRule = ruleDocToDTO(ruleSnapshot.id, ruleSnapshot.data() ?? {});
    if (
      suggestion.baseRuleHash &&
      canonicalRuleExpressionHash(currentRule.expression) !== suggestion.baseRuleHash
    ) {
      throw new Error("RULE_VERSION_CONFLICT");
    }
    const proposed = suggestion.proposedRule;
    transaction.set(ruleRef, cleanUndefined({
      expression: proposed.expression,
      description: proposed.description ?? currentRule.description ?? null,
      warningTitle: proposed.warningTitle,
      warningMessage: proposed.warningMessage,
      riskLevel: proposed.riskLevel,
      visualMode: proposed.visualMode,
      requiresPrivateApi: params.requiresPrivateApi,
      updatedAt: now,
    }), { merge: true });
    transaction.set(
      reportRef,
      cleanUndefined(markSuggestion(report, params.suggestionId, {
        status: "ACCEPTED",
        acceptedAt: now,
        acceptedRuleId: ruleId,
      })),
    );
    transaction.set(usersRef.doc(params.userId).collection("guardrailRuleChangeHistory").doc(), {
      ruleId,
      suggestionId: params.suggestionId,
      before: currentRule,
      after: proposed,
      source: "WEEKLY_INSIGHT_SUGGESTION",
      createdAt: now,
    });
    acceptedRule = {
      ...currentRule,
      ...proposed,
      ruleId,
      userId: params.userId,
      requiresPrivateApi: params.requiresPrivateApi,
      updatedAt: now,
    };
  });
  if (!acceptedRule) throw new Error("SUGGESTION_ACCEPT_FAILED");
  return { status: "ACCEPTED", rule: acceptedRule };
}

export async function saveWeeklyGuardrailSuggestionHistory(params: {
  userId: string;
  suggestionId: string;
  action: "ACCEPTED" | "DISMISSED";
  payload: Record<string, unknown>;
}) {
  await usersRef
    .doc(params.userId)
    .collection("guardrailSuggestionHistory")
    .doc(`${params.suggestionId}-${params.action.toLowerCase()}`)
    .set({
      suggestionId: params.suggestionId,
      action: params.action,
      payload: params.payload,
      createdAt: toIsoString(new Date()),
    });
}
