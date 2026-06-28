import type { Metadata } from "next";
import type { ReactNode } from "react";
import { cookies } from "next/headers";
import { REFRESH_TOKEN_COOKIE_NAME } from "@/backend/common/cookies";
import { refresh } from "@/backend/modules/auth/service";
import AuthPanel from "@/frontend/auth/auth-panel";
import DashboardShell from "@/frontend/dashboard/dashboard-shell";

export const metadata: Metadata = {
  title: "대시보드 | Fireguard",
  description: "투자 기록과 AI 분석을 확인하는 Fireguard 대시보드",
};

async function hasValidSession() {
  const refreshToken = (await cookies()).get(
    REFRESH_TOKEN_COOKIE_NAME,
  )?.value;

  if (!refreshToken) {
    return false;
  }

  try {
    await refresh(refreshToken);
    return true;
  } catch {
    return false;
  }
}

export default async function DashboardLayout({
  children,
}: {
  children: ReactNode;
}) {
  if (!(await hasValidSession())) {
    return <AuthPanel />;
  }

  return <DashboardShell>{children}</DashboardShell>;
}
