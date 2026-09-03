from __future__ import annotations

import os
import tempfile
from collections.abc import Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Any

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
        self,
        model: HandMLP,
        classes: Sequence[str],
        device: torch.device,
        *,
        format_version: int = 1,
        temperature: float = 1.0,
        validation: dict[str, Any] | None = None,
        decision: dict[str, Any] | None = None,
        provenance: dict[str, Any] | None = None,
    ) -> None:
        self.model = model.eval()
        self.classes = tuple(classes)
        self.device = device
        self.format_version = format_version
        self.temperature = temperature
        self.validation = dict(validation or {})
        self.decision = dict(decision or {})
        self.provenance = dict(provenance or {})
        self.live_approved = bool(
            format_version >= 2
            and self.validation.get("approved")
            and "neutral" in self.classes
        )

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
        temperature = float(artifact.get("calibration", {}).get("temperature", 1.0))
        if temperature <= 0:
            raise ValueError("artifact calibration temperature must be positive")
        return cls(
            model,
            artifact["classes"],
            target,
            format_version=int(artifact.get("format_version", 1)),
            temperature=temperature,
            validation=artifact.get("validation"),
            decision=artifact.get("decision"),
            provenance=artifact.get("provenance"),
        )

    def predict(
        self, landmarks: np.ndarray, *, handedness: str | None = None
    ) -> Prediction:
        features = canonicalize(landmarks, handedness=handedness)
        inputs = torch.from_numpy(features).to(self.device).unsqueeze(0)
        with torch.inference_mode():
            probabilities = (
                torch.softmax(self.model(inputs) / self.temperature, dim=1)[0]
                .cpu()
                .numpy()
            )
        best = int(np.argmax(probabilities))
        return Prediction(
            self.classes[best],
            float(probabilities[best]),
            dict(
                zip(
                    self.classes, (float(value) for value in probabilities), strict=True
                )
            ),
        )


def save_artifact(
    model: HandMLP,
    path: Path,
    *,
    classes: Sequence[str],
    temperature: float | None = None,
    validation: dict[str, Any] | None = None,
    decision: dict[str, Any] | None = None,
    provenance: dict[str, Any] | None = None,
) -> None:
    if temperature is not None and temperature <= 0:
        raise ValueError("calibration temperature must be positive")
    path.parent.mkdir(parents=True, exist_ok=True)
    artifact: dict[str, Any] = {
        "format_version": 2 if validation is not None else 1,
        "classes": list(classes),
        "preprocessing": PREPROCESSING,
        "model": {
            "input_dim": model.hidden.in_features,
            "hidden_dim": model.hidden.out_features,
        },
        "state_dict": model.state_dict(),
    }
    if temperature is not None:
        artifact["calibration"] = {"temperature": temperature}
    if validation is not None:
        artifact["validation"] = validation
    if decision is not None:
        artifact["decision"] = decision
    if provenance is not None:
        artifact["provenance"] = provenance
    _atomic_torch_save(artifact, path)


def update_artifact_metadata(
    path: Path,
    *,
    validation: dict[str, Any] | None = None,
    decision: dict[str, Any] | None = None,
    provenance: dict[str, Any] | None = None,
) -> None:
    artifact = torch.load(path, map_location="cpu", weights_only=True)
    if validation is not None:
        artifact["validation"] = {**artifact.get("validation", {}), **validation}
    if decision is not None:
        artifact["decision"] = decision
    if provenance is not None:
        artifact["provenance"] = {**artifact.get("provenance", {}), **provenance}
    artifact["format_version"] = max(2, int(artifact.get("format_version", 1)))
    _atomic_torch_save(artifact, path)


def _atomic_torch_save(artifact: dict[str, Any], path: Path) -> None:
    descriptor, temporary_name = tempfile.mkstemp(
        prefix=f".{path.name}.", dir=path.parent
    )
    os.close(descriptor)
    temporary = Path(temporary_name)
    try:
        torch.save(artifact, temporary)
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)
