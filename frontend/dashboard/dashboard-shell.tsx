import type { ReactNode } from "react";
import Sidebar from "./sidebar";
import styles from "./dashboard.module.css";

export default function DashboardShell({ children }: { children: ReactNode }) {
  return (
    <div className={styles.dashboardShell}>
      <Sidebar />
      <main className={styles.main}>
        <div className={styles.content}>{children}</div>
      </main>
    </div>
  );
}
