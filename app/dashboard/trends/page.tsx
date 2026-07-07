import { getDashboardSession } from "@/backend/modules/auth/session";
import PastTrendsPage from "@/frontend/dashboard/past-trends-page";
import { loadDashboardBehaviorData } from "../load-dashboard-data";

export default async function TrendsPage() {
  const session = await getDashboardSession();

  if (!session) {
    return null;
  }

  const behaviorData = await loadDashboardBehaviorData(session.userId);

  return (
    <PastTrendsPage
      trends={behaviorData.records}
      isDataUnavailable={behaviorData.status === "unavailable"}
    />
  );
}
