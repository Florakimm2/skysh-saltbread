import { getDashboardSession } from "@/backend/modules/auth/session";
import {
  getWeeklyInsightStatus,
  listWeeklyInsights,
} from "@/backend/modules/insight/weekly-service";
import AiInsightsPage from "@/frontend/dashboard/ai-insights-page";

export const dynamic = 'force-dynamic';

export default async function AiInsightRoutePage() {
  const session = await getDashboardSession();

  if (!session) {
    return null;
  }

  const [reports, weeklyStatus] = await Promise.all([
    listWeeklyInsights({ userId: session.userId, limit: 20 }),
    getWeeklyInsightStatus({ userId: session.userId }),
  ]);

  return <AiInsightsPage reports={reports} weeklyStatus={weeklyStatus} />;
}
