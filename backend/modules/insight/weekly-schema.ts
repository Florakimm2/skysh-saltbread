import { z } from "zod";

export const weeklyInsightGenerateSchema = z.object({
  weekKey: z.string().regex(/^\d{4}-W\d{2}$/).optional().nullable(),
});
