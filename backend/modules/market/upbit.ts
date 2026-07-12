// backend/modules/market/upbit.ts

import type {
    MarketSnapshot,
    UpbitMinuteCandleResponse,
    UpbitTickerResponse,
  } from "./types";
  
  const UPBIT_BASE_URL = "https://api.upbit.com";
  
  function validateMarket(symbol: string) {
    if (!/^KRW-[A-Z0-9]+$/.test(symbol)) {
      throw new Error("INVALID_UPBIT_MARKET_SYMBOL");
    }
  }
  
  async function upbitFetch<T>(path: string): Promise<T> {
    const response = await fetch(`${UPBIT_BASE_URL}${path}`, {
      method: "GET",
      headers: {
        Accept: "application/json",
      },
      cache: "no-store",
    });
  
    if (!response.ok) {
      throw new Error(`UPBIT_API_ERROR_${response.status}`);
    }
  
    return response.json() as Promise<T>;
  }
  
  export async function getTicker(symbol: string): Promise<UpbitTickerResponse> {
    validateMarket(symbol);
  
    const data = await upbitFetch<UpbitTickerResponse[]>(
      `/v1/ticker?markets=${encodeURIComponent(symbol)}`
    );
  
    if (!data.length) {
      throw new Error("UPBIT_TICKER_NOT_FOUND");
    }
  
    return data[0];
  }
  
  export async function getMinuteCandles(params: {
    symbol: string;
    unit?: 1 | 3 | 5 | 10 | 15 | 30 | 60 | 240;
    count?: number;
    to?: string;
  }): Promise<UpbitMinuteCandleResponse[]> {
    validateMarket(params.symbol);
  
    const unit = params.unit ?? 1;
    const count = params.count ?? 16;
  
    const searchParams = new URLSearchParams({
      market: params.symbol,
      count: String(count),
    });
    if (params.to) {
      searchParams.set("to", params.to);
    }

    return upbitFetch<UpbitMinuteCandleResponse[]>(
      `/v1/candles/minutes/${unit}?${searchParams.toString()}`
    );
  }
  
  function average(numbers: number[]): number {
    if (numbers.length === 0) return 0;
    return numbers.reduce((sum, value) => sum + value, 0) / numbers.length;
  }
  
  export async function getMarketSnapshot(
    symbol: string
  ): Promise<MarketSnapshot> {
    const [ticker, candles] = await Promise.all([
      getTicker(symbol),
      getMinuteCandles({ symbol, unit: 1, count: 16 }),
    ]);
  
    const currentPrice = ticker.trade_price;
  
    /**
     * Upbit candle 응답은 최신 캔들이 앞에 온다.
     * candles[0] = 가장 최근 1분봉
     * candles[candles.length - 1] = 약 15분 전 근처 캔들
     */
    const oldestCandle = candles[candles.length - 1];
    const price15mAgo = oldestCandle?.trade_price ?? currentPrice;
    const fiveMinuteAgoCandle = candles[5] ?? oldestCandle;
    const price5mAgo = fiveMinuteAgoCandle?.trade_price ?? currentPrice;
  
    const changeRate15m =
      price15mAgo > 0 ? ((currentPrice - price15mAgo) / price15mAgo) * 100 : 0;
    const shortTermReturn5m =
      price5mAgo > 0 ? (currentPrice - price5mAgo) / price5mAgo : null;
  
    const latestVolume = candles[0]?.candle_acc_trade_volume ?? 0;
    const previous10Volumes = candles
      .slice(1, 11)
      .map((candle) => candle.candle_acc_trade_volume);
  
    const avgVolume10m = average(previous10Volumes);
    const volumeSpikeRatio =
      avgVolume10m > 0 ? latestVolume / avgVolume10m : 0;
  
    return {
      symbol,
      currentPrice,
      price15mAgo,
      changeRate15m,
      signedChangeRate: ticker.signed_change_rate ?? null,
      shortTermReturn5m,
      latestVolume,
      avgVolume10m,
      volumeSpikeRatio,
      isSurging: changeRate15m >= 5,
      isVolumeSpike: volumeSpikeRatio >= 3,
      fetchedAt: new Date().toISOString(),
    };
  }
