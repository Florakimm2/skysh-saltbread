// backend/modules/market/types.ts

  export interface UpbitTickerResponse {
    market: string;
    trade_price: number;
    signed_change_rate?: number;
    timestamp: number;
  }
  
  export interface UpbitMinuteCandleResponse {
    market: string;
    candle_date_time_utc: string;
    candle_date_time_kst: string;
    opening_price: number;
    high_price: number;
    low_price: number;
    trade_price: number;
    timestamp: number;
    candle_acc_trade_price: number;
    candle_acc_trade_volume: number;
    unit: number;
  }
  
  export interface MarketSnapshot {
    symbol: string;
    currentPrice: number;
    price15mAgo: number;
    changeRate15m: number;
    signedChangeRate: number | null;
    shortTermReturn5m: number | null;
    latestVolume: number;
    avgVolume10m: number;
    volumeSpikeRatio: number;
    isSurging: boolean;
    isVolumeSpike: boolean;
    fetchedAt: string;
  }
