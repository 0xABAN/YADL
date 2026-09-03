"""Deterministic classic augmentation and item-planning tests."""
from __future__ import annotations

import io
import sys
from pathlib import Path
from unittest.mock import patch

import numpy as np
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from backend.domain.augment import InvalidImageError, apply_pipeline, plan_items


def _png() -> bytes:
    pixels = np.zeros((12, 16, 3), dtype=np.uint8)
    pixels[:, :8] = (240, 20, 10)
    pixels[:, 8:] = (10, 50, 220)
    out = io.BytesIO()
    Image.fromarray(pixels, "RGB").save(out, format="PNG")
    return out.getvalue()


def _solid_png(width: int, height: int) -> bytes:
    out = io.BytesIO()
    Image.new("RGB", (width, height), (40, 80, 120)).save(out, format="PNG")
    return out.getvalue()


def test_seeded_noise_is_deterministic_and_seed_sensitive() -> None:
    pipeline = [{"op": "noise", "sigma": 18}]
    first = apply_pipeline(_png(), pipeline, seed=41)
    again = apply_pipeline(_png(), pipeline, seed=41)
    other = apply_pipeline(_png(), pipeline, seed=42)
    assert first.body == again.body
    assert first.body != other.body
    assert first.content_type == "image/png"


def test_pipeline_order_is_observable() -> None:
    crop = {"op": "crop_resize", "x": 0, "y": 0, "width": 0.5, "height": 1}
    flip = {"op": "flip", "axis": "horizontal"}
    cropped_then_flipped = apply_pipeline(_png(), [crop, flip], seed=1).body
    flipped_then_cropped = apply_pipeline(_png(), [flip, crop], seed=1).body
    assert cropped_then_flipped != flipped_then_cropped


def test_crop_resize_keeps_at_least_one_pixel_for_tiny_images() -> None:
    result = apply_pipeline(
        _solid_png(1, 1),
        [{"op": "crop_resize", "x": 0.1, "y": 0.1, "width": 0.1, "height": 0.1}],
        seed=1,
    )
    with Image.open(io.BytesIO(result.body)) as image:
        assert image.size == (1, 1)
        assert image.getpixel((0, 0)) == (40, 80, 120)


def test_corrupt_image_is_rejected() -> None:
    try:
        apply_pipeline(b"not an image", [], seed=0)
        raise AssertionError("expected InvalidImageError")
    except InvalidImageError:
        pass


def test_item_plan_preallocates_stable_output_ids_and_keys() -> None:
    first = plan_items(
        owner_id="owner",
        project_id="00000000-0000-0000-0000-000000000010",
        job_id="00000000-0000-0000-0000-000000000020",
        mode="transform",
        source_image_ids=["00000000-0000-0000-0000-000000000030"],
        variants_per_source=2,
        count=0,
        extension="png",
    )
    second = plan_items(
        owner_id="owner",
        project_id="00000000-0000-0000-0000-000000000010",
        job_id="00000000-0000-0000-0000-000000000020",
        mode="transform",
        source_image_ids=["00000000-0000-0000-0000-000000000030"],
        variants_per_source=2,
        count=0,
        extension="png",
    )
    assert first == second
    assert len(first) == 2
    assert len({item.output_image_id for item in first}) == 2
    assert all(item.output_key.startswith("owner/00000000-0000-0000-0000-000000000010/") for item in first)


def test_job_contract_rejects_empty_sources_but_has_no_output_cap() -> None:
    from pydantic import TypeAdapter, ValidationError

    from backend.api.augmentations import AugmentationRequest

    adapter = TypeAdapter(AugmentationRequest)
    try:
        adapter.validate_python(
            {"mode": "transform", "source_image_ids": [], "variants_per_source": 1, "pipeline": []}
        )
        raise AssertionError("expected source validation failure")
    except ValidationError:
        pass
    value = adapter.validate_python(
        {
            "mode": "text_to_image",
            "prompt": "A red bicycle in a studio",
            "count": 1001,
            "aspect_ratio": "1:1",
            "resolution": "1k",
            "quality": "medium",
            "output_format": "png",
        }
    )
    assert value.count == 1001


def test_job_contract_rejects_crop_extending_past_image_bounds() -> None:
    from pydantic import TypeAdapter, ValidationError

    from backend.api.augmentations import AugmentationRequest

    try:
        TypeAdapter(AugmentationRequest).validate_python(
            {
                "mode": "transform",
                "source_image_ids": ["00000000-0000-0000-0000-000000000001"],
                "variants_per_source": 1,
                "pipeline": [
                    {"op": "crop_resize", "x": 0.8, "y": 0, "width": 0.5, "height": 1}
                ],
            }
        )
        raise AssertionError("expected crop validation failure")
    except ValidationError:
        pass


def test_job_contract_rejects_duplicate_sources() -> None:
    from pydantic import TypeAdapter, ValidationError

    from backend.api.augmentations import AugmentationRequest

    source_id = "00000000-0000-0000-0000-000000000001"
    for mode, extra in (
        ("transform", {"pipeline": [{"op": "flip"}]}),
        ("image_edit", {"prompt": "edit this image"}),
    ):
        try:
            TypeAdapter(AugmentationRequest).validate_python(
                {
                    "mode": mode,
                    "source_image_ids": [source_id, source_id],
                    "variants_per_source": 1,
                    **extra,
                }
            )
            raise AssertionError("expected duplicate source validation failure")
        except ValidationError:
            pass


def test_job_contract_rejects_whitespace_only_generation_prompt() -> None:
    from pydantic import TypeAdapter, ValidationError

    from backend.api.augmentations import AugmentationRequest

    try:
        TypeAdapter(AugmentationRequest).validate_python(
            {"mode": "text_to_image", "prompt": "   ", "count": 1}
        )
        raise AssertionError("expected prompt validation failure")
    except ValidationError:
        pass


def test_worker_surfaces_corrupt_transform_sources() -> None:
    from backend import worker

    item = {
        "id": "item",
        "job_id": "job",
        "mode": "transform",
        "config": {"seed": 1, "pipeline": [{"op": "flip", "axis": "horizontal"}]},
        "source_s3_key": "source",
        "ordinal": 0,
    }
    with (
        patch.object(worker.jobs, "claim_item", return_value=item),
        patch.object(worker.s3, "read", return_value=b"corrupt"),
        patch.object(worker.jobs, "fail_item") as failed,
    ):
        assert worker.run_once() is True
    assert "decoded" in failed.call_args.args[2]


if __name__ == "__main__":
    test_seeded_noise_is_deterministic_and_seed_sensitive()
    test_pipeline_order_is_observable()
    test_crop_resize_keeps_at_least_one_pixel_for_tiny_images()
    test_corrupt_image_is_rejected()
    test_item_plan_preallocates_stable_output_ids_and_keys()
    test_job_contract_rejects_empty_sources_but_has_no_output_cap()
    test_job_contract_rejects_crop_extending_past_image_bounds()
    test_job_contract_rejects_duplicate_sources()
    test_job_contract_rejects_whitespace_only_generation_prompt()
    test_worker_surfaces_corrupt_transform_sources()
    print("ok")
