import type {
  DailyInsightReport,
} from "@/backend/modules/insight/daily-types";
import type { FlameMode } from "@/frontend/auth/flame-mascot";
import {
  formatDateKorean,
  formatKrw,
  formatPercent,
  getSeverityLabel,
} from "./daily-insight-view-model";

type InsightMetricStatus =
  | "AVAILABLE"
  | "NO_MATCHING_DATA"
  | "INSUFFICIENT_DATA"
  | "ERROR";

type InsightCard = NonNullable<DailyInsightReport["overview"]>["cards"][number];

export type LatestInsightCardViewModel = {
  dateLabel: string;
  shortDateLabel: string;
  flameMode: FlameMode;
  flameLabel: string | null;
  summary: string;
  oneLineAdvice: string | null;
  primaryCard: {
    label: string;
    description: string;
    severityLabel: string;
  } | null;
  primaryMetric: {
    label: string;
    value: string;
    description: string | null;
  } | null;
  isLegacyReport: boolean;
};

const FLAME_STATUS_LABELS: Record<string, string> = {
  default: "기본",
  breathing: "원칙 유지",
  sad: "돌아보기",
  fastBurn: "반복 주문 주의",
  surprised: "급격한 변화",
  scared: "위험 신호",
  curious: "확인 필요",
};

const SEVERITY_PRIORITY = new Map([
  ["critical", 0],
  ["high", 1],
  ["medium", 2],
  ["low", 3],
]);

const SEVERITY_LABELS: Record<string, string> = {
  critical: "꼭 확인",
  high: "주의",
  medium: "살펴보기",
  low: "안정적",
  unavailable: "데이터 부족",
};

function formatDateLabel(date: string | undefined, format: "long" | "short") {
  if (!date) return format === "long" ? "최근 기록" : "최근 기록";
  if (format === "long") return `${formatDateKorean(date)} 기록`;
  const match = date.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return match ? `${Number(match[2])}월 ${Number(match[3])}일` : date;
}

function normalizeFlameMode(status: string | undefined): FlameMode {
  if (
    status === "default" ||
    status === "sad" ||
    status === "fastBurn" ||
    status === "surprised" ||
    status === "scared" ||
    status === "curious"
  ) {
    return status;
  }
  return "default";
}

function pickPrimaryCard(cards: InsightCard[] | undefined) {
  return [...(cards ?? [])].sort(
    (a, b) =>
      (SEVERITY_PRIORITY.get(a.severity) ?? 99) -
      (SEVERITY_PRIORITY.get(b.severity) ?? 99),
  )[0] ?? null;
}

function normalizeLegacyCardTitle(title: string | undefined) {
  const rawTitle = (title ?? "").trim();
  if (!rawTitle) return "주문 기록에서 확인할 패턴";

  if (rawTitle.includes("귀를 닫은") || rawTitle.includes("가드레일 이후")) {
    return "가드레일 이후 계속 진행한 기록";
  }

  if (rawTitle.includes("차분한") || rawTitle.includes("승부사")) {
    return "계획과 실제 주문 행동";
  }

  if (rawTitle.includes("감정적 진입")) {
    return "후회가 남는다고 기록한 주문";
  }

  return rawTitle
    .replace(/^\[[^\]]+\]\s*/u, "")
    .replace(/^[^\p{L}\p{N}]+/u, "")
    .replace(/차분한 투자|침착한 투자|감정적인 투자|이성적인 투자/gu, "주문 기록")
    .trim() || "주문 기록에서 확인할 패턴";
}

function isAvailable(metric: { status?: InsightMetricStatus } | undefined) {
  return metric?.status === "AVAILABLE";
}

