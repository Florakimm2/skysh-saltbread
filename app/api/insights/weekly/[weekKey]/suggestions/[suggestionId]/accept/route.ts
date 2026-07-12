import { NextRequest } from "next/server";
import { ApiError, errorResponse, ok } from "@/backend/common/api";
import { getRequiredUserId } from "@/backend/common/auth";
import { acceptWeeklyInsightSuggestion } from "@/backend/modules/insight/weekly-service";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ weekKey: string; suggestionId: string }>;
};

export async function POST(req: NextRequest, context: RouteContext) {
  try {
    const userId = await getRequiredUserId(req);
    const { weekKey, suggestionId } = await context.params;
    if (!/^\d{4}-W\d{2}$/.test(weekKey)) {
      throw new ApiError(400, "INVALID_WEEK_KEY", "주차 형식이 올바르지 않습니다.");
    }
    const result = await acceptWeeklyInsightSuggestion({ userId, weekKey, suggestionId });
    return ok(result);
  } catch (error) {
    return errorResponse(error);
  }
}
