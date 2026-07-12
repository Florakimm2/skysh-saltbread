from __future__ import annotations

from collections import Counter
from typing import Any

import numpy as np

from app.analysis.guardrail.preprocessing import CATEGORICAL_FIELDS, NUMERIC_FIELDS, safe_float
from app.analysis.guardrail.similarity import cosine_distance_matrix


def _quantile(values: list[float], q: float) -> float | None:
    finite = [value for value in values if np.isfinite(value)]
    if not finite:
        return None
    return float(np.quantile(finite, q))


def _round(value: float | None) -> float | None:
    if value is None or not np.isfinite(value):
        return None
    return float(round(value, 8))


def medoid_index(matrix: np.ndarray, indices: list[int]) -> int | None:
    if not indices:
        return None
    if len(indices) == 1:
        return indices[0]
    submatrix = matrix[indices]
    distances = cosine_distance_matrix(submatrix)
    average_distances = distances.mean(axis=1)
    return indices[int(np.argmin(average_distances))]


def representative_values(
    *,
    records: list[dict[str, Any]],
    matrix: np.ndarray,
    indices: list[int],
) -> dict[str, Any]:
    selected = [records[index] for index in indices]
    medoid = medoid_index(matrix, indices)
    result: dict[str, Any] = {
        "sampleCount": len(selected),
        "medoidRecordId": records[medoid].get("recordId") if medoid is not None else None,
        "numeric": {},
        "categorical": {},
        "marketDistribution": {},
    }

    for field in NUMERIC_FIELDS:
        values = [safe_float(record.get(field)) for record in selected]
        finite = [value for value in values if value is not None]
        if not finite:
            continue
        result["numeric"][field] = {
            "median": _round(_quantile(finite, 0.5)),
            "q1": _round(_quantile(finite, 0.25)),
            "q3": _round(_quantile(finite, 0.75)),
            "missingRate": round((len(values) - len(finite)) / max(len(values), 1), 4),
        }

    for field in CATEGORICAL_FIELDS:
        values = [record.get(field) for record in selected if record.get(field) is not None]
        if not values:
            continue
        counter = Counter(str(value) for value in values)
        mode, count = counter.most_common(1)[0]
        result["categorical"][field] = {
            "mode": mode,
            "modeRatio": round(count / len(selected), 4),
            "missingRate": round((len(selected) - len(values)) / max(len(selected), 1), 4),
        }

    markets = [record.get("market") for record in selected if record.get("market")]
    if markets:
        market_counter = Counter(str(market) for market in markets)
        result["marketDistribution"] = dict(market_counter.most_common(5))

    return result
