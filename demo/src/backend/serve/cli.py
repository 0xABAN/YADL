from __future__ import annotations

import argparse
from dataclasses import replace
from pathlib import Path

from backend.train.model import HandSignClassifier

from .actions import (
    ActionBinding,
    ActionController,
    QuartzKeyEmitter,
    Shortcut,
    accessibility_trusted,
)
from .app import run_webcam
from .config import (
    DEFAULT_CONFIG_PATH,
    ServiceConfig,
    artifact_sha256,
    load_config,
    save_config,
)
from .decision import DecisionEngine
from .doctor import Check, run_checks
from .runtime import GestureRuntime

OPEN_NEW_CHAT = ActionBinding("tap", Shortcut.parse("command+n"))
FAST_MODE = ActionBinding.type_and_submit("/fast")
SEND_MESSAGE = ActionBinding("tap", Shortcut.parse("return"))


def _load_classifier(model_path: Path) -> HandSignClassifier:
    classifier = HandSignClassifier.load(model_path, device="mps")
    parameters = tuple(classifier.model.parameters())
    if not parameters or any(
        parameter.device.type != "mps" for parameter in parameters
    ):
        raise RuntimeError("classifier parameters are not on MPS")
    return classifier


def configure_service(
    *,
    model_path: Path,
    landmarker_path: Path,
    config_path: Path,
    camera_index: int,
) -> ServiceConfig:
    if not landmarker_path.is_file():
        raise ValueError(f"MediaPipe landmarker asset is missing: {landmarker_path}")
    classifier = _load_classifier(model_path)
    if "fist" not in classifier.classes:
        raise ValueError("the model artifact must contain a fist class")
    config = ServiceConfig(
        model_path=model_path,
        landmarker_path=landmarker_path,
        bindings={
            "fist": ActionBinding("hold", Shortcut.parse("fn")),
            "open": OPEN_NEW_CHAT,
            "point": SEND_MESSAGE,
            "rock": FAST_MODE,
        },
        camera_index=camera_index,
        approved_artifact_sha256=artifact_sha256(model_path),
    )
    save_config(config, config_path)
    return config


def build_runtime(config: ServiceConfig) -> GestureRuntime:
    classifier = _load_classifier(config.model_path)
    if not config.live_ready():
        raise RuntimeError("model artifact has changed since setup")
    if not accessibility_trusted(prompt=True):
        raise RuntimeError("macOS Accessibility authorization is required")
    decision = DecisionEngine(
        {label: binding.mode for label, binding in config.bindings.items()},
        config.policy,
    )
    return GestureRuntime(
        classifier,
        decision,
        ActionController(config.bindings, QuartzKeyEmitter()),
    )


def _show_checks(checks: tuple[Check, ...]) -> bool:
    for check in checks:
        print(f"{'✓' if check.ok else '✗'} {check.name}: {check.detail}")
    return all(check.ok for check in checks)


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Run the local YADL hand gesture demo")
    demo_root = Path(__file__).resolve().parents[3]
    parser.add_argument("--config", type=Path, default=DEFAULT_CONFIG_PATH)
    parser.add_argument(
        "--model", type=Path, default=demo_root / "artifacts" / "hand-sign.pt"
    )
    parser.add_argument(
        "--landmarker",
        type=Path,
        default=demo_root.parent / "data" / "models" / "hand_landmarker.task",
    )
    parser.add_argument("--camera", type=int, default=0)
    parser.add_argument("--no-preview", action="store_true")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = _parser().parse_args(argv)
    try:
        if args.config.is_file():
            config = load_config(args.config)
            missing_bindings = {
                label: binding
                for label, binding in {
                    "open": OPEN_NEW_CHAT,
                    "point": SEND_MESSAGE,
                    "rock": FAST_MODE,
                }.items()
                if label not in config.bindings
            }
            if missing_bindings:
                config = replace(
                    config,
                    bindings={**config.bindings, **missing_bindings},
                )
                save_config(config, args.config)
                print(f"Configuration updated at {args.config}")
        else:
            config = configure_service(
                model_path=args.model,
                landmarker_path=args.landmarker,
                config_path=args.config,
                camera_index=args.camera,
            )
            print(f"Configuration saved to {args.config}")
        checks = run_checks(config, live=True)
        if not _show_checks(checks):
            return 1
        runtime = build_runtime(config)
        run_webcam(
            config,
            runtime,
            live=True,
            preview=not args.no_preview,
        )
        return 0
    except KeyboardInterrupt:
        return 0
    except (OSError, RuntimeError, TypeError, ValueError) as exc:
        print(f"error: {exc}")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
