"use client";

import { useMemo, useState } from "react";
import type {
  RuleCondition,
  RuleConditionGroup,
  RuleExpression,
  RuleOperand,
  RuleOperator,
  RuleValueType,
  UserGuardrailRuleDTO,
} from "@/backend/modules/guardrail/types";
import PageHeader from "./page-header";
import { GuardrailIcon, UserIcon } from "./icons";
import styles from "./dashboard.module.css";

type Profile = {
  userId: string;
  email: string | null;
  displayName: string | null;
};

type DraftRule = Omit<
  UserGuardrailRuleDTO,
  "ruleId" | "userId" | "requiresPrivateApi" | "schemaVersion" | "createdAt" | "updatedAt"
> & {
  ruleId?: string;
};

type FieldDefinition = {
  label: string;
  description: string;
  valueType: RuleValueType;
  requiresPrivateApi: boolean;
};

const SUPPORTED_FIELDS: Record<string, FieldDefinition> = {
  side: {
    label: "주문 방향",
    description: "BUY, SELL",
    valueType: "STRING",
    requiresPrivateApi: false,
  },
  orderMode: {
    label: "주문 방식",
    description: "LIMIT, MARKET, BEST, RESERVED, UNKNOWN",
    valueType: "STRING",
    requiresPrivateApi: false,
  },
  snapshotTrigger: {
    label: "스냅샷 트리거",
    description: "GUARDRAIL_SHOWN, ORDER_INTENT_CLICK",
    valueType: "STRING",
    requiresPrivateApi: false,
  },
  signedChangeRate: {
    label: "전일 대비 등락률",
    description: "예: 0.10 = 10%",
    valueType: "NUMBER",
    requiresPrivateApi: false,
  },
  shortTermReturn5m: {
    label: "5분 수익률",
    description: "최근 5분 가격 변화율",
    valueType: "NUMBER",
    requiresPrivateApi: false,
  },
  pricePositionIn5mRange: {
    label: "5분 가격 위치",
    description: "0~1 범위",
    valueType: "NUMBER",
    requiresPrivateApi: false,
  },
  requestedBalanceRatio: {
    label: "가용 잔고 대비 주문 비율",
    description: "0~1 범위",
    valueType: "NUMBER",
    requiresPrivateApi: false,
  },
  orderbookClickToSnapshotMs: {
    label: "호가 클릭 후 경과",
    description: "밀리초",
    valueType: "NUMBER",
    requiresPrivateApi: false,
  },
  tradePriceAtSnapshot: {
    label: "현재가",
    description: "decimal string",
    valueType: "DECIMAL_STRING",
    requiresPrivateApi: false,
  },
  baseAssetAvgBuyPriceBeforeSnapshot: {
    label: "평균 매수가",
    description: "개인 API 필요",
    valueType: "DECIMAL_STRING",
    requiresPrivateApi: true,
  },
  priceVsAvgBuyRateAtSnapshot: {
    label: "평균가 대비 가격 차이",
    description: "예: -0.1 = -10%",
    valueType: "NUMBER",
    requiresPrivateApi: true,
  },
  actualOrderCreatedCount10m: {
    label: "10분 실제 주문 수",
    description: "개인 API 필요",
    valueType: "NUMBER",
    requiresPrivateApi: true,
  },
};

const UNSUPPORTED_FIELDS = [
  "draftDurationMs",
  "lastEditToSnapshotMs",
  "draftEditCount",
  "amountChangeRate",
  "modeChangedToMarket",
  "orderIntentCount1m",
  "sameSideIntentCount1m",
  "marketChangeCount5m",
  "sideChangeCount3m",
  "priceEditCount3m",
  "quantityEditCount3m",
  "amountEditCount3m",
  "inputRevertCount",
  "priceDirectionChangeCount",
  "priceChangeRate",
  "orderModeChangeCount3m",
  "allocationPresetPercent",
  "draftResetCount3m",
  "spreadRate",
  "marketRiskFlags",
  "volumeSpikeRatio5m",
];

