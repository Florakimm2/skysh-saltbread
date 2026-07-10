import { getDashboardSession } from "@/backend/modules/auth/session";
import { requestDashboardInsight } from "@/backend/modules/insight/service";
import AiInsightsPage from "@/frontend/dashboard/ai-insights-page";
import { loadDashboardBehaviorData } from "../load-dashboard-data";

// 유저가 페이지를 열 때마다 매번 새로 FastAPI를 호출하도록 설정
export const dynamic = 'force-dynamic';

export default async function AiInsightRoutePage() {
  const session = await getDashboardSession();

  if (!session) {
    return null;
  }

  const behaviorData = await loadDashboardBehaviorData(session.userId);
  const insight =
    behaviorData.status === "ready"
      ? await requestDashboardInsight(session.userId, behaviorData.records)
      : { status: "error" as const, sourceCount: 0 };

  return <AiInsightsPage insight={insight} />;
}
