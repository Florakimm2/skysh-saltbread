"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type {
  WeeklyInsightReport,
  WeeklyInsightStatusResponse,
} from "@/backend/modules/insight/weekly-types";
import WeeklyInsightActions from "./weekly-insight-actions";
import { buildExpressionPreview } from "./rule-expression-format";
import {
  formatKrw,
  formatPercent,
  formatTimeKorean,
  getMarketLabel,
  getSeverityLabel,
  getSideLabel,
} from "./daily-insight-view-model";
import PageHeader from "./page-header";
import { SparklesIcon } from "./icons";
import styles from "./dashboard.module.css";

const WEEKDAY_LABELS = ["월", "화", "수", "목", "금", "토", "일"];

function formatPeriod(report: WeeklyInsightReport) {
  const start = new Date(report.periodStart);
  const end = new Date(report.periodEnd);
  const kstStart = new Date(start.getTime() + 9 * 60 * 60 * 1000);
  const kstEnd = new Date(end.getTime() + 9 * 60 * 60 * 1000);
  return `${kstStart.getUTCMonth() + 1}월 ${kstStart.getUTCDate()}일 ~ ${kstEnd.getUTCMonth() + 1}월 ${kstEnd.getUTCDate()}일`;
}

function sortWeeklyReports(reports: WeeklyInsightReport[]) {
  const byWeek = new Map<string, WeeklyInsightReport>();
  for (const report of reports) {
    const current = byWeek.get(report.weekKey);
    if (!current || report.reportVersion >= current.reportVersion) {
      byWeek.set(report.weekKey, report);
    }
  }
  return [...byWeek.values()].sort(
    (left, right) =>
      new Date(right.periodStart).getTime() - new Date(left.periodStart).getTime(),
  );
}

function reportSummary(report: WeeklyInsightReport) {
  return (
    report.overview?.summary ||
    report.fieldAnalysis?.oneLineAdvice ||
    "저장된 주간 주문 기록을 기준으로 생성한 리포트입니다."
  );
}

function statusBadge(report: WeeklyInsightReport) {
  if (report.reportStatus === "FAILED") return "생성 실패";
  if (report.reportStatus === "PARTIAL") return "일부 완료";
  return report.periodState === "CLOSED" ? "최종" : "진행 중";
}

