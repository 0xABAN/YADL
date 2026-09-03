from pathlib import Path

import numpy as np
import pytest
import torch

from backend.serve.calibration import CalibrationRecord, write_session
from backend.serve.decision import DecisionPolicy
from backend.serve.setup import (
    SetupOptions,
    benchmark_inference,
    build_capture_schedule,
    evaluate_temporal,
    setup_service,
    threshold_samples,
)
from backend.train.data import HandDataset
from backend.train.model import HandMLP, Prediction, save_artifact
from backend.train.trainer import TrainingResult


def test_validation_schedule_includes_ten_minute_neutral_soak() -> None:
    schedule = build_capture_schedule(
        ("fist", "open"),
        gesture_seconds=3,
        neutral_seconds=20,
        repetitions=2,
    )

    assert schedule.steps[0].label == "neutral"
    assert schedule.steps[0].duration_ms == 20_000
    assert [step.label for step in schedule.steps[1:]] == [
        "fist",
        "neutral",
        "open",
        "neutral",
        "fist",
        "neutral",
        "open",
        "neutral",
    ]
    assert schedule.steps[-1].duration_ms == 1_000


class Classifier:
    def predict(self, landmarks, *, handedness=None):
        return Prediction("fist", 0.99, {"fist": 0.99, "neutral": 0.01})


def test_threshold_samples_use_only_detected_landmarks() -> None:
    records = (
        CalibrationRecord("validation", "fist-1", 1, "fist", np.ones((21, 3))),
        CalibrationRecord("validation", "neutral-1", 2, "neutral", None),
    )

    samples = threshold_samples(records, Classifier())

    assert len(samples) == 1
    assert samples[0].expected == "fist"
    assert samples[0].margin == 0.98


def test_setup_approves_exact_trained_artifact_after_calibration(
    tmp_path: Path,
    capsys: pytest.CaptureFixture[str],
) -> None:
    model_path = tmp_path / "model.pt"
    config_path = tmp_path / "config.json"
    landmarker_path = tmp_path / "hand.task"
    landmarker_path.write_bytes(b"task")
    project = HandDataset(("fist", "open"), ())
    pauses = []

    def capture(path, *, session_id, schedule, **kwargs):
        records = tuple(
            CalibrationRecord(
                session_id,
                f"{index:02d}-{step.label}",
                index * 180 + offset,
                step.label,
                np.full((21, 3), 1 if step.label == "fist" else 2, dtype=np.float32),
                kwargs.get("partition", "train"),
            )
            for index, step in enumerate(schedule.steps)
            for offset in (0, 60, 120)
        )
        write_session(path, records)
        return records

    def train(dataset, output, *, config, device_name):
        save_artifact(
            HandMLP(input_dim=65, hidden_dim=8, class_count=len(dataset.classes)),
            output,
            classes=dataset.classes,
            validation={"approved": True, "macro_f1": 1.0},
        )
        return TrainingResult(
            "mps",
            10,
            20,
            10,
            dataset.classes,
            (),
            1.0,
            1.0,
            1.0,
            1.0,
            {label: 1.0 for label in dataset.classes},
            {label: 1.0 for label in dataset.classes},
            True,
            1.0,
            True,
        )

    class LiveClassifier:
        def predict(self, landmarks, *, handedness=None):
            label = "fist" if landmarks[0, 0] == 1 else "neutral"
            return Prediction(label, 0.995, {label: 0.995, "other": 0.005})

    config = setup_service(
        SetupOptions(
            project_id="project-1",
            env_file=tmp_path / ".env",
            model_path=model_path,
            landmarker_path=landmarker_path,
            config_path=config_path,
            neutral_seconds=1,
            soak_seconds=1,
            gesture_seconds=1,
            repetitions=1,
        ),
        project_loader=lambda project_id, env_file: project,
        capture=capture,
        trainer=train,
        classifier_loader=lambda path, device: LiveClassifier(),
        pause=lambda prompt: pauses.append(prompt) or "",
        mps_available=lambda: True,
    )

    assert config.live_ready()
    assert str(config.bindings["fist"].shortcut) == "fn"
    assert config.policy.enter_confidence == 0.995
    assert config_path.exists()
    artifact = torch.load(model_path, map_location="cpu", weights_only=True)
    assert artifact["validation"]["temporal_false_activations"] == 0
    assert artifact["validation"]["activation_p95_ms"] <= 150
    assert len(pauses) == 1
    output = capsys.readouterr().out
    assert "MediaPipe I/W lines are diagnostics, not setup failures" in output
    assert "Step 1/3: capturing training landmarks" in output
    assert "Step 2/3: capturing independent validation landmarks" in output
    assert "Step 3/3: training and validating on MPS" in output


