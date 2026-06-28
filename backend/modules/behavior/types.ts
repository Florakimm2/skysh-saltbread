// backend/modules/behavior/types.ts

export type BehaviorEventType =
  | "AMOUNT_INPUT"
  | "QUANTITY_INPUT"
  | "PRICE_INPUT"
  | "ORDER_TYPE_CHANGE"
  | "BUY_CLICK"
  | "SELL_CLICK"
  | "CANCEL_CLICK"
  | "SYMBOL_CHANGE"
  | "ORDER_SUBMIT_ATTEMPT";

export type OrderSide = "BUY" | "SELL";
export type OrderType = "LIMIT" | "MARKET";

export type RiskLevel = "LOW" | "WARNING" | "DANGER";

export type EmotionPattern =
  | "FOMO_CHASING"
  | "HESITATION"
  | "CANCEL_REPEAT"
  | "ORDER_TYPE_SWITCHING"
  | "OVER_LEVERAGING"
  | "ORDERBOOK_CHASING";

export interface BehaviorEventInput {
  symbol: string;
  eventType: BehaviorEventType;
  side?: OrderSide;
  orderType?: OrderType;
  price?: number;
  amount?: number;
  quantity?: number;
}

export interface BehaviorEventDoc extends BehaviorEventInput {
  id: string;
  userId: string;
  createdAt: string;
}

export interface CurrentOrder {
  symbol: string;
  side: OrderSide;
  orderType: OrderType;
  price?: number;
  amount?: number;
  quantity?: number;

  /**
   * 선택값.
   * 사용자의 보유 KRW를 알 수 있을 때만 전달.
   * MVP에서는 없어도 됨.
   */
  krwBalance?: number;
}

export interface AnalyzeRiskInput {
  symbol: string;
  currentOrder: CurrentOrder;
}

export interface RiskAnalysisResult {
  riskLevel: RiskLevel;
  score: number;
  cooldownRequired: boolean;
  cooldownSeconds: number;
  matchedPatterns: EmotionPattern[];
  reasons: string[];
}

export interface RiskAnalysisDoc extends RiskAnalysisResult {
  id: string;
  userId: string;
  symbol: string;
  createdAt: string;
}