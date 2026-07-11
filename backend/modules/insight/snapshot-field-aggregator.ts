// backend/modules/insight/snapshot-field-aggregator.ts
//
// RULE_FIELD_CATALOG에 등록된 스냅샷 필드 데이터를 주제(토픽)별로 집계하여
// AI 인사이트 분석에 넘길 수 있는 형태로 변환한다.
//
// 기존 service.ts의 requestDashboardInsight()에서
// analyzeInsights() 대신 또는 추가로 호출하여 사용한다.

// ─── 타입 정의 ───

/** 개별 스냅샷 로그 (background.js → 백엔드로 저장된 형태) */
export interface OrderContextSnapshotLog {
  snapshotId: string;
  attemptId: string | null;
  snapshotTrigger: string;
  capturedAt: string;
  market: string;
  side: string;
  orderMode: string;
  entryPoint: string;

  // 주문 정보
  intentPrice: string | null;
  intentQuantity: string | null;
  intentAmount: string | null;
  requestedBalanceRatio: number | null;
  allocationPresetPercent: string | number | null;

  // 행동 타이밍
  draftDurationMs: number | null;
  lastEditToSnapshotMs: number | null;
  draftEditCount: number | null;
  amountChangeRate: number | null;
  modeChangedToMarket: boolean;
  orderbookClickToSnapshotMs: number | null;

  // 빈도 카운트
  orderIntentCount1m: number;
  actualOrderCreatedCount10m: number | null;
  sameSideIntentCount1m: number;
  marketChangeCount5m: number;
  sideChangeCount3m: number;
  priceEditCount3m: number;
  quantityEditCount3m: number;
  amountEditCount3m: number;
  inputRevertCount: number;
  priceDirectionChangeCount: number;
  priceChangeRate: number | null;
  orderModeChangeCount3m: number;
  draftResetCount3m: number;

  // 시장 데이터
  tradePriceAtSnapshot: string | null;
  shortTermReturn5m: number | null;
  signedChangeRate: number | null;
  spreadRate: number | null;
  marketRiskFlags: string[];
  pricePositionIn5mRange: number | null;
  volumeSpikeRatio5m: number | null;

  // 개인 API 데이터
  baseAssetAvgBuyPriceBeforeSnapshot: string | null;
  priceVsAvgBuyRateAtSnapshot: number | null;
}

/** 집계된 주제별 메트릭 */
export interface TopicMetrics {
  topicKey: string;
  topicLabel: string;
  metrics: { label: string; value: string; description: string }[];
}

/** AI에 전달할 최종 집계 결과 */
export interface FieldAggregationResult {
  snapshotCount: number;
  periodDays: number;
  topics: TopicMetrics[];
  summaryLines: string[];
}

// ─── 유틸리티 ───

function safeNumber(v: string | number | null | undefined): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function avg(nums: number[]): number | null {
  if (nums.length === 0) return null;
  return nums.reduce((s, n) => s + n, 0) / nums.length;
}

function max(nums: number[]): number | null {
  if (nums.length === 0) return null;
  return Math.max(...nums);
}

function min(nums: number[]): number | null {
  if (nums.length === 0) return null;
  return Math.min(...nums);
}

function pct(v: number | null): string {
  if (v === null) return "데이터 없음";
  return `${(v * 100).toFixed(1)}%`;
}

function ms2sec(v: number | null): string {
  if (v === null) return "데이터 없음";
  return `${(v / 1000).toFixed(1)}초`;
}

function fmt(v: number | null, unit = ""): string {
  if (v === null) return "데이터 없음";
  return `${Number(v.toFixed(2)).toLocaleString("ko-KR")}${unit}`;
}

function countWhere(
  snapshots: OrderContextSnapshotLog[],
  predicate: (s: OrderContextSnapshotLog) => boolean
): number {
  return snapshots.filter(predicate).length;
}

// ─── 주제별 집계 로직 ───

