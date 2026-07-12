import { NextRequest } from "next/server";
import { ApiError, errorResponse, ok } from "@/backend/common/api";
import { getRequiredUserId } from "@/backend/common/auth";
import { acceptInsightSuggestion } from "@/backend/modules/insight/daily-service";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{
    date: string;
    suggestionId: string;
  }>;
};

export async function POST(req: NextRequest, context: RouteContext) {
  try {
    const userId = await getRequiredUserId(req);
    const { date, suggestionId } = await context.params;
    if (!/^\d{4}-\d{2}-\d{2}(?:-\d{8,20})?$/.test(date)) {
      throw new ApiError(
        400,
        "INVALID_REPORT_DATE",
        "리포트 날짜 형식이 올바르지 않습니다.",
      );
    }
    const result = await acceptInsightSuggestion({ userId, date, suggestionId });
    return ok(result);
  } catch (error) {
    return errorResponse(error);
  }
}
