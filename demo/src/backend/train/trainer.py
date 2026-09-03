from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

import numpy as np
import torch
from torch import nn

from .augment import balance_with_jitter
from .data import HandDataset
from .device import select_device
from .model import HandMLP, save_artifact
from .preprocess import canonicalize
from .split import split_by_episode


@dataclass(frozen=True)
class TrainingConfig:
    epochs: int = 600
    target_per_class: int = 96
    seed: int = 7
    hidden_dim: int = 64
    learning_rate: float = 0.01
    weight_decay: float = 0.0001


@dataclass(frozen=True)
class TrainingResult:
    device: str
    training_samples: int
    augmented_training_samples: int
    validation_samples: int
    validated_classes: tuple[str, ...]
    unvalidated_classes: tuple[str, ...]
    training_accuracy: float
    validation_accuracy: float | None
    validation_macro_f1: float | None
    accelerator_verified: bool


def train_classifier(
    dataset: HandDataset,
    artifact_path: Path,
    *,
    config: TrainingConfig | None = None,
    device_name: str = "auto",
    require_accelerator: bool = True,
) -> TrainingResult:
    config = config or TrainingConfig()
    if not dataset.samples or len(dataset.classes) < 2:
        raise ValueError("training requires samples from at least two classes")
    device = select_device(device_name, require_accelerator=require_accelerator)
    torch.manual_seed(config.seed)
    np.random.seed(config.seed)

    split = split_by_episode(dataset.samples, classes=dataset.classes)
    features = np.stack(
        [
            canonicalize(sample.landmarks, handedness=sample.handedness)
            for sample in dataset.samples
        ]
    )
    label_ids = np.asarray(
        [dataset.classes.index(sample.label) for sample in dataset.samples],
        dtype=np.int64,
    )
    train_x = features[list(split.train_indices)]
    train_y = label_ids[list(split.train_indices)]
    balanced_x, balanced_y = balance_with_jitter(
        train_x,
        train_y,
        target_per_class=max(config.target_per_class, int(np.bincount(train_y).max())),
        seed=config.seed,
    )

    model = HandMLP(
        input_dim=features.shape[1],
        hidden_dim=config.hidden_dim,
        class_count=len(dataset.classes),
    ).to(device)
    inputs = torch.from_numpy(balanced_x).to(device)
    targets = torch.from_numpy(balanced_y).to(device)
    optimizer = torch.optim.AdamW(
        model.parameters(),
        lr=config.learning_rate,
        weight_decay=config.weight_decay,
    )
    for _ in range(config.epochs):
        optimizer.zero_grad(set_to_none=True)
        loss = nn.functional.cross_entropy(model(inputs), targets)
        loss.backward()
        optimizer.step()

    def predictions(indices: tuple[int, ...]) -> np.ndarray:
        if not indices:
            return np.empty(0, dtype=np.int64)
        batch = torch.from_numpy(features[list(indices)]).to(device)
        with torch.inference_mode():
            return model(batch).argmax(dim=1).cpu().numpy()

    train_predictions = predictions(split.train_indices)
    train_targets = label_ids[list(split.train_indices)]
    training_accuracy = float(np.mean(train_predictions == train_targets))
    validation_predictions = predictions(split.validation_indices)
    validation_targets = label_ids[list(split.validation_indices)]
    validation_accuracy = (
        float(np.mean(validation_predictions == validation_targets))
        if len(validation_targets)
        else None
    )
    validated_ids = [dataset.classes.index(label) for label in split.validated_classes]
    f1_scores: list[float] = []
    for label_id in validated_ids:
        true_positive = int(
            np.sum((validation_predictions == label_id) & (validation_targets == label_id))
        )
        false_positive = int(
            np.sum((validation_predictions == label_id) & (validation_targets != label_id))
        )
        false_negative = int(
            np.sum((validation_predictions != label_id) & (validation_targets == label_id))
        )
        denominator = 2 * true_positive + false_positive + false_negative
        f1_scores.append(2 * true_positive / denominator if denominator else 0.0)

    save_artifact(model, artifact_path, classes=dataset.classes)
    accelerator_verified = next(model.parameters()).device.type in {"mps", "cuda"}
    return TrainingResult(
        device.type,
        len(split.train_indices),
        len(balanced_y),
        len(split.validation_indices),
        split.validated_classes,
        split.unvalidated_classes,
        training_accuracy,
        validation_accuracy,
        float(np.mean(f1_scores)) if f1_scores else None,
        accelerator_verified,
    )
