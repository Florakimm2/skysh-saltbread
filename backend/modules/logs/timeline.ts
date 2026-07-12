import { RULE_FIELD_CATALOG } from "@/backend/modules/guardrail/catalog";
import type { RuleExpression, RuleOperator } from "@/backend/modules/guardrail/types";
import { listGuardrailTimelineSources } from "./repository";
import type {
  EnrichedRuleData,
  GuardrailRuleSnapshot,
  GuardrailReactionDTO,
  GuardrailTimelineItem,
  GuardrailTimelineResponse,
  OrderContextSnapshotDTO,
  RuleEvaluationSnapshot,
} from "./types";

type TimelineTypeFilter = "ALL" | "WARNING" | "FEEDBACK";

function normalizeLimit(limit?: number) {
  if (!limit || !Number.isFinite(limit)) return 20;
  return Math.min(Math.max(Math.floor(limit), 1), 100);
}

function toTime(value: string) {
  const time = new Date(value).getTime();
  return Number.isNaN(time) ? 0 : time;
}

function encodeCursor(item: GuardrailTimelineItem) {
  return Buffer.from(
    JSON.stringify({ occurredAt: item.occurredAt, id: item.id }),
  ).toString("base64url");
}

function decodeCursor(cursor?: string | null) {
  if (!cursor) return null;

  try {
    const parsed = JSON.parse(
      Buffer.from(cursor, "base64url").toString("utf8"),
    ) as { occurredAt?: unknown; id?: unknown };

    if (typeof parsed.occurredAt !== "string" || typeof parsed.id !== "string") {
      return null;
    }

    return {
      occurredAt: parsed.occurredAt,
      id: parsed.id,
    };
  } catch {
    return null;
  }
}

function isWarningSnapshot(snapshot: OrderContextSnapshotDTO) {
  return (
    snapshot.shownRuleIds.length > 0 ||
    snapshot.primaryShownRuleId !== null ||
    snapshot.snapshotTrigger === "GUARDRAIL_SHOWN"
  );
}

function uniqueIds(ids: Array<string | null | undefined>) {
  return [...new Set(ids.filter((id): id is string => Boolean(id)))];
}

function getPrimaryRuleId(snapshot: OrderContextSnapshotDTO) {
  return (
    snapshot.primaryShownRuleId ??
    snapshot.shownRuleIds[0] ??
    snapshot.matchedRuleIdsAtSnapshot[0] ??
    null
  );
}

function getShownRuleIds(snapshot: OrderContextSnapshotDTO) {
  return uniqueIds([
    getPrimaryRuleId(snapshot),
    ...snapshot.shownRuleIds,
    ...snapshot.matchedRuleIdsAtSnapshot,
  ]);
}

function enrichFromRuleSnapshot(snapshot: GuardrailRuleSnapshot): EnrichedRuleData {
  return {
    ruleId: snapshot.ruleId,
    name: snapshot.name,
    description: snapshot.description ?? null,
    riskLevel: snapshot.riskLevel,
    visualMode: snapshot.visualMode,
    warningTitle: snapshot.warningTitle ?? snapshot.name,
    warningMessage: snapshot.warningMessage ?? snapshot.description ?? "",
    expression: snapshot.expression,
    schemaVersion: "v1",
    updatedAt: "",
    historySource: "EVALUATION_SNAPSHOT",
    historyNotice: "경고 발생 당시 저장된 규칙 정보입니다.",
    conditionResults: [],
  };
}

const OPERATOR_LABELS: Record<RuleOperator, string> = {
  EQ: "같음",
  NEQ: "같지 않음",
  GT: "초과",
  GTE: "이상",
  LT: "미만",
  LTE: "이하",
  IN: "포함",
  NOT_IN: "포함하지 않음",
  IS_NULL: "값 없음",
  IS_NOT_NULL: "값 있음",
};

const DATA_CATEGORY_LABELS = {
  ORDER: "주문",
  BEHAVIOR: "행동",
  MARKET: "시장",
  ACCOUNT: "개인 계정",
} as const;

function toConditionResults(evaluation: RuleEvaluationSnapshot) {
  return evaluation.conditions.map((condition) => {
    const field = RULE_FIELD_CATALOG[
      condition.leftField as keyof typeof RULE_FIELD_CATALOG
    ];

    return {
      leftField: condition.leftField,
      fieldLabel: field?.label ?? condition.leftField,
      operator: condition.operator,
      operatorLabel: OPERATOR_LABELS[condition.operator],
      expectedValue: condition.expectedValue,
      actualValue: condition.actualValue,
      matched: condition.matched,
      dataCategory: condition.dataCategory,
      dataCategoryLabel: DATA_CATEGORY_LABELS[condition.dataCategory],
      unavailableReason:
        field?.requiresPrivateApi &&
        (condition.actualValue === null || condition.actualValue === undefined)
          ? "MISSING_PERSONAL_DATA"
          : condition.actualValue === null || condition.actualValue === undefined
            ? "REQUIRED_FIELD_MISSING"
            : null,
    };
  });
}

function enrichFromStoredEvaluation(
  evaluation: RuleEvaluationSnapshot,
): EnrichedRuleData {
  return {
    ...enrichFromRuleSnapshot({
      ruleId: evaluation.ruleId,
      name: evaluation.name || evaluation.ruleName,
      description: evaluation.description ?? null,
      priority: evaluation.priority,
      riskLevel: evaluation.riskLevel,
      visualMode: evaluation.visualMode,
      expression: evaluation.expression,
      warningTitle: evaluation.warningTitle ?? evaluation.ruleName,
      warningMessage: evaluation.warningMessage ?? evaluation.description ?? "",
    }),
    ruleVersion: evaluation.ruleVersion,
    conditionResults: toConditionResults(evaluation),
  };
}

