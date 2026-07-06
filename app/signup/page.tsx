import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getDashboardSession } from "@/backend/modules/auth/session";
import SignupPage from "@/frontend/auth/signup-page";

export const metadata: Metadata = {
  title: "회원가입 | 불씨",
  description: "불씨 계정을 만들고 나만의 투자 가드레일을 설정하세요.",
};

export default async function SignupRoute() {
  if (await getDashboardSession()) {
    redirect("/dashboard");
  }

  return <SignupPage />;
}
