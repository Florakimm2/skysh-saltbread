// backend/modules/insight/rules.ts
import { getMonthlyTradeUnits, getMonthlyAggregates } from "./repository";
import type { MonthlyAggregateRecord, OptimizedTradeUnit } from "./repository";

// ── 앵커 점수 타입 (테마 순서는 프롬프트 카드 순서와 동일) ──
export interface AnchorScore {
    theme: "EMOTIONAL" | "GUARDRAIL" | "FEE" | "SLIPPAGE";
    anchor: number; // 규칙 엔진이 산출한 기준 점수 (양수=칭찬, 음수=경고)
}

export interface InsightMetricsResult {
    summaries: string[];
    anchorScores: AnchorScore[];
}

// value를 [inMin, inMax] → [outMin, outMax]로 선형 매핑 (클램핑 포함)
function linearMap(value: number, inMin: number, inMax: number, outMin: number, outMax: number): number {
    const clamped = Math.max(inMin, Math.min(inMax, value));
    const ratio = (clamped - inMin) / (inMax - inMin || 1);
    return Math.round(outMin + ratio * (outMax - outMin));
}

export async function analyzeInsights(userId: string): Promise<InsightMetricsResult> {
    const tradeUnits = await getMonthlyTradeUnits(userId);
    const dailyAggregates = await getMonthlyAggregates(userId);

    const now = Date.now();
    const metricSummaries: string[] = [];
    const anchorScores: AnchorScore[] = [];

    // ═══════════════════════════════════════════
    // 1. [EMOTIONAL] 원칙 회고 지표 산출 + 앵커 점수
    // ═══════════════════════════════════════════
    const sevenDaysAgo = new Date(now - 7 * 24 * 60 * 60 * 1000).getTime();
    const threeDaysAgo = new Date(now - 3 * 24 * 60 * 60 * 1000).getTime();

    const recent7DaysFeedbacks = tradeUnits.filter(u => {
        const tradeTime = new Date(u.trade?.orderCreatedAt || 0).getTime();
        return u.feedback !== null && tradeTime >= sevenDaysAgo;
    });

    const emotional7Days = recent7DaysFeedbacks.filter(u => u.feedback?.selfAssessment === 'EMOTIONAL');
    const emotional3Days = emotional7Days.filter(u => {
        const tradeTime = new Date(u.trade?.orderCreatedAt || 0).getTime();
        return tradeTime >= threeDaysAgo;
    });

    const emotionalRatio = recent7DaysFeedbacks.length > 0 
        ? emotional7Days.length / recent7DaysFeedbacks.length 
        : 0;

    metricSummaries.push(
        `[지표-원칙회고] 최근 7일간 피드백 제출 거래 수: ${recent7DaysFeedbacks.length}건, 후회했던 거래 기록 수: ${emotional7Days.length}건, 후회 거래 기록 비율: ${(emotionalRatio * 100).toFixed(1)}%, 최근 3일간 후회 거래 기록 횟수: ${emotional3Days.length}회`
    );

    let emotionalAnchor: number;
    if (emotionalRatio === 0 && emotional3Days.length === 0) {
        emotionalAnchor = recent7DaysFeedbacks.length >= 5 ? 100 : linearMap(recent7DaysFeedbacks.length, 0, 5, 70, 100);
    } else {
        emotionalAnchor = linearMap(emotionalRatio, 0.01, 0.3, -70, -100);
    }
    anchorScores.push({ theme: "EMOTIONAL", anchor: emotionalAnchor });

    // ═══════════════════════════════════════════
    // 2. [GUARDRAIL] 지표 산출 + 앵커 점수
    // ═══════════════════════════════════════════
    const proceedTrades = tradeUnits.filter(u => u.reaction?.action === 'PROCEED');
    const emotionalProceeds = proceedTrades.filter(u => u.feedback?.selfAssessment === 'EMOTIONAL');
    
    const proceedRiskRatio = proceedTrades.length > 0
        ? (emotionalProceeds.length / proceedTrades.length) * 100
        : 0;

    metricSummaries.push(
        `[지표-가드레일] 경고 후 진행(PROCEED) 횟수: ${proceedTrades.length}회, 진행 후 후회 거래로 기록된 건수: ${emotionalProceeds.length}건, 경고 후 후회 기록 비율: ${proceedRiskRatio.toFixed(1)}%`
    );

    let guardrailAnchor: number;
    if (proceedTrades.length === 0) {
        guardrailAnchor = 100;
    } else if (emotionalProceeds.length === 0) {
        guardrailAnchor = linearMap(proceedTrades.length, 1, 5, 60, 0);
    } else {
        guardrailAnchor = linearMap(proceedRiskRatio, 10, 80, -80, -100);
    }
    anchorScores.push({ theme: "GUARDRAIL", anchor: guardrailAnchor });

    // ═══════════════════════════════════════════
    // 3. [FEE] 지표 산출 + 앵커 점수
    // ═══════════════════════════════════════════
    let maxFeeRatio = 0;
    let maxCancelledRatio = 0;

    for (const daily of dailyAggregates) {
        const metric = daily as MonthlyAggregateRecord;
        const paidFee = Number(metric.dailyPaidFee || metric.paidFee || 0);
        const executedFunds = Number(metric.dailyExecutedFunds || metric.executedVolume || 0);
        const cancelledUnfilledRatio = Number(metric.cancelledUnfilledRatio || 0);

        const feeRatio = breweryFunds(paidFee, executedFunds);

        if (feeRatio > maxFeeRatio) maxFeeRatio = feeRatio;
        if (cancelledUnfilledRatio > maxCancelledRatio) maxCancelledRatio = cancelledUnfilledRatio;
    }

    metricSummaries.push(
        `[지표-비용낭비] 월간 일일 최대 수수료 비율: ${(maxFeeRatio * 100).toFixed(3)}%, 일일 최대 미체결 취소 비율: ${(maxCancelledRatio * 100).toFixed(1)}%`
    );

    let feeAnchor: number;
    if (maxFeeRatio <= 0.0005 && maxCancelledRatio <= 0.05) {
        feeAnchor = 70;
    } else if (maxFeeRatio <= 0.001 && maxCancelledRatio <= 0.2) {
        feeAnchor = 50;
    } else if (maxFeeRatio > 0.003 || maxCancelledRatio > 0.5) {
        const feeSev = linearMap(maxFeeRatio, 0.003, 0.01, -50, -70);
        const cancelSev = linearMap(maxCancelledRatio, 0.5, 0.8, -50, -70);
        feeAnchor = Math.min(feeSev, cancelSev);
    } else {
        feeAnchor = linearMap(Math.max(maxFeeRatio * 1000, maxCancelledRatio * 100), 1, 30, -30, -50);
    }
    anchorScores.push({ theme: "FEE", anchor: feeAnchor });

    // ═══════════════════════════════════════════
    // 4. [SLIPPAGE] 지표 산출 + 앵커 점수
    // ═══════════════════════════════════════════
    const marketTrades = tradeUnits.filter((u: OptimizedTradeUnit) => {
        return u.snapshot?.orderMode === 'MARKET' && Number(u.snapshot?.spreadRate || 0) >= 0.002;
    });

    let maxSlippage = 0;

    for (const trade of marketTrades) {
        if (!trade.outcome?.executedFunds || !trade.outcome?.executedVolume || !trade.snapshot?.tradePriceAtIntent) {
            continue;
        }

        const executedFunds = Number(trade.outcome.executedFunds);
        const executedVolume = Number(trade.outcome.executedVolume);
        const tradePriceAtIntent = Number(trade.snapshot.tradePriceAtIntent);

        if (executedVolume === 0 || tradePriceAtIntent === 0) continue;

        const avgFillPrice = executedFunds / executedVolume;
        const slippage = Math.abs(avgFillPrice - tradePriceAtIntent) / tradePriceAtIntent;

        if (slippage > maxSlippage) maxSlippage = slippage;
    }

    metricSummaries.push(
        `[지표-슬리피지] 고스프레드 시장가 매매 횟수: ${marketTrades.length}회, 감지된 최대 슬리피지율: ${(maxSlippage * 100).toFixed(2)}%`
    );

    let slippageAnchor: number;
    if (marketTrades.length === 0) {
        slippageAnchor = 80;
    } else if (maxSlippage <= 0.001) {
        slippageAnchor = linearMap(marketTrades.length, 1, 5, 70, 50);
    } else {
        slippageAnchor = linearMap(maxSlippage, 0.001, 0.005, -60, -80);
    }
    anchorScores.push({ theme: "SLIPPAGE", anchor: slippageAnchor });

    return { summaries: metricSummaries, anchorScores };
}

function breweryFunds(paidFee: number, executedFunds: number): number {
    if (executedFunds === 0) return 0;
    return paidFee / executedFunds;
}
