import type { GuardrailTimelineResponse } from "@/backend/modules/logs/types";
import PageHeader from "./page-header";
import { TrendIcon } from "./icons";
import GuardrailTimeline from "./guardrail-history/GuardrailTimeline";
import styles from "./dashboard.module.css";

export default function PastTrendsPage({
  timeline,
  isDataUnavailable = false,
}: {
  timeline: GuardrailTimelineResponse | null;
  isDataUnavailable?: boolean;
}) {
  return (
    <>
      <PageHeader
        eyebrow="History"
        title="가드레일 기록"
        description="거래 중 발생한 경고와 거래 후 남긴 피드백을 시간순으로 확인하세요."
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
              전체 가드레일 기록
            </h2>
          </div>
          <span className={styles.panelMeta}>
            총 {timeline ? timeline.warningCount + timeline.feedbackCount : 0}건
          </span>
        </header>

        <div className={styles.historyTimelineBody}>
          <GuardrailTimeline
            enablePagination
            initialData={isDataUnavailable ? null : timeline}
            limit={20}
            showFilters
            showStats
          />
        </div>
      </section>
    </>
  );
}
