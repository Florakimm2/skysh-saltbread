import styles from "../dashboard.module.css";

export default function TimelineTypeBadge({
  type,
  className = "",
}: {
  type: "WARNING" | "FEEDBACK";
  className?: string;
}) {
  return (
    <span
      className={`${styles.timelineBadge} ${
        type === "WARNING" ? styles.timelineBadgeWarning : styles.timelineBadgeFeedback
      } ${className}`}
    >
      {type === "WARNING" ? "경고 발생" : "거래 피드백"}
    </span>
  );
}
