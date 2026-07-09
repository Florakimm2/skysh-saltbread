// backend/modules/stats/repository.ts

import { adminDb } from "@/backend/infrastructure/firebase/firebase-admin";

const reactionsRef = adminDb.collection("guardrail_reactions");

export async function getGuardrailReactionStats(userId: string) {
  const [totalSnapshot, reviewSnapshot] = await Promise.all([
    reactionsRef.where("userId", "==", userId).count().get(),
    reactionsRef
      .where("userId", "==", userId)
      .where("action", "==", "REVIEW")
      .count()
      .get(),
  ]);

  return {
    totalCount: totalSnapshot.data().count,
    reviewCount: reviewSnapshot.data().count,
  };
}