import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getDashboardSession } from "@/backend/modules/auth/session";
import OnboardingPage from "@/frontend/onboarding/onboarding-page";

export const metadata: Metadata = {
  title: "시작하기 | 불씨",
  description: "개인정보 동의와 개인 투자 규칙을 설정하세요.",
};

export default async function OnboardingRoute() {
  const session = await getDashboardSession();

  if (!session) {
    redirect("/login?next=/onboarding");
  }

  return <OnboardingPage userId={session.userId} />;
}
