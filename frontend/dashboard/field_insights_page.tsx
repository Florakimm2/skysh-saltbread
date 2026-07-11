// ============================================================
// 배치 경로: frontend/dashboard/field-insights-page.tsx
// ============================================================

"use client";

import { useState, useCallback } from "react";
import styles from "./dashboard.module.css";
import { SparklesIcon } from "./icons";

// ─── 타입 정의 ───

interface MetricItem {
  label: string;
  value: string;
  description: string;
}

interface TopicData {
  topicKey: string;
  topicLabel: string;
  metrics: MetricItem[];
}

interface AiTopicAnalysis {
  topic_key: string;
  topic_label: string;
  headline: string;
  analysis: string;
  severity: "good" | "caution" | "warning";
}

interface FieldInsightResult {
  status: "ready" | "empty" | "error";
  topics: TopicData[];
  aiAnalysis: {
    topics: AiTopicAnalysis[];
    one_line_advice: string;
  } | null;
  snapshotCount: number;
}

// ─── severity → 카드 타이틀 색상 ───

const SEVERITY_TITLE_COLOR = {
  good: "#1971c2",
  caution: "#e67700",
  warning: "#e03131",
} as const;

// ─── 서브 컴포넌트 ───

function MetricRow({ metric }: { metric: MetricItem }) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "flex-start",
        padding: "10px 0",
        borderBottom: "1px solid var(--border-color, #f0f0f0)",
        gap: "12px",
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontSize: "13px",
            fontWeight: 500,
            color: "var(--text-primary, #333)",
            marginBottom: "2px",
          }}
        >
          {metric.label}
        </div>
        <div
          style={{
            fontSize: "11px",
            color: "var(--text-secondary, #888)",
            lineHeight: "1.4",
          }}
        >
          {metric.description}
        </div>
      </div>
      <div
        style={{
          fontSize: "14px",
          fontWeight: 600,
          color: "var(--text-primary, #333)",
          textAlign: "right",
          flexShrink: 0,
          minWidth: "80px",
        }}
      >
        {metric.value}
      </div>
    </div>
  );
}

function TopicCard({
  topic,
  aiAnalysis,
  isOpen,
  onToggle,
}: {
  topic: TopicData;
  aiAnalysis: AiTopicAnalysis | undefined;
  isOpen: boolean;
  onToggle: () => void;
}) {
  const severity = aiAnalysis?.severity ?? "good";
  const titleColor = SEVERITY_TITLE_COLOR[severity];

  const labelParts = topic.topicLabel.split(" ");
  const emoji = labelParts[0] || "📋";
  const labelText = labelParts.slice(1).join(" ") || topic.topicLabel;

  const cardTitle = aiAnalysis
    ? `[${emoji} ${labelText}] ${aiAnalysis.headline}`
    : `[${emoji} ${labelText}]`;

  return (
    <div
      style={{
        padding: "16px",
        borderRadius: "12px",
        backgroundColor: "var(--surface-color, #f8f9fa)",
        border: "1px solid var(--border-color, #e9ecef)",
        cursor: "pointer",
        transition: "box-shadow 0.2s ease",
      }}
      onClick={onToggle}
      role="button"
      tabIndex={0}
      aria-expanded={isOpen}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onToggle();
        }
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          gap: "12px",
        }}
      >
        <h3
          style={{
            margin: "0 0 8px 0",
            fontSize: "16px",
            fontWeight: "600",
            color: titleColor,
            flex: 1,
          }}
        >
          {cardTitle}
        </h3>
        <span
          style={{
            fontSize: "14px",
            color: "var(--text-secondary, #888)",
            transition: "transform 0.2s ease",
            transform: isOpen ? "rotate(180deg)" : "rotate(0deg)",
            display: "inline-block",
            flexShrink: 0,
            marginTop: "2px",
          }}
        >
          ▼
        </span>
      </div>

      {aiAnalysis && (
        <p
          style={{
            margin: 0,
            fontSize: "14px",
            color: "var(--text-color, #495057)",
            lineHeight: "1.5",
          }}
        >
          {aiAnalysis.analysis}
        </p>
      )}

      {isOpen && topic.metrics.length > 0 && (
        <div
          style={{
            marginTop: "16px",
            paddingTop: "12px",
            borderTop: "1px solid var(--border-color, #e9ecef)",
          }}
        >
          {topic.metrics.map((metric, idx) => (
            <MetricRow key={`${topic.topicKey}-${idx}`} metric={metric} />
          ))}
        </div>
      )}
    </div>
  );
}

