// backend/modules/stats/service.ts

import { getGuardrailReactionStats } from "./repository";

export async function getUserStatsMessage(userId: string): Promise<string> {
  const { totalCount, reviewCount } = await getGuardrailReactionStats(userId);

  return `불씨와 함께 ${totalCount}개의 기록을 쌓고 ${reviewCount}개의 감정 매도를 막았어요!`;
}