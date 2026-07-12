import { createHash } from "crypto";
import { ApiError } from "@/backend/common/api";
import { RULE_ELIGIBLE_FIELD_CATALOG } from "@/backend/modules/guardrail/catalog";
import { canonicalRuleExpressionHash, validateRuleExpression } from "@/backend/modules/guardrail/expression";
import { getOwnedRule, getUserProfile } from "@/backend/modules/guardrail/repository";
import { getMinuteCandles } from "@/backend/modules/market/upbit";
import { buildDailyTimeline } from "./daily-core";
import type {
  RuleExpression,
  UserGuardrailRuleDTO,
} from "@/backend/modules/guardrail/types";
import type {
  StoredGuardrailModificationSuggestion,
  StoredNewGuardrailSuggestion,
  SuggestionAnalysisResult,
  WeeklyInsightPeriod,
  WeeklyInsightReport,
  WeeklyInsightStatusResponse,
} from "./weekly-types";
import {
  buildWeeklyDailyBreakdown,
  buildWeeklyFactSummaries,
  buildWeeklyGuardrailSuggestionRequest,
  buildWeeklyInputHash,
  buildWeeklyMetrics,
  buildWeeklyOrderFlows,
  buildWeeklySourceCounts,
  computeInsightDataAvailability,
  computeTwentyFourHourVirtualOrderResult,
  getPreviousWeeklyPeriod,
  getWeeklyPeriod,
  REQUIRED_WEEKLY_FEEDBACK_COUNT,
  sanitizeWeeklyFieldAnalysis,
  sanitizeWeeklyOverview,
  toTimeMs,
  WEEKLY_ANALYSIS_VERSION,
  WEEKLY_GUARDRAIL_SUGGESTION_ALGORITHM_VERSION,
  WEEKLY_PROMPT_VERSION,
  WEEKLY_REPORT_SCHEMA_VERSION,
} from "./weekly-core";
import {
  acceptWeeklyModificationSuggestionInTransaction,
  acceptWeeklyNewGuardrailSuggestionInTransaction,
  findWeeklyInsightSuggestion,
  getLatestWeeklyInsight,
  getWeeklyInsightReport,
  listWeeklyInsightReports,
  loadWeeklyInsightSources,
  saveFailedWeeklyInsightReport,
  saveWeeklyGuardrailSuggestionHistory,
  saveWeeklyInsightReport,
  tryStartWeeklyReportGeneration,
  updateWeeklyInsightSuggestionStatus,
} from "./weekly-repository";

const DEFAULT_TIMEOUT_MS = 30_000;
const generationRateLimit = new Map<string, number>();

type FieldAnalyzeResponse = {
  topics?: WeeklyInsightReport["fieldAnalysis"] extends { topics: infer T }
    ? T
    : never;
  one_line_advice?: string;
  oneLineAdvice?: string;
};

function enforceGenerationRateLimit(userId: string) {
  const now = Date.now();
  const previous = generationRateLimit.get(userId) ?? 0;
  if (now - previous < 5_000) {
    throw new ApiError(429, "WEEKLY_INSIGHT_RATE_LIMITED", "잠시 후 다시 시도해 주세요.");
  }
  generationRateLimit.set(userId, now);
}

function getAnalyzeUrl() {
  const url = process.env.FASTAPI_INSIGHT_URL;
  if (!url) throw new Error("FASTAPI_INSIGHT_URL 환경변수가 설정되지 않았습니다.");
  return url;
}

function getFieldAnalyzeUrl() {
  return getAnalyzeUrl().replace(/\/analyze$/, "/field-analyze");
}

function getGuardrailSuggestionUrl() {
  return getAnalyzeUrl().replace(/\/analyze$/, "/guardrail-suggestions/analyze");
}

async function fetchWithTimeout(url: string, options: RequestInit, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function requestInsightFastApi<T>(url: string, summaries: string[]): Promise<T> {
  const response = await fetchWithTimeout(url, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "X-API-Key": process.env.FASTAPI_INSIGHT_API_KEY!,
    },
    body: JSON.stringify({ summaries }),
    cache: "no-store",
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`FASTAPI_WEEKLY_INSIGHT_FAILED_${response.status}: ${text.slice(0, 300)}`);
  return JSON.parse(text) as T;
}

