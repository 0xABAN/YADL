from __future__ import annotations

import os
from collections.abc import Callable, Iterable, Sequence
from dataclasses import asdict, dataclass
from pathlib import Path
from time import perf_counter_ns
from typing import Protocol
from uuid import uuid4

import numpy as np
import torch

from backend.train.data import (
    HandDataset,
    load_project_samples,
    merge_datasets,
    samples_from_landmark_records,
)
from backend.train.model import (
    HandSignClassifier,
    Prediction,
    update_artifact_metadata,
)
from backend.train.trainer import TrainingConfig, TrainingResult, train_classifier

from .actions import ActionBinding, Shortcut
from .calibration import (
    CalibrationRecord,
    CaptureSchedule,
    CaptureStep,
    ThresholdSample,
    capture_session,
    select_fist_thresholds,
)
from .config import ServiceConfig, artifact_sha256, save_config
from .decision import DecisionEngine, DecisionPolicy, Observation

INSTRUCTIONS = {
    "neutral": (
        "Move, rest, partly hide, enter, and exit your hand without holding a sign"
    ),
    "thumbs_up": "Hold thumbs up",
    "thumbs_down": "Hold thumbs down",
    "point": "Hold the pointing sign",
    "fist": "Hold a closed fist",
    "open": "Hold the open-hand sign",
    "rock": "Hold the rock sign",
}


class Predictor(Protocol):
    def predict(self, landmarks, *, handedness=None) -> Prediction: ...


@dataclass(frozen=True)
class SetupOptions:
    project_id: str
    env_file: Path
    model_path: Path
    landmarker_path: Path
    config_path: Path
    camera_index: int = 0
    neutral_seconds: int = 30
    soak_seconds: int = 600
    gesture_seconds: int = 3
    repetitions: int = 5
    epochs: int = TrainingConfig.epochs
    target_per_class: int = TrainingConfig.target_per_class
    preview: bool = True


@dataclass(frozen=True)
class TemporalReport:
    false_activations: int
    fist_episode_recall: float
    activation_p95_ms: float
    release_p95_ms: float
    stuck_active: bool


def build_capture_schedule(
    classes: Sequence[str],
    *,
    gesture_seconds: int,
    neutral_seconds: int,
    repetitions: int,
) -> CaptureSchedule:
    if gesture_seconds <= 0 or neutral_seconds <= 0 or repetitions <= 0:
        raise ValueError("capture durations and repetitions must be positive")
    gestures = tuple(label for label in classes if label != "neutral")
    steps = [CaptureStep("neutral", INSTRUCTIONS["neutral"], neutral_seconds * 1_000)]
    for _ in range(repetitions):
        for label in gestures:
            steps.append(
                CaptureStep(
                    label,
                    INSTRUCTIONS.get(label, f"Hold the {label.replace('_', ' ')} sign"),
                    gesture_seconds * 1_000,
                )
            )
            steps.append(
                CaptureStep(
                    "neutral",
                    "Relax your hand before the next sign",
                    1_000,
                )
            )
    return CaptureSchedule(tuple(steps))


def threshold_samples(
    records: Iterable[CalibrationRecord], classifier: Predictor
) -> tuple[ThresholdSample, ...]:
    samples: list[ThresholdSample] = []
    for record in records:
        if record.landmarks is None:
            continue
        prediction = classifier.predict(record.landmarks, handedness=None)
        probabilities = sorted(prediction.probabilities.values(), reverse=True)
        runner_up = probabilities[1] if len(probabilities) > 1 else 0.0
        samples.append(
            ThresholdSample(
                record.label,
                prediction.label,
                prediction.confidence,
                prediction.confidence - runner_up,
            )
        )
    return tuple(samples)


def require_gesture_coverage(
    records: Iterable[CalibrationRecord],
    classes: Sequence[str],
    *,
    phase: str,
    minimum: float = 0.5,
) -> None:
    rows = tuple(records)
    insufficient: list[str] = []
    for label in classes:
        if label == "neutral":
            continue
        expected = tuple(record for record in rows if record.label == label)
        detected = sum(record.landmarks is not None for record in expected)
        if not expected or detected / len(expected) < minimum:
            insufficient.append(f"{label}: {detected}/{len(expected)}")
    if insufficient:
        raise RuntimeError(
            f"{phase} capture detected too few hand landmarks "
            f"(minimum {minimum:.0%} per gesture): {', '.join(insufficient)}. "
            "Keep the hand fully visible in the camera window, then rerun setup."
        )


