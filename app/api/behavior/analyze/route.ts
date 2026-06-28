// app/api/behavior/analyze/route.ts

import { NextRequest, NextResponse } from "next/server";
import { analyzeRiskSchema } from "@/backend/modules/behavior/schema";
import { analyzeCurrentRisk } from "@/backend/modules/behavior/service";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-User-Id",
};

function getMvpUserId(req: NextRequest, body: { userId?: string }) {
  /**
   * MVP 테스트용.
   * 실제 배포에서는 auth service에서 accessToken 검증 후 userId를 꺼내야 함.
   */
  return req.headers.get("x-user-id") ?? body.userId ?? "demo-user";
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: corsHeaders,
  });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const input = analyzeRiskSchema.parse(body);
    const userId = getMvpUserId(req, body);

    const result = await analyzeCurrentRisk(userId, {
      symbol: input.symbol,
      currentOrder: input.currentOrder,
    });

    return NextResponse.json(
      {
        ok: true,
        data: result,
      },
      {
        status: 200,
        headers: corsHeaders,
      }
    );
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        message:
          error instanceof Error ? error.message : "UNKNOWN_SERVER_ERROR",
      },
      {
        status: 400,
        headers: corsHeaders,
      }
    );
  }
}