import { createHash } from "crypto";
import { ApiError } from "@/backend/common/api";
import { RULE_ELIGIBLE_FIELD_CATALOG } from "@/backend/modules/guardrail/catalog";
import {
  canonicalRuleExpressionHash,
  validateRuleExpression,
} from "@/backend/modules/guardrail/expression";
import type { UserGuardrailRuleDTO } from "@/backend/modules/guardrail/types";
import { getUserProfile } from "@/backend/modules/guardrail/repository";
import { getTicker } from "@/backend/modules/market/upbit";
import type {
  DailyInsightEligibility,
  DailyInsightReport,
  GuardrailModificationSuggestion,
  NewGuardrailSuggestion,
  RuleSimulationResult,
  SuggestionExplanation,
} from "./daily-types";
import {
  buildDailyTimeline,
  buildDailyInsightDiagnostics,
  buildOrderFlows,
  buildDailyReportDebugSummary,
  buildFactSummaries,
  buildGuardrailSuggestionRequest,
  buildInputHash,
  buildSourceCounts,
  computeCancelledOrderVirtualPnl,
  computeEligibility,
  computeFeedbackPnlComparison,
  computeInsightDataAvailability,
  computeReducedExposure,
  computeWaitingPriceEffect,
  DEFAULT_TIMEZONE,
  GUARDRAIL_SUGGESTION_ALGORITHM_VERSION,
  AI_PROMPT_VERSION,
  ANALYSIS_VERSION,
  getDailyRange,
  mergeAnalysisResults,
  sanitizeFieldAnalysisWithAvailability,
  sanitizeOverviewWithAvailability,
} from "./daily-core";
import { getOwnedRule } from "@/backend/modules/guardrail/repository";
import {
  acceptModificationSuggestionInTransaction,
  acceptNewGuardrailSuggestionInTransaction,
  findDailyInsightSuggestion,
  getDailyInsightReport,
  getLatestCompletedDailyInsightReport,
  getLatestDailyInsightReportForDate,
  listDismissedSuggestionCandidateKeys,
  listDailyInsightReports,
  loadDailyInsightSources,
  saveGuardrailSuggestionHistory,
  saveDailyInsightReport,
  saveFailedDailyInsightReport,
  tryStartDailyReportGeneration,
  updateDailyInsightSuggestionStatus,
} from "./daily-repository";

const DEFAULT_TIMEOUT_MS = 30_000;
const generationRateLimit = new Map<string, number>();

function joinUrl(baseUrl: string, path: string) {
  const base = baseUrl.replace(/\/+$/, "");
  const suffix = path.replace(/^\/+/, "");
  return `${base}/${suffix}`;
}

class GuardrailSuggestionApiError extends Error {
  status: number;
  code: "REQUEST_VALIDATION_FAILED" | "UPSTREAM_ERROR";
  stage: "REQUEST_VALIDATION" | "UPSTREAM_HTTP";
  validationDetail: unknown;

  constructor(params: {
    status: number;
    code: "REQUEST_VALIDATION_FAILED" | "UPSTREAM_ERROR";
    stage: "REQUEST_VALIDATION" | "UPSTREAM_HTTP";
    validationDetail?: unknown;
  }) {
    super(`FASTAPI_GUARDRAIL_SUGGESTION_FAILED_${params.status}`);
    this.name = "GuardrailSuggestionApiError";
    this.status = params.status;
    this.code = params.code;
    this.stage = params.stage;
    this.validationDetail = params.validationDetail ?? null;
  }
}

type FieldAnalyzeResponse = {
  topics?: DailyInsightReport["fieldAnalysis"] extends { topics: infer T }
    ? T
    : never;
  one_line_advice?: string;
  oneLineAdvice?: string;
};

type GuardrailSuggestionFastApiResponse = {
  status?: "AVAILABLE" | "INSUFFICIENT_DATA" | "NO_SUGGESTION" | "ERROR";
  algorithmVersion?: string;
  algorithm_version?: string;
  errorCode?: string | null;
  error_code?: string | null;
  errorStage?: string | null;
  error_stage?: string | null;
  sourceSummary?: Record<string, unknown>;
  source_summary?: Record<string, unknown>;
  newGuardrail?: FastApiNewGuardrailSuggestion | null;
  new_guardrail?: FastApiNewGuardrailSuggestion | null;
  modification?: FastApiModificationSuggestion | null;
  diagnostics?: Record<string, unknown>;
};

type SuggestionDiagnosticStatus = NonNullable<
  DailyInsightReport["suggestionDiagnostics"]
>["status"];

type FastApiSuggestionExplanation = {
  title?: string;
  rationale?: string;
  evidenceSummary?: string;
  evidence_summary?: string;
  expectedChange?: string;
  expected_change?: string;
  caution?: string;
  ruleName?: string;
  rule_name?: string;
  ruleDescription?: string;
  rule_description?: string;
  warningTitle?: string;
  warning_title?: string;
  warningMessage?: string;
  warning_message?: string;
};

type FastApiProposedRule = {
  ruleId?: string | null;
  rule_id?: string | null;
  name?: string;
  description?: string | null;
  isEnabled?: boolean;
  is_enabled?: boolean;
  priority?: number;
  riskLevel?: "LOW" | "MEDIUM" | "HIGH";
  risk_level?: "LOW" | "MEDIUM" | "HIGH";
  visualMode?: "CURIOUS" | "SURPRISED" | "FAST_BURN" | "SCARED" | "SAD";
  visual_mode?: "CURIOUS" | "SURPRISED" | "FAST_BURN" | "SCARED" | "SAD";
  expression?: unknown;
  warningTitle?: string;
  warning_title?: string;
  warningMessage?: string;
  warning_message?: string;
  requiresPrivateApi?: boolean;
  requires_private_api?: boolean;
  schemaVersion?: "v1";
  schema_version?: "v1";
};

