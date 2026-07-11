import { getDashboardSession } from "@/backend/modules/auth/session";
import PastTrendsPage from "@/frontend/dashboard/past-trends-page";
import { loadDashboardTimelineData } from "../load-dashboard-data";

export default async function TrendsPage() {
  const session = await getDashboardSession();

  if (!session) {
    return null;
  }

  const timelineData = await loadDashboardTimelineData(session.userId, 20);

  return (
    <PastTrendsPage
      timeline={timelineData.timeline}
      isDataUnavailable={timelineData.status === "unavailable"}
    />
  );
}
