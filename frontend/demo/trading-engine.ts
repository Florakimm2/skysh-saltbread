export const INITIAL_KRW_BALANCE = 10_000_000;
export const MIN_ORDER_TOTAL = 5_000;
export const TRADING_FEE_RATE = 0.0005;

export type DemoOrderSide = "BUY" | "SELL";
export type DemoOrderType = "LIMIT" | "MARKET";
export type DemoOrderState = "wait" | "trade" | "done" | "cancel";

export type DemoAsset = {
  balance: number;
  locked: number;
  avgBuyPrice: number;
};

export type DemoOrder = {
  uuid: string;
  market: string;
  side: "bid" | "ask";
  ord_type: "limit" | "price" | "market";
  state: DemoOrderState;
  price: string | null;
  volume: string | null;
  remaining_volume: string;
  executed_volume: string;
  executed_funds: string;
  paid_fee: string;
  created_at: string;
  locked_funds: string;
};

export type DemoPortfolio = {
  krw: {
    balance: number;
    locked: number;
  };
  assets: Record<string, DemoAsset>;
  orders: DemoOrder[];
};

export type OrderDraft = {
  market: string;
  side: DemoOrderSide;
  orderType: DemoOrderType;
  price: number;
  volume: number;
  amount: number;
};

export type Quote = {
  bestAsk: number;
  bestBid: number;
  askSize: number;
  bidSize: number;
};

export type ValidationResult =
  | { ok: true; total: number }
  | { ok: false; reason: "MIN_TOTAL" | "KRW_SHORTAGE" | "ASSET_SHORTAGE" };

function decimal(value: number, fractionDigits = 8) {
  if (!Number.isFinite(value)) return "0";
  return value.toFixed(fractionDigits).replace(/\.?0+$/, "") || "0";
}

function assetSymbol(market: string) {
  return market.split("-")[1] || market;
}

function getAsset(portfolio: DemoPortfolio, market: string): DemoAsset {
  return (
    portfolio.assets[assetSymbol(market)] || {
      balance: 0,
      locked: 0,
      avgBuyPrice: 0,
    }
  );
}

function orderTotal(draft: OrderDraft, quote: Quote) {
  if (draft.side === "BUY" && draft.orderType === "MARKET") {
    return draft.amount;
  }

  const price =
    draft.orderType === "MARKET"
      ? draft.side === "BUY"
        ? quote.bestAsk
        : quote.bestBid
      : draft.price;
  return price * draft.volume;
}

export function createInitialPortfolio(): DemoPortfolio {
  return {
    krw: { balance: INITIAL_KRW_BALANCE, locked: 0 },
    assets: {},
    orders: [],
  };
}

export function validateOrder(
  portfolio: DemoPortfolio,
  draft: OrderDraft,
  quote: Quote,
): ValidationResult {
  const total = orderTotal(draft, quote);

  if (
    !Number.isFinite(total) ||
    total < MIN_ORDER_TOTAL ||
    (draft.side === "SELL" && (!draft.volume || draft.volume <= 0))
  ) {
    return { ok: false, reason: "MIN_TOTAL" };
  }

  if (
    draft.side === "BUY" &&
    portfolio.krw.balance + Number.EPSILON <
      total * (1 + TRADING_FEE_RATE)
  ) {
    return { ok: false, reason: "KRW_SHORTAGE" };
  }

  if (
    draft.side === "SELL" &&
    getAsset(portfolio, draft.market).balance + Number.EPSILON < draft.volume
  ) {
    return { ok: false, reason: "ASSET_SHORTAGE" };
  }

  return { ok: true, total };
}

function shouldRest(draft: OrderDraft, quote: Quote) {
  if (draft.orderType === "MARKET") return false;
  return draft.side === "BUY"
    ? draft.price < quote.bestAsk
    : draft.price > quote.bestBid;
}

