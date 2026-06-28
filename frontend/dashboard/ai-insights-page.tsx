import type { DashboardInsightResult } from "@/backend/modules/insight/types";
import PageHeader from "./page-header";
import { SparklesIcon } from "./icons";
import styles from "./dashboard.module.css";

export default function AiInsightsPage({
  insight,
}: {
  insight: DashboardInsightResult;
}) {
  return (
    <>
      <PageHeader
        eyebrow="Intelligence"
        title="AI 인사이트"
        description="최근 7일의 경향 기록을 바탕으로 발견한 투자 습관입니다."
      />

      <section
        className={`${styles.panel} ${styles.aiDetailPanel}`}
        aria-labelledby="ai-detail-title"
      >
        <header className={styles.panelHeader}>
          <div className={styles.panelTitleGroup}>
            <span className={styles.panelIcon}>
              <SparklesIcon />
            </span>
            <h2 className={styles.panelTitle} id="ai-detail-title">
              최근 7일 AI 분석
            </h2>
          </div>
          <span className={styles.panelMeta}>
            {insight.sourceCount}건의 경향 반영
          </span>
        </header>

        {insight.status === "ready" ? (
          <article className={styles.aiInsightBody}>
            <span className={styles.aiInsightMark}>
              <SparklesIcon />
            </span>
            <div>
              {insight.insight.split(/\n+/).map((paragraph, index) => (
                <p key={`${index}-${paragraph.slice(0, 16)}`}>{paragraph}</p>
              ))}
            </div>
          </article>
        ) : (
          <div className={styles.aiDetailEmpty}>
            <div className={styles.emptyStateInner}>
              <span className={styles.emptyGlyph}>
                <SparklesIcon />
              </span>
              <strong>
                {insight.status === "empty"
                  ? "최근 7일간 분석할 기록이 없습니다"
                  : "AI 분석을 불러오지 못했습니다"}
              </strong>
              <p>
                {insight.status === "empty"
                  ? "새로운 경향 기록이 쌓이면 맞춤형 인사이트를 생성합니다."
                  : "잠시 후 페이지를 새로고침해 다시 확인해 주세요."}
              </p>
            </div>
          </div>
        )}
      </section>
    </>
  );
}
