import uuid
from pathlib import Path
from urllib.request import urlretrieve

import mediapipe as mp

from backend.db import ROOT
from backend.models import GeomHand, Landmark, Obj

MODEL = ROOT / "data" / "models" / "hand_landmarker.task"
MODEL_URL = "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/latest/hand_landmarker.task"

_lm = None


def _model() -> Path:
    MODEL.parent.mkdir(parents=True, exist_ok=True)
    if not MODEL.exists():
        urlretrieve(MODEL_URL, MODEL)
    return MODEL


def _landmarker():
    global _lm
    if _lm is not None:
        return _lm
    opts = mp.tasks.vision.HandLandmarkerOptions(
        base_options=mp.tasks.BaseOptions(model_asset_path=str(_model())),
        running_mode=mp.tasks.vision.RunningMode.IMAGE,
        num_hands=2,
        min_hand_detection_confidence=0.1,
        min_hand_presence_confidence=0.1,
    )
    _lm = mp.tasks.vision.HandLandmarker.create_from_options(opts)
    return _lm


def _detect(path: Path):
    lm = _landmarker()
    result = lm.detect(mp.Image.create_from_file(str(path)))
    if result.hand_landmarks:
        return result
    # some stills miss at native size; 2x keeps 0–1 coords
    import cv2
    import numpy as np
    bgr = cv2.imread(str(path))
    if bgr is None:
        return result
    rgb = np.ascontiguousarray(
        cv2.cvtColor(cv2.resize(bgr, (bgr.shape[1] * 2, bgr.shape[0] * 2)), cv2.COLOR_BGR2RGB)
    )
    return lm.detect(mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb))


def seed(path: Path) -> list[Obj]:
    result = _detect(path)
    out: list[Obj] = []
    for i, pts in enumerate(result.hand_landmarks):
        if len(pts) != 21:
            continue
        side = None
        if i < len(result.handedness) and result.handedness[i]:
            name = result.handedness[i][0].category_name
            if name in ("Left", "Right"):
                side = name
        out.append(
            Obj(
                id=str(uuid.uuid4()),
                kind="hand",
                label=None,
                edited=False,
                geom=GeomHand(
                    t="hand",
                    landmarks=[Landmark(x=p.x, y=p.y, z=p.z) for p in pts],
                    handedness=side,
                ),
            )
        )
    return out
