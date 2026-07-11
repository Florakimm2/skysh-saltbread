// app/api/me/guardrail-rules/reorder/route.ts

import { NextRequest } from "next/server";
import { getRequiredUserId } from "@/backend/common/auth";
import { errorResponse, ok } from "@/backend/common/api";
import { reorderUserGuardrailRulesSchema } from "@/backend/modules/guardrail/schema";
import { reorderGuardrailRules } from "@/backend/modules/guardrail/service";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const userId = await getRequiredUserId(req);
    const body = await req.json();
    const input = reorderUserGuardrailRulesSchema.parse(body);

    const rules = await reorderGuardrailRules({
      userId,
      input,
    });

    return ok(rules);
  } catch (error) {
    return errorResponse(error);
  }
}
