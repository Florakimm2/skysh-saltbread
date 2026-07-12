import { getDashboardSession } from "@/backend/modules/auth/session";
import { getLatestDailyInsight } from "@/backend/modules/insight/daily-service";
import DashboardOverview from "@/frontend/dashboard/dashboard-overview";
import {
  loadDashboardTimelineData,
} from "./load-dashboard-data";

export const dynamic = 'force-dynamic';

export default async function DashboardPage() {
  const session = await getDashboardSession();

  if (!session) {
    return null;
  }

  const timelineData = await loadDashboardTimelineData(session.userId, 5);
  const insight = await getLatestDailyInsight({ userId: session.userId });

  return (
    <DashboardOverview
      insight={insight}
      timeline={timelineData.timeline}
      isTimelineUnavailable={timelineData.status === "unavailable"}
    />
  );
}
