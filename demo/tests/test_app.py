from types import SimpleNamespace
from typing import ClassVar

import numpy as np
import pytest

from backend.serve.app import _draw_preview, run_webcam, termination_flag
from backend.serve.vision import LandmarkResult


class Runtime:
    def __init__(self, *, fail: bool = False) -> None:
        self.fail = fail
        self.processed: list[LandmarkResult] = []
        self.closed = False

    def process(self, result: LandmarkResult):
        if self.fail:
            raise RuntimeError("bad inference")
        self.processed.append(result)
        return SimpleNamespace(
            label="fist",
            confidence=0.99,
            margin=0.9,
            state="active",
            active_label="fist",
            inference_ms=1.0,
        )

    def tick(self, timestamp_ms: int) -> None:
        pass

    def close(self) -> None:
        self.closed = True


class Camera:
    instance = None

    def __init__(self, index, buffer) -> None:
        self.buffer = buffer
        self.error = None
        self.closed = False
        Camera.instance = self

    def start(self) -> None:
        self.buffer.publish(10, np.zeros((2, 2, 3), dtype=np.uint8))

    def close(self) -> None:
        self.closed = True


class Landmarker:
    instance = None

    def __init__(self, path, callback) -> None:
        self.callback = callback
        self.closed = False
        Landmarker.instance = self

    def submit(self, frame, timestamp_ms: int) -> None:
        self.callback(LandmarkResult(timestamp_ms, np.ones((21, 3))))

    def close(self) -> None:
        self.closed = True


def _config():
    return SimpleNamespace(camera_index=0, landmarker_path="hand.task")


def test_webcam_loop_processes_latest_result_and_closes_every_owner() -> None:
    runtime = Runtime()

    run_webcam(
        _config(),
        runtime,
        preview=False,
        should_stop=lambda: bool(runtime.processed),
        camera_type=Camera,
        landmarker_type=Landmarker,
    )

    assert len(runtime.processed) == 1
    assert runtime.closed
    assert Camera.instance.closed
    assert Landmarker.instance.closed


def test_webcam_loop_releases_runtime_after_inference_failure() -> None:
    runtime = Runtime(fail=True)

    with pytest.raises(RuntimeError, match="bad inference"):
        run_webcam(
            _config(),
            runtime,
            preview=False,
            should_stop=lambda: False,
            camera_type=Camera,
            landmarker_type=Landmarker,
        )

    assert runtime.closed
    assert Camera.instance.closed
    assert Landmarker.instance.closed


def test_webcam_loop_closes_camera_and_runtime_when_landmarker_init_fails() -> None:
    runtime = Runtime()

    class FailingLandmarker:
        def __init__(self, path, callback) -> None:
            raise RuntimeError("bad landmarker")

    with pytest.raises(RuntimeError, match="bad landmarker"):
        run_webcam(
            _config(),
            runtime,
            preview=False,
            should_stop=lambda: False,
            camera_type=Camera,
            landmarker_type=FailingLandmarker,
        )

    assert runtime.closed
    assert Camera.instance.closed


def test_webcam_loop_releases_runtime_when_camera_init_fails() -> None:
    runtime = Runtime()

    class FailingCamera:
        def __init__(self, index, buffer) -> None:
            raise RuntimeError("bad camera")

    with pytest.raises(RuntimeError, match="bad camera"):
        run_webcam(
            _config(),
            runtime,
            preview=False,
            should_stop=lambda: False,
            camera_type=FailingCamera,
            landmarker_type=Landmarker,
        )

    assert runtime.closed


def test_preview_shows_executed_shortcut_and_both_latencies() -> None:
    class PreviewCV2:
        FONT_HERSHEY_SIMPLEX = 0
        LINE_AA = 0
        texts: ClassVar[list[str]] = []

        @staticmethod
        def flip(frame, axis):
            return frame

        @staticmethod
        def line(*args):
            pass

        @staticmethod
        def circle(*args):
            pass

        @staticmethod
        def rectangle(*args):
            pass

        @staticmethod
        def getTextSize(text, font, scale, thickness):
            return ((int(len(text) * 20 * scale), int(24 * scale)), 0)

        @classmethod
        def putText(cls, canvas, value, *args):
            cls.texts.append(value)

    snapshot = SimpleNamespace(
        state="active",
        label="fist",
        confidence=0.99,
        inference_ms=4.5,
    )

    _draw_preview(
        np.zeros((100, 100, 3), dtype=np.uint8),
        LandmarkResult(10, None),
        snapshot,
        live=True,
        active_shortcut="control+space",
        capture_latency_ms=8.25,
        cv2_module=PreviewCV2,
    )

    text = "\n".join(PreviewCV2.texts)
    assert "control+space" in text
    assert "Capture  8.2 ms" in text
    assert "Inference  4.5 ms" in text