type FastApiSimulation = {
  triggerCount?: number;
  trigger_count?: number;
  support?: number;
  coverage?: number;
  precision?: number | null;
  recall?: number | null;
  falsePositiveRate?: number | null;
  false_positive_rate?: number | null;
  plannedTriggerRate?: number | null;
  planned_trigger_rate?: number | null;
  regrettedCaptureRate?: number | null;
  regretted_capture_rate?: number | null;
  lift?: number | null;
};

type FastApiNewGuardrailSuggestion = {
  candidateKey?: string;
  candidate_key?: string;
  type?: "NEW_GUARDRAIL";
  proposedRule?: FastApiProposedRule;
  proposed_rule?: FastApiProposedRule;
  explanation?: FastApiSuggestionExplanation;
  evidenceCount?: number;
  evidence_count?: number;
  confidence?: number;
  representativeValues?: Record<string, unknown>;
  representative_values?: Record<string, unknown>;
  simulation?: FastApiSimulation;
  sourceWindow?: { fromAt?: string; from_at?: string; toAt?: string; to_at?: string };
  source_window?: { fromAt?: string; from_at?: string; toAt?: string; to_at?: string };
};

type FastApiModificationSuggestion = {
  candidateKey?: string;
  candidate_key?: string;
  type?: "MODIFY_GUARDRAIL";
  ruleId?: string;
  rule_id?: string;
  baseRuleHash?: string;
  base_rule_hash?: string;
  proposedRule?: FastApiProposedRule;
  proposed_rule?: FastApiProposedRule;
  diff?: GuardrailModificationSuggestion["diff"];
  explanation?: FastApiSuggestionExplanation;
  evidenceCount?: number;
  evidence_count?: number;
  confidence?: number;
  representativeValues?: Record<string, unknown>;
  representative_values?: Record<string, unknown>;
  currentSimulation?: FastApiSimulation;
  current_simulation?: FastApiSimulation;
  proposedSimulation?: FastApiSimulation;
  proposed_simulation?: FastApiSimulation;
  sourceWindow?: { fromAt?: string; from_at?: string; toAt?: string; to_at?: string };
  source_window?: { fromAt?: string; from_at?: string; toAt?: string; to_at?: string };
};

function toDailyInsightEligibility(value: {
  date: string;
  eligible: boolean;
  answeredFeedbackCount: number;
  requiredFeedbackCount: number;
  reportStatus: DailyInsightEligibility["reportStatus"];
  reportId: string | null;
  hasNewData: boolean;
}): DailyInsightEligibility {
  return {
    ...value,
    requiredFeedbackCount: 5,
  };
}

function normalizeDate(date?: string | null) {
  if (date && /^\d{4}-\d{2}-\d{2}$/.test(date)) return date;
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: DEFAULT_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function makeDailyReportId(date: string, generatedAt: string) {
  const timestamp = generatedAt.replace(/\D/g, "");
  return `${date}-${timestamp}`;
}

async function getUserTimezone(userId: string) {
  const profile = await getUserProfile(userId);
  return profile?.timezone || DEFAULT_TIMEZONE;
}

function getServiceApiKey() {
  return process.env.SERVICE_API_KEY || process.env.FASTAPI_INSIGHT_API_KEY;
}

function getAnalyzeUrl() {
  if (process.env.FASTAPI_INSIGHT_URL) return process.env.FASTAPI_INSIGHT_URL;
  const baseUrl = process.env.FASTAPI_BASE_URL;
  if (baseUrl) return joinUrl(baseUrl, "/api/v1/insights/analyze");
  throw new Error("FASTAPI_INSIGHT_URL 환경변수가 설정되지 않았습니다.");
}

function getFieldAnalyzeUrl() {
  if (process.env.FASTAPI_FIELD_INSIGHT_URL) {
    return process.env.FASTAPI_FIELD_INSIGHT_URL;
  }
  const analyzeUrl = getAnalyzeUrl();
  return analyzeUrl.replace(/\/analyze$/, "/field-analyze");
}

function getGuardrailSuggestionAnalyzeUrl() {
  if (process.env.FASTAPI_GUARDRAIL_SUGGESTION_URL) {
    return process.env.FASTAPI_GUARDRAIL_SUGGESTION_URL;
  }
  const analyzeUrl = getAnalyzeUrl();
  return analyzeUrl.replace(/\/analyze$/, "/guardrail-suggestions/analyze");
}

async function fetchWithTimeout(
  url: string,
  options: RequestInit,
  timeoutMs = DEFAULT_TIMEOUT_MS,
) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeoutId);
  }
}

async function requestDailyInsightFastApi<T>(url: string, summaries: string[]) {
  const serviceApiKey = getServiceApiKey();
  if (!serviceApiKey) {
    throw new Error("SERVICE_API_KEY 환경변수가 설정되지 않았습니다.");
  }

  const response = await fetchWithTimeout(url, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "X-API-Key": serviceApiKey,
    },
    body: JSON.stringify({ summaries: summaries.slice(0, 50) }),
    cache: "no-store",
  });

  const rawText = await response.text();
  if (!response.ok) {
    throw new Error(`FASTAPI_DAILY_INSIGHT_FAILED_${response.status}`);
  }
  return JSON.parse(rawText) as T;
}

