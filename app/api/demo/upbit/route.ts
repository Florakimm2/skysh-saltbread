const UPBIT_API_BASE_URL = "https://api.upbit.com";
const DEFAULT_MARKET = "KRW-BTC";

type UpbitTicker = {
  market: string;
  trade_price: number;
  signed_change_price: number;
  signed_change_rate: number;
  acc_trade_price_24h: number;
  acc_trade_volume_24h: number;
  high_price: number;
  low_price: number;
  opening_price: number;
};

type UpbitMarket = {
  market: string;
  korean_name: string;
  english_name: string;
  market_event?: {
    warning?: boolean;
    caution?: Record<string, boolean>;
  };
};

async function fetchUpbit<T>(path: string): Promise<T> {
  const response = await fetch(`${UPBIT_API_BASE_URL}${path}`, {
    headers: { Accept: "application/json" },
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`Upbit API returned ${response.status}`);
  }

  return response.json() as Promise<T>;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const requestedMarket = (
    url.searchParams.get("market") || DEFAULT_MARKET
  ).toUpperCase();
  const market = /^KRW-[A-Z0-9]+$/.test(requestedMarket)
    ? requestedMarket
    : DEFAULT_MARKET;
  const encodedMarket = encodeURIComponent(market);

  try {
    const [tickers, markets, candles, orderbooks] = await Promise.all([
      fetchUpbit<UpbitTicker[]>("/v1/ticker/all?quote_currencies=KRW"),
      fetchUpbit<UpbitMarket[]>("/v1/market/all?is_details=true"),
      fetchUpbit<Array<Record<string, number | string>>>(
        `/v1/candles/minutes/1?market=${encodedMarket}&count=90`,
      ),
      fetchUpbit<
        Array<{
          timestamp: number;
          total_ask_size: number;
          total_bid_size: number;
          orderbook_units: Array<{
            ask_price: number;
            bid_price: number;
            ask_size: number;
            bid_size: number;
          }>;
        }>
      >(`/v1/orderbook?markets=${encodedMarket}&count=15`),
    ]);

    const marketNames = new Map(
      markets.map((item) => [item.market, item]),
    );
    const currentTicker =
      tickers.find((ticker) => ticker.market === market) || tickers[0];
    const currentMarket =
      marketNames.get(currentTicker?.market || market) ||
      marketNames.get(DEFAULT_MARKET);
    const topMarkets = [...tickers]
      .filter((ticker) => ticker.market.startsWith("KRW-"))
      .sort(
        (left, right) =>
          right.acc_trade_price_24h - left.acc_trade_price_24h,
      )
      .slice(0, 18)
      .map((ticker) => {
        const detail = marketNames.get(ticker.market);

        return {
          ...ticker,
          korean_name: detail?.korean_name || ticker.market.split("-")[1],
          has_warning_badge: Boolean(
            detail?.market_event?.warning ||
              Object.values(detail?.market_event?.caution || {}).some(Boolean),
          ),
        };
      });
    const volatileMarket = [...tickers]
      .filter((ticker) => ticker.market.startsWith("KRW-"))
      .sort(
        (left, right) =>
          Math.abs(right.signed_change_rate) -
          Math.abs(left.signed_change_rate),
      )[0];

    return Response.json({
      market: currentTicker?.market || market,
      korean_name: currentMarket?.korean_name || "비트코인",
      ticker: currentTicker,
      candles: candles.reverse(),
      orderbook: orderbooks[0] || null,
      top_markets: topMarkets,
      volatile_market: volatileMarket?.market || market,
      updated_at: new Date().toISOString(),
    });
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "실시간 시세를 불러오지 못했습니다.",
      },
      { status: 502 },
    );
  }
}
