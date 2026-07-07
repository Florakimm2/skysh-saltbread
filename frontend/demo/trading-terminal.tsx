"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import RawDebugPanel, {
  type DebugCategory,
  type DebugRecord,
} from "./raw-debug-panel";
import {
  cancelOrder,
  createInitialPortfolio,
  settleOpenOrders,
  submitOrder,
  toUpbitAccounts,
  validateOrder,
  type DemoOrder,
  type OrderDraft,
  type Quote,
} from "./trading-engine";

type OrderSide = "BUY" | "SELL";
type OrderType = "LIMIT" | "MARKET";
type Toast = {
  message: string;
  variant: "success" | "error";
};

type DemoModal =
  | { type: "confirm"; draft: OrderDraft }
  | {
      type: "notice";
      title: string;
      message: string;
    }
  | {
      type: "receipt";
      order: DemoOrder;
    }
  | null;

type Ticker = {
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

type MarketItem = Ticker & {
  korean_name: string;
  has_warning_badge: boolean;
};

type Candle = {
  opening_price: number;
  high_price: number;
  low_price: number;
  trade_price: number;
  candle_acc_trade_volume: number;
};

type OrderbookUnit = {
  ask_price: number;
  bid_price: number;
  ask_size: number;
  bid_size: number;
};

type MarketPayload = {
  market: string;
  korean_name: string;
  ticker: Ticker;
  candles: Candle[];
  orderbook: {
    total_ask_size: number;
    total_bid_size: number;
    orderbook_units: OrderbookUnit[];
  } | null;
  top_markets: MarketItem[];
  volatile_market: string;
  updated_at: string;
};

type DemoScenario = {
  key: number;
  type: string;
  title: string;
  description: string;
  orderSide: OrderSide;
  orderType: OrderType;
  amountMultiplier: number;
  priceMultiplier: number;
  behaviorData: {
    is_max_button_clicked: boolean;
    client_avg_buy_amount: number | null;
    buy_click_count_1m: number;
    input_edit_count: number;
    page_stay_duration: number;
  };
  recentOrders: Array<Record<string, string | number | null>>;
  marketData: {
    price_change_rate_15m: number;
    volume_change_rate_1m: number;
    is_top3_volatility: boolean;
    has_warning_badge: boolean;
  };
  useVolatileMarket?: boolean;
};

const FALLBACK_PAYLOAD: MarketPayload = {
  market: "KRW-BTC",
  korean_name: "비트코인",
  ticker: {
    market: "KRW-BTC",
    trade_price: 149_857_000,
    signed_change_price: 1_268_000,
    signed_change_rate: 0.00853,
    acc_trade_price_24h: 183_928_345_100,
    acc_trade_volume_24h: 1231.672,
    high_price: 151_022_000,
    low_price: 147_812_000,
    opening_price: 148_589_000,
  },
  candles: Array.from({ length: 54 }, (_, index) => {
    const wave = Math.sin(index / 4) * 1_700_000;
    const trend = index * 34_000;
    const tradePrice = 146_800_000 + trend + wave;

    return {
      opening_price: tradePrice - 170_000,
      high_price: tradePrice + 480_000,
      low_price: tradePrice - 520_000,
      trade_price: tradePrice,
      candle_acc_trade_volume: 7 + ((index * 13) % 19),
    };
  }),
  orderbook: {
    total_ask_size: 12.817,
    total_bid_size: 18.244,
    orderbook_units: Array.from({ length: 10 }, (_, index) => ({
      ask_price: 149_858_000 + index * 1000,
      bid_price: 149_856_000 - index * 1000,
      ask_size: 0.08 + ((index * 7) % 10) / 10,
      bid_size: 0.12 + ((index * 3) % 10) / 10,
    })),
  },
  top_markets: [
    ["KRW-BTC", "비트코인", 149_857_000, 0.00853],
    ["KRW-XRP", "리플", 2925, -0.0121],
    ["KRW-ETH", "이더리움", 5_211_000, 0.0042],
    ["KRW-SOL", "솔라나", 221_650, 0.0231],
    ["KRW-DOGE", "도지코인", 237, -0.0084],
    ["KRW-ADA", "에이다", 824, 0.0172],
    ["KRW-USDT", "테더", 1388, 0.0004],
  ].map(([market, korean_name, trade_price, signed_change_rate], index) => ({
    market: String(market),
    korean_name: String(korean_name),
    trade_price: Number(trade_price),
    signed_change_rate: Number(signed_change_rate),
    signed_change_price: Number(trade_price) * Number(signed_change_rate),
    acc_trade_price_24h: 190_000_000_000 / (index + 1),
    acc_trade_volume_24h: 1000 / (index + 1),
    high_price: Number(trade_price) * 1.02,
    low_price: Number(trade_price) * 0.98,
    opening_price: Number(trade_price) * 0.995,
    has_warning_badge: false,
  })),
  volatile_market: "KRW-SOL",
  updated_at: new Date(0).toISOString(),
};

const SCENARIOS: DemoScenario[] = [
  {
    key: 1,
    type: "FOMO_CHASING",
    title: "급등 추격 매수",
    description: "현재가보다 높은 지정가로 빠르게 진입합니다.",
    orderSide: "BUY",
    orderType: "LIMIT",
    amountMultiplier: 1.2,
    priceMultiplier: 1.065,
    behaviorData: {
      is_max_button_clicked: false,
      client_avg_buy_amount: 500_000,
      buy_click_count_1m: 2,
      input_edit_count: 2,
      page_stay_duration: 32,
    },
    recentOrders: [],
    marketData: {
      price_change_rate_15m: 6.2,
      volume_change_rate_1m: 340,
      is_top3_volatility: false,
      has_warning_badge: false,
    },
  },
  {
    key: 2,
    type: "REVENGE_TRADING",
    title: "손실 직후 복구 매매",
    description: "최근 1시간 내 손절 뒤 더 큰 금액으로 재진입합니다.",
    orderSide: "BUY",
    orderType: "MARKET",
    amountMultiplier: 2.4,
    priceMultiplier: 1,
    behaviorData: {
      is_max_button_clicked: false,
      client_avg_buy_amount: 500_000,
      buy_click_count_1m: 2,
      input_edit_count: 2,
      page_stay_duration: 48,
    },
    recentOrders: [
      {
        market: "__CURRENT__",
        order_side: "SELL",
        order_status: "DONE",
        order_type: "MARKET",
        order_price: null,
        order_volume: 0.4,
        order_amount: 1_750_000,
        realized_loss_pct_1h: 7.4,
        order_request_time: "__NOW_MINUS_10M__",
        order_cancel_time: null,
      },
    ],
    marketData: {
      price_change_rate_15m: 0.8,
      volume_change_rate_1m: 30,
      is_top3_volatility: false,
      has_warning_badge: false,
    },
  },
  {
    key: 3,
    type: "HESITATION",
    title: "반복 수정·취소",
    description: "가격과 수량을 여러 번 고치고 주문을 반복 취소합니다.",
    orderSide: "BUY",
    orderType: "LIMIT",
    amountMultiplier: 0.9,
    priceMultiplier: 0.998,
    behaviorData: {
      is_max_button_clicked: false,
      client_avg_buy_amount: 500_000,
      buy_click_count_1m: 1,
      input_edit_count: 9,
      page_stay_duration: 165,
    },
    recentOrders: Array.from({ length: 3 }, (_, index) => ({
      market: "__CURRENT__",
      order_side: "BUY",
      order_status: "CANCEL",
      order_type: "LIMIT",
      order_price: 149_000_000 + index * 250_000,
      order_volume: 0.004,
      order_amount: 596_000 + index * 1000,
      realized_loss_pct_1h: null,
      order_request_time: `__NOW_MINUS_${index + 1}M__`,
      order_cancel_time: `__NOW_MINUS_${index + 1}M__`,
    })),
    marketData: {
      price_change_rate_15m: 1.1,
      volume_change_rate_1m: 25,
      is_top3_volatility: false,
      has_warning_badge: false,
    },
  },
  {
    key: 4,
    type: "ALL_IN_IMPULSE",
    title: "최대 금액 충동 매수",
    description: "최대 버튼을 누르고 보유 원화 대부분을 주문합니다.",
    orderSide: "BUY",
    orderType: "MARKET",
    amountMultiplier: 9.8,
    priceMultiplier: 1,
    behaviorData: {
      is_max_button_clicked: true,
      client_avg_buy_amount: 500_000,
      buy_click_count_1m: 1,
      input_edit_count: 1,
      page_stay_duration: 24,
    },
    recentOrders: [],
    marketData: {
      price_change_rate_15m: 6.1,
      volume_change_rate_1m: 180,
      is_top3_volatility: false,
      has_warning_badge: false,
    },
  },
  {
    key: 5,
    type: "AMOUNT_SPIKE",
    title: "평소보다 큰 주문",
    description: "최근 평균 매수 금액의 6배를 한 번에 주문합니다.",
    orderSide: "BUY",
    orderType: "LIMIT",
    amountMultiplier: 3,
    priceMultiplier: 1,
    behaviorData: {
      is_max_button_clicked: false,
      client_avg_buy_amount: 500_000,
      buy_click_count_1m: 1,
      input_edit_count: 2,
      page_stay_duration: 92,
    },
    recentOrders: [],
    marketData: {
      price_change_rate_15m: 0.6,
      volume_change_rate_1m: 20,
      is_top3_volatility: false,
      has_warning_badge: false,
    },
  },
  {
    key: 6,
    type: "MACHINE_GUN_TRADING",
    title: "시장가 연속 매수",
    description: "1분 안에 시장가 매수 버튼을 6회 누른 상태입니다.",
    orderSide: "BUY",
    orderType: "MARKET",
    amountMultiplier: 0.45,
    priceMultiplier: 1,
    behaviorData: {
      is_max_button_clicked: false,
      client_avg_buy_amount: 500_000,
      buy_click_count_1m: 6,
      input_edit_count: 1,
      page_stay_duration: 58,
    },
    recentOrders: [],
    marketData: {
      price_change_rate_15m: 2,
      volume_change_rate_1m: 90,
      is_top3_volatility: false,
      has_warning_badge: false,
    },
  },
  {
    key: 7,
    type: "HIGH_RISK_HOPPING",
    title: "고변동 종목 급진입",
    description: "실시간 변동률 상위 종목으로 이동해 곧바로 진입합니다.",
    orderSide: "BUY",
    orderType: "MARKET",
    amountMultiplier: 1.4,
    priceMultiplier: 1,
    behaviorData: {
      is_max_button_clicked: false,
      client_avg_buy_amount: 500_000,
      buy_click_count_1m: 2,
      input_edit_count: 1,
      page_stay_duration: 14,
    },
    recentOrders: [],
    marketData: {
      price_change_rate_15m: 3.4,
      volume_change_rate_1m: 140,
      is_top3_volatility: true,
      has_warning_badge: true,
    },
    useVolatileMarket: true,
  },
];

function dispatchExtensionEvent(
  type: string,
  detail: Record<string, unknown> = {},
) {
  const requestId = crypto.randomUUID();
  const ackAttribute = "data-saltbread-event-ack";
  document.documentElement.removeAttribute(ackAttribute);
  document.dispatchEvent(
    new CustomEvent(type, {
      detail: { ...detail, requestId },
    }),
  );
  const handled =
    document.documentElement.getAttribute(ackAttribute) === requestId;
  document.documentElement.removeAttribute(ackAttribute);
  return handled;
}

function emitPageEvent(type: string, detail: Record<string, unknown>) {
  document.dispatchEvent(new CustomEvent(type, { detail }));
}

function quoteFromPayload(payload: MarketPayload): Quote {
  const firstUnit = payload.orderbook?.orderbook_units[0];
  const currentPrice = payload.ticker.trade_price || 1;

  return {
    bestAsk: firstUnit?.ask_price || currentPrice,
    bestBid: firstUnit?.bid_price || currentPrice,
    askSize: firstUnit?.ask_size || Number.POSITIVE_INFINITY,
    bidSize: firstUnit?.bid_size || Number.POSITIVE_INFINITY,
  };
}

function marketContextFromPayload(payload: MarketPayload) {
  const candles = payload.candles.slice(-6);
  const first = candles[0]?.trade_price || payload.ticker.trade_price;
  const lows = candles.map((candle) => candle.low_price);
  const highs = candles.map((candle) => candle.high_price);
  const min = Math.min(...lows, payload.ticker.trade_price);
  const max = Math.max(...highs, payload.ticker.trade_price);
  const quote = quoteFromPayload(payload);
  const previousVolumes = payload.candles
    .slice(-16, -1)
    .map((candle) => candle.candle_acc_trade_volume);
  const averageVolume =
    previousVolumes.reduce((sum, value) => sum + value, 0) /
      Math.max(1, previousVolumes.length) || 0;
  const latestVolume =
    payload.candles.at(-1)?.candle_acc_trade_volume || 0;

  return {
    market: payload.market,
    tradePriceAtSnapshot: String(payload.ticker.trade_price),
    shortTermReturn5m: first ? (payload.ticker.trade_price - first) / first : 0,
    signedChangeRate: payload.ticker.signed_change_rate,
    spreadRate:
      quote.bestAsk > 0
        ? (quote.bestAsk - quote.bestBid) / quote.bestAsk
        : null,
    marketRiskFlags: payload.top_markets.find(
      (item) => item.market === payload.market,
    )?.has_warning_badge
      ? ["WARNING"]
      : [],
    pricePositionIn5mRange:
      max > min ? (payload.ticker.trade_price - min) / (max - min) : 0.5,
    volumeSpikeRatio5m:
      averageVolume > 0 ? latestVolume / averageVolume : null,
    ticker: payload.ticker,
    candles: payload.candles,
    orderbook: payload.orderbook,
    collectedAt: payload.updated_at,
  };
}

function formatNumber(value: number, maximumFractionDigits = 0) {
  return new Intl.NumberFormat("ko-KR", {
    maximumFractionDigits,
  }).format(value);
}

function compactWon(value: number) {
  if (value >= 100_000_000) {
    return `${(value / 100_000_000).toFixed(1)}억`;
  }

  if (value >= 10_000) {
    return `${Math.round(value / 10_000).toLocaleString("ko-KR")}만`;
  }

  return formatNumber(value);
}

function normalizeRecentOrders(
  orders: DemoScenario["recentOrders"],
  market: string,
) {
  const now = Date.now();

  return orders.map((order) => {
    const normalized: Record<string, string | number | null> = {
      ...order,
      market:
        !order.market || order.market === "__CURRENT__"
          ? market
          : order.market,
    };

    for (const key of ["order_request_time", "order_cancel_time"]) {
      const value = normalized[key];
      const match =
        typeof value === "string"
          ? value.match(/^__NOW_MINUS_(\d+)(M|S)__$/)
          : null;

      if (match) {
        const unit = match[2] === "M" ? 60_000 : 1000;
        normalized[key] = new Date(
          now - Number(match[1]) * unit,
        ).toISOString();
      }
    }

    return normalized;
  });
}

function Chart({ candles }: { candles: Candle[] }) {
  const width = 920;
  const height = 310;
  const prices = candles.flatMap((candle) => [
    candle.high_price,
    candle.low_price,
  ]);
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const range = max - min || 1;
  const step = width / Math.max(candles.length, 1);
  const bodyWidth = Math.max(2, step * 0.58);
  const maxVolume =
    Math.max(...candles.map((candle) => candle.candle_acc_trade_volume)) || 1;

  return (
    <svg
      className="chart-svg"
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      role="img"
      aria-label="비트코인 1분 봉 차트"
    >
      <defs>
        <linearGradient id="volume-blue" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="#3b82f6" stopOpacity=".52" />
          <stop offset="1" stopColor="#3b82f6" stopOpacity=".08" />
        </linearGradient>
        <linearGradient id="volume-red" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="#e75b64" stopOpacity=".48" />
          <stop offset="1" stopColor="#e75b64" stopOpacity=".08" />
        </linearGradient>
      </defs>
      {[0, 1, 2, 3, 4].map((line) => (
        <line
          key={`h-${line}`}
          x1="0"
          x2={width}
          y1={25 + line * 55}
          y2={25 + line * 55}
          stroke="#e9edf3"
          strokeWidth="1"
        />
      ))}
      {[1, 2, 3, 4, 5].map((line) => (
        <line
          key={`v-${line}`}
          x1={(width / 6) * line}
          x2={(width / 6) * line}
          y1="0"
          y2={height}
          stroke="#f0f2f6"
          strokeWidth="1"
        />
      ))}
      {candles.map((candle, index) => {
        const x = index * step + step / 2;
        const y = (price: number) =>
          10 + ((max - price) / range) * (height - 78);
        const rise = candle.trade_price >= candle.opening_price;
        const bodyTop = Math.min(
          y(candle.opening_price),
          y(candle.trade_price),
        );
        const bodyHeight = Math.max(
          1.5,
          Math.abs(y(candle.opening_price) - y(candle.trade_price)),
        );
        const volumeHeight =
          (candle.candle_acc_trade_volume / maxVolume) * 47;
        const color = rise ? "#e54b55" : "#2878e5";

        return (
          <g key={`${index}-${candle.trade_price}`}>
            <line
              x1={x}
              x2={x}
              y1={y(candle.high_price)}
              y2={y(candle.low_price)}
              stroke={color}
              strokeWidth="1"
            />
            <rect
              x={x - bodyWidth / 2}
              y={bodyTop}
              width={bodyWidth}
              height={bodyHeight}
              fill={color}
            />
            <rect
              x={x - bodyWidth / 2}
              y={height - volumeHeight}
              width={bodyWidth}
              height={volumeHeight}
              fill={rise ? "url(#volume-red)" : "url(#volume-blue)"}
            />
          </g>
        );
      })}
    </svg>
  );
}

function LogoMark() {
  return (
    <div className="upbit-logo" aria-label="UPbit demo">
      UP<span>bit</span>
    </div>
  );
}

function Icon({ name }: { name: string }) {
  const paths: Record<string, React.ReactNode> = {
    search: (
      <>
        <circle cx="10.5" cy="10.5" r="6.5" />
        <path d="m15.5 15.5 4.2 4.2" />
      </>
    ),
    bell: (
      <>
        <path d="M6.5 9.5a5.5 5.5 0 0 1 11 0c0 7 2.5 6 2.5 7H4c0-1 2.5 0 2.5-7Z" />
        <path d="M9.5 19a2.8 2.8 0 0 0 5 0" />
      </>
    ),
    settings: (
      <>
        <circle cx="12" cy="12" r="3" />
        <path d="M19 12a7 7 0 0 0-.1-1l2-1.5-2-3.4-2.4 1A8 8 0 0 0 14.8 6l-.3-2.5h-4L10.2 6a8 8 0 0 0-1.8 1.1L6 6.1 4 9.5 6.1 11a7 7 0 0 0 0 2L4 14.5l2 3.4 2.4-1a8 8 0 0 0 1.8 1.1l.3 2.5h4l.3-2.5a8 8 0 0 0 1.8-1.1l2.4 1 2-3.4-2.1-1.5a7 7 0 0 0 .1-1Z" />
      </>
    ),
  };

  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      {paths[name]}
    </svg>
  );
}

