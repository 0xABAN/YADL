import json
from pathlib import Path

import pytest

from backend.serve.config import (
    ServiceConfig,
    artifact_sha256,
    load_config,
    save_config,
)


def test_config_round_trip_preserves_policy_and_bindings(tmp_path: Path) -> None:
    model = tmp_path / "model.pt"
    landmarker = tmp_path / "hand.task"
    model.write_bytes(b"model")
    landmarker.write_bytes(b"landmarker")
    path = tmp_path / "config.json"
    payload = {
        "camera_index": 1,
        "model_path": str(model),
        "landmarker_path": str(landmarker),
        "approved_artifact_sha256": artifact_sha256(model),
        "decision": {"enter_ms": 140, "enter_confidence": 0.97},
        "bindings": {
            "fist": {"mode": "hold", "shortcut": "ctrl+shift+d"},
            "open": {"mode": "tap", "shortcut": "command+return"},
            "point": {"mode": "tap", "shortcut": "return"},
            "rock": {"mode": "tap", "text": "/fast"},
        },
    }

    config = ServiceConfig.from_dict(payload)
    save_config(config, path)
    loaded = load_config(path)

    assert loaded.camera_index == 1
    assert loaded.policy.enter_ms == 140
    assert loaded.policy.release_ms == 100
    assert str(loaded.bindings["fist"].shortcut) == "control+shift+d"
    assert loaded.live_ready()
    assert json.loads(path.read_text())["bindings"]["open"]["mode"] == "tap"
    assert loaded.bindings["rock"].text == "/fast"
    assert str(loaded.bindings["point"].shortcut) == "return"
    assert json.loads(path.read_text())["bindings"]["rock"]["text"] == "/fast"


def test_config_requires_fist_to_be_a_hold_binding(tmp_path: Path) -> None:
    payload = {
        "model_path": str(tmp_path / "model.pt"),
        "landmarker_path": str(tmp_path / "hand.task"),
        "bindings": {"fist": {"mode": "tap", "shortcut": "ctrl+d"}},
    }

    with pytest.raises(ValueError, match="fist.*hold"):
        ServiceConfig.from_dict(payload)


def test_live_ready_detects_changed_or_missing_artifact(tmp_path: Path) -> None:
    model = tmp_path / "model.pt"
    model.write_bytes(b"model")
    config = ServiceConfig.from_dict(
        {
            "model_path": str(model),
            "landmarker_path": str(tmp_path / "hand.task"),
            "approved_artifact_sha256": artifact_sha256(model),
            "bindings": {"fist": {"mode": "hold", "shortcut": "ctrl+d"}},
        }
    )
    assert config.live_ready()

    model.write_bytes(b"changed")
    assert not config.live_ready()
    model.unlink()
    assert not config.live_ready()


def test_missing_config_explains_that_setup_must_finish(tmp_path: Path) -> None:
    path = tmp_path / "config.json"

    with pytest.raises(ValueError) as error:
        load_config(path)

    message = str(error.value)
    assert "setup has not completed" in message
    assert "yadl-gestures setup" in message
    assert "Configuration saved" in message
