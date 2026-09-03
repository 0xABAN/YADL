from __future__ import annotations

import numpy as np


def canonicalize(landmarks: np.ndarray, *, handedness: str | None) -> np.ndarray:
    """Return a flattened hand landmark vector in canonical coordinates."""
    points = np.asarray(landmarks, dtype=np.float32)
    if points.shape != (21, 3) or not np.isfinite(points).all():
        raise ValueError("landmarks must be 21 finite xyz points")
    points = points.copy()
    points -= points[0]

    palm = points[[5, 9, 13, 17]]
    scale = float(np.linalg.norm(palm, axis=1).mean())
    if scale <= np.finfo(np.float32).eps:
        raise ValueError("landmarks have zero palm scale")
    points /= scale

    axis = points[9, :2]
    angle = float(np.arctan2(axis[0], axis[1]))
    cosine, sine = np.cos(angle), np.sin(angle)
    rotation = np.array([[cosine, -sine], [sine, cosine]], dtype=np.float32)
    points[:, :2] = points[:, :2] @ rotation.T
    if points[5, 0] > points[17, 0]:
        points[:, 0] *= -1
        sine *= -1
    orientation = np.array([sine, cosine], dtype=np.float32)
    return np.concatenate((points.reshape(-1), orientation))