const VALUE_OPERATORS: Record<RuleValueType, RuleOperator[]> = {
  STRING: ["EQ", "NEQ", "IN", "NOT_IN", "IS_NULL", "IS_NOT_NULL"],
  NUMBER: ["EQ", "NEQ", "GT", "GTE", "LT", "LTE", "IS_NULL", "IS_NOT_NULL"],
  DECIMAL_STRING: [
    "EQ",
    "NEQ",
    "GT",
    "GTE",
    "LT",
    "LTE",
    "IS_NULL",
    "IS_NOT_NULL",
  ],
  BOOLEAN: ["EQ", "NEQ", "IS_NULL", "IS_NOT_NULL"],
};

const NULL_OPERATORS = new Set<RuleOperator>(["IS_NULL", "IS_NOT_NULL"]);

function createCondition(): RuleCondition {
  return {
    nodeType: "CONDITION",
    leftField: "side",
    operator: "EQ",
    rightOperand: {
      operandType: "LITERAL",
      value: "BUY",
    },
  };
}

function createGroup(): RuleConditionGroup {
  return {
    nodeType: "GROUP",
    operator: "AND",
    children: [createCondition()],
  };
}

function createDraftRule(priority: number): DraftRule {
  return {
    name: "새 가드레일 규칙",
    description: "",
    isEnabled: true,
    priority,
    riskLevel: "MEDIUM",
    visualMode: "CURIOUS",
    expression: createGroup(),
    warningTitle: "주문 전 확인",
    warningMessage: "내가 만든 규칙에 해당하는 주문 조건입니다.",
  };
}

function toDraft(rule: UserGuardrailRuleDTO): DraftRule {
  return {
    ruleId: rule.ruleId,
    name: rule.name,
    description: rule.description ?? "",
    isEnabled: rule.isEnabled,
    priority: rule.priority,
    riskLevel: rule.riskLevel,
    visualMode: rule.visualMode,
    expression: rule.expression,
    warningTitle: rule.warningTitle,
    warningMessage: rule.warningMessage,
  };
}

function serializeRule(draft: DraftRule) {
  return {
    name: draft.name,
    description: draft.description || null,
    isEnabled: draft.isEnabled,
    priority: draft.priority,
    riskLevel: draft.riskLevel,
    visualMode: draft.visualMode,
    expression: draft.expression,
    warningTitle: draft.warningTitle,
    warningMessage: draft.warningMessage,
  };
}

function cloneExpression<T extends RuleExpression>(expression: T): T {
  return JSON.parse(JSON.stringify(expression)) as T;
}

function updateAtPath(
  expression: RuleExpression,
  path: number[],
  updater: (node: RuleExpression) => RuleExpression,
): RuleExpression {
  if (path.length === 0) return updater(expression);

  if (expression.nodeType !== "GROUP") return expression;

  const [index, ...rest] = path;
  return {
    ...expression,
    children: expression.children.map((child, childIndex) =>
      childIndex === index ? updateAtPath(child, rest, updater) : child,
    ),
  };
}

function removeAtPath(
  expression: RuleExpression,
  path: number[],
): RuleExpression {
  if (path.length === 0 || expression.nodeType !== "GROUP") return expression;
  const [index, ...rest] = path;

  if (rest.length === 0) {
    return {
      ...expression,
      children:
        expression.children.length > 1
          ? expression.children.filter((_, childIndex) => childIndex !== index)
          : expression.children,
    };
  }

  return {
    ...expression,
    children: expression.children.map((child, childIndex) =>
      childIndex === index ? removeAtPath(child, rest) : child,
    ),
  };
}

function insertChild(
  expression: RuleExpression,
  path: number[],
  child: RuleExpression,
): RuleExpression {
  return updateAtPath(expression, path, (node) =>
    node.nodeType === "GROUP"
      ? { ...node, children: [...node.children, child] }
      : node,
  );
}

