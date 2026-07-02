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

const behaviorEventsRef = adminDb.collection("behaviorEvents");
const riskAnalysesRef = adminDb.collection("riskAnalyses");

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

/**
 * 행동 로그 저장.
 *
 * 기존 함수 시그니처 유지:
 * createBehaviorEvent(userId, input)
 *
 * 이렇게 해야 service.ts의 기존 호출 방식이 깨지지 않는다.
 */
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

/**
 * analyze API용 최근 행동 로그 조회.
 *
 * 기존 함수 유지 필수.
 * analyzeCurrentRisk 쪽에서 이 함수를 사용할 가능성이 높다.
 */
export async function findRecentBehaviorEvents(params: {
  userId: string;
  symbol: string;
  minutes: number;
}): Promise<ExtendedBehaviorEventDoc[]> {
  const sinceMs = Date.now() - params.minutes * 60 * 1000;

  /**
   * Firestore 복합 인덱스 문제를 피하기 위해
   * userId 기준 최근 300개를 가져온 뒤 JS에서 symbol/time 필터링.
   */
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

/**
 * events route의 GET 테스트용.
 * 최근 저장 로그 확인에 사용.
 */
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

/**
 * 대시보드 행동 세션 조합용 전체 행동 로그 조회.
 *
 * userId 단일 조건만 Firestore에 전달하고 정렬은 서버에서 수행해
 * 별도 복합 인덱스 없이도 기존 프로젝트에서 바로 동작하게 한다.
 */
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

/**
 * 대시보드에 표시할 사용자의 전체 위험 분석 기록 조회.
 */
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

/**
 * 분석 결과 저장.
 *
 * 기존 함수 유지 필수.
 * analyze route/service에서 사용한다.
 */
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
