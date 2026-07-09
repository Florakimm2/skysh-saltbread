// app/api/me/guardrail-rules/route.ts

import { NextRequest } from "next/server";
import { getRequiredUserId } from "@/backend/common/auth";
import { created, errorResponse, ok } from "@/backend/common/api";
import { createUserGuardrailRuleSchema } from "@/backend/modules/guardrail/schema";
import {
  createGuardrailRule,
  listGuardrailRules,
} from "@/backend/modules/guardrail/service";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  try {
    const userId = await getRequiredUserId(req);

    const rules = await listGuardrailRules({
      userId,
    });

    return ok(rules);
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(req: NextRequest) {
  try {
    const userId = await getRequiredUserId(req);
    const body = await req.json();

    const input = createUserGuardrailRuleSchema.parse(body);

    const rule = await createGuardrailRule({
      userId,
      input,
    });

    return created(rule);
  } catch (error) {
    return errorResponse(error);
  }
}