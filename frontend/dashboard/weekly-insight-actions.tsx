"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type {
  WeeklyInsightReport,
  WeeklyInsightStatusResponse,
} from "@/backend/modules/insight/weekly-types";
import styles from "./dashboard.module.css";

function buildWeeklyCta(status: WeeklyInsightStatusResponse, report: WeeklyInsightReport | null) {
  const isClosed = status.periodState === "CLOSED";
  const progress = Math.min(
    1,
    status.answeredFeedbackCount / status.requiredFeedbackCount,
  );
  if (status.reportStatus === "GENERATING") {
    return {
      title: "주간 리포트를 만들고 있어요.",
      message: "주문 흐름과 가드레일 기록을 연결해 분석하는 중입니다.",
      primaryAction: null,
      state: "GENERATING",
      progress,
    };
  }
  if (report && ["COMPLETED", "PARTIAL", "STALE"].includes(status.reportStatus)) {
    return {
      title: status.reportStatus === "STALE" ? "새 기록이 쌓였어요." : "주간 리포트가 준비됐어요.",
      message: status.reportStatus === "STALE"
        ? "기존 리포트를 보거나 최신 기록으로 다시 생성할 수 있어요."
        : "저장된 주간 리포트에서 반복된 주문 흐름을 확인해 보세요.",
      primaryAction: "저장 리포트 보기",
      secondaryAction: status.reportStatus === "STALE" ? "최신 기록으로 다시 생성" : null,
      state: status.reportStatus,
      progress,
    };
  }
  if (status.eligible) {
    return {
      title: isClosed ? "지난주 리포트를 만들 수 있어요" : "이번 주 기록이 충분히 쌓였어요",
      message: isClosed
        ? "지난 한 주 동안의 주문 기록과 가드레일 패턴을 확인해 보세요."
        : "이번 주에 쌓인 주문 시도와 가드레일 기록을 주간 리포트로 확인해 보세요.",
      primaryAction: isClosed ? "지난주 리포트 생성" : "이번 주 리포트 생성",
      state: "READY",
      progress,
    };
  }
  return {
    title: isClosed ? "지난주 기록을 더 쌓아야 해요" : "이번 주 기록을 모으는 중이에요",
    message: `피드백 ${status.requiredFeedbackCount - status.answeredFeedbackCount}개가 더 쌓이면 주간 리포트를 만들 수 있어요.`,
    primaryAction: null,
    state: "WAITING",
    progress,
  };
}

export default function WeeklyInsightActions({
  status,
  report = null,
  onViewReport,
  onGenerated,
}: {
  status: WeeklyInsightStatusResponse;
  report?: WeeklyInsightReport | null;
  onViewReport?: () => void;
  onGenerated?: (report: WeeklyInsightReport) => void;
}) {
  const router = useRouter();
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cta = buildWeeklyCta(status, report);

  async function handleGenerate() {
    setIsGenerating(true);
    setError(null);
    try {
      const response = await fetch("/api/insights/weekly/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ weekKey: status.weekKey }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok || payload?.ok === false) {
        throw new Error(payload?.message || "주간 AI 인사이트 생성에 실패했습니다.");
      }
      if (payload?.data) {
        onGenerated?.(payload.data as WeeklyInsightReport);
      }
      router.refresh();
    } catch (nextError) {
      setError(
        nextError instanceof Error
          ? nextError.message
          : "주간 AI 인사이트 생성에 실패했습니다.",
      );
    } finally {
      setIsGenerating(false);
    }
  }

  function handlePrimary() {
    if (cta.state === "GENERATING") return;
    if (report && cta.primaryAction === "저장 리포트 보기") {
      onViewReport?.();
      return;
    }
    void handleGenerate();
  }

  return (
    <div className={styles.dailyInsightCta} aria-live="polite">
      <div className={styles.emptyStateInner}>
        <strong>{cta.title}</strong>
        <p>{cta.message}</p>
        <div className={styles.feedbackProgress} aria-label={`피드백 ${status.answeredFeedbackCount}/${status.requiredFeedbackCount}`}>
          <span>피드백 {status.answeredFeedbackCount}/{status.requiredFeedbackCount}</span>
          <div>
            <i style={{ width: `${cta.progress * 100}%` }} />
          </div>
        </div>
        {cta.primaryAction ? (
          <button
            className={styles.primaryButton}
            type="button"
            onClick={handlePrimary}
            disabled={isGenerating || cta.state === "GENERATING"}
          >
            {isGenerating ? "생성 중..." : cta.primaryAction}
          </button>
        ) : null}
        {cta.secondaryAction ? (
          <button
            className={styles.secondaryButton}
            type="button"
            onClick={handleGenerate}
            disabled={isGenerating}
          >
            {isGenerating ? "생성 중..." : cta.secondaryAction}
          </button>
        ) : null}
        {error ? <p>{error}</p> : null}
      </div>
    </div>
  );
}
