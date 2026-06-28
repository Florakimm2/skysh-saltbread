import { NextResponse } from "next/server";
import {
  getCookieValue,
  REFRESH_TOKEN_COOKIE_NAME,
  setRefreshTokenCookie,
} from "@/backend/common/cookies";
import { handleRouteError } from "@/backend/common/errors";
import { refresh } from "@/backend/modules/auth/service";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const refreshToken = getCookieValue(request, REFRESH_TOKEN_COOKIE_NAME);

    const result = await refresh(refreshToken);

    const response = NextResponse.json(
      {
        message: result.message,
        accessToken: result.accessToken,
        expiresIn: result.expiresIn,
      },
      { status: 200 }
    );

    setRefreshTokenCookie(response, result.refreshToken);

    return response;
  } catch (error) {
    return handleRouteError(error);
  }
}