async function requestGuardrailSuggestionFastApi(payload: Record<string, unknown>) {
  const serviceApiKey = getServiceApiKey();
  if (!serviceApiKey) {
    throw new Error("SERVICE_API_KEY 환경변수가 설정되지 않았습니다.");
  }

  const body = JSON.stringify(payload);
  if (body.length > 1_500_000) {
    throw new Error("FASTAPI_GUARDRAIL_SUGGESTION_PAYLOAD_TOO_LARGE");
  }

  const response = await fetchWithTimeout(
    getGuardrailSuggestionAnalyzeUrl(),
    {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "X-API-Key": serviceApiKey,
      },
      body,
      cache: "no-store",
    },
    DEFAULT_TIMEOUT_MS,
  );

  const rawText = await response.text();
  let responseBody: unknown = null;
  try {
    responseBody = rawText ? JSON.parse(rawText) : null;
  } catch {
    responseBody = rawText;
  }
  if (!response.ok) {
    const validationDetail =
      response.status === 422 ? sanitizeValidationDetail(responseBody) : undefined;
    console.error("Guardrail suggestion API request failed", {
      status: response.status,
      endpoint: getGuardrailSuggestionAnalyzeUrl(),
      validationDetail,
    });
    throw new GuardrailSuggestionApiError({
      status: response.status,
      code:
        response.status === 422
          ? "REQUEST_VALIDATION_FAILED"
          : "UPSTREAM_ERROR",
      stage:
        response.status === 422
          ? "REQUEST_VALIDATION"
          : "UPSTREAM_HTTP",
      validationDetail,
    });
  }
  return responseBody as GuardrailSuggestionFastApiResponse;
}

function sanitizeValidationInput(value: unknown): unknown {
  if (value === null) return null;
  if (Array.isArray(value)) return { type: "array", length: value.length };
  if (typeof value === "object") return { type: "object" };
  return { type: typeof value };
}

function sanitizeValidationDetail(responseBody: unknown) {
  const detail = (
    responseBody &&
    typeof responseBody === "object" &&
    "detail" in responseBody &&
    Array.isArray((responseBody as { detail?: unknown }).detail)
  )
    ? (responseBody as { detail: Array<Record<string, unknown>> }).detail
    : [];
  return detail.map((item) => ({
    loc: item.loc,
    type: item.type,
    msg: item.msg,
    input: sanitizeValidationInput(item.input),
  }));
}

function enforceGenerationRateLimit(userId: string) {
  const key = `${userId}:daily-insight-generate`;
  const now = Date.now();
  const last = generationRateLimit.get(key) ?? 0;
  if (now - last < 10_000) {
    throw new ApiError(
      429,
      "RATE_LIMITED",
      "잠시 후 다시 시도해 주세요.",
    );
  }
  generationRateLimit.set(key, now);
}

async function buildDailyInput(params: {
  userId: string;
  date: string;
  timezone: string;
  generatedAt: string;
}) {
  const sources = await loadDailyInsightSources(params);
  const inputHash = buildInputHash({
    date: params.date,
    ...sources,
  });
  const sourceCounts = buildSourceCounts(sources);
  return { sources, inputHash, sourceCounts };
}

export async function getDailyInsightStatus(params: {
  userId: string;
  date?: string | null;
}): Promise<DailyInsightEligibility> {
  const timezone = await getUserTimezone(params.userId);
  const date = normalizeDate(params.date);
  const generatedAt = new Date().toISOString();
  const { sources, inputHash } = await buildDailyInput({
    userId: params.userId,
    date,
    timezone,
    generatedAt,
  });
  const report = await getLatestDailyInsightReportForDate({
    userId: params.userId,
    date,
  });
  return toDailyInsightEligibility(
    computeEligibility({
      date,
      timezone,
      feedbacks: sources.feedbacks,
      report,
      inputHash,
    }),
  );
}

export async function listDailyInsights(params: {
  userId: string;
  limit?: number;
}) {
  return listDailyInsightReports(params);
}

export async function getDailyInsightByDate(params: {
  userId: string;
  date: string;
}) {
  return getDailyInsightReport(params);
}

export async function getLatestDailyInsight(params: { userId: string }) {
  const report = await getLatestCompletedDailyInsightReport(params.userId);
  const status = await getDailyInsightStatus({ userId: params.userId });
  return {
    report,
    todayStatus: status,
  };
}

function mapFieldAnalysis(raw: FieldAnalyzeResponse | null) {
  if (!raw) return null;
  return {
    topics: Array.isArray(raw.topics) ? raw.topics : [],
    oneLineAdvice: raw.one_line_advice || raw.oneLineAdvice || "",
  };
}

function readExplanation(raw: FastApiSuggestionExplanation | undefined): SuggestionExplanation {
  return {
    title: raw?.title || "가드레일 제안",
    rationale: raw?.rationale || "최근 기록에서 반복된 주문 상황을 기준으로 계산했어요.",
    evidenceSummary:
      raw?.evidenceSummary ||
      raw?.evidence_summary ||
      "연결 가능한 주문 의도와 피드백을 기준으로 계산했어요.",
    expectedChange:
      raw?.expectedChange ||
      raw?.expected_change ||
      "다음 주문에서 같은 조건을 한 번 더 확인하게 됩니다.",
    caution:
      raw?.caution ||
      "표본이 더 쌓이면 기준이 달라질 수 있어요.",
    ruleName: raw?.ruleName || raw?.rule_name || "유사 주문 상황 확인",
    ruleDescription:
      raw?.ruleDescription ||
      raw?.rule_description ||
      "최근 기록에서 반복된 조건을 주문 전에 확인합니다.",
    warningTitle:
      raw?.warningTitle ||
      raw?.warning_title ||
      "주문 기준을 한 번 더 확인해 볼까요?",
    warningMessage:
      raw?.warningMessage ||
      raw?.warning_message ||
      "최근 비슷한 주문 상황이 반복됐어요. 처음 세운 기준과 주문 내용을 다시 확인해 보세요.",
  };
}

