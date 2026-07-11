// backend/modules/behavior/analyzer.ts

import type { MarketSnapshot } from "@/backend/modules/market/types";
import type {
  BehaviorEventDoc,
  CurrentOrder,
  EmotionPattern,
  RiskAnalysisResult,
  RiskLevel,
} from "./types";
import { RISK_RULES, RISK_SCORE } from "./rules";

function countEvents(
  events: BehaviorEventDoc[],
  eventType: BehaviorEventDoc["eventType"]
): number {
  return events.filter((event) => event.eventType === eventType).length;
}

function getRecentEventsWithinMinutes(
  events: BehaviorEventDoc[],
  minutes: number
): BehaviorEventDoc[] {
  const sinceMs = Date.now() - minutes * 60 * 1000;

  return events.filter((event) => {
    const eventMs = new Date(event.createdAt).getTime();
    return eventMs >= sinceMs;
  });
}

function getRiskLevel(score: number): RiskLevel {
  if (score >= 60) return "DANGER";
  if (score >= 30) return "WARNING";
  return "LOW";
}

function addPattern(params: {
  pattern: EmotionPattern;
  score: number;
  matchedPatterns: EmotionPattern[];
  reasons: string[];
  reason: string;
}) {
  if (!params.matchedPatterns.includes(params.pattern)) {
    params.matchedPatterns.push(params.pattern);
    params.reasons.push(params.reason);
  }

  return params.score + RISK_SCORE[params.pattern];
}

export function analyzeEmotionRisk(params: {
  recentEvents: BehaviorEventDoc[];
  marketSnapshot: MarketSnapshot;
  currentOrder: CurrentOrder;
}): RiskAnalysisResult {
  const { recentEvents, marketSnapshot, currentOrder } = params;

  let score = 0;
  const matchedPatterns: EmotionPattern[] = [];
  const reasons: string[] = [];

  const recent5mEvents = getRecentEventsWithinMinutes(
    recentEvents,
    RISK_RULES.HESITATION_WINDOW_MINUTES
  );

  const amountInputCount = countEvents(recent5mEvents, "AMOUNT_INPUT");
  const cancelClickCount = countEvents(recent5mEvents, "CANCEL_CLICK");
  const orderTypeChangeCount = countEvents(
    recent5mEvents,
    "ORDER_TYPE_CHANGE"
  );
  const priceInputEvents = recent5mEvents.filter(
    (event) => event.eventType === "PRICE_INPUT"
  );

  /**
   * 1. FOMO / 급등 추격 매수
   */
  const isBuy = currentOrder.side === "BUY";
  const isMarketBuy = isBuy && currentOrder.orderType === "MARKET";
  const isUpperLimitBuy =
    isBuy &&
    currentOrder.orderType === "LIMIT" &&
    typeof currentOrder.price === "number" &&
    currentOrder.price > marketSnapshot.currentPrice;

  const isMarketHot =
    marketSnapshot.changeRate15m >= RISK_RULES.FOMO_CHANGE_RATE_15M ||
    marketSnapshot.volumeSpikeRatio >= RISK_RULES.VOLUME_SPIKE_RATIO;

  if (isMarketHot && (isMarketBuy || isUpperLimitBuy)) {
    score = addPattern({
      pattern: "FOMO_CHASING",
      score,
      matchedPatterns,
      reasons,
      reason: `최근 15분 변동률이 ${marketSnapshot.changeRate15m.toFixed(
        2
      )}%이고, 공격적인 매수 시도가 감지되었습니다.`,
    });
  }

  /**
   * 2. 주문 금액 반복 수정
   */
  if (amountInputCount >= RISK_RULES.AMOUNT_REVISION_COUNT) {
    score = addPattern({
      pattern: "HESITATION",
      score,
      matchedPatterns,
      reasons,
      reason: `최근 ${RISK_RULES.HESITATION_WINDOW_MINUTES}분 이내 주문 금액을 ${amountInputCount}회 수정했습니다.`,
    });
  }

  /**
   * 3. 취소 반복
   */
  if (cancelClickCount >= RISK_RULES.CANCEL_REPEAT_COUNT) {
    score = addPattern({
      pattern: "CANCEL_REPEAT",
      score,
      matchedPatterns,
      reasons,
      reason: `최근 ${RISK_RULES.HESITATION_WINDOW_MINUTES}분 이내 주문 취소가 ${cancelClickCount}회 발생했습니다.`,
    });
  }

  /**
   * 4. 주문 방식 반복 변경: 지정가 ↔ 시장가
   */
  if (orderTypeChangeCount >= RISK_RULES.ORDER_TYPE_CHANGE_COUNT) {
    score = addPattern({
      pattern: "ORDER_TYPE_SWITCHING",
      score,
      matchedPatterns,
      reasons,
      reason: `최근 ${RISK_RULES.HESITATION_WINDOW_MINUTES}분 이내 주문 방식을 ${orderTypeChangeCount}회 변경했습니다.`,
    });
  }

  /**
   * 5. 호가 따라가기형
   * PRICE_INPUT 이벤트의 price가 계속 상승하면 위험 신호로 본다.
   */
  const priceInputs = priceInputEvents
    .filter((event) => typeof event.price === "number")
    .map((event) => ({
      price: event.price as number,
      createdAt: new Date(event.createdAt).getTime(),
    }))
    .sort((a, b) => a.createdAt - b.createdAt);

  let increasingPriceCount = 0;

  for (let i = 1; i < priceInputs.length; i += 1) {
    if (priceInputs[i].price > priceInputs[i - 1].price) {
      increasingPriceCount += 1;
    }
  }

  if (increasingPriceCount >= RISK_RULES.ORDERBOOK_CHASING_COUNT) {
    score = addPattern({
      pattern: "ORDERBOOK_CHASING",
      score,
      matchedPatterns,
      reasons,
      reason: `지정가 주문 가격을 반복적으로 올리는 호가 따라가기 패턴이 감지되었습니다.`,
    });
  }

  /**
   * 6. 과도한 비중
   */
  if (
    typeof currentOrder.amount === "number" &&
    typeof currentOrder.krwBalance === "number" &&
    currentOrder.krwBalance > 0 &&
    currentOrder.amount / currentOrder.krwBalance >=
      RISK_RULES.KRW_BALANCE_RATIO_LIMIT
  ) {
    score = addPattern({
      pattern: "OVER_LEVERAGING",
      score,
      matchedPatterns,
      reasons,
      reason: `현재 주문 금액이 보유 KRW의 ${(
        (currentOrder.amount / currentOrder.krwBalance) *
        100
      ).toFixed(1)}%입니다.`,
    });
  }

  const riskLevel = getRiskLevel(score);

  return {
    riskLevel,
    score,
    cooldownRequired: riskLevel === "DANGER",
    cooldownSeconds:
      riskLevel === "DANGER" ? RISK_RULES.COOLDOWN_SECONDS : 0,
    matchedPatterns,
    reasons:
      reasons.length > 0
        ? reasons
        : ["현재 추가로 확인할 가드레일 행동 패턴은 뚜렷하지 않습니다."],
  };
}
