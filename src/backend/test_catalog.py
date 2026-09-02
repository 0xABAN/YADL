"""Catalog pagination and streaming export regression tests."""
from __future__ import annotations

import sys
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from backend.infra import store


def test_list_images_returns_page_and_aggregate_counts() -> None:
    rows = [
        {"id": "00000000-0000-0000-0000-000000000001", "filename": "a.jpg", "committed": True, "empty": False},
        {"id": "00000000-0000-0000-0000-000000000002", "filename": "b.jpg", "committed": False, "empty": True},
    ]
    with (
        patch.object(store, "get_project", return_value={"id": "project"}),
        patch.object(store, "fetch", return_value=rows) as fetch_rows,
        patch.object(
            store,
            "fetchone",
            return_value={"total": 721, "committed": 410, "empty": 29},
        ),
    ):
        page = store.list_images("project", "owner", offset=600, limit=100)

    assert page == {
        "items": [store._image_item(row) for row in rows],
        "total": 721,
        "committed": 410,
        "empty": 29,
        "offset": 600,
        "limit": 100,
    }
    assert "limit %s offset %s" in fetch_rows.call_args.args[0].lower()
    assert fetch_rows.call_args.args[1] == ("project", 100, 600)


def test_export_jsonl_is_lazy_and_skips_uncommitted_images() -> None:
    consumed: list[str] = []

    def rows():
        consumed.append("started")
        yield {"filename": "skip.jpg", "objects": [], "committed": False}
        yield {
            "filename": "keep.jpg",
            "committed": True,
            "objects": [
                {
                    "id": "b1",
                    "kind": "box",
                    "label": "bike",
                    "geom": {"x": 0.1, "y": 0.2, "w": 0.3, "h": 0.4},
                }
            ],
        }

    with (
        patch.object(store, "get_project", return_value={"name": "Dataset"}),
        patch.object(store, "iterate", side_effect=lambda *_args, **_kwargs: rows()),
    ):
        result = store.export_jsonl("project", "owner")
        assert result is not None
        name, body = result
        assert name == "Dataset"
        assert consumed == []
        chunks = list(body)

    assert consumed == ["started"]
    assert len(chunks) == 1
    assert chunks[0].endswith("\n")
    assert '"image":"keep.jpg"' in chunks[0]


def test_commit_accepts_an_empty_reviewed_image() -> None:
    row = {
        "id": "image",
        "filename": "negative.jpg",
        "s3_key": "owner/project/image/negative.jpg",
        "objects": [],
        "history": [],
        "comments": [],
        "committed": False,
    }
    with (
        patch.object(store, "image_row", return_value=row),
        patch.object(store, "execute") as execute,
        patch.object(store, "presign_get", return_value="https://example.test/negative.jpg"),
    ):
        committed = store.commit_image("project", "image", "owner")

    assert committed is not None and committed["committed"] is True
    assert committed["objects"] == []
    execute.assert_called_once()


if __name__ == "__main__":
    test_list_images_returns_page_and_aggregate_counts()
    test_export_jsonl_is_lazy_and_skips_uncommitted_images()
    test_commit_accepts_an_empty_reviewed_image()
    print("ok")
