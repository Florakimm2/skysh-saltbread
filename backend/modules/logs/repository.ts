// backend/modules/logs/repository.ts

import { randomUUID } from "crypto";
import { Timestamp } from "firebase-admin/firestore";
import { ApiError } from "@/backend/common/api";
import { adminDb } from "@/backend/infrastructure/firebase/firebase-admin";
import type {
  ConfirmedTradeLogDTO,
  GuardrailReactionDTO,
  LogListParams,
  OrderContextSnapshotDTO,
  OrderOutcomePatchDTO,
  TradeFeedbackDTO,
} from "./types";

const snapshotsRef = adminDb.collection("order_context_snapshots");
const reactionsRef = adminDb.collection("guardrail_reactions");
const feedbacksRef = adminDb.collection("trade_feedbacks");
const confirmedTradesRef = adminDb.collection("confirmed_trade_logs");

const DATE_FIELDS = new Set([
  "capturedAt",
  "reactedAt",
  "feedbackShownAt",
  "respondedAt",
  "orderCreatedAt",
  "outcomeObservedAt",
  "createdAt",
  "updatedAt",
]);

function removeUndefined<T extends Record<string, unknown>>(object: T) {
  return Object.fromEntries(
    Object.entries(object).filter(([, value]) => value !== undefined)
  ) as T;
}

function toIsoString(value: unknown): string {
  if (!value) return new Date().toISOString();

  if (
    typeof value === "object" &&
    value !== null &&
    "toDate" in value &&
    typeof (value as { toDate: () => Date }).toDate === "function"
  ) {
    return (value as { toDate: () => Date }).toDate().toISOString();
  }

  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string") return value;

  return new Date().toISOString();
}

function nullableIsoString(value: unknown): string | null {
  if (!value) return null;
  return toIsoString(value);
}

function toTimestamp(value?: string | null) {
  if (!value) return null;

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;

  return Timestamp.fromDate(date);
}

function prepareFirestoreData(input: Record<string, unknown>) {
  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(input)) {
    if (value === undefined) continue;

    if (DATE_FIELDS.has(key)) {
      if (value === null) {
        result[key] = null;
      } else if (typeof value === "string") {
        result[key] = toTimestamp(value);
      } else {
        result[key] = value;
      }
      continue;
    }

    result[key] = value;
  }

  return result;
}

function normalizeLimit(limit?: number) {
  if (!limit || !Number.isFinite(limit)) return 50;
  return Math.min(Math.max(Math.floor(limit), 1), 100);
}

function isInTimeRange(params: {
  value: string;
  from?: string;
  to?: string;
}) {
  const currentMs = new Date(params.value).getTime();

  if (params.from) {
    const fromMs = new Date(params.from).getTime();
    if (!Number.isNaN(fromMs) && currentMs < fromMs) return false;
  }

  if (params.to) {
    const toMs = new Date(params.to).getTime();
    if (!Number.isNaN(toMs) && currentMs > toMs) return false;
  }

  return true;
}

function snapshotDocToDTO(
  id: string,
  data: FirebaseFirestore.DocumentData
): OrderContextSnapshotDTO {
  return {
    snapshotId: id,
    userId: data.userId,

    attemptId: data.attemptId ?? null,
    snapshotTrigger: data.snapshotTrigger,
    capturedAt: toIsoString(data.capturedAt),

    market: data.market,
    side: data.side,
    orderMode: data.orderMode,
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

    createdAt: toIsoString(data.createdAt),
    updatedAt: toIsoString(data.updatedAt),
  };
}

function reactionDocToDTO(
  id: string,
  data: FirebaseFirestore.DocumentData
): GuardrailReactionDTO {
  return {
    reactionId: id,
    userId: data.userId,
    snapshotId: data.snapshotId,
    action: data.action,
    reactedAt: toIsoString(data.reactedAt),
    reactionUiVersion: data.reactionUiVersion ?? "v1",
    createdAt: toIsoString(data.createdAt),
    updatedAt: toIsoString(data.updatedAt),
  };
}

function feedbackDocToDTO(
  id: string,
  data: FirebaseFirestore.DocumentData
): TradeFeedbackDTO {
  return {
    feedbackId: id,
    userId: data.userId,
    attemptId: data.attemptId,
    feedbackStatus: data.feedbackStatus,
    selfAssessment: data.selfAssessment ?? null,
    feedbackShownAt: toIsoString(data.feedbackShownAt),
    respondedAt: toIsoString(data.respondedAt),
    feedbackUiVersion: data.feedbackUiVersion ?? "v1",
    createdAt: toIsoString(data.createdAt),
    updatedAt: toIsoString(data.updatedAt),
  };
}

