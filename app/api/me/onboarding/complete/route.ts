// app/api/me/onboarding/complete/route.ts

import { NextRequest } from "next/server";
import { getRequiredUserId } from "@/backend/common/auth";
import { created, errorResponse } from "@/backend/common/api";
import { completeOnboardingSchema } from "@/backend/modules/guardrail/schema";
import { completeOnboarding } from "@/backend/modules/guardrail/service";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const userId = await getRequiredUserId(req);
    const body = await req.json();

    const input = completeOnboardingSchema.parse(body);

    const result = await completeOnboarding({
      userId,
      personalDataConsentVersion: input.personalDataConsentVersion,
      initialRules: input.initialRules,
    });

    return created(result);
  } catch (error) {
    return errorResponse(error);
  }
}