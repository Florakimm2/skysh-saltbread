import { getBehaviorSessionRecords } from "@/backend/modules/behavior/service";
import type { BehaviorSessionRecord } from "@/backend/modules/behavior/types";

type DashboardBehaviorData =
  | {
      status: "ready";
      records: BehaviorSessionRecord[];
    }
  | {
      status: "unavailable";
      records: [];
    };

export async function loadDashboardBehaviorData(
  userId: string,
): Promise<DashboardBehaviorData> {
  try {
    return {
      status: "ready",
      records: await getBehaviorSessionRecords(userId),
    };
  } catch (error) {
    console.warn(
      "Dashboard behavior data is temporarily unavailable:",
      error instanceof Error ? error.message : "Unknown error",
    );

    return {
      status: "unavailable",
      records: [],
    };
  }
}