function confirmedTradeDocToDTO(
  id: string,
  data: FirebaseFirestore.DocumentData
): ConfirmedTradeLogDTO {
  return {
    tradeLogId: id,
    userId: data.userId,

    attemptId: data.attemptId ?? null,
    upbitOrderUuid: data.upbitOrderUuid,
    orderCreatedAt: toIsoString(data.orderCreatedAt),

    market: data.market,
    side: data.side,
    ordType: data.ordType,

    limitPrice: data.limitPrice ?? null,
    requestedFunds: data.requestedFunds ?? null,
    requestedVolume: data.requestedVolume ?? null,
    timeInForce: data.timeInForce ?? null,

    state: data.state ?? null,
    executedVolume: data.executedVolume ?? null,
    executedFunds: data.executedFunds ?? null,
    paidFee: data.paidFee ?? null,
    remainingVolume: data.remainingVolume ?? null,
    outcomeObservedAt: nullableIsoString(data.outcomeObservedAt),

    createdAt: toIsoString(data.createdAt),
    updatedAt: toIsoString(data.updatedAt),
  };
}

async function listOwnedDocs<T>(params: {
  collection: FirebaseFirestore.CollectionReference;
  userId: string;
  limit?: number;
  market?: string;
  from?: string;
  to?: string;
  attemptId?: string;
  snapshotId?: string;
  upbitOrderUuid?: string;
  dateField: string;
  converter: (id: string, data: FirebaseFirestore.DocumentData) => T;
}) {
  const limit = normalizeLimit(params.limit);

  const snapshot = await params.collection
    .where("userId", "==", params.userId)
    .orderBy("createdAt", "desc")
    .limit(300)
    .get();

  return snapshot.docs
    .map((doc) => params.converter(doc.id, doc.data()))
    .filter((item) => {
      const record = item as Record<string, unknown>;

      if (params.market && record.market !== params.market) return false;
      if (params.attemptId && record.attemptId !== params.attemptId) return false;
      if (params.snapshotId && record.snapshotId !== params.snapshotId) {
        return false;
      }
      if (
        params.upbitOrderUuid &&
        record.upbitOrderUuid !== params.upbitOrderUuid
      ) {
        return false;
      }

      const dateValue = record[params.dateField];

      if (typeof dateValue === "string") {
        return isInTimeRange({
          value: dateValue,
          from: params.from,
          to: params.to,
        });
      }

      return true;
    })
    .slice(0, limit);
}

async function getOwnedDoc<T>(params: {
  collection: FirebaseFirestore.CollectionReference;
  userId: string;
  id: string;
  converter: (id: string, data: FirebaseFirestore.DocumentData) => T;
}) {
  const snapshot = await params.collection.doc(params.id).get();

  if (!snapshot.exists) return null;

  const data = snapshot.data() ?? {};

  if (data.userId !== params.userId) return null;

  return params.converter(snapshot.id, data);
}

async function patchOwnedDoc<T>(params: {
  collection: FirebaseFirestore.CollectionReference;
  userId: string;
  id: string;
  patch: Record<string, unknown>;
  converter: (id: string, data: FirebaseFirestore.DocumentData) => T;
}) {
  const existing = await getOwnedDoc({
    collection: params.collection,
    userId: params.userId,
    id: params.id,
    converter: params.converter,
  });

  if (!existing) return null;

  await params.collection.doc(params.id).set(
    prepareFirestoreData(
      removeUndefined({
        ...params.patch,
        updatedAt: new Date().toISOString(),
      })
    ),
    { merge: true }
  );

  const updated = await params.collection.doc(params.id).get();

  return params.converter(updated.id, updated.data() ?? {});
}

async function deleteOwnedDoc(params: {
  collection: FirebaseFirestore.CollectionReference;
  userId: string;
  id: string;
}) {
  const snapshot = await params.collection.doc(params.id).get();

  if (!snapshot.exists) return false;

  const data = snapshot.data();

  if (data?.userId !== params.userId) return false;

  await params.collection.doc(params.id).delete();

  return true;
}

