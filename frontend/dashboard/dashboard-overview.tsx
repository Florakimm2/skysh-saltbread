import PageHeader from "./page-header";
import {
  EmptyBoxIcon,
  NoteIcon,
  SparklesIcon,
} from "./icons";
import styles from "./dashboard.module.css";

export default function DashboardOverview() {
  return (
    <>
      <PageHeader
        eyebrow="Overview"
        title="대시보드"
        description="나의 투자 기록과 AI 분석을 한눈에 확인하세요."
        showDate
      />

      <div className={styles.dashboardGrid}>
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
            <span className={styles.panelMeta}>최근 분석</span>
          </header>
          <div className={styles.emptyState}>
            <div className={styles.emptyStateInner}>
              <span className={styles.emptyGlyph}>
                <SparklesIcon />
              </span>
              <strong>표시할 인사이트가 아직 없습니다</strong>
              <p>AI가 분석한 투자 인사이트가 이곳에 표시됩니다.</p>
            </div>
          </div>
        </section>

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
                나의 기록
              </h2>
            </div>
            <span className={styles.panelMeta}>최근 기록</span>
          </header>
          <div className={styles.emptyState}>
            <div className={styles.emptyStateInner}>
              <span className={styles.emptyGlyph}>
                <EmptyBoxIcon />
              </span>
              <strong>기록이 아직 없습니다</strong>
              <p>수집된 투자 기록이 이곳에 차곡차곡 쌓입니다.</p>
            </div>
          </div>
        </section>
      </div>
    </>
  );
}