function ReportModal({
  report,
  onClose,
}: {
  report: WeeklyInsightReport;
  onClose: () => void;
}) {
  const router = useRouter();
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const titleId = `weekly-report-${report.weekKey}`;
  const virtual = report.metrics.twentyFourHourVirtualOrderResult;
  const suggestions = [
    report.suggestions.newGuardrail,
    report.suggestions.modification,
  ].filter(Boolean);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeButtonRef.current?.focus();

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
        return;
      }
      if (event.key !== "Tab" || !dialogRef.current) return;
      const focusable = Array.from(
        dialogRef.current.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((element) => !element.hasAttribute("disabled"));
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose]);

  async function handleSuggestionAction(suggestionId: string, action: "accept" | "dismiss") {
    setActionMessage(action === "accept" ? "가드레일을 적용하고 있어요." : "제안을 닫고 있어요.");
    try {
      const response = await fetch(
        `/api/insights/weekly/${encodeURIComponent(report.weekKey)}/suggestions/${suggestionId}/${action}`,
        { method: "POST" },
      );
      const payload = await response.json().catch(() => null);
      if (!response.ok || payload?.ok === false) {
        throw new Error(payload?.message || "제안 처리에 실패했습니다.");
      }
      setActionMessage(action === "accept" ? "가드레일이 적용됐어요." : "제안을 닫았어요.");
      router.refresh();
    } catch (error) {
      setActionMessage(error instanceof Error ? error.message : "제안 처리에 실패했습니다.");
    }
  }

  function renderFlow(flow: WeeklyInsightReport["orderFlows"][number]) {
    return (
      <article className={styles.orderFlowCard} key={flow.flowId}>
        <header>
          <strong>
            {formatTimeKorean(flow.startedAt)} · {getMarketLabel(flow.market)}{" "}
            {getSideLabel(flow.side)}
          </strong>
          <span>{flow.linkConfidence === "EXACT" ? "정확 연결" : flow.linkConfidence === "INFERRED" ? "추론 연결" : "연결 불확실"}</span>
        </header>
        <ol>
          {(flow.events || []).map((event) => (
            <li key={event.id}>{event.title} · {event.description}</li>
          ))}
        </ol>
        {flow.guardrail.ruleNames.length > 0 ? (
          <p>표시된 가드레일: {flow.guardrail.ruleNames.join(", ")}</p>
        ) : null}
        {flow.trade.availability !== "CONFIRMED" ? (
          <p>실제 주문 데이터가 없어 체결 여부는 확인할 수 없어요.</p>
        ) : null}
      </article>
    );
  }

  return (
    <div
      className={styles.modalBackdrop}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        className={styles.dailyReportModal}
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <header className={styles.dailyReportModalHeader}>
          <div>
            <h2 id={titleId}>{formatPeriod(report)} 주간 리포트</h2>
            <p>
              활동 {report.sourceCounts.activeDays}일 · 피드백 {report.sourceCounts.answeredFeedbacks} · 주문 시도 {report.sourceCounts.orderAttempts} · 가드레일 {report.sourceCounts.shownGuardrails}
            </p>
          </div>
          <button
            className={styles.modalCloseButton}
            type="button"
            ref={closeButtonRef}
            onClick={onClose}
            aria-label="주간 리포트 닫기"
          >
            ×
          </button>
        </header>

        <div className={styles.dailyReportModalBody}>
          <section className={styles.reportSection}>
            <h3>1. 이번 주 기록 요약</h3>
            <p>{reportSummary(report)}</p>
          </section>

          <section className={styles.reportSection}>
            <h3>2. 일별 기록 변화</h3>
            <div className={styles.metricItemList}>
              {report.dailyBreakdown.map((day, index) => (
                <article className={styles.metricItem} key={day.date}>
                  <header>
                    <strong>{WEEKDAY_LABELS[index]} · {day.date}</strong>
                    <span>{day.active ? "활동" : "기록 없음"}</span>
                  </header>
                  <p>
                    주문 시도 {day.orderAttemptCount} · 가드레일 {day.shownGuardrailCount} · 피드백 {day.plannedFeedbackCount + day.regrettedFeedbackCount}
                  </p>
                </article>
              ))}
            </div>
          </section>

          <section className={styles.reportSection}>
            <h3>3. 가드레일이 주문에 미친 정량 변화</h3>
            {virtual.status === "AVAILABLE" ? (
              <div className={styles.metricSummary}>
                <strong>24시간 가상 주문 결과</strong>
                <p>비교 주문 {virtual.sampleCount}건 · 순 가상 가격 변화 {formatKrw(virtual.netValue)}</p>
                {virtual.notMaturedCount > 0 ? (
                  <p>24시간 비교 시점이 아직 지나지 않은 주문 {virtual.notMaturedCount}건</p>
                ) : null}
              </div>
            ) : (
              <div className={styles.neutralEmpty}>
                <strong>24시간 비교 가능한 주문이 아직 부족해요.</strong>
                <p>{virtual.notMaturedCount > 0 ? `24시간 비교 시점이 아직 지나지 않은 주문 ${virtual.notMaturedCount}건` : "현재 ticker 가격을 과거 24시간 가격 대신 사용하지 않았어요."}</p>
              </div>
            )}
            <div className={styles.metricItemList}>
              {virtual.items.slice(0, 5).map((item) => (
                <article className={styles.metricItem} key={item.snapshotId}>
                  <header>
                    <strong>{getMarketLabel(item.market)} {getSideLabel(item.side)}</strong>
                    <span>{formatTimeKorean(item.capturedAt)}</span>
                  </header>
                  <dl className={styles.metricRows}>
                    <div><dt>가상 가격 변화</dt><dd>{formatKrw(item.value)}</dd></div>
                    <div><dt>24시간 수익률</dt><dd>{formatPercent(item.returnRate)}</dd></div>
                  </dl>
                  <p>{item.note}</p>
                </article>
              ))}
            </div>
          </section>

          <section className={styles.reportSection}>
            <h3>4. 주간 주문 흐름</h3>
            <div className={styles.orderFlowList}>
              {report.orderFlows.map(renderFlow)}
            </div>
          </section>

          <section className={styles.reportSection}>
            <h3>5. AI가 발견한 주간 패턴</h3>
            <div className={styles.aiCardGrid}>
              {(report.overview?.cards || []).map((card) => (
                <article className={styles.patternCard} key={`${card.title}:${card.severity}`}>
                  <span data-severity={card.severity}>{getSeverityLabel(card.severity)}</span>
                  <strong>{card.title}</strong>
                  <p>{card.description}</p>
                </article>
              ))}
            </div>
          </section>

          <section className={styles.reportSection}>
            <h3>6. 분야별 상세 분석</h3>
            <div className={styles.fieldTopicList}>
              {(report.fieldAnalysis?.topics || []).map((topic, index) => (
                <details
                  className={styles.fieldTopic}
                  key={topic.topic_key}
                  open={index === 0 && topic.severity !== "unavailable"}
                >
                  <summary>
                    {topic.topic_label}
                    <span>{getSeverityLabel(topic.severity)}</span>
                  </summary>
                  <strong>{topic.headline}</strong>
                  <p>{topic.analysis}</p>
                </details>
              ))}
            </div>
          </section>

          <section className={styles.reportSection}>
            <h3>7. 내 기록에 맞는 가드레일 제안</h3>
            {suggestions.length === 0 ? (
              <div className={styles.neutralEmpty}>
                <strong>이번 주 리포트에 바로 적용할 제안은 없어요.</strong>
                <p>
                  신규 제안 {report.suggestionAnalysis.newGuardrail.status} · 기존 규칙 수정 {report.suggestionAnalysis.modification.status}
                </p>
              </div>
            ) : (
              <div className={styles.suggestionList}>
                {suggestions.map((suggestion) => suggestion ? (
                  <article className={styles.suggestionCard} key={suggestion.suggestionId}>
                    <span>{suggestion.type === "NEW_GUARDRAIL" ? "새로운 가드레일 제안" : "기존 가드레일 조정 제안"}</span>
                    <strong>{suggestion.title}</strong>
                    <p>{suggestion.rationale}</p>
                    <div className={styles.suggestionDetailGrid}>
                      <div>
                        <b>제안 조건</b>
                        <p>{buildExpressionPreview(suggestion.proposedRule.expression)}</p>
                      </div>
                      <div>
                        <b>근거</b>
                        <p>표본 {suggestion.evidenceCount}건 · 평가 방식 {suggestion.evaluationMode || "IN_SAMPLE"}</p>
                      </div>
                      <div>
                        <b>주의</b>
                        <p>같은 과거 기록에서 찾고 평가한 참고 결과예요. 새로운 주문에서도 같은 결과가 보장되지는 않아요.</p>
                      </div>
                    </div>
                    <div className={styles.suggestionActions}>
                      <button
                        className={styles.primaryButton}
                        type="button"
                        onClick={() => handleSuggestionAction(suggestion.suggestionId, "accept")}
                        disabled={suggestion.status !== "PENDING"}
                      >
                        {suggestion.type === "NEW_GUARDRAIL" ? "이 가드레일 추가" : "이렇게 수정"}
                      </button>
                      <button
                        className={styles.secondaryButton}
                        type="button"
                        onClick={() => handleSuggestionAction(suggestion.suggestionId, "dismiss")}
                        disabled={suggestion.status !== "PENDING"}
                      >
                        제안 닫기
                      </button>
                    </div>
                  </article>
                ) : null)}
              </div>
            )}
            {actionMessage ? <p>{actionMessage}</p> : null}
          </section>

          <section className={styles.reportSection}>
            <h3>8. 계산 방식과 주의 사항</h3>
            <details className={styles.reportCalculation}>
              <summary>자세히 보기</summary>
              <ul>
                <li>{report.metrics.twentyFourHourVirtualOrderResult.disclaimer}</li>
                <li>{String(report.metrics.waitingPriceEffect.disclaimer || "")}</li>
                <li>{String(report.metrics.reducedExposure.disclaimer || "")}</li>
                <li>{String(report.metrics.feedbackPnlComparison.disclaimer || "")}</li>
              </ul>
            </details>
          </section>
        </div>
      </div>
    </div>
  );
}