export async function createOrderContextSnapshot(params: {
  userId: string;
  input: Record<string, unknown>;
}) {
  const requestedSnapshotId =
    typeof params.input.snapshotId === "string"
      ? params.input.snapshotId
      : null;
  const snapshotId = requestedSnapshotId || randomUUID();
  const now = new Date().toISOString();
  const existing = await snapshotsRef.doc(snapshotId).get();

  if (existing.exists) {
    const data = existing.data() ?? {};

    if (data.userId === params.userId) {
      return snapshotDocToDTO(snapshotId, data);
    }

    throw new ApiError(
      409,
      "SNAPSHOT_ID_CONFLICT",
      "이미 다른 사용자에게 저장된 snapshotId입니다."
    );
  }

  const data = prepareFirestoreData({
    snapshotId,
    userId: params.userId,
    ...params.input,
    capturedAt: params.input.capturedAt ?? now,
    createdAt: now,
    updatedAt: now,
  });

  await snapshotsRef.doc(snapshotId).set(data);

  const saved = await snapshotsRef.doc(snapshotId).get();

  return snapshotDocToDTO(snapshotId, saved.data() ?? {});
}

export async function listOrderContextSnapshots(params: LogListParams) {
  return listOwnedDocs({
    collection: snapshotsRef,
    userId: params.userId,
    limit: params.limit,
    market: params.market,
    from: params.from,
    to: params.to,
    attemptId: params.attemptId,
    dateField: "capturedAt",
    converter: snapshotDocToDTO,
  });
}

export async function getOrderContextSnapshot(params: {
  userId: string;
  snapshotId: string;
}) {
  return getOwnedDoc({
    collection: snapshotsRef,
    userId: params.userId,
    id: params.snapshotId,
    converter: snapshotDocToDTO,
  });
}

export async function patchOrderContextSnapshot(params: {
  userId: string;
  snapshotId: string;
  patch: Record<string, unknown>;
}) {
  return patchOwnedDoc({
    collection: snapshotsRef,
    userId: params.userId,
    id: params.snapshotId,
    patch: params.patch,
    converter: snapshotDocToDTO,
  });
}

export async function deleteOrderContextSnapshot(params: {
  userId: string;
  snapshotId: string;
}) {
  return deleteOwnedDoc({
    collection: snapshotsRef,
    userId: params.userId,
    id: params.snapshotId,
  });
}

export async function createGuardrailReaction(params: {
  userId: string;
  input: Record<string, unknown>;
}) {
  const reactionId = randomUUID();
  const now = new Date().toISOString();

  const data = prepareFirestoreData({
    reactionId,
    userId: params.userId,
    ...params.input,
    reactedAt: params.input.reactedAt ?? now,
    createdAt: now,
    updatedAt: now,
  });

  await reactionsRef.doc(reactionId).set(data);

  const saved = await reactionsRef.doc(reactionId).get();

  return reactionDocToDTO(reactionId, saved.data() ?? {});
}

export async function listGuardrailReactions(params: LogListParams) {
  return listOwnedDocs({
    collection: reactionsRef,
    userId: params.userId,
    limit: params.limit,
    from: params.from,
    to: params.to,
    snapshotId: params.snapshotId,
    dateField: "reactedAt",
    converter: reactionDocToDTO,
  });
}

export async function getGuardrailReaction(params: {
  userId: string;
  reactionId: string;
}) {
  return getOwnedDoc({
    collection: reactionsRef,
    userId: params.userId,
    id: params.reactionId,
    converter: reactionDocToDTO,
  });
}

export async function patchGuardrailReaction(params: {
  userId: string;
  reactionId: string;
  patch: Record<string, unknown>;
}) {
  return patchOwnedDoc({
    collection: reactionsRef,
    userId: params.userId,
    id: params.reactionId,
    patch: params.patch,
    converter: reactionDocToDTO,
  });
}

export async function deleteGuardrailReaction(params: {
  userId: string;
  reactionId: string;
}) {
  return deleteOwnedDoc({
    collection: reactionsRef,
    userId: params.userId,
    id: params.reactionId,
  });
}

export async function createTradeFeedback(params: {
  userId: string;
  input: Record<string, unknown>;
}) {
  const feedbackId = randomUUID();
  const now = new Date().toISOString();

  const data = prepareFirestoreData({
    feedbackId,
    userId: params.userId,
    ...params.input,
    respondedAt: params.input.respondedAt ?? now,
    createdAt: now,
    updatedAt: now,
  });

  await feedbacksRef.doc(feedbackId).set(data);

  const saved = await feedbacksRef.doc(feedbackId).get();

  return feedbackDocToDTO(feedbackId, saved.data() ?? {});
}

export async function listTradeFeedbacks(params: LogListParams) {
  return listOwnedDocs({
    collection: feedbacksRef,
    userId: params.userId,
    limit: params.limit,
    from: params.from,
    to: params.to,
    attemptId: params.attemptId,
    dateField: "respondedAt",
    converter: feedbackDocToDTO,
  });
}

