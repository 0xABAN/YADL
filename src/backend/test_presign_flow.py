"""Presigned S3 upload flow regressions."""
from __future__ import annotations

import sys
import time
import uuid
import zipfile
from base64 import b64decode
from io import BytesIO
from pathlib import Path
from threading import Lock
from types import SimpleNamespace
from unittest.mock import patch

import pytest
from fastapi import HTTPException
from PIL import Image
from psycopg.errors import ForeignKeyViolation

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from backend.api import images as images_api  # noqa: E402
from backend.api.images import (  # noqa: E402
    CompleteFile,
    CompleteIn,
    PresignFile,
    PresignIn,
    _ctype,
    _kind,
)
from backend.infra import store  # noqa: E402


def png_bytes() -> bytes:
    body = BytesIO()
    Image.new("RGB", (2, 2), "red").save(body, "PNG")
    return body.getvalue()


HEIF_BYTES = b64decode(
    "AAAAHGZ0eXBoZWljAAAAAG1pZjFoZWljbWlhZgAAAXxtZXRhAAAAAAAAACFoZGxyAAAAAAAAAABw"
    "aWN0AAAAAAAAAAAAAAAAAAAAACJpbG9jAAAAAERAAAEAAQAAAAABoAABAAAAAAAAADQAAAAjaWlu"
    "ZgAAAAAAAQAAABVpbmZlAgAAAAABAABodmMxAAAAAA5waXRtAAAAAAABAAAA/GlwcnAAAADcaXBj"
    "bwAAAHVodmNDAQNwAAAAAAAAAAAAHvAA/P34+AAADwNgAAEAGEABDAH//wNwAAADAJAAAAMAAAMA"
    "HroCQGEAAQApQgEBA3AAAAMAkAAAAwAAAwAeoCCBBZbqrprm4CGgwIAAAAyAAAADAIRiAAEABkQB"
    "wXPBiQAAABNjb2xybmNseAABAA0ABoAAAAAUaXNwZQAAAAAAAABAAAAAQAAAAChjbGFwAAAAAgAA"
    "AAEAAAACAAAAAf///8IAAAAC////wgAAAAIAAAAQcGl4aQAAAAADCAgIAAAAGGlwbWEAAAAAAAAA"
    "AQABBYECAwWEAAAAPG1kYXQAAAAwKAGvEyFmY0D4EPdn/+u8Ff+Vaz/zN7HpzshHQMDSIICbQEiT"
    "XVALFhCAh3alVtz4"
)


def test_complete_rejects_corrupt_image_bytes() -> None:
    def download(_key: str, dest: Path) -> None:
        dest.write_bytes(b"not an image")

    with (
        patch.object(images_api, "count_images", return_value=0),
        patch.object(images_api.s3, "exists", return_value=True),
        patch.object(images_api.s3, "download", side_effect=download),
        patch.object(images_api, "add_image_keys") as add_image_keys,
    ):
        with pytest.raises(HTTPException) as exc:
            images_api.complete_uploads(
                "project",
                CompleteIn(
                    files=[
                        CompleteFile(
                            name="broken.png",
                            key="owner/project/00000000-0000-0000-0000-000000000001/broken.png",
                        )
                    ]
                ),
                "owner",
            )

    assert exc.value.status_code == 400
    assert exc.value.detail == "corrupt:broken.png"
    add_image_keys.assert_not_called()


def test_complete_validates_many_direct_images_concurrently() -> None:
    lock = Lock()
    active = {"exists": 0, "download": 0}
    maximum = {"exists": 0, "download": 0}

    def tracked(kind: str) -> None:
        with lock:
            active[kind] += 1
            maximum[kind] = max(maximum[kind], active[kind])
        time.sleep(0.01)
        with lock:
            active[kind] -= 1

    def exists(_key: str) -> bool:
        tracked("exists")
        return True

    def download(_key: str, dest: Path) -> None:
        tracked("download")
        dest.write_bytes(png_bytes())

    files = [
        CompleteFile(
            name=f"frame-{index}.png",
            key=f"owner/project/{uuid.uuid4()}/frame-{index}.png",
        )
        for index in range(12)
    ]
    registered = [{"id": str(index)} for index in range(len(files))]
    with (
        patch.object(images_api, "count_images", return_value=0),
        patch.object(images_api.s3, "exists", side_effect=exists),
        patch.object(images_api.s3, "download", side_effect=download),
        patch.object(images_api, "add_image_keys", return_value=registered),
    ):
        result = images_api.complete_uploads(
            "project", CompleteIn(files=files), "owner"
        )

    assert result == registered
    assert maximum["exists"] > 1
    assert maximum["download"] > 1


