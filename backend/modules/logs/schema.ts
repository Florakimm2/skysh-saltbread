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

/**
 * 중요:
 * PATCH 버그 방지를 위해 base schema에는 .default()를 넣지 않는다.
 * default 값은 create schema의 transform에서만 채운다.
 */


const orderContextSnapshotBaseSchema = z.object({
  attemptId: z.string().min(1).nullable().optional(),
  snapshotTrigger: snapshotTriggerSchema,
  capturedAt: dateTimeString.optional(),

  market: marketSchema,
  side: orderSideSchema,
  orderMode: orderModeSchema,
  entryPoint: entryPointSchema.optional(),

  intentPrice: nullableDecimalString.optional(),
  intentQuantity: nullableDecimalString.optional(),
  intentAmount: nullableDecimalString.optional(),
  requestedBalanceRatio: ratioNullable.optional(),

  draftDurationMs: nullableNumber.optional(),
  lastEditToSnapshotMs: nullableNumber.optional(),
  draftEditCount: nullableNumber.optional(),
  amountChangeRate: ratioNullable.optional(),
  modeChangedToMarket: z.boolean().nullable().optional(),
  orderbookClickToSnapshotMs: nullableNumber.optional(),

  orderIntentCount1m: nonNegativeInt.optional(),
  actualOrderCreatedCount10m: nullableNumber.optional(),
  sameSideIntentCount1m: nonNegativeInt.optional(),
  marketChangeCount5m: nonNegativeInt.optional(),
  sideChangeCount3m: nonNegativeInt.optional(),
  priceEditCount3m: nonNegativeInt.optional(),
  quantityEditCount3m: nonNegativeInt.optional(),
  amountEditCount3m: nonNegativeInt.optional(),
  inputRevertCount: nonNegativeInt.optional(),
  priceDirectionChangeCount: nonNegativeInt.optional(),
  priceChangeRate: ratioNullable.optional(),
  orderModeChangeCount3m: nonNegativeInt.optional(),
  allocationPresetPercent: z
    .union([z.number().finite(), z.literal("CUSTOM"), z.null()])
    .optional(),
  draftResetCount3m: nullableNumber.optional(),

  matchedRuleIdsAtSnapshot: z.array(z.string()).optional(),
  primaryShownRuleId: z.string().nullable().optional(),
  shownRuleIds: z.array(z.string()).optional(),

  tradePriceAtSnapshot: nullableDecimalString.optional(),
  shortTermReturn5m: ratioNullable.optional(),
  signedChangeRate: ratioNullable.optional(),
  spreadRate: ratioNullable.optional(),
  marketRiskFlags: z.array(z.string()).optional(),
  pricePositionIn5mRange: ratioNullable.optional(),
  volumeSpikeRatio5m: nullableNumber.optional(),
  baseAssetAvgBuyPriceBeforeSnapshot: nullableDecimalString.optional(),
  priceVsAvgBuyRateAtSnapshot: ratioNullable.optional(),
});

export const createOrderContextSnapshotSchema = orderContextSnapshotBaseSchema
  .superRefine((data, ctx) => {
    const shownRuleIds = data.shownRuleIds ?? [];

    if (
      data.snapshotTrigger === "GUARDRAIL_SHOWN" &&
      shownRuleIds.length === 0
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
      !data.attemptId
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["attemptId"],
        message: "ORDER_INTENT_CLICK Snapshot에는 attemptId가 필요합니다.",
      });
    }
  })
  .transform((data) => ({
    ...data,

    attemptId: data.attemptId ?? null,
    entryPoint: data.entryPoint ?? "UNKNOWN",

    intentPrice: data.intentPrice ?? null,
    intentQuantity: data.intentQuantity ?? null,
    intentAmount: data.intentAmount ?? null,
    requestedBalanceRatio: data.requestedBalanceRatio ?? null,

    draftDurationMs: data.draftDurationMs ?? null,
    lastEditToSnapshotMs: data.lastEditToSnapshotMs ?? null,
    draftEditCount: data.draftEditCount ?? null,
    amountChangeRate: data.amountChangeRate ?? null,
    modeChangedToMarket: data.modeChangedToMarket ?? null,
    orderbookClickToSnapshotMs: data.orderbookClickToSnapshotMs ?? null,

    orderIntentCount1m: data.orderIntentCount1m ?? 0,
    actualOrderCreatedCount10m: data.actualOrderCreatedCount10m ?? null,
    sameSideIntentCount1m: data.sameSideIntentCount1m ?? 0,
    marketChangeCount5m: data.marketChangeCount5m ?? 0,
    sideChangeCount3m: data.sideChangeCount3m ?? 0,
    priceEditCount3m: data.priceEditCount3m ?? 0,
    quantityEditCount3m: data.quantityEditCount3m ?? 0,
    amountEditCount3m: data.amountEditCount3m ?? 0,
    inputRevertCount: data.inputRevertCount ?? 0,
    priceDirectionChangeCount: data.priceDirectionChangeCount ?? 0,
    priceChangeRate: data.priceChangeRate ?? null,
    orderModeChangeCount3m: data.orderModeChangeCount3m ?? 0,
    allocationPresetPercent: data.allocationPresetPercent ?? null,
    draftResetCount3m: data.draftResetCount3m ?? null,

    matchedRuleIdsAtSnapshot: data.matchedRuleIdsAtSnapshot ?? [],
    primaryShownRuleId: data.primaryShownRuleId ?? null,
    shownRuleIds: data.shownRuleIds ?? [],

    tradePriceAtSnapshot: data.tradePriceAtSnapshot ?? null,
    shortTermReturn5m: data.shortTermReturn5m ?? null,
    signedChangeRate: data.signedChangeRate ?? null,
    spreadRate: data.spreadRate ?? null,
    marketRiskFlags: data.marketRiskFlags ?? [],
    pricePositionIn5mRange: data.pricePositionIn5mRange ?? null,
    volumeSpikeRatio5m: data.volumeSpikeRatio5m ?? null,
    baseAssetAvgBuyPriceBeforeSnapshot:
      data.baseAssetAvgBuyPriceBeforeSnapshot ?? null,
    priceVsAvgBuyRateAtSnapshot:
      data.priceVsAvgBuyRateAtSnapshot ?? null,
  }));

