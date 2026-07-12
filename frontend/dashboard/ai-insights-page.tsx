"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type {
  DailyInsightEligibility,
  DailyInsightReport,
  DailyTimelineEvent,
  OrderFlowViewModel,
} from "@/backend/modules/insight/daily-types";
import DailyInsightActions from "./daily-insight-actions";
import { buildExpressionPreview } from "./rule-expression-format";
import {
  buildFlowSteps,
  buildOrderFlowViewModels,
  buildReportListItem,
  buildVirtualPnlViewModel,
  formatDateKorean,
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

type VirtualPnlView = {
  available: boolean;
  title: string;
  message: string;
  summaryRows: Array<[string, string]>;
  items: Array<{
    key: string;
    title: string;
    time: string;
    rows: Array<[string, string]>;
    note: string;
    sellNotice?: string | null;
  }>;
};

type FlowView = {
  visibleFlows: OrderFlowViewModel[];
  hiddenFlows: OrderFlowViewModel[];
  unlinkedEvents: DailyTimelineEvent[];
};

function normalizeCounts(report: DailyInsightReport) {
  return {
    feedbacks: report.sourceCounts?.answeredFeedbacks ?? 0,
    attempts: report.sourceCounts?.attempts ?? 0,
    guardrails:
      report.sourceCounts?.guardrails ??
      report.sourceCounts?.guardrailSnapshots ??
      0,
  };
}

function countLabel(report: DailyInsightReport) {
  const counts = normalizeCounts(report);
  return `피드백 ${counts.feedbacks} · 주문 시도 ${counts.attempts} · 가드레일 ${counts.guardrails}`;
}

function statusLabel(status: DailyInsightReport["status"]) {
  if (status === "PARTIAL") return "일부 완료";
  if (status === "FAILED") return "생성 실패";
  return "완료";
}

function reportSortTime(report: DailyInsightReport) {
  return new Date(report.generatedAt || report.updatedAt || report.createdAt || 0).getTime();
}

function sortReportsByTime(reports: DailyInsightReport[]) {
  const unique = new Map<string, DailyInsightReport>();
  for (const report of reports) {
    if (!["COMPLETED", "PARTIAL", "FAILED"].includes(report.status)) continue;
    const key = report.reportId || `${report.date}:${report.generatedAt || report.updatedAt}`;
    const current = unique.get(key);
    const currentTime = current ? reportSortTime(current) : 0;
    const nextTime = reportSortTime(report);
    if (!current || nextTime >= currentTime) {
      unique.set(key, report);
    }
  }
  return [...unique.values()].sort((a, b) => reportSortTime(b) - reportSortTime(a));
}

function metricSections(report: DailyInsightReport) {
  const virtual = buildVirtualPnlViewModel(report.metrics?.cancelledOrderVirtualPnl);
  return {
    virtual: virtual as VirtualPnlView,
    waiting: report.metrics?.waitingPriceEffect,
    reduced: report.metrics?.reducedExposure,
    comparison: report.metrics?.feedbackPnlComparison,
  };
}

function reportSummary(report: DailyInsightReport) {
  return (
    report.overview?.summary ||
    report.fieldAnalysis?.oneLineAdvice ||
    "저장된 주문 기록을 기준으로 생성한 리포트입니다."
  );
}

function ReportDetailModal({
  report,
  onClose,
}: {
  report: DailyInsightReport;
  onClose: () => void;
}) {
  const router = useRouter();
  const titleId = `daily-report-${report.date}`;
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const [suggestionAction, setSuggestionAction] = useState<{
    id: string;
    state: "accepting" | "dismissing" | "done" | "error";
    message: string;
  } | null>(null);
  const metrics = metricSections(report);
  const firstWaitingItem = metrics.waiting?.items?.[0] as
    | { priceEffectRate?: number }
    | undefined;
  const flowSource: FlowView = report.orderFlows?.length
    ? {
        visibleFlows: report.orderFlows.slice(0, 5),
        hiddenFlows: report.orderFlows.slice(5),
        unlinkedEvents: [],
      }
    : (buildOrderFlowViewModels(report) as FlowView);
  const suggestions = report.suggestions || {
    newGuardrail: null,
    modification: null,
    newGuardrails: [],
    guardrailModifications: [],
  };
  const newGuardrails = suggestions.newGuardrail
    ? [suggestions.newGuardrail]
    : suggestions.newGuardrails || [];
  const modifications =
    suggestions.modification
      ? [suggestions.modification]
      : suggestions.modifications || suggestions.guardrailModifications || [];
  const defaultOpenTopicKey = (report.fieldAnalysis?.topics || []).find(
    (topic) => topic.severity !== "unavailable",
  )?.topic_key;

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

  function renderFlow(flow: OrderFlowViewModel) {
    const steps = buildFlowSteps(flow);
    const tradeAvailability = flow.trade?.availability || "NOT_CONFIRMED";
    return (
      <article className={styles.orderFlowCard} key={flow.flowId}>
        <header>
          <strong>
            {formatTimeKorean(flow.startedAt)} · {getMarketLabel(flow.market)}{" "}
            {getSideLabel(flow.side)}
          </strong>
          <span>{tradeAvailability === "CONFIRMED" ? "실제 주문 확인" : "실제 주문 데이터 미확인"}</span>
        </header>
        <ol>
          {steps.map((step: string) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
        {flow.guardrail.ruleNames.length > 0 ? (
          <p>표시된 가드레일: {flow.guardrail.ruleNames.join(", ")}</p>
        ) : null}
        {tradeAvailability !== "CONFIRMED" ? (
          <p>실제 주문 데이터가 없어 체결 여부는 확인할 수 없어요.</p>
        ) : null}
      </article>
    );
  }

  async function handleSuggestionAction(
    suggestionId: string,
    action: "accept" | "dismiss",
  ) {
    setSuggestionAction({
      id: suggestionId,
      state: action === "accept" ? "accepting" : "dismissing",
      message: action === "accept" ? "가드레일을 적용하고 있어요." : "제안을 닫고 있어요.",
    });
    try {
      const response = await fetch(
        `/api/insights/daily/${encodeURIComponent(report.reportId || report.date)}/suggestions/${suggestionId}/${action}`,
        { method: "POST" },
      );
      const payload = await response.json().catch(() => null);
      if (!response.ok || payload?.ok === false) {
        throw new Error(payload?.message || "제안 처리에 실패했습니다.");
      }
      setSuggestionAction({
        id: suggestionId,
        state: "done",
        message:
          action === "accept"
            ? "가드레일이 적용됐어요."
            : "제안을 닫았어요.",
      });
      router.refresh();
    } catch (error) {
      setSuggestionAction({
        id: suggestionId,
        state: "error",
        message:
          error instanceof Error
            ? error.message
            : "제안 처리에 실패했습니다.",
      });
    }
  }

  function renderSimulationRows(simulation?: {
    triggerCount?: number;
    support?: number;
    precision: number | null;
    recall: number | null;
    plannedTriggerRate?: number | null;
    falsePositiveRate?: number | null;
  }) {
    if (!simulation) return null;
    return (
      <dl className={styles.metricRows}>
        <div>
          <dt>경고 조건 일치</dt>
          <dd>{simulation.triggerCount ?? simulation.support ?? 0}건</dd>
        </div>
        <div>
          <dt>후회 거래 감지율</dt>
          <dd>{formatPercent(simulation.recall ?? 0).replace("+", "")}</dd>
        </div>
        <div>
          <dt>계획적 거래 경고율</dt>
          <dd>
            {formatPercent(
              simulation.plannedTriggerRate ??
                simulation.falsePositiveRate ??
                0,
            ).replace("+", "")}
          </dd>
        </div>
      </dl>
    );
  }

  function actionMessage(suggestionId: string) {
    return suggestionAction?.id === suggestionId ? suggestionAction.message : null;
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
            <h2 id={titleId}>{formatDateKorean(report.date)} 일간 리포트</h2>
            <p>{countLabel(report)}</p>
          </div>
          <button
            className={styles.modalCloseButton}
            type="button"
            ref={closeButtonRef}
            onClick={onClose}
            aria-label="리포트 닫기"
          >
            ×
          </button>
        </header>

        <div className={styles.dailyReportModalBody}>
          <section className={styles.reportSection}>
            <h3>오늘의 기록 요약</h3>
            <p>{reportSummary(report)}</p>
          </section>

          <section className={styles.reportSection}>
            <h3>가드레일이 주문에 미친 정량 변화</h3>
            {metrics.virtual.available ? (
              <>
                <div className={styles.metricSummary}>
                  <dl className={styles.metricRows}>
                  {metrics.virtual.summaryRows.map(([label, value]) => (
                      <div key={label}>
                        <dt>{label}</dt>
                        <dd>{value}</dd>
                      </div>
                    ))}
                  </dl>
                </div>
                <div className={styles.metricItemList}>
                  {metrics.virtual.items.map((item) => (
                    <article className={styles.metricItem} key={item.key}>
                      <header>
                        <strong>{item.title}</strong>
                        <span>{item.time}</span>
                      </header>
                      <dl className={styles.metricRows}>
                        {item.rows.map(([label, value]) => (
                          <div key={label}>
                            <dt>{label}</dt>
                            <dd>{value}</dd>
                          </div>
                        ))}
                      </dl>
                      <p>{item.note}</p>
                      {item.sellNotice ? <p>{item.sellNotice}</p> : null}
                    </article>
                  ))}
                </div>
              </>
            ) : (
              <div className={styles.neutralEmpty}>
                <strong>{metrics.virtual.title}</strong>
                <p>{metrics.virtual.message}</p>
              </div>
            )}
            {metrics.waiting?.status === "AVAILABLE" ? (
              <div className={styles.metricSummary}>
                <strong>경고 후 기다린 체결 가격 효과</strong>
                <p>
                  비교 주문 {metrics.waiting.sampleCount}건
                  {typeof firstWaitingItem?.priceEffectRate === "number"
                    ? ` · ${formatPercent(firstWaitingItem.priceEffectRate)}`
                    : ""}
                </p>
              </div>
            ) : null}
            {metrics.reduced?.status === "AVAILABLE" ? (
              <div className={styles.metricSummary}>
                <strong>줄인 주문 금액</strong>
                <p>{formatKrw(metrics.reduced.totalReducedExposureAmount)}</p>
              </div>
            ) : null}
          </section>

          <section className={styles.reportSection}>
            <h3>주문 시도 → 경고 → 반응 → 피드백 흐름</h3>
            <div className={styles.orderFlowList}>
              {flowSource.visibleFlows.map(renderFlow)}
            </div>
            {flowSource.hiddenFlows.length > 0 ? (
              <details className={styles.reportDetails}>
                <summary>나머지 흐름 {flowSource.hiddenFlows.length}개 보기</summary>
                <div className={styles.orderFlowList}>
                  {flowSource.hiddenFlows.map(renderFlow)}
                </div>
              </details>
            ) : null}
            {flowSource.unlinkedEvents.length > 0 ? (
              <details className={styles.reportDetails}>
                <summary>연결되지 않은 기록 보기</summary>
                <ul className={styles.rawEventList}>
                  {flowSource.unlinkedEvents.map((event: { id: string; title: string; description: string }) => (
                    <li key={event.id}>
                      <strong>{event.title}</strong>
                      <span>{event.description}</span>
                    </li>
                  ))}
                </ul>
              </details>
            ) : null}
          </section>

          <section className={styles.reportSection}>
            <h3>AI가 기록에서 발견한 패턴</h3>
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
            <h3>분야별 상세 분석</h3>
            <div className={styles.fieldTopicList}>
              {(report.fieldAnalysis?.topics || []).map((topic) => (
                <details
                  className={styles.fieldTopic}
                  key={topic.topic_key}
                  open={topic.topic_key === defaultOpenTopicKey}
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

          {report.suggestionStatus !== "NOT_IMPLEMENTED" ? (
            <section className={styles.reportSection}>
              <h3>내 기록에 맞는 가드레일 제안</h3>
              {report.suggestionStatus === "INSUFFICIENT_DATA" ? (
                <div className={styles.neutralEmpty}>
                  <strong>가드레일을 제안하기에 기록이 아직 부족해요.</strong>
                  <p>비슷한 주문 상황과 피드백이 더 쌓이면 새 규칙이나 기존 규칙 조정을 제안할 수 있어요.</p>
                </div>
              ) : report.suggestionStatus === "ERROR" ? (
                <div className={styles.neutralEmpty}>
                  <strong>가드레일 제안 분석을 완료하지 못했어요.</strong>
                  <p>기존 일간 리포트는 그대로 확인할 수 있어요.</p>
                </div>
              ) : newGuardrails.length === 0 && modifications.length === 0 ? (
                <div className={styles.neutralEmpty}>
                  <strong>이번 기록에서는 신뢰할 만한 새 가드레일 제안을 찾지 못했어요.</strong>
                  <p>기존 가드레일과 최근 기록의 차이가 충분히 크지 않았어요.</p>
                </div>
              ) : (
                <div className={styles.suggestionList}>
                  {newGuardrails.map((suggestion) => (
                    <article className={styles.suggestionCard} key={suggestion.suggestionId}>
                      <span>새로운 가드레일 제안</span>
                      <strong>{suggestion.title}</strong>
                      <p>{suggestion.rationale}</p>
                      <div className={styles.suggestionDetailGrid}>
                        <div>
                          <b>제안 조건</b>
                          <p>{buildExpressionPreview(suggestion.proposedRule.expression)}</p>
                        </div>
                        <div>
                          <b>근거</b>
                          <p>
                            유사 기록 {suggestion.evidenceCount}건 · 신뢰도{" "}
                            {formatPercent(suggestion.confidence).replace("+", "")}
                          </p>
                        </div>
                        <div>
                          <b>과거 기록 시뮬레이션</b>
                          {renderSimulationRows(suggestion.simulation)}
                        </div>
                      </div>
                      <details className={styles.reportDetails}>
                        <summary>규칙 자세히 보기</summary>
                        <p>{suggestion.explanation?.expectedChange}</p>
                        <p>{suggestion.explanation?.caution}</p>
                      </details>
                      <div className={styles.suggestionActions}>
                        <button
                          className={styles.primaryButton}
                          type="button"
                          onClick={() => handleSuggestionAction(suggestion.suggestionId, "accept")}
                          disabled={suggestion.status !== "PENDING" || suggestionAction?.state === "accepting"}
                        >
                          {suggestion.status === "ACCEPTED" ? "추가됨" : "이 가드레일 추가"}
                        </button>
                        <button
                          className={styles.secondaryButton}
                          type="button"
                          onClick={() => handleSuggestionAction(suggestion.suggestionId, "dismiss")}
                          disabled={suggestion.status !== "PENDING" || suggestionAction?.state === "dismissing"}
                        >
                          제안 닫기
                        </button>
                      </div>
                      {actionMessage(suggestion.suggestionId) ? (
                        <p>{actionMessage(suggestion.suggestionId)}</p>
                      ) : null}
                    </article>
                  ))}
                  {modifications.map((suggestion) => (
                    <article className={styles.suggestionCard} key={suggestion.suggestionId}>
                      <span>기존 가드레일 조정 제안</span>
                      <strong>{suggestion.title}</strong>
                      <p>{suggestion.rationale}</p>
                      <div className={styles.suggestionDetailGrid}>
                        <div>
                          <b>변경 내용</b>
                          {(suggestion.diff || []).map((item) => (
                            <p key={item.path}>
                              현재 {String(item.before)} → 제안 {String(item.after)}
                            </p>
                          ))}
                        </div>
                        <div>
                          <b>예상 변화</b>
                          <p>{suggestion.explanation?.expectedChange}</p>
                        </div>
                        <div>
                          <b>과거 기록 시뮬레이션</b>
                          {renderSimulationRows(suggestion.proposedSimulation)}
                        </div>
                      </div>
                      <details className={styles.reportDetails}>
                        <summary>변경 내용 보기</summary>
                        <p>{buildExpressionPreview(suggestion.proposedRule.expression)}</p>
                        {(suggestion.diff || []).map((item) => (
                          <p key={item.path}>{item.reason}</p>
                        ))}
                      </details>
                      <div className={styles.suggestionActions}>
                        <button
                          className={styles.primaryButton}
                          type="button"
                          onClick={() => handleSuggestionAction(suggestion.suggestionId, "accept")}
                          disabled={suggestion.status !== "PENDING" || suggestionAction?.state === "accepting"}
                        >
                          {suggestion.status === "ACCEPTED" ? "수정됨" : "이렇게 수정"}
                        </button>
                        <button
                          className={styles.secondaryButton}
                          type="button"
                          onClick={() => handleSuggestionAction(suggestion.suggestionId, "dismiss")}
                          disabled={suggestion.status !== "PENDING" || suggestionAction?.state === "dismissing"}
                        >
                          제안 닫기
                        </button>
                      </div>
                      {actionMessage(suggestion.suggestionId) ? (
                        <p>{actionMessage(suggestion.suggestionId)}</p>
                      ) : null}
                    </article>
                  ))}
                </div>
              )}
            </section>
          ) : null}

          <section className={styles.reportSection}>
            <h3>계산 방식과 주의 문구</h3>
            <details className={styles.reportCalculation}>
              <summary>자세히 보기</summary>
              <ul>
                <li>{report.metrics?.cancelledOrderVirtualPnl?.disclaimer}</li>
                <li>{report.metrics?.waitingPriceEffect?.disclaimer}</li>
                <li>{report.metrics?.reducedExposure?.disclaimer}</li>
                <li>{report.metrics?.feedbackPnlComparison?.disclaimer}</li>
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
  todayStatus,
}: {
  reports: DailyInsightReport[];
  todayStatus: DailyInsightEligibility;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const todayRef = useRef<HTMLElement | null>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const [generatedReport, setGeneratedReport] = useState<DailyInsightReport | null>(null);
  const displayReports = useMemo(
    () => sortReportsByTime(generatedReport ? [generatedReport, ...reports] : reports),
    [generatedReport, reports],
  );
  const selectedReportId = searchParams.get("report");
  const selectedReport = selectedReportId
    ? displayReports.find(
        (item) =>
          (item.reportId || item.date) === selectedReportId ||
          item.date === selectedReportId,
      ) || null
    : null;
  const queryError = selectedReportId && !selectedReport
    ? "해당 저장 리포트를 찾을 수 없어요."
    : null;
  const todayReport = displayReports.find((report) => report.date === todayStatus.date) || null;

  function replaceQuery(next: URLSearchParams) {
    const query = next.toString();
    router.push(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }

  function openReport(report: DailyInsightReport, trigger?: HTMLElement | null) {
    restoreFocusRef.current = trigger || (document.activeElement as HTMLElement | null);
    const next = new URLSearchParams(searchParams.toString());
    next.set("report", report.reportId || report.date);
    next.delete("focus");
    replaceQuery(next);
  }

  function handleGeneratedReport(report: DailyInsightReport) {
    setGeneratedReport(report);
    const next = new URLSearchParams(searchParams.toString());
    next.set("report", report.reportId || report.date);
    next.delete("focus");
    replaceQuery(next);
  }

  function closeReport() {
    const next = new URLSearchParams(searchParams.toString());
    next.delete("report");
    replaceQuery(next);
    requestAnimationFrame(() => restoreFocusRef.current?.focus?.());
  }

  useEffect(() => {
    if (searchParams.get("focus") === "today") {
      todayRef.current?.scrollIntoView({ block: "center" });
      todayRef.current?.classList.add(styles.focusPulse);
      const timerId = window.setTimeout(() => {
        todayRef.current?.classList.remove(styles.focusPulse);
      }, 1400);
      return () => window.clearTimeout(timerId);
    }
    return undefined;
  }, [searchParams]);

  useEffect(() => {
    const reportId = searchParams.get("report");
    if (!reportId) return;
    const report = displayReports.find(
      (item) => (item.reportId || item.date) === reportId || item.date === reportId,
    );
    if (report) return;
    const next = new URLSearchParams(searchParams.toString());
    next.delete("report");
    router.replace(next.toString() ? `${pathname}?${next.toString()}` : pathname, { scroll: false });
  }, [displayReports, pathname, router, searchParams]);

  return (
    <>
      <PageHeader
        eyebrow="Intelligence"
        title="AI 인사이트"
        description="버튼을 누를 때마다 현재 저장된 기록으로 새 AI 인사이트를 만들고, 저장된 리포트는 최신 생성순으로 확인하세요."
      />

      <section
        className={`${styles.panel} ${styles.aiDetailPanel} ${styles.aiGeneratePanel}`}
        aria-labelledby="daily-insight-cta-title"
        ref={todayRef}
      >
        <header className={styles.panelHeader}>
          <div className={styles.panelTitleGroup}>
            <span className={styles.panelIcon}>
              <SparklesIcon />
            </span>
            <h2 className={styles.panelTitle} id="daily-insight-cta-title">
              오늘의 일간 리포트
            </h2>
          </div>
          <span className={styles.panelMeta}>
            피드백 {todayStatus.answeredFeedbackCount}건
          </span>
        </header>
        <DailyInsightActions
          status={todayStatus}
          todayReport={todayReport}
          onGenerated={handleGeneratedReport}
        />
      </section>

      <section
        className={`${styles.panel} ${styles.aiDetailPanel}`}
        aria-labelledby="ai-list-title"
      >
        <header className={styles.panelHeader}>
          <div className={styles.panelTitleGroup}>
            <span className={styles.panelIcon}>
              <SparklesIcon />
            </span>
            <h2 className={styles.panelTitle} id="ai-list-title">
              저장된 일간 리포트
            </h2>
          </div>
          <span className={styles.panelMeta}>{displayReports.length}개 저장</span>
        </header>

        {queryError ? <p className={styles.formError}>{queryError}</p> : null}

        {displayReports.length > 0 ? (
          <div className={styles.aiReportList}>
            {displayReports.map((report) => {
              const item = buildReportListItem(
                report,
                selectedReport ? selectedReport.reportId || selectedReport.date : null,
              );
              return (
                <button
                  className={styles.aiReportItem}
                  key={item.key}
                  type="button"
                  onClick={(event) => openReport(report, event.currentTarget)}
                  data-selected={item.selected}
                >
                  <div>
                    <strong>
                      {item.dateLabel} · {statusLabel(report.status)}
                    </strong>
                    <p>{item.summary}</p>
                  </div>
                  <span>{item.meta}</span>
                  <small>리포트 보기 →</small>
                </button>
              );
            })}
          </div>
        ) : (
          <div className={styles.aiDetailEmpty}>
            <div className={styles.emptyStateInner}>
              <span className={styles.emptyGlyph}>
                <SparklesIcon />
              </span>
              <strong>아직 저장된 일간 리포트가 없습니다</strong>
              <p>생성하기 버튼을 누르면 현재 기록으로 새 AI 인사이트를 만들 수 있어요.</p>
            </div>
          </div>
        )}
      </section>

      {selectedReport ? (
        <ReportDetailModal report={selectedReport} onClose={closeReport} />
      ) : null}
    </>
  );
}
