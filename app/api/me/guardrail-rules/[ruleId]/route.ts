// app/api/me/guardrail-rules/[ruleId]/route.ts

import { NextRequest } from "next/server";
import { getRequiredUserId } from "@/backend/common/auth";
import { errorResponse, noContent, ok } from "@/backend/common/api";
import { patchUserGuardrailRuleSchema } from "@/backend/modules/guardrail/schema";
import {
  deleteGuardrailRule,
  patchGuardrailRule,
} from "@/backend/modules/guardrail/service";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{
    ruleId: string;
  }>;
};

export async function PATCH(req: NextRequest, context: RouteContext) {
  try {
    const userId = await getRequiredUserId(req);
    const { ruleId } = await context.params;
    const body = await req.json();

    const input = patchUserGuardrailRuleSchema.parse(body);

    const updated = await patchGuardrailRule({
      userId,
      ruleId,
      input,
    });

    return ok(updated);
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(req: NextRequest, context: RouteContext) {
  try {
    const userId = await getRequiredUserId(req);
    const { ruleId } = await context.params;

    await deleteGuardrailRule({
      userId,
      ruleId,
    });

    return noContent();
  } catch (error) {
    return errorResponse(error);
  }
}