import { getDashboardSession } from "@/backend/modules/auth/session";
import { getPastTrendRecords } from "@/backend/modules/behavior/service";
import PastTrendsPage from "@/frontend/dashboard/past-trends-page";

export default async function TrendsPage() {
  const session = await getDashboardSession();

  if (!session) {
    return null;
  }

  const trends = await getPastTrendRecords(session.userId);

  return <PastTrendsPage trends={trends} />;
}