function applyFill(
  portfolio: DemoPortfolio,
  order: DemoOrder,
  fillVolume: number,
  fillPrice: number,
): DemoPortfolio {
  const symbol = assetSymbol(order.market);
  const previousAsset = getAsset(portfolio, order.market);
  const previousExecutedVolume = Number(order.executed_volume);
  const previousExecutedFunds = Number(order.executed_funds);
  const previousFee = Number(order.paid_fee);
  const previousRemaining = Number(order.remaining_volume);
  const funds = fillVolume * fillPrice;
  const fee = funds * TRADING_FEE_RATE;
  const nextRemaining = Math.max(0, previousRemaining - fillVolume);
  const nextState: DemoOrderState = nextRemaining <= 1e-12 ? "done" : "trade";
  const isLocked = Number(order.locked_funds) > 0 || previousAsset.locked > 0;
  const nextKrw = { ...portfolio.krw };
  let nextAsset = { ...previousAsset };
  let nextLockedFunds = Number(order.locked_funds);

  if (order.side === "bid") {
    const previousCostBasis =
      previousAsset.avgBuyPrice *
      (previousAsset.balance + (isLocked ? 0 : 0));

    if (isLocked) {
      const limitPrice = Number(order.price) || fillPrice;
      const reservedForFill =
        fillVolume * limitPrice * (1 + TRADING_FEE_RATE);
      nextKrw.locked = Math.max(0, nextKrw.locked - reservedForFill);
      nextKrw.balance += Math.max(0, reservedForFill - funds - fee);
      nextLockedFunds = Math.max(0, nextLockedFunds - reservedForFill);
    } else {
      nextKrw.balance -= funds + fee;
    }

    const nextBalance = previousAsset.balance + fillVolume;
    nextAsset = {
      ...previousAsset,
      balance: nextBalance,
      avgBuyPrice:
        nextBalance > 0
          ? (previousCostBasis + funds) / nextBalance
          : previousAsset.avgBuyPrice,
    };
  } else {
    if (isLocked) {
      nextAsset.locked = Math.max(0, nextAsset.locked - fillVolume);
    } else {
      nextAsset.balance = Math.max(0, nextAsset.balance - fillVolume);
    }
    nextKrw.balance += funds - fee;
  }

  if (nextState === "done" && nextLockedFunds > 0) {
    nextKrw.locked = Math.max(0, nextKrw.locked - nextLockedFunds);
    nextKrw.balance += nextLockedFunds;
    nextLockedFunds = 0;
  }

  const nextOrder: DemoOrder = {
    ...order,
    state: nextState,
    remaining_volume: decimal(nextRemaining),
    executed_volume: decimal(previousExecutedVolume + fillVolume),
    executed_funds: decimal(previousExecutedFunds + funds, 4),
    paid_fee: decimal(previousFee + fee, 4),
    locked_funds: decimal(nextLockedFunds, 4),
  };

  return {
    krw: nextKrw,
    assets: { ...portfolio.assets, [symbol]: nextAsset },
    orders: portfolio.orders.map((item) =>
      item.uuid === order.uuid ? nextOrder : item,
    ),
  };
}

export function submitOrder(
  portfolio: DemoPortfolio,
  draft: OrderDraft,
  quote: Quote,
): { portfolio: DemoPortfolio; order: DemoOrder } {
  const total = orderTotal(draft, quote);
  const executionPrice =
    draft.orderType === "MARKET"
      ? draft.side === "BUY"
        ? quote.bestAsk
        : quote.bestBid
      : draft.price;
  const requestedVolume =
    draft.side === "BUY" && draft.orderType === "MARKET"
      ? total / executionPrice
      : draft.volume;
  const resting = shouldRest(draft, quote);
  const reservedFunds =
    resting && draft.side === "BUY"
      ? total * (1 + TRADING_FEE_RATE)
      : 0;
  const order: DemoOrder = {
    uuid: crypto.randomUUID(),
    market: draft.market,
    side: draft.side === "BUY" ? "bid" : "ask",
    ord_type:
      draft.orderType === "LIMIT"
        ? "limit"
        : draft.side === "BUY"
          ? "price"
          : "market",
    state: "wait",
    price:
      draft.orderType === "LIMIT"
        ? decimal(draft.price, 4)
        : draft.side === "BUY"
          ? decimal(total, 4)
          : null,
    volume:
      draft.side === "BUY" && draft.orderType === "MARKET"
        ? null
        : decimal(requestedVolume),
    remaining_volume: decimal(requestedVolume),
    executed_volume: "0",
    executed_funds: "0",
    paid_fee: "0",
    created_at: new Date().toISOString(),
    locked_funds: decimal(reservedFunds, 4),
  };
  const symbol = assetSymbol(draft.market);
  let nextPortfolio: DemoPortfolio = {
    ...portfolio,
    orders: [order, ...portfolio.orders],
  };

  if (resting) {
    if (draft.side === "BUY") {
      nextPortfolio = {
        ...nextPortfolio,
        krw: {
          balance: portfolio.krw.balance - reservedFunds,
          locked: portfolio.krw.locked + reservedFunds,
        },
      };
    } else {
      const asset = getAsset(portfolio, draft.market);
      nextPortfolio = {
        ...nextPortfolio,
        assets: {
          ...portfolio.assets,
          [symbol]: {
            ...asset,
            balance: asset.balance - requestedVolume,
            locked: asset.locked + requestedVolume,
          },
        },
      };
    }

    return { portfolio: nextPortfolio, order };
  }

  const filled = applyFill(
    nextPortfolio,
    order,
    requestedVolume,
    executionPrice,
  );
  return {
    portfolio: filled,
    order: filled.orders.find((item) => item.uuid === order.uuid) || order,
  };
}

