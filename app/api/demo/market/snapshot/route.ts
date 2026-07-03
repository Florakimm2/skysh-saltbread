// app/api/market/snapshot/route.ts

import { NextRequest, NextResponse } from "next/server";
import { marketService } from "@/backend/modules/market/service";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const symbol = searchParams.get("symbol") ?? "KRW-BTC";

    const data = await marketService.getMarketSnapshot(symbol);

    return NextResponse.json({
      ok: true,
      data,
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        message:
          error instanceof Error ? error.message : "UNKNOWN_SERVER_ERROR",
      },
      {
        status: 400,
      }
    );
  }
}