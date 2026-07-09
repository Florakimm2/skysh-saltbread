import { getDashboardSession } from "@/backend/modules/auth/session";
import { requestDashboardInsight } from "@/backend/modules/insight/service";
import AiInsightsPage from "@/frontend/dashboard/ai-insights-page";
import { loadDashboardBehaviorData } from "../load-dashboard-data";

export default async function AiInsightRoutePage() {
  const session = await getDashboardSession();

  if (!session) {
    return null;
  }

  const behaviorData = await loadDashboardBehaviorData(session.userId);
  const insight =
    behaviorData.status === "ready"
      ? await requestDashboardInsight(behaviorData.records)
      : { status: "error" as const, sourceCount: 0 };

  return <AiInsightsPage insight={insight} />;
}
