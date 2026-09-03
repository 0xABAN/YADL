from pathlib import Path

import numpy as np
import torch

from backend.train.model import (
    HandMLP,
    HandSignClassifier,
    save_artifact,
    update_artifact_metadata,
)


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
    assert not classifier.live_approved


def test_validated_artifact_exposes_calibration_and_live_approval(
    tmp_path: Path,
) -> None:
    classes = ("fist", "neutral")
    model = HandMLP(input_dim=65, hidden_dim=8, class_count=2)
    path = tmp_path / "model.pt"

    save_artifact(
        model,
        path,
        classes=classes,
        temperature=1.7,
        validation={"approved": True, "fist_precision": 0.995},
        decision={"enter_confidence": 0.98, "enter_margin": 0.35},
        provenance={"project_id": "project-1", "sample_count": 42},
    )
    classifier = HandSignClassifier.load(path, device="cpu")

    assert classifier.format_version == 2
    assert classifier.live_approved
    assert classifier.temperature == 1.7
    assert classifier.validation["fist_precision"] == 0.995
    assert classifier.decision["enter_margin"] == 0.35
    assert classifier.provenance["project_id"] == "project-1"


def test_artifact_metadata_update_preserves_weights_and_merges_validation(
    tmp_path: Path,
) -> None:
    model = HandMLP(input_dim=65, hidden_dim=8, class_count=2)
    path = tmp_path / "model.pt"
    save_artifact(
        model,
        path,
        classes=("fist", "neutral"),
        validation={"approved": True, "macro_f1": 0.95},
    )

    update_artifact_metadata(
        path,
        validation={"threshold_fist_precision": 1.0},
        decision={"enter_confidence": 0.985},
        provenance={"project_id": "project-1"},
    )
    loaded = HandSignClassifier.load(path, device="cpu")

    assert loaded.validation == {
        "approved": True,
        "macro_f1": 0.95,
        "threshold_fist_precision": 1.0,
    }
    assert loaded.decision["enter_confidence"] == 0.985
    assert loaded.provenance["project_id"] == "project-1"
