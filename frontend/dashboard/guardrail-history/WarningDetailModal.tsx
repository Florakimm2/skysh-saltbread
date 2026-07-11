"use client";

import { useEffect, useRef } from "react";
import { RULE_FIELD_CATALOG } from "@/backend/modules/guardrail/catalog";
import type {
  GuardrailTimelineItem,
  OrderContextSnapshotDTO,
} from "@/backend/modules/logs/types";
import { buildExpressionPreview } from "@/frontend/dashboard/rule-expression-format";
import {
  formatCurrency,
  formatDateTime,
  formatDuration,
  formatPercent,
  formatQuantity,
  formatRatio,
  ENTRY_POINT_LABELS,
  ORDER_MODE_LABELS,
  SIDE_LABELS,
} from "./formatters";
import WarningFlame from "./WarningFlame";
import { getWarningToneClassName } from "./warning-colors";
import styles from "../dashboard.module.css";

type WarningItem = Extract<GuardrailTimelineItem, { type: "WARNING" }>;

const RISK_LABELS = {
  LOW: "낮음",
  MEDIUM: "보통",
  HIGH: "높음",
} as const;

const REACTION_LABELS = {
  PROCEED: "계속 주문하기를 선택했어요",
  REVIEW: "주문 내용을 다시 확인했어요",
  CLOSE: "경고를 닫았어요",
} as const;

const SNAPSHOT_SECTIONS: Array<{
  title: string;
  fields: Array<keyof OrderContextSnapshotDTO>;
}> = [
  {
    title: "주문 데이터",
    fields: [
      "market",
      "side",
      "orderMode",
      "entryPoint",
      "orderTimeMinutes",
      "intentPrice",
      "intentQuantity",
      "intentAmount",
      "requestedBalanceRatio",
    ],
  },
  {
    title: "행동 데이터",
    fields: [
      "draftDurationMs",
      "lastEditToSnapshotMs",
      "draftEditCount",
      "amountChangeRate",
      "modeChangedToMarket",
      "orderbookClickToSnapshotMs",
      "orderIntentCount1m",
      "actualOrderCreatedCount10m",
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
    ],
  },
  {
    title: "시장 데이터",
    fields: [
      "tradePriceAtSnapshot",
      "shortTermReturn5m",
      "signedChangeRate",
      "spreadRate",
      "marketRiskFlags",
      "pricePositionIn5mRange",
      "volumeSpikeRatio5m",
    ],
  },
  {
    title: "개인 계정 데이터",
    fields: [
      "baseAssetAvgBuyPriceBeforeSnapshot",
      "priceVsAvgBuyRateAtSnapshot",
    ],
  },
];

function focusableElements(container: HTMLElement) {
  return Array.from(
    container.querySelectorAll<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
    ),
  ).filter((element) => !element.hasAttribute("disabled"));
}

function formatSnapshotValue(
  snapshot: OrderContextSnapshotDTO,
  field: keyof OrderContextSnapshotDTO,
) {
  const value = snapshot[field];
  const definition = RULE_FIELD_CATALOG[field as keyof typeof RULE_FIELD_CATALOG];

  if (value === null || value === undefined || value === "") {
    return definition?.requiresPrivateApi ? "개인 API 연결 필요" : "수집되지 않음";
  }

  if (field === "side") return SIDE_LABELS[snapshot.side];
  if (field === "orderMode") return ORDER_MODE_LABELS[snapshot.orderMode];
  if (field === "entryPoint") return ENTRY_POINT_LABELS[snapshot.entryPoint];
  if (field === "orderTimeMinutes") {
    if (typeof value === "number") {
      const hour = Math.floor(value / 60);
      const minute = value % 60;
      return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
    }
    return snapshot.orderTime || "기록 없음";
  }
  if (field === "intentPrice" || field === "tradePriceAtSnapshot") {
    return typeof value === "string" ? formatCurrency(value) : String(value);
  }
  if (field === "intentAmount" || field === "baseAssetAvgBuyPriceBeforeSnapshot") {
    return typeof value === "string" ? formatCurrency(value) : String(value);
  }
  if (field === "intentQuantity") {
    return typeof value === "string" ? formatQuantity(value) : String(value);
  }
  if (field === "allocationPresetPercent") {
    return value === "CUSTOM" ? "직접 입력" : `${String(value)}%`;
  }
  if (
    field === "requestedBalanceRatio" ||
    field === "pricePositionIn5mRange"
  ) {
    return typeof value === "number" ? formatRatio(value) : String(value);
  }
  if (
    field === "amountChangeRate" ||
    field === "priceChangeRate" ||
    field === "shortTermReturn5m" ||
    field === "signedChangeRate" ||
    field === "spreadRate" ||
    field === "priceVsAvgBuyRateAtSnapshot"
  ) {
    return typeof value === "number" ? formatPercent(value) : String(value);
  }
  if (field === "volumeSpikeRatio5m") {
    return typeof value === "number" ? `${Number(value.toFixed(2))}배` : String(value);
  }
  if (String(field).endsWith("Ms")) {
    return typeof value === "number" ? formatDuration(value) : String(value);
  }
  if (Array.isArray(value)) {
    return value.length > 0 ? value.join(", ") : "없음";
  }
  if (typeof value === "boolean") return value ? "예" : "아니요";

  return String(value);
}