function EmptyState({ status }: { status: "empty" | "error" }) {
  return (
    <div className={styles.aiDetailEmpty}>
      <div className={styles.emptyStateInner}>
        <span className={styles.emptyGlyph}>
          <SparklesIcon />
        </span>
        <strong>
          {status === "empty"
            ? "분석할 스냅샷 데이터가 없습니다"
            : "AI 분석을 불러오지 못했습니다"}
        </strong>
        <p>
          {status === "empty"
            ? "업비트에서 주문 활동이 기록되면 필드별 상세 분석이 생성됩니다."
            : "잠시 후 페이지를 새로고침해 다시 확인해 주세요."}
        </p>
      </div>
    </div>
  );
}

// ─── 메인 페이지 컴포넌트 ───

export default function FieldInsightsPage({
  insight,
}: {
  insight: FieldInsightResult;
}) {
  const [openTopics, setOpenTopics] = useState<Set<string>>(new Set());

  const toggleTopic = useCallback((topicKey: string) => {
    setOpenTopics((prev) => {
      const next = new Set(prev);
      if (next.has(topicKey)) {
        next.delete(topicKey);
      } else {
        next.add(topicKey);
      }
      return next;
    });
  }, []);

  const aiTopicMap = new Map<string, AiTopicAnalysis>();
  if (insight.aiAnalysis?.topics) {
    for (const t of insight.aiAnalysis.topics) {
      aiTopicMap.set(t.topic_key, t);
    }
  }

  if (insight.status !== "ready") {
    return (
      <section
        className={`${styles.panel} ${styles.aiDetailPanel}`}
        aria-labelledby="field-detail-title"
      >
        <header className={styles.panelHeader}>
          <div className={styles.panelTitleGroup}>
            <span className={styles.panelIcon}>
              <SparklesIcon />
            </span>
            <h2 className={styles.panelTitle} id="field-detail-title">
              필드별 상세 분석
            </h2>
          </div>
        </header>
        <EmptyState status={insight.status} />
      </section>
    );
  }

  return (
    <section
      className={`${styles.panel} ${styles.aiDetailPanel}`}
      aria-labelledby="field-detail-title"
    >
      <header className={styles.panelHeader}>
        <div className={styles.panelTitleGroup}>
          <span className={styles.panelIcon}>
            <SparklesIcon />
          </span>
          <h2 className={styles.panelTitle} id="field-detail-title">
            필드별 상세 분석
          </h2>
        </div>
        <span className={styles.panelMeta}>
          {insight.snapshotCount}건의 주문 스냅샷 기반
        </span>
      </header>

      <div
        style={{
          padding: "24px 32px 32px",
          display: "flex",
          flexDirection: "column",
          gap: "12px",
        }}
      >
        {insight.topics.map((topic) => (
          <TopicCard
            key={topic.topicKey}
            topic={topic}
            aiAnalysis={aiTopicMap.get(topic.topicKey)}
            isOpen={openTopics.has(topic.topicKey)}
            onToggle={() => toggleTopic(topic.topicKey)}
          />
        ))}

        {insight.aiAnalysis?.one_line_advice && (
          <div
            style={{
              marginTop: "8px",
              padding: "16px",
              borderRadius: "12px",
              backgroundColor: "var(--surface-color, #f8f9fa)",
              border: "1px solid var(--border-color, #e9ecef)",
            }}
          >
            <h3
              style={{
                margin: "0 0 8px 0",
                fontSize: "16px",
                fontWeight: "600",
                color: "#1971c2",
              }}
            >
              [💡 AI 개선 제안]
            </h3>
            <p
              style={{
                margin: 0,
                fontSize: "14px",
                color: "var(--text-color, #495057)",
                lineHeight: "1.5",
              }}
            >
              {insight.aiAnalysis.one_line_advice}
            </p>
          </div>
        )}
      </div>
    </section>
  );
}
