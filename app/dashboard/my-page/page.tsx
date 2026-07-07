import { getDashboardSession } from "@/backend/modules/auth/session";
import { getProfile } from "@/backend/modules/auth/service";
import { listGuardrailRules } from "@/backend/modules/guardrail/service";
import MyPage from "@/frontend/dashboard/my-page";

export default async function DashboardMyPageRoute() {
  const session = await getDashboardSession();

  if (!session) {
    return null;
  }

  const [profile, rules] = await Promise.all([
    getProfile(session.userId),
    listGuardrailRules({ userId: session.userId }),
  ]);

  return <MyPage initialProfile={profile} initialRules={rules} />;
}
