import Decimal from 'decimal.js';
import { getMonthlyTradeUnits, getMonthlyAggregates } from "./repository";

export interface RuleInsight {
    type: string;
    title: string;
    message: string;
    score: number;
}

export async function analyzeInsights(userId: string): Promise<RuleInsight[]> {
    const tradeUnits = await getMonthlyTradeUnits(userId);
    const dailyAggregates = await getMonthlyAggregates(userId);

    const insights: RuleInsight[] = [];
    const now = Date.now();

  // 1. [🧐 아차! 하는 순간] 판별
  const sevenDaysAgo = new Date(now - 7 * 24 * 60 * 60 * 1000).getTime();
  const threeDaysAgo = new Date(now - 3 * 24 * 60 * 60 * 1000).getTime();

  // 최근 7일 이내 피드백이 있는 거래 추출
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
    ? new Decimal(emotional7Days.length).div(recent7DaysFeedbacks.length).toNumber() 
    : 0;

    if (emotionalRatio >= 0.2 || emotional3Days.length >= 3) {
    insights.push({
        type: "EMOTIONAL_WARNING",
        title: "[🧐 아차! 하는 순간] 주문 직후의 후회 감지",
        message: "버튼을 누르고 나서야 후회하는 패턴이 반복되고 있습니다. 주문을 제출하기 전, 초안 화면에서 딱 5초만 심호흡을 해보세요.",
        score: -70
    });
    }

  // 2. [🙉 귀를 닫은 트레이더] 판별
    const proceedTrades = tradeUnits.filter(u => u.reaction?.action === 'PROCEED');
    const emotionalProceeds = proceedTrades.filter(u => u.feedback?.selfAssessment === 'EMOTIONAL');

    if (proceedTrades.length > 0) {
    const proceedRiskRatio = new Decimal(emotionalProceeds.length)
        .div(proceedTrades.length)
        .times(100)
        .toNumber();

    if (proceedRiskRatio > 30) {
        insights.push({
        type: "GUARDRAIL_IGNORE",
        title: "[🙉 귀를 닫은 트레이더] 가드레일 경고 무시와 결과",
        message: "경고를 무시하고 진행한 거래에서 '감정적 진입' 피드백이 지속적으로 쌓이고 있습니다. 다음번엔 시스템의 브레이크를 한 번 믿어보시는 걸 추천합니다.",
        score: -80
        });
    }
    }

  // 3. [💸 수수료 누수 경보] 판별
    for (const daily of dailyAggregates) {
    const paidFee = new Decimal(daily.dailyPaidFee || '0');
    const executedFunds = new Decimal(daily.dailyExecutedFunds || '0');
    const cancelledUnfilledRatio = new Decimal(daily.cancelledUnfilledRatio || '0');

    let feeRatio = new Decimal(0);
    if (!executedFunds.isZero()) {
        feeRatio = paidFee.div(executedFunds);
    }

    if (feeRatio.gt(0.001) || cancelledUnfilledRatio.gt(0.5)) {
        insights.push({
        type: "FEE_WASTE",
        title: "[💸 수수료 누수 경보] 과매매 및 비용 낭비",
        message: "오늘 하루 거래대금 대비 수수료 출혈이 크거나 미체결 취소 비율이 높습니다. 잦은 매매가 오히려 수익을 갉아먹고 있지 않은지 점검해 보세요.",
        score: -50
        });
        break; 
    }
    }

  // 4. [💸 체결가 착시 주의] 판별
    const marketTrades = tradeUnits.filter(u => 
    u.snapshot?.orderMode === 'MARKET' && 
    new Decimal(u.snapshot?.spreadRate || '0').gte(0.002)
    );

    for (const trade of marketTrades) {
    if (!trade.outcome?.executedFunds || !trade.outcome?.executedVolume || !trade.snapshot?.tradePriceAtIntent) {
        continue;
    }

    const executedFunds = new Decimal(trade.outcome.executedFunds);
    const executedVolume = new Decimal(trade.outcome.executedVolume);
    const tradePriceAtIntent = new Decimal(trade.snapshot.tradePriceAtIntent);

    if (executedVolume.isZero() || tradePriceAtIntent.isZero()) {
        continue;
    }

    const avgFillPrice = executedFunds.div(executedVolume);
    const slippage = avgFillPrice.minus(tradePriceAtIntent).abs().div(tradePriceAtIntent);

    if (slippage.gt(0.002)) {
        insights.push({
        type: "SLIPPAGE_WARNING",
        title: "[💸 체결가 착시 주의] 시장가 맹신 경고",
        message: "시장가 매수 시 호가창 잔량 부족으로 인해, 예상보다 비싸게 체결되었습니다. 진입하자마자 체결 손실을 안고 시작하는 셈입니다.",
        score: -60
        });
        break;
    }
    }

    return insights;
}