export function settleOpenOrders(
  portfolio: DemoPortfolio,
  market: string,
  quote: Quote,
): DemoPortfolio {
  let next = portfolio;
  const candidates = portfolio.orders.filter(
    (order) =>
      order.market === market &&
      ["wait", "trade"].includes(order.state) &&
      order.ord_type === "limit" &&
      (order.side === "bid"
        ? Number(order.price) >= quote.bestAsk
        : Number(order.price) <= quote.bestBid),
  );

  for (const candidate of candidates) {
    const current =
      next.orders.find((order) => order.uuid === candidate.uuid) || candidate;
    const remaining = Number(current.remaining_volume);
    const availableSize =
      current.side === "bid" ? quote.askSize : quote.bidSize;
    const fillVolume = Math.min(
      remaining,
      availableSize > 0 ? availableSize : remaining,
    );
    next = applyFill(
      next,
      current,
      fillVolume,
      current.side === "bid" ? quote.bestAsk : quote.bestBid,
    );
  }

  return next;
}

export function cancelOrder(
  portfolio: DemoPortfolio,
  orderUuid: string,
): DemoPortfolio {
  const order = portfolio.orders.find((item) => item.uuid === orderUuid);
  if (!order || !["wait", "trade"].includes(order.state)) return portfolio;

  const symbol = assetSymbol(order.market);
  const asset = getAsset(portfolio, order.market);
  const remaining = Number(order.remaining_volume);
  const lockedFunds = Number(order.locked_funds);
  const krw =
    order.side === "bid"
      ? {
          balance: portfolio.krw.balance + lockedFunds,
          locked: Math.max(0, portfolio.krw.locked - lockedFunds),
        }
      : portfolio.krw;
  const assets =
    order.side === "ask"
      ? {
          ...portfolio.assets,
          [symbol]: {
            ...asset,
            balance: asset.balance + remaining,
            locked: Math.max(0, asset.locked - remaining),
          },
        }
      : portfolio.assets;

  return {
    krw,
    assets,
    orders: portfolio.orders.map((item) =>
      item.uuid === orderUuid
        ? { ...item, state: "cancel", locked_funds: "0" }
        : item,
    ),
  };
}

export function toUpbitAccounts(portfolio: DemoPortfolio) {
  return [
    {
      currency: "KRW",
      balance: decimal(portfolio.krw.balance, 4),
      locked: decimal(portfolio.krw.locked, 4),
      avg_buy_price: "0",
      avg_buy_price_modified: false,
      unit_currency: "KRW",
    },
    ...Object.entries(portfolio.assets).map(([currency, asset]) => ({
      currency,
      balance: decimal(asset.balance),
      locked: decimal(asset.locked),
      avg_buy_price: decimal(asset.avgBuyPrice, 4),
      avg_buy_price_modified: false,
      unit_currency: "KRW",
    })),
  ];
}
