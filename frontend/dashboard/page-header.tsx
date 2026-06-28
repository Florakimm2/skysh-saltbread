import { CalendarIcon } from "./icons";
import styles from "./dashboard.module.css";

interface PageHeaderProps {
  eyebrow: string;
  title: string;
  description: string;
  showDate?: boolean;
}

const formattedDate = new Intl.DateTimeFormat("ko-KR", {
  month: "long",
  day: "numeric",
  weekday: "short",
}).format(new Date());

export default function PageHeader({
  eyebrow,
  title,
  description,
  showDate = false,
}: PageHeaderProps) {
  return (
    <header className={styles.pageHeader}>
      <div>
        <p className={styles.eyebrow}>{eyebrow}</p>
        <h1 className={styles.pageTitle}>{title}</h1>
        <p className={styles.pageDescription}>{description}</p>
      </div>

      {showDate ? (
        <div className={styles.dateBadge}>
          <CalendarIcon />
          <span>{formattedDate}</span>
        </div>
      ) : null}
    </header>
  );
}
