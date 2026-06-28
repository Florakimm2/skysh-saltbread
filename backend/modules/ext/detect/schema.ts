// backend/modules/ext/detect/schema.ts

import { z } from "zod";

const nullableNumber = z.union([z.number().finite(), z.null()]);

const orderSideSchema = z.enum(["BUY", "SELL"]);
const orderStatusSchema = z.enum(["WAIT", "DONE", "CANCEL"]);
const orderTypeSchema = z.enum(["LIMIT", "MARKET"]);

const orderSchema = z.object({
  market: z.string().min(1),
  order_side: orderSideSchema,
  order_status: orderStatusSchema,
  order_type: orderTypeSchema,
  order_price: nullableNumber,
  order_volume: nullableNumber,
  order_amount: nullableNumber,
  realized_loss_pct_1h: nullableNumber,
  order_request_time: z.string().min(1),
  order_cancel_time: z.union([z.string().min(1), z.null()]),
});

export const detectEmotionTradeRequestSchema = z.object({
  market: z.string().min(1),
  current_price: z.number().finite().positive(),

  market_data: z.object({
    price_change_rate_15m: z.number().finite(),
    volume_change_rate_1m: z.number().finite(),
    is_top3_volatility: z.boolean(),
    has_warning_badge: z.boolean(),
  }),

  current_order: z.object({
    order_side: orderSideSchema,
    order_status: orderStatusSchema,
    order_type: orderTypeSchema,
    order_price: nullableNumber,
    order_volume: nullableNumber,
    order_amount: z.number().finite().nonnegative(),
    realized_loss_pct_1h: nullableNumber,
    order_request_time: z.string().min(1),
    order_cancel_time: z.union([z.string().min(1), z.null()]),
  }),

  behavior_data: z.object({
    is_max_button_clicked: z.boolean(),
    client_avg_buy_amount: nullableNumber,
    buy_click_count_1m: z.number().int().nonnegative(),
    input_edit_count: z.number().int().nonnegative(),
    page_stay_duration: z.number().finite().nonnegative(),
  }),

  recent_orders: z.array(orderSchema).default([]),
});

export type DetectEmotionTradeRequestInput = z.infer<
  typeof detectEmotionTradeRequestSchema
>;