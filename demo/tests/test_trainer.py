from pathlib import Path

import numpy as np

from backend.train.data import HandDataset, HandSample
from backend.train.model import HandSignClassifier
from backend.train.trainer import (
    TrainingConfig,
    classification_metrics,
    fit_temperature,
    train_classifier,
)


def _hand(label: str, index: int) -> np.ndarray:
    rng = np.random.default_rng(index)
    hand = rng.normal(0, 0.005, size=(21, 3)).astype(np.float32)
    hand[5] += (-0.5, 1.0, 0.0)
    hand[9] += (0.0, 1.2, 0.0)
    hand[13] += (0.4, 1.0, 0.0)
    hand[17] += (0.8, 0.7, 0.0)
    hand[4, 0] += -1.5 if label == "fist" else 1.5
    return hand


def test_train_classifier_writes_loadable_artifact_with_episode_holdout(
    tmp_path: Path,
) -> None:
    labels = ["fist", "fist", "open", "open", "fist", "fist", "open", "open"]
    samples = tuple(
        HandSample(
            image=f"frame-{index:04d}.jpg",
            label=label,
            landmarks=_hand(label, index),
            handedness="Left" if index % 2 else "Right",
        )
        for index, label in enumerate(labels)
    )
    dataset = HandDataset(("fist", "open"), samples)
    artifact = tmp_path / "model.pt"

    result = train_classifier(
        dataset,
        artifact,
        config=TrainingConfig(epochs=120, target_per_class=8, seed=11),
        device_name="cpu",
        require_accelerator=False,
    )

    assert artifact.exists()
    assert result.device == "cpu"
    assert result.training_samples == 4
    assert result.validation_samples == 4
    assert result.validated_classes == ("fist", "open")
    assert result.unvalidated_classes == ()
    assert result.validation_accuracy >= 0.75
    assert set(result.per_class_recall) == {"fist", "open"}
    assert result.validation_balanced_accuracy is not None
    assert not result.approved
    assert (
        HandSignClassifier.load(artifact, device="cpu")
        .predict(_hand("open", 99), handedness="Right")
        .label
        == "open"
    )


def test_classification_metrics_report_precision_recall_and_balanced_accuracy() -> None:
    metrics = classification_metrics(
        np.array([0, 0, 1, 1]),
        np.array([0, 1, 1, 1]),
        classes=("fist", "neutral"),
    )

    assert metrics["per_class_precision"] == {"fist": 1.0, "neutral": 2 / 3}
    assert metrics["per_class_recall"] == {"fist": 0.5, "neutral": 1.0}
    assert metrics["balanced_accuracy"] == 0.75


def test_temperature_fit_softens_overconfident_validation_logits() -> None:
    logits = np.array([[5.0, 0.0], [5.0, 0.0]], dtype=np.float32)
    targets = np.array([0, 1], dtype=np.int64)

    temperature = fit_temperature(logits, targets)

    assert temperature > 1.0
