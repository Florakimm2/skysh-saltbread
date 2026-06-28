import { NextResponse } from "next/server";
import { clearRefreshTokenCookie } from "@/backend/common/cookies";
import { handleRouteError } from "@/backend/common/errors";
import { getBearerToken } from "@/backend/common/http";
import { logout } from "@/backend/modules/auth/service";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const accessToken = getBearerToken(request);

    const result = await logout(accessToken);

    const response = NextResponse.json(
      {
        message: result.message,
      },
      { status: 200 }
    );

    clearRefreshTokenCookie(response);

    return response;
  } catch (error) {
    return handleRouteError(error);
  }
}