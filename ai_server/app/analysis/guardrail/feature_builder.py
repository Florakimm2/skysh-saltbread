from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import numpy as np
import pandas as pd
from sklearn.compose import ColumnTransformer
from sklearn.impute import SimpleImputer
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder, RobustScaler

from app.analysis.guardrail.preprocessing import (
    BOOLEAN_FIELDS,
    CATEGORICAL_FIELDS,
    NUMERIC_FIELDS,
    normalize_record_for_features,
)
from app.analysis.guardrail.schemas import SnapshotFeatureRecord

MIN_VALID_RATIO = 0.60


@dataclass(frozen=True)
class FeatureMatrix:
    matrix: np.ndarray
    records: list[dict[str, Any]]
    used_feature_names: list[str]
    dropped_feature_names: list[str]
    selected_numeric_fields: list[str]
    selected_categorical_fields: list[str]
    selected_boolean_fields: list[str]


def _encoder() -> OneHotEncoder:
    try:
        return OneHotEncoder(handle_unknown="ignore", sparse_output=False)
    except TypeError:
        return OneHotEncoder(handle_unknown="ignore", sparse=False)


def _has_variation(series: pd.Series) -> bool:
    non_missing = series.dropna()
    if len(non_missing) == 0:
        return False
    return non_missing.astype(str).nunique() > 1


def _select_fields(
    frame: pd.DataFrame,
    candidate_fields: list[str],
    *,
    dropped: list[str],
) -> list[str]:
    selected: list[str] = []
    row_count = max(len(frame), 1)
    for field in candidate_fields:
        if field not in frame.columns:
            dropped.append(field)
            continue
        valid_ratio = frame[field].notna().sum() / row_count
        if valid_ratio < MIN_VALID_RATIO or not _has_variation(frame[field]):
            dropped.append(field)
            continue
        selected.append(field)
    return selected


def build_feature_matrix(
    snapshots: list[SnapshotFeatureRecord],
) -> FeatureMatrix:
    records = [
        normalize_record_for_features(snapshot.feature_dict())
        for snapshot in snapshots
    ]
    dropped: list[str] = []
    if not records:
        return FeatureMatrix(
            matrix=np.empty((0, 0)),
            records=[],
            used_feature_names=[],
            dropped_feature_names=[*NUMERIC_FIELDS, *CATEGORICAL_FIELDS, *BOOLEAN_FIELDS],
            selected_numeric_fields=[],
            selected_categorical_fields=[],
            selected_boolean_fields=[],
        )

    frame = pd.DataFrame(records)
    selected_numeric = _select_fields(frame, NUMERIC_FIELDS, dropped=dropped)
    selected_categorical = _select_fields(frame, CATEGORICAL_FIELDS, dropped=dropped)
    selected_boolean = _select_fields(frame, BOOLEAN_FIELDS, dropped=dropped)

    for field in selected_boolean:
        frame[f"{field}__missing"] = frame[field].isna().astype(float)
        frame[field] = frame[field].map({True: 1.0, False: 0.0})

    numeric_pipeline = Pipeline(
        steps=[
            ("imputer", SimpleImputer(strategy="median")),
            ("scaler", RobustScaler()),
        ],
    )
    categorical_pipeline = Pipeline(
        steps=[
            ("imputer", SimpleImputer(strategy="constant", fill_value="__MISSING__")),
            ("onehot", _encoder()),
        ],
    )

    transformers: list[tuple[str, Pipeline, list[str]]] = []
    numeric_columns = [*selected_numeric, *selected_boolean]
    missing_columns = [f"{field}__missing" for field in selected_boolean]
    if numeric_columns or missing_columns:
        transformers.append(("numeric", numeric_pipeline, [*numeric_columns, *missing_columns]))
    if selected_categorical:
        transformers.append(("categorical", categorical_pipeline, selected_categorical))

    if not transformers:
        return FeatureMatrix(
            matrix=np.empty((len(records), 0)),
            records=records,
            used_feature_names=[],
            dropped_feature_names=dropped,
            selected_numeric_fields=[],
            selected_categorical_fields=[],
            selected_boolean_fields=[],
        )

    transformer = ColumnTransformer(transformers=transformers, remainder="drop")
    matrix = transformer.fit_transform(frame)
    if hasattr(matrix, "toarray"):
        matrix = matrix.toarray()
    matrix = np.nan_to_num(np.asarray(matrix, dtype=float), nan=0.0, posinf=0.0, neginf=0.0)

    feature_names: list[str] = []
    if numeric_columns or missing_columns:
        feature_names.extend([*numeric_columns, *missing_columns])
    if selected_categorical:
        onehot = transformer.named_transformers_["categorical"].named_steps["onehot"]
        feature_names.extend(str(name) for name in onehot.get_feature_names_out(selected_categorical))

    return FeatureMatrix(
        matrix=matrix,
        records=records,
        used_feature_names=feature_names,
        dropped_feature_names=dropped,
        selected_numeric_fields=selected_numeric,
        selected_categorical_fields=selected_categorical,
        selected_boolean_fields=selected_boolean,
    )
