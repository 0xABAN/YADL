from pathlib import Path

import numpy as np
import torch

from backend.train.model import HandMLP, HandSignClassifier, save_artifact


def _hand() -> np.ndarray:
    rng = np.random.default_rng(4)
    hand = rng.normal(size=(21, 3)).astype(np.float32)
    hand[0] = 0
    hand[5, :2] = (-0.5, 1.0)
    hand[9, :2] = (0.0, 1.2)
    hand[13, :2] = (0.4, 1.0)
    hand[17, :2] = (0.8, 0.7)
    return hand


def test_artifact_round_trip_exposes_raw_landmark_inference(tmp_path: Path) -> None:
    classes = ("fist", "open")
    model = HandMLP(input_dim=65, hidden_dim=8, class_count=len(classes))
    with torch.no_grad():
        for parameter in model.parameters():
            parameter.zero_()
        model.output.bias[:] = torch.tensor([-2.0, 2.0])
    path = tmp_path / "model.pt"

    save_artifact(model, path, classes=classes)
    classifier = HandSignClassifier.load(path, device="cpu")
    prediction = classifier.predict(_hand(), handedness="Left")

    assert prediction.label == "open"
    assert prediction.confidence > 0.95
    assert tuple(prediction.probabilities) == classes
    artifact = torch.load(path, map_location="cpu", weights_only=True)
    assert artifact["classes"] == list(classes)
    assert artifact["preprocessing"]["feature_count"] == 65
    assert artifact["preprocessing"]["handedness"] == "geometric_chirality"
