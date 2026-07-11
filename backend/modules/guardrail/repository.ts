// backend/modules/guardrail/repository.ts

import { Timestamp } from "firebase-admin/firestore";
import { adminDb } from "@/backend/infrastructure/firebase/firebase-admin";
import type {
  RuleExpression,
  UserDTO,
  UserGuardrailRuleDTO,
} from "./types";

const usersRef = adminDb.collection("users");
const rulesRef = adminDb.collection("user_guardrail_rules");

function toIsoString(value: unknown): string {
  if (!value) return new Date().toISOString();

  if (
    typeof value === "object" &&
    value !== null &&
    "toDate" in value &&
    typeof (value as { toDate: () => Date }).toDate === "function"
  ) {
    return (value as { toDate: () => Date }).toDate().toISOString();
  }

  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string") return value;

  return new Date().toISOString();
}

function nullableIsoString(value: unknown): string | null {
  if (!value) return null;
  return toIsoString(value);
}

function userDocToDTO(
    userId: string,
    data: FirebaseFirestore.DocumentData
  ): UserDTO {
    return {
      userId: data.userId ?? data.id ?? userId,
      email: data.email ?? null,
      displayName: data.displayName ?? data.name ?? null,
      timezone: data.timezone ?? "Asia/Seoul",
  
      personalDataConsentAgreed: data.personalDataConsentAgreed ?? false,
      personalDataConsentAgreedAt: nullableIsoString(
        data.personalDataConsentAgreedAt
      ),
      personalDataConsentVersion: data.personalDataConsentVersion ?? null,
  
      onboardingCompleted: data.onboardingCompleted ?? false,
      onboardingCompletedAt: nullableIsoString(data.onboardingCompletedAt),
  
      createdAt: toIsoString(data.createdAt),
      updatedAt: toIsoString(data.updatedAt),
    };
}

function ruleDocToDTO(
  ruleId: string,
  data: FirebaseFirestore.DocumentData
): UserGuardrailRuleDTO {
  return {
    ruleId,
    userId: data.userId,

    name: data.name,
    description: data.description ?? null,

    isEnabled: data.isEnabled,
    priority: data.priority,

    riskLevel: data.riskLevel,
    visualMode: data.visualMode,

    expression: data.expression as RuleExpression,

    warningTitle: data.warningTitle,
    warningMessage: data.warningMessage,

    requiresPrivateApi: data.requiresPrivateApi,

    schemaVersion: data.schemaVersion ?? "v1",
    createdAt: toIsoString(data.createdAt),
    updatedAt: toIsoString(data.updatedAt),
  };
}

export async function ensureUserProfile(params: {
    userId: string;
    email?: string | null;
    displayName?: string | null;
    timezone?: string;
  }): Promise<UserDTO> {
    const userRef = usersRef.doc(params.userId);
    const now = Timestamp.now();
  
    await adminDb.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(userRef);
      const data = snapshot.data();
  
      if (!snapshot.exists) {
        transaction.set(userRef, {
          // 기존 auth 구조와 새 guardrail 구조를 둘 다 만족시키기 위해 둘 다 저장
          id: params.userId,
          userId: params.userId,
  
          email: params.email ?? null,
          name: params.displayName ?? null,
          displayName: params.displayName ?? null,
          timezone: params.timezone ?? "Asia/Seoul",
  
          personalDataConsentAgreed: false,
          personalDataConsentAgreedAt: null,
          personalDataConsentVersion: null,
  
          onboardingCompleted: false,
          onboardingCompletedAt: null,
  
          createdAt: now,
          updatedAt: now,
        });
  
        return;
      }
  
      transaction.set(
        userRef,
        {
          id: data?.id ?? params.userId,
          userId: data?.userId ?? params.userId,
  
          email: params.email ?? data?.email ?? null,
          name: data?.name ?? params.displayName ?? null,
          displayName:
            data?.displayName ?? data?.name ?? params.displayName ?? null,
          timezone: data?.timezone ?? params.timezone ?? "Asia/Seoul",
  
          personalDataConsentAgreed:
            data?.personalDataConsentAgreed ?? false,
          personalDataConsentAgreedAt:
            data?.personalDataConsentAgreedAt ?? null,
          personalDataConsentVersion:
            data?.personalDataConsentVersion ?? null,
  
          onboardingCompleted: data?.onboardingCompleted ?? false,
          onboardingCompletedAt: data?.onboardingCompletedAt ?? null,
  
          createdAt: data?.createdAt ?? now,
          updatedAt: now,
        },
        { merge: true }
      );
    });
  
    const saved = await userRef.get();
    return userDocToDTO(params.userId, saved.data() ?? {});
}

