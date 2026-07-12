import { NextRequest } from "next/server";
import { errorResponse, ok } from "@/backend/common/api";
import { getRequiredUserId } from "@/backend/common/auth";
import { weeklyInsightGenerateSchema } from "@/backend/modules/insight/weekly-schema";
import { generateWeeklyInsightReport } from "@/backend/modules/insight/weekly-service";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const userId = await getRequiredUserId(req);
    const body = await req.json().catch(() => ({}));
    const parsed = weeklyInsightGenerateSchema.parse(body);
    const result = await generateWeeklyInsightReport({
      userId,
      weekKey: parsed.weekKey,
    });
    return ok(result);
  } catch (error) {
    return errorResponse(error);
  }
}
