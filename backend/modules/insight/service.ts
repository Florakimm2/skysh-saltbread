// backend/modules/insight/service.ts

import type { BehaviorSessionRecord } from "@/backend/modules/behavior/types";
import type {
  DashboardInsightResult,
  InsightRequestInput,
  InsightResult,
} from "./types";
import { analyzeInsights } from "./rules"; 

const DEFAULT_TIMEOUT_MS = 30_000;
const RECENT_WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_INSIGHT_SUMMARIES = 50;

const EVENT_LABELS: Record<string, string> = {
  AMOUNT_INPUT: "주문 금액 입력",
  QUANTITY_INPUT: "주문 수량 입력",
  PRICE_INPUT: "주문 가격 입력",
  ORDER_TYPE_CHANGE: "주문 방식 변경",
  BUY_CLICK: "매수 클릭",
  SELL_CLICK: "매도 클릭",
  CANCEL_CLICK: "주문 취소",
  SYMBOL_CHANGE: "종목 변경",
  ORDER_SUBMIT_ATTEMPT: "주문 시도",
};

function getFastApiInsightUrl() {
  const url = process.env.FASTAPI_INSIGHT_URL;
  if (!url) {
    throw new Error("FASTAPI_INSIGHT_URL 환경변수가 설정되지 않았습니다.");
  }
  return url;
}

// 💡 핵심 수정 1: AI 서버가 보내준 전체 JSON 데이터(summary, cards 등)를 그대로 살려서 반환합니다.
function extractInsightFromFastApiResponse(rawText: string): any {
  const trimmed = rawText.trim();
  if (!trimmed) {
    throw new Error("FastAPI 응답이 비어 있습니다.");
  }
  try {
    return JSON.parse(trimmed); 
  } catch {
    return { summary: trimmed, cards: [] };
  }
}

async function fetchWithTimeout(
  url: string,
  options: RequestInit,
  timeoutMs = DEFAULT_TIMEOUT_MS
) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    controller.abort();
  }, timeoutMs);
  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function requestInsightFromFastApi(
  input: InsightRequestInput
): Promise<any> {
  const fastApiUrl = getFastApiInsightUrl();

  const response = await fetchWithTimeout(fastApiUrl, {
    method: "POST",
    headers: {
      Accept: "application/json, text/plain",
      "Content-Type": "application/json",
      "X-API-Key": process.env.FASTAPI_INSIGHT_API_KEY!,
    },
    body: JSON.stringify({
      summaries: input.summaries,
    }),
    cache: "no-store",
  });

  const rawText = await response.text();

  if (!response.ok) {
    throw new Error(
      `FASTAPI_INSIGHT_FAILED_${response.status}: ${rawText.slice(0, 300)}`
    );
  }

  return {
    insight: extractInsightFromFastApiResponse(rawText),
  };
}

function toInsightSummary(record: BehaviorSessionRecord): string {
  const occurredAt = new Intl.DateTimeFormat("ko-KR", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Seoul",
  }).format(new Date(record.occurredAt));
  
  const orderDetails = [
    record.symbol,
    record.side === "BUY" ? "매수" : record.side === "SELL" ? "매도" : null,
    record.orderType === "LIMIT" ? "지정가" : record.orderType === "MARKET" ? "시장가" : null,
    record.amount !== undefined ? `주문 금액 ${Math.round(record.amount).toLocaleString("ko-KR")}원` : null,
  ].filter(Boolean).join(", ");
    
  const behaviors = record.behaviorData.length > 0
      ? record.behaviorData.map(({ eventType, count }) => `${EVENT_LABELS[eventType] ?? eventType} ${count}회`).join(", ")
      : "연결된 행동 데이터 없음";

  return `${occurredAt}: 주문 정보는 ${orderDetails}. 행동 데이터는 ${behaviors}.`;
}

export async function requestDashboardInsight(
  userId: string, 
  records: BehaviorSessionRecord[],
  now = new Date()
): Promise<any> {
  const since = now.getTime() - RECENT_WEEK_MS;
  const recentRecords = (records || [])
    .filter((record) => new Date(record.occurredAt).getTime() >= since)
    .slice(0, MAX_INSIGHT_SUMMARIES);

  const behaviorSummaries = recentRecords.map(toInsightSummary);
  const ruleInsights = await analyzeInsights(userId);
  const ruleSummaries = ruleInsights.map(
    (insight) => `[분석 경고 - ${insight.title}] ${insight.message} (중요도: ${insight.score})`
  );

  const combinedSummaries = [...behaviorSummaries, ...ruleSummaries];

  if (combinedSummaries.length === 0) {
    return { status: "empty", sourceCount: 0 };
  }

  try {
    const result = await requestInsightFromFastApi({ summaries: combinedSummaries });
    const parsedData = result.insight;

    // 💡 핵심 수정 2: 메인 화면 에러 방지를 위해 문장(summary)은 기존 자리에 두고, 카드는 몰래 챙겨서 넘겨줍니다.
    return {
      status: "ready",
      insight: parsedData?.summary || (typeof parsedData === 'string' ? parsedData : "분석 완료"),
      parsedData: parsedData, 
      sourceCount: recentRecords.length,
    };
  } catch (error) {
    console.error("Dashboard insight generation failed", error);
    return { status: "error", sourceCount: recentRecords.length };
  }
}