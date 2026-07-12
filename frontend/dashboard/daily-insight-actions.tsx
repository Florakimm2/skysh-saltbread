"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type {
  DailyInsightEligibility,
  DailyInsightReport,
} from "@/backend/modules/insight/daily-types";
import { buildDailyInsightCtaViewModel } from "./daily-insight-view-model";
import styles from "./dashboard.module.css";

export default function DailyInsightActions({
  status,
  todayReport = null,
  onViewReport,
  onGenerated,
}: {
  status: DailyInsightEligibility;
  todayReport?: DailyInsightReport | null;
  onViewReport?: () => void;
  onGenerated?: (report: DailyInsightReport) => void;
}) {
  const router = useRouter();
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cta = buildDailyInsightCtaViewModel(status, todayReport);

  async function handleGenerate() {
    setIsGenerating(true);
    setError(null);
    try {
      const response = await fetch("/api/insights/daily/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date: status.date }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok || payload?.ok === false) {
        throw new Error(payload?.message || "AI 인사이트 생성에 실패했습니다.");
      }
      if (payload?.data) {
        onGenerated?.(payload.data as DailyInsightReport);
      }
      router.refresh();
    } catch (nextError) {
      setError(
        nextError instanceof Error
          ? nextError.message
          : "AI 인사이트 생성에 실패했습니다.",
      );
    } finally {
      setIsGenerating(false);
    }
  }

  function handlePrimaryAction() {
    if (cta.state === "GENERATING") {
      return;
    }
    if (["COMPLETED", "PARTIAL", "STALE"].includes(cta.state) && onViewReport) {
      onViewReport?.();
      return;
    }
    void handleGenerate();
  }

  return (
    <div className={styles.dailyInsightCta} aria-live="polite">
      <div className={styles.emptyStateInner}>
        <strong>{cta.title}</strong>
        {cta.message ? <p>{cta.message}</p> : null}
        {cta.showProgress ? (
          <div className={styles.feedbackProgress} aria-label={cta.meta ?? undefined}>
            <span>{cta.meta}</span>
            <div>
              <i style={{ width: `${cta.progress * 100}%` }} />
            </div>
          </div>
        ) : null}
        {cta.steps.length > 0 ? (
          <ol className={styles.insightStepList}>
            {cta.steps.map((step: string) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
        ) : null}
        {cta.primaryAction ? (
          <button
            className={styles.primaryButton}
            type="button"
            onClick={handlePrimaryAction}
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
