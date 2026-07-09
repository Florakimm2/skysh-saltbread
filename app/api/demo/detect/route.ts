import { NextResponse } from "next/server";
import { detectEmotionTradeRequestSchema } from "@/backend/modules/ext/detect/schema";
import { detectEmotionTrade } from "@/backend/modules/ext/detect/service";

export const runtime = "nodejs";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders });
}

export async function POST(request: Request) {
  try {
    const input = detectEmotionTradeRequestSchema.parse(await request.json());
    return NextResponse.json(detectEmotionTrade(input), {
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
        matchedRuleIds: [],
        primaryRuleId: null,
      },
      { status: 400, headers: corsHeaders },
    );
  }
}
