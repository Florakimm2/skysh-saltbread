// app/api/ext/detect/route.ts

import { NextRequest, NextResponse } from "next/server";
import { verifyAccessToken } from "@/backend/modules/auth/service";
import { detectEmotionTradeRequestSchema } from "@/backend/modules/ext/detect/schema";
import { detectEmotionTrade } from "@/backend/modules/ext/detect/service";

export const runtime = "nodejs";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

function getBearerToken(req: NextRequest): string | null {
  const authorization = req.headers.get("authorization");

  if (!authorization) return null;

  const [type, token] = authorization.split(" ");

  if (type !== "Bearer" || !token) return null;

  return token;
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: corsHeaders,
  });
}

export async function GET() {
  return NextResponse.json(
    {
      ok: true,
      message: "POST /api/ext/detect 로 요청하세요.",
    },
    {
      status: 200,
      headers: corsHeaders,
    }
  );
}

export async function POST(req: NextRequest) {
  try {
    const token = getBearerToken(req);

    if (!token) {
      return NextResponse.json(
        {
          detected: false,
          type: null,
          message: "인증 토큰이 없습니다.",
        },
        {
          status: 401,
          headers: corsHeaders,
        }
      );
    }

    try {
      await verifyAccessToken(token);
    } catch {
      return NextResponse.json(
        {
          detected: false,
          type: null,
          message: "Access Token이 유효하지 않습니다.",
        },
        {
          status: 401,
          headers: corsHeaders,
        },
      );
    }

    const body = await req.json();
    const input = detectEmotionTradeRequestSchema.parse(body);

    const result = detectEmotionTrade(input);

    return NextResponse.json(result, {
      status: 200,
      headers: corsHeaders,
    });
  } catch (error) {
    return NextResponse.json(
      {
        detected: false,
        type: null,
        message:
          error instanceof Error
            ? `요청 데이터 형식이 올바르지 않습니다: ${error.message}`
            : "요청 데이터 형식이 올바르지 않습니다.",
      },
      {
        status: 400,
        headers: corsHeaders,
      }
    );
  }
}