function aggregateOrderInfo(snapshots: OrderContextSnapshotLog[]): TopicMetrics {
  const amounts = snapshots
    .map((s) => safeNumber(s.intentAmount))
    .filter((n): n is number => n !== null && n > 0);

  const buyAmounts = snapshots
    .filter((s) => s.side === "BUY")
    .map((s) => safeNumber(s.intentAmount))
    .filter((n): n is number => n !== null && n > 0);

  const sellAmounts = snapshots
    .filter((s) => s.side === "SELL")
    .map((s) => safeNumber(s.intentAmount))
    .filter((n): n is number => n !== null && n > 0);

  const buyCount = countWhere(snapshots, (s) => s.side === "BUY");
  const sellCount = countWhere(snapshots, (s) => s.side === "SELL");
  const limitCount = countWhere(snapshots, (s) => s.orderMode === "LIMIT");
  const marketCount = countWhere(snapshots, (s) => s.orderMode === "MARKET");

  const balanceRatios = snapshots
    .map((s) => s.requestedBalanceRatio)
    .filter((n): n is number => n !== null);

  const uniqueMarkets = [...new Set(snapshots.map((s) => s.market).filter(Boolean))];

  return {
    topicKey: "ORDER_INFO",
    topicLabel: "📊 주문 정보 분석",
    metrics: [
      { label: "총 주문 시도 횟수", value: `${snapshots.length}회`, description: "분석 기간 내 주문 버튼을 누른 총 횟수" },
      { label: "매수 / 매도 비율", value: `매수 ${buyCount}회 / 매도 ${sellCount}회`, description: "매수와 매도의 비율" },
      { label: "지정가 / 시장가 비율", value: `지정가 ${limitCount}회 / 시장가 ${marketCount}회`, description: "주문 방식 선택 비율" },
      { label: "평균 주문 금액", value: fmt(avg(amounts), "원"), description: "전체 주문의 평균 금액" },
      { label: "평균 매수 금액", value: fmt(avg(buyAmounts), "원"), description: "매수 주문만의 평균 금액" },
      { label: "평균 매도 금액", value: fmt(avg(sellAmounts), "원"), description: "매도 주문만의 평균 금액" },
      { label: "최대 단일 주문 금액", value: fmt(max(amounts), "원"), description: "기간 내 가장 큰 금액의 주문" },
      { label: "평균 주문 비중", value: pct(avg(balanceRatios)), description: "보유 자산 대비 주문 금액 비중의 평균" },
      { label: "거래 종목 수", value: `${uniqueMarkets.length}종목`, description: "거래한 고유 종목 수" },
    ],
  };
}

function aggregateBehaviorTiming(snapshots: OrderContextSnapshotLog[]): TopicMetrics {
  const draftDurations = snapshots
    .map((s) => s.draftDurationMs)
    .filter((n): n is number => n !== null);

  const lastEditGaps = snapshots
    .map((s) => s.lastEditToSnapshotMs)
    .filter((n): n is number => n !== null);

  const orderbookGaps = snapshots
    .map((s) => s.orderbookClickToSnapshotMs)
    .filter((n): n is number => n !== null);

  const draftEdits = snapshots
    .map((s) => s.draftEditCount)
    .filter((n): n is number => n !== null);

  return {
    topicKey: "BEHAVIOR_TIMING",
    topicLabel: "⏱️ 주문 작성 행동",
    metrics: [
      { label: "평균 주문 작성 시간", value: ms2sec(avg(draftDurations)), description: "주문 폼을 열고 제출까지 걸린 평균 시간" },
      { label: "최단 주문 작성 시간", value: ms2sec(min(draftDurations)), description: "가장 빨리 제출한 주문의 작성 시간 (충동 매매 지표)" },
      { label: "마지막 수정 → 제출 평균", value: ms2sec(avg(lastEditGaps)), description: "마지막으로 값을 수정한 후 제출까지의 평균 시간" },
      { label: "호가 클릭 → 제출 평균", value: ms2sec(avg(orderbookGaps)), description: "호가창 클릭 후 주문 제출까지의 평균 시간" },
      { label: "평균 수정 횟수", value: fmt(avg(draftEdits), "회"), description: "주문당 가격/금액/수량을 수정한 평균 횟수" },
    ],
  };
}

