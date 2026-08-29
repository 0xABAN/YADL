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


class GeomHand(BaseModel):
    t: Literal["hand"]
    landmarks: list[Landmark]
    handedness: Literal["Left", "Right"] | None = None


class Obj(BaseModel):
    id: str
    kind: Literal["box", "polygon", "hand"]
    label: str | None = None
    edited: bool = False
    geom: GeomBox | GeomPoly | GeomHand = Field(discriminator="t")


class Doc(BaseModel):
    id: str
    image: str
    objects: list[Obj]


class Project(BaseModel):
    type: Literal["boxes", "polygons", "hands"]
    classes: list[str]
