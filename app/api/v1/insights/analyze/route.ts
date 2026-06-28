// app/api/insight/route.ts

import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";
import { insightRequestSchema } from "@/backend/modules/insight/schema";
import { requestInsightFromFastApi } from "@/backend/modules/insight/service";

export const runtime = "nodejs";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-User-Id",
};

function getUserId(req: NextRequest, body?: { userId?: string }) {
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

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    const parsed = insightRequestSchema.safeParse(body);

    if (!parsed.success) {
      return validationErrorResponse(parsed.error);
    }

    const userId = getUserId(req, body);

    const result = await requestInsightFromFastApi({
      userId,
      summaries: parsed.data.summaries,
    });

    return NextResponse.json(
      {
        ok: true,
        data: {
          userId,
          insight: result.insight,
        },
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
        code: "INSIGHT_FAILED",
        message:
          error instanceof Error
            ? error.message
            : "인사이트 생성 중 알 수 없는 오류가 발생했습니다.",
      },
      {
        status: 500,
        headers: corsHeaders,
      }
    );
  }
}