// backend/modules/insight/service.ts

import type { PastTrendRecord } from "@/backend/modules/behavior/types";
import type {
  DashboardInsightResult,
  InsightRequestInput,
  InsightResult,
} from "./types";

const DEFAULT_TIMEOUT_MS = 30_000;
const RECENT_WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_INSIGHT_SUMMARIES = 50;

const PATTERN_LABELS: Record<string, string> = {
  FOMO_CHASING: "급등 추격 매수",
  HESITATION: "주문 망설임",
  CANCEL_REPEAT: "반복 취소",
  ORDER_TYPE_SWITCHING: "주문 방식 반복 변경",
  OVER_LEVERAGING: "과도한 투자 비중",
  ORDERBOOK_CHASING: "호가 따라가기",
};

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

function extractInsightFromFastApiResponse(rawText: string): string {
  const trimmed = rawText.trim();

  if (!trimmed) {
    throw new Error("FastAPI 응답이 비어 있습니다.");
  }

  try {
    const parsed = JSON.parse(trimmed);

    // FastAPI가 그냥 JSON string으로 반환하는 경우
    if (typeof parsed === "string") {
      return parsed;
    }

    // FastAPI가 객체로 반환하는 경우까지 방어
    if (parsed && typeof parsed === "object") {
      const objectValue = parsed as Record<string, unknown>;

      const candidateKeys = [
        "insight",
        "result",
        "summaries",
        "summary",
        "output",
        "data",
      ];

      for (const key of candidateKeys) {
        const value = objectValue[key];

        if (typeof value === "string") {
          return value;
        }
      }

      return JSON.stringify(parsed);
    }

    return String(parsed);
  } catch {
    // text/plain으로 문자열만 반환하는 경우
    return trimmed;
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
): Promise<InsightResult> {
  const fastApiUrl = getFastApiInsightUrl();

  const response = await fetchWithTimeout(fastApiUrl, {
    method: "POST",
    headers: {
      Accept: "application/json, text/plain",
      "Content-Type": "application/json",
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

function toInsightSummary(record: PastTrendRecord): string {
  const detectedAt = new Intl.DateTimeFormat("ko-KR", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Seoul",
  }).format(new Date(record.detectedAt));
  const patterns =
    record.patterns.length > 0
      ? record.patterns
          .map((pattern) => PATTERN_LABELS[pattern] ?? pattern)
          .join(", ")
      : "뚜렷한 감정 매매 패턴 없음";
  const behaviors =
    record.behaviorData.length > 0
      ? record.behaviorData
          .map(
            ({ eventType, count }) =>
              `${EVENT_LABELS[eventType] ?? eventType} ${count}회`
          )
          .join(", ")
      : "연결된 행동 데이터 없음";

  return `${detectedAt}: 감지 패턴은 ${patterns}. 행동 데이터는 ${behaviors}.`;
}

export async function requestDashboardInsight(
  records: PastTrendRecord[],
  now = new Date()
): Promise<DashboardInsightResult> {
  const since = now.getTime() - RECENT_WEEK_MS;
  const recentRecords = records
    .filter((record) => new Date(record.detectedAt).getTime() >= since)
    .slice(0, MAX_INSIGHT_SUMMARIES);

  if (recentRecords.length === 0) {
    return {
      status: "empty",
      sourceCount: 0,
    };
  }

  try {
    const result = await requestInsightFromFastApi({
      summaries: recentRecords.map(toInsightSummary),
    });

    return {
      status: "ready",
      insight: result.insight,
      sourceCount: recentRecords.length,
    };
  } catch (error) {
    console.error("Dashboard insight generation failed", error);

    return {
      status: "error",
      sourceCount: recentRecords.length,
    };
  }
}