@pytest.mark.parametrize(
    ("class_label", "action_label"),
    (
        ("thumbs_up", "APPROVE"),
        ("thumbs_down", "DECLINE"),
        ("point", "SEND MESSAGE"),
        ("fist", "PUSH TO TALK"),
        ("rock", "FAST MODE"),
        ("open", "OPEN NEW CHAT"),
    ),
)
def test_preview_draws_large_green_action_at_bottom_left(
    class_label: str, action_label: str
) -> None:
    class PreviewCV2:
        FONT_HERSHEY_SIMPLEX = 0
        LINE_AA = 0
        calls: ClassVar[list[tuple]] = []
        rectangles: ClassVar[list[tuple]] = []

        @staticmethod
        def flip(frame, axis):
            return frame

        @staticmethod
        def line(*args):
            pass

        @staticmethod
        def circle(*args):
            pass

        @classmethod
        def rectangle(cls, canvas, start, end, color, thickness):
            cls.rectangles.append((start, end, color, thickness))

        @staticmethod
        def getTextSize(text, font, scale, thickness):
            return ((int(len(text) * 20 * scale), int(24 * scale)), 0)

        @classmethod
        def putText(cls, canvas, text, origin, font, scale, color, thickness, line):
            cls.calls.append((text, origin, scale, color, thickness))

    snapshot = SimpleNamespace(
        state="active",
        label=class_label,
        confidence=0.99,
        inference_ms=4.5,
    )

    _draw_preview(
        np.zeros((720, 1280, 3), dtype=np.uint8),
        LandmarkResult(10, None),
        snapshot,
        live=True,
        active_shortcut=None,
        capture_latency_ms=8.25,
        cv2_module=PreviewCV2,
    )

    label_calls = [call for call in PreviewCV2.calls if call[0] == action_label]
    confidence_calls = [call for call in PreviewCV2.calls if call[0] == "99%"]
    assert len(label_calls) == 2
    assert label_calls[-1][1] == (24, 696)
    assert label_calls[-1][2] >= 1.0
    assert label_calls[-1][3] == (80, 255, 120)
    assert label_calls[-1][4] >= 2
    assert confidence_calls[-1][1][0] > label_calls[-1][1][0]
    assert confidence_calls[-1][2] < label_calls[-1][2]
    backgrounds = [rect for rect in PreviewCV2.rectangles if rect[2] == (0, 0, 0)]
    assert len(backgrounds) == 1
    start, end, _, thickness = backgrounds[0]
    confidence_right = confidence_calls[-1][1][0] + int(
        len("99%") * 20 * confidence_calls[-1][2]
    )
    assert start[0] < label_calls[-1][1][0]
    assert start[1] < label_calls[-1][1][1]
    assert end[0] > confidence_right
    assert end[1] > label_calls[-1][1][1]
    assert thickness == -1


def test_topmost_preview_closes_and_releases_runtime() -> None:
    class ClosedWindowCV2:
        FONT_HERSHEY_SIMPLEX = 0
        LINE_AA = 0
        WINDOW_NORMAL = 0
        WND_PROP_VISIBLE = 1
        WND_PROP_TOPMOST = 5
        wait_calls = 0
        window_events: ClassVar[list[tuple]] = []

        @classmethod
        def namedWindow(cls, name, mode):
            cls.window_events.append(("create", name, mode))

        @classmethod
        def setWindowProperty(cls, name, prop, value):
            cls.window_events.append(("property", name, prop, value))

        @staticmethod
        def flip(frame, axis):
            return frame

        @staticmethod
        def line(*args):
            pass

        @staticmethod
        def circle(*args):
            pass

        @staticmethod
        def rectangle(*args):
            pass

        @staticmethod
        def getTextSize(text, font, scale, thickness):
            return ((int(len(text) * 20 * scale), int(24 * scale)), 0)

        @staticmethod
        def putText(*args):
            pass

        @staticmethod
        def imshow(*args):
            pass

        @classmethod
        def waitKey(cls, delay):
            cls.wait_calls += 1
            if cls.wait_calls > 1:
                raise AssertionError("closed preview should stop the loop")
            return 0

        @staticmethod
        def getWindowProperty(name, prop):
            return 0

    runtime = Runtime()

    run_webcam(
        SimpleNamespace(
            camera_index=0,
            landmarker_path="hand.task",
            bindings={},
        ),
        runtime,
        preview=True,
        should_stop=lambda: False,
        camera_type=Camera,
        landmarker_type=Landmarker,
        cv2_module=ClosedWindowCV2,
    )

    assert ClosedWindowCV2.window_events == [
        ("create", "YADL Hand Demo", ClosedWindowCV2.WINDOW_NORMAL),
        (
            "property",
            "YADL Hand Demo",
            ClosedWindowCV2.WND_PROP_TOPMOST,
            1,
        ),
    ]
    assert runtime.closed


def test_termination_flag_handles_and_restores_sigint_and_sigterm() -> None:
    class Signals:
        SIGINT = 2
        SIGTERM = 15

        def __init__(self) -> None:
            self.handlers = {self.SIGINT: "old-int", self.SIGTERM: "old-term"}

        def getsignal(self, signum):
            return self.handlers[signum]

        def signal(self, signum, handler):
            self.handlers[signum] = handler

    signals = Signals()
    with termination_flag(signals) as stopped:
        assert not stopped()
        signals.handlers[signals.SIGTERM](signals.SIGTERM, None)
        assert stopped()

    assert signals.handlers == {signals.SIGINT: "old-int", signals.SIGTERM: "old-term"}