export default function TradingTerminal() {
  const [marketData, setMarketData] =
    useState<MarketPayload>(FALLBACK_PAYLOAD);
  const [portfolio, setPortfolio] = useState(createInitialPortfolio);
  const [modal, setModal] = useState<DemoModal>(null);
  const [debugRecords, setDebugRecords] = useState<DebugRecord[]>([]);
  const [extensionConnected, setExtensionConnected] = useState(false);
  const [market, setMarket] = useState("KRW-BTC");
  const [side, setSide] = useState<OrderSide>("BUY");
  const [orderType, setOrderType] = useState<OrderType>("LIMIT");
  const [price, setPrice] = useState(
    String(FALLBACK_PAYLOAD.ticker.trade_price),
  );
  const [volume, setVolume] = useState("0.0035");
  const [amount, setAmount] = useState("500000");
  const [search, setSearch] = useState("");
  const [liveState, setLiveState] = useState<"loading" | "live" | "fallback">(
    "loading",
  );
  const [toast, setToast] = useState<Toast | null>(null);
  const [activeScenario, setActiveScenario] = useState<number | null>(null);
  const [clock, setClock] = useState("");
  const orderButtonRef = useRef<HTMLButtonElement>(null);
  const marketRef = useRef("KRW-BTC");
  const previousOrdersRef = useRef<Record<string, string>>({});

  const addDebugRecord = useCallback(
    (
      source: DebugRecord["source"],
      category: DebugCategory,
      kind: string,
      payload: unknown,
      occurredAt = new Date().toISOString(),
    ) => {
      setDebugRecords((current) => {
        const next: DebugRecord[] = [
          {
            id: crypto.randomUUID(),
            source,
            category,
            kind,
            occurredAt,
            payload,
          },
          ...current,
        ];
        const categoryCount = new Map<string, number>();

        return next.filter((record) => {
          const key = `${record.source}:${record.category}`;
          const count = categoryCount.get(key) || 0;
          categoryCount.set(key, count + 1);
          return count < 100;
        });
      });
    },
    [],
  );

  const fetchMarket = useCallback(async (selectedMarket: string) => {
    try {
      const response = await fetch(
        `/api/demo/upbit?market=${encodeURIComponent(selectedMarket)}`,
        { cache: "no-store" },
      );

      if (!response.ok) {
        throw new Error("market fetch failed");
      }

      const nextData = (await response.json()) as MarketPayload;
      setMarketData(nextData);
      setMarket(nextData.market);
      marketRef.current = nextData.market;
      setPrice(String(nextData.ticker.trade_price));
      setPortfolio((current) =>
        settleOpenOrders(
          current,
          nextData.market,
          quoteFromPayload(nextData),
        ),
      );
      setLiveState("live");
    } catch {
      setLiveState("fallback");
    }
  }, []);

  useEffect(() => {
    const url = new URL(window.location.href);
    const code = url.searchParams
      .get("code")
      ?.replace("CRIX.UPBIT.", "")
      .toUpperCase();
    const initialMarket =
      code && /^KRW-[A-Z0-9]+$/.test(code) ? code : "KRW-BTC";
    url.searchParams.set("code", `CRIX.UPBIT.${initialMarket}`);
    window.history.replaceState({}, "", url);
    marketRef.current = initialMarket;
    const initialTimeout = window.setTimeout(
      () => void fetchMarket(initialMarket),
      0,
    );

    const interval = window.setInterval(
      () => void fetchMarket(marketRef.current),
      15_000,
    );
    return () => {
      window.clearTimeout(initialTimeout);
      window.clearInterval(interval);
    };
  }, [fetchMarket]);

  useEffect(() => {
    const updateClock = () => {
      setClock(
        new Intl.DateTimeFormat("ko-KR", {
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
          hour12: false,
          timeZone: "Asia/Seoul",
        }).format(new Date()),
      );
    };
    updateClock();
    const interval = window.setInterval(updateClock, 1000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    const handleExtensionDebug = (event: Event) => {
      const detail = (event as CustomEvent).detail;

      if (
        !detail ||
        !["behavior", "market", "personal"].includes(detail.category)
      ) {
        return;
      }

      setExtensionConnected(true);
      addDebugRecord(
        "extension",
        detail.category,
        detail.kind || "EXTENSION_EVENT",
        detail.payload,
        detail.occurredAt,
      );
    };
    const handleContextRequest = () => {
      emitPageEvent("saltbread:demo-context", {
        market: marketContextFromPayload(marketData),
        personal: {
          market,
          accounts: toUpbitAccounts(portfolio),
          orders: portfolio.orders,
          collectedAt: new Date().toISOString(),
        },
      });
    };
    const handleReviewOrder = () => {
      setModal(null);
      orderButtonRef.current?.focus();
    };

    document.addEventListener(
      "saltbread:extension-debug",
      handleExtensionDebug,
    );
    document.addEventListener(
      "saltbread:demo-context-request",
      handleContextRequest,
    );
    document.addEventListener(
      "saltbread:demo-review-order",
      handleReviewOrder,
    );
    return () => {
      document.removeEventListener(
        "saltbread:extension-debug",
        handleExtensionDebug,
      );
      document.removeEventListener(
        "saltbread:demo-context-request",
        handleContextRequest,
      );
      document.removeEventListener(
        "saltbread:demo-review-order",
        handleReviewOrder,
      );
    };
  }, [addDebugRecord, market, marketData, portfolio]);

  useEffect(() => {
    const context = marketContextFromPayload(marketData);
    const timeout = window.setTimeout(
      () => addDebugRecord("page", "market", "MARKET_SNAPSHOT", context),
      0,
    );
    return () => window.clearTimeout(timeout);
  }, [addDebugRecord, marketData]);

  useEffect(() => {
    const accounts = toUpbitAccounts(portfolio);
    const payload = {
      market,
      accounts,
      orders: portfolio.orders,
      collectedAt: new Date().toISOString(),
    };
    emitPageEvent("saltbread:demo-context", {
      market: marketContextFromPayload(marketData),
      personal: payload,
    });

    const newRecords: Array<{ kind: string; order: DemoOrder }> = [];
    for (const order of portfolio.orders) {
      const previousState = previousOrdersRef.current[order.uuid];
      const signature = [
        order.state,
        order.executed_volume,
        order.remaining_volume,
        order.paid_fee,
      ].join(":");

      if (previousState !== signature) {
        const kind = previousState ? "ORDER_UPDATED" : "ORDER_CREATED";
        newRecords.push({ kind, order });
        emitPageEvent("saltbread:demo-order-event", {
          kind,
          order,
          occurredAt: new Date().toISOString(),
        });
        previousOrdersRef.current[order.uuid] = signature;
      }
    }
    const timeout = window.setTimeout(() => {
      addDebugRecord("page", "personal", "ACCOUNT_SNAPSHOT", payload);
      for (const record of newRecords) {
        addDebugRecord(
          "page",
          "personal",
          record.kind,
          record.order,
          record.order.created_at,
        );
      }
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [addDebugRecord, market, marketData, portfolio]);

  const chooseMarket = useCallback(
    (nextMarket: string) => {
      setMarket(nextMarket);
      marketRef.current = nextMarket;
      const url = new URL(window.location.href);
      url.searchParams.set("code", `CRIX.UPBIT.${nextMarket}`);
      window.history.replaceState({}, "", url);
      setLiveState("loading");
      void fetchMarket(nextMarket);
    },
    [fetchMarket],
  );

  const runScenario = useCallback(
    (nextScenario: DemoScenario) => {
      const targetMarket = nextScenario.useVolatileMarket
        ? marketData.volatile_market
        : market;
      const currentPrice = marketData.ticker.trade_price || 1;
      const nextPrice = Math.round(
        currentPrice * nextScenario.priceMultiplier,
      );
      const nextAmount = Math.round(
        1_000_000 * nextScenario.amountMultiplier,
      );
      const nextVolume = Number(
        (nextAmount / Math.max(nextPrice, 1)).toFixed(8),
      );

      const currentOrder = {
        market: targetMarket,
        order_side: nextScenario.orderSide,
        order_status: "WAIT",
        order_type: nextScenario.orderType,
        order_price:
          nextScenario.orderType === "MARKET" ? null : nextPrice,
        order_volume: nextVolume,
        order_amount: nextAmount,
        realized_loss_pct_1h: null,
        order_request_time: new Date().toISOString(),
        order_cancel_time: null,
      };
      const detail = {
        id: nextScenario.key,
        type: nextScenario.type,
        title: nextScenario.title,
        market: targetMarket,
        behaviorData: nextScenario.behaviorData,
        currentOrder,
        recentOrders: normalizeRecentOrders(
          nextScenario.recentOrders,
          targetMarket,
        ),
        clientAverageBuyAmount:
          nextScenario.behaviorData.client_avg_buy_amount,
        currentPrice,
        marketData: nextScenario.marketData,
        expiresAt: Date.now() + 3 * 60_000,
      };

      const handled = dispatchExtensionEvent(
        "saltbread:demo-scenario",
        detail,
      );

      if (handled) {
        setActiveScenario(nextScenario.key);
        setToast({
          message: `${nextScenario.key}번 · ${nextScenario.title} 시나리오를 실행했습니다.`,
          variant: "success",
        });
      } else {
        setToast({
          message:
            "확장 프로그램이 연결되지 않았습니다. Fireguard를 다시 로드해 주세요.",
          variant: "error",
        });
      }
    },
    [
      market,
      marketData.ticker.trade_price,
      marketData.volatile_market,
    ],
  );

  const runDetectNow = useCallback(() => {
    const handled = dispatchExtensionEvent("saltbread:detect-now");
    setToast({
      message: handled
        ? "8번 · 현재 데이터로 감지 요청을 전달했습니다."
        : "확장 프로그램이 연결되지 않아 감지 요청을 보내지 못했습니다.",
      variant: handled ? "success" : "error",
    });
  }, []);

  const resetDemo = useCallback(() => {
    const resetPrice = marketData.ticker.trade_price;
    const resetVolume = 0.0035;

    setSide("BUY");
    setOrderType("LIMIT");
    setPrice(String(resetPrice));
    setVolume(String(resetVolume));
    setAmount(String(Math.round(resetPrice * resetVolume)));
    setPortfolio(createInitialPortfolio());
    setModal(null);
    previousOrdersRef.current = {};
    const handled = dispatchExtensionEvent("saltbread:demo-reset");
    setActiveScenario(null);
    setToast({
      message: handled
        ? "9번 · 데모 데이터와 감지 상태를 초기화했습니다."
        : "화면은 초기화했지만 확장 프로그램이 연결되지 않았습니다.",
      variant: handled ? "success" : "error",
    });
  }, [marketData.ticker.trade_price]);

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      if (!event.ctrlKey || !event.shiftKey) {
        return;
      }

      const shortcutNumber = event.code.startsWith("Digit")
        ? event.code.replace("Digit", "")
        : event.key;

      if (shortcutNumber === "8") {
        event.preventDefault();
        runDetectNow();
        return;
      }

      if (shortcutNumber === "9") {
        event.preventDefault();
        resetDemo();
        return;
      }

      const selectedScenario = SCENARIOS.find(
        (item) => String(item.key) === shortcutNumber,
      );

      if (!selectedScenario) {
        return;
      }

      event.preventDefault();
      runScenario(selectedScenario);
    };

    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  }, [resetDemo, runDetectNow, runScenario]);

  useEffect(() => {
    if (!toast) {
      return;
    }

    const timeout = window.setTimeout(() => setToast(null), 2800);
    return () => window.clearTimeout(timeout);
  }, [toast]);

  const selectPercentage = (percentage: number) => {
    if (side === "BUY") {
      const nextAmount = Math.floor(
        (portfolio.krw.balance * percentage) / 100 / 1.0005,
      );
      setAmount(String(nextAmount));
      setVolume(
        String(
          Number(
            (nextAmount / Math.max(Number(price), 1)).toFixed(8),
          ),
        ),
      );
      return;
    }

    const availableVolume =
      portfolio.assets[market.split("-")[1]]?.balance || 0;
    const nextVolume = (availableVolume * percentage) / 100;
    setVolume(String(Number(nextVolume.toFixed(8))));
    setAmount(String(Math.round(nextVolume * Math.max(Number(price), 1))));
  };

  const filteredMarkets = useMemo(() => {
    const query = search.trim().toLowerCase();

    if (!query) {
      return marketData.top_markets;
    }

    return marketData.top_markets.filter(
      (item) =>
        item.korean_name.toLowerCase().includes(query) ||
        item.market.toLowerCase().includes(query),
    );
  }, [marketData.top_markets, search]);

  const ticker = marketData.ticker;
  const rise = ticker.signed_change_rate >= 0;
  const coinSymbol = market.split("-")[1] || "BTC";
  const orderUnits = marketData.orderbook?.orderbook_units || [];
  const currentAsset = portfolio.assets[coinSymbol] || {
    balance: 0,
    locked: 0,
    avgBuyPrice: 0,
  };
  const quote = quoteFromPayload(marketData);

  const createDraft = (): OrderDraft => ({
    market,
    side,
    orderType,
    price: Number(price),
    volume: Number(volume),
    amount: Number(amount),
  });

  const requestOrder = () => {
    const draft = createDraft();
    const validation = validateOrder(portfolio, draft, quote);
    addDebugRecord("page", "behavior", "ORDER_INTENT_CLICK", {
      market,
      side,
      orderType,
      price: Number(price) || null,
      volume: Number(volume) || null,
      amount: Number(amount) || null,
      valid: validation.ok,
      occurredAt: new Date().toISOString(),
    });

    if (!validation.ok) {
      setModal({
        type: "notice",
        title: side === "BUY" ? "매수 주문 안내" : "매도 주문 안내",
        message:
          validation.reason === "KRW_SHORTAGE"
            ? "주문 가능 금액이 부족합니다."
            : validation.reason === "ASSET_SHORTAGE"
              ? "주문 가능 수량이 부족합니다."
              : "최소 주문금액은 5,000 KRW입니다.",
      });
      return;
    }

    setModal({ type: "confirm", draft });
  };

  const confirmOrder = () => {
    if (modal?.type !== "confirm") return;
    const result = submitOrder(portfolio, modal.draft, quote);
    setPortfolio(result.portfolio);
    setModal({ type: "receipt", order: result.order });
    setToast({
      message: `${marketData.korean_name} ${side === "BUY" ? "매수" : "매도"} 주문이 접수되었습니다.`,
      variant: "success",
    });
  };

  const cancelOpenOrder = (orderUuid: string) => {
    setPortfolio((current) => cancelOrder(current, orderUuid));
    setToast({ message: "미체결 주문을 취소했습니다.", variant: "success" });
  };

  return (
    <main className="exchange-shell">
      <header className="topbar">
        <div className="topbar__inner">
          <LogoMark />
          <nav aria-label="주 메뉴">
            <button className="is-active">거래소</button>
            <button>입출금</button>
            <button>투자내역</button>
            <button>코인동향</button>
            <button>서비스 더보기⌄</button>
          </nav>
          <div className="topbar__actions">
            <button aria-label="검색">
              <Icon name="search" />
            </button>
            <button aria-label="알림">
              <Icon name="bell" />
            </button>
            <span className="profile-dot">DEMO</span>
          </div>
        </div>
      </header>

      <div className="exchange-layout">
        <section className="market-workspace">
          <div className="market-summary">
            <div className="market-title">
              <span className="coin-emblem">₿</span>
              <div>
                <div>
                  <strong>{marketData.korean_name}</strong>
                  <span>{coinSymbol}/KRW</span>
                </div>
                <small>
                  <i
                    className={`live-dot live-dot--${liveState}`}
                    aria-hidden="true"
                  />
                  {liveState === "live"
                    ? "UPbit API 실시간"
                    : liveState === "loading"
                      ? "시세 연결 중"
                      : "데모 시세"}
                </small>
              </div>
            </div>
            <div className={`hero-price ${rise ? "price-up" : "price-down"}`}>
              <strong>{formatNumber(ticker.trade_price)}</strong>
              <span>KRW</span>
              <small>
                {rise ? "+" : ""}
                {(ticker.signed_change_rate * 100).toFixed(2)}%{" "}
                {rise ? "▲" : "▼"}{" "}
                {formatNumber(Math.abs(ticker.signed_change_price))}
              </small>
            </div>
            <div className="market-stat-grid">
              <div>
                <span>고가</span>
                <strong className="price-up">
                  {formatNumber(ticker.high_price)}
                </strong>
              </div>
              <div>
                <span>거래량(24H)</span>
                <strong>
                  {formatNumber(ticker.acc_trade_volume_24h, 3)}{" "}
                  <em>{coinSymbol}</em>
                </strong>
              </div>
              <div>
                <span>저가</span>
                <strong className="price-down">
                  {formatNumber(ticker.low_price)}
                </strong>
              </div>
              <div>
                <span>거래대금(24H)</span>
                <strong>
                  {compactWon(ticker.acc_trade_price_24h)}{" "}
                  <em>KRW</em>
                </strong>
              </div>
            </div>
            <button className="summary-settings" aria-label="시세 설정">
              <Icon name="settings" />
            </button>
          </div>

          <section className="chart-card">
            <div className="chart-toolbar">
              <div className="timeframes">
                <button>1초</button>
                <button className="is-active">1분</button>
                <button>30분</button>
                <button>1시간</button>
                <button>4시간</button>
                <button>일</button>
                <button>주</button>
              </div>
              <div className="chart-tools" aria-hidden="true">
                <span>♮</span>
                <span>ƒx</span>
                <span>지표</span>
                <span>◫</span>
                <span>◎</span>
              </div>
            </div>
            <div className="chart-caption">
              <strong>{coinSymbol}/KRW · 1분 · UPBIT</strong>
              <span>
                시 {formatNumber(ticker.opening_price)} 고{" "}
                {formatNumber(ticker.high_price)} 저{" "}
                {formatNumber(ticker.low_price)} 종{" "}
                {formatNumber(ticker.trade_price)}
              </span>
            </div>
            <div className="chart-area">
              <div className="drawing-tools" aria-hidden="true">
                <button>＋</button>
                <button>╱</button>
                <button>☷</button>
                <button>⌁</button>
                <button>T</button>
                <button>☺</button>
              </div>
              <Chart candles={marketData.candles} />
              <div className="chart-axis">
                {[ticker.high_price, ticker.trade_price, ticker.low_price].map(
                  (value) => (
                    <span key={value}>{formatNumber(value)}</span>
                  ),
                )}
              </div>
            </div>
            <div className="chart-footer">
              <span>09:30</span>
              <span>10:00</span>
              <span>10:30</span>
              <span>11:00</span>
              <strong>{clock} UTC+9</strong>
            </div>
          </section>

          <div className="trading-grid">
            <section className="orderbook-card">
              <div className="section-tabs">
                <button className="is-active">일반호가</button>
                <button>누적호가</button>
              </div>
              <div className="orderbook-head">
                <span>호가</span>
                <span>잔량({coinSymbol})</span>
              </div>
              <div className="orderbook-list">
                {[...orderUnits].reverse().slice(0, 7).map((unit) => (
                  <div
                    className="orderbook-row ask"
                    data-saltbread-orderbook-price={unit.ask_price}
                    key={`a-${unit.ask_price}`}
                    onClick={() => {
                      setPrice(String(unit.ask_price));
                      addDebugRecord("page", "behavior", "ORDERBOOK_CLICK", {
                        market,
                        price: unit.ask_price,
                        side: "ASK",
                      });
                    }}
                  >
                    <span
                      className="depth"
                      style={{
                        width: `${Math.min(72, 8 + unit.ask_size * 42)}%`,
                      }}
                    />
                    <strong>{formatNumber(unit.ask_price)}</strong>
                    <em>{formatNumber(unit.ask_size, 6)}</em>
                  </div>
                ))}
                {orderUnits.slice(0, 7).map((unit) => (
                  <div
                    className="orderbook-row bid"
                    data-saltbread-orderbook-price={unit.bid_price}
                    key={`b-${unit.bid_price}`}
                    onClick={() => {
                      setPrice(String(unit.bid_price));
                      addDebugRecord("page", "behavior", "ORDERBOOK_CLICK", {
                        market,
                        price: unit.bid_price,
                        side: "BID",
                      });
                    }}
                  >
                    <span
                      className="depth"
                      style={{
                        width: `${Math.min(72, 8 + unit.bid_size * 42)}%`,
                      }}
                    />
                    <strong>{formatNumber(unit.bid_price)}</strong>
                    <em>{formatNumber(unit.bid_size, 6)}</em>
                  </div>
                ))}
              </div>
            </section>

            <section
              className={`order-panel ${side === "BUY" ? "buy-mode" : "sell-mode"}`}
              aria-label="주문"
              data-saltbread-order-panel
            >
              <div className="order-side-tabs" role="tablist">
                <button
                  type="button"
                  role="tab"
                  aria-selected={side === "BUY"}
                  className={side === "BUY" ? "active selected" : ""}
                  onClick={() => setSide("BUY")}
                >
                  매수
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={side === "SELL"}
                  className={side === "SELL" ? "active selected" : ""}
                  onClick={() => setSide("SELL")}
                >
                  매도
                </button>
              </div>

              <div className="order-balance">
                <span>주문가능</span>
                <strong>
                  {side === "BUY"
                    ? `${formatNumber(portfolio.krw.balance, 0)} KRW`
                    : `${formatNumber(currentAsset.balance, 8)} ${coinSymbol}`}
                </strong>
              </div>

              <div className="order-type-tabs" role="tablist">
                <button
                  type="button"
                  role="tab"
                  aria-selected={orderType === "LIMIT"}
                  className={orderType === "LIMIT" ? "active selected" : ""}
                  onClick={() => setOrderType("LIMIT")}
                >
                  지정가
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={orderType === "MARKET"}
                  className={orderType === "MARKET" ? "active selected" : ""}
                  onClick={() => setOrderType("MARKET")}
                >
                  시장가
                </button>
              </div>

              <label className="order-field">
                <span>{side === "BUY" ? "매수가격" : "매도가격"} (KRW)</span>
                <div>
                  <input
                    aria-label={side === "BUY" ? "매수가격" : "매도가격"}
                    inputMode="numeric"
                    value={orderType === "MARKET" ? "" : price}
                    placeholder={orderType === "MARKET" ? "시장가" : "0"}
                    disabled={orderType === "MARKET"}
                    onChange={(event) => {
                      const nextPrice = event.target.value.replace(
                        /[^\d.]/g,
                        "",
                      );
                      setPrice(nextPrice);
                      setAmount(
                        String(
                          Math.round(
                            Number(nextPrice) * (Number(volume) || 0),
                          ),
                        ),
                      );
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => {
                      const nextPrice = Math.max(0, Number(price) - 1000);
                      setPrice(String(nextPrice));
                      setAmount(
                        String(Math.round(nextPrice * (Number(volume) || 0))),
                      );
                    }}
                  >
                    −
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const nextPrice = Number(price) + 1000;
                      setPrice(String(nextPrice));
                      setAmount(
                        String(Math.round(nextPrice * (Number(volume) || 0))),
                      );
                    }}
                  >
                    ＋
                  </button>
                </div>
              </label>

              <label className="order-field">
                <span>주문수량 ({coinSymbol})</span>
                <div>
                  <input
                    aria-label="주문수량"
                    inputMode="decimal"
                    value={volume}
                    onChange={(event) => {
                      const nextVolume = event.target.value.replace(
                        /[^\d.]/g,
                        "",
                      );
                      setVolume(nextVolume);

                      if (orderType === "LIMIT") {
                        setAmount(
                          String(
                            Math.round(
                              Number(price) * (Number(nextVolume) || 0),
                            ),
                          ),
                        );
                      }
                    }}
                  />
                  <em>{coinSymbol}</em>
                </div>
              </label>

              <div className="percentage-buttons">
                {[10, 25, 50].map((percentage) => (
                  <button
                    type="button"
                    key={percentage}
                    onClick={() => selectPercentage(percentage)}
                  >
                    {percentage}%
                  </button>
                ))}
                <button type="button" onClick={() => selectPercentage(100)}>
                  최대
                </button>
              </div>

              <label className="order-field total-field">
                <span>주문총액 (KRW)</span>
                <div>
                  <input
                    aria-label="주문총액"
                    inputMode="numeric"
                    value={amount}
                    onChange={(event) =>
                      setAmount(event.target.value.replace(/[^\d]/g, ""))
                    }
                  />
                  <em>KRW</em>
                </div>
              </label>

              <button
                ref={orderButtonRef}
                type="button"
                className="order-submit"
                data-saltbread-order-action={side}
                onClick={requestOrder}
              >
                {side === "BUY" ? "매수하기" : "매도하기"}
              </button>
              <p className="order-note">
                가상 자산 주문입니다. 실제 거래소 주문은 발생하지 않습니다.
              </p>
            </section>
          </div>

          <section className="demo-orders">
            <div className="demo-orders__heading">
              <div>
                <span>DEMO ACCOUNT</span>
                <strong>가상 자산 · 주문내역</strong>
              </div>
              <p>
                총 평가금{" "}
                <b>
                  {formatNumber(
                    portfolio.krw.balance +
                      portfolio.krw.locked +
                      Object.entries(portfolio.assets).reduce(
                        (sum, [symbol, asset]) => {
                          const item = marketData.top_markets.find(
                            (candidate) =>
                              candidate.market === `KRW-${symbol}`,
                          );
                          return (
                            sum +
                            (asset.balance + asset.locked) *
                              (item?.trade_price ||
                                (symbol === coinSymbol
                                  ? ticker.trade_price
                                  : asset.avgBuyPrice))
                          );
                        },
                        0,
                      ),
                  )}{" "}
                  KRW
                </b>
              </p>
            </div>
            <div className="demo-assets">
              <article>
                <span>KRW</span>
                <strong>{formatNumber(portfolio.krw.balance)} KRW</strong>
                <em>주문 중 {formatNumber(portfolio.krw.locked)} KRW</em>
              </article>
              {Object.entries(portfolio.assets).map(([symbol, asset]) => (
                <article key={symbol}>
                  <span>{symbol}</span>
                  <strong>{formatNumber(asset.balance, 8)}</strong>
                  <em>평균 매수가 {formatNumber(asset.avgBuyPrice)} KRW</em>
                </article>
              ))}
            </div>
            <div className="demo-order-list">
              {portfolio.orders.length === 0 ? (
                <p>아직 주문내역이 없습니다.</p>
              ) : (
                portfolio.orders.map((order) => (
                  <article key={order.uuid}>
                    <div>
                      <strong>
                        {order.market} · {order.side === "bid" ? "매수" : "매도"}
                      </strong>
                      <span>{order.ord_type.toUpperCase()}</span>
                    </div>
                    <div>
                      <b>{order.state}</b>
                      <span>
                        체결 {order.executed_volume} / 잔량{" "}
                        {order.remaining_volume}
                      </span>
                    </div>
                    {["wait", "trade"].includes(order.state) && (
                      <button
                        type="button"
                        onClick={() => cancelOpenOrder(order.uuid)}
                      >
                        주문 취소
                      </button>
                    )}
                  </article>
                ))
              )}
            </div>
          </section>
        </section>

        <aside className="market-sidebar">
          <div className="market-search">
            <Icon name="search" />
            <input
              aria-label="코인명 또는 심볼 검색"
              placeholder="코인명/심볼 검색"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>
          <div className="quote-tabs">
            <button className="is-active">원화</button>
            <button>BTC</button>
            <button>USDT</button>
          </div>
          <div className="market-list-head">
            <span>한글명</span>
            <span>현재가</span>
            <span>전일대비</span>
          </div>
          <div className="market-list">
            {filteredMarkets.map((item) => {
              const itemRise = item.signed_change_rate >= 0;

              return (
                <button
                  type="button"
                  key={item.market}
                  className={item.market === market ? "is-selected" : ""}
                  onClick={() => chooseMarket(item.market)}
                >
                  <span className="star">☆</span>
                  <span className="market-name">
                    <strong>
                      {item.korean_name}
                      {item.has_warning_badge && <i>주의</i>}
                    </strong>
                    <em>{item.market.replace("KRW-", "")}/KRW</em>
                  </span>
                  <strong className={itemRise ? "price-up" : "price-down"}>
                    {formatNumber(item.trade_price, 4)}
                  </strong>
                  <em className={itemRise ? "price-up" : "price-down"}>
                    {itemRise ? "+" : ""}
                    {(item.signed_change_rate * 100).toFixed(2)}%
                  </em>
                </button>
              );
            })}
          </div>

          <section className="demo-console">
            <div className="demo-console__heading">
              <div>
                <span>DEMO CONTROLLER</span>
                <strong>감정 매매 시나리오</strong>
              </div>
              <kbd>Ctrl</kbd>
              <b>+</b>
              <kbd>Shift</kbd>
              <b>+</b>
              <kbd>1–9</kbd>
            </div>
            <p>
              1–7은 시나리오, 8은 즉시 감지, 9는 초기화입니다.
            </p>
            <div className="scenario-list">
              {SCENARIOS.map((item) => (
                <button
                  type="button"
                  key={item.key}
                  className={activeScenario === item.key ? "is-active" : ""}
                  onClick={() => runScenario(item)}
                >
                  <kbd>{item.key}</kbd>
                  <span>
                    <strong>{item.title}</strong>
                    <em>{item.type}</em>
                  </span>
                </button>
              ))}
            </div>
            <div className="demo-action-list">
              <button type="button" onClick={runDetectNow}>
                <kbd>8</kbd>
                <span>
                  <strong>지금 감지 실행</strong>
                  <em>DETECT_NOW</em>
                </span>
              </button>
              <button type="button" onClick={resetDemo}>
                <kbd>9</kbd>
                <span>
                  <strong>데모 초기화</strong>
                  <em>RESET</em>
                </span>
              </button>
            </div>
            <div className="demo-current">
              <span>API 전용 데모</span>
              <strong>화면 입력값은 변경되지 않습니다</strong>
              <p>1–7 선택 시 시나리오 데이터만 감지 API로 전송합니다.</p>
            </div>
          </section>
        </aside>
      </div>

      <RawDebugPanel
        records={debugRecords}
        extensionConnected={extensionConnected}
        onClear={() => setDebugRecords([])}
      />

      {modal && (
        <div
          className="demo-modal-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setModal(null);
          }}
        >
          <section
            className="demo-modal"
            role="dialog"
            aria-modal="true"
            aria-label={
              modal.type === "confirm"
                ? `${side === "BUY" ? "매수" : "매도"}주문 확인`
                : modal.type === "notice"
                  ? modal.title
                  : `${side === "BUY" ? "매수" : "매도"}주문 접수`
            }
          >
            {modal.type === "confirm" && (
              <>
                <span className="demo-modal__eyebrow">주문 확인</span>
                <h2>{side === "BUY" ? "매수주문 확인" : "매도주문 확인"}</h2>
                <dl>
                  <div>
                    <dt>주문유형</dt>
                    <dd>
                      {modal.draft.orderType === "MARKET"
                        ? `시장가 ${side === "BUY" ? "매수" : "매도"}`
                        : `지정가 ${side === "BUY" ? "매수" : "매도"}`}
                    </dd>
                  </div>
                  <div>
                    <dt>마켓</dt>
                    <dd>
                      {coinSymbol}/KRW
                    </dd>
                  </div>
                  <div>
                    <dt>{side === "BUY" ? "총액" : "주문수량"}</dt>
                    <dd>
                      {side === "BUY"
                        ? `${formatNumber(modal.draft.amount)} KRW`
                        : `${formatNumber(modal.draft.volume, 8)} ${coinSymbol}`}
                    </dd>
                  </div>
                </dl>
                <div className="demo-modal__actions">
                  <button type="button" onClick={() => setModal(null)}>
                    취소
                  </button>
                  <button
                    type="button"
                    className={side === "BUY" ? "is-buy" : "is-sell"}
                    data-saltbread-order-confirm={side}
                    onClick={confirmOrder}
                  >
                    {side === "BUY" ? "매수 확인" : "매도 확인"}
                  </button>
                </div>
              </>
            )}

            {modal.type === "notice" && (
              <>
                <span className="demo-modal__eyebrow">주문 안내</span>
                <h2>{modal.title}</h2>
                <p className="demo-modal__message">{modal.message}</p>
                <div className="demo-modal__actions">
                  <button
                    type="button"
                    className="is-primary"
                    onClick={() => setModal(null)}
                  >
                    확인
                  </button>
                </div>
              </>
            )}

            {modal.type === "receipt" && (
              <>
                <span className="demo-modal__eyebrow">주문 접수</span>
                <h2>
                  {modal.order.side === "bid" ? "매수주문" : "매도주문"}이
                  정상 접수되었습니다.
                </h2>
                <p className="demo-modal__uuid">{modal.order.uuid}</p>
                <dl>
                  <div>
                    <dt>주문 상태</dt>
                    <dd>{modal.order.state}</dd>
                  </div>
                  <div>
                    <dt>체결수량</dt>
                    <dd>{modal.order.executed_volume}</dd>
                  </div>
                </dl>
                <div className="demo-modal__actions">
                  <button
                    type="button"
                    className="is-primary"
                    onClick={() => setModal(null)}
                  >
                    확인
                  </button>
                </div>
              </>
            )}
          </section>
        </div>
      )}

      {toast && (
        <div
          className={`trade-toast ${toast.variant === "error" ? "is-error" : ""}`}
          role={toast.variant === "error" ? "alert" : "status"}
        >
          <span>{toast.variant === "error" ? "!" : "✓"}</span>
          {toast.message}
        </div>
      )}
    </main>
  );
}