function getFieldLabel(field: keyof OrderContextSnapshotDTO) {
  const definition = RULE_FIELD_CATALOG[field as keyof typeof RULE_FIELD_CATALOG];
  return definition?.label ?? field;
}

export default function WarningDetailModal({
  item,
  onClose,
}: {
  item: WarningItem;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const rule = item.rule;
  const toneClassName = getWarningToneClassName(rule?.visualMode, styles);
  const hasStoredRule = Boolean(rule && rule.historySource !== "MISSING_RULE");
  const expressionPreview =
    hasStoredRule && rule ? buildExpressionPreview(rule.expression) : null;

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    const elements = focusableElements(dialog);
    elements[0]?.focus();

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }

      if (event.key !== "Tab" || !dialog) return;
      const currentElements = focusableElements(dialog);
      if (currentElements.length === 0) return;
      const first = currentElements[0];
      const last = currentElements[currentElements.length - 1];

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  return (
    <div className={styles.modalBackdrop} role="presentation" onMouseDown={onClose}>
      <div
        ref={dialogRef}
        className={`${styles.warningModal} ${toneClassName}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="warning-detail-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className={styles.warningModalHeader}>
          <div className={styles.warningModalFlame}>
            <WarningFlame
              visualMode={rule?.visualMode}
              label={`${rule?.name ?? "가드레일"} 상세 불씨`}
            />
          </div>
          <div>
            <span className={styles.warningModalEyebrow}>경고 상세</span>
            <h2 id="warning-detail-title">
              {rule?.name ?? "경고 이름을 찾을 수 없어요"}
            </h2>
            <p>
              {rule?.description ||
                rule?.warningMessage ||
                "경고 설명을 찾을 수 없어요."}
            </p>
          </div>
          <button
            className={styles.modalCloseButton}
            type="button"
            aria-label="경고 상세 닫기"
            onClick={onClose}
          >
            ×
          </button>
        </header>

        <dl className={styles.warningModalMeta}>
          <div>
            <dt>위험도</dt>
            <dd>{rule ? RISK_LABELS[rule.riskLevel] : "알 수 없음"}</dd>
          </div>
          <div>
            <dt>발생 시각</dt>
            <dd>{formatDateTime(item.occurredAt)}</dd>
          </div>
          <div>
            <dt>시장</dt>
            <dd>{item.snapshot.market}</dd>
          </div>
          <div>
            <dt>방향</dt>
            <dd>{SIDE_LABELS[item.snapshot.side]}</dd>
          </div>
          <div>
            <dt>주문 방식</dt>
            <dd>{ORDER_MODE_LABELS[item.snapshot.orderMode]}</dd>
          </div>
        </dl>

        <section className={styles.warningModalSection}>
          <h3>경고 발생 당시 규칙</h3>
          {hasStoredRule && rule ? (
            <div className={styles.warningRuleSnapshot}>
              <dl>
                <div>
                  <dt>규칙 이름</dt>
                  <dd>{rule.name}</dd>
                </div>
                <div>
                  <dt>위험도</dt>
                  <dd>{RISK_LABELS[rule.riskLevel]}</dd>
                </div>
                <div>
                  <dt>규칙 설명</dt>
                  <dd>{rule.description || "설명 없음"}</dd>
                </div>
                <div>
                  <dt>경고 제목</dt>
                  <dd>{rule.warningTitle || "제목 없음"}</dd>
                </div>
                <div>
                  <dt>경고 메시지</dt>
                  <dd>{rule.warningMessage || "메시지 없음"}</dd>
                </div>
              </dl>
              <div className={styles.warningRuleExpression}>
                <strong>규칙 조건 요약</strong>
                <p>{expressionPreview}</p>
              </div>
              <details className={styles.warningRuleRawExpression}>
                <summary>원본 expression 보기</summary>
                <pre>{JSON.stringify(rule.expression, null, 2)}</pre>
              </details>
            </div>
          ) : (
            <p className={styles.warningModalNotice}>
              저장된 규칙 정보가 없습니다.
            </p>
          )}
        </section>

        <section className={styles.warningModalSection}>
          <h3>경고 당시 데이터</h3>
          <div className={styles.snapshotSectionGrid}>
            {SNAPSHOT_SECTIONS.map((section) => (
              <article className={styles.snapshotSection} key={section.title}>
                <h4>{section.title}</h4>
                <dl>
                  {section.fields.map((field) => (
                    <div key={field}>
                      <dt>{getFieldLabel(field)}</dt>
                      <dd>{formatSnapshotValue(item.snapshot, field)}</dd>
                    </div>
                  ))}
                </dl>
              </article>
            ))}
          </div>
        </section>

        <section className={styles.warningModalSection}>
          <h3>사용자의 경고 반응</h3>
          <p className={styles.warningModalNotice}>
            {item.reaction
              ? REACTION_LABELS[item.reaction.action]
              : "경고에 대한 명시적인 반응이 기록되지 않았어요."}
          </p>
        </section>
      </div>
    </div>
  );
}
