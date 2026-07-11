import { EmptyBoxIcon } from "../icons";
import styles from "../dashboard.module.css";

export default function TimelineEmptyState({
  isError = false,
  message,
}: {
  isError?: boolean;
  message?: string;
}) {
  return (
    <div className={styles.guardrailTimelineEmpty}>
      <div className={styles.emptyStateInner}>
        <span className={styles.emptyGlyph}>
          <EmptyBoxIcon />
        </span>
        <strong>
          {isError
            ? "가드레일 기록을 불러오지 못했습니다"
            : "아직 기록된 경고나 피드백이 없어요."}
        </strong>
        <p>
          {message ??
            (isError
              ? "잠시 후 다시 시도해 주세요."
              : "거래 중 가드레일이 작동하거나 피드백을 남기면 이곳에 표시됩니다.")}
        </p>
      </div>
    </div>
  );
}
