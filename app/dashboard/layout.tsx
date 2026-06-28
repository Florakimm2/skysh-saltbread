import type { Metadata } from "next";
import type { ReactNode } from "react";
import { getDashboardSession } from "@/backend/modules/auth/session";
import AuthPanel from "@/frontend/auth/auth-panel";
import DashboardShell from "@/frontend/dashboard/dashboard-shell";

export const metadata: Metadata = {
  title: "대시보드 | Fireguard",
  description: "투자 기록과 AI 분석을 확인하는 Fireguard 대시보드",
};

export default async function DashboardLayout({
  children,
}: {
  children: ReactNode;
}) {
  if (!(await getDashboardSession())) {
    return <AuthPanel />;
  }

  return <DashboardShell>{children}</DashboardShell>;
}
