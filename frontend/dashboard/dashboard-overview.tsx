import Link from "next/link";
import type {
  WeeklyInsightReport,
  WeeklyInsightStatusResponse,
} from "@/backend/modules/insight/weekly-types";
import type { GuardrailTimelineResponse } from "@/backend/modules/logs/types";
import FlameMascot from "@/frontend/auth/flame-mascot";
import { formatKrw, formatPercent } from "./daily-insight-view-model";
import PageHeader from "./page-header";
import {
  NoteIcon,
  SparklesIcon,
} from "./icons";
import GuardrailTimeline from "./guardrail-history/GuardrailTimeline";
import styles from "./dashboard.module.css";

function InsightPreview({
  report,
  status,
}: {
  report: WeeklyInsightReport | null;
  status: WeeklyInsightStatusResponse;
}) {
  const isClosed = status.periodState === "CLOSED";
  if (!report) {
    return (
      <article className={styles.insightPreview}>
        <div className={styles.insightPreviewContent}>
          <section className={styles.insightSummaryBlock}>
            <h3>
              {isClosed ? "지난주 기록이 준비됐어요" : "이번 주 AI 인사이트"}
            </h3>
            <p>
              한 주 동안 쌓인 주문 시도와 가드레일 기록을 확인해 보세요.
            </p>
          </section>
        </div>
        <Link
          className={styles.insightDetailLink}
          href={`/dashboard/ai-insights?week=${encodeURIComponent(status.weekKey)}&focus=generate`}
        >
          주간 리포트 생성하기 →
        </Link>
      </article>
    );
  }

  const primaryCard = report.overview?.cards?.[0] || null;
  const virtualMetric = report.metrics?.twentyFourHourVirtualOrderResult;
  const metricLabel =
    virtualMetric?.status === "AVAILABLE"
      ? `${virtualMetric.sampleCount}건 · ${formatKrw(virtualMetric.netValue)}`
      : "비교 가능한 24시간 가격 효과가 아직 없어요.";

  return (
    <article className={styles.insightPreview}>
      <div className={styles.insightPreviewTop}>
        <div>
          <span className={styles.insightEyebrow}>
            {report.periodState === "CLOSED" ? "지난주 AI 인사이트" : "이번 주 AI 인사이트"}
          </span>
          <time dateTime={report.periodStart}>
            {report.periodStart.slice(5, 10).replace("-", ".")} ~ {report.periodEnd.slice(5, 10).replace("-", ".")}
          </time>
        </div>
        <span className={styles.insightStatusBadge}>
          {report.periodState === "CLOSED" ? "최종" : "진행 중"}
        </span>
      </div>

      <div className={styles.insightPreviewBody}>
        <div className={styles.insightMascot} aria-hidden="true">
            <FlameMascot
              label=""
              mode="default"
              size="clamp(70px, 8vw, 96px)"
              speed="slow"
            />
        </div>

        <div className={styles.insightPreviewContent}>
          <section className={styles.insightSummaryBlock}>
            <h3>이번 주 기록에서 발견한 패턴</h3>
            <p>{report.overview?.summary || "저장된 주간 리포트를 확인해 보세요."}</p>
          </section>

          {report.fieldAnalysis?.oneLineAdvice ? (
            <section className={styles.insightAdviceBox}>
              <span>다음 주에 확인할 원칙</span>
              <p>{report.fieldAnalysis.oneLineAdvice}</p>
            </section>
          ) : null}

          <div className={styles.insightHighlightGrid}>
            {primaryCard ? (
              <section className={styles.insightMiniCard}>
                <span>핵심 패턴</span>
                <strong>{primaryCard.title}</strong>
                <p>{primaryCard.description}</p>
              </section>
            ) : null}

            <section className={styles.insightMiniCard}>
              <span>24시간 가상 주문 결과</span>
              <strong>{metricLabel}</strong>
              {virtualMetric?.items?.[0]?.returnRate != null ? (
                <p>{formatPercent(virtualMetric.items[0].returnRate)}</p>
              ) : null}
            </section>
          </div>
        </div>
      </div>

      <Link className={styles.insightDetailLink} href={`/dashboard/ai-insights?week=${report.weekKey}`}>
        전체 보기 →
      </Link>
    </article>
  );
}

export default function DashboardOverview({
  insight,
  timeline,
  isTimelineUnavailable = false,
}: {
  insight: {
    report: WeeklyInsightReport | null;
    status: WeeklyInsightStatusResponse;
  };
  timeline: GuardrailTimelineResponse | null;
  isTimelineUnavailable?: boolean;
}) {
  return (
    <>
      <PageHeader
        eyebrow="Overview"
        title="대시보드"
        description="나의 거래 기록과 가드레일 인사이트를 한눈에 확인하세요."
        showDate
      />

      <div className={styles.dashboardGrid}>
        <div className={styles.dashboardMainColumn}>
          <section className={styles.welcomeCard}>
            <div className={styles.welcomeCopy}>
              <p>오늘도 불씨와 함께</p>
              <h2>
                내가 세운 투자 원칙,
                <br />
                주문 순간까지 이어가 볼까요?
              </h2>
              <span>주문 기록과 가드레일 인사이트를 한곳에서 확인해요.</span>
            </div>
            <div className={styles.welcomeVisual} aria-hidden="true">
              <span className={styles.welcomeGlow} />
              <FlameMascot
                className={styles.welcomeFlame}
                label=""
                mode="default"
                size="clamp(104px, 12vw, 156px)"
                speed="slow"
              />
            </div>
          </section>

          <section
            className={`${styles.panel} ${styles.insightPanel}`}
            aria-labelledby="insight-panel-title"
          >
            <header className={styles.panelHeader}>
              <div className={styles.panelTitleGroup}>
                <span className={styles.panelIcon}>
                  <SparklesIcon />
                </span>
                <h2 className={styles.panelTitle} id="insight-panel-title">
                  {insight.status.periodState === "CLOSED"
                    ? "지난주 AI 인사이트"
                    : "이번 주 AI 인사이트"}
                </h2>
              </div>
              <span className={styles.panelMeta}>
                {insight.report
                  ? `${insight.report.sourceCounts.activeDays}일 활동`
                  : `피드백 ${insight.status.answeredFeedbackCount}/${insight.status.requiredFeedbackCount}`}
              </span>
            </header>
            <InsightPreview
              report={insight.report}
              status={insight.status}
            />
          </section>
        </div>

        <section
          className={`${styles.panel} ${styles.recordsPanel}`}
          aria-labelledby="records-panel-title"
        >
          <header className={styles.panelHeader}>
            <div className={styles.panelTitleGroup}>
              <span className={styles.panelIcon}>
                <NoteIcon />
              </span>
              <h2 className={styles.panelTitle} id="records-panel-title">
                최근 가드레일 기록
              </h2>
            </div>
            <Link className={styles.panelLink} href="/history">
              전체 보기
            </Link>
          </header>
          <GuardrailTimeline
            compact
            initialData={isTimelineUnavailable ? null : timeline}
            limit={5}
          />
        </section>
      </div>
    </>
  );
}
