import { NextRequest } from "next/server";
import { errorResponse, ok } from "@/backend/common/api";
import { getRequiredUserId } from "@/backend/common/auth";
import { dismissInsightSuggestion } from "@/backend/modules/insight/daily-service";

export const runtime = "nodejs";

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ suggestionId: string }> },
) {
  try {
    const userId = await getRequiredUserId(req);
    const { suggestionId } = await context.params;
    const result = await dismissInsightSuggestion({ userId, suggestionId });
    return ok(result);
  } catch (error) {
    return errorResponse(error);
  }
}