function buildPrimaryMetric(report: DailyInsightReport) {
  const cancelled = report.metrics?.cancelledOrderVirtualPnl;
  if (isAvailable(cancelled)) {
    const firstItem = cancelled?.items?.[0];
    const value =
      typeof cancelled?.sampleCount === "number"
        ? `비교 주문 ${cancelled.sampleCount}건`
        : "비교 주문 기록";
    const rate = firstItem ? formatPercent(firstItem.virtualReturnRate) : null;
    const amount = formatKrw(firstItem?.virtualPnl ?? cancelled?.netVirtualPnl);
    return {
      label: "최근 24시간 가격 효과",
      value,
      description: [rate, amount].filter(Boolean).join(" · ") || null,
    };
  }

  const waiting = report.metrics?.waitingPriceEffect;
  if (isAvailable(waiting)) {
    const firstItem = waiting?.items?.[0] as
      | { priceEffectRate?: number | string }
      | undefined;
    return {
      label: "기다린 가격 효과",
      value:
        typeof waiting?.sampleCount === "number"
          ? `비교 주문 ${waiting.sampleCount}건`
          : "비교 주문 기록",
      description: firstItem ? formatPercent(firstItem.priceEffectRate) : null,
    };
  }

  const reduced = report.metrics?.reducedExposure;
  if (isAvailable(reduced)) {
    return {
      label: "줄인 위험 노출액",
      value: formatKrw(reduced?.totalReducedExposureAmount) || "주문 규모 조정 기록",
      description:
        typeof reduced?.sampleCount === "number"
          ? `비교 주문 ${reduced.sampleCount}건`
          : null,
    };
  }

  const comparison = report.metrics?.feedbackPnlComparison;
  if (isAvailable(comparison)) {
    const planned = comparison?.groups?.PLANNED;
    const regret = comparison?.groups?.EMOTIONAL;
    const plannedRate = planned?.averageReturnRate != null ? formatPercent(planned.averageReturnRate) : null;
    const regretRate = regret?.averageReturnRate != null ? formatPercent(regret.averageReturnRate) : null;
    const sampleCount =
      (planned?.sampleCount ?? 0) + (regret?.sampleCount ?? 0);
    return {
      label: "계획 주문과 후회 주문 비교",
      value: sampleCount > 0 ? `비교 주문 ${sampleCount}건` : "비교 가능한 주문 기록",
      description:
        plannedRate || regretRate
          ? `계획 ${plannedRate ?? "-"} · 후회 ${regretRate ?? "-"}`
          : null,
    };
  }

  return {
    label: "정량 지표",
    value: "비교 가능한 가격 효과가 아직 없어요.",
    description: null,
  };
}

export function buildLatestInsightCardViewModel(
  report: DailyInsightReport,
): LatestInsightCardViewModel {
  const flameStatus = report.overview?.flameStatus?.trim();
  const primaryCard = pickPrimaryCard(report.overview?.cards);
  const summary =
    report.overview?.summary?.trim() || "저장된 기록을 확인해 보세요.";
  const oneLineAdvice = report.fieldAnalysis?.oneLineAdvice?.trim() || null;
  const normalizedPrimaryCard = primaryCard
    ? {
        label: normalizeLegacyCardTitle(primaryCard.title),
        description:
          primaryCard.description?.trim() ||
          "주문 기록에서 반복되는 흐름을 확인해 보세요.",
        severityLabel:
          SEVERITY_LABELS[primaryCard.severity] ??
          getSeverityLabel(primaryCard.severity),
      }
    : null;

  return {
    dateLabel: formatDateLabel(report.date, "long"),
    shortDateLabel: formatDateLabel(report.date, "short"),
    flameMode: normalizeFlameMode(flameStatus),
    flameLabel: flameStatus ? FLAME_STATUS_LABELS[flameStatus] ?? null : null,
    summary,
    oneLineAdvice,
    primaryCard: normalizedPrimaryCard,
    primaryMetric: buildPrimaryMetric(report),
    isLegacyReport:
      !report.analysisStatus ||
      !report.suggestionStatus ||
      !report.metrics?.cancelledOrderVirtualPnl,
  };
}
