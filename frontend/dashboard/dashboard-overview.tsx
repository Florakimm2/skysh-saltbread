import Link from "next/link";
import type { BehaviorSessionRecord } from "@/backend/modules/behavior/types";
import type { DashboardInsightResult } from "@/backend/modules/insight/types";
import FlameMascot from "@/frontend/auth/flame-mascot";
import PageHeader from "./page-header";
import {
  EmptyBoxIcon,
  NoteIcon,
  SparklesIcon,
} from "./icons";
import TrendRecordList from "./trend-record-list";
import styles from "./dashboard.module.css";

function splitFirstSentence(text: string) {
  const normalized = text.trim();
  const match = normalized.match(/^[\s\S]*?[.!?。！？](?:["'”’)]*)/);

  if (!match) {
    const [firstLine, ...rest] = normalized.split(/\n+/);
    return {
      firstSentence: firstLine,
      remainder: rest.join("\n").trim(),
    };
  }

  return {
    firstSentence: match[0].trim(),
    remainder: normalized.slice(match[0].length).trim(),
  };
}

function InsightPreview({ insight }: { insight: DashboardInsightResult }) {
  if (insight.status === "empty") {
    return (
      <div className={styles.emptyState}>
        <div className={styles.emptyStateInner}>
          <span className={styles.emptyGlyph}>
            <SparklesIcon />
          </span>
          <strong>최근 7일간 분석할 행동 기록이 없습니다</strong>
          <p>새로운 주문 행동이 쌓이면 AI 인사이트가 생성됩니다.</p>
        </div>
      </div>
    );
  }

  if (insight.status === "error") {
    return (
      <div className={styles.emptyState}>
        <div className={styles.emptyStateInner}>
          <span className={styles.emptyGlyph}>
            <SparklesIcon />
          </span>
          <strong>AI 인사이트를 불러오지 못했습니다</strong>
          <p>잠시 후 페이지를 새로고침해 다시 확인해 주세요.</p>
        </div>
      </div>
    );
  }

  const { firstSentence, remainder } = splitFirstSentence(insight.insight);

  return (
    <Link className={styles.insightPreview} href="/dashboard/ai-insights">
      <strong>{firstSentence}</strong>
      {remainder ? <p>{remainder}</p> : null}
      <span>AI 인사이트 자세히 보기 →</span>
    </Link>
  );
}

export default function DashboardOverview({
  insight,
  trends,
  isDataUnavailable = false,
}: {
  insight: DashboardInsightResult;
  trends: BehaviorSessionRecord[];
  isDataUnavailable?: boolean;
}) {
  return (
    <>
      <PageHeader
        eyebrow="Overview"
        title="대시보드"
        description="나의 투자 기록과 AI 분석을 한눈에 확인하세요."
        showDate
      />

      <div className={styles.dashboardGrid}>
        <section className={styles.welcomeCard}>
          <div className={styles.welcomeCopy}>
            <p>오늘도 불씨와 함께</p>
            <h2>
              서두르지 않아도 괜찮아요.
              <br />
              차분한 투자를 이어가 볼까요?
            </h2>
            <span>행동 기록과 맞춤 인사이트를 한곳에서 확인해요.</span>
          </div>
          <div className={styles.welcomeVisual} aria-hidden="true">
            <span className={styles.welcomeGlow} />
            <FlameMascot
              className={styles.welcomeFlame}
              label=""
              mode="default"
              size="clamp(118px, 14vw, 178px)"
              speed="slow"
            />
          </div>
        </section>

        <section
          className={`${styles.panel} ${styles.insightPanel}`}
          aria-labelledby="insight-panel-title"
        >
          <header className={styles.panelHeader}>
            <div className={styles.panelTitleGroup}>
              <span className={styles.panelIcon}>
                <SparklesIcon />
              </span>
              <h2 className={styles.panelTitle} id="insight-panel-title">
                AI 인사이트
              </h2>
            </div>
            <span className={styles.panelMeta}>최근 분석</span>
          </header>
          <InsightPreview insight={insight} />
        </section>

        <section
          className={`${styles.panel} ${styles.recordsPanel}`}
          aria-labelledby="records-panel-title"
        >
          <header className={styles.panelHeader}>
            <div className={styles.panelTitleGroup}>
              <span className={styles.panelIcon}>
                <NoteIcon />
              </span>
              <h2 className={styles.panelTitle} id="records-panel-title">
                최근 행동 기록
              </h2>
            </div>
            <Link className={styles.panelLink} href="/dashboard/trends">
              전체 보기
            </Link>
          </header>
          {trends.length > 0 ? (
            <TrendRecordList records={trends} />
          ) : (
            <div className={styles.emptyState}>
              <div className={styles.emptyStateInner}>
                <span className={styles.emptyGlyph}>
                  <EmptyBoxIcon />
                </span>
                <strong>
                  {isDataUnavailable
                    ? "행동 기록을 불러오지 못했습니다"
                    : "주문 행동 기록이 아직 없습니다"}
                </strong>
                <p>
                  {isDataUnavailable
                    ? "데이터 사용량이 복구된 뒤 다시 확인해 주세요."
                    : "Extension에서 수집한 행동 데이터가 이곳에 쌓입니다."}
                </p>
              </div>
            </div>
          )}
        </section>
      </div>
    </>
  );
}