def evaluate_temporal(
    records: Iterable[CalibrationRecord],
    classifier: Predictor,
    policy: DecisionPolicy,
) -> TemporalReport:
    rows = tuple(sorted(records, key=lambda record: record.timestamp_ms))
    engine = DecisionEngine({"fist": "hold"}, policy)
    fist_starts: dict[str, int] = {}
    activated: set[str] = set()
    activation_latencies: list[int] = []
    release_latencies: list[int] = []
    exit_started_ms: int | None = None
    false_activations = 0
    for record in rows:
        if record.label == "fist":
            fist_starts.setdefault(record.episode_id, record.timestamp_ms)
            exit_started_ms = None
        elif engine.active == "fist" and exit_started_ms is None:
            exit_started_ms = record.timestamp_ms
        prediction = (
            classifier.predict(record.landmarks, handedness=None)
            if record.landmarks is not None
            else None
        )
        if prediction is None:
            observation = None
        else:
            probabilities = sorted(prediction.probabilities.values(), reverse=True)
            runner_up = probabilities[1] if len(probabilities) > 1 else 0.0
            observation = Observation(
                prediction.label,
                prediction.confidence,
                prediction.confidence - runner_up,
            )
        for event in engine.update(record.timestamp_ms, observation):
            if event.kind == "press":
                if record.label == "fist":
                    activated.add(record.episode_id)
                    activation_latencies.append(
                        record.timestamp_ms - fist_starts[record.episode_id]
                    )
                else:
                    false_activations += 1
            elif event.kind == "release" and exit_started_ms is not None:
                release_latencies.append(record.timestamp_ms - exit_started_ms)
                exit_started_ms = None
    if rows:
        engine.tick(rows[-1].timestamp_ms + policy.stale_ms)
    episode_count = len(fist_starts)
    return TemporalReport(
        false_activations,
        len(activated) / episode_count if episode_count else 0.0,
        float(np.percentile(activation_latencies, 95))
        if activation_latencies
        else float("inf"),
        float(np.percentile(release_latencies, 95))
        if release_latencies
        else float("inf"),
        engine.active is not None,
    )


def benchmark_inference(
    records: Iterable[CalibrationRecord],
    classifier: Predictor,
    *,
    warmup: int = 5,
    sample_limit: int = 100,
    clock_ns: Callable[[], int] = perf_counter_ns,
) -> float:
    landmarks = tuple(
        record.landmarks for record in records if record.landmarks is not None
    )
    if not landmarks:
        raise ValueError("inference benchmark needs detected landmarks")
    for index in range(warmup):
        classifier.predict(landmarks[index % len(landmarks)], handedness=None)
    latencies: list[float] = []
    for points in landmarks[:sample_limit]:
        started = clock_ns()
        classifier.predict(points, handedness=None)
        latencies.append((clock_ns() - started) / 1_000_000)
    return float(np.percentile(latencies, 95))


