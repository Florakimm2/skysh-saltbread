import { getDashboardSession } from "@/backend/modules/auth/session";
import { getBehaviorSessionRecords } from "@/backend/modules/behavior/service";
import { requestDashboardInsight } from "@/backend/modules/insight/service";
import DashboardOverview from "@/frontend/dashboard/dashboard-overview";

// 유저가 페이지를 열 때마다 매번 새로 FastAPI를 호출하도록 설정
export const dynamic = 'force-dynamic';

export default async function DashboardPage() {
  const session = await getDashboardSession();

  if (!session) {
    return null;
  }

  // 최신 행동 로그 데이터를 DB에서 조회
  const trends = await getBehaviorSessionRecords(session.userId);
  // 상세 페이지와 동일하게 최신 전체 trends 배열을 AI 분석 함수에 전달
  const insight = await requestDashboardInsight(session.userId, trends);

  return (
    <DashboardOverview
      insight={insight}
      trends={trends.slice(0, 5)}
    />
  );
}
