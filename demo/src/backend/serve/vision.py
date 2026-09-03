from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from threading import Condition, Event, Thread
from time import monotonic_ns
from typing import Any

import numpy as np


def require_opencv(cv2_module: Any, *symbols: str) -> None:
    missing = tuple(symbol for symbol in symbols if not hasattr(cv2_module, symbol))
    if missing:
        raise RuntimeError(
            "OpenCV installation is incomplete "
            f"(missing {', '.join(missing)}); run "
            "`uv sync --reinstall-package opencv-contrib-python` from demo/"
        )


@dataclass(frozen=True)
class LandmarkResult:
    timestamp_ms: int
    landmarks: np.ndarray | None


class LatestFrameBuffer:
    def __init__(self) -> None:
        self._condition = Condition()
        self._sequence = 0
        self._timestamp_ms = 0
        self._frame: np.ndarray | None = None

    def publish(self, timestamp_ms: int, frame: np.ndarray) -> None:
        with self._condition:
            self._sequence += 1
            self._timestamp_ms = timestamp_ms
            self._frame = frame
            self._condition.notify_all()

    def wait_after(
        self, sequence: int, *, timeout: float
    ) -> tuple[int, int, np.ndarray]:
        with self._condition:
            if self._sequence <= sequence:
                self._condition.wait(timeout)
            if self._sequence <= sequence or self._frame is None:
                raise TimeoutError("no new camera frame")
            return self._sequence, self._timestamp_ms, self._frame


class CameraCapture:
    def __init__(
        self,
        camera_index: int,
        buffer: LatestFrameBuffer,
        *,
        cv2_module: Any | None = None,
        clock_ms: Callable[[], int] | None = None,
    ) -> None:
        if cv2_module is None:
            import cv2 as cv2_module
        require_opencv(cv2_module, "VideoCapture")
        self._capture = cv2_module.VideoCapture(camera_index)
        if not self._capture.isOpened():
            self._capture.release()
            raise RuntimeError(f"camera {camera_index} could not be opened")
        self._buffer = buffer
        self._clock_ms = clock_ms or (lambda: monotonic_ns() // 1_000_000)
        self._stop = Event()
        self._thread = Thread(target=self._read, name="webcam-capture", daemon=True)
        self.error: RuntimeError | None = None

    def start(self) -> None:
        self._thread.start()

    def close(self) -> None:
        self._stop.set()
        if self._thread.is_alive():
            self._thread.join(timeout=1)
        self._capture.release()

    def _read(self) -> None:
        while not self._stop.is_set():
            ok, frame = self._capture.read()
            if not ok:
                self.error = RuntimeError("camera stopped returning frames")
                return
            self._buffer.publish(self._clock_ms(), frame)


class SingleHandLandmarker:
    def __init__(
        self,
        model_path: str | Path,
        callback: Callable[[LandmarkResult], None],
        *,
        mediapipe_module: Any | None = None,
        base_options_type: Any | None = None,
        vision_module: Any | None = None,
        cv2_module: Any | None = None,
    ) -> None:
        if mediapipe_module is None:
            import mediapipe as mediapipe_module
        if base_options_type is None or vision_module is None:
            from mediapipe.tasks import python as task_python
            from mediapipe.tasks.python import vision as task_vision

            base_options_type = base_options_type or task_python.BaseOptions
            vision_module = vision_module or task_vision
        if cv2_module is None:
            import cv2 as cv2_module
        require_opencv(cv2_module, "cvtColor", "COLOR_BGR2RGB")

        self._mp = mediapipe_module
        self._cv2 = cv2_module
        self._callback = callback
        options = vision_module.HandLandmarkerOptions(
            base_options=base_options_type(model_asset_path=str(model_path)),
            running_mode=vision_module.RunningMode.LIVE_STREAM,
            num_hands=1,
            min_hand_detection_confidence=0.5,
            min_hand_presence_confidence=0.5,
            min_tracking_confidence=0.5,
            result_callback=self._deliver,
        )
        self._landmarker = vision_module.HandLandmarker.create_from_options(options)

    def submit(self, frame: np.ndarray, timestamp_ms: int) -> None:
        rgb = self._cv2.cvtColor(frame, self._cv2.COLOR_BGR2RGB)
        image = self._mp.Image(image_format=self._mp.ImageFormat.SRGB, data=rgb)
        self._landmarker.detect_async(image, timestamp_ms)

    def close(self) -> None:
        self._landmarker.close()

    def _deliver(self, result: Any, _image: Any, timestamp_ms: int) -> None:
        landmarks = None
        if result.hand_landmarks:
            landmarks = np.asarray(
                [[point.x, point.y, point.z] for point in result.hand_landmarks[0]],
                dtype=np.float32,
            )
        self._callback(LandmarkResult(timestamp_ms, landmarks))