function enrichMissingRule(ruleId: string): EnrichedRuleData {
  const expression = {
    nodeType: "GROUP",
    operator: "AND",
    children: [],
  } satisfies RuleExpression;

  return {
    ruleId,
    name: "삭제되었거나 찾을 수 없는 규칙",
    description: "당시 규칙 상세 정보 없음",
    riskLevel: "MEDIUM",
    visualMode: "CURIOUS",
    warningTitle: "규칙 상세 정보 없음",
    warningMessage: "저장된 규칙 정보가 없습니다.",
    expression,
    schemaVersion: "v1",
    updatedAt: "",
    historySource: "MISSING_RULE",
    historyNotice: "저장된 규칙 정보가 없습니다.",
    conditionResults: [],
  };
}

function buildRuleData(params: {
  ruleId: string;
  snapshot: OrderContextSnapshotDTO;
}) {
  const primarySnapshot =
    params.snapshot.ruleSnapshot?.ruleId === params.ruleId
      ? params.snapshot.ruleSnapshot
      : null;
  const storedSnapshot =
    primarySnapshot ??
    params.snapshot.ruleSnapshots.find(
      (ruleSnapshot) => ruleSnapshot.ruleId === params.ruleId,
    );

  if (storedSnapshot) return enrichFromRuleSnapshot(storedSnapshot);

  const stored = params.snapshot.ruleEvaluationSnapshots.find(
    (evaluation) => evaluation.ruleId === params.ruleId,
  );

  if (stored) return enrichFromStoredEvaluation(stored);

  return enrichMissingRule(params.ruleId);
}

function latestReactionBySnapshot(reactions: GuardrailReactionDTO[]) {
  const map = new Map<string, GuardrailReactionDTO>();

  for (const reaction of reactions) {
    const existing = map.get(reaction.snapshotId);
    if (!existing || toTime(reaction.reactedAt) > toTime(existing.reactedAt)) {
      map.set(reaction.snapshotId, reaction);
    }
  }

  return map;
}

function latestSnapshotByAttempt(snapshots: OrderContextSnapshotDTO[]) {
  const map = new Map<string, OrderContextSnapshotDTO>();

  for (const snapshot of snapshots) {
    if (!snapshot.attemptId) continue;
    const existing = map.get(snapshot.attemptId);
    if (!existing || toTime(snapshot.capturedAt) > toTime(existing.capturedAt)) {
      map.set(snapshot.attemptId, snapshot);
    }
  }

  return map;
}

function sortTimelineItems(
  left: GuardrailTimelineItem,
  right: GuardrailTimelineItem,
) {
  const timeDiff = toTime(right.occurredAt) - toTime(left.occurredAt);
  if (timeDiff !== 0) return timeDiff;
  return right.id.localeCompare(left.id);
}

function isAfterCursor(item: GuardrailTimelineItem, cursor: { occurredAt: string; id: string }) {
  const itemTime = toTime(item.occurredAt);
  const cursorTime = toTime(cursor.occurredAt);

  if (itemTime < cursorTime) return true;
  if (itemTime > cursorTime) return false;
  return item.id < cursor.id;
}

export async function listGuardrailTimeline(params: {
  userId: string;
  limit?: number;
  cursor?: string | null;
  type?: TimelineTypeFilter;
}): Promise<GuardrailTimelineResponse> {
  const limit = normalizeLimit(params.limit);
  const typeFilter = params.type ?? "ALL";
  const decodedCursor = decodeCursor(params.cursor);
  const { snapshots, reactions, feedbacks } =
    await listGuardrailTimelineSources(params.userId);
  const reactionBySnapshot = latestReactionBySnapshot(reactions);
  const snapshotByAttempt = latestSnapshotByAttempt(snapshots);

  const warningItems: GuardrailTimelineItem[] = snapshots
    .filter(isWarningSnapshot)
    .map((snapshot) => {
      const shownRuleIds = getShownRuleIds(snapshot);
      const shownRules = shownRuleIds.map((ruleId) =>
        buildRuleData({ ruleId, snapshot }),
      );
      const primaryRuleId = getPrimaryRuleId(snapshot);
      const rule =
        shownRules.find((item) => item.ruleId === primaryRuleId) ??
        shownRules[0];

      return {
        type: "WARNING",
        id: `warning:${snapshot.snapshotId}`,
        occurredAt: snapshot.capturedAt,
        snapshot,
        rule,
        shownRules,
        reaction: reactionBySnapshot.get(snapshot.snapshotId) ?? null,
      };
    });

  const feedbackItems: GuardrailTimelineItem[] = feedbacks.map((feedback) => ({
    type: "FEEDBACK",
    id: `feedback:${feedback.feedbackId}`,
    occurredAt: feedback.respondedAt,
    feedback,
    relatedSnapshot: snapshotByAttempt.get(feedback.attemptId) ?? null,
  }));

  const allItems = [...warningItems, ...feedbackItems].sort(sortTimelineItems);
  const filteredItems = allItems.filter((item) => {
    if (typeFilter === "ALL") return true;
    return item.type === typeFilter;
  });
  const cursorFilteredItems = decodedCursor
    ? filteredItems.filter((item) => isAfterCursor(item, decodedCursor))
    : filteredItems;
  const pageItems = cursorFilteredItems.slice(0, limit);
  const hasNext = cursorFilteredItems.length > limit;

  return {
    items: pageItems,
    nextCursor: hasNext && pageItems.length > 0
      ? encodeCursor(pageItems[pageItems.length - 1])
      : null,
    totalCount: filteredItems.length,
    warningCount: warningItems.length,
    feedbackCount: feedbackItems.length,
  };
}
