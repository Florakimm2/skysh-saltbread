// frontend/dashboard/field-insights-page.tsx
//
// 스냅샷 필드 집계 데이터를 아코디언(콤보박스) 형태로 보여주는 페이지.
// 각 주제(토픽)를 클릭하면 상세 메트릭과 AI 분석이 펼쳐지고,
// 맨 아래에 AI가 종합한 한 줄 개선 제안이 표시된다.

"use client";

import { useState, useCallback } from "react";
import type { CSSProperties, ReactNode } from "react";

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

// ─── 스타일 상수 ───

const SEVERITY_CONFIG = {
  good: {
    bg: "#E8F5E9",
    border: "#66BB6A",
    text: "#2E7D32",
    icon: "✅",
    label: "양호",
    darkBg: "#1B3A1B",
    darkBorder: "#388E3C",
    darkText: "#81C784",
  },
  caution: {
    bg: "#FFF8E1",
    border: "#FFB74D",
    text: "#E65100",
    icon: "⚠️",
    label: "주의",
    darkBg: "#3A2E0A",
    darkBorder: "#FF9800",
    darkText: "#FFB74D",
  },
  warning: {
    bg: "#FFEBEE",
    border: "#EF5350",
    text: "#C62828",
    icon: "🚨",
    label: "경고",
    darkBg: "#3A1414",
    darkBorder: "#E53935",
    darkText: "#EF9A9A",
  },
} as const;

// ─── 서브 컴포넌트 ───

function SeverityBadge({ severity }: { severity: keyof typeof SEVERITY_CONFIG }) {
  const config = SEVERITY_CONFIG[severity];
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "4px",
        padding: "2px 10px",
        borderRadius: "12px",
        fontSize: "12px",
        fontWeight: 500,
        backgroundColor: config.bg,
        color: config.text,
        border: `1px solid ${config.border}`,
        lineHeight: "20px",
        whiteSpace: "nowrap",
      }}
    >
      {config.icon} {config.label}
    </span>
  );
}

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

