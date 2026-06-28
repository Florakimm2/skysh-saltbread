// backend/modules/ext/detect/types.ts

export type OrderSide = "BUY" | "SELL";
export type OrderStatus = "WAIT" | "DONE" | "CANCEL";
export type OrderType = "LIMIT" | "MARKET";

export type EmotionTradeType =
  | "FOMO_CHASING"
  | "REVENGE_TRADING"
  | "HESITATION"
  | "ALL_IN_IMPULSE"
  | "AMOUNT_SPIKE"
  | "MACHINE_GUN_TRADING"
  | "HIGH_RISK_HOPPING";

export interface DetectEmotionTradeRequest {
  market: string;
  current_price: number;

  market_data: {
    price_change_rate_15m: number;
    volume_change_rate_1m: number;
    is_top3_volatility: boolean;
    has_warning_badge: boolean;
  };

  current_order: {
    order_side: OrderSide;
    order_status: OrderStatus;
    order_type: OrderType;
    order_price: number | null;
    order_volume: number | null;
    order_amount: number;
    realized_loss_pct_1h: number | null;
    order_request_time: string;
    order_cancel_time: string | null;
  };

  behavior_data: {
    is_max_button_clicked: boolean;
    client_avg_buy_amount: number | null;
    buy_click_count_1m: number;
    input_edit_count: number;
    page_stay_duration: number;
  };

  recent_orders: Array<{
    market: string;
    order_side: OrderSide;
    order_status: OrderStatus;
    order_type: OrderType;
    order_price: number | null;
    order_volume: number | null;
    order_amount: number | null;
    realized_loss_pct_1h: number | null;
    order_request_time: string;
    order_cancel_time: string | null;
  }>;
}

export interface DetectEmotionTradeResponse {
  detected: boolean;
  type: EmotionTradeType | null;
  message: string;
}

export interface DetectionCandidate {
  type: EmotionTradeType;
  score: number;
  message: string;
}