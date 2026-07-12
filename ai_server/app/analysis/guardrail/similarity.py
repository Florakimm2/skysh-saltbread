from __future__ import annotations

import numpy as np
from sklearn.metrics.pairwise import cosine_distances


def cosine_distance_matrix(matrix: np.ndarray) -> np.ndarray:
    if matrix.size == 0:
        return np.empty((matrix.shape[0], matrix.shape[0]))
    distances = cosine_distances(matrix)
    return np.nan_to_num(distances, nan=1.0, posinf=1.0, neginf=1.0)