function aggregateFrequencyPatterns(snapshots: OrderContextSnapshotLog[]): TopicMetrics {
  const intentCounts1m = snapshots.map((s) => s.orderIntentCount1m);
  const sideChanges = snapshots.map((s) => s.sideChangeCount3m);
  const priceEdits = snapshots.map((s) => s.priceEditCount3m);
  const amountEdits = snapshots.map((s) => s.amountEditCount3m);
  const marketChanges = snapshots.map((s) => s.marketChangeCount5m);
  const modeChanges = snapshots.map((s) => s.orderModeChangeCount3m);
  const inputReverts = snapshots.map((s) => s.inputRevertCount);
  const priceDirectionChanges = snapshots.map((s) => s.priceDirectionChangeCount);

  const modeChangedCount = countWhere(snapshots, (s) => s.modeChangedToMarket);

  return {
    topicKey: "FREQUENCY_PATTERNS",
    topicLabel: "🔄 반복·수정 패턴",
    metrics: [
      { label: "1분 내 평균 주문 시도", value: fmt(avg(intentCounts1m), "회"), description: "1분 내 주문 버튼을 누른 평균 횟수 (연타 지표)" },
      { label: "3분 내 평균 매수·매도 전환", value: fmt(avg(sideChanges), "회"), description: "매수와 매도 사이를 왔다 갔다 한 횟수" },
      { label: "3분 내 평균 가격 수정", value: fmt(avg(priceEdits), "회"), description: "주문 가격을 수정한 평균 횟수" },
      { label: "3분 내 평균 금액 수정", value: fmt(avg(amountEdits), "회"), description: "주문 금액을 수정한 평균 횟수" },
      { label: "5분 내 평균 종목 변경", value: fmt(avg(marketChanges), "회"), description: "다른 종목으로 이동한 평균 횟수" },
      { label: "3분 내 평균 주문방식 변경", value: fmt(avg(modeChanges), "회"), description: "지정가 ↔ 시장가 전환 횟수" },
      { label: "시장가 전환 주문 비율", value: `${snapshots.length > 0 ? ((modeChangedCount / snapshots.length) * 100).toFixed(1) : 0}%`, description: "처음 지정가로 시작했다가 시장가로 바꾼 주문 비율" },
      { label: "평균 입력값 되돌림", value: fmt(avg(inputReverts), "회"), description: "이전 입력값으로 되돌린 평균 횟수" },
      { label: "가격 방향 전환 평균", value: fmt(avg(priceDirectionChanges), "회"), description: "가격을 올렸다 내렸다 반복한 횟수" },
    ],
  };
}

function aggregateMarketContext(snapshots: OrderContextSnapshotLog[]): TopicMetrics {
  const signedChangeRates = snapshots
    .map((s) => s.signedChangeRate)
    .filter((n): n is number => n !== null);

  const shortTermReturns = snapshots
    .map((s) => s.shortTermReturn5m)
    .filter((n): n is number => n !== null);

  const spreadRates = snapshots
    .map((s) => s.spreadRate)
    .filter((n): n is number => n !== null);

  const pricePositions = snapshots
    .map((s) => s.pricePositionIn5mRange)
    .filter((n): n is number => n !== null);

  const volumeSpikes = snapshots
    .map((s) => s.volumeSpikeRatio5m)
    .filter((n): n is number => n !== null);

  // 위험 플래그 집계
  const allFlags = snapshots.flatMap((s) => s.marketRiskFlags || []);
  const flagCounts = new Map<string, number>();
  for (const flag of allFlags) {
    flagCounts.set(flag, (flagCounts.get(flag) ?? 0) + 1);
  }
  const topFlags = [...flagCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([flag, count]) => `${flag}(${count}회)`)
    .join(", ") || "없음";

  const amountChangeRates = snapshots
    .map((s) => s.amountChangeRate)
    .filter((n): n is number => n !== null);

  const priceChangeRates = snapshots
    .map((s) => s.priceChangeRate)
    .filter((n): n is number => n !== null);

  return {
    topicKey: "MARKET_CONTEXT",
    topicLabel: "📈 시장 상황 맥락",
    metrics: [
      { label: "주문 시 평균 등락률", value: pct(avg(signedChangeRates)), description: "주문을 넣은 시점의 해당 종목 등락률 평균" },
      { label: "주문 시 평균 5분 수익률", value: pct(avg(shortTermReturns)), description: "주문 직전 5분간의 가격 변화 평균" },
      { label: "평균 스프레드율", value: pct(avg(spreadRates)), description: "매수/매도 호가 간 격차 평균" },
      { label: "5분 가격 범위 내 위치 평균", value: pct(avg(pricePositions)), description: "최근 5분 고점 대비 현재가 위치 (1에 가까울수록 고점 부근)" },
      { label: "평균 거래량 급증 비율", value: fmt(avg(volumeSpikes), "배"), description: "평소 대비 거래량 급증 비율" },
      { label: "시장 위험 플래그 빈도", value: topFlags, description: "자주 감지된 시장 위험 플래그 상위 3개" },
      { label: "평균 금액 변동 정도", value: pct(avg(amountChangeRates)), description: "처음 입력 금액 대비 최종 금액의 변화율" },
      { label: "평균 가격 변동 정도", value: pct(avg(priceChangeRates)), description: "처음 입력 가격 대비 최종 가격의 변화율" },
    ],
  };
}

