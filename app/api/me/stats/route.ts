// app/api/me/stats/route.ts

import { NextRequest } from "next/server";
import { getRequiredUserId } from "@/backend/common/auth";
import { errorResponse, ok } from "@/backend/common/api";
import { getUserStatsMessage } from "@/backend/modules/stats/service";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  try {
    const userId = await getRequiredUserId(req);
    const message = await getUserStatsMessage(userId);

    return ok(message);
  } catch (error) {
    return errorResponse(error);
  }
}