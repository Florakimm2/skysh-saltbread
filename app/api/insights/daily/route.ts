import { NextRequest } from "next/server";
import { errorResponse, ok } from "@/backend/common/api";
import { getRequiredUserId } from "@/backend/common/auth";
import { listDailyInsights } from "@/backend/modules/insight/daily-service";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  try {
    const userId = await getRequiredUserId(req);
    const { searchParams } = new URL(req.url);
    const limit = searchParams.get("limit");
    const result = await listDailyInsights({
      userId,
      limit: limit ? Number(limit) : undefined,
    });
    return ok(result);
  } catch (error) {
    return errorResponse(error);
  }
}
