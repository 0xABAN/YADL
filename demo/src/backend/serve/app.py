from __future__ import annotations

import signal
from collections.abc import Callable
from contextlib import contextmanager
from queue import Empty, Full, Queue
from threading import Event
from time import monotonic_ns
from typing import Any

import numpy as np

from .config import ServiceConfig
from .runtime import GestureRuntime, RuntimeSnapshot
from .vision import (
    CameraCapture,
    LandmarkResult,
    LatestFrameBuffer,
    SingleHandLandmarker,
    require_opencv,
)

HAND_CONNECTIONS = (
    (0, 1),
    (1, 2),
    (2, 3),
    (3, 4),
    (0, 5),
    (5, 6),
    (6, 7),
    (7, 8),
    (5, 9),
    (9, 10),
    (10, 11),
    (11, 12),
    (9, 13),
    (13, 14),
    (14, 15),
    (15, 16),
    (13, 17),
    (0, 17),
    (17, 18),
    (18, 19),
    (19, 20),
)
WINDOW_NAME = "YADL Hand Demo"
ACTION_LABELS = {
    "thumbs_up": "APPROVE",
    "thumbs_down": "DECLINE",
    "point": "SEND MESSAGE",
    "fist": "PUSH TO TALK",
    "rock": "FAST MODE",
    "open": "OPEN NEW CHAT",
}


@contextmanager
def termination_flag(signal_module: Any = signal):
    stopped = Event()
    watched = (signal_module.SIGINT, signal_module.SIGTERM)
    previous = {signum: signal_module.getsignal(signum) for signum in watched}

    def stop(_signum: int, _frame: Any) -> None:
        stopped.set()

    for signum in watched:
        signal_module.signal(signum, stop)
    try:
        yield stopped.is_set
    finally:
        for signum, handler in previous.items():
            signal_module.signal(signum, handler)


def _publish_latest(mailbox: Queue[LandmarkResult], result: LandmarkResult) -> None:
    try:
        mailbox.put_nowait(result)
    except Full:
        try:
            mailbox.get_nowait()
        except Empty:
            pass
        mailbox.put_nowait(result)


def _draw_preview(
    frame: np.ndarray,
    result: LandmarkResult | None,
    snapshot: RuntimeSnapshot | None,
    *,
    live: bool,
    active_shortcut: str | None,
    capture_latency_ms: float,
    cv2_module: Any,
) -> np.ndarray:
    canvas = cv2_module.flip(frame, 1)
    height, width = canvas.shape[:2]
    if result is not None and result.landmarks is not None:
        points = [
            (int((1 - point[0]) * width), int(point[1] * height))
            for point in result.landmarks
        ]
        for start, end in HAND_CONNECTIONS:
            cv2_module.line(canvas, points[start], points[end], (202, 218, 74), 2)
        for point in points:
            cv2_module.circle(canvas, point, 3, (245, 245, 245), -1)
    mode = "Live input" if live else "Dry run"
    state = snapshot.state if snapshot else "waiting"
    label = snapshot.label if snapshot and snapshot.label else "No hand"
    confidence = snapshot.confidence if snapshot else 0.0
    latency = snapshot.inference_ms if snapshot else 0.0
    shortcut = active_shortcut or "No active shortcut"
    lines = (
        f"{mode}  ·  {state}  ·  {shortcut}",
        f"{label}  {confidence:.1%}",
        f"Capture  {capture_latency_ms:.1f} ms  ·  Inference  {latency:.1f} ms",
        "Press Q or Esc to stop",
    )
    cv2_module.rectangle(canvas, (12, 12), (520, 116), (20, 20, 20), -1)
    for index, text in enumerate(lines):
        cv2_module.putText(
            canvas,
            text,
            (24, 36 + index * 24),
            cv2_module.FONT_HERSHEY_SIMPLEX,
            0.55,
            (240, 240, 240),
            1,
            cv2_module.LINE_AA,
        )

    class_label = ACTION_LABELS.get(label, label.replace("_", " ").upper())
    label_scale = max(1.0, min(2.4, height / 480))
    label_thickness = max(2, round(label_scale * 2))
    label_origin = (24, max(24, height - 24))
    (label_width, label_height), label_baseline = cv2_module.getTextSize(
        class_label,
        cv2_module.FONT_HERSHEY_SIMPLEX,
        label_scale,
        label_thickness,
    )
    confidence_text = f"{confidence:.0%}"
    confidence_scale = label_scale * 0.55
    confidence_origin = (label_origin[0] + label_width + 16, label_origin[1])
    (confidence_width, confidence_height), confidence_baseline = (
        cv2_module.getTextSize(
            confidence_text,
            cv2_module.FONT_HERSHEY_SIMPLEX,
            confidence_scale,
            label_thickness,
        )
    )
    cv2_module.rectangle(
        canvas,
        (
            label_origin[0] - 12,
            label_origin[1] - max(label_height, confidence_height) - 8,
        ),
        (
            min(width - 1, confidence_origin[0] + confidence_width + 12),
            label_origin[1] + max(label_baseline, confidence_baseline) + 8,
        ),
        (0, 0, 0),
        -1,
    )
    for text, origin, scale, thickness in (
        (class_label, label_origin, label_scale, label_thickness),
        (confidence_text, confidence_origin, confidence_scale, label_thickness),
    ):
        cv2_module.putText(
            canvas,
            text,
            origin,
            cv2_module.FONT_HERSHEY_SIMPLEX,
            scale,
            (16, 16, 16),
            thickness + 4,
            cv2_module.LINE_AA,
        )
        cv2_module.putText(
            canvas,
            text,
            origin,
            cv2_module.FONT_HERSHEY_SIMPLEX,
            scale,
            (80, 255, 120),
            thickness,
            cv2_module.LINE_AA,
        )
    return canvas


