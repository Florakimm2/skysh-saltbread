(function initializeSaltbreadCore(globalScope) {
  const MINUTE_MS = 60_000;

  function toNumber(value) {
    if (typeof value === "number") {
      return Number.isFinite(value) ? value : null;
    }

    if (typeof value !== "string") {
      return null;
    }

    const normalized = value.replaceAll(",", "").replace(/[^\d.-]/g, "");
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : null;
  }

  function parseMarket(url) {
    try {
      const parsedUrl = new URL(url);
      const candidates = [
        parsedUrl.searchParams.get("code"),
        parsedUrl.searchParams.get("market"),
        parsedUrl.pathname,
        parsedUrl.hash,
      ].filter(Boolean);

      for (const candidate of candidates) {
        const match = candidate.match(/(?:CRIX\.UPBIT\.)?((?:KRW|BTC|USDT)-[A-Z0-9]+)/i);

        if (match) {
          return match[1].toUpperCase();
        }
      }
    } catch {
      return null;
    }

    return null;
  }

  function pruneTimestamps(timestamps, windowMs, now = Date.now()) {
    return timestamps.filter(
      (timestamp) => timestamp <= now && timestamp >= now - windowMs,
    );
  }

  function candleTime(candle) {
    const raw =
      candle.candle_date_time_utc ||
      candle.candle_date_time_kst ||
      candle.timestamp;

    if (typeof raw === "number") {
      return raw;
    }

    if (!raw) {
      return 0;
    }

    const isUtc = candle.candle_date_time_utc === raw;
    return Date.parse(`${raw}${isUtc && !/[z+-]\d*$/i.test(raw) ? "Z" : ""}`);
  }

  function calculateMarketData({
    market,
    candles,
    tickers,
    marketDetails,
    now = Date.now(),
  }) {
    const sortedCandles = [...candles].sort(
      (left, right) => candleTime(right) - candleTime(left),
    );
    const currentTicker = tickers.find((ticker) => ticker.market === market);
    const currentPrice =
      toNumber(currentTicker?.trade_price) ??
      toNumber(sortedCandles[0]?.trade_price) ??
      0;
    const referenceThreshold = now - 15 * MINUTE_MS;
    const referenceCandle =
      sortedCandles.find((candle) => candleTime(candle) <= referenceThreshold) ||
      sortedCandles.at(-1);
    const referencePrice =
      toNumber(referenceCandle?.trade_price) ??
      toNumber(referenceCandle?.opening_price);
    const priceChangeRate15m =
      referencePrice && currentPrice
        ? ((currentPrice - referencePrice) / referencePrice) * 100
        : 0;

    const completedCandles = sortedCandles.filter(
      (candle) => candleTime(candle) + MINUTE_MS <= now,
    );
    const volumeCandles =
      completedCandles.length >= 2 ? completedCandles : sortedCandles;
    const latestVolume = toNumber(volumeCandles[0]?.candle_acc_trade_volume) ?? 0;
    const previousVolumes = volumeCandles
      .slice(1, 11)
      .map((candle) => toNumber(candle.candle_acc_trade_volume))
      .filter((volume) => volume !== null);
    const averagePreviousVolume =
      previousVolumes.length > 0
        ? previousVolumes.reduce((sum, volume) => sum + volume, 0) /
          previousVolumes.length
        : 0;
    const volumeChangeRate1m =
      averagePreviousVolume > 0
        ? ((latestVolume - averagePreviousVolume) / averagePreviousVolume) * 100
        : 0;

    const topThreeMarkets = [...tickers]
      .sort(
        (left, right) =>
          Math.abs(toNumber(right.signed_change_rate) ?? 0) -
          Math.abs(toNumber(left.signed_change_rate) ?? 0),
      )
      .slice(0, 3)
      .map((ticker) => ticker.market);
    const marketDetail = marketDetails.find(
      (detail) => detail.market === market,
    );
    const cautionValues = Object.values(
      marketDetail?.market_event?.caution || {},
    );
    const hasWarningBadge = Boolean(
      marketDetail?.market_event?.warning ||
        cautionValues.some((value) => value === true),
    );

    return {
      current_price: currentPrice,
      market_data: {
        price_change_rate_15m: Number(priceChangeRate15m.toFixed(4)),
        volume_change_rate_1m: Number(volumeChangeRate1m.toFixed(4)),
        is_top3_volatility: topThreeMarkets.includes(market),
        has_warning_badge: hasWarningBadge,
      },
    };
  }

  function mapOrderStatus(state) {
    if (state === "done") {
      return "DONE";
    }

    if (state === "cancel" || state === "prevented") {
      return "CANCEL";
    }

    return "WAIT";
  }

  function mapOrderType(orderType) {
    return orderType === "limit" || orderType === "best" ? "LIMIT" : "MARKET";
  }

  function mapOrderSide(side) {
    return String(side).toLowerCase() === "ask" ? "SELL" : "BUY";
  }

  function mapUpbitOrder(order, averageBuyPrices = {}) {
    const side = mapOrderSide(order.side);
    const executedVolume = toNumber(order.executed_volume) ?? 0;
    const executedFunds = toNumber(order.executed_funds) ?? 0;
    const requestedPrice = toNumber(order.price);
    const requestedVolume = toNumber(order.volume);
    const averageFillPrice =
      executedVolume > 0 ? executedFunds / executedVolume : null;
    const marketCurrency = String(order.market || "").split("-")[1];
    const averageBuyPrice = toNumber(averageBuyPrices[marketCurrency]);
    const realizedLoss =
      side === "SELL" && averageBuyPrice && averageFillPrice
        ? Math.max(
            0,
            ((averageBuyPrice - averageFillPrice) / averageBuyPrice) * 100,
          )
        : null;
    const isLimit = mapOrderType(order.ord_type) === "LIMIT";
    const amount =
      executedFunds ||
      (side === "BUY" && !isLimit ? requestedPrice : 0) ||
      (requestedPrice && requestedVolume
        ? requestedPrice * requestedVolume
        : null);

    return {
      market: order.market,
      order_side: side,
      order_status: mapOrderStatus(order.state),
      order_type: mapOrderType(order.ord_type),
      order_price: isLimit ? requestedPrice : null,
      order_volume: requestedVolume ?? (executedVolume || null),
      order_amount: amount,
      realized_loss_pct_1h:
        realizedLoss === null ? null : Number(realizedLoss.toFixed(4)),
      order_request_time: order.created_at,
      order_cancel_time: null,
    };
  }

  function calculateAverageBuyAmount(orders, limit = 10) {
    const amounts = orders
      .filter((order) => mapOrderSide(order.side) === "BUY")
      .map((order) => toNumber(order.executed_funds))
      .filter((amount) => amount !== null && amount > 0)
      .slice(0, limit);

    if (amounts.length === 0) {
      return null;
    }

    return amounts.reduce((sum, amount) => sum + amount, 0) / amounts.length;
  }

  function resolveFlameMode(detection, orderSide) {
    if (!detection?.detected) {
      return "default";
    }

    if (
      ["REVENGE_TRADING", "HESITATION"].includes(detection.type)
    ) {
      return "blue";
    }

    return String(orderSide).toUpperCase() === "SELL" ? "blue" : "pink";
  }

  function buildBehaviorSnapshot(state, now = Date.now()) {
    const currentMarket = state.market;
    const buyClicks = pruneTimestamps(
      state.buyClicksByMarket[currentMarket] || [],
      MINUTE_MS,
      now,
    );
    const edits = pruneTimestamps(state.inputEditTimestamps, 3 * MINUTE_MS, now);
    const visibleDuration =
      state.visibleDurationMs +
      (state.visibleSince ? Math.max(0, now - state.visibleSince) : 0);

    return {
      is_max_button_clicked: Boolean(state.maxClickedSinceLastOrder),
      client_avg_buy_amount: state.clientAvgBuyAmount ?? null,
      buy_click_count_1m: buyClicks.length,
      input_edit_count: edits.length,
      page_stay_duration: Number((visibleDuration / 1000).toFixed(2)),
    };
  }

  const api = {
    MINUTE_MS,
    buildBehaviorSnapshot,
    calculateAverageBuyAmount,
    calculateMarketData,
    mapOrderSide,
    mapOrderStatus,
    mapOrderType,
    mapUpbitOrder,
    parseMarket,
    pruneTimestamps,
    resolveFlameMode,
    toNumber,
  };

  globalScope.SaltbreadCore = api;

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(typeof globalThis === "undefined" ? this : globalThis);
