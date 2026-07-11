// backend/modules/behavior/repository.ts

import { Timestamp } from "firebase-admin/firestore";
import { adminDb } from "@/backend/infrastructure/firebase/firebase-admin";
import type {
  BehaviorEventDoc,
  BehaviorEventInput,
  EmotionPattern,
  RiskAnalysisDoc,
  RiskAnalysisResult,
} from "./types";
import type { OrderContextSnapshotLog } from "@/backend/modules/insight/snapshot-field-aggregator";

const behaviorEventsRef = adminDb.collection("behaviorEvents");
const riskAnalysesRef = adminDb.collection("riskAnalyses");
// ┌─────────────────────────────────────────────────────────┐
// │ 스냅샷 컬렉션: order_context_snapshots (snake_case)      │
// │                                                         │
// │ background.js → POST /api/me/logs/order-context-snapshots│
// │ 가 저장하는 실제 Firestore 컬렉션명.                       │
// │ 2026-07-11 진단으로 확정됨.                                │
// └─────────────────────────────────────────────────────────┘
const snapshotsRef = adminDb.collection("order_context_snapshots");

type ExtraBehaviorEventFields = {
  sessionId?: string;
  pageUrl?: string;
  occurredAt?: string;
  metadata?: Record<string, unknown>;
};

type ExtendedBehaviorEventInput = BehaviorEventInput & ExtraBehaviorEventFields;

type ExtendedBehaviorEventDoc = BehaviorEventDoc & ExtraBehaviorEventFields & {
  occurredAt?: string;
};

function removeUndefined<T extends Record<string, unknown>>(object: T) {
  return Object.fromEntries(
    Object.entries(object).filter(([, value]) => value !== undefined)
  ) as T;
}

export function toIsoString(value: unknown): string {
  if (!value) return new Date().toISOString();

  if (
    typeof value === "object" &&
    value !== null &&
    "toDate" in value &&
    typeof (value as { toDate: () => Date }).toDate === "function"
  ) {
    return (value as { toDate: () => Date }).toDate().toISOString();
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (typeof value === "string") {
    return value;
  }

  return new Date().toISOString();
}

function parseOccurredAt(value?: string) {
  if (!value) return new Date();

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return new Date();
  }

  return date;
}

function mapBehaviorEvent(
  id: string,
  data: FirebaseFirestore.DocumentData
): ExtendedBehaviorEventDoc {
  return {
    id,
    userId: data.userId,
    sessionId: data.sessionId,
    symbol: data.symbol,
    eventType: data.eventType,
    side: data.side ?? undefined,
    orderType: data.orderType ?? undefined,
    price: data.price ?? undefined,
    amount: data.amount ?? undefined,
    quantity: data.quantity ?? undefined,
    pageUrl: data.pageUrl ?? undefined,
    occurredAt: toIsoString(data.occurredAt),
    createdAt: toIsoString(data.createdAt),
    metadata: data.metadata ?? undefined,
  } as ExtendedBehaviorEventDoc;
}

export async function createBehaviorEvent(
  userId: string,
  input: ExtendedBehaviorEventInput
): Promise<ExtendedBehaviorEventDoc> {
  const docRef = behaviorEventsRef.doc();
  const occurredAtDate = parseOccurredAt(input.occurredAt);
  const now = Timestamp.now();

  const data = removeUndefined({
    id: docRef.id,
    userId,
    sessionId: input.sessionId,
    symbol: input.symbol,
    eventType: input.eventType,
    side: input.side,
    orderType: input.orderType,
    price: input.price,
    amount: input.amount,
    quantity: input.quantity,
    pageUrl: input.pageUrl,
    occurredAt: Timestamp.fromDate(occurredAtDate),
    createdAt: now,
    metadata: input.metadata,
  });

  await docRef.set(data);

  return {
    id: docRef.id,
    userId,
    sessionId: input.sessionId,
    symbol: input.symbol,
    eventType: input.eventType,
    side: input.side,
    orderType: input.orderType,
    price: input.price,
    amount: input.amount,
    quantity: input.quantity,
    pageUrl: input.pageUrl,
    occurredAt: occurredAtDate.toISOString(),
    createdAt: toIsoString(now),
    metadata: input.metadata,
  };
}

export async function findRecentBehaviorEvents(params: {
  userId: string;
  symbol: string;
  minutes: number;
}): Promise<ExtendedBehaviorEventDoc[]> {
  const sinceMs = Date.now() - params.minutes * 60 * 1000;
  const snapshot = await behaviorEventsRef
    .where("userId", "==", params.userId)
    .orderBy("createdAt", "desc")
    .limit(300)
    .get();

  return snapshot.docs
    .map((doc) => mapBehaviorEvent(doc.id, doc.data()))
    .filter((event) => {
      const eventMs = new Date(event.createdAt).getTime();
      return event.symbol === params.symbol && eventMs >= sinceMs;
    });
}

export async function findBehaviorEventsByUser(params: {
  userId: string;
  limit?: number;
}): Promise<ExtendedBehaviorEventDoc[]> {
  const limit = params.limit ?? 20;
  const snapshot = await behaviorEventsRef
    .where("userId", "==", params.userId)
    .orderBy("createdAt", "desc")
    .limit(limit)
    .get();

  return snapshot.docs.map((doc) => mapBehaviorEvent(doc.id, doc.data()));
}