async function requestGuardrailSuggestionFastApi(payload: Record<string, unknown>) {
  const response = await fetchWithTimeout(getGuardrailSuggestionUrl(), {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "X-API-Key": process.env.FASTAPI_INSIGHT_API_KEY!,
    },
    body: JSON.stringify(payload),
    cache: "no-store",
  });
  const text = await response.text();
  const body = text ? JSON.parse(text) : null;
  if (!response.ok) {
    const error = new Error(`FASTAPI_WEEKLY_GUARDRAIL_SUGGESTION_FAILED_${response.status}`);
    (error as Error & { status?: number; body?: unknown }).status = response.status;
    (error as Error & { status?: number; body?: unknown }).body = body;
    throw error;
  }
  return body as Record<string, unknown>;
}

async function getUserTimezone(userId: string) {
  const profile = await getUserProfile(userId).catch(() => null);
  return profile?.timezone || "Asia/Seoul";
}

function mapFieldAnalysis(raw: FieldAnalyzeResponse | null): WeeklyInsightReport["fieldAnalysis"] {
  if (!raw) return null;
  return {
    topics: Array.isArray(raw.topics) ? raw.topics : [],
    oneLineAdvice: raw.one_line_advice || raw.oneLineAdvice || "",
  };
}

function suggestionIdFromCandidate(candidateKey: string) {
  return `weekly-suggestion-${createHash("sha1").update(candidateKey).digest("hex").slice(0, 16)}`;
}

function readExplanation(raw: Record<string, unknown> | undefined) {
  return {
    title: String(raw?.title || "가드레일 제안"),
    rationale: String(raw?.rationale || "최근 기록에서 반복된 주문 상황을 기준으로 계산했어요."),
    evidenceSummary: String(raw?.evidenceSummary || raw?.evidence_summary || "연결 가능한 주문 의도와 피드백을 기준으로 계산했어요."),
    expectedChange: String(raw?.expectedChange || raw?.expected_change || "다음 주문에서 같은 조건을 한 번 더 확인합니다."),
    caution: String(raw?.caution || "같은 과거 기록에서 찾고 평가한 참고 결과일 수 있어요."),
    ruleName: String(raw?.ruleName || raw?.rule_name || "주문 기준 확인"),
    ruleDescription: String(raw?.ruleDescription || raw?.rule_description || "최근 기록에서 반복된 조건을 확인합니다."),
    warningTitle: String(raw?.warningTitle || raw?.warning_title || "주문 기준을 확인해 볼까요?"),
    warningMessage: String(raw?.warningMessage || raw?.warning_message || "최근 기록과 비슷한 주문 상황입니다. 주문 전 기준을 다시 확인해 보세요."),
  };
}

function normalizeSuggestionStatus(value: unknown): SuggestionAnalysisResult["status"] {
  return value === "AVAILABLE" || value === "INSUFFICIENT_DATA" || value === "NO_SUGGESTION" || value === "ERROR"
    ? value
    : "NO_SUGGESTION";
}

function normalizeNewSuggestion(raw: Record<string, unknown> | null | undefined, now: string): StoredNewGuardrailSuggestion | null {
  if (!raw) return null;
  const candidateKey = String(raw.candidateKey || raw.candidate_key || "");
  const proposedRule = (raw.proposedRule || raw.proposed_rule) as StoredNewGuardrailSuggestion["proposedRule"];
  if (!candidateKey || !proposedRule) return null;
  const explanation = readExplanation((raw.explanation || {}) as Record<string, unknown>);
  return {
    suggestionId: suggestionIdFromCandidate(candidateKey),
    candidateKey,
    type: "NEW_GUARDRAIL",
    status: "PENDING",
    createdAt: now,
    acceptedAt: null,
    dismissedAt: null,
    acceptedRuleId: null,
    title: explanation.title,
    rationale: explanation.rationale,
    explanation,
    evidenceCount: Number(raw.evidenceCount ?? raw.evidence_count ?? 0),
    confidence: Number(raw.confidence ?? 0),
    proposedRule,
    representativeValues: (raw.representativeValues || raw.representative_values || {}) as Record<string, unknown>,
    simulation: (raw.simulation || {}) as StoredNewGuardrailSuggestion["simulation"],
    evaluationMode: "IN_SAMPLE",
    sourceWindow: undefined,
  };
}

