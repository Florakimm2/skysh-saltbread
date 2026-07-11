// backend/modules/ext/detect/service.ts

import type {
    DetectEmotionTradeRequest,
    DetectEmotionTradeResponse,
    DetectionCandidate,
    EmotionTradeType,
  } from "./types";
  
  const MESSAGE_BY_TYPE: Record<EmotionTradeType, string> = {
    FOMO_CHASING:
      "급등 중인 종목에 빠르게 진입하려 하고 있어요. 추격 매수인지 다시 확인해 보세요.",
  
    REVENGE_TRADING:
      "최근 손실 직후 다시 매수를 시도하고 있어요. 정한 재진입 기준에 맞는지 확인해 보세요.",
  
    HESITATION:
      "주문 가격이나 금액을 반복해서 수정하고 있어요. 잠시 멈추고 주문 조건을 다시 확인해 보세요.",
  
    ALL_IN_IMPULSE:
      "최대 금액 매수를 시도하고 있어요. 한 번에 너무 큰 비중이 아닌지 확인해 보세요.",
  
    AMOUNT_SPIKE:
      "현재 주문 금액이 평소 평균 매수 금액보다 크게 높습니다.",
  
    MACHINE_GUN_TRADING:
      "짧은 시간 동안 시장가 매수를 반복하고 있어요. 분할 매수 계획을 다시 확인해 보세요.",
  
    HIGH_RISK_HOPPING:
      "변동성이 높거나 주의 표시가 있는 종목에 빠르게 진입하려 하고 있어요.",
  };

  const RULE_ID_BY_TYPE: Record<EmotionTradeType, string> = {
    FOMO_CHASING: "CHASE_BUY_V1",
    ALL_IN_IMPULSE: "HIGH_ALLOCATION_V1",
    REVENGE_TRADING: "REVENGE_TRADING_V1",
    HESITATION: "HESITATION_V1",
    AMOUNT_SPIKE: "AMOUNT_SPIKE_V1",
    MACHINE_GUN_TRADING: "MACHINE_GUN_TRADING_V1",
    HIGH_RISK_HOPPING: "HIGH_RISK_HOPPING_V1",
  };
  
  const RULE = {
    FOMO_PRICE_CHANGE_RATE_15M: 5,
    FOMO_VOLUME_CHANGE_RATE_1M: 300,
    FAST_ENTRY_SECONDS: 180,
  
    REVENGE_LOSS_PCT: 3,
    REVENGE_REENTRY_MINUTES: 15,
  
    HESITATION_INPUT_EDIT_COUNT: 4,
    CANCEL_REPEAT_COUNT_5M: 3,
    CANCEL_REPEAT_WINDOW_MINUTES: 5,
  
    ORDERBOOK_CHASING_COUNT: 2,
    ORDERBOOK_CHASING_WINDOW_MINUTES: 1,
  
    AMOUNT_SPIKE_MULTIPLIER: 3,
  
    MACHINE_GUN_BUY_CLICK_COUNT_1M: 3,
  
    HIGH_RISK_HOPPING_STAY_SECONDS: 30,
  };
  
  function toTimeMs(value: string | null): number | null {
    if (!value) return null;
  
    const ms = new Date(value).getTime();
    return Number.isNaN(ms) ? null : ms;
  }
  
  function diffMinutes(laterTime: string, earlierTime: string | null): number | null {
    const laterMs = toTimeMs(laterTime);
    const earlierMs = toTimeMs(earlierTime);
  
    if (laterMs === null || earlierMs === null) return null;
  
    return (laterMs - earlierMs) / 1000 / 60;
  }
  
  function isWithinMinutes(params: {
    laterTime: string;
    earlierTime: string | null;
    minutes: number;
  }): boolean {
    const diff = diffMinutes(params.laterTime, params.earlierTime);
  
    if (diff === null) return false;
  
    return diff >= 0 && diff <= params.minutes;
  }
  
  function addCandidate(
    candidates: DetectionCandidate[],
    type: EmotionTradeType,
    score: number
  ) {
    candidates.push({
      type,
      score,
      message: MESSAGE_BY_TYPE[type],
    });
  }
  
  function isAggressiveBuy(input: DetectEmotionTradeRequest): boolean {
    const { current_order, current_price } = input;
  
    if (current_order.order_side !== "BUY") return false;
  
    const isMarketBuy = current_order.order_type === "MARKET";
  
    const isLimitBuyAboveCurrentPrice =
      current_order.order_type === "LIMIT" &&
      current_order.order_price !== null &&
      current_order.order_price > current_price;
  
    return isMarketBuy || isLimitBuyAboveCurrentPrice;
  }
  
  function detectFomoChasing(input: DetectEmotionTradeRequest): boolean {
    const { market_data, behavior_data } = input;
  
    const isPriceSurging =
      market_data.price_change_rate_15m >= RULE.FOMO_PRICE_CHANGE_RATE_15M;
  
    const isVolumeSpiking =
      market_data.volume_change_rate_1m >= RULE.FOMO_VOLUME_CHANGE_RATE_1M;
  
    const isFastEntry =
      behavior_data.page_stay_duration <= RULE.FAST_ENTRY_SECONDS;
  
    return (
      (isPriceSurging || isVolumeSpiking) &&
      isAggressiveBuy(input) &&
      isFastEntry
    );
  }
  
  function detectRevengeTrading(input: DetectEmotionTradeRequest): boolean {
    const { current_order, market, market_data, recent_orders } = input;
  
    if (current_order.order_side !== "BUY") return false;
  
    return recent_orders.some((order) => {
      const isLossSell =
        order.order_side === "SELL" &&
        order.order_status === "DONE" &&
        order.realized_loss_pct_1h !== null &&
        order.realized_loss_pct_1h >= RULE.REVENGE_LOSS_PCT;
  
      const reenteredSoon = isWithinMinutes({
        laterTime: current_order.order_request_time,
        earlierTime: order.order_request_time,
        minutes: RULE.REVENGE_REENTRY_MINUTES,
      });
  
      const isSameMarket = order.market === market;
      const isHighVolatilityTarget = market_data.is_top3_volatility;
  
      return isLossSell && reenteredSoon && (isSameMarket || isHighVolatilityTarget);
    });
  }
  
  function detectCancelRepeat(input: DetectEmotionTradeRequest): boolean {
    const { current_order, market, recent_orders } = input;
  
    const cancelCount = recent_orders.filter((order) => {
      const isSameMarket = order.market === market;
      const isCanceledBuy =
        order.order_side === "BUY" && order.order_status === "CANCEL";
  
      const canceledRecently = isWithinMinutes({
        laterTime: current_order.order_request_time,
        earlierTime: order.order_cancel_time ?? order.order_request_time,
        minutes: RULE.CANCEL_REPEAT_WINDOW_MINUTES,
      });
  
      return isSameMarket && isCanceledBuy && canceledRecently;
    }).length;
  
    return cancelCount >= RULE.CANCEL_REPEAT_COUNT_5M;
  }
  
  function detectOrderbookChasing(input: DetectEmotionTradeRequest): boolean {
    const { current_order, market, recent_orders } = input;
  
    const limitBuyOrders = recent_orders
      .filter((order) => {
        const isSameMarket = order.market === market;
        const isBuyLimit =
          order.order_side === "BUY" &&
          order.order_type === "LIMIT" &&
          order.order_price !== null;
  
        return isSameMarket && isBuyLimit;
      })
      .map((order) => ({
        price: order.order_price as number,
        requestTime: order.order_request_time,
      }));
  
    if (
      current_order.order_side === "BUY" &&
      current_order.order_type === "LIMIT" &&
      current_order.order_price !== null
    ) {
      limitBuyOrders.push({
        price: current_order.order_price,
        requestTime: current_order.order_request_time,
      });
    }
  
    const sorted = limitBuyOrders
      .map((order) => ({
        ...order,
        timeMs: toTimeMs(order.requestTime),
      }))
      .filter((order): order is { price: number; requestTime: string; timeMs: number } => {
        return order.timeMs !== null;
      })
      .sort((a, b) => a.timeMs - b.timeMs);
  
    let upwardReorderCount = 0;
  
    for (let i = 1; i < sorted.length; i += 1) {
      const prev = sorted[i - 1];
      const curr = sorted[i];
  
      const diffMs = curr.timeMs - prev.timeMs;
      const diffMin = diffMs / 1000 / 60;
  
      const isHigherPrice = curr.price > prev.price;
      const isWithinWindow = diffMin >= 0 && diffMin <= RULE.ORDERBOOK_CHASING_WINDOW_MINUTES;
  
      if (isHigherPrice && isWithinWindow) {
        upwardReorderCount += 1;
      }
    }
  
    return upwardReorderCount >= RULE.ORDERBOOK_CHASING_COUNT;
  }
  
  function detectHesitation(input: DetectEmotionTradeRequest): boolean {
    if (input.current_order.order_side !== "BUY") return false;

    const inputEditedTooMuch =
      input.behavior_data.input_edit_count >= RULE.HESITATION_INPUT_EDIT_COUNT;
  
    return (
      inputEditedTooMuch ||
      detectCancelRepeat(input) ||
      detectOrderbookChasing(input)
    );
  }
  
  function detectAllInImpulse(input: DetectEmotionTradeRequest): boolean {
    const isPriceSurging =
      input.market_data.price_change_rate_15m >=
      RULE.FOMO_PRICE_CHANGE_RATE_15M;
    const hasRecentLoss = input.recent_orders.some((order) => {
      const isLossSell =
        order.order_side === "SELL" &&
        order.order_status === "DONE" &&
        order.realized_loss_pct_1h !== null &&
        order.realized_loss_pct_1h >= RULE.REVENGE_LOSS_PCT;

      return (
        isLossSell &&
        isWithinMinutes({
          laterTime: input.current_order.order_request_time,
          earlierTime: order.order_request_time,
          minutes: RULE.REVENGE_REENTRY_MINUTES,
        })
      );
    });

    return (
      input.current_order.order_side === "BUY" &&
      input.behavior_data.is_max_button_clicked &&
      input.current_order.order_amount > 0 &&
      (isPriceSurging || hasRecentLoss)
    );
  }
  
  function detectAmountSpike(input: DetectEmotionTradeRequest): boolean {
    if (input.current_order.order_side !== "BUY") return false;

    const avg = input.behavior_data.client_avg_buy_amount;
  
    if (avg === null || avg <= 0) return false;
  
    return input.current_order.order_amount >= avg * RULE.AMOUNT_SPIKE_MULTIPLIER;
  }
  
  function detectMachineGunTrading(input: DetectEmotionTradeRequest): boolean {
    return (
      input.current_order.order_side === "BUY" &&
      input.current_order.order_type === "MARKET" &&
      input.behavior_data.buy_click_count_1m >= RULE.MACHINE_GUN_BUY_CLICK_COUNT_1M
    );
  }
  
  function detectHighRiskHopping(input: DetectEmotionTradeRequest): boolean {
    const isHighRiskMarket =
      input.market_data.is_top3_volatility || input.market_data.has_warning_badge;
  
    const isFastPageMove =
      input.behavior_data.page_stay_duration <= RULE.HIGH_RISK_HOPPING_STAY_SECONDS;
  
    return (
      input.current_order.order_side === "BUY" &&
      isHighRiskMarket &&
      isFastPageMove
    );
  }
  
  export function detectEmotionTrade(
    input: DetectEmotionTradeRequest
  ): DetectEmotionTradeResponse {
    const candidates: DetectionCandidate[] = [];
  
    /**
     * 점수가 높을수록 대표 가드레일 유형으로 우선 선택된다.
     * 명세서 응답 DTO가 type 하나만 반환하도록 되어 있으므로,
     * 여러 조건이 동시에 맞으면 가장 위험도가 높은 하나만 반환한다.
     */
    if (detectAllInImpulse(input)) {
      addCandidate(candidates, "ALL_IN_IMPULSE", 95);
    }
  
    if (detectFomoChasing(input)) {
      addCandidate(candidates, "FOMO_CHASING", 90);
    }
  
    if (detectRevengeTrading(input)) {
      addCandidate(candidates, "REVENGE_TRADING", 85);
    }
  
    if (detectMachineGunTrading(input)) {
      addCandidate(candidates, "MACHINE_GUN_TRADING", 75);
    }
  
    if (detectHesitation(input)) {
      addCandidate(candidates, "HESITATION", 70);
    }
  
    if (detectAmountSpike(input)) {
      addCandidate(candidates, "AMOUNT_SPIKE", 65);
    }
  
    if (detectHighRiskHopping(input)) {
      addCandidate(candidates, "HIGH_RISK_HOPPING", 60);
    }
  
    if (candidates.length === 0) {
      return {
        detected: false,
        type: null,
        message: "현재 설정한 가드레일 기준에 해당하는 주문은 감지되지 않았어요.",
        matchedRuleIds: [],
        primaryRuleId: null,
      };
    }
  
    const topCandidate = candidates.sort((a, b) => b.score - a.score)[0];
    const matchedRuleIds = candidates.map(
      (candidate) => RULE_ID_BY_TYPE[candidate.type],
    );
  
    return {
      detected: true,
      type: topCandidate.type,
      message: topCandidate.message,
      matchedRuleIds,
      primaryRuleId: RULE_ID_BY_TYPE[topCandidate.type],
    };
  }