def run_webcam(
    config: ServiceConfig,
    runtime: GestureRuntime,
    *,
    live: bool = False,
    preview: bool = True,
    should_stop: Callable[[], bool] | None = None,
    camera_type: Any = CameraCapture,
    landmarker_type: Any = SingleHandLandmarker,
    cv2_module: Any | None = None,
) -> None:
    with termination_flag() as signal_stop:
        _run_webcam(
            config,
            runtime,
            live=live,
            preview=preview,
            should_stop=should_stop or signal_stop,
            camera_type=camera_type,
            landmarker_type=landmarker_type,
            cv2_module=cv2_module,
        )


def _run_webcam(
    config: ServiceConfig,
    runtime: GestureRuntime,
    *,
    live: bool,
    preview: bool,
    should_stop: Callable[[], bool],
    camera_type: Any,
    landmarker_type: Any,
    cv2_module: Any | None,
) -> None:
    if preview and cv2_module is None:
        import cv2 as cv2_module
    if preview:
        require_opencv(
            cv2_module,
            "flip",
            "line",
            "circle",
            "rectangle",
            "getTextSize",
            "putText",
            "namedWindow",
            "setWindowProperty",
            "imshow",
            "waitKey",
            "getWindowProperty",
            "FONT_HERSHEY_SIMPLEX",
            "LINE_AA",
            "WINDOW_NORMAL",
            "WND_PROP_VISIBLE",
            "WND_PROP_TOPMOST",
        )
        cv2_module.namedWindow(WINDOW_NAME, cv2_module.WINDOW_NORMAL)
        cv2_module.setWindowProperty(
            WINDOW_NAME, cv2_module.WND_PROP_TOPMOST, 1
        )
    frames = LatestFrameBuffer()
    results: Queue[LandmarkResult] = Queue(maxsize=1)
    camera = None
    landmarker = None
    latest_result: LandmarkResult | None = None
    snapshot: RuntimeSnapshot | None = None
    sequence = 0
    frame: np.ndarray | None = None
    try:
        camera = camera_type(config.camera_index, frames)
        landmarker = landmarker_type(
            config.landmarker_path, lambda result: _publish_latest(results, result)
        )
        camera.start()
        while not should_stop():
            try:
                sequence, timestamp_ms, frame = frames.wait_after(
                    sequence, timeout=0.02
                )
                landmarker.submit(frame, timestamp_ms)
            except TimeoutError:
                if camera.error is not None:
                    raise camera.error
            try:
                while True:
                    latest_result = results.get_nowait()
                    snapshot = runtime.process(latest_result)
            except Empty:
                pass
            runtime.tick(monotonic_ns() // 1_000_000)
            if preview and frame is not None:
                active_shortcut = None
                if snapshot is not None and snapshot.active_label in config.bindings:
                    active_shortcut = config.bindings[
                        snapshot.active_label
                    ].description
                capture_latency_ms = (
                    max(0, monotonic_ns() // 1_000_000 - latest_result.timestamp_ms)
                    if latest_result is not None
                    else 0
                )
                canvas = _draw_preview(
                    frame,
                    latest_result,
                    snapshot,
                    live=live,
                    active_shortcut=active_shortcut,
                    capture_latency_ms=capture_latency_ms,
                    cv2_module=cv2_module,
                )
                cv2_module.imshow(WINDOW_NAME, canvas)
                key = cv2_module.waitKey(1) & 0xFF
                window_closed = (
                    cv2_module.getWindowProperty(
                        WINDOW_NAME, cv2_module.WND_PROP_VISIBLE
                    )
                    < 1
                )
                if key in {27, ord("q")} or window_closed:
                    break
    finally:
        try:
            if landmarker is not None:
                landmarker.close()
        finally:
            try:
                if camera is not None:
                    camera.close()
            finally:
                try:
                    runtime.close()
                finally:
                    destroy_windows = getattr(cv2_module, "destroyAllWindows", None)
                    if preview and destroy_windows is not None:
                        destroy_windows()
