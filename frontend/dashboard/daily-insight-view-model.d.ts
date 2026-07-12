import type {
  DailyInsightEligibility,
  DailyInsightReport,
} from "@/backend/modules/insight/daily-types";

export type DailyInsightCtaViewModel = {
  state: string;
  answered: number;
  required: number;
  progress: number;
  primaryAction: string | null;
  secondaryAction: string | null;
  meta: string | null;
  showProgress: boolean;
  steps: string[];
  title: string;
  message: string;
};

export type ReportListItemViewModel = {
  key: string;
  date: string;
  dateLabel: string;
  statusLabel: string;
  meta: string;
  summary: string;
  selected: boolean;
};

export type ReportNoticeViewModel = {
  title: string;
  message: string;
  action: string;
};

export const CURRENT_ANALYSIS_VERSION: string;
export const CURRENT_PROMPT_VERSION: string;
export function buildDailyInsightCtaViewModel(
  eligibility: DailyInsightEligibility,
  todayReport?: DailyInsightReport | null,
): DailyInsightCtaViewModel;
export function buildFlowSteps(flow: Record<string, unknown>): string[];
export function buildKeyInsightCards(report: DailyInsightReport | null): Array<Record<string, unknown>>;
export function buildOrderFlowViewModels(report: DailyInsightReport | null): Record<string, unknown>;
export function buildReportHeroViewModel(report: DailyInsightReport | null): Record<string, unknown> | null;
export function buildReportListItem(
  report: DailyInsightReport,
  selectedReportId: string | null,
): ReportListItemViewModel;
export function buildVirtualPnlViewModel(metric: unknown): Record<string, unknown>;
export function formatDateKorean(date: string): string;
export function formatDecimal(value: unknown): string;
export function formatKrw(value: unknown): string;
export function formatPercent(value: unknown): string;
export function formatTimeKorean(value: string): string;
export function getDailyInsightCtaViewState(
  eligibility: DailyInsightEligibility,
  todayReport?: DailyInsightReport | null,
): string;
export function getMarketLabel(market: string | null): string;
export function getReportVersionNotice(report: DailyInsightReport | null): ReportNoticeViewModel | null;
export function getSeverityLabel(severity: string): string;
export function getSideLabel(side: string | null): string;
export function normalizeReport(report: DailyInsightReport | null): DailyInsightReport | null;
export function pickDashboardMetric(report: DailyInsightReport | null): string | null;
export function pickImportantCard(report: DailyInsightReport | null): Record<string, unknown> | null;
export function reactionSentence(action: string | null): string | null;
