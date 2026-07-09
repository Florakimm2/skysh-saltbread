// app/api/market-snapshot/route.ts

import { NextRequest, NextResponse } from "next/server";
import { marketService } from "@/backend/modules/market/service";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const market = searchParams.get("market") ?? "KRW-BTC";
    const data = await marketService.getMarketSnapshot(market);
    const fetchedAt = data.fetchedAt;
    const fetchedAtMs = Date.parse(fetchedAt);

    return NextResponse.json({
      market,
      tradePrice: String(data.currentPrice),
      signedChangeRate: data.signedChangeRate ?? null,
      shortTermReturn5m: data.shortTermReturn5m ?? null,
      spreadRate: null,
      marketRiskFlags: [],
      pricePositionIn5mRange: null,
      volumeSpikeRatio5m: data.volumeSpikeRatio ?? null,
      fetchedAt,
      freshnessMs: Number.isFinite(fetchedAtMs) ? Date.now() - fetchedAtMs : 0,
      source: "backend-market-snapshot",
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        message:
          error instanceof Error ? error.message : "UNKNOWN_SERVER_ERROR",
      },
      { status: 400 },
    );
  }
}
