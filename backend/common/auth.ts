// backend/common/auth.ts

import { NextRequest } from "next/server";
import { getAuth } from "firebase-admin/auth";
import { getCookieValue, REFRESH_TOKEN_COOKIE_NAME } from "./cookies";
import { ApiError } from "./api";
import { refresh } from "@/backend/modules/auth/service";

/**
 * Authorization: Bearer <Firebase ID Token>
 *
 * 개발 중 Postman 테스트가 너무 불편하면
 * NODE_ENV !== "production"일 때만 x-user-id fallback을 허용한다.
 */
export async function getRequiredUserId(req: NextRequest): Promise<string> {
  const authorization = req.headers.get("authorization");

  if (authorization?.startsWith("Bearer ")) {
    const token = authorization.slice("Bearer ".length).trim();

    if (!token) {
      throw new ApiError(401, "UNAUTHORIZED", "인증 토큰이 비어 있습니다.");
    }

    const decoded = await getAuth().verifyIdToken(token);
    return decoded.uid;
  }

  if (process.env.NODE_ENV !== "production") {
    const devUserId = req.headers.get("x-user-id");
    if (devUserId) return devUserId;
  }

  const refreshToken = getCookieValue(req, REFRESH_TOKEN_COOKIE_NAME);

  if (refreshToken) {
    try {
      const session = await refresh(refreshToken);
      return session.userId;
    } catch {
      throw new ApiError(
        401,
        "UNAUTHORIZED",
        "로그인 세션이 만료되었습니다. 다시 로그인해 주세요."
      );
    }
  }

  throw new ApiError(
    401,
    "UNAUTHORIZED",
    "Authorization Bearer 토큰 또는 로그인 세션이 필요합니다."
  );
}
