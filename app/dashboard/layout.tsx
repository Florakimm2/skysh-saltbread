import type { Metadata } from "next";
import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { getDashboardSession } from "@/backend/modules/auth/session";
import DashboardShell from "@/frontend/dashboard/dashboard-shell";

export const metadata: Metadata = {
  title: "대시보드 | 불씨",
  description: "거래 기록과 가드레일 인사이트를 확인하는 불씨 대시보드",
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
