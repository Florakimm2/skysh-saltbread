// backend/modules/stats/service.ts

import { getGuardrailReactionStats } from "./repository";

export async function getUserStatsMessage(userId: string): Promise<string> {
  const { totalCount, reviewCount } = await getGuardrailReactionStats(userId);

  return `불씨와 함께 ${totalCount}개의 기록을 쌓고 ${reviewCount}번 원칙을 다시 확인했어요!`;
}
