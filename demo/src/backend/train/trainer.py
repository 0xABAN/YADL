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

LIVE_MIN_MACRO_F1 = 0.90
LIVE_MIN_BALANCED_ACCURACY = 0.90
LIVE_MIN_CLASS_RECALL = 0.85
LIVE_MIN_FIST_PRECISION = 0.99


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
    validation_balanced_accuracy: float | None
    per_class_precision: dict[str, float]
    per_class_recall: dict[str, float]
    approved: bool
    temperature: float
    accelerator_verified: bool


def classification_metrics(
    targets: np.ndarray, predictions: np.ndarray, *, classes: tuple[str, ...]
) -> dict[str, object]:
    if len(targets) != len(predictions):
        raise ValueError("targets and predictions must have equal length")
    if not len(targets):
        return {
            "accuracy": None,
            "macro_f1": None,
            "balanced_accuracy": None,
            "per_class_precision": {},
            "per_class_recall": {},
        }
    precision: dict[str, float] = {}
    recall: dict[str, float] = {}
    f1_scores: list[float] = []
    for label_id, label in enumerate(classes):
        true_positive = int(np.sum((predictions == label_id) & (targets == label_id)))
        false_positive = int(np.sum((predictions == label_id) & (targets != label_id)))
        false_negative = int(np.sum((predictions != label_id) & (targets == label_id)))
        label_precision = (
            true_positive / (true_positive + false_positive)
            if true_positive + false_positive
            else 0.0
        )
        label_recall = (
            true_positive / (true_positive + false_negative)
            if true_positive + false_negative
            else 0.0
        )
        precision[label] = label_precision
        recall[label] = label_recall
        denominator = label_precision + label_recall
        f1_scores.append(
            2 * label_precision * label_recall / denominator if denominator else 0.0
        )
    return {
        "accuracy": float(np.mean(predictions == targets)),
        "macro_f1": float(np.mean(f1_scores)),
        "balanced_accuracy": float(np.mean(tuple(recall.values()))),
        "per_class_precision": precision,
        "per_class_recall": recall,
    }


def fit_temperature(logits: np.ndarray, targets: np.ndarray) -> float:
    values = np.asarray(logits, dtype=np.float64)
    labels = np.asarray(targets, dtype=np.int64)
    if values.ndim != 2 or len(values) != len(labels) or not len(labels):
        return 1.0
    candidates = np.geomspace(0.5, 10.0, num=192)
    losses: list[float] = []
    for temperature in candidates:
        scaled = values / temperature
        maximum = scaled.max(axis=1, keepdims=True)
        log_sum_exp = maximum[:, 0] + np.log(np.exp(scaled - maximum).sum(axis=1))
        losses.append(
            float(np.mean(log_sum_exp - scaled[np.arange(len(labels)), labels]))
        )
    return float(candidates[int(np.argmin(losses))])


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

    def logits(indices: tuple[int, ...]) -> np.ndarray:
        if not indices:
            return np.empty((0, len(dataset.classes)), dtype=np.float32)
        batch = torch.from_numpy(features[list(indices)]).to(device)
        with torch.inference_mode():
            return model(batch).cpu().numpy()

    train_logits = logits(split.train_indices)
    train_predictions = train_logits.argmax(axis=1)
    train_targets = label_ids[list(split.train_indices)]
    training_accuracy = float(np.mean(train_predictions == train_targets))
    validation_logits = logits(split.validation_indices)
    validation_predictions = validation_logits.argmax(axis=1)
    validation_targets = label_ids[list(split.validation_indices)]
    temperature = fit_temperature(validation_logits, validation_targets)
    metrics = classification_metrics(
        validation_targets, validation_predictions, classes=dataset.classes
    )
    per_class_precision = dict(metrics["per_class_precision"])
    per_class_recall = dict(metrics["per_class_recall"])
    validation_accuracy = metrics["accuracy"]
    validation_macro_f1 = metrics["macro_f1"]
    validation_balanced_accuracy = metrics["balanced_accuracy"]
    accelerator_verified = next(model.parameters()).device.type in {"mps", "cuda"}
    approved = bool(
        not split.unvalidated_classes
        and "neutral" in dataset.classes
        and validation_macro_f1 is not None
        and validation_macro_f1 >= LIVE_MIN_MACRO_F1
        and validation_balanced_accuracy is not None
        and validation_balanced_accuracy >= LIVE_MIN_BALANCED_ACCURACY
        and per_class_precision.get("fist", 0.0) >= LIVE_MIN_FIST_PRECISION
        and per_class_recall
        and min(per_class_recall.values()) >= LIVE_MIN_CLASS_RECALL
    )
    result = TrainingResult(
        device.type,
        len(split.train_indices),
        len(balanced_y),
        len(split.validation_indices),
        split.validated_classes,
        split.unvalidated_classes,
        training_accuracy,
        validation_accuracy,
        validation_macro_f1,
        validation_balanced_accuracy,
        per_class_precision,
        per_class_recall,
        approved,
        temperature,
        accelerator_verified,
    )
    save_artifact(
        model,
        artifact_path,
        classes=dataset.classes,
        temperature=temperature,
        validation={
            "approved": approved,
            "accuracy": validation_accuracy,
            "macro_f1": validation_macro_f1,
            "balanced_accuracy": validation_balanced_accuracy,
            "per_class_precision": per_class_precision,
            "per_class_recall": per_class_recall,
        },
        decision={
            "enter_confidence": 0.98,
            "enter_margin": 0.35,
            "sustain_confidence": 0.70,
            "enter_ms": 120,
            "release_ms": 100,
            "stale_ms": 200,
            "minimum_observations": 3,
        },
    )
    return result
