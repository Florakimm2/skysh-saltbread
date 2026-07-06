import { NextResponse } from "next/server";
import { handleRouteError } from "@/backend/common/errors";
import { refresh } from "@/backend/modules/auth/service";

export const runtime = "nodejs";

type FirebaseTokenClaims = {
  email?: unknown;
  name?: unknown;
};

function readFirebaseTokenClaims(accessToken: string): FirebaseTokenClaims {
  try {
    const payload = accessToken.split(".")[1];
    if (!payload) return {};

    return JSON.parse(
      Buffer.from(payload, "base64url").toString("utf8"),
    ) as FirebaseTokenClaims;
  } catch {
    return {};
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { refreshToken?: unknown };

    if (
      typeof body.refreshToken !== "string" ||
      body.refreshToken.length === 0
    ) {
      return NextResponse.json(
        { message: "확장 프로그램 인증 정보가 없습니다." },
        { status: 400 },
      );
    }

    const result = await refresh(body.refreshToken);
    const claims = readFirebaseTokenClaims(result.accessToken);

    return NextResponse.json(
      {
        message: "확장 프로그램 인증이 갱신되었습니다.",
        accessToken: result.accessToken,
        refreshToken: result.refreshToken,
        expiresIn: result.expiresIn,
        user: {
          id: result.userId,
          email: typeof claims.email === "string" ? claims.email : "",
          name: typeof claims.name === "string" ? claims.name : "",
        },
      },
      { status: 200 },
    );
  } catch (error) {
    return handleRouteError(error);
  }
}
