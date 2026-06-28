// backend/modules/behavior/schema.ts

import { z } from "zod";

const optionalNumber = z.preprocess((value) => {
  if (value === "" || value === null || value === undefined) {
    return undefined;
  }

  const numberValue = Number(value);

  if (Number.isNaN(numberValue)) {
    return value;
  }

  return numberValue;
}, z.number().finite().nonnegative().optional());

const optionalDateTime = z.preprocess((value) => {
  if (value === "" || value === null || value === undefined) {
    return undefined;
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (typeof value === "number") {
    return new Date(value).toISOString();
  }

  return value;
}, z.string().datetime().optional());

/**
 * 행동 로그 저장용 symbol.
 * 크롬 확장 프로그램에서 KRW-BTC, BTC, CRIX.UPBIT.KRW-BTC 등으로 보낼 수 있으므로
 * 저장 API에서는 조금 넓게 허용한다.
 */
const behaviorSymbolSchema = z
  .string()
  .min(1, "symbol은 필수입니다.")
  .transform((value) => value.trim().toUpperCase())
  .refine(
    (value) =>
      /^KRW-[A-Z0-9]+$/.test(value) ||
      /^[A-Z0-9]+$/.test(value) ||
      /^CRIX\.UPBIT\.KRW-[A-Z0-9]+$/.test(value),
    {
      message: "symbol 형식이 올바르지 않습니다.",
    }
  );

/**
 * analyze / market API용 symbol.
 * 업비트 Public API 호출에는 KRW-BTC 형태가 가장 안전하다.
 */
const marketSymbolSchema = z
  .string()
  .min(1, "symbol은 필수입니다.")
  .transform((value) => value.trim().toUpperCase())
  .refine((value) => /^KRW-[A-Z0-9]+$/.test(value), {
    message: "analyze API의 symbol은 KRW-BTC 형식이어야 합니다.",
  });

export const behaviorEventTypeSchema = z.enum([
  "AMOUNT_INPUT",
  "QUANTITY_INPUT",
  "PRICE_INPUT",
  "ORDER_TYPE_CHANGE",
  "BUY_CLICK",
  "SELL_CLICK",
  "CANCEL_CLICK",
  "SYMBOL_CHANGE",
  "ORDER_SUBMIT_ATTEMPT",
]);

export const recordBehaviorEventSchema = z
  .object({
    userId: z.string().min(1).optional(),
    sessionId: z.string().min(1).optional(),

    symbol: behaviorSymbolSchema,
    eventType: behaviorEventTypeSchema,

    side: z.enum(["BUY", "SELL"]).optional(),
    orderType: z.enum(["LIMIT", "MARKET"]).optional(),

    price: optionalNumber,
    amount: optionalNumber,
    quantity: optionalNumber,

    pageUrl: z.string().min(1).optional(),
    occurredAt: optionalDateTime,

    metadata: z.record(z.string(), z.unknown()).optional(),
  })
  .superRefine((data, ctx) => {
    if (data.eventType === "AMOUNT_INPUT" && data.amount === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["amount"],
        message: "AMOUNT_INPUT 이벤트에는 amount가 필요합니다.",
      });
    }

    if (data.eventType === "QUANTITY_INPUT" && data.quantity === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["quantity"],
        message: "QUANTITY_INPUT 이벤트에는 quantity가 필요합니다.",
      });
    }

    if (data.eventType === "PRICE_INPUT" && data.price === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["price"],
        message: "PRICE_INPUT 이벤트에는 price가 필요합니다.",
      });
    }

    if (
      data.eventType === "ORDER_TYPE_CHANGE" &&
      data.orderType === undefined
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["orderType"],
        message: "ORDER_TYPE_CHANGE 이벤트에는 orderType이 필요합니다.",
      });
    }

    if (data.eventType === "BUY_CLICK" && data.side !== "BUY") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["side"],
        message: "BUY_CLICK 이벤트의 side는 BUY여야 합니다.",
      });
    }

    if (data.eventType === "SELL_CLICK" && data.side !== "SELL") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["side"],
        message: "SELL_CLICK 이벤트의 side는 SELL이어야 합니다.",
      });
    }

    if (data.eventType === "ORDER_SUBMIT_ATTEMPT") {
      if (data.side === undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["side"],
          message: "ORDER_SUBMIT_ATTEMPT 이벤트에는 side가 필요합니다.",
        });
      }

      if (data.orderType === undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["orderType"],
          message: "ORDER_SUBMIT_ATTEMPT 이벤트에는 orderType이 필요합니다.",
        });
      }
    }
  });

/**
 * 기존 analyze API에서 쓰던 schema.
 * 이걸 유지해야 analyze route가 안 깨진다.
 */
export const analyzeRiskSchema = z.object({
  userId: z.string().optional(),
  symbol: marketSymbolSchema,
  currentOrder: z.object({
    symbol: marketSymbolSchema,
    side: z.enum(["BUY", "SELL"]),
    orderType: z.enum(["LIMIT", "MARKET"]),
    price: optionalNumber,
    amount: optionalNumber,
    quantity: optionalNumber,
    krwBalance: optionalNumber,
  }),
});

export type RecordBehaviorEventInput = z.infer<
  typeof recordBehaviorEventSchema
>;

export type AnalyzeRiskInput = z.infer<typeof analyzeRiskSchema>;