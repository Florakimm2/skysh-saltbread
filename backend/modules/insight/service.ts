// backend/modules/insight/service.ts
import type { BehaviorSessionRecord } from "@/backend/modules/behavior/types";
import type { FastApiInsightResponse, InsightRequestInput } from "./types";
import { analyzeInsights } from "./rules";

const DEFAULT_TIMEOUT_MS = 30_000;
// 정량 지표(rules.ts의 getMonthlyTradeUnits/getMonthlyAggregates)와 동일하게 30일로 통일
// 이전에는 여기만 7일(RECENT_WEEK_MS)로 하드코딩되어 있어, 카드 판단 근거(30일)와
// 행동 로그 참고 범위(7일)가 서로 다른 기간을 기준으로 섞이는 문제가 있었음.
const RECENT_ANALYSIS_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_INSIGHT_SUMMARIES = 50;

function isRecord(value: unknown): value is FastApiInsightResponse {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

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

function extractInsightFromFastApiResponse(rawText: string): FastApiInsightResponse {
  const trimmed = rawText.trim();
  if (!trimmed) {
    throw new Error("FastAPI 응답이 비어 있습니다.");
  }
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (typeof parsed === "string") {
      return { summary: parsed, cards: [] };
    }
    if (isRecord(parsed)) {
      return parsed;
    }
    return { summary: trimmed, cards: [] };
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
): Promise<{ insight: FastApiInsightResponse }> {
  const fastApiUrl = getFastApiInsightUrl();

  const response = await fetchWithTimeout(fastApiUrl, {
    method: "POST",
    headers: {
      Accept: "application/json, text/plain",
      "Content-Type": "application/json",
      "X-API-Key": process.env.FASTAPI_INSIGHT_API_KEY!,
    },
    // 앵커 점수는 별도 필드로 보내지 않는다. summaries 텍스트 안에 이미 녹아 있다.
    // (백엔드 AnalyzeRequest는 extra="forbid"라 알 수 없는 필드를 보내면 422가 난다.)
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


// ── 행동 로그 기반 앵커 보정 ──
// rules.ts의 앵커는 체결 데이터(tradeUnits/aggregates)로만 산출하므로,
// UI 행동 로그에서만 포착되는 이상 패턴(비정상 금액, 연타 주문 등)은 반영되지 않는다.
// 이 함수가 행동 로그를 스캔하여 이상 징후 발견 시 해당 테마의 앵커를 경고 범위로 끌어내린다.
// (주의: 이 값은 이제 LLM 클램핑용이 아니라, 프롬프트에 참고 텍스트로 주입되는 "가이드 수치"일 뿐이다.)

interface AnchorScore {
  theme: "EMOTIONAL" | "GUARDRAIL" | "FEE" | "SLIPPAGE";
  anchor: number;
}

const ABNORMAL_AMOUNT_MULTIPLIER = 50;
const RAPID_FIRE_WINDOW_MS = 30 * 60 * 1000;
const RAPID_FIRE_THRESHOLD = 10;
const ANOMALY_ANCHOR_CAP = -50;

function adjustAnchorsFromBehavior(
  anchorScores: AnchorScore[],
  recentRecords: BehaviorSessionRecord[]
): AnchorScore[] {
  const adjusted = anchorScores.map(s => ({ ...s }));

  const amounts = recentRecords
    .filter(r => r.amount !== undefined && r.amount > 0)
    .map(r => r.amount!);

  if (amounts.length >= 3) {
    const sorted = [...amounts].sort((a, b) => a - b);
    const medianIdx = Math.floor(sorted.length / 2);
    const median = sorted[medianIdx];
    const max = sorted[sorted.length - 1];

    if (median > 0 && max / median >= ABNORMAL_AMOUNT_MULTIPLIER) {
      const emotional = adjusted.find(s => s.theme === "EMOTIONAL");
      if (emotional) {
        emotional.anchor = Math.min(emotional.anchor, ANOMALY_ANCHOR_CAP);
      }
      const fee = adjusted.find(s => s.theme === "FEE");
      if (fee) {
        fee.anchor = Math.min(fee.anchor, ANOMALY_ANCHOR_CAP);
      }
    }
  }

  const timestamps = recentRecords
    .map(r => new Date(r.occurredAt).getTime())
    .filter(t => !Number.isNaN(t))
    .sort((a, b) => a - b);

  for (let i = 0; i <= timestamps.length - RAPID_FIRE_THRESHOLD; i++) {
    const windowEnd = timestamps[i] + RAPID_FIRE_WINDOW_MS;
    let count = 0;
    for (let j = i; j < timestamps.length && timestamps[j] <= windowEnd; j++) {
      count++;
    }
    if (count >= RAPID_FIRE_THRESHOLD) {
      const emotional = adjusted.find(s => s.theme === "EMOTIONAL");
      if (emotional) {
        emotional.anchor = Math.min(emotional.anchor, ANOMALY_ANCHOR_CAP);
      }
      break;
    }
  }

  return adjusted;
}

// 앵커 점수를 LLM이 읽을 수 있는 참고 텍스트 줄로 변환한다.
// score 클램핑에는 더 이상 쓰이지 않으며, "체결 데이터 기준 참고치"라는 성격을 텍스트에 명시한다.
function formatAnchorSummaryLines(anchors: AnchorScore[]): string[] {
  return anchors.map((a) => {
    const sign = a.anchor > 0 ? "+" : "";
    return `[앵커-${a.theme}] 규칙 엔진(체결 데이터) 기준 참고 점수: ${sign}${a.anchor}. 강제 기준이 아니므로, 행동 로그·정량 지표에서 이 값이 놓친 이상 신호가 있다면 그것을 우선하여 자유롭게 판단할 것.`;
  });
}

export async function requestDashboardInsight(
  userId: string,
  records: BehaviorSessionRecord[],
  now = new Date()
): Promise<
  | {
      status: "ready";
      insight: string;
      parsedData: FastApiInsightResponse;
      sourceCount: number;
    }
  | { status: "empty"; sourceCount: 0 }
  | { status: "error"; sourceCount: number }
> {
  // 정량 지표(analyzeInsights)와 동일한 30일 창으로 통일
  const since = now.getTime() - RECENT_ANALYSIS_WINDOW_MS;

  const instructions = [
    "지시사항: 아래 '--- 행동 로그 ---', '--- 정량 지표 ---', '--- 앵커 점수 ---' 섹션을 모두 종합하여 분석해줘. 두 섹션 모두 최근 30일 데이터 기준이다.",
    "핵심 원칙: summary(요약)와 cards(카드)는 반드시 동일한 결론을 내려야 한다. 행동 로그에서 위험 신호가 감지되었으면 해당 테마의 카드도 경고형이어야 하고, 정량 지표가 우수하면 요약에서도 그 사실을 반영해야 한다. 요약은 경고인데 카드는 전부 칭찬, 또는 그 반대 상황은 절대 허용되지 않는다.",
    "판단 우선순위: 같은 테마에서 행동 로그와 정량 지표/앵커가 서로 다른 신호를 보내면, 정량 지표('[지표-...]')의 수치를 우선 따르되 요약 문장에서 행동 로그의 관찰 사실도 함께 언급하여 맥락을 보존하라. 앵커 점수는 참고용 가이드일 뿐이며 최종 판단은 너의 몫이다.",
  ];

  const { summaries: quantitativeMetrics, anchorScores } = await analyzeInsights(userId);

  const SECTION_MARKER_COUNT = 3; // 행동 로그 / 정량 지표 / 앵커 점수 섹션 헤더
  const allowedBehaviorCount = Math.max(
    0,
    MAX_INSIGHT_SUMMARIES
      - quantitativeMetrics.length
      - anchorScores.length
      - instructions.length
      - SECTION_MARKER_COUNT
  );

  const recentRecords = (records || [])
    .filter((record) => new Date(record.occurredAt).getTime() >= since)
    .slice(0, allowedBehaviorCount);

  const behaviorSummaries = recentRecords.map(toInsightSummary);

  // 행동 로그 이상 패턴 감지 → 앵커 보정 (여전히 계산은 하되, 이제는 클램핑이 아니라 텍스트 가이드로만 쓰인다)
  const adjustedAnchors = adjustAnchorsFromBehavior(anchorScores, recentRecords);
  const anchorSummaryLines = formatAnchorSummaryLines(adjustedAnchors);

  const combinedSummaries = [
    ...instructions,
    "--- 행동 로그 (최근 30일, summary 작성 시 참고하되, 카드 판단은 아래 정량 지표를 우선 따를 것) ---",
    ...behaviorSummaries,
    "--- 정량 지표 (최근 30일, 카드 경고/칭찬 판단의 1차 근거) ---",
    ...quantitativeMetrics,
    "--- 앵커 점수 (규칙 엔진 참고치. 강제 아님 — 행동 로그·정량 지표에 이상이 없을 때만 참고할 것) ---",
    ...anchorSummaryLines,
  ];

  if (behaviorSummaries.length === 0 && quantitativeMetrics.length === 0) {
    return { status: "empty", sourceCount: 0 };
  }

  try {
    const result = await requestInsightFromFastApi({
      summaries: combinedSummaries,
    });
    const parsedData = result.insight;
    const insightSummary = typeof parsedData.summary === "string"
      ? parsedData.summary
      : "분석 완료";

    return {
      status: "ready",
      insight: insightSummary,
      parsedData: parsedData,
      sourceCount: recentRecords.length,
    };
  } catch (error) {
    console.error("Dashboard insight generation failed", error);
    return { status: "error", sourceCount: recentRecords.length };
  }
}
