"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import FlameIcon from "./flame-icon";
import { SparklesIcon, TrendIcon } from "./icons";
import styles from "./dashboard.module.css";

const navigation = [
  {
    href: "/dashboard/trends",
    label: "과거 경향",
    icon: TrendIcon,
  },
  {
    href: "/dashboard/ai-insights",
    label: "AI 인사이트",
    icon: SparklesIcon,
  },
];

export default function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className={styles.sidebar}>
      <Link className={styles.brand} href="/dashboard" aria-label="대시보드 홈">
        <span className={styles.brandMark}>
          <FlameIcon />
        </span>
        <span className={styles.brandText}>
          <strong>Fireguard</strong>
          <span>details</span>
        </span>
      </Link>

      <p className={styles.navLabel}>ANALYTICS</p>
      <nav className={styles.nav} aria-label="대시보드 메뉴">
        {navigation.map(({ href, label, icon: Icon }) => {
          const isActive = pathname === href;

          return (
            <Link
              key={href}
              className={`${styles.navLink} ${
                isActive ? styles.navLinkActive : ""
              }`}
              href={href}
              aria-current={isActive ? "page" : undefined}
            >
              <span className={styles.navIcon}>
                <Icon />
              </span>
              <span>{label}</span>
            </Link>
          );
        })}
      </nav>

      <div className={styles.sidebarFooter}>
        <p>더 나은 투자 판단을 위한<br />개인 트레이딩 대시보드</p>
      </div>
    </aside>
  );
}
