// app/api/me/logs/confirmed-trade-logs/outcome/route.ts

import { NextRequest } from "next/server";
import { getRequiredUserId } from "@/backend/common/auth";
import { errorResponse, ok } from "@/backend/common/api";
import { orderOutcomePatchSchema } from "@/backend/modules/logs/schema";
import { patchConfirmedOutcome } from "@/backend/modules/logs/service";

export const runtime = "nodejs";

export async function PATCH(req: NextRequest) {
  try {
    const userId = await getRequiredUserId(req);
    const body = await req.json();

    const input = orderOutcomePatchSchema.parse(body);

    const result = await patchConfirmedOutcome({
      userId,
      input,
    });

    return ok(result);
  } catch (error) {
    return errorResponse(error);
  }
}