def test_setup_preserves_approved_artifact_when_later_gate_fails(
    tmp_path: Path,
) -> None:
    model_path = tmp_path / "model.pt"
    model_path.write_bytes(b"previous-approved-artifact")
    landmarker_path = tmp_path / "hand.task"
    landmarker_path.write_bytes(b"task")
    project = HandDataset(("fist",), ())

    def capture(path, *, session_id, schedule, **kwargs):
        records = tuple(
            CalibrationRecord(
                session_id,
                f"{index:02d}-{step.label}",
                index * 200,
                step.label,
                np.ones((21, 3), dtype=np.float32),
                kwargs.get("partition", "train"),
            )
            for index, step in enumerate(schedule.steps)
        )
        write_session(path, records)
        return records

    def train(dataset, output, *, config, device_name):
        save_artifact(
            HandMLP(input_dim=65, hidden_dim=8, class_count=len(dataset.classes)),
            output,
            classes=dataset.classes,
            validation={"approved": True},
        )
        return TrainingResult(
            "mps",
            2,
            2,
            2,
            dataset.classes,
            (),
            1.0,
            1.0,
            1.0,
            1.0,
            {label: 1.0 for label in dataset.classes},
            {label: 1.0 for label in dataset.classes},
            True,
            1.0,
            True,
        )

    with pytest.raises(ValueError, match="thresholds"):
        setup_service(
            SetupOptions(
                project_id="project-1",
                env_file=tmp_path / ".env",
                model_path=model_path,
                landmarker_path=landmarker_path,
                config_path=tmp_path / "config.json",
                neutral_seconds=1,
                soak_seconds=1,
                gesture_seconds=1,
                repetitions=1,
            ),
            project_loader=lambda project_id, env_file: project,
            capture=capture,
            trainer=train,
            classifier_loader=lambda path, device: Classifier(),
            pause=lambda prompt: "",
            mps_available=lambda: True,
        )

    assert model_path.read_bytes() == b"previous-approved-artifact"
    assert not tuple(tmp_path.glob("*.candidate"))


def test_setup_rejects_poor_training_detection_before_validation(
    tmp_path: Path,
) -> None:
    landmarker_path = tmp_path / "hand.task"
    landmarker_path.write_bytes(b"task")
    records = tuple(
        CalibrationRecord(
            "train",
            "fist-1",
            index,
            "fist",
            np.ones((21, 3), dtype=np.float32) if index == 0 else None,
        )
        for index in range(3)
    )

    with pytest.raises(RuntimeError, match=r"training.*fist: 1/3"):
        setup_service(
            SetupOptions(
                project_id="project-1",
                env_file=tmp_path / ".env",
                model_path=tmp_path / "model.pt",
                landmarker_path=landmarker_path,
                config_path=tmp_path / "config.json",
                neutral_seconds=1,
                soak_seconds=1,
                gesture_seconds=1,
                repetitions=1,
            ),
            project_loader=lambda project_id, env_file: HandDataset(("fist",), ()),
            capture=lambda *args, **kwargs: records,
            pause=lambda prompt: (_ for _ in ()).throw(
                AssertionError("validation prompt must not be reached")
            ),
            mps_available=lambda: True,
        )


class SequenceClassifier:
    def predict(self, landmarks, *, handedness=None):
        label = "fist" if landmarks[0, 0] == 1 else "neutral"
        return Prediction(label, 0.99, {label: 0.99, "other": 0.01})


def test_temporal_evaluation_measures_episode_activation_release_and_stuck_keys() -> (
    None
):
    hand = np.ones((21, 3), dtype=np.float32)
    neutral = np.full((21, 3), 2, dtype=np.float32)
    records = tuple(
        CalibrationRecord("v", episode, timestamp, label, landmarks, "validation")
        for episode, timestamp, label, landmarks in (
            ("fist-1", 0, "fist", hand),
            ("fist-1", 60, "fist", hand),
            ("fist-1", 120, "fist", hand),
            ("neutral-1", 180, "neutral", neutral),
            ("neutral-1", 280, "neutral", neutral),
        )
    )

    report = evaluate_temporal(
        records,
        SequenceClassifier(),
        DecisionPolicy(enter_ms=120, release_ms=100, minimum_observations=3),
    )

    assert report.false_activations == 0
    assert report.fist_episode_recall == 1.0
    assert report.activation_p95_ms == 120
    assert report.release_p95_ms == 100
    assert not report.stuck_active


def test_inference_benchmark_reports_p95_latency() -> None:
    records = (
        CalibrationRecord("v", "fist", 0, "fist", np.ones((21, 3))),
        CalibrationRecord("v", "fist", 1, "fist", np.ones((21, 3))),
    )
    ticks = iter((0, 10_000_000, 20_000_000, 40_000_000))

    latency = benchmark_inference(
        records,
        SequenceClassifier(),
        warmup=0,
        sample_limit=2,
        clock_ns=lambda: next(ticks),
    )

    assert latency == 19.5
