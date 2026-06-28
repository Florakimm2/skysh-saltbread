// backend/modules/insight/service.ts

import type { InsightRequestInput, InsightResult } from "./types";

const DEFAULT_TIMEOUT_MS = 30_000;

function getFastApiInsightUrl() {
  const url = process.env.FASTAPI_INSIGHT_URL;

  if (!url) {
    throw new Error("FASTAPI_INSIGHT_URL 환경변수가 설정되지 않았습니다.");
  }

  return url;
}

function extractInsightFromFastApiResponse(rawText: string): string {
  const trimmed = rawText.trim();

  if (!trimmed) {
    throw new Error("FastAPI 응답이 비어 있습니다.");
  }

  try {
    const parsed = JSON.parse(trimmed);

    // FastAPI가 그냥 JSON string으로 반환하는 경우
    if (typeof parsed === "string") {
      return parsed;
    }

    // FastAPI가 객체로 반환하는 경우까지 방어
    if (parsed && typeof parsed === "object") {
      const objectValue = parsed as Record<string, unknown>;

      const candidateKeys = [
        "insight",
        "result",
        "summaries",
        "summary",
        "output",
        "data",
      ];

      for (const key of candidateKeys) {
        const value = objectValue[key];

        if (typeof value === "string") {
          return value;
        }
      }

      return JSON.stringify(parsed);
    }

    return String(parsed);
  } catch {
    // text/plain으로 문자열만 반환하는 경우
    return trimmed;
  }
}

async function fetchWithTimeout(
  url: string,
  options: RequestInit,
  timeoutMs = DEFAULT_TIMEOUT_MS
) {
  const controller = new AbortController();

  const timeoutId = setTimeout(() => {
    controller.abort();
  }, timeoutMs);

  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function requestInsightFromFastApi(
  input: InsightRequestInput
): Promise<InsightResult> {
  const fastApiUrl = getFastApiInsightUrl();

  const response = await fetchWithTimeout(fastApiUrl, {
    method: "POST",
    headers: {
      Accept: "application/json, text/plain",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      summaries: input.summaries,
    }),
    cache: "no-store",
  });

  const rawText = await response.text();

  if (!response.ok) {
    throw new Error(
      `FASTAPI_INSIGHT_FAILED_${response.status}: ${rawText.slice(0, 300)}`
    );
  }

  return {
    insight: extractInsightFromFastApiResponse(rawText),
  };
}