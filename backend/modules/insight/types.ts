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
    }
  | {
      status: "empty";
      sourceCount: 0;
    }
  | {
      status: "error";
      sourceCount: number;
    };