function getExpressionAtPath(
  expression: RuleExpression,
  path: number[],
): RuleExpression | null {
  return path.reduce<RuleExpression | null>((node, index) => {
    if (!node || node.nodeType !== "GROUP") return null;
    return node.children[index] ?? null;
  }, expression);
}

function parseLiteralValue(valueType: RuleValueType, value: unknown): unknown {
  if (valueType === "NUMBER") {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : 0;
  }

  if (valueType === "BOOLEAN") {
    return value === true || value === "true";
  }

  return String(value ?? "");
}

function buildRightOperand(
  valueType: RuleValueType,
  operator: RuleOperator,
): RuleOperand {
  const defaultValue =
    operator === "IN" || operator === "NOT_IN"
      ? ["BUY"]
      : valueType === "NUMBER"
        ? 0
        : valueType === "DECIMAL_STRING"
          ? "0"
          : valueType === "BOOLEAN"
            ? true
            : "BUY";

  return {
    operandType: "LITERAL",
    value: defaultValue,
  };
}

async function apiRequest<T>(path: string, options: RequestInit = {}) {
  const response = await fetch(path, {
    ...options,
    credentials: "same-origin",
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });
  const data = await response.json().catch(() => null);

  if (!response.ok || data?.ok === false) {
    throw new Error(data?.message || "요청을 처리하지 못했습니다.");
  }

  return data?.data as T;
}

