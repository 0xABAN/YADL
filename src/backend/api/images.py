import subprocess
import tempfile
import zipfile
from io import BytesIO
from pathlib import Path

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from pydantic import BaseModel

from backend.api.deps import uid
from backend.domain.models import Doc
from backend.infra.store import (
    add_comment,
    add_images,
    commit_image,
    count_images,
    delete_comment,
    delete_image,
    get_image,
    list_images,
    put_objects,
    restore_image,
)

router = APIRouter(tags=["images"])

OK = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".webp": "image/webp",
    ".avif": "image/avif",
    ".bmp": "image/bmp",
    ".heic": "image/heic",
    ".heif": "image/heif",
}
VIDEO = {".mp4", ".mov", ".webm", ".mkv"}
MAX_N, MAX_B = 500, 100 * 1024 * 1024


class CommentIn(BaseModel):
    body: str


def flatten(name: str, body: bytes) -> list[tuple[str, bytes, str]]:
    ext = Path(name).suffix.lower()
    if ext == ".zip":
        out: list[tuple[str, bytes, str]] = []
        n = 0
        try:
            zf = zipfile.ZipFile(BytesIO(body))
        except zipfile.BadZipFile:
            raise HTTPException(400, "files") from None
        with zf as z:
            for info in z.infolist():
                parts = Path(info.filename).parts
                fn = parts[-1] if parts else ""
                if info.is_dir() or not fn or fn.startswith(".") or "__MACOSX" in parts:
                    continue
                ct = OK.get(Path(fn).suffix.lower())
                if not ct:
                    continue
                data = z.read(info)
                n += len(data)
                if n > MAX_B or len(out) >= MAX_N:
                    raise HTTPException(400, "files")
                out.append((fn, data, ct))
        return out
    ct = OK.get(ext)
    return [(Path(name).name or "image.jpg", body, ct)] if ct else []


def frames_from_video(
    name: str, body: bytes, interval: float, room: int
) -> list[tuple[str, bytes, str]]:
    """ffmpeg fixed-interval JPEGs. room = slots left under MAX_N."""
    if not 0.1 <= interval <= 5:
        raise HTTPException(400, "interval")
    if room <= 0:
        raise HTTPException(400, "files")
    ext = Path(name).suffix.lower() or ".mp4"
    stem = Path(name).stem or "video"
    with tempfile.TemporaryDirectory() as td:
        root = Path(td)
        src = root / f"in{ext}"
        src.write_bytes(body)
        pat = root / "f_%06d.jpg"
        try:
            subprocess.run(
                [
                    "ffmpeg",
                    "-hide_banner",
                    "-loglevel",
                    "error",
                    "-y",
                    "-i",
                    str(src),
                    "-vf",
                    f"fps=1/{interval}",
                    "-q:v",
                    "2",
                    str(pat),
                ],
                check=True,
                capture_output=True,
                timeout=600,
            )
        except FileNotFoundError as e:
            raise HTTPException(500, "ffmpeg") from e
        except (subprocess.CalledProcessError, subprocess.TimeoutExpired) as e:
            raise HTTPException(400, "video") from e
        out: list[tuple[str, bytes, str]] = []
        for i, p in enumerate(sorted(root.glob("f_*.jpg"))):
            if i >= room:
                break
            t = i * interval
            fn = f"{stem}_t{t:g}.jpg"
            out.append((fn, p.read_bytes(), "image/jpeg"))
        if not out:
            raise HTTPException(400, "video")
        return out


@router.get("/projects/{pid}/images")
def images(pid: str, user: str = Depends(uid)):
    rows = list_images(pid, user)
    if rows is None:
        raise HTTPException(404)
    return rows


@router.post("/projects/{pid}/images")
async def upload(
    pid: str,
    interval: float = 1.0,
    user: str = Depends(uid),
    files: list[UploadFile] = File(),
):
    if not 0.1 <= interval <= 5:
        raise HTTPException(400, "interval")
    n = count_images(pid, user)
    if n is None:
        raise HTTPException(404)
    room = MAX_N - n
    if room <= 0:
        raise HTTPException(400, "files")

    blobs: list[tuple[str, bytes, str]] = []
    total_in = 0
    for f in files:
        body = await f.read()
        total_in += len(body)
        if total_in > MAX_B:
            raise HTTPException(400, "files")
        name = f.filename or ""
        ext = Path(name).suffix.lower()
        if ext in VIDEO:
            left = room - len(blobs)
            blobs.extend(frames_from_video(name, body, interval, left))
        else:
            blobs.extend(flatten(name, body))
        if len(blobs) > room:
            raise HTTPException(400, "files")
    if not blobs:
        raise HTTPException(400, "files")
    rows = add_images(pid, user, blobs)
    if rows is None:
        raise HTTPException(404)
    return rows


@router.get("/projects/{pid}/images/{iid}")
def image(pid: str, iid: str, user: str = Depends(uid)):
    row = get_image(pid, iid, user)
    if not row:
        raise HTTPException(404)
    return row


@router.delete("/projects/{pid}/images/{iid}")
def drop_image(pid: str, iid: str, user: str = Depends(uid)):
    row = delete_image(pid, iid, user)
    if not row:
        raise HTTPException(404)
    return row


@router.post("/projects/{pid}/images/{iid}/restore")
def undelete_image(pid: str, iid: str, user: str = Depends(uid)):
    row = restore_image(pid, iid, user)
    if not row:
        raise HTTPException(404)
    return row


@router.put("/projects/{pid}/images/{iid}")
def save(pid: str, iid: str, body: Doc, user: str = Depends(uid)):
    row = put_objects(pid, iid, user, [o.model_dump() for o in body.objects])
    if not row:
        raise HTTPException(404)
    return row


@router.post("/projects/{pid}/images/{iid}/commit")
def commit(pid: str, iid: str, user: str = Depends(uid)):
    try:
        row = commit_image(pid, iid, user)
    except ValueError:
        raise HTTPException(400)
    if not row:
        raise HTTPException(404)
    return row


@router.post("/projects/{pid}/images/{iid}/comments")
def post_comment(pid: str, iid: str, body: CommentIn, user: str = Depends(uid)):
    try:
        row = add_comment(pid, iid, user, body.body)
    except ValueError:
        raise HTTPException(400, "empty")
    if not row:
        raise HTTPException(404)
    return row


@router.delete("/projects/{pid}/images/{iid}/comments/{cid}")
def drop_comment(pid: str, iid: str, cid: str, user: str = Depends(uid)):
    row = delete_comment(pid, iid, user, cid)
    if not row:
        raise HTTPException(404)
    return row
