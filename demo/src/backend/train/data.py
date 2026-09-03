from __future__ import annotations

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
    if project.get("type") not in ("keypoints", "hands") or project.get("template") != "hand":
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
                [[point[axis] for axis in ("x", "y", "z")] for point in geom["landmarks"]],
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