export async function getUserProfile(userId: string): Promise<UserDTO | null> {
  const snapshot = await usersRef.doc(userId).get();

  if (!snapshot.exists) return null;

  return userDocToDTO(userId, snapshot.data() ?? {});
}

export async function completeOnboardingInTransaction(params: {
  userId: string;
  personalDataConsentVersion: string;
  initialRules: Array<{
    name: string;
    description: string | null;
    isEnabled: boolean;
    priority: number;
    riskLevel: "LOW" | "MEDIUM" | "HIGH";
    visualMode: "CURIOUS" | "SURPRISED" | "FAST_BURN" | "SCARED" | "SAD";
    expression: RuleExpression;
    warningTitle: string;
    warningMessage: string;
    requiresPrivateApi: boolean;
  }>;
}): Promise<{
  user: UserDTO;
  rules: UserGuardrailRuleDTO[];
}> {
  const userRef = usersRef.doc(params.userId);
  const now = Timestamp.now();
  const createdRuleRefs = params.initialRules.map(() => rulesRef.doc());

  await adminDb.runTransaction(async (transaction) => {
    const userSnapshot = await transaction.get(userRef);

    if (!userSnapshot.exists) {
      transaction.set(userRef, {
        userId: params.userId,
        email: null,
        displayName: null,
        timezone: "Asia/Seoul",

        personalDataConsentAgreed: true,
        personalDataConsentAgreedAt: now,
        personalDataConsentVersion: params.personalDataConsentVersion,

        onboardingCompleted: true,
        onboardingCompletedAt: now,

        createdAt: now,
        updatedAt: now,
      });
    } else {
      transaction.set(
        userRef,
        {
          personalDataConsentAgreed: true,
          personalDataConsentAgreedAt: now,
          personalDataConsentVersion: params.personalDataConsentVersion,

          onboardingCompleted: true,
          onboardingCompletedAt: now,

          updatedAt: now,
        },
        { merge: true }
      );
    }

    params.initialRules.forEach((rule, index) => {
      const ruleRef = createdRuleRefs[index];

      transaction.set(ruleRef, {
        ruleId: ruleRef.id,
        userId: params.userId,

        name: rule.name,
        description: rule.description,

        isEnabled: rule.isEnabled,
        priority: rule.priority,

        riskLevel: rule.riskLevel,
        visualMode: rule.visualMode,

        expression: rule.expression,

        warningTitle: rule.warningTitle,
        warningMessage: rule.warningMessage,

        requiresPrivateApi: rule.requiresPrivateApi,

        schemaVersion: "v1",
        createdAt: now,
        updatedAt: now,
      });
    });
  });

  const userSnapshot = await userRef.get();
  const ruleSnapshots = await Promise.all(
    createdRuleRefs.map((ruleRef) => ruleRef.get())
  );

  return {
    user: userDocToDTO(params.userId, userSnapshot.data() ?? {}),
    rules: ruleSnapshots.map((snapshot) =>
      ruleDocToDTO(snapshot.id, snapshot.data() ?? {})
    ),
  };
}

export async function listUserRules(
  userId: string
): Promise<UserGuardrailRuleDTO[]> {
  const snapshot = await rulesRef.where("userId", "==", userId).get();

  return snapshot.docs
    .map((doc) => ruleDocToDTO(doc.id, doc.data()))
    .sort((a, b) => {
      if (a.priority !== b.priority) return a.priority - b.priority;
      return a.createdAt.localeCompare(b.createdAt);
    });
}

