"use client";

import type { GuardrailTimelineItem } from "@/backend/modules/logs/types";
import { formatCompactDateTime, formatOrderSummary } from "./formatters";
import TimelineTypeBadge from "./TimelineTypeBadge";
import WarningFlame from "./WarningFlame";
import { getWarningToneClassName } from "./warning-colors";
import styles from "../dashboard.module.css";

type WarningItem = Extract<GuardrailTimelineItem, { type: "WARNING" }>;

const REACTION_LABELS = {
  PROCEED: "계속 주문하기",
  REVIEW: "주문 내용 다시 보기",
  CLOSE: "경고 닫기",
} as const;

const RISK_LABELS = {
  LOW: "낮음",
  MEDIUM: "보통",
  HIGH: "높음",
} as const;

function buildRuleTitle(item: WarningItem) {
  const title =
    item.rule?.name ||
    item.rule?.warningTitle ||
    "경고 규칙 정보를 찾을 수 없어요";
  const extraCount = Math.max(0, item.shownRules.length - 1);

  return extraCount > 0 ? `${title} 외 ${extraCount}개` : title;
}

export default function WarningTimelineRow({
  item,
  onOpen,
}: {
  item: WarningItem;
  onOpen: (item: WarningItem, button: HTMLButtonElement) => void;
}) {
  const title = buildRuleTitle(item);
  const description =
    item.rule?.warningTitle ||
    item.rule?.warningMessage ||
    item.rule?.description ||
    item.rule?.historyNotice ||
    "당시 표시된 경고 규칙의 설명을 찾을 수 없어요.";
  const toneClassName = getWarningToneClassName(item.rule?.visualMode, styles);

  return (
    <article
      className={`${styles.timelineRow} ${styles.warningTimelineRow} ${toneClassName}`}
    >
      <div className={styles.timelineVisual}>
        <WarningFlame
          visualMode={item.rule?.visualMode}
          label={`${title} 경고 불씨`}
          size="timeline"
        />
      </div>
      <div className={styles.timelineContent}>
        <div className={styles.timelineTopLine}>
          <div className={styles.timelineTitleGroup}>
            <TimelineTypeBadge type="WARNING" />
            <h3>{title}</h3>
          </div>
          <time dateTime={item.occurredAt}>
            {formatCompactDateTime(item.occurredAt)}
          </time>
        </div>

        <p>{description}</p>

        <div className={styles.timelineBottomLine}>
          <div className={styles.timelineMetaGroup}>
            <span className={styles.timelineMeta}>
              {formatOrderSummary(item.snapshot)}
            </span>
            {item.rule ? (
              <span className={styles.timelineReaction}>
                위험도 {RISK_LABELS[item.rule.riskLevel]}
              </span>
            ) : null}
            <span
              className={
                item.reaction
                  ? styles.timelineReaction
                  : styles.timelineReactionMuted
              }
            >
              {item.reaction
                ? `사용자 반응: ${REACTION_LABELS[item.reaction.action]}`
                : "명시적인 반응 없음"}
            </span>
          </div>
          <button
            className={styles.timelineDetailButton}
            type="button"
            aria-label={`${title} 자세히 보기`}
            onClick={(event) => onOpen(item, event.currentTarget)}
          >
            자세히 보기
          </button>
        </div>
      </div>
    </article>
  );
}
