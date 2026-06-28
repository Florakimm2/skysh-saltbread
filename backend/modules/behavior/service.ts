// backend/modules/behavior/service.ts

import { marketService } from "@/backend/modules/market/service";
import { analyzeEmotionRisk } from "./analyzer";
import {
  createBehaviorEvent,
  createRiskAnalysis,
  findAllBehaviorEventsByUser,
  findBehaviorEventsByUser,
  findRecentBehaviorEvents,
  findRiskAnalysesByUser,
} from "./repository";
import type {
  AnalyzeRiskInput,
  BehaviorEventCount,
  BehaviorEventDoc,
  BehaviorEventType,
  BehaviorEventInput,
  PastTrendRecord,
  RiskAnalysisResult,
} from "./types";

const ANALYSIS_BEHAVIOR_WINDOW_MS = 5 * 60 * 1000;

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

export async function getPastTrendRecords(
  userId: string
): Promise<PastTrendRecord[]> {
  const [analyses, behaviorEvents] = await Promise.all([
    findRiskAnalysesByUser(userId),
    findAllBehaviorEventsByUser(userId),
  ]);

  return analyses.map((analysis) => {
    const analysisTime = new Date(analysis.createdAt).getTime();
    const relatedEvents = behaviorEvents.filter((event) => {
      const eventTime = new Date(event.createdAt).getTime();

      return (
        event.symbol === analysis.symbol &&
        eventTime <= analysisTime &&
        eventTime >= analysisTime - ANALYSIS_BEHAVIOR_WINDOW_MS
      );
    });

    return {
      id: analysis.id,
      detectedAt: analysis.createdAt,
      patterns: analysis.matchedPatterns,
      behaviorData: aggregateBehaviorEvents(relatedEvents),
    };
  });
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