export async function getTradeFeedback(params: {
  userId: string;
  feedbackId: string;
}) {
  return getOwnedDoc({
    collection: feedbacksRef,
    userId: params.userId,
    id: params.feedbackId,
    converter: feedbackDocToDTO,
  });
}

export async function patchTradeFeedback(params: {
  userId: string;
  feedbackId: string;
  patch: Record<string, unknown>;
}) {
  return patchOwnedDoc({
    collection: feedbacksRef,
    userId: params.userId,
    id: params.feedbackId,
    patch: params.patch,
    converter: feedbackDocToDTO,
  });
}

export async function deleteTradeFeedback(params: {
  userId: string;
  feedbackId: string;
}) {
  return deleteOwnedDoc({
    collection: feedbacksRef,
    userId: params.userId,
    id: params.feedbackId,
  });
}

export async function createConfirmedTradeLog(params: {
  userId: string;
  input: Record<string, unknown>;
}) {
  const existingSnapshot = await confirmedTradesRef
    .where("userId", "==", params.userId)
    .where("upbitOrderUuid", "==", params.input.upbitOrderUuid)
    .limit(1)
    .get();

  if (!existingSnapshot.empty) {
    const doc = existingSnapshot.docs[0];
    return confirmedTradeDocToDTO(doc.id, doc.data());
  }

  const tradeLogId = randomUUID();
  const now = new Date().toISOString();

  const data = prepareFirestoreData({
    tradeLogId,
    userId: params.userId,
    ...params.input,
    createdAt: now,
    updatedAt: now,
  });

  await confirmedTradesRef.doc(tradeLogId).set(data);

  const saved = await confirmedTradesRef.doc(tradeLogId).get();

  return confirmedTradeDocToDTO(tradeLogId, saved.data() ?? {});
}

export async function listConfirmedTradeLogs(params: LogListParams) {
  return listOwnedDocs({
    collection: confirmedTradesRef,
    userId: params.userId,
    limit: params.limit,
    market: params.market,
    from: params.from,
    to: params.to,
    attemptId: params.attemptId,
    upbitOrderUuid: params.upbitOrderUuid,
    dateField: "orderCreatedAt",
    converter: confirmedTradeDocToDTO,
  });
}

export async function getConfirmedTradeLog(params: {
  userId: string;
  tradeLogId: string;
}) {
  return getOwnedDoc({
    collection: confirmedTradesRef,
    userId: params.userId,
    id: params.tradeLogId,
    converter: confirmedTradeDocToDTO,
  });
}

export async function patchConfirmedTradeLog(params: {
  userId: string;
  tradeLogId: string;
  patch: Record<string, unknown>;
}) {
  return patchOwnedDoc({
    collection: confirmedTradesRef,
    userId: params.userId,
    id: params.tradeLogId,
    patch: params.patch,
    converter: confirmedTradeDocToDTO,
  });
}

export async function deleteConfirmedTradeLog(params: {
  userId: string;
  tradeLogId: string;
}) {
  return deleteOwnedDoc({
    collection: confirmedTradesRef,
    userId: params.userId,
    id: params.tradeLogId,
  });
}

export async function patchConfirmedTradeOutcome(params: {
  userId: string;
  input: OrderOutcomePatchDTO;
}) {
  const snapshot = await confirmedTradesRef
    .where("userId", "==", params.userId)
    .where("upbitOrderUuid", "==", params.input.upbitOrderUuid)
    .limit(1)
    .get();

  if (snapshot.empty) return null;

  const doc = snapshot.docs[0];
  const current = confirmedTradeDocToDTO(doc.id, doc.data());

  if (current.outcomeObservedAt) {
    const currentMs = new Date(current.outcomeObservedAt).getTime();
    const nextMs = new Date(params.input.outcomeObservedAt).getTime();

    if (!Number.isNaN(currentMs) && !Number.isNaN(nextMs) && nextMs < currentMs) {
      return {
        updated: false,
        reason: "OUTDATED_OUTCOME_IGNORED",
        data: current,
      };
    }
  }

  await confirmedTradesRef.doc(doc.id).set(
    prepareFirestoreData({
      state: params.input.state,
      executedVolume: params.input.executedVolume,
      executedFunds: params.input.executedFunds,
      paidFee: params.input.paidFee,
      remainingVolume: params.input.remainingVolume,
      outcomeObservedAt: params.input.outcomeObservedAt,
      updatedAt: new Date().toISOString(),
    }),
    { merge: true }
  );

  const updated = await confirmedTradesRef.doc(doc.id).get();

  return {
    updated: true,
    data: confirmedTradeDocToDTO(updated.id, updated.data() ?? {}),
  };
}
