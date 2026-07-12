import { NextRequest } from "next/server";
import { errorResponse, ok } from "@/backend/common/api";
import { getRequiredUserId } from "@/backend/common/auth";
import { dailyInsightGenerateSchema } from "@/backend/modules/insight/daily-schema";
import { generateDailyInsightReport } from "@/backend/modules/insight/daily-service";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const userId = await getRequiredUserId(req);
    const body = await req.json().catch(() => ({}));
    const parsed = dailyInsightGenerateSchema.parse(body);
    const result = await generateDailyInsightReport({
      userId,
      date: parsed.date,
    });
    return ok(result);
  } catch (error) {
    return errorResponse(error);
  }
}
