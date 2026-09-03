from __future__ import annotations

import numpy as np


def balance_with_jitter(
    features: np.ndarray,
    labels: np.ndarray,
    *,
    target_per_class: int,
    seed: int,
    jitter_std: float = 0.015,
) -> tuple[np.ndarray, np.ndarray]:
    """Deterministically upsample classes with small landmark-space jitter."""
    x = np.asarray(features, dtype=np.float32)
    y = np.asarray(labels, dtype=np.int64)
    rng = np.random.default_rng(seed)
    added_x: list[np.ndarray] = []
    added_y: list[int] = []
    for label in np.unique(y):
        indices = np.flatnonzero(y == label)
        missing = max(0, target_per_class - len(indices))
        for index in rng.choice(indices, size=missing, replace=True):
            noise = rng.normal(0.0, jitter_std, size=x.shape[1]).astype(np.float32)
            added_x.append(x[index] + noise)
            added_y.append(int(label))
    if not added_x:
        return x.copy(), y.copy()
    return (
        np.concatenate((x, np.stack(added_x))),
        np.concatenate((y, np.asarray(added_y, dtype=np.int64))),
    )
