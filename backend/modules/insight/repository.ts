// backend/modules/insight/repository.ts
//
// ┌─────────────────────────────────────────────────────────┐
// │ 핵심 수정: 컬렉션명을 logs/repository.ts의 실제 저장     │
// │ 컬렉션명(snake_case)과 통일                              │
// │                                                         │
// │ 기존 (camelCase - 데이터 없음):                           │
// │   orderSnapshots, guardrailReactions,                   │
// │   tradeFeedbacks, confirmedTradeLogs                    │
// │                                                         │
// │ 수정 (snake_case - 실제 데이터 저장 위치):                │
// │   order_context_snapshots, guardrail_reactions,          │
// │   trade_feedbacks, confirmed_trade_logs                  │
// └─────────────────────────────────────────────────────────┘

import { adminDb } from "@/backend/infrastructure/firebase/firebase-admin";
import { toIsoString } from "../behavior/repository";

function getTimeMs(val: any): number {
    if (!val) return 0;
    if (typeof val.toDate === "function") return val.toDate().getTime();
    return new Date(val).getTime();
}

export async function getMonthlyTradeUnits(userId: string) {
    if (!userId || typeof userId !== "string") {
        userId = "GUEST_USER_NO_ID";
    }

    const thirtyDaysAgoMs = Date.now() - 30 * 24 * 60 * 60 * 1000;

    // 1. 병렬 쿼리 — 실제 저장 컬렉션명(snake_case)으로 통일
    const [
        snapshotsSnap,
        reactionsSnap,
        feedbacksSnap,
        tradeLogsSnap
    ] = await Promise.all([
        adminDb.collection("order_context_snapshots").where("userId", "==", userId).get(),
        adminDb.collection("guardrail_reactions").where("userId", "==", userId).get(),
        adminDb.collection("trade_feedbacks").where("userId", "==", userId).get(),
        adminDb.collection("confirmed_trade_logs").where("userId", "==", userId).get()
    ]);

    console.log(
        `=== [getMonthlyTradeUnits] userId=${userId}, ` +
        `snapshots=${snapshotsSnap.docs.length}, reactions=${reactionsSnap.docs.length}, ` +
        `feedbacks=${feedbacksSnap.docs.length}, tradeLogs=${tradeLogsSnap.docs.length} ===`
    );

    // 2. 서버 단(JS) 필터링 및 정렬
    const snapshots = snapshotsSnap.docs
        .map(doc => doc.data())
        .filter(data => getTimeMs(data.capturedAt) >= thirtyDaysAgoMs)
        .sort((a, b) => getTimeMs(b.capturedAt) - getTimeMs(a.capturedAt));

    const reactions = reactionsSnap.docs
        .map(doc => doc.data())
        .filter(data => getTimeMs(data.reactedAt) >= thirtyDaysAgoMs);

    const feedbacks = feedbacksSnap.docs.map(doc => doc.data());

    const tradeLogs = tradeLogsSnap.docs
        .map(doc => doc.data())
        .filter(data => getTimeMs(data.orderCreatedAt) >= thirtyDaysAgoMs);

    // 3. Map을 이용한 애플리케이션 레벨 조인 (Key: attemptId)
    const tradeUnitsMap = new Map<string, any>();

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
            tradeUnitsMap.get(data.attemptId).reaction = data;
        }
    });

    // C. Feedback 매핑
    feedbacks.forEach((data) => {
        if (data.attemptId && tradeUnitsMap.has(data.attemptId)) {
            tradeUnitsMap.get(data.attemptId).feedback = data;
        }
    });

    // D. Confirmed Trade Log 매핑
    tradeLogs.forEach((data) => {
        if (data.attemptId && tradeUnitsMap.has(data.attemptId)) {
            const unit = tradeUnitsMap.get(data.attemptId);
            unit.trade = data;
            unit.outcome = data.outcomePatch || null;
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

    const aggregatesSnap = await adminDb.collection("userTradeDailyAggregates")
        .where("userId", "==", userId)
        .get();

    return aggregatesSnap.docs
        .map(doc => doc.data())
        .filter(data => getTimeMs(data.aggregatedAt) >= thirtyDaysAgoMs)
        .sort((a, b) => getTimeMs(b.aggregatedAt) - getTimeMs(a.aggregatedAt));
}