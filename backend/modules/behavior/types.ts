export type BehaviorEventType =
  | "AMOUNT_CHANGED"
  | "QUANTITY_CHANGED"
  | "ORDER_TYPE_CHANGED"
  | "BUY_CLICKED"
  | "SELL_CLICKED"
  | "CANCEL_BEFORE_ORDER"
  | "PRICE_FOLLOWED"
  | "MARKET_SWITCHED"
  | "REASON_WRITTEN"
  | "COOLDOWN_STARTED";

export type BehaviorEvent = {
  id: string;
  userId: string;
  sessionId: string;
  market: string;
  eventType: BehaviorEventType;
  value?: string | number;
  previousValue?: string | number;
  createdAt: string;
};