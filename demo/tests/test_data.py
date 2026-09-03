import json
from pathlib import Path

import numpy as np
import pytest

from backend.train.data import (
    HandDataset,
    load_landmark_sessions,
    merge_datasets,
    samples_from_landmark_records,
    samples_from_rows,
)


def _object(label: str, *, handedness: str = "Left") -> dict:
    return {
        "label": label,
        "kind": "hand",
        "geom": {
            "t": "hand",
            "handedness": handedness,
            "landmarks": [
                {"x": i / 21, "y": (i + 1) / 21, "z": i / 210} for i in range(21)
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
        samples_from_rows({"type": "boxes", "template": None, "classes": ["fist"]}, [])

    with pytest.raises(ValueError, match="unknown label"):
        samples_from_rows(
            {"type": "keypoints", "template": "hand", "classes": ["fist"]},
            [{"filename": "frame.jpg", "objects": [_object("open")]}],
        )


def test_landmark_records_preserve_session_episode_and_ignore_no_hand() -> None:
    landmarks = [[i / 21, (i + 1) / 21, i / 210] for i in range(21)]
    dataset = samples_from_landmark_records(
        [
            {
                "session_id": "train-1",
                "episode_id": "neutral-1",
                "timestamp_ms": 10,
                "label": "neutral",
                "partition": "validation",
                "landmarks": landmarks,
            },
            {
                "session_id": "train-1",
                "episode_id": "neutral-1",
                "timestamp_ms": 20,
                "label": "neutral",
                "landmarks": None,
            },
        ]
    )

    assert dataset.classes == ("neutral",)
    assert len(dataset.samples) == 1
    assert dataset.samples[0].episode == "train-1:neutral-1"
    assert dataset.samples[0].source == "webcam"
    assert dataset.samples[0].partition == "validation"


def test_merge_datasets_appends_new_classes_without_reordering_existing() -> None:
    primary = HandDataset(("open", "fist"), ())
    supplement = HandDataset(("neutral", "fist"), ())

    merged = merge_datasets(primary, supplement)

    assert merged.classes == ("open", "fist", "neutral")


def test_load_landmark_sessions_reads_jsonl_files(tmp_path: Path) -> None:
    landmarks = [[i / 21, (i + 1) / 21, i / 210] for i in range(21)]
    path = tmp_path / "capture.jsonl"
    path.write_text(
        json.dumps(
            {
                "session_id": "validation",
                "episode_id": "fist-1",
                "timestamp_ms": 10,
                "label": "fist",
                "landmarks": landmarks,
            }
        )
        + "\n"
    )

    dataset = load_landmark_sessions([path])

    assert dataset.classes == ("fist",)
    assert dataset.samples[0].episode == "validation:fist-1"


def test_load_landmark_sessions_reports_missing_file(tmp_path: Path) -> None:
    path = tmp_path / "missing.jsonl"

    with pytest.raises(ValueError, match=r"missing\.jsonl:.*No such file"):
        load_landmark_sessions([path])
