import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getDashboardSession } from "@/backend/modules/auth/session";
import LoginPage from "@/frontend/auth/login-page";

export const metadata: Metadata = {
  title: "로그인 | 불씨",
  description: "불씨 계정에 로그인하고 투자 대시보드를 확인하세요.",
};

export default async function LoginRoute({
  searchParams,
}: {
  searchParams: Promise<{ next?: string | string[] }>;
}) {
  if (await getDashboardSession()) {
    redirect("/dashboard");
  }

  const params = await searchParams;
  const nextPath = typeof params.next === "string" ? params.next : undefined;

  return <LoginPage nextPath={nextPath} />;
}