function normalizeModificationSuggestion(
  raw: Record<string, unknown> | null | undefined,
  currentRules: Array<{ ruleId: string; expression: unknown }>,
  now: string,
): StoredGuardrailModificationSuggestion | null {
  if (!raw) return null;
  const candidateKey = String(raw.candidateKey || raw.candidate_key || "");
  const ruleId = String(raw.ruleId || raw.rule_id || "");
  const proposedRule = (raw.proposedRule || raw.proposed_rule) as StoredGuardrailModificationSuggestion["proposedRule"];
  const currentRule = currentRules.find((rule) => rule.ruleId === ruleId);
  if (!candidateKey || !ruleId || !proposedRule || !currentRule) return null;
  const explanation = readExplanation((raw.explanation || {}) as Record<string, unknown>);
  return {
    suggestionId: suggestionIdFromCandidate(candidateKey),
    candidateKey,
    type: "MODIFY_GUARDRAIL",
    status: "PENDING",
    createdAt: now,
    acceptedAt: null,
    dismissedAt: null,
    acceptedRuleId: null,
    guardrailId: ruleId,
    ruleId,
    baseRuleHash: String(raw.baseRuleHash || raw.base_rule_hash || canonicalRuleExpressionHash(currentRule.expression as RuleExpression)),
    title: explanation.title,
    rationale: explanation.rationale,
    explanation,
    evidenceCount: Number(raw.evidenceCount ?? raw.evidence_count ?? 0),
    confidence: Number(raw.confidence ?? 0),
    currentRule: currentRule as UserGuardrailRuleDTO,
    proposedRule,
    diff: (raw.diff || []) as StoredGuardrailModificationSuggestion["diff"],
    representativeValues: (raw.representativeValues || raw.representative_values || {}) as Record<string, unknown>,
    currentSimulation: (raw.currentSimulation || raw.current_simulation || {}) as StoredGuardrailModificationSuggestion["currentSimulation"],
    proposedSimulation: (raw.proposedSimulation || raw.proposed_simulation || {}) as StoredGuardrailModificationSuggestion["proposedSimulation"],
    evaluationMode: "IN_SAMPLE",
    sourceWindow: undefined,
  };
}

function normalizeAnalysisResult(params: {
  raw: Record<string, unknown>;
  key: "newAnalysis" | "modificationAnalysis";
  fallbackSuggestion: StoredNewGuardrailSuggestion | StoredGuardrailModificationSuggestion | null;
  activeDays: number;
}): SuggestionAnalysisResult {
  const rawAnalysis = (params.raw[params.key] ||
    params.raw[params.key === "newAnalysis" ? "new_analysis" : "modification_analysis"] ||
    {}) as Record<string, unknown>;
  const status = normalizeSuggestionStatus(rawAnalysis.status || (params.fallbackSuggestion ? "AVAILABLE" : params.raw.status));
  return {
    status: params.fallbackSuggestion ? "AVAILABLE" : status,
    reasonCode: (rawAnalysis.reasonCode || rawAnalysis.reason_code || null) as string | null,
    evidenceCount: Number(rawAnalysis.evidenceCount || rawAnalysis.evidence_count || params.fallbackSuggestion?.evidenceCount || 0),
    activeDays: Number(rawAnalysis.activeDays || rawAnalysis.active_days || params.activeDays),
    evaluationMode: (rawAnalysis.evaluationMode || rawAnalysis.evaluation_mode || params.fallbackSuggestion?.evaluationMode || null) as SuggestionAnalysisResult["evaluationMode"],
    suggestion: params.fallbackSuggestion,
  };
}