function readSimulation(raw: FastApiSimulation | undefined): RuleSimulationResult {
  return {
    triggerCount: raw?.triggerCount ?? raw?.trigger_count ?? 0,
    support: raw?.support ?? raw?.triggerCount ?? raw?.trigger_count ?? 0,
    coverage: raw?.coverage ?? 0,
    precision: raw?.precision ?? null,
    recall: raw?.recall ?? null,
    falsePositiveRate: raw?.falsePositiveRate ?? raw?.false_positive_rate ?? null,
    plannedTriggerRate: raw?.plannedTriggerRate ?? raw?.planned_trigger_rate ?? null,
    regrettedCaptureRate:
      raw?.regrettedCaptureRate ?? raw?.regretted_capture_rate ?? null,
    lift: raw?.lift ?? null,
  };
}

function suggestionIdFromCandidate(candidateKey: string) {
  return `sug_${createHash("sha256").update(candidateKey).digest("hex").slice(0, 24)}`;
}

function sourceWindowFromFastApi(
  raw:
    | FastApiNewGuardrailSuggestion["sourceWindow"]
    | FastApiNewGuardrailSuggestion["source_window"],
) {
  if (!raw) return undefined;
  return {
    fromAt: raw.fromAt || raw.from_at || "",
    toAt: raw.toAt || raw.to_at || "",
  };
}

function normalizeProposedRule(params: {
  raw: FastApiProposedRule | undefined;
  userId: string;
  fallbackRuleId: string;
  now: string;
}) {
  if (!params.raw || !params.raw.expression) {
    throw new Error("FASTAPI_GUARDRAIL_SUGGESTION_MISSING_RULE");
  }
  const expression = params.raw.expression as UserGuardrailRuleDTO["expression"];
  const validation = validateRuleExpression(expression);
  const proposedRule = {
    ruleId: params.raw.ruleId || params.raw.rule_id || params.fallbackRuleId,
    userId: params.userId,
    name: params.raw.name || "유사 주문 상황 확인",
    description: params.raw.description ?? null,
    isEnabled: params.raw.isEnabled ?? params.raw.is_enabled ?? true,
    priority: params.raw.priority ?? 999,
    riskLevel: params.raw.riskLevel || params.raw.risk_level || "MEDIUM",
    visualMode: params.raw.visualMode || params.raw.visual_mode || "CURIOUS",
    expression,
    warningTitle:
      params.raw.warningTitle ||
      params.raw.warning_title ||
      "주문 기준을 한 번 더 확인해 볼까요?",
    warningMessage:
      params.raw.warningMessage ||
      params.raw.warning_message ||
      "최근 비슷한 주문 상황이 반복됐어요. 처음 세운 기준과 주문 내용을 다시 확인해 보세요.",
    requiresPrivateApi: validation.requiresPrivateApi,
    schemaVersion: params.raw.schemaVersion || params.raw.schema_version || "v1",
    createdAt: params.now,
    updatedAt: params.now,
  } satisfies DailyInsightReport["suggestions"]["newGuardrails"][number]["proposedRule"];
  return proposedRule;
}

function emptySuggestionSet(): DailyInsightReport["suggestions"] {
  return {
    newGuardrail: null,
    modification: null,
    newGuardrails: [],
    guardrailModifications: [],
    modifications: [],
  };
}

