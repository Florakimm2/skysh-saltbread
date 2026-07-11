"use client";

import { useEffect, useRef, useState } from "react";
import type {
  GuardrailTimelineItem,
  GuardrailTimelineResponse,
} from "@/backend/modules/logs/types";
import GuardrailTimelineRow from "./GuardrailTimelineRow";
import TimelineEmptyState from "./TimelineEmptyState";
import TimelineSkeleton from "./TimelineSkeleton";
import WarningDetailModal from "./WarningDetailModal";
import styles from "../dashboard.module.css";

type TimelineFilter = "ALL" | "WARNING" | "FEEDBACK";
type WarningItem = Extract<GuardrailTimelineItem, { type: "WARNING" }>;

async function fetchTimeline(params: {
  limit: number;
  cursor?: string | null;
  filter: TimelineFilter;
}) {
  const query = new URLSearchParams({
    limit: String(params.limit),
  });

  if (params.cursor) query.set("cursor", params.cursor);
  if (params.filter !== "ALL") query.set("type", params.filter);

  const response = await fetch(`/api/me/guardrail-timeline?${query}`, {
    credentials: "same-origin",
  });
  const data = (await response.json().catch(() => null)) as
    | { ok?: boolean; data?: GuardrailTimelineResponse; message?: string }
    | null;

  if (!response.ok || data?.ok === false || !data?.data) {
    throw new Error(data?.message || "가드레일 기록을 불러오지 못했습니다.");
  }

  return data.data;
}

export default function GuardrailTimeline({
  initialData,
  limit = 20,
  compact = false,
  showFilters = false,
  showStats = false,
  enablePagination = false,
}: {
  initialData?: GuardrailTimelineResponse | null;
  limit?: number;
  compact?: boolean;
  showFilters?: boolean;
  showStats?: boolean;
  enablePagination?: boolean;
}) {
  const [filter, setFilter] = useState<TimelineFilter>("ALL");
  const [items, setItems] = useState<GuardrailTimelineItem[]>(
    initialData?.items ?? [],
  );
  const [stats, setStats] = useState<GuardrailTimelineResponse | null>(
    initialData ?? null,
  );
  const [nextCursor, setNextCursor] = useState(initialData?.nextCursor ?? null);
  const [isLoading, setIsLoading] = useState(!initialData);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedWarning, setSelectedWarning] = useState<WarningItem | null>(null);
  const restoreFocusRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (initialData) return;
    let active = true;

    fetchTimeline({ limit, filter: "ALL" })
      .then((data) => {
        if (!active) return;
        setItems(data.items);
        setStats(data);
        setNextCursor(data.nextCursor);
      })
      .catch((fetchError) => {
        if (!active) return;
        setError(
          fetchError instanceof Error
            ? fetchError.message
            : "가드레일 기록을 불러오지 못했습니다.",
        );
        setItems([]);
      })
      .finally(() => {
        if (active) setIsLoading(false);
      });

    return () => {
      active = false;
    };
  }, [initialData, limit]);

  function handleOpenWarning(item: WarningItem, button: HTMLButtonElement) {
    restoreFocusRef.current = button;
    setSelectedWarning(item);
  }

  function handleCloseWarning() {
    setSelectedWarning(null);
    requestAnimationFrame(() => restoreFocusRef.current?.focus());
  }

  async function handleLoadMore() {
    if (!nextCursor || isLoadingMore) return;

    setIsLoadingMore(true);
    setError(null);

    try {
      const data = await fetchTimeline({
        limit,
        cursor: nextCursor,
        filter,
      });
      setItems((current) => [...current, ...data.items]);
      setStats(data);
      setNextCursor(data.nextCursor);
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "다음 기록을 불러오지 못했습니다.",
      );
    } finally {
      setIsLoadingMore(false);
    }
  }

  async function handleFilterChange(nextFilter: TimelineFilter) {
    setFilter(nextFilter);

    if (nextFilter === "ALL" && initialData) {
      setItems(initialData.items);
      setStats(initialData);
      setNextCursor(initialData.nextCursor);
      setError(null);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setError(null);
    setItems([]);

    try {
      const data = await fetchTimeline({ limit, filter: nextFilter });
      setItems(data.items);
      setStats(data);
      setNextCursor(data.nextCursor);
    } catch (filterError) {
      setError(
        filterError instanceof Error
          ? filterError.message
          : "가드레일 기록을 불러오지 못했습니다.",
      );
      setStats(null);
      setNextCursor(null);
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <div className={compact ? styles.guardrailTimelineCompact : undefined}>
      {showStats && stats ? (
        <div className={styles.timelineStats} aria-label="가드레일 기록 요약">
          <span>전체 기록 {stats.warningCount + stats.feedbackCount}건</span>
          <span>경고 {stats.warningCount}건</span>
          <span>피드백 {stats.feedbackCount}건</span>
        </div>
      ) : null}

      {showFilters ? (
        <div className={styles.timelineFilters} aria-label="가드레일 기록 필터">
          {[
            ["ALL", "전체"],
            ["WARNING", "경고"],
            ["FEEDBACK", "피드백"],
          ].map(([value, label]) => (
            <button
              aria-pressed={filter === value}
              className={filter === value ? styles.timelineFilterActive : ""}
              key={value}
              onClick={() => {
                void handleFilterChange(value as TimelineFilter);
              }}
              type="button"
            >
              {label}
            </button>
          ))}
        </div>
      ) : null}

      {isLoading ? <TimelineSkeleton rows={compact ? 2 : 5} /> : null}

      {!isLoading && error && items.length === 0 ? (
        <TimelineEmptyState isError message={error} />
      ) : null}

      {!isLoading && !error && items.length === 0 ? <TimelineEmptyState /> : null}

      {!isLoading && items.length > 0 ? (
        <div className={styles.timelineList}>
          {items.map((item) => (
            <GuardrailTimelineRow
              item={item}
              key={item.id}
              onOpenWarning={handleOpenWarning}
            />
          ))}
        </div>
      ) : null}

      {!isLoading && error && items.length > 0 ? (
        <p className={styles.timelineInlineError}>{error}</p>
      ) : null}

      {enablePagination && !isLoading && nextCursor ? (
        <div className={styles.timelinePagination}>
          <button
            aria-label="가드레일 기록 더 불러오기"
            disabled={isLoadingMore}
            onClick={handleLoadMore}
            type="button"
          >
            {isLoadingMore ? "불러오는 중..." : "더 보기"}
          </button>
        </div>
      ) : null}

      {selectedWarning ? (
        <WarningDetailModal item={selectedWarning} onClose={handleCloseWarning} />
      ) : null}
    </div>
  );
}