function AccordionCard({
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
  const config = SEVERITY_CONFIG[severity];

  return (
    <div
      style={{
        borderRadius: "12px",
        border: `1px solid ${isOpen ? config.border : "var(--border-color, #e0e0e0)"}`,
        overflow: "hidden",
        transition: "border-color 0.2s ease",
        backgroundColor: "var(--surface-color, #fff)",
      }}
    >
      {/* 아코디언 헤더 (클릭 영역) */}
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={isOpen}
        style={{
          width: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "16px 20px",
          border: "none",
          background: isOpen ? config.bg : "transparent",
          cursor: "pointer",
          transition: "background-color 0.2s ease",
          gap: "12px",
          textAlign: "left",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "10px", flex: 1, minWidth: 0 }}>
          <span style={{ fontSize: "18px", flexShrink: 0 }}>
            {topic.topicLabel.split(" ")[0]}
          </span>
          <div style={{ minWidth: 0 }}>
            <div
              style={{
                fontSize: "15px",
                fontWeight: 600,
                color: "var(--text-primary, #333)",
              }}
            >
              {topic.topicLabel.slice(topic.topicLabel.indexOf(" ") + 1)}
            </div>
            {aiAnalysis && (
              <div
                style={{
                  fontSize: "12px",
                  color: config.text,
                  fontWeight: 500,
                  marginTop: "2px",
                }}
              >
                {aiAnalysis.headline}
              </div>
            )}
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "8px", flexShrink: 0 }}>
          {aiAnalysis && <SeverityBadge severity={severity} />}
          <span
            style={{
              fontSize: "18px",
              color: "var(--text-secondary, #888)",
              transition: "transform 0.2s ease",
              transform: isOpen ? "rotate(180deg)" : "rotate(0deg)",
              display: "inline-block",
            }}
          >
            ▼
          </span>
        </div>
      </button>

      {/* 아코디언 내용 (펼쳐진 상태) */}
      {isOpen && (
        <div style={{ padding: "0 20px 16px" }}>
          {/* AI 분석 텍스트 */}
          {aiAnalysis && (
            <div
              style={{
                padding: "12px 16px",
                borderRadius: "8px",
                backgroundColor: config.bg,
                borderLeft: `3px solid ${config.border}`,
                margin: "8px 0 16px",
              }}
            >
              <p
                style={{
                  margin: 0,
                  fontSize: "13px",
                  lineHeight: "1.6",
                  color: config.text,
                }}
              >
                {aiAnalysis.analysis}
              </p>
            </div>
          )}

          {/* 메트릭 목록 */}
          <div>
            {topic.metrics.map((metric, idx) => (
              <MetricRow key={`${topic.topicKey}-${idx}`} metric={metric} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function AdviceBanner({ advice }: { advice: string }) {
  return (
    <div
      style={{
        marginTop: "20px",
        padding: "16px 20px",
        borderRadius: "12px",
        background: "linear-gradient(135deg, #FFF3E0 0%, #FFE0B2 100%)",
        border: "1px solid #FFB74D",
        display: "flex",
        alignItems: "center",
        gap: "12px",
      }}
    >
      <span style={{ fontSize: "24px", flexShrink: 0 }}>💡</span>
      <div>
        <div
          style={{
            fontSize: "11px",
            fontWeight: 600,
            color: "#E65100",
            textTransform: "uppercase",
            letterSpacing: "0.5px",
            marginBottom: "4px",
          }}
        >
          AI 개선 제안
        </div>
        <div
          style={{
            fontSize: "15px",
            fontWeight: 600,
            color: "#BF360C",
            lineHeight: "1.4",
          }}
        >
          {advice}
        </div>
      </div>
    </div>
  );
}

function EmptyState({ status }: { status: "empty" | "error" }) {
  return (
    <div
      style={{
        textAlign: "center",
        padding: "48px 24px",
        color: "var(--text-secondary, #888)",
      }}
    >
      <div style={{ fontSize: "40px", marginBottom: "12px" }}>
        {status === "empty" ? "📭" : "⚠️"}
      </div>
      <strong style={{ display: "block", fontSize: "16px", marginBottom: "8px" }}>
        {status === "empty"
          ? "분석할 스냅샷 데이터가 없습니다"
          : "AI 분석을 불러오지 못했습니다"}
      </strong>
      <p style={{ fontSize: "14px", margin: 0, lineHeight: "1.5" }}>
        {status === "empty"
          ? "업비트에서 주문 활동이 기록되면 필드별 상세 분석이 생성됩니다."
          : "잠시 후 페이지를 새로고침해 다시 확인해 주세요."}
      </p>
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

  const expandAll = useCallback(() => {
    setOpenTopics(new Set(insight.topics.map((t) => t.topicKey)));
  }, [insight.topics]);

  const collapseAll = useCallback(() => {
    setOpenTopics(new Set());
  }, []);

  // AI 분석 결과를 topic_key로 빠르게 조회
  const aiTopicMap = new Map<string, AiTopicAnalysis>();
  if (insight.aiAnalysis?.topics) {
    for (const t of insight.aiAnalysis.topics) {
      aiTopicMap.set(t.topic_key, t);
    }
  }

  if (insight.status !== "ready") {
    return (
      <section
        style={{
          maxWidth: "720px",
          margin: "0 auto",
          padding: "24px 16px",
        }}
      >
        <h2
          style={{
            fontSize: "20px",
            fontWeight: 600,
            marginBottom: "8px",
            color: "var(--text-primary, #333)",
          }}
        >
          📋 필드별 상세 분석
        </h2>
        <EmptyState status={insight.status} />
      </section>
    );
  }

  // severity 집계 (요약 표시용)
  const severityCounts = { good: 0, caution: 0, warning: 0 };
  for (const t of aiTopicMap.values()) {
    severityCounts[t.severity]++;
  }

  return (
    <section
      style={{
        maxWidth: "720px",
        margin: "0 auto",
        padding: "24px 16px",
      }}
    >
      {/* 헤더 */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          marginBottom: "20px",
          flexWrap: "wrap",
          gap: "12px",
        }}
      >
        <div>
          <h2
            style={{
              fontSize: "20px",
              fontWeight: 600,
              margin: "0 0 4px",
              color: "var(--text-primary, #333)",
            }}
          >
            📋 필드별 상세 분석
          </h2>
          <p
            style={{
              fontSize: "13px",
              color: "var(--text-secondary, #888)",
              margin: 0,
            }}
          >
            {insight.snapshotCount}건의 주문 스냅샷 기반 · 5개 주제 분석
          </p>
        </div>
        <div style={{ display: "flex", gap: "8px" }}>
          <button
            type="button"
            onClick={expandAll}
            style={{
              padding: "6px 12px",
              fontSize: "12px",
              border: "1px solid var(--border-color, #ddd)",
              borderRadius: "6px",
              background: "transparent",
              cursor: "pointer",
              color: "var(--text-secondary, #666)",
            }}
          >
            전체 열기
          </button>
          <button
            type="button"
            onClick={collapseAll}
            style={{
              padding: "6px 12px",
              fontSize: "12px",
              border: "1px solid var(--border-color, #ddd)",
              borderRadius: "6px",
              background: "transparent",
              cursor: "pointer",
              color: "var(--text-secondary, #666)",
            }}
          >
            전체 닫기
          </button>
        </div>
      </div>

      {/* 상태 요약 바 */}
      {aiTopicMap.size > 0 && (
        <div
          style={{
            display: "flex",
            gap: "8px",
            marginBottom: "16px",
            flexWrap: "wrap",
          }}
        >
          {severityCounts.good > 0 && (
            <span style={{ fontSize: "13px", color: "#2E7D32" }}>
              ✅ 양호 {severityCounts.good}개
            </span>
          )}
          {severityCounts.caution > 0 && (
            <span style={{ fontSize: "13px", color: "#E65100" }}>
              ⚠️ 주의 {severityCounts.caution}개
            </span>
          )}
          {severityCounts.warning > 0 && (
            <span style={{ fontSize: "13px", color: "#C62828" }}>
              🚨 경고 {severityCounts.warning}개
            </span>
          )}
        </div>
      )}

      {/* 아코디언 카드 리스트 */}
      <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
        {insight.topics.map((topic) => (
          <AccordionCard
            key={topic.topicKey}
            topic={topic}
            aiAnalysis={aiTopicMap.get(topic.topicKey)}
            isOpen={openTopics.has(topic.topicKey)}
            onToggle={() => toggleTopic(topic.topicKey)}
          />
        ))}
      </div>

      {/* AI 한 줄 개선 제안 */}
      {insight.aiAnalysis?.one_line_advice && (
        <AdviceBanner advice={insight.aiAnalysis.one_line_advice} />
      )}
    </section>
  );
}
