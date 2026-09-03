from __future__ import annotations

import io
import math
import uuid
from dataclasses import dataclass
from typing import Any, Literal

import numpy as np
from PIL import Image, ImageEnhance, ImageFilter, ImageOps, UnidentifiedImageError


class InvalidImageError(ValueError):
    pass


@dataclass(frozen=True)
class AugmentedImage:
    body: bytes
    content_type: str
    extension: str


@dataclass(frozen=True)
class PlannedItem:
    id: str
    ordinal: int
    source_image_id: str | None
    output_image_id: str
    output_key: str
    filename: str


def plan_items(
    *,
    owner_id: str,
    project_id: str,
    job_id: str,
    mode: Literal["transform", "text_to_image", "image_edit"],
    source_image_ids: list[str],
    variants_per_source: int,
    count: int,
    extension: str,
) -> list[PlannedItem]:
    namespace = uuid.UUID(job_id)
    sources = (
        [source for source in source_image_ids for _ in range(variants_per_source)]
        if mode != "text_to_image"
        else [None] * count
    )
    items: list[PlannedItem] = []
    for ordinal, source in enumerate(sources):
        item_id = uuid.uuid5(namespace, f"item:{ordinal}")
        output_id = uuid.uuid5(item_id, "output")
        filename = f"augmentation-{ordinal + 1:04d}.{extension}"
        items.append(
            PlannedItem(
                id=str(item_id),
                ordinal=ordinal,
                source_image_id=source,
                output_image_id=str(output_id),
                output_key=f"{owner_id}/{project_id}/{output_id}/{filename}",
                filename=filename,
            )
        )
    return items


def _open(body: bytes) -> Image.Image:
    try:
        image = Image.open(io.BytesIO(body))
        image.load()
        image = ImageOps.exif_transpose(image)
        return image.convert("RGB")
    except (UnidentifiedImageError, OSError, ValueError) as exc:
        raise InvalidImageError("source image could not be decoded") from exc


def _number(op: dict[str, Any], name: str, default: float) -> float:
    value = op.get(name, default)
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        raise ValueError(f"invalid {name}")
    return float(value)


def _encode(image: Image.Image, fmt: str, *, quality: int = 92) -> bytes:
    out = io.BytesIO()
    if fmt == "JPEG":
        image.convert("RGB").save(out, format=fmt, quality=quality, optimize=False)
    else:
        image.save(out, format=fmt)
    return out.getvalue()


def apply_pipeline(body: bytes, pipeline: list[dict[str, Any]], *, seed: int) -> AugmentedImage:
    image = _open(body)
    rng = np.random.default_rng(seed)
    for raw in pipeline:
        op = dict(raw)
        probability = _number(op, "probability", 1)
        if probability < 0 or probability > 1:
            raise ValueError("probability must be between 0 and 1")
        if rng.random() > probability:
            continue
        kind = op.get("op")
        if kind == "flip":
            axis = op.get("axis", "horizontal")
            if axis == "horizontal":
                image = ImageOps.mirror(image)
            elif axis == "vertical":
                image = ImageOps.flip(image)
            else:
                raise ValueError("invalid flip axis")
        elif kind == "affine":
            angle = _number(op, "rotate_degrees", 0)
            scale = _number(op, "scale", 1)
            tx = _number(op, "translate_x", 0)
            ty = _number(op, "translate_y", 0)
            shear = _number(op, "shear_degrees", 0)
            if scale <= 0:
                raise ValueError("scale must be positive")
            width, height = image.size
            if scale != 1:
                scaled = image.resize(
                    (max(1, round(width * scale)), max(1, round(height * scale))),
                    Image.Resampling.BICUBIC,
                )
                image = ImageOps.fit(scaled, (width, height), method=Image.Resampling.BICUBIC)
            if shear:
                tangent = math.tan(math.radians(shear))
                image = image.transform(
                    image.size,
                    Image.Transform.AFFINE,
                    (1, tangent, -tangent * height / 2, 0, 1, 0),
                    resample=Image.Resampling.BICUBIC,
                )
            image = image.rotate(angle, resample=Image.Resampling.BICUBIC)
            if tx or ty:
                image = image.transform(
                    image.size,
                    Image.Transform.AFFINE,
                    (1, 0, -tx * width, 0, 1, -ty * height),
                    resample=Image.Resampling.BICUBIC,
                )
        elif kind == "crop_resize":
            x = _number(op, "x", 0)
            y = _number(op, "y", 0)
            width = _number(op, "width", 1)
            height = _number(op, "height", 1)
            if x < 0 or y < 0 or width <= 0 or height <= 0 or x + width > 1 or y + height > 1:
                raise ValueError("crop must fit inside the image")
            original = image.size
            left = min(original[0] - 1, math.floor(x * original[0]))
            top = min(original[1] - 1, math.floor(y * original[1]))
            box = (
                left,
                top,
                max(left + 1, math.ceil((x + width) * original[0])),
                max(top + 1, math.ceil((y + height) * original[1])),
            )
            image = image.crop(box).resize(original, Image.Resampling.LANCZOS)
        elif kind == "brightness_contrast":
            image = ImageEnhance.Brightness(image).enhance(_number(op, "brightness", 1))
            image = ImageEnhance.Contrast(image).enhance(_number(op, "contrast", 1))
        elif kind == "hue_saturation":
            hue = _number(op, "hue_degrees", 0)
            saturation = _number(op, "saturation", 1)
            hsv = np.asarray(image.convert("HSV"), dtype=np.uint16).copy()
            hsv[:, :, 0] = (hsv[:, :, 0] + round(hue * 255 / 360)) % 256
            hsv[:, :, 1] = np.clip(hsv[:, :, 1] * saturation, 0, 255)
            image = Image.fromarray(hsv.astype(np.uint8), "HSV").convert("RGB")
        elif kind == "blur":
            radius = _number(op, "radius", 1)
            if radius < 0:
                raise ValueError("blur radius must be non-negative")
            image = image.filter(ImageFilter.GaussianBlur(radius))
        elif kind == "noise":
            sigma = _number(op, "sigma", 8)
            if sigma < 0:
                raise ValueError("noise sigma must be non-negative")
            pixels = np.asarray(image, dtype=np.float32)
            pixels += rng.normal(0, sigma, pixels.shape)
            image = Image.fromarray(np.clip(pixels, 0, 255).astype(np.uint8), "RGB")
        elif kind == "compression":
            quality = round(_number(op, "quality", 75))
            if quality < 1 or quality > 100:
                raise ValueError("compression quality must be between 1 and 100")
            image = _open(_encode(image, "JPEG", quality=quality))
        else:
            raise ValueError(f"unsupported transform: {kind}")
    return AugmentedImage(_encode(image, "PNG"), "image/png", "png")


def normalize_generated_image(body: bytes, output_format: str) -> AugmentedImage:
    image = _open(body)
    formats = {
        "png": ("PNG", "image/png", "png"),
        "jpeg": ("JPEG", "image/jpeg", "jpg"),
        "jpg": ("JPEG", "image/jpeg", "jpg"),
        "webp": ("WEBP", "image/webp", "webp"),
    }
    try:
        fmt, content_type, extension = formats[output_format]
    except KeyError as exc:
        raise ValueError("unsupported output format") from exc
    return AugmentedImage(_encode(image, fmt), content_type, extension)