@pytest.mark.parametrize(
    ("size", "detail"),
    [
        (0, "empty:frame.png"),
        (images_api.MAX_B + 1, "too_large:frame.png"),
    ],
)
def test_presign_identifies_invalid_file_size(size: int, detail: str) -> None:
    with (
        patch.object(images_api, "get_project", return_value={"id": "project"}),
        patch.object(images_api.s3, "presign_put") as presign_put,
    ):
        with pytest.raises(HTTPException) as exc:
            images_api.presign_uploads(
                "project",
                PresignIn(files=[PresignFile(name="frame.png", size=size)]),
                "owner",
            )

    assert exc.value.status_code == 400
    assert exc.value.detail == detail
    presign_put.assert_not_called()


def test_complete_rejects_a_modified_presigned_key() -> None:
    key = "owner/project/not-a-uuid/renamed.png"
    with (
        patch.object(images_api, "count_images", return_value=0),
        patch.object(images_api.s3, "exists", return_value=True),
        patch.object(images_api.s3, "download") as download,
        patch.object(images_api, "add_image_keys") as add_image_keys,
    ):
        with pytest.raises(HTTPException) as exc:
            images_api.complete_uploads(
                "project",
                CompleteIn(files=[CompleteFile(name="frame.png", key=key)]),
                "owner",
            )

    assert exc.value.status_code == 400
    assert exc.value.detail == "key"
    download.assert_not_called()
    add_image_keys.assert_not_called()


def test_flatten_rejects_corrupt_image_bytes() -> None:
    with pytest.raises(HTTPException) as exc:
        images_api.flatten("broken.jpg", b"not an image")

    assert exc.value.status_code == 400
    assert exc.value.detail == "corrupt:broken.jpg"


@pytest.mark.parametrize("pixel_limit", [1, 3])
def test_flatten_rejects_decompression_bomb_errors_and_warnings(
    pixel_limit: int,
) -> None:
    with patch.object(Image, "MAX_IMAGE_PIXELS", pixel_limit):
        with pytest.raises(HTTPException) as exc:
            images_api.flatten("oversized.png", png_bytes())

    assert exc.value.status_code == 400
    assert exc.value.detail == "corrupt:oversized.png"


def test_flatten_accepts_valid_heif_image() -> None:
    assert images_api.flatten("phone.heic", HEIF_BYTES) == [
        ("phone.heic", HEIF_BYTES, "image/heic")
    ]


