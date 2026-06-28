import { getDashboardSession } from "@/backend/modules/auth/session";
import { getPastTrendRecords } from "@/backend/modules/behavior/service";
import { requestDashboardInsight } from "@/backend/modules/insight/service";
import DashboardOverview from "@/frontend/dashboard/dashboard-overview";

export default async function DashboardPage() {
  const session = await getDashboardSession();

  if (!session) {
    return null;
  }

  const trends = await getPastTrendRecords(session.userId);
  const insight = await requestDashboardInsight(trends);

  return (
    <DashboardOverview
      insight={insight}
      trends={trends.slice(0, 5)}
    />
  );
}
