// frontend/dashboard/ai-insights-page.tsx

import type { DashboardInsightResult } from "@/backend/modules/insight/types";
import PageHeader from "./page-header";
import { SparklesIcon } from "./icons";
import styles from "./dashboard.module.css";

export default function AiInsightsPage({
  insight,
}: {
  insight: DashboardInsightResult;
}) {
// 💡 수정: ready 상태일 때만 데이터를 안전하게 꺼냅니다.
  const rawData = insight.status === "ready" ? insight.parsedData : {};
  const summaryText = insight.status === "ready" ? insight.insight : "";
  const cards = rawData.cards || [];

  return (
    <>
      <PageHeader
        eyebrow="Intelligence"
        title="AI 인사이트"
        description="최근 30일의 주문과 가드레일 기록을 바탕으로 원칙 준수 흐름을 정리합니다."
      />

      <section
        className={`${styles.panel} ${styles.aiDetailPanel}`}
        aria-labelledby="ai-detail-title"
      >
        <header className={styles.panelHeader}>
          <div className={styles.panelTitleGroup}>
            <span className={styles.panelIcon}>
              <SparklesIcon />
            </span>
            <h2 className={styles.panelTitle} id="ai-detail-title">
              최근 30일 AI 분석
            </h2>
          </div>
          <span className={styles.panelMeta}>
            {insight.sourceCount}건의 행동 세션 반영
          </span>
        </header>

        {insight.status === "ready" ? (
          <article className={styles.aiInsightBody}>
            <span className={styles.aiInsightMark}>
              <SparklesIcon />
            </span>
            <div>
              {summaryText.split(/\n+/).map((paragraph: string, index: number) => (
                <p key={`${index}-${paragraph.slice(0, 16)}`}>{paragraph}</p>
              ))}

              {cards.length > 0 && (
                <div style={{ marginTop: "24px", display: "flex", flexDirection: "column", gap: "12px" }}>
                  {cards.map((card: { title?: string; description?: string; severity?: string }, index: number) => (
                    <div 
                      key={index} 
                      style={{ 
                        padding: "16px", 
                        borderRadius: "12px", 
                        backgroundColor: "var(--surface-color, #f8f9fa)", 
                        border: "1px solid var(--border-color, #e9ecef)" 
                      }}
                    >
                      <h3 style={{ 
                        margin: "0 0 8px 0", 
                        fontSize: "16px", 
                        fontWeight: "600",
                        color: card.severity === "critical" || card.severity === "high" ? "#e03131" : "#1971c2" 
                      }}>
                        {card.title}
                      </h3>
                      <p style={{ margin: 0, fontSize: "14px", color: "var(--text-color, #495057)", lineHeight: "1.5" }}>
                        {card.description}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </article>
        ) : (
          <div className={styles.aiDetailEmpty}>
            <div className={styles.emptyStateInner}>
              <span className={styles.emptyGlyph}>
                <SparklesIcon />
              </span>
              <strong>
                {insight.status === "empty"
                  ? "최근 30일간 분석할 행동 기록이 없습니다"
                  : "AI 분석을 불러오지 못했습니다"}
              </strong>
              <p>
                {insight.status === "empty"
                  ? "새로운 주문과 가드레일 기록이 쌓이면 맞춤형 인사이트를 생성합니다."
                  : "잠시 후 페이지를 새로고침해 다시 확인해 주세요."}
              </p>
            </div>
          </div>
        )}
      </section>
    </>
  );
}
