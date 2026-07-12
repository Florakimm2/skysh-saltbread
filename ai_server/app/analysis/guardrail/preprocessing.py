from __future__ import annotations

from decimal import Decimal, InvalidOperation
from typing import Any

import numpy as np

CATEGORICAL_FIELDS = [
    "side",
    "orderMode",
    "snapshotTrigger",
    "entryPoint",
    "allocationPresetPercent",
]

BOOLEAN_FIELDS = [
    "modeChangedToMarket",
]

NUMERIC_FIELDS = [
    "requestedBalanceRatio",
    "draftDurationMs",
    "lastEditToSnapshotMs",
    "draftEditCount",
    "amountChangeRate",
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
    "draftResetCount3m",
    "shortTermReturn5m",
    "signedChangeRate",
    "spreadRate",
    "pricePositionIn5mRange",
    "volumeSpikeRatio5m",
    "priceVsAvgBuyRateAtSnapshot",
]

EXCLUDED_VECTOR_FIELDS = {
    "recordId",
    "snapshotId",
    "attemptId",
    "capturedAt",
    "matchedRuleIdsAtSnapshot",
    "primaryShownRuleId",
    "shownRuleIds",
    "market",
}

NUMERIC_CLIP_RANGES: dict[str, tuple[float, float]] = {
    "requestedBalanceRatio": (0.0, 1.0),
    "draftDurationMs": (0.0, 30 * 60 * 1000.0),
    "lastEditToSnapshotMs": (0.0, 30 * 60 * 1000.0),
    "draftEditCount": (0.0, 200.0),
    "amountChangeRate": (-10.0, 10.0),
    "orderbookClickToSnapshotMs": (0.0, 30 * 60 * 1000.0),
    "orderIntentCount1m": (0.0, 100.0),
    "actualOrderCreatedCount10m": (0.0, 200.0),
    "sameSideIntentCount1m": (0.0, 100.0),
    "marketChangeCount5m": (0.0, 200.0),
    "sideChangeCount3m": (0.0, 200.0),
    "priceEditCount3m": (0.0, 300.0),
    "quantityEditCount3m": (0.0, 300.0),
    "amountEditCount3m": (0.0, 300.0),
    "inputRevertCount": (0.0, 200.0),
    "priceDirectionChangeCount": (0.0, 200.0),
    "priceChangeRate": (-10.0, 10.0),
    "orderModeChangeCount3m": (0.0, 200.0),
    "draftResetCount3m": (0.0, 200.0),
    "shortTermReturn5m": (-5.0, 5.0),
    "signedChangeRate": (-5.0, 5.0),
    "spreadRate": (0.0, 1.0),
    "pricePositionIn5mRange": (0.0, 1.0),
    "volumeSpikeRatio5m": (0.0, 1000.0),
    "priceVsAvgBuyRateAtSnapshot": (-10.0, 10.0),
}


def safe_float(value: Any) -> float | None:
    if value is None or value == "":
        return None
    if isinstance(value, bool):
        return 1.0 if value else 0.0
    try:
        decimal = Decimal(str(value).replace(",", ""))
    except (InvalidOperation, ValueError):
        return None
    if not decimal.is_finite():
        return None
    number = float(decimal)
    if not np.isfinite(number):
        return None
    return number


def clip_numeric(field: str, value: float | None) -> float | None:
    if value is None:
        return None
    low, high = NUMERIC_CLIP_RANGES.get(field, (-1e9, 1e9))
    return float(min(max(value, low), high))


def normalize_record_for_features(record: dict[str, Any]) -> dict[str, Any]:
    normalized = dict(record)
    for field in NUMERIC_FIELDS:
        normalized[field] = clip_numeric(field, safe_float(normalized.get(field)))
    for field in BOOLEAN_FIELDS:
        value = normalized.get(field)
        normalized[field] = value if isinstance(value, bool) else None
    for field in CATEGORICAL_FIELDS:
        value = normalized.get(field)
        normalized[field] = None if value is None or value == "" else str(value)
    return normalized


def is_finite_number(value: Any) -> bool:
    return safe_float(value) is not None
