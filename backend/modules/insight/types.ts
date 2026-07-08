// backend/modules/insight/types.ts

export type FastApiSendMode = "json" | "query";

export interface InsightRequestInput {
  userId?: string;
  summaries: string[];
}

export interface InsightResult {
  insight: string;
}

export type DashboardInsightResult =
  | {
      status: "ready";
      insight: string;
      sourceCount: number;
      parsedData: any; // ready일 때는 무조건 데이터를 들고 옵니다.
    }
  | {
      status: "empty";
      sourceCount: 0;
    }
  | {
      status: "error";
      sourceCount: number;
    };