function readNumberFromRecord(
  record: Record<string, unknown> | undefined,
  ...keys: string[]
) {
  for (const key of keys) {
    const value = record?.[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  return 0;
}

function buildSuggestionDiagnosticsFromRaw(raw: GuardrailSuggestionFastApiResponse) {
  const sourceSummary = (raw.sourceSummary || raw.source_summary || {}) as Record<string, unknown>;
  const diagnostics = (raw.diagnostics || {}) as Record<string, unknown>;
  const usedFeatures = Array.isArray(diagnostics.used_feature_names)
    ? diagnostics.used_feature_names
    : Array.isArray(diagnostics.usedFeatureNames)
      ? diagnostics.usedFeatureNames
      : [];
  const status: SuggestionDiagnosticStatus = raw.status || "ERROR";
  return {
    status,
    errorCode: (raw.errorCode || raw.error_code || null) as string | null,
    errorStage: (raw.errorStage || raw.error_stage || null) as string | null,
    totalSnapshotCount: readNumberFromRecord(sourceSummary, "input_sample_count", "inputSampleCount"),
    labeledSampleCount: readNumberFromRecord(sourceSummary, "labeled_sample_count", "labeledSampleCount"),
    regrettedSampleCount: readNumberFromRecord(sourceSummary, "regretted_sample_count", "regrettedSampleCount"),
    shownGuardrailCount: readNumberFromRecord(sourceSummary, "guardrail_trigger_count", "guardrailTriggerCount"),
    analyzableRuleCount: readNumberFromRecord(sourceSummary, "current_rule_count", "currentRuleCount"),
    usedFeatureCount: usedFeatures.length,
    algorithmVersion:
      raw.algorithmVersion ||
      raw.algorithm_version ||
      GUARDRAIL_SUGGESTION_ALGORITHM_VERSION,
  } satisfies NonNullable<DailyInsightReport["suggestionDiagnostics"]>;
}

function buildSuggestionDiagnosticsFromPayload(params: {
  payload: Record<string, unknown>;
  status: SuggestionDiagnosticStatus;
  errorCode: string | null;
  errorStage: string | null;
}) {
  const snapshots = Array.isArray(params.payload.snapshots) ? params.payload.snapshots : [];
  const feedbacks = Array.isArray(params.payload.feedbacks) ? params.payload.feedbacks : [];
  const currentRules = Array.isArray(params.payload.current_rules) ? params.payload.current_rules : [];
  const labeledAttemptIds = new Set(
    feedbacks
      .filter(
        (feedback): feedback is Record<string, unknown> =>
          Boolean(
            feedback &&
              typeof feedback === "object" &&
              (feedback as Record<string, unknown>).feedback_status === "ANSWERED" &&
              (feedback as Record<string, unknown>).attempt_id,
          ),
      )
      .map((feedback) => String(feedback.attempt_id)),
  );
  const labeledSnapshots = snapshots.filter(
    (snapshot) =>
      snapshot &&
      typeof snapshot === "object" &&
      (snapshot as Record<string, unknown>).snapshot_trigger === "ORDER_INTENT_CLICK" &&
      labeledAttemptIds.has(String((snapshot as Record<string, unknown>).attempt_id)),
  );
  const regrettedAttempts = new Set(
    feedbacks
      .filter(
        (feedback): feedback is Record<string, unknown> =>
          Boolean(
            feedback &&
              typeof feedback === "object" &&
              (feedback as Record<string, unknown>).feedback_status === "ANSWERED" &&
              (feedback as Record<string, unknown>).self_assessment === "EMOTIONAL" &&
              (feedback as Record<string, unknown>).attempt_id,
          ),
      )
      .map((feedback) => String(feedback.attempt_id)),
  );
  const shownGuardrailCount = snapshots.filter(
    (snapshot) =>
      snapshot &&
      typeof snapshot === "object" &&
      (Array.isArray((snapshot as Record<string, unknown>).shown_rule_ids)
        ? ((snapshot as Record<string, unknown>).shown_rule_ids as unknown[]).length > 0
        : false),
  ).length;
  return {
    status: params.status,
    errorCode: params.errorCode,
    errorStage: params.errorStage,
    totalSnapshotCount: snapshots.length,
    labeledSampleCount: labeledSnapshots.length,
    regrettedSampleCount: labeledSnapshots.filter((snapshot) =>
      regrettedAttempts.has(String((snapshot as Record<string, unknown>).attempt_id)),
    ).length,
    shownGuardrailCount,
    analyzableRuleCount: currentRules.length,
    usedFeatureCount: 0,
    algorithmVersion: GUARDRAIL_SUGGESTION_ALGORITHM_VERSION,
  } satisfies NonNullable<DailyInsightReport["suggestionDiagnostics"]>;
}

function buildSuggestionErrorResult(params: {
  error: unknown;
  payload: Record<string, unknown>;
}): Pick<DailyInsightReport, "suggestionStatus" | "suggestions" | "suggestionDiagnostics"> {
  const isValidation = params.error instanceof GuardrailSuggestionApiError &&
    params.error.code === "REQUEST_VALIDATION_FAILED";
  return {
    suggestionStatus: "ERROR",
    suggestions: emptySuggestionSet(),
    suggestionDiagnostics: buildSuggestionDiagnosticsFromPayload({
      payload: params.payload,
      status: "ERROR",
      errorCode: isValidation ? "REQUEST_VALIDATION_FAILED" : "UPSTREAM_ERROR",
      errorStage: isValidation ? "REQUEST_VALIDATION" : "UPSTREAM_HTTP",
    }),
  };
}

function normalizeGuardrailSuggestionResponse(params: {
  userId: string;
  raw: GuardrailSuggestionFastApiResponse;
  currentRules: UserGuardrailRuleDTO[];
  now: string;
}): Pick<DailyInsightReport, "suggestionStatus" | "suggestions" | "suggestionDiagnostics"> {
  const status = params.raw.status || "ERROR";
  const diagnostics = buildSuggestionDiagnosticsFromRaw(params.raw);
  const empty = emptySuggestionSet();
  if (status !== "AVAILABLE") {
    return {
      suggestionStatus: status,
      suggestions: empty,
      suggestionDiagnostics: diagnostics,
    };
  }

  const rawNew = params.raw.newGuardrail || params.raw.new_guardrail || null;
  const rawModification = params.raw.modification || null;
  const newGuardrail = rawNew
    ? (() => {
        const candidateKey = rawNew.candidateKey || rawNew.candidate_key;
        if (!candidateKey) throw new Error("FASTAPI_GUARDRAIL_SUGGESTION_MISSING_CANDIDATE_KEY");
        const explanation = readExplanation(rawNew.explanation);
        const fallbackRuleId = `suggested-${createHash("sha1").update(candidateKey).digest("hex").slice(0, 12)}`;
        return {
          suggestionId: suggestionIdFromCandidate(candidateKey),
          candidateKey,
          type: "NEW_GUARDRAIL",
          status: "PENDING",
          createdAt: params.now,
          acceptedAt: null,
          dismissedAt: null,
          acceptedRuleId: null,
          title: explanation.title,
          rationale: explanation.rationale,
          explanation,
          evidenceCount: rawNew.evidenceCount ?? rawNew.evidence_count ?? 0,
          confidence: rawNew.confidence ?? 0,
          proposedRule: normalizeProposedRule({
            raw: rawNew.proposedRule || rawNew.proposed_rule,
            userId: params.userId,
            fallbackRuleId,
            now: params.now,
          }),
          representativeValues:
            rawNew.representativeValues || rawNew.representative_values || {},
          simulation: readSimulation(rawNew.simulation),
          evaluationMode: "IN_SAMPLE",
          sourceWindow: sourceWindowFromFastApi(rawNew.sourceWindow || rawNew.source_window),
        } satisfies NewGuardrailSuggestion;
      })()
    : null;

  const modification = rawModification
    ? (() => {
        const candidateKey = rawModification.candidateKey || rawModification.candidate_key;
        const ruleId = rawModification.ruleId || rawModification.rule_id;
        if (!candidateKey || !ruleId) {
          throw new Error("FASTAPI_GUARDRAIL_MODIFICATION_MISSING_KEY");
        }
        const currentRule = params.currentRules.find((rule) => rule?.ruleId === ruleId);
        if (!currentRule) {
          throw new Error("FASTAPI_GUARDRAIL_MODIFICATION_RULE_NOT_FOUND");
        }
        const explanation = readExplanation(rawModification.explanation);
        return {
          suggestionId: suggestionIdFromCandidate(candidateKey),
          candidateKey,
          type: "MODIFY_GUARDRAIL",
          status: "PENDING",
          createdAt: params.now,
          acceptedAt: null,
          dismissedAt: null,
          acceptedRuleId: null,
          guardrailId: ruleId,
          ruleId,
          baseRuleHash:
            rawModification.baseRuleHash ||
            rawModification.base_rule_hash ||
            canonicalRuleExpressionHash(currentRule.expression),
          title: explanation.title,
          rationale: explanation.rationale,
          explanation,
          evidenceCount:
            rawModification.evidenceCount ?? rawModification.evidence_count ?? 0,
          confidence: rawModification.confidence ?? 0,
          currentRule,
          proposedRule: normalizeProposedRule({
            raw: rawModification.proposedRule || rawModification.proposed_rule,
            userId: params.userId,
            fallbackRuleId: ruleId,
            now: params.now,
          }),
          diff: rawModification.diff || [],
          representativeValues:
            rawModification.representativeValues ||
            rawModification.representative_values ||
            {},
          currentSimulation: readSimulation(
            rawModification.currentSimulation || rawModification.current_simulation,
          ),
          proposedSimulation: readSimulation(
            rawModification.proposedSimulation || rawModification.proposed_simulation,
          ),
          evaluationMode: "IN_SAMPLE",
          sourceWindow: sourceWindowFromFastApi(
            rawModification.sourceWindow || rawModification.source_window,
          ),
        } satisfies GuardrailModificationSuggestion;
      })()
    : null;

  const hasSuggestions = Boolean(newGuardrail || modification);
  return {
    suggestionStatus: hasSuggestions ? "AVAILABLE" : "NO_SUGGESTION",
    suggestions: {
      newGuardrail,
      modification,
      newGuardrails: newGuardrail ? [newGuardrail] : [],
      guardrailModifications: modification ? [modification] : [],
      modifications: modification ? [modification] : [],
    },
    suggestionDiagnostics: {
      ...diagnostics,
      status: hasSuggestions ? "AVAILABLE" : "NO_SUGGESTION",
    },
  };
}

function filterDismissedSuggestions(
  analysis: Pick<DailyInsightReport, "suggestionStatus" | "suggestions" | "suggestionDiagnostics">,
  dismissedCandidateKeys: Set<string>,
): Pick<DailyInsightReport, "suggestionStatus" | "suggestions" | "suggestionDiagnostics"> {
  const newGuardrail =
    analysis.suggestions.newGuardrail?.candidateKey &&
    dismissedCandidateKeys.has(analysis.suggestions.newGuardrail.candidateKey)
      ? null
      : analysis.suggestions.newGuardrail ?? null;
  const modification =
    analysis.suggestions.modification?.candidateKey &&
    dismissedCandidateKeys.has(analysis.suggestions.modification.candidateKey)
      ? null
      : analysis.suggestions.modification ?? null;
  if (!newGuardrail && !modification && analysis.suggestionStatus === "AVAILABLE") {
    const diagnostics =
      analysis.suggestionDiagnostics ||
      buildSuggestionDiagnosticsFromPayload({
        payload: {},
        status: "NO_SUGGESTION",
        errorCode: null,
        errorStage: null,
      });
    return {
      suggestionStatus: "NO_SUGGESTION",
      suggestions: {
        newGuardrail: null,
        modification: null,
        newGuardrails: [],
        guardrailModifications: [],
        modifications: [],
      },
      suggestionDiagnostics: {
        ...diagnostics,
        status: "NO_SUGGESTION",
      },
    };
  }
  return {
    suggestionStatus: analysis.suggestionStatus,
    suggestions: {
      newGuardrail,
      modification,
      newGuardrails: newGuardrail ? [newGuardrail] : [],
      guardrailModifications: modification ? [modification] : [],
      modifications: modification ? [modification] : [],
    },
    suggestionDiagnostics: analysis.suggestionDiagnostics,
  };
}

function toSafeErrorMessage(error: unknown) {
  if (error instanceof DOMException && error.name === "AbortError") {
    return "AI 분석 요청 시간이 초과되었습니다.";
  }
  if (error instanceof Error && error.message.includes("FASTAPI_DAILY_INSIGHT_FAILED")) {
    return "AI 분석 서버 응답을 처리하지 못했습니다.";
  }
  return "AI 인사이트 생성 중 오류가 발생했습니다.";
}

function mapSuggestionTransactionError(error: unknown): never {
  const message = error instanceof Error ? error.message : "";
  if (message === "SUGGESTION_NOT_FOUND") {
    throw new ApiError(404, "SUGGESTION_NOT_FOUND", "제안을 찾을 수 없습니다.");
  }
  if (message === "SUGGESTION_ALREADY_HANDLED") {
    throw new ApiError(409, "SUGGESTION_ALREADY_HANDLED", "이미 처리된 제안입니다.");
  }
  if (message === "RULE_NOT_FOUND") {
    throw new ApiError(404, "RULE_NOT_FOUND", "수정할 규칙을 찾을 수 없습니다.");
  }
  if (message === "RULE_VERSION_CONFLICT") {
    throw new ApiError(
      409,
      "RULE_VERSION_CONFLICT",
      "규칙이 제안 생성 이후 변경됐어요. 현재 규칙을 기준으로 다시 분석해 주세요.",
    );
  }
  throw error;
}

export async function generateDailyInsightReport(params: {
  userId: string;
  date?: string | null;
}): Promise<DailyInsightReport> {
  enforceGenerationRateLimit(params.userId);

  const timezone = await getUserTimezone(params.userId);
  const date = normalizeDate(params.date);
  const generatedAt = new Date().toISOString();
  const reportId = makeDailyReportId(date, generatedAt);
  const { sources, inputHash, sourceCounts } = await buildDailyInput({
    userId: params.userId,
    date,
    timezone,
    generatedAt,
  });
  const generationLock = await tryStartDailyReportGeneration({
    userId: params.userId,
    reportId,
    date,
    timezone,
    inputHash,
    sourceCounts,
  });

  if (!generationLock.started) {
    return generationLock.report;
  }

  try {
    const timeline = buildDailyTimeline(sources) as DailyInsightReport["timeline"];
    const orderFlows = buildOrderFlows({
      ...sources,
      timeline,
    }) as DailyInsightReport["orderFlows"];
    const cancelledOrderVirtualPnl = await computeCancelledOrderVirtualPnl({
      ...sources,
      generatedAt,
      getCurrentPrice: async (market: string) => {
        const ticker = await getTicker(market);
        return String(ticker.trade_price);
      },
    });
    const metrics: DailyInsightReport["metrics"] = {
      cancelledOrderVirtualPnl: cancelledOrderVirtualPnl as DailyInsightReport["metrics"]["cancelledOrderVirtualPnl"],
      waitingPriceEffect: computeWaitingPriceEffect(sources) as DailyInsightReport["metrics"]["waitingPriceEffect"],
      reducedExposure: computeReducedExposure(sources) as DailyInsightReport["metrics"]["reducedExposure"],
      feedbackPnlComparison: computeFeedbackPnlComparison(sources) as DailyInsightReport["metrics"]["feedbackPnlComparison"],
    };
    const dataAvailability = computeInsightDataAvailability(
      sources,
    ) as DailyInsightReport["dataAvailability"];
    const facts = buildFactSummaries({
      sourceCounts,
      metrics,
      availability: dataAvailability,
    });
    const suggestionPayload = buildGuardrailSuggestionRequest({
      date,
      timezone,
      generatedAt,
      sources,
      fieldCatalog: RULE_ELIGIBLE_FIELD_CATALOG,
    }) as Record<string, unknown>;
    const generationDiagnostics = buildDailyInsightDiagnostics({
      sources,
      suggestionRequest: suggestionPayload,
    });
    console.info("Daily insight generation diagnostics", generationDiagnostics);
    const dismissedSince = new Date(
      new Date(generatedAt).getTime() - 14 * 24 * 60 * 60 * 1000,
    ).toISOString();
    const dismissedCandidateKeysPromise = listDismissedSuggestionCandidateKeys({
      userId: params.userId,
      since: dismissedSince,
    }).catch(() => new Set<string>());

    const [overviewResult, fieldAnalysisResult, suggestionResult] = await Promise.allSettled([
      requestDailyInsightFastApi<DailyInsightReport["overview"]>(
        getAnalyzeUrl(),
        facts,
      ),
      requestDailyInsightFastApi<FieldAnalyzeResponse>(getFieldAnalyzeUrl(), facts).then(
        mapFieldAnalysis,
      ),
      Promise.all([
        requestGuardrailSuggestionFastApi(suggestionPayload),
        dismissedCandidateKeysPromise,
      ]).then(([raw, dismissedCandidateKeys]) =>
        filterDismissedSuggestions(
          normalizeGuardrailSuggestionResponse({
            userId: params.userId,
            raw,
            currentRules: sources.rules,
            now: generatedAt,
          }),
          dismissedCandidateKeys,
        ),
      ),
    ]);
    const analysisResult = mergeAnalysisResults({
      existingReport: null,
      overview: overviewResult,
      fieldAnalysis: fieldAnalysisResult,
    }) as Pick<
      DailyInsightReport,
      "status" | "overview" | "fieldAnalysis" | "analysisStatus"
    >;
    const overview = sanitizeOverviewWithAvailability(
      analysisResult.overview,
      dataAvailability,
    ) as DailyInsightReport["overview"];
    const fieldAnalysis = sanitizeFieldAnalysisWithAvailability(
      analysisResult.fieldAnalysis,
      dataAvailability,
    ) as DailyInsightReport["fieldAnalysis"];
    const sanitizedStatus =
      overview && fieldAnalysis
        ? "COMPLETED"
        : overview || fieldAnalysis
          ? "PARTIAL"
          : "FAILED";
    const sanitizedAnalysisStatus = {
      overview: overview ? "COMPLETED" : "FAILED",
      fieldAnalysis: fieldAnalysis ? "COMPLETED" : "FAILED",
    } as DailyInsightReport["analysisStatus"];
    const suggestionAnalysis: Pick<
      DailyInsightReport,
      "suggestionStatus" | "suggestions" | "suggestionDiagnostics"
    > =
      suggestionResult.status === "fulfilled"
        ? suggestionResult.value
        : buildSuggestionErrorResult({
            error: suggestionResult.reason,
            payload: suggestionPayload,
          });
    if (suggestionResult.status === "rejected") {
      console.error("Guardrail suggestion analysis failed", {
        errorCode: suggestionAnalysis.suggestionDiagnostics?.errorCode,
        errorStage: suggestionAnalysis.suggestionDiagnostics?.errorStage,
        status: suggestionAnalysis.suggestionDiagnostics?.status,
      });
    }
    const suggestionStatus = suggestionAnalysis.suggestionStatus;
    const suggestions = suggestionAnalysis.suggestions;

    const now = new Date().toISOString();
    const report: DailyInsightReport = {
      reportId,
      userId: params.userId,
      date,
      timezone,
      status: sanitizedStatus,
      analysisStatus: sanitizedAnalysisStatus,
      promptVersion: AI_PROMPT_VERSION,
      analysisVersion: ANALYSIS_VERSION,
      inputHash,
      sourceCounts,
      timeline,
      orderFlows,
      metrics,
      dataAvailability,
      overview,
      fieldAnalysis,
      suggestions,
      suggestionStatus,
      suggestionDiagnostics: suggestionAnalysis.suggestionDiagnostics,
      generatedAt: now,
      createdAt: now,
      updatedAt: now,
      errorCode:
        sanitizedStatus === "FAILED"
          ? "DAILY_INSIGHT_ANALYSIS_FAILED"
          : null,
      errorMessage:
        sanitizedStatus === "FAILED"
          ? "AI 분석 결과를 생성하지 못했습니다."
          : null,
    };
    report.debugSummary = buildDailyReportDebugSummary({
      sources,
      report,
      facts,
      suggestionRequest: suggestionPayload,
    });

    return saveDailyInsightReport(report);
  } catch (error) {
    const failed = await saveFailedDailyInsightReport({
      userId: params.userId,
      reportId,
      date,
      timezone,
      inputHash,
      sourceCounts,
      errorCode: "DAILY_INSIGHT_GENERATION_FAILED",
      errorMessage: toSafeErrorMessage(error),
    });
    return failed;
  }
}

export function getTodayKstRange() {
  return getDailyRange(normalizeDate(null), DEFAULT_TIMEZONE);
}

export async function acceptInsightSuggestion(params: {
  userId: string;
  date?: string;
  suggestionId: string;
}) {
  const found = await findDailyInsightSuggestion(params);
  if (!found) {
    throw new ApiError(404, "SUGGESTION_NOT_FOUND", "제안을 찾을 수 없습니다.");
  }
  if (found.suggestion.type === "NEW_GUARDRAIL") {
    const proposed = found.suggestion.proposedRule;
    const validation = validateRuleExpression(proposed.expression);
    const result = await acceptNewGuardrailSuggestionInTransaction({
      userId: params.userId,
      date: found.report.date,
      suggestionId: params.suggestionId,
      requiresPrivateApi: validation.requiresPrivateApi,
    }).catch(mapSuggestionTransactionError);
    return { suggestionId: params.suggestionId, status: "ACCEPTED", rule: result.rule };
  }

  const current = await getOwnedRule({
    userId: params.userId,
    ruleId: found.suggestion.guardrailId,
  });
  if (!current) {
    throw new ApiError(404, "RULE_NOT_FOUND", "수정할 규칙을 찾을 수 없습니다.");
  }
  if (found.suggestion.baseRuleHash && canonicalRuleExpressionHash(current.expression) !== found.suggestion.baseRuleHash) {
    throw new ApiError(
      409,
      "RULE_VERSION_CONFLICT",
      "규칙이 제안 생성 이후 변경됐어요. 현재 규칙을 기준으로 다시 분석해 주세요.",
    );
  }

  const proposed = found.suggestion.proposedRule;
  const validation = validateRuleExpression(proposed.expression);
  const result = await acceptModificationSuggestionInTransaction({
    userId: params.userId,
    date: found.report.date,
    suggestionId: params.suggestionId,
    requiresPrivateApi: validation.requiresPrivateApi,
  }).catch(mapSuggestionTransactionError);
  return { suggestionId: params.suggestionId, status: "ACCEPTED", rule: result.rule };
}

export async function dismissInsightSuggestion(params: {
  userId: string;
  date?: string;
  suggestionId: string;
}) {
  const found = await findDailyInsightSuggestion(params);
  if (!found) {
    throw new ApiError(404, "SUGGESTION_NOT_FOUND", "제안을 찾을 수 없습니다.");
  }
  const report = await updateDailyInsightSuggestionStatus({
    userId: params.userId,
    date: found.report.date,
    suggestionId: params.suggestionId,
    status: "DISMISSED",
  });
  await saveGuardrailSuggestionHistory({
    userId: params.userId,
    suggestionId: params.suggestionId,
    action: "DISMISSED",
    payload: {
      type: found.suggestion.type,
      candidateKey: found.suggestion.candidateKey ?? null,
    },
  });
  return { suggestionId: params.suggestionId, status: "DISMISSED", report };
}
