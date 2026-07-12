import { NextRequest } from "next/server";
import { errorResponse, ok } from "@/backend/common/api";
import { getRequiredUserId } from "@/backend/common/auth";
import { getLatestWeeklyInsightBundle } from "@/backend/modules/insight/weekly-service";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  try {
    const userId = await getRequiredUserId(req);
    const result = await getLatestWeeklyInsightBundle({ userId });
    return ok(result);
  } catch (error) {
    return errorResponse(error);
  }
}
