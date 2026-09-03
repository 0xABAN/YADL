from pathlib import Path

import numpy as np

from backend.train.data import HandDataset, HandSample
from backend.train.model import HandSignClassifier
from backend.train.trainer import TrainingConfig, train_classifier


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
    assert HandSignClassifier.load(artifact, device="cpu").predict(
        _hand("open", 99), handedness="Right"
    ).label == "open"
