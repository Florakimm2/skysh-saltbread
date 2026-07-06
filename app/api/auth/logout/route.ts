import { NextResponse } from "next/server";
import {
  clearRefreshTokenCookie,
  getCookieValue,
  REFRESH_TOKEN_COOKIE_NAME,
} from "@/backend/common/cookies";
import { getBearerToken } from "@/backend/common/http";
import { logout, refresh } from "@/backend/modules/auth/service";

export const runtime = "nodejs";

export async function POST(request: Request) {
  let accessToken = getBearerToken(request);

  try {
    if (!accessToken) {
      const refreshToken = getCookieValue(
        request,
        REFRESH_TOKEN_COOKIE_NAME,
      );

      if (refreshToken) {
        accessToken = (await refresh(refreshToken)).accessToken;
      }
    }

    await logout(accessToken);
  } catch {
    // 이미 만료되거나 폐기된 세션이어도 로그아웃은 멱등하게 처리합니다.
  }

  const response = NextResponse.json(
    { message: "로그아웃되었습니다." },
    { status: 200 },
  );
  clearRefreshTokenCookie(response);
  return response;
}
