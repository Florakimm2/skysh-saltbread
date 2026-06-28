import { NextResponse } from "next/server";
import { setRefreshTokenCookie } from "@/backend/common/cookies";
import { handleRouteError } from "@/backend/common/errors";
import { validateLoginInput } from "@/backend/modules/auth/schema";
import { login } from "@/backend/modules/auth/service";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const input = validateLoginInput(body);

    const result = await login(input);

    const response = NextResponse.json(
      {
        message: result.message,
        accessToken: result.accessToken,
        expiresIn: result.expiresIn,
        user: result.user,
      },
      { status: 200 }
    );

    setRefreshTokenCookie(response, result.refreshToken);

    return response;
  } catch (error) {
    return handleRouteError(error);
  }
}