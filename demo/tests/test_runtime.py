import numpy as np
import pytest

from backend.serve.actions import ActionBinding, ActionController, Shortcut
from backend.serve.decision import DecisionEngine, DecisionPolicy
from backend.serve.runtime import GestureRuntime
from backend.serve.vision import LandmarkResult
from backend.train.model import Prediction


class Classifier:
    def __init__(self) -> None:
        self.fail = False

    def predict(self, landmarks: np.ndarray, *, handedness: None) -> Prediction:
        if self.fail:
            raise RuntimeError("inference failed")
        return Prediction("fist", 0.99, {"fist": 0.99, "neutral": 0.01})


class Emitter:
    def __init__(self) -> None:
        self.events: list[tuple[str, str]] = []

    def key_down(self, key: str) -> None:
        self.events.append(("down", key))

    def key_up(self, key: str) -> None:
        self.events.append(("up", key))


def _runtime() -> tuple[GestureRuntime, Classifier, Emitter]:
    classifier = Classifier()
    emitter = Emitter()
    bindings = {"fist": ActionBinding("hold", Shortcut.parse("ctrl+d"))}
    engine = DecisionEngine(
        {"fist": "hold"},
        DecisionPolicy(enter_ms=120, minimum_observations=3),
    )
    controller = ActionController(bindings, emitter)
    return GestureRuntime(classifier, engine, controller), classifier, emitter


def test_runtime_turns_single_hand_predictions_into_held_actions() -> None:
    runtime, _, emitter = _runtime()
    hand = np.ones((21, 3), dtype=np.float32)

    runtime.process(LandmarkResult(0, hand))
    runtime.process(LandmarkResult(60, hand))
    snapshot = runtime.process(LandmarkResult(120, hand))

    assert emitter.events == [("down", "control"), ("down", "d")]
    assert snapshot.label == "fist"
    assert snapshot.margin == pytest.approx(0.98)
    assert snapshot.active_label == "fist"
    assert snapshot.state == "active"


def test_runtime_releases_keys_when_inference_raises() -> None:
    runtime, classifier, emitter = _runtime()
    hand = np.ones((21, 3), dtype=np.float32)
    runtime.process(LandmarkResult(0, hand))
    runtime.process(LandmarkResult(60, hand))
    runtime.process(LandmarkResult(120, hand))
    classifier.fail = True

    with pytest.raises(RuntimeError, match="inference failed"):
        runtime.process(LandmarkResult(180, hand))

    assert emitter.events[-2:] == [("up", "d"), ("up", "control")]