export async function createUserRule(params: {
  userId: string;
  rule: {
    name: string;
    description: string | null;
    isEnabled: boolean;
    priority: number;
    riskLevel: "LOW" | "MEDIUM" | "HIGH";
    visualMode: "CURIOUS" | "SURPRISED" | "FAST_BURN" | "SCARED" | "SAD";
    expression: RuleExpression;
    warningTitle: string;
    warningMessage: string;
    requiresPrivateApi: boolean;
  };
}): Promise<UserGuardrailRuleDTO> {
  const ruleRef = rulesRef.doc();
  const now = Timestamp.now();

  const data = {
    ruleId: ruleRef.id,
    userId: params.userId,

    name: params.rule.name,
    description: params.rule.description,

    isEnabled: params.rule.isEnabled,
    priority: params.rule.priority,

    riskLevel: params.rule.riskLevel,
    visualMode: params.rule.visualMode,

    expression: params.rule.expression,

    warningTitle: params.rule.warningTitle,
    warningMessage: params.rule.warningMessage,

    requiresPrivateApi: params.rule.requiresPrivateApi,

    schemaVersion: "v1",
    createdAt: now,
    updatedAt: now,
  };

  await ruleRef.set(data);

  return ruleDocToDTO(ruleRef.id, data);
}

export async function getOwnedRule(params: {
  userId: string;
  ruleId: string;
}): Promise<UserGuardrailRuleDTO | null> {
  const snapshot = await rulesRef.doc(params.ruleId).get();

  if (!snapshot.exists) return null;

  const dto = ruleDocToDTO(snapshot.id, snapshot.data() ?? {});

  if (dto.userId !== params.userId) return null;

  return dto;
}

export async function patchOwnedRule(params: {
  userId: string;
  ruleId: string;
  patch: Partial<{
    name: string;
    description: string | null;
    isEnabled: boolean;
    priority: number;
    riskLevel: "LOW" | "MEDIUM" | "HIGH";
    visualMode: "CURIOUS" | "SURPRISED" | "FAST_BURN" | "SCARED" | "SAD";
    expression: RuleExpression;
    warningTitle: string;
    warningMessage: string;
    requiresPrivateApi: boolean;
  }>;
}): Promise<UserGuardrailRuleDTO | null> {
  const existing = await getOwnedRule({
    userId: params.userId,
    ruleId: params.ruleId,
  });

  if (!existing) return null;

  const now = Timestamp.now();

  await rulesRef.doc(params.ruleId).set(
    {
      ...params.patch,
      updatedAt: now,
    },
    { merge: true }
  );

  const updated = await rulesRef.doc(params.ruleId).get();

  return ruleDocToDTO(updated.id, updated.data() ?? {});
}

export async function reorderOwnedRules(params: {
  userId: string;
  ruleIds: string[];
}): Promise<UserGuardrailRuleDTO[] | null> {
  const currentRules = await listUserRules(params.userId);
  const currentRuleIds = currentRules.map((rule) => rule.ruleId);
  const requestedRuleIds = [...params.ruleIds];

  if (
    currentRuleIds.length !== requestedRuleIds.length ||
    new Set(requestedRuleIds).size !== requestedRuleIds.length ||
    currentRuleIds.some((ruleId) => !requestedRuleIds.includes(ruleId))
  ) {
    return null;
  }

  const now = Timestamp.now();

  await adminDb.runTransaction(async (transaction) => {
    requestedRuleIds.forEach((ruleId, index) => {
      transaction.set(
        rulesRef.doc(ruleId),
        {
          priority: index + 1,
          updatedAt: now,
        },
        { merge: true },
      );
    });
  });

  return listUserRules(params.userId);
}

export async function deleteOwnedRule(params: {
  userId: string;
  ruleId: string;
}): Promise<boolean> {
  const existing = await getOwnedRule({
    userId: params.userId,
    ruleId: params.ruleId,
  });

  if (!existing) return false;

  await rulesRef.doc(params.ruleId).delete();

  return true;
}
