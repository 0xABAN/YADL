from __future__ import annotations

import json
import os
from collections.abc import Iterable, Mapping
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import psycopg
from psycopg.rows import dict_row


@dataclass(frozen=True)
class HandSample:
    image: str
    label: str
    landmarks: np.ndarray
    handedness: str | None
    episode: str | None = None
    source: str = "yadl"
    partition: str | None = None


@dataclass(frozen=True)
class HandDataset:
    classes: tuple[str, ...]
    samples: tuple[HandSample, ...]


def load_project_samples(project_id: str, *, env_file: Path) -> HandDataset:
    """Load committed landmarks for one YADL project."""
    database_url = os.environ.get("DATABASE_URL")
    if not database_url and env_file.exists():
        for line in env_file.read_text().splitlines():
            stripped = line.strip()
            if stripped.startswith("export "):
                stripped = stripped[7:].strip()
            key, separator, value = stripped.partition("=")
            if separator and key.strip() == "DATABASE_URL":
                database_url = value.strip().strip("\"'")
                break
    if not database_url:
        raise RuntimeError(f"DATABASE_URL missing from environment and {env_file}")

    with (
        psycopg.connect(database_url, row_factory=dict_row) as connection,
        connection.cursor() as cursor,
    ):
        cursor.execute(
            "select type, template, classes from projects where id=%s",
            (project_id,),
        )
        project = cursor.fetchone()
        if project is None:
            raise ValueError(f"project {project_id!r} was not found")
        cursor.execute(
            """select filename, objects from images
               where project_id=%s and committed and deleted_at is null
               order by created_at, id""",
            (project_id,),
        )
        rows = cursor.fetchall()
    return samples_from_rows(project, rows)


def samples_from_rows(
    project: Mapping[str, object], rows: Iterable[Mapping[str, object]]
) -> HandDataset:
    if (
        project.get("type") not in ("keypoints", "hands")
        or project.get("template") != "hand"
    ):
        raise ValueError("project must contain hand keypoints")
    classes = tuple(str(label) for label in project.get("classes", []))
    samples: list[HandSample] = []
    for row in rows:
        for raw in row.get("objects", []):
            obj = dict(raw)
            label = str(obj.get("label") or "")
            if label not in classes:
                raise ValueError(f"unknown label {label!r}")
            geom = dict(obj.get("geom") or {})
            landmarks = np.asarray(
                [
                    [point[axis] for axis in ("x", "y", "z")]
                    for point in geom["landmarks"]
                ],
                dtype=np.float32,
            )
            samples.append(
                HandSample(
                    image=str(row["filename"]),
                    label=label,
                    landmarks=landmarks,
                    handedness=geom.get("handedness"),
                )
            )
    return HandDataset(classes, tuple(samples))


def samples_from_landmark_records(
    records: Iterable[Mapping[str, object]],
) -> HandDataset:
    classes: list[str] = []
    samples: list[HandSample] = []
    for record in records:
        label = str(record.get("label") or "").strip()
        session_id = str(record.get("session_id") or "").strip()
        episode_id = str(record.get("episode_id") or "").strip()
        if not label or not session_id or not episode_id:
            raise ValueError(
                "landmark records require label, session_id, and episode_id"
            )
        if label not in classes:
            classes.append(label)
        raw_landmarks = record.get("landmarks")
        partition = str(record.get("partition") or "train")
        if partition not in {"train", "validation"}:
            raise ValueError("landmark record partition must be train or validation")
        if raw_landmarks is None:
            continue
        landmarks = np.asarray(raw_landmarks, dtype=np.float32)
        if landmarks.shape != (21, 3) or not np.isfinite(landmarks).all():
            raise ValueError("landmark records require 21 finite xyz points")
        samples.append(
            HandSample(
                image=f"{session_id}:{record.get('timestamp_ms', len(samples))}",
                label=label,
                landmarks=landmarks,
                handedness=None,
                episode=f"{session_id}:{episode_id}",
                source="webcam",
                partition=partition,
            )
        )
    return HandDataset(tuple(classes), tuple(samples))


def load_landmark_sessions(paths: Iterable[Path]) -> HandDataset:
    records: list[Mapping[str, object]] = []
    for path in paths:
        line_number = 0
        try:
            for line_number, line in enumerate(path.read_text().splitlines(), start=1):
                if not line.strip():
                    continue
                value = json.loads(line)
                if not isinstance(value, dict):
                    raise TypeError("record must be a JSON object")
                records.append(value)
        except (OSError, json.JSONDecodeError, TypeError, ValueError) as exc:
            raise ValueError(
                f"invalid landmark session {path}:{line_number}: {exc}"
            ) from exc
    return samples_from_landmark_records(records)


def merge_datasets(primary: HandDataset, *supplements: HandDataset) -> HandDataset:
    classes = list(primary.classes)
    samples = list(primary.samples)
    for supplement in supplements:
        for label in supplement.classes:
            if label not in classes:
                classes.append(label)
        samples.extend(supplement.samples)
    return HandDataset(tuple(classes), tuple(samples))
