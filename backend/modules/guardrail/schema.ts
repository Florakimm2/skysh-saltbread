// backend/modules/guardrail/schema.ts

import { z } from "zod";

export const riskLevelSchema = z.enum(["LOW", "MEDIUM", "HIGH"]);

export const visualModeSchema = z.enum([
  "CURIOUS",
  "SURPRISED",
  "FAST_BURN",
  "SCARED",
  "SAD",
]);

export const ruleExpressionSchema = z.any();

export const createUserGuardrailRuleSchema = z.object({
  name: z.string().min(1).max(80),
  description: z.string().nullable().optional().default(null),

  isEnabled: z.boolean(),
  priority: z.number().int().min(0),

  riskLevel: riskLevelSchema,
  visualMode: visualModeSchema,

  expression: ruleExpressionSchema,

  warningTitle: z.string().min(1).max(80),
  warningMessage: z.string().min(1).max(500),
});

export const patchUserGuardrailRuleSchema = z
  .object({
    name: z.string().min(1).max(80).optional(),
    description: z.string().nullable().optional(),

    isEnabled: z.boolean().optional(),
    priority: z.number().int().min(0).optional(),

    riskLevel: riskLevelSchema.optional(),
    visualMode: visualModeSchema.optional(),

    expression: ruleExpressionSchema.optional(),

    warningTitle: z.string().min(1).max(80).optional(),
    warningMessage: z.string().min(1).max(500).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "수정할 필드가 최소 1개 이상 필요합니다.",
  });

export const completeOnboardingSchema = z.object({
  personalDataConsentVersion: z.string().min(1),
  initialRules: z.array(createUserGuardrailRuleSchema).default([]),
});

export type CreateUserGuardrailRuleInput = z.infer<
  typeof createUserGuardrailRuleSchema
>;

export type PatchUserGuardrailRuleInput = z.infer<
  typeof patchUserGuardrailRuleSchema
>;

export type CompleteOnboardingInput = z.infer<typeof completeOnboardingSchema>;