export default function AiInsightsPage({
  reports,
  weeklyStatus,
}: {
  reports: WeeklyInsightReport[];
  weeklyStatus: WeeklyInsightStatusResponse;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const generateRef = useRef<HTMLElement | null>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const [generatedReport, setGeneratedReport] = useState<WeeklyInsightReport | null>(null);
  const displayReports = useMemo(
    () => sortWeeklyReports(generatedReport ? [generatedReport, ...reports] : reports),
    [generatedReport, reports],
  );
  const selectedWeekKey = searchParams.get("week");
  const selectedReport = selectedWeekKey
    ? displayReports.find((report) => report.weekKey === selectedWeekKey) || null
    : null;
  const targetReport =
    displayReports.find((report) => report.weekKey === weeklyStatus.weekKey) || null;

  function replaceQuery(next: URLSearchParams) {
    const query = next.toString();
    router.push(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }

  function openReport(report: WeeklyInsightReport, trigger?: HTMLElement | null) {
    restoreFocusRef.current = trigger || (document.activeElement as HTMLElement | null);
    const next = new URLSearchParams(searchParams.toString());
    next.set("week", report.weekKey);
    next.delete("focus");
    replaceQuery(next);
  }

  function closeReport() {
    const next = new URLSearchParams(searchParams.toString());
    next.delete("week");
    replaceQuery(next);
    requestAnimationFrame(() => restoreFocusRef.current?.focus?.());
  }

  function handleGenerated(report: WeeklyInsightReport) {
    setGeneratedReport(report);
    const next = new URLSearchParams(searchParams.toString());
    next.set("week", report.weekKey);
    next.delete("focus");
    replaceQuery(next);
  }

  useEffect(() => {
    if (searchParams.get("focus") === "generate") {
      generateRef.current?.scrollIntoView({ block: "center" });
      generateRef.current?.classList.add(styles.focusPulse);
      const timerId = window.setTimeout(() => {
        generateRef.current?.classList.remove(styles.focusPulse);
      }, 1400);
      return () => window.clearTimeout(timerId);
    }
    return undefined;
  }, [searchParams]);

  return (
    <>
      <PageHeader
        eyebrow="Intelligence"
        title="AI 인사이트"
        description="한 주 동안 쌓인 주문 시도, 가드레일, 피드백을 모아 반복된 행동과 가격 효과를 확인해요."
      />

      <section
        className={`${styles.panel} ${styles.aiDetailPanel} ${styles.aiGeneratePanel}`}
        aria-labelledby="weekly-insight-cta-title"
        ref={generateRef}
      >
        <header className={styles.panelHeader}>
          <div className={styles.panelTitleGroup}>
            <span className={styles.panelIcon}>
              <SparklesIcon />
            </span>
            <h2 className={styles.panelTitle} id="weekly-insight-cta-title">
              {weeklyStatus.periodState === "CLOSED" ? "지난주 주간 리포트" : "이번 주 주간 리포트"}
            </h2>
          </div>
          <span className={styles.panelMeta}>
            피드백 {weeklyStatus.answeredFeedbackCount}/{weeklyStatus.requiredFeedbackCount}
          </span>
        </header>
        <WeeklyInsightActions
          status={weeklyStatus}
          report={targetReport}
          onViewReport={targetReport ? () => openReport(targetReport) : undefined}
          onGenerated={handleGenerated}
        />
      </section>

      <section
        className={`${styles.panel} ${styles.aiDetailPanel}`}
        aria-labelledby="weekly-list-title"
      >
        <header className={styles.panelHeader}>
          <div className={styles.panelTitleGroup}>
            <span className={styles.panelIcon}>
              <SparklesIcon />
            </span>
            <h2 className={styles.panelTitle} id="weekly-list-title">
              저장된 주간 리포트
            </h2>
          </div>
          <span className={styles.panelMeta}>{displayReports.length}개 저장</span>
        </header>

        {displayReports.length > 0 ? (
          <div className={styles.aiReportList}>
            {displayReports.map((report) => (
              <button
                className={styles.aiReportItem}
                key={report.weekKey}
                type="button"
                onClick={(event) => openReport(report, event.currentTarget)}
                data-selected={selectedReport?.weekKey === report.weekKey}
              >
                <div>
                  <strong>{formatPeriod(report)} · {statusBadge(report)}</strong>
                  <p>{reportSummary(report)}</p>
                </div>
                <span>
                  활동 {report.sourceCounts.activeDays}일 · 피드백 {report.sourceCounts.answeredFeedbacks} · 주문 시도 {report.sourceCounts.orderAttempts} · 가드레일 {report.sourceCounts.shownGuardrails}
                </span>
                <small>리포트 보기 →</small>
              </button>
            ))}
          </div>
        ) : (
          <div className={styles.aiDetailEmpty}>
            <div className={styles.emptyStateInner}>
              <span className={styles.emptyGlyph}>
                <SparklesIcon />
              </span>
              <strong>아직 저장된 주간 리포트가 없습니다</strong>
              <p>주간 피드백이 5개 이상 쌓이면 새 AI 인사이트를 만들 수 있어요.</p>
            </div>
          </div>
        )}
      </section>

      {selectedReport ? (
        <ReportModal report={selectedReport} onClose={closeReport} />
      ) : null}
    </>
  );
}
