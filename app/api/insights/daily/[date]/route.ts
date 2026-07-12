import { NextRequest } from "next/server";
import { ApiError, errorResponse, ok } from "@/backend/common/api";
import { getRequiredUserId } from "@/backend/common/auth";
import { getDailyInsightByDate } from "@/backend/modules/insight/daily-service";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{
    date: string;
  }>;
};

export async function GET(req: NextRequest, context: RouteContext) {
  try {
    const userId = await getRequiredUserId(req);
    const { date } = await context.params;

    if (!/^\d{4}-\d{2}-\d{2}(?:-\d{8,20})?$/.test(date)) {
      throw new ApiError(
        400,
        "INVALID_REPORT_DATE",
        "리포트 날짜 형식이 올바르지 않습니다.",
      );
    }

    const report = await getDailyInsightByDate({ userId, date });
    if (!report) {
      throw new ApiError(
        404,
        "DAILY_INSIGHT_NOT_FOUND",
        "해당 날짜의 AI 인사이트 리포트를 찾을 수 없습니다.",
      );
    }

    return ok(report);
  } catch (error) {
    return errorResponse(error);
  }
}