def test_flatten_rejects_oversized_zip_entry_before_decompression() -> None:
    body = BytesIO()
    with zipfile.ZipFile(body, "w", zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("large.png", b"x" * 10)

    class NoReadZip(zipfile.ZipFile):
        def read(self, *_args, **_kwargs):
            raise AssertionError("oversized entry was decompressed")

    with (
        patch.object(images_api, "MAX_B", 5),
        patch.object(images_api.zipfile, "ZipFile", NoReadZip),
    ):
        with pytest.raises(HTTPException) as exc:
            images_api.flatten("images.zip", body.getvalue())

    assert exc.value.status_code == 400
    assert exc.value.detail == "files"


def test_complete_preflights_every_put_before_processing() -> None:
    present = "owner/project/00000000-0000-0000-0000-000000000001/demo.mov"
    missing = "owner/project/00000000-0000-0000-0000-000000000002/frame.png"
    with (
        patch.object(images_api, "count_images", return_value=0),
        patch.object(images_api.s3, "exists", side_effect=lambda key: key == present),
        patch.object(images_api.s3, "download") as download,
        patch.object(images_api.s3, "delete") as delete,
    ):
        with pytest.raises(HTTPException) as exc:
            images_api.complete_uploads(
                "project",
                CompleteIn(
                    files=[
                        CompleteFile(name="demo.mov", key=present),
                        CompleteFile(name="frame.png", key=missing),
                    ]
                ),
                "owner",
            )

    assert exc.value.status_code == 400
    assert exc.value.detail == "missing:frame.png"
    download.assert_not_called()
    delete.assert_not_called()


def test_complete_keeps_source_media_when_registration_fails() -> None:
    key = "owner/project/00000000-0000-0000-0000-000000000001/demo.mov"

    def download(_key: str, dest: Path) -> None:
        dest.write_bytes(b"video")

    with (
        patch.object(images_api, "count_images", return_value=0),
        patch.object(images_api.s3, "exists", return_value=True),
        patch.object(images_api.s3, "download", side_effect=download),
        patch.object(images_api.s3, "delete") as delete,
        patch.object(
            images_api,
            "frames_from_video",
            return_value=[("demo_t0.jpg", png_bytes(), "image/jpeg")],
        ),
        patch.object(images_api, "add_images", return_value=None),
    ):
        with pytest.raises(HTTPException) as exc:
            images_api.complete_uploads(
                "project",
                CompleteIn(files=[CompleteFile(name="demo.mov", key=key)]),
                "owner",
            )

    assert exc.value.status_code == 404
    delete.assert_not_called()


def test_registering_the_same_presigned_image_twice_is_idempotent() -> None:
    key = "owner/project/00000000-0000-0000-0000-000000000001/frame.png"
    inserts = 0

    def insert(sql: str, _params: tuple) -> dict:
        nonlocal inserts
        inserts += 1
        if inserts > 1 and "on conflict" not in sql.lower():
            raise RuntimeError("duplicate key value violates unique constraint images_pkey")
        return {"id": "00000000-0000-0000-0000-000000000001"}

    with (
        patch.object(store, "get_project", return_value={"id": "project"}),
        patch.object(store, "fetchone", side_effect=insert),
    ):
        first = store.add_image_keys("project", "owner", [("frame.png", key)])
        second = store.add_image_keys("project", "owner", [("frame.png", key)])

    assert second == first == [
        {"id": "00000000-0000-0000-0000-000000000001", "filename": "frame.png"}
    ]


def test_registers_a_large_presigned_batch_in_one_database_round_trip() -> None:
    items = [
        (
            f"frame-{i}.png",
            f"owner/project/00000000-0000-0000-0000-{i:012d}/frame-{i}.png",
        )
        for i in range(100)
    ]
    with (
        patch.object(store, "get_project", return_value={"id": "project"}),
        patch.object(store, "fetchone", return_value={"id": items[0][1].split("/")[2]}) as fetchone,
    ):
        rows = store.add_image_keys("project", "owner", items)

    assert rows is not None and len(rows) == 100
    fetchone.assert_called_once()
    sql = fetchone.call_args.args[0].lower()
    assert "with ordinality" in sql
    assert "created_at" in sql


def test_add_images_handles_project_deletion_during_registration() -> None:
    files = [("frame.png", png_bytes(), "image/png")]
    with (
        patch.object(store, "get_project", return_value={"id": "project"}),
        patch.object(store, "put"),
        patch.object(store, "execute", side_effect=RuntimeError("foreign key violation")),
        patch.object(store, "fetchone", return_value=None),
        patch.object(store, "s3_delete") as delete,
    ):
        result = store.add_images("project", "owner", files)

    assert result is None
    delete.assert_called_once()


def test_add_images_cleans_outputs_after_concurrent_project_delete() -> None:
    files = [("frame.png", png_bytes(), "image/png")]
    with (
        patch.object(store, "get_project", return_value={"id": "project"}),
        patch.object(store, "put"),
        patch.object(
            store,
            "fetchone",
            side_effect=ForeignKeyViolation("project deleted while inserting images"),
        ),
        patch.object(store, "s3_delete") as delete,
    ):
        result = store.add_images("project", "owner", files)

    assert result is None
    delete.assert_called_once()


def test_add_images_cleans_the_failed_put_and_prior_outputs() -> None:
    files = [
        ("first.png", png_bytes(), "image/png"),
        ("failed.png", png_bytes(), "image/png"),
    ]
    with (
        patch.object(store, "get_project", return_value={"id": "project"}),
        patch.object(store, "put", side_effect=[None, RuntimeError("upload failed")]),
        patch.object(store, "s3_delete") as delete,
    ):
        with pytest.raises(RuntimeError, match="upload failed"):
            store.add_images("project", "owner", files)

    deleted = [call.args[0] for call in delete.call_args_list]
    assert len(deleted) == 2
    assert deleted[0].endswith("/first.png")
    assert deleted[1].endswith("/failed.png")


def test_add_image_keys_handles_concurrent_project_delete() -> None:
    key = "owner/project/00000000-0000-0000-0000-000000000001/frame.png"
    with (
        patch.object(store, "get_project", return_value={"id": "project"}),
        patch.object(store, "execute", side_effect=ForeignKeyViolation("project deleted")),
        patch.object(store, "fetchone", side_effect=ForeignKeyViolation("project deleted")),
        patch.object(store, "s3_delete") as delete,
    ):
        result = store.add_image_keys("project", "owner", [("frame.png", key)])

    assert result is None
    delete.assert_called_once_with(key)


def test_add_images_registers_extracted_frames_in_one_database_round_trip() -> None:
    files = [(f"frame-{i}.png", png_bytes(), "image/png") for i in range(100)]
    with (
        patch.object(store, "get_project", return_value={"id": "project"}),
        patch.object(store, "put"),
        patch.object(store, "execute") as execute,
        patch.object(store, "fetchone", return_value={"id": "inserted"}) as fetchone,
    ):
        rows = store.add_images("project", "owner", files)

    assert rows is not None and len(rows) == 100
    sql = fetchone.call_args.args[0].lower()
    assert "with ordinality" in sql
    assert "created_at" in sql
    execute.assert_not_called()
    fetchone.assert_called_once()


def discard_endpoint():
    return next(
        (
            route.endpoint
            for route in images_api.router.routes
            if route.path == "/projects/{pid}/images/uploads" and "DELETE" in route.methods
        ),
        None,
    )


def test_discard_uploads_deletes_owned_presigned_keys() -> None:
    endpoint = discard_endpoint()
    assert endpoint is not None
    keys = [
        "owner/project/00000000-0000-0000-0000-000000000001/a.png",
        "owner/project/00000000-0000-0000-0000-000000000002/b.png",
    ]
    with (
        patch.object(images_api, "count_images", return_value=0),
        patch.object(images_api, "registered_image_keys", return_value=set()),
        patch.object(images_api.s3, "delete") as delete,
    ):
        result = endpoint("project", SimpleNamespace(keys=keys), "owner")

    assert result == {"deleted": 2}
    assert [call.args[0] for call in delete.call_args_list] == keys


def test_discard_uploads_rejects_foreign_keys_without_deleting() -> None:
    endpoint = discard_endpoint()
    assert endpoint is not None
    with (
        patch.object(images_api, "count_images", return_value=0),
        patch.object(images_api.s3, "delete") as delete,
    ):
        with pytest.raises(HTTPException) as exc:
            endpoint(
                "project",
                SimpleNamespace(keys=["other/project/id/a.png"]),
                "owner",
            )

    assert exc.value.status_code == 400
    delete.assert_not_called()


def test_discard_uploads_rejects_malformed_owned_keys() -> None:
    endpoint = discard_endpoint()
    assert endpoint is not None
    key = "owner/project/not-a-uuid/a.png"
    with (
        patch.object(images_api, "count_images", return_value=0),
        patch.object(images_api.s3, "delete") as delete,
    ):
        with pytest.raises(HTTPException) as exc:
            endpoint("project", SimpleNamespace(keys=[key]), "owner")

    assert exc.value.status_code == 400
    delete.assert_not_called()


def test_discard_uploads_never_deletes_registered_image_keys() -> None:
    endpoint = discard_endpoint()
    assert endpoint is not None
    key = "owner/project/00000000-0000-0000-0000-000000000001/a.png"
    with (
        patch.object(images_api, "count_images", return_value=1),
        patch.object(images_api, "registered_image_keys", return_value={key}, create=True),
        patch.object(images_api.s3, "delete") as delete,
    ):
        with pytest.raises(HTTPException) as exc:
            endpoint("project", SimpleNamespace(keys=[key]), "owner")

    assert exc.value.status_code == 409
    assert exc.value.detail == "registered"
    delete.assert_not_called()


def test_registered_image_keys_include_soft_deleted_rows() -> None:
    key = "owner/project/00000000-0000-0000-0000-000000000001/a.png"
    assert hasattr(store, "registered_image_keys")
    with patch.object(store, "fetch", return_value=[{"s3_key": key}]) as fetch:
        result = store.registered_image_keys("project", "owner", [key])

    assert result == {key}
    query = fetch.call_args.args[0].lower()
    assert "deleted_at" not in query


def main() -> None:
    assert _kind("a.jpg") == "image"
    assert _kind("a.MP4") is None or _kind("a.mp4") == "video"
    assert _kind("a.mp4") == "video"
    assert _kind("a.zip") == "zip"
    assert _kind("a.txt") is None
    assert _ctype("x.png", "") == "image/png"
    assert _ctype("x.mp4", "video/mp4") == "video/mp4"
    assert _ctype("x.zip", "") == "application/zip"
    print("ok")


if __name__ == "__main__":
    main()
