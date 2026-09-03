from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import torch

from backend.train.model import HandSignClassifier

from .actions import accessibility_trusted
from .config import ServiceConfig
from .vision import SingleHandLandmarker


@dataclass(frozen=True)
class Check:
    name: str
    ok: bool
    detail: str


def _camera_available(index: int) -> bool:
    try:
        import cv2
    except ImportError:
        return False

    try:
        capture = cv2.VideoCapture(index)
        try:
            return bool(capture.isOpened())
        finally:
            capture.release()
    except (OSError, RuntimeError, cv2.error):
        return False


def _landmarker_compatible(path: Path) -> bool:
    try:
        landmarker = SingleHandLandmarker(path, lambda result: None)
        landmarker.close()
        return True
    except (ImportError, OSError, RuntimeError, ValueError):
        return False


def run_checks(
    config: ServiceConfig,
    *,
    live: bool,
    classifier_loader: Callable[[Path, str], Any] | None = None,
    landmarker_probe: Callable[[Path], bool] | None = None,
    mps_available: Callable[[], bool] | None = None,
    camera_probe: Callable[[int], bool] | None = None,
    accessibility: Callable[[], bool] | None = None,
) -> tuple[Check, ...]:
    loader = classifier_loader or (
        lambda path, device: HandSignClassifier.load(path, device=device)
    )
    model_ok = False
    model_detail = "artifact missing"
    if config.model_path.is_file():
        try:
            loader(config.model_path, "mps")
            model_ok = bool(not live or config.live_ready())
            model_detail = (
                "configured artifact"
                if model_ok and live
                else "loadable artifact"
                if model_ok
                else "artifact has changed since setup"
            )
        except (KeyError, OSError, RuntimeError, TypeError, ValueError) as exc:
            model_detail = f"artifact could not be loaded: {exc}"
    asset_exists = config.landmarker_path.is_file()
    landmarker_ok = asset_exists and (landmarker_probe or _landmarker_compatible)(
        config.landmarker_path
    )
    landmarker_detail = (
        "asset loadable"
        if landmarker_ok
        else "asset could not be loaded"
        if asset_exists
        else "asset missing"
    )
    checks = [
        Check("model", model_ok, model_detail),
        Check("landmarker", landmarker_ok, landmarker_detail),
    ]
    has_mps = (mps_available or torch.backends.mps.is_available)()
    checks.append(Check("mps", has_mps, "available" if has_mps else "unavailable"))
    camera_ok = (camera_probe or _camera_available)(config.camera_index)
    checks.append(
        Check(
            "camera",
            camera_ok,
            f"camera {config.camera_index} available"
            if camera_ok
            else (
                f"camera {config.camera_index} unavailable; enable this terminal in "
                "System Settings → Privacy & Security → Camera"
            ),
        )
    )
    if live:
        trusted = (accessibility or (lambda: accessibility_trusted(prompt=True)))()
        checks.append(
            Check(
                "accessibility",
                trusted,
                "authorized" if trusted else "authorization required",
            )
        )
    return tuple(checks)
