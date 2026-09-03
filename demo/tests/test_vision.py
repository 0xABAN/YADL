from dataclasses import dataclass

import numpy as np

from backend.serve.vision import CameraCapture, LatestFrameBuffer, SingleHandLandmarker


def test_latest_frame_buffer_replaces_unconsumed_frames() -> None:
    buffer = LatestFrameBuffer()
    first = np.zeros((2, 2, 3), dtype=np.uint8)
    latest = np.ones((2, 2, 3), dtype=np.uint8)

    buffer.publish(10, first)
    buffer.publish(20, latest)

    sequence, timestamp_ms, frame = buffer.wait_after(0, timeout=0)
    assert sequence == 2
    assert timestamp_ms == 20
    np.testing.assert_array_equal(frame, latest)


@dataclass
class Point:
    x: float
    y: float
    z: float


class FakeLandmarker:
    def __init__(self, options) -> None:
        self.options = options
        self.submissions: list[tuple[object, int]] = []
        self.closed = False

    def detect_async(self, image, timestamp_ms: int) -> None:
        self.submissions.append((image, timestamp_ms))

    def close(self) -> None:
        self.closed = True


class FakeVision:
    class RunningMode:
        LIVE_STREAM = "live"

    class HandLandmarkerOptions:
        def __init__(self, **kwargs) -> None:
            self.__dict__.update(kwargs)

    class HandLandmarker:
        instance = None

        @classmethod
        def create_from_options(cls, options):
            cls.instance = FakeLandmarker(options)
            return cls.instance


class FakeMediaPipe:
    class ImageFormat:
        SRGB = "srgb"

    class Image:
        def __init__(self, *, image_format, data) -> None:
            self.image_format = image_format
            self.data = data


class FakeCV2:
    COLOR_BGR2RGB = 4

    @staticmethod
    def cvtColor(frame, conversion):
        assert conversion == FakeCV2.COLOR_BGR2RGB
        return frame[..., ::-1]


def test_landmarker_is_single_hand_live_stream_and_extracts_first_hand() -> None:
    delivered = []
    stream = SingleHandLandmarker(
        "hand.task",
        delivered.append,
        mediapipe_module=FakeMediaPipe,
        base_options_type=lambda **kwargs: kwargs,
        vision_module=FakeVision,
        cv2_module=FakeCV2,
    )
    landmarker = FakeVision.HandLandmarker.instance

    assert landmarker.options.num_hands == 1
    assert landmarker.options.running_mode == "live"
    stream.submit(np.zeros((2, 2, 3), dtype=np.uint8), 42)
    result = type("Result", (), {"hand_landmarks": [[Point(1, 2, 3)] * 21]})()
    landmarker.options.result_callback(result, None, 42)
    stream.close()

    assert landmarker.submissions[0][1] == 42
    assert delivered[0].timestamp_ms == 42
    assert delivered[0].landmarks.shape == (21, 3)
    assert landmarker.closed


class FakeCapture:
    def __init__(self) -> None:
        self.released = False
        self.reads = 0

    @staticmethod
    def isOpened() -> bool:
        return True

    def read(self):
        self.reads += 1
        if self.reads == 1:
            return True, np.ones((2, 2, 3), dtype=np.uint8)
        return False, None

    def release(self) -> None:
        self.released = True


class FakeCameraCV2:
    capture = FakeCapture()

    @classmethod
    def VideoCapture(cls, index: int):
        assert index == 2
        return cls.capture


def test_camera_capture_publishes_from_a_dedicated_reader_and_releases() -> None:
    buffer = LatestFrameBuffer()
    camera = CameraCapture(2, buffer, cv2_module=FakeCameraCV2, clock_ms=lambda: 123)

    camera.start()
    _, timestamp_ms, frame = buffer.wait_after(0, timeout=1)
    camera.close()

    assert timestamp_ms == 123
    np.testing.assert_array_equal(frame, np.ones((2, 2, 3), dtype=np.uint8))
    assert FakeCameraCV2.capture.released
