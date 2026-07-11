import type {
  EntryPoint,
  OrderContextSnapshotDTO,
  OrderMode,
  OrderSide,
} from "@/backend/modules/logs/types";

export const SIDE_LABELS: Record<OrderSide, string> = {
  BUY: "매수",
  SELL: "매도",
  UNKNOWN: "알 수 없음",
};

export const ORDER_MODE_LABELS: Record<OrderMode, string> = {
  LIMIT: "지정가",
  MARKET: "시장가",
  BEST: "최유리",
  RESERVED: "예약 주문",
  UNKNOWN: "알 수 없음",
};

export const ENTRY_POINT_LABELS: Record<EntryPoint, string> = {
  NORMAL: "일반 주문",
  QUICK: "간편 주문",
  REORDER: "다시 주문",
  UNKNOWN: "알 수 없음",
};

function addThousandsSeparator(value: string) {
  const [integer, fraction] = value.split(".");
  const sign = integer.startsWith("-") ? "-" : "";
  const unsignedInteger = sign ? integer.slice(1) : integer;
  const grouped = unsignedInteger.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return fraction ? `${sign}${grouped}.${fraction}` : `${sign}${grouped}`;
}

function normalizeDecimalString(value: string) {
  const normalized = value.trim().replaceAll(",", "");
  return /^-?\d+(\.\d+)?$/u.test(normalized) ? normalized : null;
}

function formatDecimal(value: string, maximumFractionDigits = 8) {
  const normalized = normalizeDecimalString(value);
  if (!normalized) return value;

  const [integer, fraction = ""] = normalized.split(".");
  const trimmedFraction = fraction
    .slice(0, maximumFractionDigits)
    .replace(/0+$/u, "");
  const fixed = trimmedFraction ? `${integer}.${trimmedFraction}` : integer;
  return addThousandsSeparator(fixed);
}

function incrementIntegerString(value: string) {
  const digits = value.split("");
  let carry = 1;

  for (let index = digits.length - 1; index >= 0; index -= 1) {
    const next = Number(digits[index]) + carry;
    if (next >= 10) {
      digits[index] = "0";
      carry = 1;
    } else {
      digits[index] = String(next);
      carry = 0;
      break;
    }
  }

  return carry ? `1${digits.join("")}` : digits.join("");
}

function roundDecimalStringToInteger(value: string) {
  const normalized = normalizeDecimalString(value);
  if (!normalized) return null;

  const isNegative = normalized.startsWith("-");
  const unsigned = isNegative ? normalized.slice(1) : normalized;
  const [integer, fraction = ""] = unsigned.split(".");
  const rounded =
    fraction[0] && Number(fraction[0]) >= 5
      ? incrementIntegerString(integer || "0")
      : integer || "0";

  return `${isNegative ? "-" : ""}${rounded}`;
}

function getKstDateParts(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;

  const kst = new Date(date.getTime() + 9 * 60 * 60 * 1000);
  const year = kst.getUTCFullYear();
  const month = kst.getUTCMonth() + 1;
  const day = kst.getUTCDate();
  const hour24 = kst.getUTCHours();
  const minute = String(kst.getUTCMinutes()).padStart(2, "0");
  const period = hour24 < 12 ? "오전" : "오후";
  const hour12 = hour24 % 12 || 12;

  return {
    year,
    month,
    day,
    period,
    hour: hour12,
    minute,
  };
}

export function formatDateTime(value: string) {
  const parts = getKstDateParts(value);
  if (!parts) return "알 수 없는 시각";
  return `${parts.year}년 ${parts.month}월 ${parts.day}일 ${parts.period} ${parts.hour}:${parts.minute}`;
}

export function formatCompactDateTime(value: string) {
  const parts = getKstDateParts(value);
  if (!parts) return "알 수 없는 시각";
  return `${parts.year}. ${parts.month}. ${parts.day}. ${parts.period} ${parts.hour}:${parts.minute}`;
}

export function formatCurrency(value: string | null) {
  if (!value) return null;

  const rounded = roundDecimalStringToInteger(value);
  return `${addThousandsSeparator(rounded ?? value)}원`;
}

export function formatQuantity(value: string | null) {
  if (!value) return null;
  return `${formatDecimal(value)}개`;
}

export function formatPercent(value: number | null) {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return null;
  }

  const percent = Number((value * 100).toFixed(2));
  return `${percent > 0 ? "+" : ""}${percent}%`;
}

export function formatRatio(value: number | null) {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return null;
  }

  return `${Number((value * 100).toFixed(1))}%`;
}

export function formatDuration(ms: number | null) {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return null;
  if (ms < 1000) return `${Math.round(ms)}ms`;

  const totalSeconds = Math.round(ms / 1000);
  if (totalSeconds < 60) return `${Number((ms / 1000).toFixed(1))}초`;

  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return seconds > 0 ? `${minutes}분 ${seconds}초` : `${minutes}분`;
}

export function formatOrderSummary(snapshot: OrderContextSnapshotDTO | null) {
  if (!snapshot) return "연결된 주문 정보 없음";

  const amount =
    formatCurrency(snapshot.intentAmount) ??
    formatQuantity(snapshot.intentQuantity) ??
    formatCurrency(snapshot.intentPrice);

  return [
    snapshot.market,
    SIDE_LABELS[snapshot.side],
    ORDER_MODE_LABELS[snapshot.orderMode],
    amount,
  ]
    .filter(Boolean)
    .join(" · ");
}

export function formatFeedbackDuration(params: {
  feedbackShownAt: string;
  respondedAt: string;
}) {
  const shownAt = new Date(params.feedbackShownAt).getTime();
  const respondedAt = new Date(params.respondedAt).getTime();

  if (Number.isNaN(shownAt) || Number.isNaN(respondedAt)) return null;
  return formatDuration(Math.max(0, respondedAt - shownAt));
}