function normalizeGuardrailSuggestionResponse(params: {
  raw: Record<string, unknown>;
  currentRules: Array<{ ruleId: string; expression: unknown }>;
  activeDays: number;
  now: string;
}) {
  const newSuggestion = normalizeNewSuggestion(
    (params.raw.newGuardrail || params.raw.new_guardrail) as Record<string, unknown> | null | undefined,
    params.now,
  );
  const modificationSuggestion = normalizeModificationSuggestion(
    (params.raw.modification || null) as Record<string, unknown> | null | undefined,
    params.currentRules,
    params.now,
  );
  const newAnalysis = normalizeAnalysisResult({
    raw: params.raw,
    key: "newAnalysis",
    fallbackSuggestion: newSuggestion,
    activeDays: params.activeDays,
  });
  const modificationAnalysis = normalizeAnalysisResult({
    raw: params.raw,
    key: "modificationAnalysis",
    fallbackSuggestion: modificationSuggestion,
    activeDays: params.activeDays,
  });
  return {
    suggestionAnalysis: {
      newGuardrail: newAnalysis,
      modification: modificationAnalysis,
    },
    suggestions: {
      newGuardrail: newSuggestion,
      modification: modificationSuggestion,
    },
  };
}

function suggestionErrorResult(error: unknown, activeDays: number) {
  const status = (error as { status?: number })?.status;
  const reason = status === 422 ? "REQUEST_VALIDATION_FAILED" : "UPSTREAM_ERROR";
  const result = (): SuggestionAnalysisResult => ({
    status: "ERROR",
    reasonCode: reason,
    evidenceCount: 0,
    activeDays,
    evaluationMode: null,
    suggestion: null,
  });
  return {
    suggestionAnalysis: {
      newGuardrail: result(),
      modification: result(),
    },
    suggestions: { newGuardrail: null, modification: null },
  };
}

async function getHistoricalPriceNear(market: string, targetAt: string) {
  const candles = await getMinuteCandles({
    symbol: market,
    unit: 60,
    count: 48,
    to: targetAt,
  });
  const targetMs = toTimeMs(targetAt);
  const candidates = candles
    .map((candle) => ({
      price: candle.trade_price,
      matchedAt: `${candle.candle_date_time_utc}Z`,
      diff: Math.abs(toTimeMs(`${candle.candle_date_time_utc}Z`) - targetMs),
    }))
    .filter((item) => Number.isFinite(item.price));
  const best = candidates.sort((left, right) => left.diff - right.diff)[0];
  return best && best.diff <= 2 * 60 * 60 * 1000 ? best : null;
}

async function buildWeeklyInput(params: {
  userId: string;
  period: WeeklyInsightPeriod;
  generatedAt: string;
}) {
  const sources = await loadWeeklyInsightSources({
    userId: params.userId,
    weekKey: params.period.weekKey,
    timezone: params.period.timezone,
    generatedAt: params.generatedAt,
  });
  const periodSources = { ...sources, period: params.period };
  const sourceCounts = buildWeeklySourceCounts(periodSources);
  const dailyBreakdown = buildWeeklyDailyBreakdown({
    period: params.period,
    sources: periodSources,
  });
  const inputHash = buildWeeklyInputHash({
    period: params.period,
    sources: periodSources,
  });
  return { sources: periodSources, sourceCounts, dailyBreakdown, inputHash };
}

function toStatusResponse(params: {
  period: WeeklyInsightPeriod;
  sourceCounts: WeeklyInsightReport["sourceCounts"];
  report: WeeklyInsightReport | null;
  inputHash: string;
}): WeeklyInsightStatusResponse {
  const inputHashChanged = Boolean(
    params.report?.inputHash &&
      params.report.inputHash !== params.inputHash &&
      ["COMPLETED", "PARTIAL"].includes(params.report.reportStatus),
  );
  return {
    ...params.period,
    eligible: params.sourceCounts.answeredFeedbacks >= REQUIRED_WEEKLY_FEEDBACK_COUNT,
    answeredFeedbackCount: params.sourceCounts.answeredFeedbacks,
    requiredFeedbackCount: REQUIRED_WEEKLY_FEEDBACK_COUNT,
    reportStatus: params.report
      ? inputHashChanged
        ? "STALE"
        : params.report.reportStatus
      : "NOT_CREATED",
    reportId: params.report?.reportId || null,
    inputHashChanged,
  };
}