def setup_service(
    options: SetupOptions,
    *,
    project_loader: Callable[..., HandDataset] = load_project_samples,
    capture: Callable[..., tuple[CalibrationRecord, ...]] = capture_session,
    trainer: Callable[..., TrainingResult] = train_classifier,
    classifier_loader: Callable[[Path, str], Predictor] | None = None,
    pause: Callable[[str], str] = input,
    mps_available: Callable[[], bool] | None = None,
) -> ServiceConfig:
    shortcut = Shortcut.parse("fn")
    if not options.landmarker_path.is_file():
        raise ValueError(
            f"MediaPipe landmarker asset is missing: {options.landmarker_path}"
        )
    if not (mps_available or torch.backends.mps.is_available)():
        raise RuntimeError("MPS is unavailable; setup requires Apple GPU acceleration")
    project = project_loader(options.project_id, env_file=options.env_file)
    if "fist" not in project.classes:
        raise ValueError("the YADL project must contain a fist class")
    classes = (
        *project.classes,
        *(("neutral",) if "neutral" not in project.classes else ()),
    )
    capture_dir = options.config_path.parent / "captures"
    run_id = uuid4().hex
    candidate_path = options.model_path.with_name(
        f".{options.model_path.name}.{run_id}.candidate"
    )
    train_path = capture_dir / f"{run_id}-train.jsonl"
    validation_path = capture_dir / f"{run_id}-validation.jsonl"
    training_schedule = build_capture_schedule(
        classes,
        gesture_seconds=options.gesture_seconds,
        neutral_seconds=options.neutral_seconds,
        repetitions=1,
    )
    validation_schedule = build_capture_schedule(
        classes,
        gesture_seconds=options.gesture_seconds,
        neutral_seconds=options.soak_seconds,
        repetitions=options.repetitions,
    )
    print(
        "MediaPipe I/W lines are diagnostics, not setup failures; "
        "actual failures begin with `error:`.",
        flush=True,
    )
    print(
        "Step 1/3: capturing training landmarks in the camera window "
        f"({training_schedule.total_ms // 1_000} seconds).",
        flush=True,
    )
    train_records = capture(
        train_path,
        session_id=f"{run_id}-train",
        schedule=training_schedule,
        camera_index=options.camera_index,
        landmarker_path=options.landmarker_path,
        partition="train",
        preview=options.preview,
    )
    require_gesture_coverage(train_records, classes, phase="training")
    pause(
        "Training capture saved. Press Return here to start independent validation. "
    )
    print(
        "Step 2/3: capturing independent validation landmarks in the camera window "
        f"({validation_schedule.total_ms // 1_000} seconds).",
        flush=True,
    )
    validation_records = capture(
        validation_path,
        session_id=f"{run_id}-validation",
        schedule=validation_schedule,
        camera_index=options.camera_index,
        landmarker_path=options.landmarker_path,
        partition="validation",
        preview=options.preview,
    )
    require_gesture_coverage(validation_records, classes, phase="validation")
    print("Step 3/3: training and validating on MPS.", flush=True)
    captured = samples_from_landmark_records(
        record.to_dict() for record in (*train_records, *validation_records)
    )
    dataset = merge_datasets(project, captured)
    try:
        result = trainer(
            dataset,
            candidate_path,
            config=TrainingConfig(
                epochs=options.epochs,
                target_per_class=options.target_per_class,
            ),
            device_name="mps",
        )
        if not result.accelerator_verified:
            raise RuntimeError("training did not run on MPS")
        if not result.approved:
            raise RuntimeError(
                "model validation gates did not pass; live input remains disabled"
            )
        loader = classifier_loader or (
            lambda path, device: HandSignClassifier.load(path, device=device)
        )
        classifier = loader(candidate_path, "mps")
        inference_p95_ms = benchmark_inference(validation_records, classifier)
        if inference_p95_ms > 50:
            raise RuntimeError(
                f"inference p95 {inference_p95_ms:.1f} ms is above the 50 ms live gate"
            )
        selected = select_fist_thresholds(
            threshold_samples(validation_records, classifier), minimum_precision=0.99
        )
        if selected.recall < 0.95:
            raise RuntimeError(
                f"fist validation recall {selected.recall:.1%} is below the 95% live gate"
            )
        policy = DecisionPolicy(
            enter_confidence=selected.confidence,
            enter_margin=selected.margin,
        )
        temporal = evaluate_temporal(validation_records, classifier, policy)
        temporal_failures = (
            temporal.false_activations > 1,
            temporal.fist_episode_recall < 0.95,
            temporal.activation_p95_ms > 150,
            temporal.release_p95_ms > 150,
            temporal.stuck_active,
        )
        if any(temporal_failures):
            raise RuntimeError(
                "temporal live gates did not pass; "
                f"false activations={temporal.false_activations}, "
                f"fist episode recall={temporal.fist_episode_recall:.1%}, "
                f"activation p95={temporal.activation_p95_ms:.0f} ms, "
                f"release p95={temporal.release_p95_ms:.0f} ms, "
                f"stuck={temporal.stuck_active}"
            )
        update_artifact_metadata(
            candidate_path,
            validation={
                "threshold_fist_precision": selected.precision,
                "threshold_fist_recall": selected.recall,
                "neutral_soak_seconds": options.soak_seconds,
                "temporal_false_activations": temporal.false_activations,
                "fist_episode_recall": temporal.fist_episode_recall,
                "activation_p95_ms": temporal.activation_p95_ms,
                "release_p95_ms": temporal.release_p95_ms,
                "stuck_active": temporal.stuck_active,
                "inference_p95_ms": inference_p95_ms,
            },
            decision=asdict(policy),
            provenance={
                "project_id": options.project_id,
                "sample_count": len(dataset.samples),
                "training_session": train_path.name,
                "validation_session": validation_path.name,
            },
        )
        os.replace(candidate_path, options.model_path)
    finally:
        candidate_path.unlink(missing_ok=True)
    config = ServiceConfig(
        model_path=options.model_path,
        landmarker_path=options.landmarker_path,
        bindings={"fist": ActionBinding("hold", shortcut)},
        policy=policy,
        camera_index=options.camera_index,
        approved_artifact_sha256=artifact_sha256(options.model_path),
    )
    save_config(config, options.config_path)
    return config
