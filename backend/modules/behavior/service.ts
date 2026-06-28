// backend/modules/behavior/service.ts

import { marketService } from "@/backend/modules/market/service";
import { analyzeEmotionRisk } from "./analyzer";
import {
  createBehaviorEvent,
  createRiskAnalysis,
  findRecentBehaviorEvents,
} from "./repository";
import type {
  AnalyzeRiskInput,
  BehaviorEventInput,
  RiskAnalysisResult,
} from "./types";

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
    return createBehaviorEvent({
      userId: params.userId,
      input: params.input,
    });
  }

  export async function getRecentBehaviorLogs(params: {
    userId: string;
    limit?: number;
  }) {
    return findRecentBehaviorEvents({
      userId: params.userId,
      limit: params.limit,
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