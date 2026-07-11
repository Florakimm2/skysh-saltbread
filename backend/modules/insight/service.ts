// backend/modules/insight/service.ts

import { cache } from "react";
import type { BehaviorSessionRecord } from "@/backend/modules/behavior/types";
import type { InsightRequestInput, AnchorScoreItem } from "./types";
import { analyzeInsights } from "./rules";
import { getBehaviorSessionRecords } from "@/backend/modules/behavior/service";

const DEFAULT_TIMEOUT_MS = 30_000;
const RECENT_ANALYSIS_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;
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

function getFastApiInsightUrl(): string {
  const url = process.env.FASTAPI_INSIGHT_URL;
  if (!url) throw new Error("FASTAPI_INSIGHT_URL 환경변수가 설정되지 않았습니다.");
  return url;
}

function getFieldInsightUrl(): string {
  const dedicated = process.env.FASTAPI_FIELD_INSIGHT_URL;
  if (dedicated) return dedicated;
  const insightUrl = process.env.FASTAPI_INSIGHT_URL;
  if (insightUrl) {
    const i = insightUrl.lastIndexOf("/");
    if (i > 0) return `${insightUrl.substring(0, i)}/field-analyze`;
  }
  return `${process.env.AI_SERVER_URL || "http://localhost:8000"}/api/v1/insights/field-analyze`;
}

function extractInsightFromFastApiResponse(rawText: string): any {
  const trimmed = rawText.trim();
  if (!trimmed) throw new Error("FastAPI 응답이 비어 있습니다.");
  try { return JSON.parse(trimmed); }
  catch { return { summary: trimmed, cards: [] }; }
}

async function fetchWithTimeout(url: string, options: RequestInit, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try { return await fetch(url, { ...options, signal: controller.signal }); }
  finally { clearTimeout(timeoutId); }
}

export async function requestInsightFromFastApi(input: InsightRequestInput): Promise<any> {
  const response = await fetchWithTimeout(getFastApiInsightUrl(), {
    method: "POST",
    headers: { Accept: "application/json, text/plain", "Content-Type": "application/json", "X-API-Key": process.env.FASTAPI_INSIGHT_API_KEY! },
    body: JSON.stringify({ summaries: input.summaries }),
    cache: "no-store",
  });
  const rawText = await response.text();
  if (!response.ok) throw new Error(`FASTAPI_INSIGHT_FAILED_${response.status}: ${rawText.slice(0, 300)}`);
  return { insight: extractInsightFromFastApiResponse(rawText) };
}

async function requestFieldInsightFromFastApi(input: { summaries: string[] }): Promise<{ insight: any }> {
  const response = await fetchWithTimeout(getFieldInsightUrl(), {
    method: "POST",
    headers: { Accept: "application/json, text/plain", "Content-Type": "application/json", "X-API-Key": process.env.FASTAPI_INSIGHT_API_KEY! },
    body: JSON.stringify({ summaries: input.summaries }),
    cache: "no-store",
  });
  const rawText = await response.text();
  if (!response.ok) throw new Error(`FASTAPI_FIELD_INSIGHT_FAILED_${response.status}: ${rawText.slice(0, 300)}`);
  let insight: any;
  try { insight = JSON.parse(rawText.trim()); }
  catch { insight = { summary: rawText.trim(), topics: [], one_line_advice: "" }; }
  return { insight };
}

