import styles from "../dashboard.module.css";

export default function TimelineSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className={styles.timelineList} aria-label="가드레일 기록 불러오는 중">
      {Array.from({ length: rows }).map((_, index) => (
        <div className={styles.timelineSkeletonRow} key={index}>
          <span />
          <div>
            <i />
            <b />
            <em />
          </div>
        </div>
      ))}
    </div>
  );
}
