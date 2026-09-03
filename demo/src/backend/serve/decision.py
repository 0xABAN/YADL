from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

BindingMode = Literal["hold", "tap"]
EventKind = Literal["press", "release", "tap"]


@dataclass(frozen=True)
class Observation:
    label: str
    confidence: float
    margin: float


@dataclass(frozen=True)
class GestureEvent:
    kind: EventKind
    label: str


@dataclass(frozen=True)
class DecisionPolicy:
    enter_ms: int = 120
    release_ms: int = 100
    stale_ms: int = 200
    minimum_observations: int = 3
    enter_confidence: float = 0.98
    enter_margin: float = 0.35
    sustain_confidence: float = 0.70


class DecisionEngine:
    def __init__(
        self,
        bindings: dict[str, BindingMode],
        policy: DecisionPolicy | None = None,
    ) -> None:
        self.bindings = dict(bindings)
        self.policy = policy or DecisionPolicy()
        self.candidate: str | None = None
        self.candidate_since_ms: int | None = None
        self.candidate_observations = 0
        self.active: str | None = None
        self.active_mode: BindingMode | None = None
        self.invalid_since_ms: int | None = None
        self.last_update_ms: int | None = None

    @property
    def state(self) -> str:
        if self.active is not None:
            return "active"
        if self.candidate is not None:
            return "candidate"
        return "idle"

    def update(
        self, timestamp_ms: int, observation: Observation | None
    ) -> tuple[GestureEvent, ...]:
        if self.last_update_ms is not None and timestamp_ms < self.last_update_ms:
            raise ValueError("timestamps must be monotonic")
        self.last_update_ms = timestamp_ms

        if self.active is not None:
            valid = (
                observation is not None
                and observation.label == self.active
                and observation.confidence >= self.policy.sustain_confidence
            )
            if valid:
                self.invalid_since_ms = None
                return ()
            if self.invalid_since_ms is None:
                self.invalid_since_ms = timestamp_ms
                return ()
            if timestamp_ms - self.invalid_since_ms < self.policy.release_ms:
                return ()
            label = self.active
            mode = self.active_mode
            self.active = None
            self.active_mode = None
            self.invalid_since_ms = None
            self._clear_candidate()
            return (GestureEvent("release", label),) if mode == "hold" else ()

        if not self._qualifies(observation):
            self._clear_candidate()
            return ()
        assert observation is not None
        if observation.label != self.candidate:
            self.candidate = observation.label
            self.candidate_since_ms = timestamp_ms
            self.candidate_observations = 1
            return ()
        self.candidate_observations += 1
        assert self.candidate_since_ms is not None
        if (
            timestamp_ms - self.candidate_since_ms < self.policy.enter_ms
            or self.candidate_observations < self.policy.minimum_observations
        ):
            return ()
        label = observation.label
        self.active = label
        self.active_mode = self.bindings[label]
        self.invalid_since_ms = None
        self._clear_candidate()
        kind: EventKind = "press" if self.active_mode == "hold" else "tap"
        return (GestureEvent(kind, label),)

    def tick(self, timestamp_ms: int) -> tuple[GestureEvent, ...]:
        if self.last_update_ms is None:
            return ()
        if timestamp_ms - self.last_update_ms < self.policy.stale_ms:
            return ()
        self._clear_candidate()
        if self.active is None:
            return ()
        label = self.active
        mode = self.active_mode
        self.active = None
        self.active_mode = None
        self.invalid_since_ms = None
        return (GestureEvent("release", label),) if mode == "hold" else ()

    def _qualifies(self, observation: Observation | None) -> bool:
        return bool(
            observation is not None
            and observation.label in self.bindings
            and observation.confidence >= self.policy.enter_confidence
            and observation.margin >= self.policy.enter_margin
        )

    def _clear_candidate(self) -> None:
        self.candidate = None
        self.candidate_since_ms = None
        self.candidate_observations = 0
