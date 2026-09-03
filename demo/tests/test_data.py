import numpy as np
import pytest

from backend.train.data import samples_from_rows


def _object(label: str, *, handedness: str = "Left") -> dict:
    return {
        "label": label,
        "kind": "hand",
        "geom": {
            "t": "hand",
            "handedness": handedness,
            "landmarks": [
                {"x": i / 21, "y": (i + 1) / 21, "z": i / 210}
                for i in range(21)
            ],
        },
    }


def test_samples_from_rows_preserves_project_class_order_and_landmarks() -> None:
    project = {
        "type": "keypoints",
        "template": "hand",
        "classes": ["thumbs_up", "fist"],
    }
    rows = [
        {"filename": "frame-0001.jpg", "objects": [_object("fist")]},
        {"filename": "frame-0002.jpg", "objects": [_object("thumbs_up")]},
    ]

    dataset = samples_from_rows(project, rows)

    assert dataset.classes == ("thumbs_up", "fist")
    assert [sample.label for sample in dataset.samples] == ["fist", "thumbs_up"]
    assert dataset.samples[0].landmarks.shape == (21, 3)
    assert dataset.samples[0].landmarks.dtype == np.float32
    assert dataset.samples[0].handedness == "Left"


def test_samples_from_rows_rejects_non_hand_projects_and_unknown_labels() -> None:
    with pytest.raises(ValueError, match="hand keypoints"):
        samples_from_rows(
            {"type": "boxes", "template": None, "classes": ["fist"]}, []
        )

    with pytest.raises(ValueError, match="unknown label"):
        samples_from_rows(
            {"type": "keypoints", "template": "hand", "classes": ["fist"]},
            [{"filename": "frame.jpg", "objects": [_object("open")]}],
        )