export async function findAllBehaviorEventsByUser(
  userId: string
): Promise<ExtendedBehaviorEventDoc[]> {
  const snapshot = await behaviorEventsRef.where("userId", "==", userId).get();

  return snapshot.docs
    .map((doc) => mapBehaviorEvent(doc.id, doc.data()))
    .sort(
      (left, right) =>
        new Date(right.createdAt).getTime() -
        new Date(left.createdAt).getTime()
    );
}

export async function findRiskAnalysesByUser(
  userId: string
): Promise<RiskAnalysisDoc[]> {
  const snapshot = await riskAnalysesRef.where("userId", "==", userId).get();

  return snapshot.docs
    .map((doc) => {
      const data = doc.data();
      return {
        id: doc.id,
        userId: data.userId,
        symbol: data.symbol,
        riskLevel: data.riskLevel,
        score: data.score,
        cooldownRequired: data.cooldownRequired,
        cooldownSeconds: data.cooldownSeconds,
        matchedPatterns: Array.isArray(data.matchedPatterns)
          ? (data.matchedPatterns as EmotionPattern[])
          : [],
        reasons: Array.isArray(data.reasons) ? data.reasons : [],
        createdAt: toIsoString(data.createdAt),
      } as RiskAnalysisDoc;
    })
    .sort(
      (left, right) =>
        new Date(right.createdAt).getTime() -
        new Date(left.createdAt).getTime()
    );
}

export async function createRiskAnalysis(params: {
  userId: string;
  symbol: string;
  result: RiskAnalysisResult;
}): Promise<RiskAnalysisDoc> {
  const docRef = riskAnalysesRef.doc();
  const now = Timestamp.now();

  const data = {
    id: docRef.id,
    userId: params.userId,
    symbol: params.symbol,
    riskLevel: params.result.riskLevel,
    score: params.result.score,
    cooldownRequired: params.result.cooldownRequired,
    cooldownSeconds: params.result.cooldownSeconds,
    matchedPatterns: params.result.matchedPatterns,
    reasons: params.result.reasons,
    createdAt: now,
  };

  await docRef.set(data);

  return {
    id: data.id,
    userId: data.userId,
    symbol: data.symbol,
    riskLevel: data.riskLevel,
    score: data.score,
    cooldownRequired: data.cooldownRequired,
    cooldownSeconds: data.cooldownSeconds,
    matchedPatterns: data.matchedPatterns,
    reasons: data.reasons,
    createdAt: toIsoString(now),
  };
}

// ┌─────────────────────────────────────────────────────────┐
// │ 필드 인사이트용 최근 스냅샷 조회                            │
// │ 컬렉션: order_context_snapshots                         │
// └─────────────────────────────────────────────────────────┘

function mapDocToSnapshotLog(
  doc: FirebaseFirestore.QueryDocumentSnapshot
): OrderContextSnapshotLog {
  const data = doc.data();
  return {
    snapshotId: data.snapshotId ?? doc.id,
    attemptId: data.attemptId ?? null,
    snapshotTrigger: data.snapshotTrigger ?? "UNKNOWN",
    capturedAt: toIsoString(data.capturedAt),
    market: data.market ?? "UNKNOWN",
    side: data.side ?? "UNKNOWN",
    orderMode: data.orderMode ?? "UNKNOWN",
    entryPoint: data.entryPoint ?? "NORMAL",
    intentPrice: data.intentPrice ?? null,
    intentQuantity: data.intentQuantity ?? null,
    intentAmount: data.intentAmount ?? null,
    requestedBalanceRatio: data.requestedBalanceRatio ?? null,
    allocationPresetPercent: data.allocationPresetPercent ?? null,
    draftDurationMs: data.draftDurationMs ?? null,
    lastEditToSnapshotMs: data.lastEditToSnapshotMs ?? null,
    draftEditCount: data.draftEditCount ?? null,
    amountChangeRate: data.amountChangeRate ?? null,
    modeChangedToMarket: data.modeChangedToMarket ?? false,
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
    draftResetCount3m: data.draftResetCount3m ?? 0,
    tradePriceAtSnapshot: data.tradePriceAtSnapshot ?? data.tradePriceAtIntent ?? null,
    shortTermReturn5m: data.shortTermReturn5m ?? null,
    signedChangeRate: data.signedChangeRate ?? null,
    spreadRate: data.spreadRate ?? null,
    marketRiskFlags: Array.isArray(data.marketRiskFlags) ? data.marketRiskFlags : [],
    pricePositionIn5mRange: data.pricePositionIn5mRange ?? null,
    volumeSpikeRatio5m: data.volumeSpikeRatio5m ?? null,
    baseAssetAvgBuyPriceBeforeSnapshot: data.baseAssetAvgBuyPriceBeforeSnapshot ?? null,
    priceVsAvgBuyRateAtSnapshot: data.priceVsAvgBuyRateAtSnapshot ?? null,
  } as OrderContextSnapshotLog;
}

export async function findRecentSnapshots(params: {
  userId: string;
  since: Date;
  limit?: number;
}): Promise<OrderContextSnapshotLog[]> {
  const limit = params.limit ?? 500;

  const snapshot = await snapshotsRef
    .where("userId", "==", params.userId)
    .get();

  if (snapshot.docs.length === 0) {
    return [];
  }

  return snapshot.docs
    .map(mapDocToSnapshotLog)
    .filter((log) => new Date(log.capturedAt).getTime() >= params.since.getTime())
    .sort((a, b) => new Date(b.capturedAt).getTime() - new Date(a.capturedAt).getTime())
    .slice(0, limit);
}