function ConditionEditor({
  condition,
  path,
  onChange,
  onDelete,
  onDuplicate,
  onOpenFieldPicker,
}: {
  condition: RuleCondition;
  path: number[];
  onChange: (path: number[], next: RuleExpression) => void;
  onDelete: (path: number[]) => void;
  onDuplicate: (path: number[]) => void;
  onOpenFieldPicker: (path: number[], target: "left" | "right") => void;
}) {
  const field = SUPPORTED_FIELDS[condition.leftField] || SUPPORTED_FIELDS.side;
  const operators = VALUE_OPERATORS[field.valueType];
  const hasRightOperand = !NULL_OPERATORS.has(condition.operator);
  const rightOperand = "rightOperand" in condition ? condition.rightOperand : null;

  function patch(next: Partial<RuleCondition>) {
    onChange(path, { ...condition, ...next } as RuleExpression);
  }

  function changeOperator(operator: RuleOperator) {
    if (NULL_OPERATORS.has(operator)) {
      onChange(path, {
        nodeType: "CONDITION",
        leftField: condition.leftField,
        operator: operator as "IS_NULL" | "IS_NOT_NULL",
      });
      return;
    }

    onChange(path, {
      nodeType: "CONDITION",
      leftField: condition.leftField,
      operator: operator as Exclude<RuleOperator, "IS_NULL" | "IS_NOT_NULL">,
      rightOperand:
        rightOperand || buildRightOperand(field.valueType, operator),
    });
  }

  function changeLeftField(leftField: string) {
    const nextField = SUPPORTED_FIELDS[leftField];
    const nextOperator = VALUE_OPERATORS[nextField.valueType][0];
    onChange(path, {
      nodeType: "CONDITION",
      leftField,
      operator: nextOperator as Exclude<RuleOperator, "IS_NULL" | "IS_NOT_NULL">,
      rightOperand: buildRightOperand(nextField.valueType, nextOperator),
    });
  }

  function renderOperand() {
    if (!hasRightOperand || !rightOperand) return null;

    if (rightOperand.operandType === "FIELD") {
      return (
        <label className={styles.ruleMiniField}>
          <span>비교 필드</span>
          <div className={styles.ruleInlineControls}>
            <select
              value={rightOperand.field}
              onChange={(event) =>
                patch({
                  rightOperand: {
                    operandType: "FIELD",
                    field: event.target.value,
                  },
                } as Partial<RuleCondition>)
              }
            >
              {Object.entries(SUPPORTED_FIELDS)
                .filter(([, definition]) => definition.valueType === field.valueType)
                .map(([key, definition]) => (
                  <option key={key} value={key}>
                    {definition.label}
                  </option>
                ))}
            </select>
            <button
              type="button"
              onClick={() => onOpenFieldPicker(path, "right")}
            >
              목록
            </button>
          </div>
        </label>
      );
    }

    const literalValue = rightOperand.value;
    const isArrayOperator =
      condition.operator === "IN" || condition.operator === "NOT_IN";

    return (
      <label className={styles.ruleMiniField}>
        <span>비교값</span>
        {field.valueType === "BOOLEAN" ? (
          <select
            value={String(literalValue)}
            onChange={(event) =>
              patch({
                rightOperand: {
                  operandType: "LITERAL",
                  value: event.target.value === "true",
                },
              } as Partial<RuleCondition>)
            }
          >
            <option value="true">true</option>
            <option value="false">false</option>
          </select>
        ) : (
          <input
            value={
              Array.isArray(literalValue)
                ? literalValue.join(", ")
                : String(literalValue ?? "")
            }
            onChange={(event) => {
              const value = isArrayOperator
                ? event.target.value
                    .split(",")
                    .map((item) => item.trim())
                    .filter(Boolean)
                : parseLiteralValue(field.valueType, event.target.value);

              patch({
                rightOperand: {
                  operandType: "LITERAL",
                  value,
                },
              } as Partial<RuleCondition>);
            }}
          />
        )}
      </label>
    );
  }

  return (
    <div className={styles.ruleCondition}>
      <label className={styles.ruleMiniField}>
        <span>데이터</span>
        <div className={styles.ruleInlineControls}>
          <select
            value={condition.leftField}
            onChange={(event) => changeLeftField(event.target.value)}
          >
            {Object.entries(SUPPORTED_FIELDS).map(([key, definition]) => (
              <option key={key} value={key}>
                {definition.label}
              </option>
            ))}
          </select>
          <button type="button" onClick={() => onOpenFieldPicker(path, "left")}>
            목록
          </button>
        </div>
      </label>
      <label className={styles.ruleMiniField}>
        <span>조건</span>
        <select
          value={condition.operator}
          onChange={(event) => changeOperator(event.target.value as RuleOperator)}
        >
          {operators.map((operator) => (
            <option key={operator} value={operator}>
              {operator}
            </option>
          ))}
        </select>
      </label>
      {hasRightOperand && rightOperand ? (
        <label className={styles.ruleMiniField}>
          <span>값 유형</span>
          <select
            value={rightOperand.operandType}
            onChange={(event) => {
              const operandType = event.target.value as RuleOperand["operandType"];
              patch({
                rightOperand:
                  operandType === "FIELD"
                    ? {
                        operandType: "FIELD",
                        field: Object.entries(SUPPORTED_FIELDS).find(
                          ([, definition]) => definition.valueType === field.valueType,
                        )?.[0] || condition.leftField,
                      }
                    : buildRightOperand(field.valueType, condition.operator),
              } as Partial<RuleCondition>);
            }}
          >
            <option value="LITERAL">직접 입력</option>
            <option value="FIELD">다른 데이터</option>
          </select>
        </label>
      ) : null}
      {renderOperand()}
      <div className={styles.ruleNodeActions}>
        <button type="button" onClick={() => onDuplicate(path)}>
          복제
        </button>
        <button type="button" onClick={() => onDelete(path)}>
          삭제
        </button>
      </div>
    </div>
  );
}

