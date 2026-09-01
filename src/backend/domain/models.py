from typing import Literal

from pydantic import BaseModel, Field


class Landmark(BaseModel):
    x: float
    y: float
    z: float


class GeomBox(BaseModel):
    t: Literal["box"]
    x: float
    y: float
    w: float
    h: float


class GeomPoly(BaseModel):
    t: Literal["polygon"]
    pts: list[tuple[float, float]]


class RigRoot(BaseModel):
    x: float = 0.5
    y: float = 0.5
    scale: float = 0.22
    roll: float = 0.0


class RigState(BaseModel):
    root: RigRoot
    joints: dict[str, float] = Field(default_factory=dict)


class GeomLandmarks(BaseModel):
    """Shared landmark cloud — t matches project template (hand|pose|face)."""

    landmarks: list[Landmark]
    handedness: Literal["Left", "Right"] | None = None
    rig: RigState | None = None


class GeomHand(GeomLandmarks):
    t: Literal["hand"] = "hand"


class GeomPose(GeomLandmarks):
    t: Literal["pose"] = "pose"


class GeomFace(GeomLandmarks):
    t: Literal["face"] = "face"


class Obj(BaseModel):
    id: str
    kind: Literal["box", "polygon", "hand", "pose", "face"]
    label: str | None = None
    edited: bool = False
    geom: GeomBox | GeomPoly | GeomHand | GeomPose | GeomFace = Field(discriminator="t")


class Doc(BaseModel):
    id: str
    image: str
    objects: list[Obj]
    url: str | None = None


class Project(BaseModel):
    id: str
    name: str
    type: Literal["boxes", "polygons", "keypoints"]
    template: Literal["hand", "pose", "face"] | None = None
    classes: list[str]
