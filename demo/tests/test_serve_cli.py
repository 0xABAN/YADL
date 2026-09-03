from types import SimpleNamespace

import pytest

from backend.serve import cli
from backend.serve.actions import ActionBinding, Shortcut
from backend.serve.decision import DecisionPolicy
from backend.serve.doctor import Check


def test_cli_prints_preflight_checks_and_stops_on_failure(
    monkeypatch, capsys, tmp_path
) -> None:
    config_path = tmp_path / "config.json"
    config_path.touch()
    monkeypatch.setattr(
        cli,
        "load_config",
        lambda path: SimpleNamespace(
            bindings={
                "open": cli.OPEN_NEW_CHAT,
                "point": cli.SEND_MESSAGE,
                "rock": cli.FAST_MODE,
            }
        ),
    )
    monkeypatch.setattr(
        cli,
        "run_checks",
        lambda config, live: (
            Check("model", True, "validated artifact"),
            Check("camera", False, "camera 0 unavailable"),
        ),
    )

    monkeypatch.setattr(
        cli,
        "build_runtime",
        lambda config: (_ for _ in ()).throw(AssertionError("must not build")),
    )

    result = cli.main(["--config", str(config_path)])

    assert result == 1
    assert capsys.readouterr().out.splitlines() == [
        "✓ model: validated artifact",
        "✗ camera: camera 0 unavailable",
    ]


def test_cli_runs_checked_configuration_live(
    monkeypatch, tmp_path
) -> None:
    config_path = tmp_path / "config.json"
    config_path.touch()
    config = SimpleNamespace(
        bindings={
            "open": cli.OPEN_NEW_CHAT,
            "point": cli.SEND_MESSAGE,
            "rock": cli.FAST_MODE,
        }
    )
    runtime = object()
    called = {}
    monkeypatch.setattr(cli, "load_config", lambda path: config)
    monkeypatch.setattr(
        cli, "run_checks", lambda config, live: (Check("all", True, "ready"),)
    )
    monkeypatch.setattr(cli, "build_runtime", lambda config: runtime)
    monkeypatch.setattr(
        cli,
        "run_webcam",
        lambda config, runtime, live, preview: called.update(
            config=config, runtime=runtime, live=live, preview=preview
        ),
    )

    result = cli.main(["--config", str(config_path), "--no-preview"])

    assert result == 0
    assert called == {
        "config": config,
        "runtime": runtime,
        "live": True,
        "preview": False,
    }


def test_cli_refuses_to_start_when_preflight_fails(
    monkeypatch, capsys, tmp_path
) -> None:
    config_path = tmp_path / "config.json"
    config_path.touch()
    monkeypatch.setattr(
        cli,
        "load_config",
        lambda path: SimpleNamespace(
            bindings={
                "open": cli.OPEN_NEW_CHAT,
                "point": cli.SEND_MESSAGE,
                "rock": cli.FAST_MODE,
            }
        ),
    )
    monkeypatch.setattr(
        cli,
        "run_checks",
        lambda config, live: (Check("accessibility", False, "authorization required"),),
    )
    monkeypatch.setattr(
        cli,
        "build_runtime",
        lambda config: (_ for _ in ()).throw(AssertionError("must not build")),
    )

    result = cli.main(["--config", str(config_path)])

    assert result == 1
    assert "accessibility: authorization required" in capsys.readouterr().out


def test_cli_reports_non_object_config(monkeypatch, capsys, tmp_path) -> None:
    config_path = tmp_path / "config.json"
    config_path.touch()
    monkeypatch.setattr(
        cli,
        "load_config",
        lambda path: (_ for _ in ()).throw(TypeError("config must be an object")),
    )

    result = cli.main(["--config", str(config_path)])

    assert result == 1
    assert capsys.readouterr().out.strip() == "error: config must be an object"


