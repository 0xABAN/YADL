from pathlib import Path

from backend.serve import doctor
from backend.serve.config import ServiceConfig, artifact_sha256
from backend.serve.doctor import Check, run_checks


class Classifier:
    pass


def _config(tmp_path: Path) -> ServiceConfig:
    model = tmp_path / "model.pt"
    landmarker = tmp_path / "hand.task"
    model.write_bytes(b"model")
    landmarker.write_bytes(b"landmarker")
    return ServiceConfig.from_dict(
        {
            "model_path": str(model),
            "landmarker_path": str(landmarker),
            "approved_artifact_sha256": artifact_sha256(model),
            "bindings": {"fist": {"mode": "hold", "shortcut": "ctrl+d"}},
        }
    )


def test_doctor_checks_live_model_gpu_camera_and_accessibility(tmp_path: Path) -> None:
    checks = run_checks(
        _config(tmp_path),
        live=True,
        classifier_loader=lambda path, device: Classifier(),
        landmarker_probe=lambda path: True,
        mps_available=lambda: True,
        camera_probe=lambda index: index == 0,
        accessibility=lambda: True,
    )

    assert checks == (
        Check("model", True, "configured artifact"),
        Check("landmarker", True, "asset loadable"),
        Check("mps", True, "available"),
        Check("camera", True, "camera 0 available"),
        Check("accessibility", True, "authorized"),
    )


def test_doctor_surfaces_every_live_blocker(tmp_path: Path) -> None:
    config = _config(tmp_path)
    config.model_path.write_bytes(b"changed")
    checks = run_checks(
        config,
        live=True,
        classifier_loader=lambda path, device: Classifier(),
        landmarker_probe=lambda path: True,
        mps_available=lambda: False,
        camera_probe=lambda index: False,
        accessibility=lambda: False,
    )

    assert not all(check.ok for check in checks)
    assert {check.name for check in checks if not check.ok} == {
        "model",
        "mps",
        "camera",
        "accessibility",
    }


def test_live_doctor_requests_accessibility_when_not_injected(
    monkeypatch, tmp_path: Path
) -> None:
    prompts = []
    monkeypatch.setattr(
        doctor,
        "accessibility_trusted",
        lambda *, prompt: prompts.append(prompt) or True,
    )

    run_checks(
        _config(tmp_path),
        live=True,
        classifier_loader=lambda path, device: Classifier(),
        landmarker_probe=lambda path: True,
        mps_available=lambda: True,
        camera_probe=lambda index: True,
    )

    assert prompts == [True]


def test_camera_failure_explains_permission_recovery(tmp_path: Path) -> None:
    checks = run_checks(
        _config(tmp_path),
        live=False,
        classifier_loader=lambda path, device: Classifier(),
        landmarker_probe=lambda path: True,
        mps_available=lambda: True,
        camera_probe=lambda index: False,
    )

    camera = next(check for check in checks if check.name == "camera")
    assert "Privacy & Security → Camera" in camera.detail


def test_doctor_rejects_incompatible_landmarker_asset(tmp_path: Path) -> None:
    checks = run_checks(
        _config(tmp_path),
        live=False,
        classifier_loader=lambda path, device: Classifier(),
        landmarker_probe=lambda path: False,
        mps_available=lambda: True,
        camera_probe=lambda index: True,
    )

    landmarker = next(check for check in checks if check.name == "landmarker")
    assert not landmarker.ok
    assert landmarker.detail == "asset could not be loaded"
