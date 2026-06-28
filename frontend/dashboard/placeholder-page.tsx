import type { ReactNode } from "react";
import PageHeader from "./page-header";
import styles from "./dashboard.module.css";

interface PlaceholderPageProps {
  eyebrow: string;
  title: string;
  description: string;
  panelTitle: string;
  emptyTitle: string;
  emptyDescription: string;
  icon: ReactNode;
}

export default function PlaceholderPage({
  eyebrow,
  title,
  description,
  panelTitle,
  emptyTitle,
  emptyDescription,
  icon,
}: PlaceholderPageProps) {
  return (
    <>
      <PageHeader
        eyebrow={eyebrow}
        title={title}
        description={description}
      />

      <section
        className={`${styles.panel} ${styles.placeholderPanel}`}
        aria-labelledby="placeholder-panel-title"
      >
        <header className={styles.panelHeader}>
          <div className={styles.panelTitleGroup}>
            <h2 className={styles.panelTitle} id="placeholder-panel-title">
              {panelTitle}
            </h2>
          </div>
        </header>
        <div className={styles.placeholderBody}>
          <div className={styles.emptyStateInner}>
            <span className={styles.emptyGlyph}>{icon}</span>
            <h2>{emptyTitle}</h2>
            <p>{emptyDescription}</p>
          </div>
        </div>
      </section>
    </>
  );
}
