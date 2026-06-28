// backend/modules/insight/schema.ts

import { z } from "zod";

export const insightRequestSchema = z.object({
  userId: z.string().min(1).optional(),

  summaries: z
    .array(
      z
        .string()
        .min(1, "summaries 안의 문자열은 비어 있을 수 없습니다.")
        .max(5000, "summary 한 항목이 너무 깁니다.")
    )
    .min(1, "summaries는 최소 1개 이상이어야 합니다.")
    .max(50, "summaries는 최대 50개까지만 보낼 수 있습니다."),
});

export type InsightRequestBody = z.infer<typeof insightRequestSchema>;