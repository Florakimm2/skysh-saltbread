import { getBehaviorSessionRecords } from "@/backend/modules/behavior/service";
import type { BehaviorSessionRecord } from "@/backend/modules/behavior/types";
import { listGuardrailTimeline } from "@/backend/modules/logs/timeline";
import type { GuardrailTimelineResponse } from "@/backend/modules/logs/types";

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

type DashboardTimelineData =
  | {
      status: "ready";
      timeline: GuardrailTimelineResponse;
    }
  | {
      status: "unavailable";
      timeline: null;
    };

export async function loadDashboardTimelineData(
  userId: string,
  limit = 20,
): Promise<DashboardTimelineData> {
  try {
    return {
      status: "ready",
      timeline: await listGuardrailTimeline({ userId, limit }),
    };
  } catch (error) {
    console.warn(
      "Dashboard guardrail timeline is temporarily unavailable:",
      error instanceof Error ? error.message : "Unknown error",
    );

    return {
      status: "unavailable",
      timeline: null,
    };
  }
}
