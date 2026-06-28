import { NextResponse } from "next/server";
import { handleRouteError } from "@/backend/common/errors";
import { validateSignupInput } from "@/backend/modules/auth/schema";
import { signup } from "@/backend/modules/auth/service";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const input = validateSignupInput(body);

    const result = await signup(input);

    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    return handleRouteError(error);
  }
}