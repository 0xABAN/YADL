from __future__ import annotations

import hashlib
import json
import os
import tempfile
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any

from .actions import ActionBinding, Shortcut
from .decision import DecisionPolicy

DEFAULT_CONFIG_PATH = (
    Path.home() / "Library" / "Application Support" / "YADL Hand Demo" / "config.json"
)


def artifact_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as artifact:
        for chunk in iter(lambda: artifact.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


@dataclass(frozen=True)
class ServiceConfig:
    model_path: Path
    landmarker_path: Path
    bindings: dict[str, ActionBinding]
    policy: DecisionPolicy = field(default_factory=DecisionPolicy)
    camera_index: int = 0
    approved_artifact_sha256: str | None = None

    @classmethod
    def from_dict(cls, raw: dict[str, Any]) -> ServiceConfig:
        try:
            decision = DecisionPolicy(**dict(raw.get("decision") or {}))
            bindings = {
                str(label): (
                    ActionBinding(mode=value["mode"], text=value["text"])
                    if "text" in value
                    else ActionBinding(
                        mode=value["mode"],
                        shortcut=Shortcut.parse(value["shortcut"]),
                    )
                )
                for label, value in dict(raw.get("bindings") or {}).items()
            }
            config = cls(
                model_path=Path(raw["model_path"]).expanduser(),
                landmarker_path=Path(raw["landmarker_path"]).expanduser(),
                bindings=bindings,
                policy=decision,
                camera_index=int(raw.get("camera_index", 0)),
                approved_artifact_sha256=raw.get("approved_artifact_sha256"),
            )
        except (KeyError, TypeError, ValueError) as exc:
            raise ValueError(f"invalid gesture service config: {exc}") from exc
        config._validate()
        return config

    def _validate(self) -> None:
        fist = self.bindings.get("fist")
        if fist is None or fist.mode != "hold":
            raise ValueError("fist must have a hold binding")
        if self.camera_index < 0:
            raise ValueError("camera_index must be non-negative")
        if any(
            binding.mode not in {"hold", "tap"} for binding in self.bindings.values()
        ):
            raise ValueError("binding mode must be hold or tap")
        if not 0 <= self.policy.sustain_confidence <= self.policy.enter_confidence <= 1:
            raise ValueError("decision confidence thresholds are invalid")
        if not 0 <= self.policy.enter_margin <= 1:
            raise ValueError("decision margin threshold is invalid")
        if (
            min(
                self.policy.enter_ms,
                self.policy.release_ms,
                self.policy.stale_ms,
                self.policy.minimum_observations,
            )
            <= 0
        ):
            raise ValueError("decision timing values must be positive")

    def to_dict(self) -> dict[str, Any]:
        return {
            "camera_index": self.camera_index,
            "model_path": str(self.model_path),
            "landmarker_path": str(self.landmarker_path),
            "approved_artifact_sha256": self.approved_artifact_sha256,
            "decision": asdict(self.policy),
            "bindings": {
                label: {
                    "mode": binding.mode,
                    **(
                        {"shortcut": str(binding.shortcut)}
                        if binding.shortcut is not None
                        else {"text": binding.text}
                    ),
                }
                for label, binding in self.bindings.items()
            },
        }

    def live_ready(self) -> bool:
        return bool(
            self.approved_artifact_sha256
            and self.model_path.is_file()
            and artifact_sha256(self.model_path) == self.approved_artifact_sha256
        )


def load_config(path: Path = DEFAULT_CONFIG_PATH) -> ServiceConfig:
    try:
        raw = json.loads(path.read_text())
    except FileNotFoundError as exc:
        raise ValueError(
            "gesture setup has not completed; "
            f"{path} does not exist. Run `yadl-gestures setup` and wait for "
            "`Configuration saved` before "
            "running doctor or serve"
        ) from exc
    except (OSError, json.JSONDecodeError) as exc:
        raise ValueError(
            f"could not read gesture service config {path}: {exc}"
        ) from exc
    if not isinstance(raw, dict):
        raise TypeError("gesture service config must be a JSON object")
    return ServiceConfig.from_dict(raw)


def save_config(config: ServiceConfig, path: Path = DEFAULT_CONFIG_PATH) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary_name = tempfile.mkstemp(
        prefix=f".{path.name}.", dir=path.parent
    )
    temporary = Path(temporary_name)
    try:
        with os.fdopen(descriptor, "w") as output:
            json.dump(config.to_dict(), output, indent=2)
            output.write("\n")
        os.chmod(temporary, 0o600)
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)
