from __future__ import annotations

import json
import os
from typing import Annotated, Literal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from pydantic import BaseModel, ConfigDict, Field

from backend.api.deps import uid
from backend.infra.augmentation_store import (
    cancel_job,
    create_job,
    get_job,
    list_jobs,
    note_cancel_failure,
    provider_predictions,
    record_provider_result,
    retry_job,
)
from backend.infra.wavespeed import WaveSpeedClient, WaveSpeedError, verify_webhook

router = APIRouter(tags=["augmentations"])


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class Flip(StrictModel):
    op: Literal["flip"]
    axis: Literal["horizontal", "vertical"] = "horizontal"
    probability: float = Field(1, ge=0, le=1)


class Affine(StrictModel):
    op: Literal["affine"]
    rotate_degrees: float = Field(0, ge=-360, le=360)
    translate_x: float = Field(0, ge=-1, le=1)
    translate_y: float = Field(0, ge=-1, le=1)
    scale: float = Field(1, gt=0, le=10)
    shear_degrees: float = Field(0, ge=-89, le=89)
    probability: float = Field(1, ge=0, le=1)


class CropResize(StrictModel):
    op: Literal["crop_resize"]
    x: float = Field(0, ge=0, le=1)
    y: float = Field(0, ge=0, le=1)
    width: float = Field(1, gt=0, le=1)
    height: float = Field(1, gt=0, le=1)
    probability: float = Field(1, ge=0, le=1)


class BrightnessContrast(StrictModel):
    op: Literal["brightness_contrast"]
    brightness: float = Field(1, ge=0, le=4)
    contrast: float = Field(1, ge=0, le=4)
    probability: float = Field(1, ge=0, le=1)


class HueSaturation(StrictModel):
    op: Literal["hue_saturation"]
    hue_degrees: float = Field(0, ge=-180, le=180)
    saturation: float = Field(1, ge=0, le=4)
    probability: float = Field(1, ge=0, le=1)


class Blur(StrictModel):
    op: Literal["blur"]
    radius: float = Field(1, ge=0, le=100)
    probability: float = Field(1, ge=0, le=1)


class Noise(StrictModel):
    op: Literal["noise"]
    sigma: float = Field(8, ge=0, le=255)
    probability: float = Field(1, ge=0, le=1)


class Compression(StrictModel):
    op: Literal["compression"]
    quality: int = Field(75, ge=1, le=100)
    probability: float = Field(1, ge=0, le=1)


TransformOperation = Annotated[
    Flip | Affine | CropResize | BrightnessContrast | HueSaturation | Blur | Noise | Compression,
    Field(discriminator="op"),
]


class TransformRequest(StrictModel):
    mode: Literal["transform"]
    source_image_ids: list[UUID] = Field(min_length=1)
    variants_per_source: int = Field(ge=1)
    seed: int = 0
    pipeline: list[TransformOperation] = Field(min_length=1)


class WaveOptions(StrictModel):
    prompt: str = Field(min_length=1, max_length=32000)
    aspect_ratio: Literal["1:1", "3:2", "2:3", "16:9", "9:16"] = "1:1"
    resolution: Literal["1k", "2k", "4k"] = "1k"
    quality: Literal["low", "medium", "high"] = "medium"
    output_format: Literal["png", "jpeg", "webp"] = "png"


class TextToImageRequest(WaveOptions):
    mode: Literal["text_to_image"]
    count: int = Field(ge=1)


class ImageEditRequest(WaveOptions):
    mode: Literal["image_edit"]
    source_image_ids: list[UUID] = Field(min_length=1)
    variants_per_source: int = Field(ge=1)


AugmentationRequest = Annotated[
    TransformRequest | TextToImageRequest | ImageEditRequest,
    Field(discriminator="mode"),
]


@router.post("/projects/{pid}/augmentation-jobs", status_code=201)
def create_augmentation_job(pid: str, body: AugmentationRequest, user: str = Depends(uid)):
    config = body.model_dump(mode="json", exclude={"mode"})
    try:
        row = create_job(pid, user, body.mode, config)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    if row is None:
        raise HTTPException(404)
    return row


@router.get("/projects/{pid}/augmentation-jobs")
def list_augmentation_jobs(
    pid: str,
    offset: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=100),
    user: str = Depends(uid),
):
    rows = list_jobs(pid, user, offset=offset, limit=limit)
    if rows is None:
        raise HTTPException(404)
    return rows


@router.get("/projects/{pid}/augmentation-jobs/{job_id}")
def get_augmentation_job(
    pid: str,
    job_id: str,
    item_offset: int = Query(0, ge=0),
    item_limit: int = Query(100, ge=1, le=200),
    user: str = Depends(uid),
):
    row = get_job(pid, job_id, user, item_offset=item_offset, item_limit=item_limit)
    if row is None:
        raise HTTPException(404)
    return row


@router.post("/projects/{pid}/augmentation-jobs/{job_id}/cancel")
def cancel_augmentation_job(pid: str, job_id: str, user: str = Depends(uid)):
    row = cancel_job(pid, job_id, user)
    if row is None:
        raise HTTPException(404)
    prediction_ids = provider_predictions(job_id)
    if prediction_ids:
        try:
            WaveSpeedClient().delete(prediction_ids)
        except WaveSpeedError as exc:
            warning = f"provider cancellation failed: {exc}"
            note_cancel_failure(job_id, warning)
            row["warning"] = warning
    return row


@router.post("/projects/{pid}/augmentation-jobs/{job_id}/retry")
def retry_augmentation_job(pid: str, job_id: str, user: str = Depends(uid)):
    row = retry_job(pid, job_id, user)
    if row is None:
        raise HTTPException(404)
    return row


@router.post("/augmentation-callbacks/{item_id}", status_code=202)
async def wavespeed_callback(item_id: str, request: Request):
    body = await request.body()
    secret = os.environ.get("WAVESPEED_WEBHOOK_SECRET", "")
    if not secret:
        raise HTTPException(503, "webhook secret is not configured")
    if not verify_webhook(body, request.headers, secret):
        raise HTTPException(401, "invalid webhook signature")
    try:
        payload = json.loads(body)
    except (json.JSONDecodeError, UnicodeDecodeError) as exc:
        raise HTTPException(400, "invalid webhook payload") from exc
    if not isinstance(payload, dict):
        raise HTTPException(400, "invalid webhook payload")
    if not record_provider_result(item_id, payload):
        raise HTTPException(404)
    return Response(status_code=202)
