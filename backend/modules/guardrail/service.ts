// backend/modules/guardrail/service.ts

import { ApiError } from "@/backend/common/api";
import { validateRuleExpression } from "./expression";
import {
  completeOnboardingInTransaction,
  createUserRule,
  deleteOwnedRule,
  ensureUserProfile,
  getOwnedRule,
  getUserProfile,
  listUserRules,
  patchOwnedRule,
} from "./repository";
import type {
  UserGuardrailRuleCreateRequest,
  UserGuardrailRulePatchRequest,
} from "./types";

async function getRequiredUserProfile(userId: string) {
  const user = await getUserProfile(userId);

  if (!user) {
    return ensureUserProfile({ userId });
  }

  return user;
}

async function assertConsentReady(userId: string) {
  const user = await getRequiredUserProfile(userId);

  if (!user.personalDataConsentAgreed || !user.onboardingCompleted) {
    throw new ApiError(
      409,
      "ONBOARDING_REQUIRED",
      "개인정보 동의와 온보딩 완료가 필요합니다."
    );
  }

  return user;
}

export async function ensureProfileAfterSignup(params: {
  userId: string;
  email?: string | null;
  displayName?: string | null;
}) {
  return ensureUserProfile(params);
}

export async function completeOnboarding(params: {
  userId: string;
  personalDataConsentVersion: string;
  initialRules: UserGuardrailRuleCreateRequest[];
}) {
  const preparedRules = params.initialRules.map((rule) => {
    const validationResult = validateRuleExpression(rule.expression);

    return {
      ...rule,
      description: rule.description ?? null,
      requiresPrivateApi: validationResult.requiresPrivateApi,
    };
  });

  return completeOnboardingInTransaction({
    userId: params.userId,
    personalDataConsentVersion: params.personalDataConsentVersion,
    initialRules: preparedRules,
  });
}

export async function listGuardrailRules(params: { userId: string }) {
  await getRequiredUserProfile(params.userId);
  return listUserRules(params.userId);
}

export async function createGuardrailRule(params: {
  userId: string;
  input: UserGuardrailRuleCreateRequest;
}) {
  await assertConsentReady(params.userId);

  const validationResult = validateRuleExpression(params.input.expression);

  return createUserRule({
    userId: params.userId,
    rule: {
      ...params.input,
      description: params.input.description ?? null,
      requiresPrivateApi: validationResult.requiresPrivateApi,
    },
  });
}

export async function patchGuardrailRule(params: {
  userId: string;
  ruleId: string;
  input: UserGuardrailRulePatchRequest;
}) {
  await assertConsentReady(params.userId);

  const existing = await getOwnedRule({
    userId: params.userId,
    ruleId: params.ruleId,
  });

  if (!existing) {
    throw new ApiError(
      404,
      "RULE_NOT_FOUND",
      "규칙을 찾을 수 없거나 접근 권한이 없습니다."
    );
  }

  let requiresPrivateApiPatch:
    | {
        requiresPrivateApi: boolean;
      }
    | Record<string, never> = {};

  if (params.input.expression !== undefined) {
    const validationResult = validateRuleExpression(params.input.expression);
    requiresPrivateApiPatch = {
      requiresPrivateApi: validationResult.requiresPrivateApi,
    };
  }

  const updated = await patchOwnedRule({
    userId: params.userId,
    ruleId: params.ruleId,
    patch: {
      ...params.input,
      ...requiresPrivateApiPatch,
    },
  });

  if (!updated) {
    throw new ApiError(
      404,
      "RULE_NOT_FOUND",
      "규칙을 찾을 수 없거나 접근 권한이 없습니다."
    );
  }

  return updated;
}

export async function deleteGuardrailRule(params: {
  userId: string;
  ruleId: string;
}) {
  const deleted = await deleteOwnedRule({
    userId: params.userId,
    ruleId: params.ruleId,
  });

  if (!deleted) {
    throw new ApiError(
      404,
      "RULE_NOT_FOUND",
      "규칙을 찾을 수 없거나 접근 권한이 없습니다."
    );
  }

  return {
    ruleId: params.ruleId,
    deleted: true,
  };
}