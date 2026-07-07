// backend/common/auth.ts

import { NextRequest } from "next/server";
import { getAuth } from "firebase-admin/auth";
import { ApiError } from "./api";

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

  throw new ApiError(
    401,
    "UNAUTHORIZED",
    "Authorization Bearer 토큰이 필요합니다."
  );
}