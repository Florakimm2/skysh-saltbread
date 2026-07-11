// app/dashboard/ai-insights/page.tsx

import { getDashboardSession } from "@/backend/modules/auth/session";
import {
  requestDashboardInsight,
  requestFieldDashboardInsight,
  type FieldDashboardInsightResult,
} from "@/backend/modules/insight/service";
import AiInsightsPage from "@/frontend/dashboard/ai-insights-page";
import { loadDashboardBehaviorData } from "../load-dashboard-data";

export const dynamic = "force-dynamic";

export default async function AiInsightRoutePage() {
  const session = await getDashboardSession();

  if (!session) {
    return null;
  }

  const behaviorData = await loadDashboardBehaviorData(session.userId);

  const [insight, fieldInsight] = await Promise.all([
    behaviorData.status === "ready"
      ? requestDashboardInsight(session.userId, behaviorData.records)
      : { status: "error" as const, sourceCount: 0 },
    requestFieldDashboardInsight(session.userId),
  ]);

  return <AiInsightsPage insight={insight} fieldInsight={fieldInsight} />;
}
