// backend/modules/behavior/service.ts
//
// 행동 이벤트 기록 및 실시간 감정 매매 분석 전용.
// AI 인사이트 관련 함수는 backend/modules/insight/service.ts에 있다.

import { marketService } from "@/backend/modules/market/service";
import { analyzeEmotionRisk } from "./analyzer";
import {
  createBehaviorEvent,
  createRiskAnalysis,
  findAllBehaviorEventsByUser,
  findBehaviorEventsByUser,
  findRecentBehaviorEvents,
} from "./repository";
import type {
  AnalyzeRiskInput,
  BehaviorEventCount,
  BehaviorEventDoc,
  BehaviorEventType,
  BehaviorEventInput,
  BehaviorSessionRecord,
  RiskAnalysisResult,
} from "./types";

const BEHAVIOR_EVENT_ORDER: BehaviorEventType[] = [
  "ORDER_SUBMIT_ATTEMPT",
  "BUY_CLICK",
  "SELL_CLICK",
  "AMOUNT_INPUT",
  "QUANTITY_INPUT",
  "PRICE_INPUT",
  "ORDER_TYPE_CHANGE",
  "CANCEL_CLICK",
  "SYMBOL_CHANGE",
];

/*
export async function recordBehaviorEvent(
  userId: string,
  input: BehaviorEventInput
) {
  return createBehaviorEvent(userId, input);
}*/

export async function recordBehaviorEvent(params: {
  userId: string;
  input: BehaviorEventInput;
}) {
  return createBehaviorEvent(params.userId, params.input);
}

export async function getRecentBehaviorLogs(params: {
  userId: string;
  limit?: number;
}) {
  return findBehaviorEventsByUser({
    userId: params.userId,
    limit: params.limit,
  });
}

function aggregateBehaviorEvents(
  events: BehaviorEventDoc[]
): BehaviorEventCount[] {
  const counts = new Map<BehaviorEventType, number>();

  for (const event of events) {
    counts.set(event.eventType, (counts.get(event.eventType) ?? 0) + 1);
  }

  return BEHAVIOR_EVENT_ORDER.flatMap((eventType) => {
    const count = counts.get(eventType);
    return count ? [{ eventType, count }] : [];
  });
}

function getBehaviorEventTime(event: BehaviorEventDoc) {
  const occurredAt = Date.parse(event.occurredAt);
  return Number.isNaN(occurredAt) ? Date.parse(event.createdAt) : occurredAt;
}

function toBehaviorSessionRecord(
  events: BehaviorEventDoc[]
): BehaviorSessionRecord {
  const sortedEvents = [...events].sort(
    (left, right) => getBehaviorEventTime(right) - getBehaviorEventTime(left)
  );
  const latestEvent = sortedEvents[0];
  const orderEvent =
    sortedEvents.find((event) => event.eventType === "ORDER_SUBMIT_ATTEMPT") ??
    latestEvent;
  const side =
    orderEvent.side ?? sortedEvents.find((event) => event.side)?.side;
  const orderType =
    orderEvent.orderType ??
    sortedEvents.find((event) => event.orderType)?.orderType;
  const amount =
    orderEvent.amount ??
    sortedEvents.find((event) => event.amount !== undefined)?.amount;

  return {
    id: latestEvent.sessionId
      ? `${latestEvent.sessionId}:${latestEvent.symbol}`
      : latestEvent.id,
    sessionId: latestEvent.sessionId,
    occurredAt: latestEvent.occurredAt || latestEvent.createdAt,
    symbol: orderEvent.symbol,
    side,
    orderType,
    amount,
    behaviorData: aggregateBehaviorEvents(sortedEvents),
  };
}

export async function getBehaviorSessionRecords(
  userId: string
): Promise<BehaviorSessionRecord[]> {
  const behaviorEvents = await findAllBehaviorEventsByUser(userId);
  const eventGroups = new Map<string, BehaviorEventDoc[]>();

  for (const event of behaviorEvents) {
    const groupKey = event.sessionId
      ? `session:${event.sessionId}:${event.symbol}`
      : `event:${event.id}`;
    const group = eventGroups.get(groupKey) ?? [];
    group.push(event);
    eventGroups.set(groupKey, group);
  }

  return [...eventGroups.values()]
    .map(toBehaviorSessionRecord)
    .sort(
      (left, right) =>
        Date.parse(right.occurredAt) - Date.parse(left.occurredAt)
    );
}

export async function analyzeCurrentRisk(
  userId: string,
  input: AnalyzeRiskInput
): Promise<RiskAnalysisResult> {
  const recentEvents = await findRecentBehaviorEvents({
    userId,
    symbol: input.symbol,
    minutes: 5,
  });

  const marketSnapshot = await marketService.getMarketSnapshot(input.symbol);

  const result = analyzeEmotionRisk({
    recentEvents,
    marketSnapshot,
    currentOrder: input.currentOrder,
  });

  await createRiskAnalysis({
    userId,
    symbol: input.symbol,
    result,
  });

  return result;
}