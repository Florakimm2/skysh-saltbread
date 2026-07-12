// backend/modules/insight/types.ts

export type FastApiSendMode = "json" | "query";

// 규칙 엔진이 산출하는 테마별 앵커 점수 (내부 계산/텍스트 삽입용, 백엔드로는 전송하지 않음)
export interface AnchorScoreItem {
  theme: "EMOTIONAL" | "GUARDRAIL" | "FEE" | "SLIPPAGE";
  anchor: number;
}

export interface InsightRequestInput {
  userId?: string;
  summaries: string[];
}

export interface InsightResult {
  insight: string;
}

export type FastApiInsightCard = {
  title: string;
  description: string;
  severity: string;
};

export type FastApiInsightResponse = {
  summary?: string;
  flameStatus?: string;
  cards?: FastApiInsightCard[];
};

export type DashboardInsightResult =
  | {
      status: "ready";
      insight: string;
      sourceCount: number;
      parsedData: FastApiInsightResponse;
    }
  | {
      status: "empty";
      sourceCount: 0;
    }
  | {
      status: "error";
      sourceCount: number;
    };