export async function getWeeklyInsightStatus(params: {
  userId: string;
  weekKey?: string | null;
}): Promise<WeeklyInsightStatusResponse> {
  const timezone = await getUserTimezone(params.userId);
  const generatedAt = new Date().toISOString();
  const currentPeriod = getWeeklyPeriod({ weekKey: params.weekKey || undefined, timezone, now: generatedAt }) as WeeklyInsightPeriod;
  const previousPeriod = getPreviousWeeklyPeriod({ timezone, now: generatedAt }) as WeeklyInsightPeriod;
  const candidates = params.weekKey
    ? [currentPeriod]
    : [previousPeriod, currentPeriod];

  const statuses = await Promise.all(
    candidates.map(async (period) => {
      const [{ sourceCounts, inputHash }, report] = await Promise.all([
        buildWeeklyInput({ userId: params.userId, period, generatedAt }),
        getWeeklyInsightReport({ userId: params.userId, weekKey: period.weekKey }),
      ]);
      return toStatusResponse({ period, sourceCounts, report, inputHash });
    }),
  );

  if (params.weekKey) return statuses[0];
  return (
    statuses.find(
      (status) =>
        status.periodState === "CLOSED" &&
        status.eligible &&
        !["COMPLETED", "PARTIAL"].includes(status.reportStatus),
    ) ||
    statuses.find(
      (status) =>
        status.periodState === "CLOSED" &&
        ["STALE", "FAILED"].includes(status.reportStatus),
    ) ||
    statuses[1] ||
    statuses[0]
  );
}

export async function listWeeklyInsights(params: { userId: string; limit?: number }) {
  return listWeeklyInsightReports(params);
}

export async function getWeeklyInsightByWeekKey(params: { userId: string; weekKey: string }) {
  return getWeeklyInsightReport(params);
}

export async function getLatestWeeklyInsightBundle(params: { userId: string }) {
  const [report, status] = await Promise.all([
    getLatestWeeklyInsight({ userId: params.userId }),
    getWeeklyInsightStatus({ userId: params.userId }),
  ]);
  return { report, status };
}

