// backend/modules/insight/types.ts

export type FastApiSendMode = "json" | "query";

export interface InsightRequestInput {
    userId?: string;
    summaries: string[];
  }
  
  export interface InsightResult {
    insight: string;
  }