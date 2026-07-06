import type { BehaviorSessionRecord } from "@/backend/modules/behavior/types";
import PageHeader from "./page-header";
import { EmptyBoxIcon, TrendIcon } from "./icons";
import TrendRecordList from "./trend-record-list";
import styles from "./dashboard.module.css";

export default function PastTrendsPage({
  trends,
  isDataUnavailable = false,
}: {
  trends: BehaviorSessionRecord[];
  isDataUnavailable?: boolean;
}) {
  return (
    <>
      <PageHeader
        eyebrow="History"
        title="행동 기록"
        description="Extension에서 수집한 주문 행동을 세션별로 확인하세요."
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
              전체 행동 기록
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
              <strong>
                {isDataUnavailable
                  ? "행동 기록을 불러오지 못했습니다"
                  : "아직 쌓인 행동 기록이 없습니다"}
              </strong>
              <p>
                {isDataUnavailable
                  ? "데이터 사용량이 복구된 뒤 다시 확인해 주세요."
                  : "주문 화면에서 행동이 수집되면 여기에 표시됩니다."}
              </p>
            </div>
          </div>
        )}
      </section>
    </>
  );
}
