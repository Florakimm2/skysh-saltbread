import type { PastTrendRecord } from "@/backend/modules/behavior/types";
import PageHeader from "./page-header";
import { EmptyBoxIcon, TrendIcon } from "./icons";
import TrendRecordList from "./trend-record-list";
import styles from "./dashboard.module.css";

export default function PastTrendsPage({
  trends,
}: {
  trends: PastTrendRecord[];
}) {
  return (
    <>
      <PageHeader
        eyebrow="History"
        title="과거 경향"
        description="감지된 패턴과 당시 쌓인 행동 데이터를 시간순으로 확인하세요."
      />

      <section
        className={`${styles.panel} ${styles.historyPanel}`}
        aria-labelledby="history-panel-title"
      >
        <header className={styles.panelHeader}>
          <div className={styles.panelTitleGroup}>
            <span className={styles.panelIcon}>
              <TrendIcon />
            </span>
            <h2 className={styles.panelTitle} id="history-panel-title">
              전체 경향 기록
            </h2>
          </div>
          <span className={styles.panelMeta}>총 {trends.length}건</span>
        </header>

        {trends.length > 0 ? (
          <TrendRecordList records={trends} scrollable />
        ) : (
          <div className={styles.historyEmpty}>
            <div className={styles.emptyStateInner}>
              <span className={styles.emptyGlyph}>
                <EmptyBoxIcon />
              </span>
              <strong>아직 쌓인 경향 기록이 없습니다</strong>
              <p>패턴이 분석되면 감지 시점과 행동 데이터가 표시됩니다.</p>
            </div>
          </div>
        )}
      </section>
    </>
  );
}