function toInsightSummary(record: BehaviorSessionRecord): string {
  const occurredAt = new Intl.DateTimeFormat("ko-KR", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Seoul" }).format(new Date(record.occurredAt));
  const orderDetails = [
    record.symbol,
    record.side === "BUY" ? "매수" : record.side === "SELL" ? "매도" : null,
    record.orderType === "LIMIT" ? "지정가" : record.orderType === "MARKET" ? "시장가" : null,
    record.amount !== undefined ? `${Number(record.amount).toLocaleString("ko-KR")}원` : null,
  ].filter(Boolean).join(" / ");
  const behaviorParts = record.behaviorData.map((b) => `${EVENT_LABELS[b.eventType] || b.eventType} ${b.count}회`).join(", ");
  return `[${occurredAt}] ${orderDetails} — ${behaviorParts || "행동 기록 없음"}`;
}

interface AnchorScore { theme: string; anchor: number; }

function adjustAnchorsFromBehavior(anchors: AnchorScore[], records: BehaviorSessionRecord[]): AnchorScore[] {
  if (!records || records.length === 0) return anchors;
  return anchors.map((a) => {
    let adjusted = a.anchor;
    const rapidOrders = records.filter((r) => {
      const buy = r.behaviorData.find((b) => b.eventType === "BUY_CLICK");
      const sell = r.behaviorData.find((b) => b.eventType === "SELL_CLICK");
      return (buy?.count ?? 0) + (sell?.count ?? 0) >= 3;
    });
    if (a.theme === "EMOTIONAL" && rapidOrders.length >= 2) adjusted = Math.min(adjusted, -10);
    return { theme: a.theme, anchor: adjusted };
  });
}

function formatAnchorSummaryLines(anchors: AnchorScore[]): string[] {
  return anchors.map((a) => {
    const sign = a.anchor > 0 ? "+" : "";
    return `[앵커-${a.theme}] 규칙 엔진 참고 점수: ${sign}${a.anchor}.`;
  });
}

// ┌─────────────────────────────────────────────────────────┐
// │ cache()로 감싸서 같은 렌더 사이클 안에서 중복 호출 방지    │
// └─────────────────────────────────────────────────────────┘
const cachedAnalyzeInsights = cache(analyzeInsights);

interface CommonInsightData {
  combinedSummaries: string[];
  behaviorCount: number;
  quantitativeCount: number;
}

async function buildCommonInsightSummaries(
  userId: string,
  records: BehaviorSessionRecord[],
  now: Date
): Promise<CommonInsightData> {
  const since = now.getTime() - RECENT_ANALYSIS_WINDOW_MS;
  const { summaries: quantitativeMetrics, anchorScores } = await cachedAnalyzeInsights(userId);

  const allowedBehaviorCount = Math.max(0, MAX_INSIGHT_SUMMARIES - quantitativeMetrics.length - anchorScores.length - 6);
  const recentRecords = (records || []).filter((r) => new Date(r.occurredAt).getTime() >= since).slice(0, allowedBehaviorCount);
  const behaviorSummaries = recentRecords.map(toInsightSummary);
  const adjustedAnchors = adjustAnchorsFromBehavior(anchorScores, recentRecords);
  const anchorLines = formatAnchorSummaryLines(adjustedAnchors);

  return {
    combinedSummaries: [
      "--- 행동 로그 (최근 30일) ---", ...behaviorSummaries,
      "--- 정량 지표 (최근 30일) ---", ...quantitativeMetrics,
      "--- 앵커 점수 (참고용) ---", ...anchorLines,
    ],
    behaviorCount: behaviorSummaries.length,
    quantitativeCount: quantitativeMetrics.length,
  };
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 1. AI 인사이트 (기존 로직 유지)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export async function requestDashboardInsight(
  userId: string,
  records: BehaviorSessionRecord[],
  now = new Date()
): Promise<any> {
  const { combinedSummaries, behaviorCount, quantitativeCount } =
    await buildCommonInsightSummaries(userId, records, now);

  if (behaviorCount === 0 && quantitativeCount === 0) {
    return { status: "empty", sourceCount: 0 };
  }

  const instructions = [
    "지시사항: 아래 '--- 행동 로그 ---', '--- 정량 지표 ---', '--- 앵커 점수 ---' 섹션을 모두 종합하여 분석해줘.",
    "핵심 원칙: summary(요약)와 cards(카드)는 반드시 동일한 결론을 내려야 한다.",
    "판단 우선순위: 정량 지표 수치를 우선 따르되 행동 로그 관찰도 함께 언급하라.",
  ];

  try {
    const result = await requestInsightFromFastApi({ summaries: [...instructions, ...combinedSummaries] });
    const parsedData = result.insight;
    return {
      status: "ready",
      insight: parsedData?.summary || (typeof parsedData === "string" ? parsedData : "분석 완료"),
      parsedData,
      sourceCount: behaviorCount,
    };
  } catch (error) {
    console.error("Dashboard insight generation failed", error);
    return { status: "error", sourceCount: behaviorCount };
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 2. 필드별 상세 분석
//    AI 인사이트와 동일한 데이터(buildCommonInsightSummaries)
//    → field-analyze 엔드포인트 → AI 응답에서 아코디언 생성
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export interface FieldDashboardInsightResult {
  status: "ready" | "empty" | "error";
  topics: { topicKey: string; topicLabel: string; metrics: { label: string; value: string; description: string }[] }[];
  aiAnalysis: {
    topics: { topic_key: string; topic_label: string; headline: string; analysis: string; severity: "good" | "caution" | "warning" }[];
    one_line_advice: string;
  } | null;
  snapshotCount: number;
}

export async function requestFieldDashboardInsight(
  userId: string,
  records?: BehaviorSessionRecord[],
  now = new Date()
): Promise<FieldDashboardInsightResult> {
  try {
    const resolvedRecords = records ?? (await getBehaviorSessionRecords(userId));
    const { combinedSummaries, behaviorCount, quantitativeCount } =
      await buildCommonInsightSummaries(userId, resolvedRecords, now);

    if (behaviorCount === 0 && quantitativeCount === 0) {
      return { status: "empty", topics: [], aiAnalysis: null, snapshotCount: 0 };
    }

    const result = await requestFieldInsightFromFastApi({ summaries: combinedSummaries });
    const aiAnalysis = result.insight;

    // AI 응답의 topics에서 아코디언 항목 생성
    const topics = (aiAnalysis?.topics || []).map((t: any) => ({
      topicKey: t.topic_key,
      topicLabel: t.topic_label,
      metrics: [],
    }));

    return { status: "ready", topics, aiAnalysis, snapshotCount: behaviorCount + quantitativeCount };
  } catch (error) {
    console.error("Field dashboard insight generation failed", error);
    return { status: "error", topics: [], aiAnalysis: null, snapshotCount: 0 };
  }
}