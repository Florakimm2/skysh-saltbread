"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import FlameMascot from "@/frontend/auth/flame-mascot";
import { SparklesIcon, TrendIcon, UserIcon } from "./icons";
import LogoutButton from "./logout-button";
import styles from "./dashboard.module.css";

const navigation = [
  {
    href: "/dashboard/trends",
    label: "행동 기록",
    icon: TrendIcon,
  },
  {
    href: "/dashboard/ai-insights",
    label: "AI 인사이트",
    icon: SparklesIcon,
  },
  {
    href: "/dashboard/my-page",
    label: "마이페이지",
    icon: UserIcon,
  },
];

export default function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className={styles.sidebar}>
      <Link className={styles.brand} href="/dashboard" aria-label="대시보드 홈">
        <span className={styles.brandMark}>
          <FlameMascot label="" size={48} speed="slow" />
        </span>
        <span className={styles.brandText}>
          <strong>불씨</strong>
          <span>CALM INVESTING</span>
        </span>
      </Link>

      <p className={styles.navLabel}>ANALYTICS</p>
      <nav className={styles.nav} aria-label="대시보드 메뉴">
        {navigation.map(({ href, label, icon: Icon }) => {
          const isActive = pathname === href || pathname.startsWith(`${href}/`);

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
        <p>
          더 차분한 투자 판단을 위한
          <br />
          나만의 트레이딩 가드레일
        </p>
        <LogoutButton />
      </div>
    </aside>
  );
}
