// backend/modules/logs/schema.ts

import { z } from "zod";

const dateTimeString = z
  .string()
  .min(1)
  .refine((value) => !Number.isNaN(new Date(value).getTime()), {
    message: "올바른 날짜/시간 문자열이어야 합니다.",
  });

const marketSchema = z
  .string()
  .min(1)
  .transform((value) => value.trim().toUpperCase())
  .refine((value) => /^KRW-[A-Z0-9]+$/.test(value), {
    message: "market은 KRW-BTC 형식이어야 합니다.",
  });

const decimalString = z
  .string()
  .min(1)
  .refine((value) => /^-?\d+(\.\d+)?$/.test(value), {
    message: "decimal string 형식이어야 합니다.",
  });

const nullableDecimalString = decimalString.nullable();

const nullableNumber = z.number().finite().nullable();

const nonNegativeInt = z.number().int().min(0);

const ratioNullable = z.number().finite().nullable();

export const snapshotTriggerSchema = z.enum([
  "GUARDRAIL_SHOWN",
  "ORDER_INTENT_CLICK",
]);

export const orderSideSchema = z.enum(["BUY", "SELL", "UNKNOWN"]);

export const orderModeSchema = z.enum([
  "LIMIT",
  "MARKET",
  "BEST",
  "RESERVED",
  "UNKNOWN",
]);

export const entryPointSchema = z.enum([
  "NORMAL",
  "QUICK",
  "REORDER",
  "UNKNOWN",
]);

const orderContextSnapshotBaseSchema = z.object({
    attemptId: z.string().min(1).nullable().optional().default(null),
    snapshotTrigger: snapshotTriggerSchema,
    capturedAt: dateTimeString.optional(),
  
    market: marketSchema,
    side: orderSideSchema,
    orderMode: orderModeSchema,
    entryPoint: entryPointSchema.default("UNKNOWN"),
  
    intentPrice: nullableDecimalString.optional().default(null),
    intentQuantity: nullableDecimalString.optional().default(null),
    intentAmount: nullableDecimalString.optional().default(null),
    requestedBalanceRatio: ratioNullable.optional().default(null),
  
    draftDurationMs: nullableNumber.optional().default(null),
    lastEditToSnapshotMs: nullableNumber.optional().default(null),
    draftEditCount: nullableNumber.optional().default(null),
    amountChangeRate: ratioNullable.optional().default(null),
    modeChangedToMarket: z.boolean().nullable().optional().default(null),
    orderbookClickToSnapshotMs: nullableNumber.optional().default(null),
  
    orderIntentCount1m: nonNegativeInt.default(0),
    actualOrderCreatedCount10m: nullableNumber.optional().default(null),
    sameSideIntentCount1m: nonNegativeInt.default(0),
    marketChangeCount5m: nonNegativeInt.default(0),
    sideChangeCount3m: nonNegativeInt.default(0),
    priceEditCount3m: nonNegativeInt.default(0),
    quantityEditCount3m: nonNegativeInt.default(0),
    amountEditCount3m: nonNegativeInt.default(0),
    inputRevertCount: nonNegativeInt.default(0),
    priceDirectionChangeCount: nonNegativeInt.default(0),
    priceChangeRate: ratioNullable.optional().default(null),
    orderModeChangeCount3m: nonNegativeInt.default(0),
    allocationPresetPercent: z
      .union([z.number().finite(), z.literal("CUSTOM"), z.null()])
      .optional()
      .default(null),
    draftResetCount3m: nullableNumber.optional().default(null),
  
    matchedRuleIdsAtSnapshot: z.array(z.string()).default([]),
    primaryShownRuleId: z.string().nullable().optional().default(null),
    shownRuleIds: z.array(z.string()).default([]),
  
    tradePriceAtSnapshot: nullableDecimalString.optional().default(null),
    shortTermReturn5m: ratioNullable.optional().default(null),
    signedChangeRate: ratioNullable.optional().default(null),
    spreadRate: ratioNullable.optional().default(null),
    marketRiskFlags: z.array(z.string()).default([]),
    pricePositionIn5mRange: ratioNullable.optional().default(null),
    volumeSpikeRatio5m: nullableNumber.optional().default(null),
    baseAssetAvgBuyPriceBeforeSnapshot: nullableDecimalString
      .optional()
      .default(null),
    priceVsAvgBuyRateAtSnapshot: ratioNullable.optional().default(null),
});

export const createOrderContextSnapshotSchema =
    orderContextSnapshotBaseSchema.superRefine((data, ctx) => {
      if (
        data.snapshotTrigger === "GUARDRAIL_SHOWN" &&
        data.shownRuleIds.length === 0
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["shownRuleIds"],
          message:
            "GUARDRAIL_SHOWN Snapshot에는 shownRuleIds가 1개 이상 있는 것이 권장됩니다.",
        });
      }
  
      if (
        data.snapshotTrigger === "ORDER_INTENT_CLICK" &&
        data.attemptId === null
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["attemptId"],
          message: "ORDER_INTENT_CLICK Snapshot에는 attemptId가 필요합니다.",
        });
      }
    });