export async function generateWeeklyInsightReport(params: {
  userId: string;
  weekKey?: string | null;
}): Promise<WeeklyInsightReport> {
  enforceGenerationRateLimit(params.userId);
  const timezone = await getUserTimezone(params.userId);
  const generatedAt = new Date().toISOString();
  const period = getWeeklyPeriod({ weekKey: params.weekKey || undefined, timezone, now: generatedAt }) as WeeklyInsightPeriod;
  const { sources, sourceCounts, dailyBreakdown, inputHash } = await buildWeeklyInput({
    userId: params.userId,
    period,
    generatedAt,
  });
  if (sourceCounts.answeredFeedbacks < REQUIRED_WEEKLY_FEEDBACK_COUNT) {
    throw new ApiError(400, "WEEKLY_INSIGHT_INSUFFICIENT_FEEDBACK", "주간 리포트를 생성하려면 ANSWERED 피드백 5개 이상이 필요합니다.");
  }
  const lock = await tryStartWeeklyReportGeneration({
    userId: params.userId,
    period,
    inputHash,
    sourceCounts,
    dailyBreakdown,
  });
  if (!lock.started) return lock.report;

  try {
    const timeline = sources.snapshots.length || sources.feedbacks.length || sources.reactions.length || sources.trades.length
      ? buildDailyTimeline(sources)
      : [];
    const orderFlows = buildWeeklyOrderFlows({ ...sources, timeline });
    const twentyFourHourVirtualOrderResult = await computeTwentyFourHourVirtualOrderResult({
      snapshots: sources.snapshots,
      generatedAt,
      getPriceNear: getHistoricalPriceNear,
    });
    const metrics = buildWeeklyMetrics({
      sources,
      twentyFourHourVirtualOrderResult,
    }) as WeeklyInsightReport["metrics"];
    const dataAvailability = computeInsightDataAvailability(sources) as WeeklyInsightReport["dataAvailability"];
    const facts = buildWeeklyFactSummaries({
      period,
      sourceCounts,
      dailyBreakdown,
      metrics,
      availability: dataAvailability,
    });
    const suggestionPayload = buildWeeklyGuardrailSuggestionRequest({
      period,
      generatedAt,
      sources: {
        ...sources,
        snapshots: sources.suggestionSnapshots || sources.snapshots,
        reactions: sources.suggestionReactions || sources.reactions,
        feedbacks: sources.suggestionFeedbacks || sources.feedbacks,
        trades: sources.suggestionTrades || sources.trades,
        rules: sources.rules,
      },
      fieldCatalog: RULE_ELIGIBLE_FIELD_CATALOG,
    }) as Record<string, unknown>;

    const [overviewResult, fieldResult, suggestionResult] = await Promise.allSettled([
      requestInsightFastApi<WeeklyInsightReport["overview"]>(getAnalyzeUrl(), facts),
      requestInsightFastApi<FieldAnalyzeResponse>(getFieldAnalyzeUrl(), facts).then(mapFieldAnalysis),
      requestGuardrailSuggestionFastApi(suggestionPayload),
    ]);

    const overview = sanitizeWeeklyOverview(
      overviewResult.status === "fulfilled" ? overviewResult.value : null,
      dataAvailability,
      sourceCounts,
    ) as WeeklyInsightReport["overview"];
    const fieldAnalysis = sanitizeWeeklyFieldAnalysis(
      fieldResult.status === "fulfilled" ? fieldResult.value : null,
      dataAvailability,
      sourceCounts,
    ) as WeeklyInsightReport["fieldAnalysis"];
    const suggestion =
      suggestionResult.status === "fulfilled"
        ? normalizeGuardrailSuggestionResponse({
            raw: suggestionResult.value,
            currentRules: sources.rules,
            activeDays: sourceCounts.activeDays,
            now: generatedAt,
          })
        : suggestionErrorResult(suggestionResult.reason, sourceCounts.activeDays);
    const reportStatus =
      overview && fieldAnalysis
        ? "COMPLETED"
        : overview || fieldAnalysis
          ? "PARTIAL"
          : "FAILED";
    const now = new Date().toISOString();
    const report: WeeklyInsightReport = {
      reportId: period.weekKey,
      userId: params.userId,
      weekKey: period.weekKey,
      timezone,
      periodStart: period.periodStart,
      periodEnd: period.periodEnd,
      periodState: period.periodState,
      reportStatus,
      reportVersion: lock.reportVersion,
      inputHash,
      sourceCounts,
      dailyBreakdown,
      orderFlows,
      metrics,
      overview,
      fieldAnalysis,
      dataAvailability,
      suggestionAnalysis: suggestion.suggestionAnalysis,
      suggestions: suggestion.suggestions,
      promptVersion: WEEKLY_PROMPT_VERSION,
      analysisVersion: WEEKLY_ANALYSIS_VERSION,
      algorithmVersion: WEEKLY_GUARDRAIL_SUGGESTION_ALGORITHM_VERSION,
      weeklyReportSchemaVersion: WEEKLY_REPORT_SCHEMA_VERSION,
      generatedAt: now,
      createdAt: now,
      updatedAt: now,
      errorCode: reportStatus === "FAILED" ? "WEEKLY_INSIGHT_ANALYSIS_FAILED" : null,
      errorMessage: reportStatus === "FAILED" ? "주간 AI 분석 결과를 생성하지 못했습니다." : null,
      debugSummary: {
        factCount: facts.length,
        suggestionStatus: {
          newGuardrail: suggestion.suggestionAnalysis.newGuardrail.status,
          modification: suggestion.suggestionAnalysis.modification.status,
        },
      },
    };
    return saveWeeklyInsightReport(report);
  } catch (error) {
    return saveFailedWeeklyInsightReport({
      userId: params.userId,
      period,
      inputHash,
      sourceCounts,
      dailyBreakdown,
      reportVersion: lock.reportVersion,
      errorCode: "WEEKLY_INSIGHT_GENERATION_FAILED",
      errorMessage: error instanceof Error ? error.message : "주간 리포트 생성에 실패했습니다.",
    });
  }
}

