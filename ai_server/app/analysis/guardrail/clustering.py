from __future__ import annotations

from dataclasses import dataclass

import numpy as np
from sklearn.cluster import DBSCAN
from sklearn.metrics import silhouette_score

EPS_CANDIDATES = [0.10, 0.14, 0.18, 0.22, 0.28, 0.34, 0.42, 0.52]


@dataclass(frozen=True)
class ClusterResult:
    labels: list[int]
    cluster_count: int
    noise_count: int
    eps: float | None


def _score_labels(matrix: np.ndarray, labels: np.ndarray) -> float:
    non_noise = labels != -1
    cluster_labels = set(labels[non_noise].tolist())
    if len(cluster_labels) <= 1 or non_noise.sum() <= len(cluster_labels):
        return -1.0
    try:
        return float(silhouette_score(matrix[non_noise], labels[non_noise], metric="cosine"))
    except Exception:
        return -1.0


def find_behavior_clusters(
    matrix: np.ndarray,
    *,
    min_samples: int,
) -> ClusterResult:
    if matrix.shape[0] < max(min_samples * 2, 8) or matrix.shape[1] == 0:
        return ClusterResult(labels=[-1] * matrix.shape[0], cluster_count=0, noise_count=matrix.shape[0], eps=None)

    best: tuple[float, float, np.ndarray] | None = None
    for eps in EPS_CANDIDATES:
        model = DBSCAN(eps=eps, min_samples=min_samples, metric="cosine")
        labels = model.fit_predict(matrix)
        cluster_ids = {int(label) for label in labels if label != -1}
        noise_count = int(np.sum(labels == -1))
        if not cluster_ids:
            continue
        largest_cluster = max(int(np.sum(labels == label)) for label in cluster_ids)
        if len(cluster_ids) == 1 and largest_cluster == len(labels):
            continue
        score = _score_labels(matrix, labels)
        coverage_penalty = abs((len(labels) - noise_count) / len(labels) - 0.65)
        combined = score - coverage_penalty * 0.1
        if best is None or combined > best[0]:
            best = (combined, eps, labels)

    if best is None:
        return ClusterResult(labels=[-1] * matrix.shape[0], cluster_count=0, noise_count=matrix.shape[0], eps=None)

    _, eps, labels = best
    cluster_ids = {int(label) for label in labels if label != -1}
    return ClusterResult(
        labels=[int(label) for label in labels],
        cluster_count=len(cluster_ids),
        noise_count=int(np.sum(labels == -1)),
        eps=eps,
    )
