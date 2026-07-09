import { getDashboardSession } from "@/backend/modules/auth/session";
import { getBehaviorSessionRecords } from "@/backend/modules/behavior/service";
import { requestDashboardInsight } from "@/backend/modules/insight/service";
import AiInsightsPage from "@/frontend/dashboard/ai-insights-page";

// 유저가 페이지를 열 때마다 매번 새로 FastAPI를 호출하도록 설정
export const dynamic = 'force-dynamic';

export default async function AiInsightRoutePage() {
  const session = await getDashboardSession();

  if (!session) {
    return null;
  }

  const trends = await getBehaviorSessionRecords(session.userId);
  const insight = await requestDashboardInsight(session.userId, trends);

  return <AiInsightsPage insight={insight} />;
}
