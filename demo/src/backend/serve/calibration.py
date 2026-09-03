from __future__ import annotations

import json
import os
import tempfile
from collections.abc import Callable, Iterable
from dataclasses import dataclass
from pathlib import Path
from queue import Empty, Queue
from typing import Any

import numpy as np

from .vision import (
    CameraCapture,
    LandmarkResult,
    LatestFrameBuffer,
    SingleHandLandmarker,
    require_opencv,
)


@dataclass(frozen=True)
class CalibrationRecord:
    session_id: str
    episode_id: str
    timestamp_ms: int
    label: str
    landmarks: np.ndarray | None
    partition: str = "train"

    def to_dict(self) -> dict[str, Any]:
        return {
            "session_id": self.session_id,
            "episode_id": self.episode_id,
            "timestamp_ms": self.timestamp_ms,
            "label": self.label,
            "partition": self.partition,
            "landmarks": self.landmarks.tolist()
            if self.landmarks is not None
            else None,
        }


@dataclass(frozen=True)
class CaptureStep:
    label: str
    instruction: str
    duration_ms: int


@dataclass(frozen=True)
class ScheduledStep:
    label: str
    instruction: str
    episode_id: str
    remaining_ms: int


class CaptureSchedule:
    def __init__(self, steps: tuple[CaptureStep, ...]) -> None:
        if not steps or any(step.duration_ms <= 0 for step in steps):
            raise ValueError("capture schedule requires positive-duration steps")
        self.steps = steps
        self.total_ms = sum(step.duration_ms for step in steps)

    def at(self, elapsed_ms: int) -> ScheduledStep | None:
        if elapsed_ms < 0:
            raise ValueError("capture time must be non-negative")
        boundary = 0
        for index, step in enumerate(self.steps):
            boundary += step.duration_ms
            if elapsed_ms < boundary:
                return ScheduledStep(
                    step.label,
                    step.instruction,
                    f"{index:02d}-{step.label}",
                    boundary - elapsed_ms,
                )
        return None


def capture_session(
    path: Path,
    *,
    session_id: str,
    schedule: CaptureSchedule,
    camera_index: int,
    landmarker_path: Path,
    partition: str = "train",
    preview: bool = True,
    should_stop: Callable[[list[CalibrationRecord]], bool] | None = None,
    camera_type: Any = CameraCapture,
    landmarker_type: Any = SingleHandLandmarker,
    cv2_module: Any | None = None,
) -> tuple[CalibrationRecord, ...]:
    if partition not in {"train", "validation"}:
        raise ValueError("capture partition must be train or validation")
    if preview and cv2_module is None:
        import cv2 as cv2_module
    if preview:
        require_opencv(
            cv2_module,
            "flip",
            "rectangle",
            "putText",
            "imshow",
            "waitKey",
            "FONT_HERSHEY_SIMPLEX",
            "LINE_AA",
        )
    stop = should_stop or (lambda records: False)
    frames = LatestFrameBuffer()
    results: Queue[LandmarkResult] = Queue()
    camera = None
    landmarker = None
    pending: dict[int, ScheduledStep] = {}
    records: list[CalibrationRecord] = []
    sequence = 0
    first_timestamp_ms: int | None = None
    current: ScheduledStep | None = None
    frame: np.ndarray | None = None
    completed = False
    try:
        camera = camera_type(camera_index, frames)
        landmarker = landmarker_type(landmarker_path, results.put)
        camera.start()
        while not stop(records):
            try:
                sequence, timestamp_ms, frame = frames.wait_after(
                    sequence, timeout=0.02
                )
                if first_timestamp_ms is None:
                    first_timestamp_ms = timestamp_ms
                current = schedule.at(timestamp_ms - first_timestamp_ms)
                if current is None:
                    completed = True
                    break
                pending[timestamp_ms] = current
                landmarker.submit(frame, timestamp_ms)
            except TimeoutError:
                if camera.error is not None:
                    raise camera.error
            try:
                while True:
                    result = results.get_nowait()
                    scheduled = pending.pop(result.timestamp_ms, None)
                    if scheduled is not None:
                        records.append(
                            CalibrationRecord(
                                session_id,
                                scheduled.episode_id,
                                result.timestamp_ms,
                                scheduled.label,
                                result.landmarks,
                                partition,
                            )
                        )
            except Empty:
                pass
            if preview and frame is not None and current is not None:
                canvas = cv2_module.flip(frame, 1)
                seconds = current.remaining_ms / 1_000
                text = f"{current.instruction}  ·  {seconds:.1f} s"
                cv2_module.rectangle(canvas, (12, 12), (680, 62), (20, 20, 20), -1)
                cv2_module.putText(
                    canvas,
                    text,
                    (24, 44),
                    cv2_module.FONT_HERSHEY_SIMPLEX,
                    0.7,
                    (240, 240, 240),
                    2,
                    cv2_module.LINE_AA,
                )
                cv2_module.imshow("YADL Hand Demo · Calibration", canvas)
                if cv2_module.waitKey(1) & 0xFF in {27, ord("q")}:
                    raise KeyboardInterrupt
        if not records:
            raise RuntimeError("calibration captured no landmark results")
        if should_stop is None and not completed:
            raise RuntimeError("calibration ended before the schedule completed")
        write_session(path, records)
        return tuple(records)
    finally:
        try:
            if landmarker is not None:
                landmarker.close()
        finally:
            try:
                if camera is not None:
                    camera.close()
            finally:
                destroy_windows = getattr(cv2_module, "destroyAllWindows", None)
                if preview and destroy_windows is not None:
                    destroy_windows()


@dataclass(frozen=True)
class ThresholdSample:
    expected: str
    predicted: str
    confidence: float
    margin: float


@dataclass(frozen=True)
class ThresholdSelection:
    confidence: float
    margin: float
    precision: float
    recall: float


def write_session(path: Path, records: Iterable[CalibrationRecord]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary_name = tempfile.mkstemp(
        prefix=f".{path.name}.", dir=path.parent
    )
    temporary = Path(temporary_name)
    try:
        with os.fdopen(descriptor, "w") as output:
            for record in records:
                output.write(json.dumps(record.to_dict(), separators=(",", ":")))
                output.write("\n")
        os.chmod(temporary, 0o600)
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


def select_fist_thresholds(
    samples: Iterable[ThresholdSample], *, minimum_precision: float
) -> ThresholdSelection:
    rows = tuple(samples)
    fist_positives = sum(row.expected == "fist" for row in rows)
    candidates = tuple(row for row in rows if row.predicted == "fist")
    if not fist_positives or not candidates:
        raise ValueError("validation needs predicted and expected fist samples")
    selections: list[ThresholdSelection] = []
    for confidence in sorted({row.confidence for row in candidates}):
        for margin in sorted({row.margin for row in candidates}):
            accepted = tuple(
                row
                for row in candidates
                if row.confidence >= confidence and row.margin >= margin
            )
            if not accepted:
                continue
            true_positive = sum(row.expected == "fist" for row in accepted)
            precision = true_positive / len(accepted)
            if precision < minimum_precision:
                continue
            selections.append(
                ThresholdSelection(
                    confidence,
                    margin,
                    precision,
                    true_positive / fist_positives,
                )
            )
    if not selections:
        raise ValueError(
            f"no fist thresholds reached {minimum_precision:.1%} precision"
        )
    return max(
        selections,
        key=lambda value: (
            value.recall,
            value.precision,
            -value.confidence,
            -value.margin,
        ),
    )
