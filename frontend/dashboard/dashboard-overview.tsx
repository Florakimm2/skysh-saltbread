import Link from "next/link";
import type {
  DailyInsightEligibility,
  DailyInsightReport,
} from "@/backend/modules/insight/daily-types";
import type { GuardrailTimelineResponse } from "@/backend/modules/logs/types";
import FlameMascot from "@/frontend/auth/flame-mascot";
import { buildLatestInsightCardViewModel } from "./latest-insight-card-view-model";
import PageHeader from "./page-header";
import {
  NoteIcon,
  SparklesIcon,
} from "./icons";
import GuardrailTimeline from "./guardrail-history/GuardrailTimeline";
import styles from "./dashboard.module.css";

function InsightPreview({
  report,
  todayStatus,
}: {
  report: DailyInsightReport | null;
  todayStatus: DailyInsightEligibility;
}) {
  if (!report) {
    return (
      <article className={styles.insightPreview}>
        <div className={styles.insightPreviewContent}>
          <section className={styles.insightSummaryBlock}>
            <h3>
              오늘의 기록으로 AI 인사이트를 만들 수 있어요
            </h3>
            <p>
              생성하기 버튼을 누르면 현재 저장된 주문 시도, 가드레일, 피드백 {todayStatus.answeredFeedbackCount}건으로 새 리포트를 만들어요.
            </p>
          </section>
        </div>
        <Link
          className={styles.insightDetailLink}
          href="/dashboard/ai-insights?focus=today"
        >
          AI 인사이트에서 생성하기 →
        </Link>
      </article>
    );
  }

  const viewModel = buildLatestInsightCardViewModel(report);

  return (
    <article className={styles.insightPreview}>
      <div className={styles.insightPreviewTop}>
        <div>
          <span className={styles.insightEyebrow}>최근 AI 인사이트</span>
          <time dateTime={report.date}>{viewModel.dateLabel}</time>
        </div>
        {viewModel.flameLabel ? (
          <span className={styles.insightStatusBadge}>{viewModel.flameLabel}</span>
        ) : null}
      </div>

      <div className={styles.insightPreviewBody}>
        <div className={styles.insightMascot} aria-hidden="true">
          <FlameMascot
            label=""
            mode={viewModel.flameMode}
            size="clamp(70px, 8vw, 96px)"
            speed="slow"
          />
        </div>

        <div className={styles.insightPreviewContent}>
          <section className={styles.insightSummaryBlock}>
            <h3>오늘 기록에서 발견한 패턴</h3>
            <p>{viewModel.summary}</p>
          </section>

          {viewModel.oneLineAdvice ? (
            <section className={styles.insightAdviceBox}>
              <span>다음 주문에서 확인할 것</span>
              <p>{viewModel.oneLineAdvice}</p>
            </section>
          ) : null}

          <div className={styles.insightHighlightGrid}>
            {viewModel.primaryCard ? (
              <section className={styles.insightMiniCard}>
                <span>{viewModel.primaryCard.severityLabel}</span>
                <strong>{viewModel.primaryCard.label}</strong>
                <p>{viewModel.primaryCard.description}</p>
              </section>
            ) : null}

            {viewModel.primaryMetric ? (
              <section className={styles.insightMiniCard}>
                <span>{viewModel.primaryMetric.label}</span>
                <strong>{viewModel.primaryMetric.value}</strong>
                {viewModel.primaryMetric.description ? (
                  <p>{viewModel.primaryMetric.description}</p>
                ) : null}
              </section>
            ) : null}
          </div>
        </div>
      </div>

      <Link className={styles.insightDetailLink} href={`/dashboard/ai-insights?report=${report.date}`}>
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
    report: DailyInsightReport | null;
    todayStatus: DailyInsightEligibility;
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
                  AI 인사이트
                </h2>
              </div>
              <span className={styles.panelMeta}>
                {insight.report
                  ? buildLatestInsightCardViewModel(insight.report).shortDateLabel
                  : "오늘 기록"}
              </span>
            </header>
            <InsightPreview
              report={insight.report}
              todayStatus={insight.todayStatus}
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
