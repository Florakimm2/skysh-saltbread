import { adminDb } from "@/backend/infrastructure/firebase/firebase-admin";
import { toIsoString } from "../behavior/repository";

// Timestamp 또는 ISO 문자열을 ms(숫자)로 안전하게 변환하는 헬퍼 함수
function getTimeMs(val: unknown): number {
    if (!val) return 0;
    if (
      typeof val === "object" &&
      val !== null &&
      "toDate" in val &&
      typeof (val as { toDate: () => Date }).toDate === "function"
    ) {
      return (val as { toDate: () => Date }).toDate().getTime();
    }
    return new Date(String(val)).getTime();
}

export async function getMonthlyTradeUnits(userId: string) {
// 1. 여기서 확실하게 체크합니다!
// 1. 확실한 방어막! (글자가 아닌 이상한 데이터 덩어리가 들어와도 무조건 막아냄)
    if (!userId || typeof userId !== "string") {
    userId = "GUEST_USER_NO_ID"; // 파이어베이스가 뻗지 않도록 임시 ID를 넣어서 자연스럽게 '빈 결과'를 유도합니다.
    }

    // 1달 전 날짜 시간(ms) 계산
  const thirtyDaysAgoMs = Date.now() - 30 * 24 * 60 * 60 * 1000;


  // 1. 병렬 쿼리 (단일 인덱스만 사용: userId)
    const [
    snapshotsSnap,
    reactionsSnap,
    feedbacksSnap,
    tradeLogsSnap
    ] = await Promise.all([
    adminDb.collection("orderSnapshots").where("userId", "==", userId).get(),
    adminDb.collection("guardrailReactions").where("userId", "==", userId).get(),
    adminDb.collection("tradeFeedbacks").where("userId", "==", userId).get(),
    adminDb.collection("confirmedTradeLogs").where("userId", "==", userId).get()
    ]);

  // 2. 서버 단(JS) 필터링 및 정렬 (복합 인덱스 이슈 회피)
    const snapshots = snapshotsSnap.docs
    .map(doc => doc.data())
    .filter(data => getTimeMs(data.capturedAt) >= thirtyDaysAgoMs)
    .sort((a, b) => getTimeMs(b.capturedAt) - getTimeMs(a.capturedAt)); // desc 정렬

    const reactions = reactionsSnap.docs
    .map(doc => doc.data())
    .filter(data => getTimeMs(data.reactedAt) >= thirtyDaysAgoMs);

    const feedbacks = feedbacksSnap.docs.map(doc => doc.data());

    const tradeLogs = tradeLogsSnap.docs
    .map(doc => doc.data())
    .filter(data => getTimeMs(data.orderCreatedAt) >= thirtyDaysAgoMs);

  // 3. Map을 이용한 애플리케이션 레벨 조인 (Key: attemptId)
    const tradeUnitsMap = new Map<string, {
      attemptId: string;
      snapshot: FirebaseFirestore.DocumentData;
      reaction: FirebaseFirestore.DocumentData | null;
      feedback: FirebaseFirestore.DocumentData | null;
      trade: FirebaseFirestore.DocumentData | null;
      outcome: FirebaseFirestore.DocumentData | null;
    }>();

  // A. Snapshot을 기준으로 초기 Unit 생성
    snapshots.forEach((data) => {
    if (data.attemptId) {
        tradeUnitsMap.set(data.attemptId, {
        attemptId: data.attemptId,
        snapshot: data,
        reaction: null,
        feedback: null,
        trade: null,
        outcome: null,
        });
    }
    });

  // B. Reaction 매핑
    reactions.forEach((data) => {
    if (data.attemptId && tradeUnitsMap.has(data.attemptId)) {
        const unit = tradeUnitsMap.get(data.attemptId);
        if (unit) unit.reaction = data;
    }
    });

  // C. Feedback 매핑
    feedbacks.forEach((data) => {
    if (data.attemptId && tradeUnitsMap.has(data.attemptId)) {
        const unit = tradeUnitsMap.get(data.attemptId);
        if (unit) unit.feedback = data;
    }
    });

  // D. Confirmed Trade Log 매핑
    tradeLogs.forEach((data) => {
    if (data.attemptId && tradeUnitsMap.has(data.attemptId)) {
        const unit = tradeUnitsMap.get(data.attemptId);
        if (unit) {
        unit.trade = data;
        unit.outcome = data.outcomePatch || null; 
        }
    }
    });

  // 4. Map을 배열로 변환
    const rawTradeUnits = Array.from(tradeUnitsMap.values());

  // 5. AI에 넘기기 전 최소한의 필드로 압축
    const optimizedTradeUnits = rawTradeUnits.map((unit) => {
    return {
        attemptId: unit.attemptId,
        snapshot: {
        orderMode: unit.snapshot.orderMode,
        spreadRate: unit.snapshot.spreadRate,
        shortTermReturn5m: unit.snapshot.shortTermReturn5m,
        requestedBalanceRatio: unit.snapshot.requestedBalanceRatio,
        tradePriceAtIntent: unit.snapshot.tradePriceAtIntent, 
        },
        reaction: unit.reaction ? {
        action: unit.reaction.action,
        reactionTimeMs: unit.reaction.guardrailActionAt 
            ? getTimeMs(unit.reaction.guardrailActionAt) - getTimeMs(unit.snapshot.capturedAt)
            : null
        } : null,
        trade: unit.trade ? {
        ordType: unit.trade.ordType,
        orderCreatedAt: toIsoString(unit.trade.orderCreatedAt)
        } : null,
        outcome: unit.outcome ? {
        state: unit.outcome.state,
        executedVolume: unit.outcome.executedVolume,
        paidFee: unit.outcome.paidFee,
        executedFunds: unit.outcome.executedFunds, 
        } : null,
        feedback: unit.feedback ? {
        feedbackStatus: unit.feedback.feedbackStatus,
        selfAssessment: unit.feedback.selfAssessment
        } : null
    };
    });

    return optimizedTradeUnits;
}

export async function getMonthlyAggregates(userId: string) {
  const thirtyDaysAgoMs = Date.now() - 30 * 24 * 60 * 60 * 1000;
if (!userId || typeof userId !== "string") {
        userId = "GUEST_USER_NO_ID";
    }
  // 복합 인덱스를 피하기 위해 userId만 쿼리
    const aggregatesSnap = await adminDb.collection("userTradeDailyAggregates")
    .where("userId", "==", userId)
    .get();

  // JS에서 30일 이내 데이터 필터링 및 내림차순 정렬
    return aggregatesSnap.docs
    .map(doc => doc.data())
    .filter(data => getTimeMs(data.aggregatedAt) >= thirtyDaysAgoMs)
    .sort((a, b) => getTimeMs(b.aggregatedAt) - getTimeMs(a.aggregatedAt));
}
