import type { Metadata } from "next";
import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { getDashboardSession } from "@/backend/modules/auth/session";
import DashboardShell from "@/frontend/dashboard/dashboard-shell";

export const metadata: Metadata = {
  title: "대시보드 | 불씨",
  description: "투자 기록과 AI 분석을 확인하는 불씨 대시보드",
};

export default async function DashboardLayout({
  children,
}: {
  children: ReactNode;
}) {
  if (!(await getDashboardSession())) {
    redirect("/login?next=/dashboard");
  }

  return <DashboardShell>{children}</DashboardShell>;
}
