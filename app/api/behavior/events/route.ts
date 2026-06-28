// app/api/behavior/events/route.ts

import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";
import { recordBehaviorEventSchema } from "@/backend/modules/behavior/schema";
import {
  createBehaviorEvent,
  findBehaviorEventsByUser,
} from "@/backend/modules/behavior/repository";

export const runtime = "nodejs";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-User-Id",
};

function getUserId(req: NextRequest, body?: { userId?: string }) {
  /**
   * MVP 테스트용.
   * 나중에 로그인 연동이 완성되면 Authorization Bearer 토큰 검증으로 교체.
   */
  return req.headers.get("x-user-id") ?? body?.userId ?? "demo-user";
}

function validationErrorResponse(error: ZodError) {
  return NextResponse.json(
    {
      ok: false,
      code: "VALIDATION_ERROR",
      message: "전송된 데이터 형식이 올바르지 않습니다.",
      errors: error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      })),
    },
    {
      status: 400,
      headers: corsHeaders,
    }
  );
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: corsHeaders,
  });
}

/**
 * 행동 로그 저장 API
 *
 * POST /api/behavior/events
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    const parsed = recordBehaviorEventSchema.safeParse(body);

    if (!parsed.success) {
      return validationErrorResponse(parsed.error);
    }

    const userId = getUserId(req, body);

    const savedLog = await createBehaviorEvent(userId, {
      sessionId: parsed.data.sessionId,

      symbol: parsed.data.symbol,
      eventType: parsed.data.eventType,

      side: parsed.data.side,
      orderType: parsed.data.orderType,

      price: parsed.data.price,
      amount: parsed.data.amount,
      quantity: parsed.data.quantity,

      pageUrl: parsed.data.pageUrl,
      occurredAt: parsed.data.occurredAt,

      metadata: parsed.data.metadata,
    });

    return NextResponse.json(
      {
        ok: true,
        message: "행동 로그가 저장되었습니다.",
        data: savedLog,
      },
      {
        status: 201,
        headers: corsHeaders,
      }
    );
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        code: "BEHAVIOR_EVENT_SAVE_FAILED",
        message:
          error instanceof Error
            ? error.message
            : "행동 로그 저장 중 알 수 없는 오류가 발생했습니다.",
      },
      {
        status: 500,
        headers: corsHeaders,
      }
    );
  }
}

/**
 * 저장된 행동 로그 확인용 API
 *
 * GET /api/behavior/events?userId=test-user&limit=10
 */
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);

    const userId =
      req.headers.get("x-user-id") ??
      searchParams.get("userId") ??
      "demo-user";

    const limitParam = searchParams.get("limit");
    const limit = limitParam ? Number(limitParam) : 20;

    const logs = await findBehaviorEventsByUser({
      userId,
      limit: Number.isFinite(limit) ? limit : 20,
    });

    return NextResponse.json(
      {
        ok: true,
        data: logs,
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
        code: "BEHAVIOR_EVENT_LIST_FAILED",
        message:
          error instanceof Error
            ? error.message
            : "행동 로그 조회 중 알 수 없는 오류가 발생했습니다.",
      },
      {
        status: 500,
        headers: corsHeaders,
      }
    );
  }
}