function mapSuggestionTransactionError(error: unknown): never {
  const message = error instanceof Error ? error.message : String(error);
  if (message === "SUGGESTION_NOT_FOUND") throw new ApiError(404, message, "제안을 찾을 수 없습니다.");
  if (message === "SUGGESTION_ALREADY_HANDLED") throw new ApiError(409, message, "이미 처리된 제안입니다.");
  if (message === "RULE_VERSION_CONFLICT") throw new ApiError(409, message, "규칙이 제안 생성 이후 변경됐어요. 현재 규칙을 기준으로 다시 분석해 주세요.");
  if (message === "RULE_NOT_FOUND") throw new ApiError(404, message, "수정할 규칙을 찾을 수 없습니다.");
  throw error;
}

export async function acceptWeeklyInsightSuggestion(params: {
  userId: string;
  weekKey: string;
  suggestionId: string;
}) {
  const found = await findWeeklyInsightSuggestion(params);
  if (!found) throw new ApiError(404, "SUGGESTION_NOT_FOUND", "제안을 찾을 수 없습니다.");
  if (found.suggestion.type === "NEW_GUARDRAIL") {
    const validation = validateRuleExpression(found.suggestion.proposedRule.expression);
    const result = await acceptWeeklyNewGuardrailSuggestionInTransaction({
      userId: params.userId,
      weekKey: params.weekKey,
      suggestionId: params.suggestionId,
      requiresPrivateApi: validation.requiresPrivateApi,
    }).catch(mapSuggestionTransactionError);
    return { suggestionId: params.suggestionId, status: "ACCEPTED", rule: result.rule };
  }
  const current = await getOwnedRule({
    userId: params.userId,
    ruleId: found.suggestion.ruleId || found.suggestion.guardrailId,
  });
  if (!current) throw new ApiError(404, "RULE_NOT_FOUND", "수정할 규칙을 찾을 수 없습니다.");
  if (
    found.suggestion.baseRuleHash &&
    canonicalRuleExpressionHash(current.expression) !== found.suggestion.baseRuleHash
  ) {
    throw new ApiError(409, "RULE_VERSION_CONFLICT", "규칙이 제안 생성 이후 변경됐어요. 현재 규칙을 기준으로 다시 분석해 주세요.");
  }
  const validation = validateRuleExpression(found.suggestion.proposedRule.expression);
  const result = await acceptWeeklyModificationSuggestionInTransaction({
    userId: params.userId,
    weekKey: params.weekKey,
    suggestionId: params.suggestionId,
    requiresPrivateApi: validation.requiresPrivateApi,
  }).catch(mapSuggestionTransactionError);
  return { suggestionId: params.suggestionId, status: "ACCEPTED", rule: result.rule };
}

export async function dismissWeeklyInsightSuggestion(params: {
  userId: string;
  weekKey: string;
  suggestionId: string;
}) {
  const found = await findWeeklyInsightSuggestion(params);
  if (!found) throw new ApiError(404, "SUGGESTION_NOT_FOUND", "제안을 찾을 수 없습니다.");
  const report = await updateWeeklyInsightSuggestionStatus({
    userId: params.userId,
    weekKey: params.weekKey,
    suggestionId: params.suggestionId,
    status: "DISMISSED",
  });
  await saveWeeklyGuardrailSuggestionHistory({
    userId: params.userId,
    suggestionId: params.suggestionId,
    action: "DISMISSED",
    payload: {
      type: found.suggestion.type,
      candidateKey: found.suggestion.candidateKey ?? null,
      weekKey: params.weekKey,
    },
  });
  return { suggestionId: params.suggestionId, status: "DISMISSED", report };
}
