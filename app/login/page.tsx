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
  searchParams: Promise<{
    extensionId?: string | string[];
    next?: string | string[];
  }>;
}) {
  const params = await searchParams;
  const extensionId =
    typeof params.extensionId === "string" &&
    /^[a-p]{32}$/.test(params.extensionId)
      ? params.extensionId
      : undefined;
  const nextPath = typeof params.next === "string" ? params.next : undefined;

  if (await getDashboardSession()) {
    if (extensionId) {
      const connectParams = new URLSearchParams({
        extensionId,
        next: nextPath ?? "/dashboard",
      });
      redirect(`/extension/connect?${connectParams.toString()}`);
    }

    redirect("/dashboard");
  }

  return <LoginPage extensionId={extensionId} nextPath={nextPath} />;
}