export const patchOrderContextSnapshotSchema = 
    orderContextSnapshotBaseSchema.partial();


export const createGuardrailReactionSchema = z.object({
  snapshotId: z.string().min(1),
  action: z.enum(["PROCEED", "REVIEW", "CLOSE"]),
  reactedAt: dateTimeString.optional(),
  reactionUiVersion: z.string().min(1).default("v1"),
});

export const patchGuardrailReactionSchema =
  createGuardrailReactionSchema.partial();

  const tradeFeedbackBaseSchema = z.object({
    attemptId: z.string().min(1),
    feedbackStatus: z.enum(["ANSWERED", "DISMISSED"]),
    selfAssessment: z
      .enum(["PLANNED", "EMOTIONAL"])
      .nullable()
      .optional()
      .default(null),
    feedbackShownAt: dateTimeString,
    respondedAt: dateTimeString.optional(),
    feedbackUiVersion: z.string().min(1).default("v1"),
  });


export const createTradeFeedbackSchema =
    tradeFeedbackBaseSchema.superRefine((data, ctx) => {
      if (data.feedbackStatus === "ANSWERED" && data.selfAssessment === null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["selfAssessment"],
          message: "ANSWERED 상태에서는 selfAssessment가 필요합니다.",
        });
      }
  
      if (data.feedbackStatus === "DISMISSED" && data.selfAssessment !== null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["selfAssessment"],
          message: "DISMISSED 상태에서는 selfAssessment가 null이어야 합니다.",
        });
      }
    });

export const patchTradeFeedbackSchema =
    tradeFeedbackBaseSchema.partial().superRefine((data, ctx) => {
      if (
        data.feedbackStatus === "ANSWERED" &&
        data.selfAssessment === null
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["selfAssessment"],
          message: "ANSWERED 상태로 수정할 때는 selfAssessment가 필요합니다.",
        });
      }
  
      if (
        data.feedbackStatus === "DISMISSED" &&
        data.selfAssessment !== undefined &&
        data.selfAssessment !== null
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["selfAssessment"],
          message: "DISMISSED 상태에서는 selfAssessment가 null이어야 합니다.",
        });
      }
    });



export const createConfirmedTradeLogSchema = z.object({
  attemptId: z.string().min(1).nullable().optional().default(null),
  upbitOrderUuid: z.string().min(1),
  orderCreatedAt: dateTimeString,

  market: marketSchema,
  side: z.enum(["BUY", "SELL"]),
  ordType: z.enum(["LIMIT", "MARKET_BUY", "MARKET_SELL", "BEST"]),

  limitPrice: nullableDecimalString.optional().default(null),
  requestedFunds: nullableDecimalString.optional().default(null),
  requestedVolume: nullableDecimalString.optional().default(null),
  timeInForce: z
    .enum(["IOC", "FOK", "POST_ONLY"])
    .nullable()
    .optional()
    .default(null),

  state: z
    .enum(["wait", "watch", "trade", "done", "cancel", "prevented"])
    .nullable()
    .optional()
    .default(null),
  executedVolume: nullableDecimalString.optional().default(null),
  executedFunds: nullableDecimalString.optional().default(null),
  paidFee: nullableDecimalString.optional().default(null),
  remainingVolume: nullableDecimalString.optional().default(null),
  outcomeObservedAt: dateTimeString.nullable().optional().default(null),
});

export const patchConfirmedTradeLogSchema =
  createConfirmedTradeLogSchema.partial();

export const orderOutcomePatchSchema = z.object({
  upbitOrderUuid: z.string().min(1),
  state: z.enum(["wait", "watch", "trade", "done", "cancel", "prevented"]),
  executedVolume: nullableDecimalString.optional().default(null),
  executedFunds: nullableDecimalString.optional().default(null),
  paidFee: nullableDecimalString.optional().default(null),
  remainingVolume: nullableDecimalString.optional().default(null),
  outcomeObservedAt: dateTimeString,
});

export type CreateOrderContextSnapshotInput = z.infer<
  typeof createOrderContextSnapshotSchema
>;

export type PatchOrderContextSnapshotInput = z.infer<
  typeof patchOrderContextSnapshotSchema
>;

export type CreateGuardrailReactionInput = z.infer<
  typeof createGuardrailReactionSchema
>;

export type PatchGuardrailReactionInput = z.infer<
  typeof patchGuardrailReactionSchema
>;

export type CreateTradeFeedbackInput = z.infer<
  typeof createTradeFeedbackSchema
>;

export type PatchTradeFeedbackInput = z.infer<
  typeof patchTradeFeedbackSchema
>;

export type CreateConfirmedTradeLogInput = z.infer<
  typeof createConfirmedTradeLogSchema
>;

export type PatchConfirmedTradeLogInput = z.infer<
  typeof patchConfirmedTradeLogSchema
>;

export type OrderOutcomePatchInput = z.infer<typeof orderOutcomePatchSchema>;