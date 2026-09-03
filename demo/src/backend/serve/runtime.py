from __future__ import annotations

from dataclasses import dataclass
from time import perf_counter_ns
from typing import Protocol

import numpy as np

from backend.train.model import Prediction

from .actions import ActionController
from .decision import DecisionEngine, Observation
from .vision import LandmarkResult


class Classifier(Protocol):
    def predict(
        self, landmarks: np.ndarray, *, handedness: str | None = None
    ) -> Prediction: ...


@dataclass(frozen=True)
class RuntimeSnapshot:
    timestamp_ms: int
    label: str | None
    confidence: float
    margin: float
    active_label: str | None
    state: str
    inference_ms: float


class GestureRuntime:
    def __init__(
        self,
        classifier: Classifier,
        decision: DecisionEngine,
        actions: ActionController,
    ) -> None:
        self.classifier = classifier
        self.decision = decision
        self.actions = actions

    def process(self, result: LandmarkResult) -> RuntimeSnapshot:
        started = perf_counter_ns()
        try:
            prediction = (
                self.classifier.predict(result.landmarks, handedness=None)
                if result.landmarks is not None
                else None
            )
            observation = self._observation(prediction)
            for event in self.decision.update(result.timestamp_ms, observation):
                self.actions.handle(event)
        except BaseException:
            self.actions.release_all()
            raise
        elapsed_ms = (perf_counter_ns() - started) / 1_000_000
        return RuntimeSnapshot(
            timestamp_ms=result.timestamp_ms,
            label=prediction.label if prediction else None,
            confidence=prediction.confidence if prediction else 0.0,
            margin=observation.margin if observation else 0.0,
            active_label=self.decision.active,
            state=self.decision.state,
            inference_ms=elapsed_ms,
        )

    def tick(self, timestamp_ms: int) -> None:
        for event in self.decision.tick(timestamp_ms):
            self.actions.handle(event)

    def close(self) -> None:
        self.actions.release_all()

    @staticmethod
    def _observation(prediction: Prediction | None) -> Observation | None:
        if prediction is None:
            return None
        probabilities = sorted(prediction.probabilities.values(), reverse=True)
        runner_up = probabilities[1] if len(probabilities) > 1 else 0.0
        return Observation(
            prediction.label,
            prediction.confidence,
            prediction.confidence - runner_up,
        )
