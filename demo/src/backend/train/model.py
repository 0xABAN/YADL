from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import torch
from torch import nn

from .device import select_device
from .preprocess import canonicalize

PREPROCESSING = {
    "landmark_count": 21,
    "coordinate_order": ["x", "y", "z"],
    "feature_count": 65,
    "translation": "wrist_origin",
    "scale": "mean_wrist_to_mcp_5_9_13_17",
    "rotation": "middle_mcp_axis_with_sin_cos_retained",
    "handedness": "geometric_chirality",
}


class HandMLP(nn.Module):
    def __init__(self, *, input_dim: int, hidden_dim: int, class_count: int) -> None:
        super().__init__()
        self.hidden = nn.Linear(input_dim, hidden_dim)
        self.output = nn.Linear(hidden_dim, class_count)

    def forward(self, features: torch.Tensor) -> torch.Tensor:
        return self.output(torch.relu(self.hidden(features)))


@dataclass(frozen=True)
class Prediction:
    label: str
    confidence: float
    probabilities: dict[str, float]


class HandSignClassifier:
    def __init__(
        self, model: HandMLP, classes: Sequence[str], device: torch.device
    ) -> None:
        self.model = model.eval()
        self.classes = tuple(classes)
        self.device = device

    @classmethod
    def load(cls, path: Path, *, device: str = "auto") -> HandSignClassifier:
        target = select_device(device, require_accelerator=False)
        artifact = torch.load(path, map_location=target, weights_only=True)
        config = artifact["model"]
        model = HandMLP(
            input_dim=config["input_dim"],
            hidden_dim=config["hidden_dim"],
            class_count=len(artifact["classes"]),
        ).to(target)
        model.load_state_dict(artifact["state_dict"])
        return cls(model, artifact["classes"], target)

    def predict(
        self, landmarks: np.ndarray, *, handedness: str | None = None
    ) -> Prediction:
        features = canonicalize(landmarks, handedness=handedness)
        inputs = torch.from_numpy(features).to(self.device).unsqueeze(0)
        with torch.inference_mode():
            probabilities = torch.softmax(self.model(inputs), dim=1)[0].cpu().numpy()
        best = int(np.argmax(probabilities))
        return Prediction(
            self.classes[best],
            float(probabilities[best]),
            dict(zip(self.classes, (float(value) for value in probabilities), strict=True)),
        )


def save_artifact(
    model: HandMLP, path: Path, *, classes: Sequence[str]
) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    torch.save(
        {
            "format_version": 1,
            "classes": list(classes),
            "preprocessing": PREPROCESSING,
            "model": {
                "input_dim": model.hidden.in_features,
                "hidden_dim": model.hidden.out_features,
            },
            "state_dict": model.state_dict(),
        },
        path,
    )
