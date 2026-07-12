import { NextRequest } from "next/server";
import { errorResponse, ok } from "@/backend/common/api";
import { getRequiredUserId } from "@/backend/common/auth";
import { getLatestDailyInsight } from "@/backend/modules/insight/daily-service";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  try {
    const userId = await getRequiredUserId(req);
    const result = await getLatestDailyInsight({ userId });
    return ok(result);
  } catch (error) {
    return errorResponse(error);
  }
}
