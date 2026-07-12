import { NextRequest } from "next/server";
import { errorResponse, ok } from "@/backend/common/api";
import { getRequiredUserId } from "@/backend/common/auth";
import { getDailyInsightStatus } from "@/backend/modules/insight/daily-service";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  try {
    const userId = await getRequiredUserId(req);
    const { searchParams } = new URL(req.url);
    const result = await getDailyInsightStatus({
      userId,
      date: searchParams.get("date"),
    });
    return ok(result);
  } catch (error) {
    return errorResponse(error);
  }
}
