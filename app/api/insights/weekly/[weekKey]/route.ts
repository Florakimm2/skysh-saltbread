import { NextRequest } from "next/server";
import { ApiError, errorResponse, ok } from "@/backend/common/api";
import { getRequiredUserId } from "@/backend/common/auth";
import { getWeeklyInsightByWeekKey } from "@/backend/modules/insight/weekly-service";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ weekKey: string }>;
};

export async function GET(req: NextRequest, context: RouteContext) {
  try {
    const userId = await getRequiredUserId(req);
    const { weekKey } = await context.params;
    if (!/^\d{4}-W\d{2}$/.test(weekKey)) {
      throw new ApiError(400, "INVALID_WEEK_KEY", "주차 형식이 올바르지 않습니다.");
    }
    const report = await getWeeklyInsightByWeekKey({ userId, weekKey });
    if (!report) {
      throw new ApiError(404, "WEEKLY_INSIGHT_NOT_FOUND", "주간 리포트를 찾을 수 없습니다.");
    }
    return ok(report);
  } catch (error) {
    return errorResponse(error);
  }
}