function ExpressionEditor({
  expression,
  path,
  onChange,
  onDelete,
  onDuplicate,
  onOpenFieldPicker,
}: {
  expression: RuleExpression;
  path: number[];
  onChange: (path: number[], next: RuleExpression) => void;
  onDelete: (path: number[]) => void;
  onDuplicate: (path: number[]) => void;
  onOpenFieldPicker: (path: number[], target: "left" | "right") => void;
}) {
  if (expression.nodeType === "CONDITION") {
    return (
      <ConditionEditor
        condition={expression}
        path={path}
        onChange={onChange}
        onDelete={onDelete}
        onDuplicate={onDuplicate}
        onOpenFieldPicker={onOpenFieldPicker}
      />
    );
  }

  return (
    <div className={styles.ruleGroup}>
      <div className={styles.ruleGroupHeader}>
        <div className={styles.segmentedControl}>
          {(["AND", "OR"] as const).map((operator) => (
            <button
              key={operator}
              type="button"
              className={expression.operator === operator ? styles.isSelected : ""}
              onClick={() =>
                onChange(path, {
                  ...expression,
                  operator,
                })
              }
            >
              {operator}
            </button>
          ))}
        </div>
        <div className={styles.ruleNodeActions}>
          <button type="button" onClick={() => onChange(path, {
            ...expression,
            children: [...expression.children, createCondition()],
          })}>
            조건 추가
          </button>
          <button type="button" onClick={() => onChange(path, {
            ...expression,
            children: [...expression.children, createGroup()],
          })}>
            그룹 추가
          </button>
          {path.length > 0 ? (
            <button type="button" onClick={() => onDelete(path)}>
              그룹 삭제
            </button>
          ) : null}
        </div>
      </div>
      <div className={styles.ruleGroupChildren}>
        {expression.children.map((child, index) => (
          <ExpressionEditor
            key={`${path.join(".")}-${index}`}
            expression={child}
            path={[...path, index]}
            onChange={onChange}
            onDelete={onDelete}
            onDuplicate={onDuplicate}
            onOpenFieldPicker={onOpenFieldPicker}
          />
        ))}
      </div>
    </div>
  );
}