function aggregatePersonalApi(snapshots: OrderContextSnapshotLog[]): TopicMetrics {
  const pvRates = snapshots
    .map((s) => s.priceVsAvgBuyRateAtSnapshot)
    .filter((n): n is number => n !== null);

  const actualOrders = snapshots
    .map((s) => s.actualOrderCreatedCount10m)
    .filter((n): n is number => n !== null);

  const hasAvgBuyPrice = snapshots.filter(
    (s) => s.baseAssetAvgBuyPriceBeforeSnapshot !== null
  ).length;

  return {
    topicKey: "PERSONAL_API",
    topicLabel: "🔑 개인 계좌 기반 분석",
    metrics: [
      { label: "평균 매입가 대비 현재가 비율", value: pct(avg(pvRates)), description: "매수 평균가 대비 현재 시세 비율 (양수면 수익, 음수면 손실 상태에서 거래)" },
      { label: "10분 내 실제 체결 주문 평균", value: fmt(avg(actualOrders), "회"), description: "실제 체결된 주문의 10분 내 평균 횟수" },
      { label: "평균 매입가 존재 비율", value: `${snapshots.length > 0 ? ((hasAvgBuyPrice / snapshots.length) * 100).toFixed(1) : 0}%`, description: "해당 종목을 이미 보유 중이었던 주문의 비율" },
    ],
  };
}

// ─── 메인 집계 함수 ───

/**
 * 주어진 스냅샷 배열을 주제별로 집계하여 AI 분석용 결과를 반환한다.
 *
 * @param snapshots - Firestore에서 가져온 OrderContextSnapshot 로그 배열
 * @param periodDays - 분석 기간 (일)
 */
export function aggregateSnapshotFields(
  snapshots: OrderContextSnapshotLog[],
  periodDays = 30
): FieldAggregationResult {
  if (snapshots.length === 0) {
    return { snapshotCount: 0, periodDays, topics: [], summaryLines: [] };
  }

  const topics: TopicMetrics[] = [
    aggregateOrderInfo(snapshots),
    aggregateBehaviorTiming(snapshots),
    aggregateFrequencyPatterns(snapshots),
    aggregateMarketContext(snapshots),
    aggregatePersonalApi(snapshots),
  ];

  // AI 프롬프트에 넣을 텍스트 라인으로 변환
  const summaryLines: string[] = [
    `분석 기간: 최근 ${periodDays}일, 총 스냅샷 ${snapshots.length}건`,
  ];

  for (const topic of topics) {
    summaryLines.push(`\n--- ${topic.topicLabel} ---`);
    for (const m of topic.metrics) {
      summaryLines.push(`[필드-${m.label}] ${m.value} (${m.description})`);
    }
  }

  return { snapshotCount: snapshots.length, periodDays, topics, summaryLines };
}

// ─── service.ts에서 호출할 통합 함수 ───

/**
 * 기존 requestDashboardInsight() 패턴을 따르되,
 * 스냅샷 필드 집계 → AI 분석 → 아코디언 카드 형태를 반환한다.
 *
 * 사용 예시:
 *   import { requestFieldInsight } from "./snapshot-field-aggregator";
 *   const result = await requestFieldInsight(userId, snapshots);
 */
export async function requestFieldInsight(
  userId: string,
  snapshots: OrderContextSnapshotLog[],
  requestInsightFromFastApi: (input: { summaries: string[] }) => Promise<any>,
  periodDays = 30
): Promise<{
  status: "ready" | "empty" | "error";
  topics: TopicMetrics[];
  aiAnalysis: any | null;
  snapshotCount: number;
}> {
  const aggregation = aggregateSnapshotFields(snapshots, periodDays);

  if (aggregation.snapshotCount === 0) {
    return { status: "empty", topics: [], aiAnalysis: null, snapshotCount: 0 };
  }

  try {
    const result = await requestInsightFromFastApi({
      summaries: aggregation.summaryLines,
    });

    return {
      status: "ready",
      topics: aggregation.topics,
      aiAnalysis: result.insight,
      snapshotCount: aggregation.snapshotCount,
    };
  } catch (error) {
    console.error("Field insight generation failed", error);
    return {
      status: "error",
      topics: aggregation.topics,
      aiAnalysis: null,
      snapshotCount: aggregation.snapshotCount,
    };
  }
}