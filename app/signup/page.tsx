import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getDashboardSession } from "@/backend/modules/auth/session";
import SignupPage from "@/frontend/auth/signup-page";

export const metadata: Metadata = {
  title: "회원가입 | 불씨",
  description: "불씨 계정을 만들고 나만의 투자 가드레일을 설정하세요.",
};

export default async function SignupRoute({
  searchParams,
}: {
  searchParams: Promise<{ extensionId?: string | string[] }>;
}) {
  const params = await searchParams;
  const extensionId =
    typeof params.extensionId === "string" &&
    /^[a-p]{32}$/.test(params.extensionId)
      ? params.extensionId
      : undefined;

  if (await getDashboardSession()) {
    if (extensionId) {
      const connectParams = new URLSearchParams({
        extensionId,
        next: "/dashboard",
      });
      redirect(`/extension/connect?${connectParams.toString()}`);
    }

    redirect("/dashboard");
  }

  return <SignupPage extensionId={extensionId} />;
}
