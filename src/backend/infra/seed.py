"""Keypoint seed: MediaPipe hand / pose / face still-image landmarkers."""
from __future__ import annotations

import uuid
from pathlib import Path
from urllib.request import urlretrieve

import mediapipe as mp

from backend.domain.models import GeomFace, GeomHand, GeomPose, Landmark, Obj
from backend.infra.db import ROOT

MODELS = ROOT / "data" / "models"
URLS = {
    "hand": (
        MODELS / "hand_landmarker.task",
        "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/latest/hand_landmarker.task",
    ),
    "pose": (
        MODELS / "pose_landmarker_lite.task",
        "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/latest/pose_landmarker_lite.task",
    ),
    "face": (
        MODELS / "face_landmarker.task",
        "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/latest/face_landmarker.task",
    ),
}

_cache: dict[str, object] = {}


def _ensure(template: str) -> Path:
    path, url = URLS[template]
    path.parent.mkdir(parents=True, exist_ok=True)
    if not path.exists():
        urlretrieve(url, path)
    return path


def _image(path: Path):
    return mp.Image.create_from_file(str(path))


def _hand() -> object:
    if "hand" not in _cache:
        opts = mp.tasks.vision.HandLandmarkerOptions(
            base_options=mp.tasks.BaseOptions(model_asset_path=str(_ensure("hand"))),
            running_mode=mp.tasks.vision.RunningMode.IMAGE,
            num_hands=2,
            min_hand_detection_confidence=0.1,
            min_hand_presence_confidence=0.1,
        )
        _cache["hand"] = mp.tasks.vision.HandLandmarker.create_from_options(opts)
    return _cache["hand"]


def _pose() -> object:
    if "pose" not in _cache:
        opts = mp.tasks.vision.PoseLandmarkerOptions(
            base_options=mp.tasks.BaseOptions(model_asset_path=str(_ensure("pose"))),
            running_mode=mp.tasks.vision.RunningMode.IMAGE,
            num_poses=1,
            min_pose_detection_confidence=0.1,
            min_pose_presence_confidence=0.1,
        )
        _cache["pose"] = mp.tasks.vision.PoseLandmarker.create_from_options(opts)
    return _cache["pose"]


def _face() -> object:
    if "face" not in _cache:
        opts = mp.tasks.vision.FaceLandmarkerOptions(
            base_options=mp.tasks.BaseOptions(model_asset_path=str(_ensure("face"))),
            running_mode=mp.tasks.vision.RunningMode.IMAGE,
            num_faces=1,
            min_face_detection_confidence=0.1,
            min_face_presence_confidence=0.1,
        )
        _cache["face"] = mp.tasks.vision.FaceLandmarker.create_from_options(opts)
    return _cache["face"]


def _obj(landmarks: list[Landmark], *, handedness: str | None = None, template: str) -> Obj:
    t = template if template in ("hand", "pose", "face") else "hand"
    if t == "pose":
        geom = GeomPose(landmarks=landmarks, handedness=None)
    elif t == "face":
        geom = GeomFace(landmarks=landmarks, handedness=None)
    else:
        geom = GeomHand(landmarks=landmarks, handedness=handedness)
    return Obj(id=str(uuid.uuid4()), kind=t, label=None, edited=False, geom=geom)


def seed_hand(path: Path) -> list[Obj]:
    result = _hand().detect(_image(path))  # type: ignore[attr-defined]
    if not result.hand_landmarks:
        # some stills miss at native size; 2x keeps 0–1 coords
        import cv2
        import numpy as np

        bgr = cv2.imread(str(path))
        if bgr is not None:
            rgb = np.ascontiguousarray(
                cv2.cvtColor(cv2.resize(bgr, (bgr.shape[1] * 2, bgr.shape[0] * 2)), cv2.COLOR_BGR2RGB)
            )
            result = _hand().detect(mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb))  # type: ignore[attr-defined]
    out: list[Obj] = []
    for i, pts in enumerate(result.hand_landmarks or []):
        if len(pts) != 21:
            continue
        side = None
        if i < len(result.handedness) and result.handedness[i]:
            name = result.handedness[i][0].category_name
            if name in ("Left", "Right"):
                side = name
        out.append(
            _obj([Landmark(x=p.x, y=p.y, z=p.z) for p in pts], handedness=side, template="hand")
        )
    return out


def seed_pose(path: Path) -> list[Obj]:
    result = _pose().detect(_image(path))  # type: ignore[attr-defined]
    out: list[Obj] = []
    for pts in result.pose_landmarks or []:
        if len(pts) < 33:
            continue
        # MediaPipe pose is 33 landmarks
        out.append(_obj([Landmark(x=p.x, y=p.y, z=p.z) for p in pts[:33]], template="pose"))
    return out


def seed_face(path: Path) -> list[Obj]:
    result = _face().detect(_image(path))  # type: ignore[attr-defined]
    out: list[Obj] = []
    for pts in result.face_landmarks or []:
        if len(pts) < 1:
            continue
        out.append(_obj([Landmark(x=p.x, y=p.y, z=p.z) for p in pts], template="face"))
    return out


def seed(path: Path, template: str = "hand") -> list[Obj]:
    t = template if template in ("hand", "pose", "face") else "hand"
    if t == "pose":
        return seed_pose(path)
    if t == "face":
        return seed_face(path)
    return seed_hand(path)
