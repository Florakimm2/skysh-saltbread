import type { GuardrailTimelineItem } from "@/backend/modules/logs/types";
import {
  formatCompactDateTime,
  formatFeedbackDuration,
  formatOrderSummary,
} from "./formatters";
import FeedbackStatusIcon, { getFeedbackPresentation } from "./FeedbackStatusIcon";
import TimelineTypeBadge from "./TimelineTypeBadge";
import styles from "../dashboard.module.css";

type FeedbackItem = Extract<GuardrailTimelineItem, { type: "FEEDBACK" }>;

export default function FeedbackTimelineRow({ item }: { item: FeedbackItem }) {
  const presentation = getFeedbackPresentation(item.feedback);
  const duration = formatFeedbackDuration({
    feedbackShownAt: item.feedback.feedbackShownAt,
    respondedAt: item.feedback.respondedAt,
  });

  return (
    <article
      className={`${styles.timelineRow} ${styles.feedbackTimelineRow} ${
        styles[`feedbackTimelineRow${presentation.tone}`]
      }`}
    >
      <div className={styles.timelineVisual}>
        <FeedbackStatusIcon tone={presentation.tone} />
      </div>
      <div className={styles.timelineContent}>
        <div className={styles.timelineTopLine}>
          <div className={styles.timelineTitleGroup}>
            <TimelineTypeBadge type="FEEDBACK" />
            <h3>{presentation.label}</h3>
          </div>
          <time dateTime={item.occurredAt}>
            {formatCompactDateTime(item.occurredAt)}
          </time>
        </div>

        <p>{presentation.description}</p>

        <div className={styles.timelineBottomLine}>
          <div className={styles.timelineMetaGroup}>
            <span className={styles.timelineMeta}>
              {formatOrderSummary(item.relatedSnapshot ?? null)}
            </span>
            <span className={styles.feedbackTiming}>
              {duration ? `응답까지 ${duration}` : "응답 시간 정보 없음"}
            </span>
          </div>
        </div>
      </div>
    </article>
  );
}