export default function MyPage({
  initialProfile,
  initialRules,
}: {
  initialProfile: Profile;
  initialRules: UserGuardrailRuleDTO[];
}) {
  const [profile, setProfile] = useState(initialProfile);
  const [rules, setRules] = useState(initialRules);
  const [selectedRuleId, setSelectedRuleId] = useState<string | null>(
    initialRules[0]?.ruleId ?? null,
  );
  const [draft, setDraft] = useState<DraftRule>(
    initialRules[0] ? toDraft(initialRules[0]) : createDraftRule(1),
  );
  const [displayName, setDisplayName] = useState(
    initialProfile.displayName ?? "",
  );
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [message, setMessage] = useState("");
  const [jsonText, setJsonText] = useState("");
  const [fieldPicker, setFieldPicker] = useState<{
    path: number[];
    target: "left" | "right";
  } | null>(null);
  const selectedRule = useMemo(
    () => rules.find((rule) => rule.ruleId === selectedRuleId) ?? null,
    [rules, selectedRuleId],
  );
  const fieldPickerNode = useMemo(
    () =>
      fieldPicker
        ? getExpressionAtPath(draft.expression, fieldPicker.path)
        : null,
    [draft.expression, fieldPicker],
  );
  const rightOperandValueType =
    fieldPicker?.target === "right" && fieldPickerNode?.nodeType === "CONDITION"
      ? SUPPORTED_FIELDS[fieldPickerNode.leftField]?.valueType
      : null;

  function selectRule(rule: UserGuardrailRuleDTO) {
    setSelectedRuleId(rule.ruleId);
    setDraft(toDraft(rule));
    setMessage("");
  }

  function createNewRule() {
    setSelectedRuleId(null);
    setDraft(createDraftRule(rules.length + 1));
    setMessage("");
  }

  function updateDraft(patch: Partial<DraftRule>) {
    setDraft((current) => ({ ...current, ...patch }));
  }

  function updateExpression(path: number[], next: RuleExpression) {
    setDraft((current) => ({
      ...current,
      expression: updateAtPath(current.expression, path, () => next),
    }));
  }

  function duplicateExpression(path: number[]) {
    setDraft((current) => {
      const source = getExpressionAtPath(current.expression, path);

      if (!source || path.length === 0) return current;

      const parentPath = path.slice(0, -1);
      return {
        ...current,
        expression: insertChild(
          current.expression,
          parentPath,
          cloneExpression(source),
        ),
      };
    });
  }

  function chooseField(field: string) {
    if (!fieldPicker) return;
    if (
      fieldPicker.target === "right" &&
      rightOperandValueType &&
      SUPPORTED_FIELDS[field].valueType !== rightOperandValueType
    ) {
      return;
    }

    setDraft((current) => ({
      ...current,
      expression: updateAtPath(current.expression, fieldPicker.path, (node) => {
        if (node.nodeType !== "CONDITION") return node;

        if (fieldPicker.target === "left") {
          const nextField = SUPPORTED_FIELDS[field];
          const nextOperator = VALUE_OPERATORS[nextField.valueType][0];
          return {
            nodeType: "CONDITION",
            leftField: field,
            operator: nextOperator as Exclude<RuleOperator, "IS_NULL" | "IS_NOT_NULL">,
            rightOperand: buildRightOperand(nextField.valueType, nextOperator),
          };
        }

        if (!("rightOperand" in node) || NULL_OPERATORS.has(node.operator)) {
          return node;
        }

        return {
          ...node,
          rightOperand: {
            operandType: "FIELD",
            field,
          },
        };
      }),
    }));
    setFieldPicker(null);
  }

  async function saveProfile() {
    setMessage("");
    const body: Record<string, string> = {};

    if (displayName.trim() !== (profile.displayName ?? "")) {
      body.displayName = displayName.trim();
    }

    if (currentPassword || newPassword) {
      body.currentPassword = currentPassword;
      body.newPassword = newPassword;
    }

    try {
      const nextProfile = await apiRequest<Profile>("/api/me/profile", {
        method: "PATCH",
        body: JSON.stringify(body),
      });
      setProfile(nextProfile);
      setDisplayName(nextProfile.displayName ?? "");
      setCurrentPassword("");
      setNewPassword("");
      setMessage("프로필을 저장했습니다.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "프로필 저장 실패");
    }
  }

  async function saveRule() {
    setMessage("");

    try {
      const body = serializeRule(draft);
      const savedRule = draft.ruleId
        ? await apiRequest<UserGuardrailRuleDTO>(
            `/api/me/guardrail-rules/${draft.ruleId}`,
            {
              method: "PATCH",
              body: JSON.stringify(body),
            },
          )
        : await apiRequest<UserGuardrailRuleDTO>("/api/me/guardrail-rules", {
            method: "POST",
            body: JSON.stringify(body),
          });

      setRules((current) => {
        const exists = current.some((rule) => rule.ruleId === savedRule.ruleId);
        const next = exists
          ? current.map((rule) =>
              rule.ruleId === savedRule.ruleId ? savedRule : rule,
            )
          : [...current, savedRule];
        return [...next].sort((left, right) => left.priority - right.priority);
      });
      setSelectedRuleId(savedRule.ruleId);
      setDraft(toDraft(savedRule));
      setMessage("규칙을 저장했습니다.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "규칙 저장 실패");
    }
  }

  async function deleteRule() {
    if (!draft.ruleId) return;
    if (!window.confirm("이 규칙을 삭제할까요?")) return;

    try {
      await apiRequest<null>(`/api/me/guardrail-rules/${draft.ruleId}`, {
        method: "DELETE",
      });
      const nextRules = rules.filter((rule) => rule.ruleId !== draft.ruleId);
      setRules(nextRules);
      setSelectedRuleId(nextRules[0]?.ruleId ?? null);
      setDraft(nextRules[0] ? toDraft(nextRules[0]) : createDraftRule(1));
      setMessage("규칙을 삭제했습니다.");
    } catch {
      setMessage("규칙 삭제에 실패했습니다.");
    }
  }

  function importJson() {
    try {
      const parsed = JSON.parse(jsonText);
      const expression = parsed.expression ?? parsed;

      if (!expression?.nodeType) {
        throw new Error("expression JSON을 찾지 못했습니다.");
      }

      setDraft((current) => ({
        ...current,
        name: parsed.name ?? current.name,
        description: parsed.description ?? current.description,
        isEnabled: parsed.isEnabled ?? current.isEnabled,
        priority: parsed.priority ?? current.priority,
        riskLevel: parsed.riskLevel ?? current.riskLevel,
        visualMode: parsed.visualMode ?? current.visualMode,
        warningTitle: parsed.warningTitle ?? current.warningTitle,
        warningMessage: parsed.warningMessage ?? current.warningMessage,
        expression,
      }));
      setMessage("JSON을 편집기에 불러왔습니다.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "JSON import 실패");
    }
  }

  return (
    <>
      <PageHeader
        eyebrow="My Page"
        title="마이페이지"
        description="계정 정보와 나만의 가드레일 규칙을 관리하세요."
      />

      <div className={styles.myPageGrid}>
        <section className={`${styles.panel} ${styles.profilePanel}`}>
          <header className={styles.panelHeader}>
            <div className={styles.panelTitleGroup}>
              <span className={styles.panelIcon}>
                <UserIcon />
              </span>
              <h2 className={styles.panelTitle}>내 계정</h2>
            </div>
            <span className={styles.panelMeta}>
              {profile.email ?? "이메일 없음"}
            </span>
          </header>
          <div className={styles.profileForm}>
            <label>
              <span>닉네임</span>
              <input
                value={displayName}
                minLength={2}
                maxLength={20}
                onChange={(event) => setDisplayName(event.target.value)}
              />
            </label>
            <label>
              <span>현재 비밀번호</span>
              <input
                type="password"
                value={currentPassword}
                autoComplete="current-password"
                onChange={(event) => setCurrentPassword(event.target.value)}
              />
            </label>
            <label>
              <span>새 비밀번호</span>
              <input
                type="password"
                value={newPassword}
                autoComplete="new-password"
                onChange={(event) => setNewPassword(event.target.value)}
              />
            </label>
            <button type="button" onClick={saveProfile}>
              프로필 저장
            </button>
          </div>
        </section>

        <section className={`${styles.panel} ${styles.ruleWorkbench}`}>
          <header className={styles.panelHeader}>
            <div className={styles.panelTitleGroup}>
              <span className={styles.panelIcon}>
                <GuardrailIcon />
              </span>
              <h2 className={styles.panelTitle}>개인 규칙</h2>
            </div>
            <button className={styles.panelLinkButton} type="button" onClick={createNewRule}>
              새 규칙
            </button>
          </header>

          <div className={styles.ruleLayout}>
            <aside className={styles.ruleList}>
              {rules.length === 0 ? (
                <p>아직 저장된 규칙이 없습니다.</p>
              ) : (
                rules.map((rule) => (
                  <button
                    key={rule.ruleId}
                    type="button"
                    className={
                      selectedRule?.ruleId === rule.ruleId
                        ? styles.ruleListItemActive
                        : ""
                    }
                    onClick={() => selectRule(rule)}
                  >
                    <strong>{rule.name}</strong>
                    <span>
                      {rule.isEnabled ? "ON" : "OFF"} · {rule.riskLevel} ·{" "}
                      {rule.visualMode}
                    </span>
                  </button>
                ))
              )}
            </aside>

            <div className={styles.ruleEditor}>
              <div className={styles.ruleMetaGrid}>
                <label>
                  <span>규칙 이름</span>
                  <input
                    value={draft.name}
                    onChange={(event) => updateDraft({ name: event.target.value })}
                  />
                </label>
                <label>
                  <span>우선순위</span>
                  <input
                    type="number"
                    min={0}
                    value={draft.priority}
                    onChange={(event) =>
                      updateDraft({ priority: Number(event.target.value) || 0 })
                    }
                  />
                </label>
                <label>
                  <span>위험도</span>
                  <select
                    value={draft.riskLevel}
                    onChange={(event) =>
                      updateDraft({
                        riskLevel: event.target.value as DraftRule["riskLevel"],
                      })
                    }
                  >
                    <option value="LOW">LOW</option>
                    <option value="MEDIUM">MEDIUM</option>
                    <option value="HIGH">HIGH</option>
                  </select>
                </label>
                <label>
                  <span>불꽃 모드</span>
                  <select
                    value={draft.visualMode}
                    onChange={(event) =>
                      updateDraft({
                        visualMode: event.target.value as DraftRule["visualMode"],
                      })
                    }
                  >
                    {["CURIOUS", "SURPRISED", "FAST_BURN", "SCARED", "SAD"].map(
                      (mode) => (
                        <option key={mode} value={mode}>
                          {mode}
                        </option>
                      ),
                    )}
                  </select>
                </label>
                <label>
                  <span>규칙 설명</span>
                  <input
                    value={draft.description ?? ""}
                    onChange={(event) =>
                      updateDraft({ description: event.target.value })
                    }
                  />
                </label>
                <label className={styles.ruleToggle}>
                  <input
                    type="checkbox"
                    checked={draft.isEnabled}
                    onChange={(event) =>
                      updateDraft({ isEnabled: event.target.checked })
                    }
                  />
                  <span>규칙 활성화</span>
                </label>
              </div>

              <div className={styles.warningEditor}>
                <label>
                  <span>경고 제목</span>
                  <input
                    value={draft.warningTitle}
                    onChange={(event) =>
                      updateDraft({ warningTitle: event.target.value })
                    }
                  />
                </label>
                <label>
                  <span>경고 메시지</span>
                  <textarea
                    value={draft.warningMessage}
                    onChange={(event) =>
                      updateDraft({ warningMessage: event.target.value })
                    }
                  />
                </label>
              </div>

              <ExpressionEditor
                expression={draft.expression}
                path={[]}
                onChange={updateExpression}
                onDelete={(path) =>
                  updateDraft({
                    expression: removeAtPath(draft.expression, path),
                  })
                }
                onDuplicate={duplicateExpression}
                onOpenFieldPicker={(path, target) =>
                  setFieldPicker({ path, target })
                }
              />

              <div className={styles.ruleJsonTools}>
                <textarea
                  value={jsonText}
                  placeholder="규칙 JSON 또는 expression JSON을 붙여넣으세요."
                  onChange={(event) => setJsonText(event.target.value)}
                />
                <div>
                  <button type="button" onClick={importJson}>
                    JSON import
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      setJsonText(JSON.stringify(serializeRule(draft), null, 2))
                    }
                  >
                    JSON export
                  </button>
                </div>
              </div>

              <div className={styles.ruleEditorActions}>
                <button type="button" onClick={saveRule}>
                  규칙 저장
                </button>
                {draft.ruleId ? (
                  <button type="button" onClick={deleteRule}>
                    삭제
                  </button>
                ) : null}
              </div>
            </div>
          </div>
        </section>

        {message ? (
          <p className={styles.myPageMessage} role="status">
            {message}
          </p>
        ) : null}
      </div>

      {fieldPicker ? (
        <div className={styles.fieldPickerBackdrop} role="dialog" aria-modal="true">
          <div className={styles.fieldPicker}>
            <header>
              <div>
                <span>DATA CATALOG</span>
                <strong>규칙에 사용할 데이터 선택</strong>
              </div>
              <button type="button" onClick={() => setFieldPicker(null)}>
                닫기
              </button>
            </header>
            <div className={styles.fieldPickerGrid}>
              {Object.entries(SUPPORTED_FIELDS).map(([key, field]) => {
                const isDisabled =
                  rightOperandValueType !== null &&
                  field.valueType !== rightOperandValueType;

                return (
                  <button
                    key={key}
                    type="button"
                    disabled={isDisabled}
                    onClick={() => chooseField(key)}
                  >
                    <strong>{field.label}</strong>
                    <span>{key}</span>
                    <small>
                      {field.valueType}
                      {field.requiresPrivateApi ? " · 개인 API" : ""}
                    </small>
                    <p>{field.description}</p>
                  </button>
                );
              })}
            </div>
            <div className={styles.unsupportedFields}>
              <strong>수집 중이지만 규칙 미지원</strong>
              <div>
                {UNSUPPORTED_FIELDS.map((field) => (
                  <span key={field}>{field}</span>
                ))}
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
