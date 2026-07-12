import { getDashboardSession } from "@/backend/modules/auth/session";
import {
  getDailyInsightStatus,
  listDailyInsights,
} from "@/backend/modules/insight/daily-service";
import AiInsightsPage from "@/frontend/dashboard/ai-insights-page";

export const dynamic = 'force-dynamic';

export default async function AiInsightRoutePage() {
  const session = await getDashboardSession();

  if (!session) {
    return null;
  }

  const [reports, todayStatus] = await Promise.all([
    listDailyInsights({ userId: session.userId, limit: 20 }),
    getDailyInsightStatus({ userId: session.userId }),
  ]);

  return <AiInsightsPage reports={reports} todayStatus={todayStatus} />;
}
