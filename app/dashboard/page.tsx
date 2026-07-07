import { getDashboardSession } from "@/backend/modules/auth/session";
import { requestDashboardInsight } from "@/backend/modules/insight/service";
import DashboardOverview from "@/frontend/dashboard/dashboard-overview";
import { loadDashboardBehaviorData } from "./load-dashboard-data";

export default async function DashboardPage() {
  const session = await getDashboardSession();

  if (!session) {
    return null;
  }

  const behaviorData = await loadDashboardBehaviorData(session.userId);
  const insight =
    behaviorData.status === "ready"
      ? await requestDashboardInsight(behaviorData.records)
      : { status: "error" as const, sourceCount: 0 };

  return (
    <DashboardOverview
      insight={insight}
      trends={behaviorData.records.slice(0, 5)}
      isDataUnavailable={behaviorData.status === "unavailable"}
    />
  );
}