export const patchOrderContextSnapshotSchema =
  orderContextSnapshotBaseSchema.partial().superRefine((data, ctx) => {
    if (
      data.snapshotTrigger === "ORDER_INTENT_CLICK" &&
      data.attemptId === null
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["attemptId"],
        message: "ORDER_INTENT_CLICK Snapshot으로 수정할 때 attemptId는 null일 수 없습니다.",
      });
    }
  });

const guardrailReactionBaseSchema = z.object({
  snapshotId: z.string().min(1),
  action: z.enum(["PROCEED", "REVIEW", "CLOSE"]),
  reactedAt: dateTimeString.optional(),
  reactionUiVersion: z.string().min(1).optional(),
});

export const createGuardrailReactionSchema =
  guardrailReactionBaseSchema.transform((data) => ({
    ...data,
    reactionUiVersion: data.reactionUiVersion ?? "v1",
  }));

export const patchGuardrailReactionSchema =
  guardrailReactionBaseSchema.partial();

const tradeFeedbackBaseSchema = z.object({
  attemptId: z.string().min(1),
  feedbackStatus: z.enum(["ANSWERED", "DISMISSED"]),
  selfAssessment: z
    .enum(["PLANNED", "EMOTIONAL"])
    .nullable()
    .optional(),
  feedbackShownAt: dateTimeString,
  respondedAt: dateTimeString.optional(),
  feedbackUiVersion: z.string().min(1).optional(),
});

export const createTradeFeedbackSchema = tradeFeedbackBaseSchema
  .superRefine((data, ctx) => {
    if (
      data.feedbackStatus === "ANSWERED" &&
      data.selfAssessment == null
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["selfAssessment"],
        message: "ANSWERED 상태에서는 selfAssessment가 필요합니다.",
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
  })
  .transform((data) => ({
    ...data,
    selfAssessment: data.selfAssessment ?? null,
    feedbackUiVersion: data.feedbackUiVersion ?? "v1",
  }));

export const patchTradeFeedbackSchema =
  tradeFeedbackBaseSchema.partial().superRefine((data, ctx) => {
    if (
      data.feedbackStatus === "ANSWERED" &&
      data.selfAssessment == null
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["selfAssessment"],
        message: "ANSWERED 상태로 수정할 때는 selfAssessment가 필요합니다.",
      });
    }

    if (
      data.feedbackStatus === "DISMISSED" &&
      data.selfAssessment !== null
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["selfAssessment"],
        message:
          "DISMISSED 상태로 수정할 때는 selfAssessment를 null로 함께 보내야 합니다.",
      });
    }
  });

const confirmedTradeLogBaseSchema = z.object({
  attemptId: z.string().min(1).nullable().optional(),
  upbitOrderUuid: z.string().min(1),
  orderCreatedAt: dateTimeString,

  market: marketSchema,
  side: z.enum(["BUY", "SELL"]),
  ordType: z.enum(["LIMIT", "MARKET_BUY", "MARKET_SELL", "BEST"]),

  limitPrice: nullableDecimalString.optional(),
  requestedFunds: nullableDecimalString.optional(),
  requestedVolume: nullableDecimalString.optional(),
  timeInForce: z
    .enum(["IOC", "FOK", "POST_ONLY"])
    .nullable()
    .optional(),

  state: z
    .enum(["wait", "watch", "trade", "done", "cancel", "prevented"])
    .nullable()
    .optional(),
  executedVolume: nullableDecimalString.optional(),
  executedFunds: nullableDecimalString.optional(),
  paidFee: nullableDecimalString.optional(),
  remainingVolume: nullableDecimalString.optional(),
  outcomeObservedAt: dateTimeString.nullable().optional(),
});

export const createConfirmedTradeLogSchema =
  confirmedTradeLogBaseSchema.transform((data) => ({
    ...data,
    attemptId: data.attemptId ?? null,
    limitPrice: data.limitPrice ?? null,
    requestedFunds: data.requestedFunds ?? null,
    requestedVolume: data.requestedVolume ?? null,
    timeInForce: data.timeInForce ?? null,
    state: data.state ?? null,
    executedVolume: data.executedVolume ?? null,
    executedFunds: data.executedFunds ?? null,
    paidFee: data.paidFee ?? null,
    remainingVolume: data.remainingVolume ?? null,
    outcomeObservedAt: data.outcomeObservedAt ?? null,
  }));

export const patchConfirmedTradeLogSchema =
  confirmedTradeLogBaseSchema.partial();

export const orderOutcomePatchSchema = z.object({
  upbitOrderUuid: z.string().min(1),
  state: z.enum(["wait", "watch", "trade", "done", "cancel", "prevented"]),
  executedVolume: nullableDecimalString,
  executedFunds: nullableDecimalString,
  paidFee: nullableDecimalString,
  remainingVolume: nullableDecimalString,
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