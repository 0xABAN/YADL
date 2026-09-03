import json
from pathlib import Path

import numpy as np
import pytest

from backend.serve.calibration import (
    CalibrationRecord,
    CaptureSchedule,
    CaptureStep,
    ThresholdSample,
    capture_session,
    select_fist_thresholds,
    write_session,
)
from backend.serve.vision import LandmarkResult


def test_landmark_session_writes_records_without_image_data(tmp_path: Path) -> None:
    path = tmp_path / "session.jsonl"
    records = (
        CalibrationRecord(
            session_id="train-1",
            episode_id="neutral-1",
            timestamp_ms=10,
            label="neutral",
            landmarks=np.ones((21, 3), dtype=np.float32),
        ),
        CalibrationRecord(
            session_id="train-1",
            episode_id="neutral-1",
            timestamp_ms=20,
            label="neutral",
            landmarks=None,
        ),
    )

    write_session(path, records)

    rows = [json.loads(line) for line in path.read_text().splitlines()]
    assert len(rows[0]["landmarks"]) == 21
    assert rows[1]["landmarks"] is None
    assert rows[0]["partition"] == "train"
    assert all("image" not in row and "frame" not in row for row in rows)


def test_threshold_selection_prefers_precision_without_losing_fist_recall() -> None:
    samples = (
        ThresholdSample("fist", "fist", 0.995, 0.90),
        ThresholdSample("fist", "fist", 0.985, 0.80),
        ThresholdSample("neutral", "fist", 0.970, 0.70),
        ThresholdSample("open", "open", 0.990, 0.80),
    )

    selected = select_fist_thresholds(samples, minimum_precision=0.99)

    assert selected.precision == 1.0
    assert selected.recall == 1.0
    assert selected.confidence > 0.970 or selected.margin > 0.70


def test_capture_schedule_assigns_stable_episode_boundaries() -> None:
    schedule = CaptureSchedule(
        (
            CaptureStep("neutral", "Move naturally", 100),
            CaptureStep("fist", "Hold a fist", 200),
        )
    )

    assert schedule.at(0).label == "neutral"
    assert schedule.at(99).episode_id == "00-neutral"
    assert schedule.at(100).label == "fist"
    assert schedule.at(299).episode_id == "01-fist"
    assert schedule.at(300) is None
    assert schedule.total_ms == 300


class CaptureCamera:
    instance = None

    def __init__(self, index, buffer) -> None:
        self.buffer = buffer
        self.error = None
        self.closed = False
        CaptureCamera.instance = self

    def start(self) -> None:
        self.buffer.publish(10, np.zeros((2, 2, 3), dtype=np.uint8))

    def close(self) -> None:
        self.closed = True


class CaptureLandmarker:
    instance = None

    def __init__(self, path, callback) -> None:
        self.callback = callback
        self.closed = False
        CaptureLandmarker.instance = self

    def submit(self, frame, timestamp_ms: int) -> None:
        self.callback(LandmarkResult(timestamp_ms, np.ones((21, 3))))

    def close(self) -> None:
        self.closed = True


def test_capture_session_records_landmarks_and_closes_devices(tmp_path: Path) -> None:
    path = tmp_path / "capture.jsonl"
    schedule = CaptureSchedule((CaptureStep("neutral", "Move", 1_000),))

    records = capture_session(
        path,
        session_id="session-1",
        schedule=schedule,
        camera_index=0,
        landmarker_path=Path("hand.task"),
        preview=False,
        should_stop=lambda captured: bool(captured),
        camera_type=CaptureCamera,
        landmarker_type=CaptureLandmarker,
    )

    assert records[0].label == "neutral"
    assert json.loads(path.read_text())["session_id"] == "session-1"
    assert CaptureCamera.instance.closed
    assert CaptureLandmarker.instance.closed


def test_capture_session_closes_camera_when_landmarker_init_fails(
    tmp_path: Path,
) -> None:
    class FailingLandmarker:
        def __init__(self, path, callback) -> None:
            raise RuntimeError("bad landmarker")

    with pytest.raises(RuntimeError, match="bad landmarker"):
        capture_session(
            tmp_path / "capture.jsonl",
            session_id="session-1",
            schedule=CaptureSchedule((CaptureStep("neutral", "Move", 1_000),)),
            camera_index=0,
            landmarker_path=Path("hand.task"),
            preview=False,
            camera_type=CaptureCamera,
            landmarker_type=FailingLandmarker,
        )

    assert CaptureCamera.instance.closed


def test_capture_session_does_not_mask_success_when_window_cleanup_is_missing(
    tmp_path: Path,
) -> None:
    class CV2WithoutWindowCleanup:
        FONT_HERSHEY_SIMPLEX = 0
        LINE_AA = 0

        @staticmethod
        def flip(frame, axis):
            return frame

        @staticmethod
        def rectangle(*args):
            pass

        @staticmethod
        def putText(*args):
            pass

        @staticmethod
        def imshow(*args):
            pass

        @staticmethod
        def waitKey(delay):
            return 0

    records = capture_session(
        tmp_path / "capture.jsonl",
        session_id="session-1",
        schedule=CaptureSchedule((CaptureStep("neutral", "Move", 1_000),)),
        camera_index=0,
        landmarker_path=Path("hand.task"),
        preview=True,
        should_stop=lambda captured: bool(captured),
        camera_type=CaptureCamera,
        landmarker_type=CaptureLandmarker,
        cv2_module=CV2WithoutWindowCleanup,
    )

    assert len(records) == 1


def test_capture_session_reports_incomplete_opencv_before_opening_camera(
    tmp_path: Path,
) -> None:
    camera_opened = []

    class NeverCamera:
        def __init__(self, index, buffer) -> None:
            camera_opened.append(True)

    with pytest.raises(RuntimeError, match="reinstall-package opencv-contrib-python"):
        capture_session(
            tmp_path / "capture.jsonl",
            session_id="session-1",
            schedule=CaptureSchedule((CaptureStep("neutral", "Move", 1_000),)),
            camera_index=0,
            landmarker_path=Path("hand.task"),
            preview=True,
            camera_type=NeverCamera,
            landmarker_type=CaptureLandmarker,
            cv2_module=object(),
        )

    assert not camera_opened
