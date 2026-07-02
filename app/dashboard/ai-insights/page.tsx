import { getDashboardSession } from "@/backend/modules/auth/session";
import { getBehaviorSessionRecords } from "@/backend/modules/behavior/service";
import { requestDashboardInsight } from "@/backend/modules/insight/service";
import AiInsightsPage from "@/frontend/dashboard/ai-insights-page";

export default async function AiInsightRoutePage() {
  const session = await getDashboardSession();

  if (!session) {
    return null;
  }

  const trends = await getBehaviorSessionRecords(session.userId);
  const insight = await requestDashboardInsight(trends);

  return <AiInsightsPage insight={insight} />;
}