def test_cli_configures_missing_artifact_then_runs_live(
    monkeypatch, capsys, tmp_path
) -> None:
    model = tmp_path / "model.pt"
    landmarker = tmp_path / "hand.task"
    config_path = tmp_path / "config.json"
    model.write_bytes(b"model")
    landmarker.write_bytes(b"landmarker")
    classifier = SimpleNamespace(
        classes=("fist", "open"),
        model=SimpleNamespace(
            parameters=lambda: iter(
                (SimpleNamespace(device=SimpleNamespace(type="mps")),)
            )
        ),
    )
    monkeypatch.setattr(
        cli.HandSignClassifier,
        "load",
        lambda path, device: classifier,
    )
    called = {}
    monkeypatch.setattr(
        cli,
        "run_checks",
        lambda config, live: (Check("all", True, "ready"),),
    )
    monkeypatch.setattr(cli, "build_runtime", lambda config: object())
    monkeypatch.setattr(
        cli,
        "run_webcam",
        lambda config, runtime, live, preview: called.update(
            config=config, live=live, preview=preview
        ),
    )

    result = cli.main(
        [
            "--config",
            str(config_path),
            "--model",
            str(model),
            "--landmarker",
            str(landmarker),
        ]
    )

    assert result == 0
    configured = cli.load_config(config_path)
    assert configured.model_path == model
    assert str(configured.bindings["fist"].shortcut) == "fn"
    assert configured.bindings["open"].mode == "tap"
    assert str(configured.bindings["open"].shortcut) == "command+n"
    assert configured.bindings["rock"].mode == "tap"
    assert configured.bindings["rock"].text == "/fast"
    assert configured.bindings["point"].mode == "tap"
    assert str(configured.bindings["point"].shortcut) == "return"
    assert configured.live_ready()
    assert called["live"] is True
    assert called["preview"] is True
    assert f"Configuration saved to {config_path}" in capsys.readouterr().out


def test_cli_adds_new_actions_to_existing_configuration(
    monkeypatch, tmp_path
) -> None:
    config_path = tmp_path / "config.json"
    existing = cli.ServiceConfig(
        model_path=tmp_path / "model.pt",
        landmarker_path=tmp_path / "hand.task",
        bindings={"fist": ActionBinding("hold", Shortcut.parse("fn"))},
    )
    cli.save_config(existing, config_path)
    monkeypatch.setattr(
        cli,
        "run_checks",
        lambda config, live: (Check("all", True, "ready"),),
    )
    monkeypatch.setattr(cli, "build_runtime", lambda config: object())
    monkeypatch.setattr(cli, "run_webcam", lambda *args, **kwargs: None)

    assert cli.main(["--config", str(config_path), "--no-preview"]) == 0

    upgraded = cli.load_config(config_path)
    assert upgraded.bindings["open"].mode == "tap"
    assert str(upgraded.bindings["open"].shortcut) == "command+n"
    assert upgraded.bindings["rock"].mode == "tap"
    assert upgraded.bindings["rock"].text == "/fast"
    assert upgraded.bindings["point"].mode == "tap"
    assert str(upgraded.bindings["point"].shortcut) == "return"


def test_cli_rejects_obsolete_custom_shortcut_option() -> None:
    with pytest.raises(SystemExit):
        cli._parser().parse_args(
            [
                "--ptt-shortcut",
                "ctrl+d",
            ]
        )


def test_cli_defaults_to_existing_trained_artifact() -> None:
    args = cli._parser().parse_args([])

    assert args.model.name == "hand-sign.pt"


def test_live_runtime_accepts_configured_inference_artifact(
    monkeypatch,
) -> None:
    config = SimpleNamespace(
        model_path="model.pt",
        bindings={"fist": ActionBinding("hold", Shortcut.parse("ctrl+d"))},
        policy=DecisionPolicy(),
        live_ready=lambda: True,
    )
    classifier = SimpleNamespace(
        live_approved=False,
        model=SimpleNamespace(
            parameters=lambda: iter(
                (SimpleNamespace(device=SimpleNamespace(type="mps")),)
            )
        ),
    )
    monkeypatch.setattr(
        cli.HandSignClassifier,
        "load",
        lambda path, device: classifier,
    )
    monkeypatch.setattr(cli, "accessibility_trusted", lambda *, prompt: True)
    monkeypatch.setattr(cli, "QuartzKeyEmitter", lambda: SimpleNamespace())

    runtime = cli.build_runtime(config)

    assert runtime.classifier is classifier


def test_runtime_rejects_classifier_whose_parameters_are_not_on_mps(
    monkeypatch,
) -> None:
    config = SimpleNamespace(
        model_path="model.pt",
        bindings={"fist": ActionBinding("hold", Shortcut.parse("ctrl+d"))},
        policy=DecisionPolicy(),
        live_ready=lambda: True,
    )
    classifier = SimpleNamespace(
        live_approved=True,
        model=SimpleNamespace(
            parameters=lambda: iter(
                (SimpleNamespace(device=SimpleNamespace(type="cpu")),)
            )
        ),
    )
    monkeypatch.setattr(
        cli.HandSignClassifier,
        "load",
        lambda path, device: classifier,
    )

    with pytest.raises(RuntimeError, match="parameters.*MPS"):
        cli.build_runtime(config)
