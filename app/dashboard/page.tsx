// app/dashboard/page.tsx

import { getDashboardSession } from "@/backend/modules/auth/session";
import {
  requestDashboardInsight,
  requestFieldDashboardInsight,
} from "@/backend/modules/insight/service";
import DashboardOverview from "@/frontend/dashboard/dashboard-overview";
import FieldInsightsPage from "@/frontend/dashboard/field-insights-page";
import { loadDashboardBehaviorData } from "./load-dashboard-data";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const session = await getDashboardSession();

  if (!session) {
    return null;
  }

  // 1. 행동 데이터 로드 (한 번만)
  const behaviorData = await loadDashboardBehaviorData(session.userId);

  // 2. 같은 records로 인사이트 + 필드 분석 병렬 호출
  const [insight, fieldInsight] = await Promise.all([
    behaviorData.status === "ready"
      ? requestDashboardInsight(session.userId, behaviorData.records)
      : { status: "error" as const, sourceCount: 0 },
    behaviorData.status === "ready"
      ? requestFieldDashboardInsight(session.userId, behaviorData.records)
      : {
          status: "empty" as const,
          topics: [],
          aiAnalysis: null,
          snapshotCount: 0,
        },
  ]);

  return (
    <>
      <DashboardOverview
        insight={insight}
        trends={behaviorData.records.slice(0, 5)}
        isDataUnavailable={behaviorData.status === "unavailable"}
      />
      <div style={{ marginTop: "40px" }}>
        <FieldInsightsPage insight={fieldInsight} />
      </div>
    </>
  );
}
