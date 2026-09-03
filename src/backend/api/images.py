import subprocess
import tempfile
import uuid
import warnings
import zipfile
from concurrent.futures import ThreadPoolExecutor
from io import BytesIO
from pathlib import Path
from urllib.parse import urlparse

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from PIL import Image, UnidentifiedImageError
from pillow_heif import register_heif_opener
from pydantic import BaseModel, Field

from backend.api.deps import uid
from backend.domain.models import Doc
from backend.infra import s3
from backend.infra.store import (
    add_comment,
    add_image_keys,
    add_images,
    commit_image,
    count_images,
    delete_comment,
    delete_image,
    get_image,
    get_project,
    list_images,
    list_project_comments,
    locate_image,
    next_uncommitted_image,
    put_objects,
    registered_image_keys,
    restore_image,
)

register_heif_opener()

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
MAX_B = 100 * 1024 * 1024


class CommentIn(BaseModel):
    body: str


class PresignFile(BaseModel):
    name: str
    content_type: str = ""
    size: int = Field(ge=0)


class PresignIn(BaseModel):
    files: list[PresignFile]


class CompleteFile(BaseModel):
    name: str
    key: str


class CompleteIn(BaseModel):
    files: list[CompleteFile]
    interval: float = 1.0


class DiscardIn(BaseModel):
    keys: list[str] = Field(min_length=1)


class FromUrlIn(BaseModel):
    url: str
    interval: float = 1.0


# Public watch URLs only (no youtu.be user pages, no music.youtube playlists as hosts we expand).
_YT_HOSTS = frozenset(
    {
        "youtube.com",
        "www.youtube.com",
        "m.youtube.com",
        "youtu.be",
        "www.youtu.be",
    }
)


def _ctype(name: str, hinted: str = "") -> str:
    ext = Path(name).suffix.lower()
    if ext in VIDEO:
        return hinted or "application/octet-stream"
    if ext == ".zip":
        return "application/zip"
    return OK.get(ext) or hinted or "application/octet-stream"


def _kind(name: str) -> str | None:
    ext = Path(name).suffix.lower()
    if ext in OK:
        return "image"
    if ext in VIDEO:
        return "video"
    if ext == ".zip":
        return "zip"
    return None


def _upload_key(prefix: str, key: str, name: str) -> bool:
    if not key.startswith(prefix) or ".." in key:
        return False
    parts = key[len(prefix) :].split("/")
    if len(parts) != 2 or parts[1] != name:
        return False
    try:
        uuid.UUID(parts[0])
    except ValueError:
        return False
    return True


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
                n += info.file_size
                if n > MAX_B:
                    raise HTTPException(400, "files")
                data = z.read(info)
                verify_image(BytesIO(data), fn)
                out.append((fn, data, ct))
        return out
    ct = OK.get(ext)
    if not ct:
        return []
    filename = Path(name).name or "image.jpg"
    verify_image(BytesIO(body), filename)
    return [(filename, body, ct)]


def youtube_url(raw: str) -> str:
    """Normalize a public YouTube watch/share URL or raise 400."""
    s = (raw or "").strip()
    if not s:
        raise HTTPException(400, "url")
    if "://" not in s:
        s = "https://" + s
    try:
        u = urlparse(s)
    except ValueError as e:
        raise HTTPException(400, "url") from e
    if u.scheme not in ("http", "https") or not u.netloc:
        raise HTTPException(400, "url")
    host = u.hostname.casefold() if u.hostname else ""
    if host not in _YT_HOSTS:
        raise HTTPException(400, "url")
    # Drop credentials / fragments; keep path+query (v= / shorts / youtu.be id).
    return f"https://{host}{u.path or '/'}{('?' + u.query) if u.query else ''}"


def frames_from_path(src: Path, stem: str, interval: float) -> list[tuple[str, bytes, str]]:
    """Extract fixed-interval JPEGs from a local media file."""
    if not 0.1 <= interval <= 5:
        raise HTTPException(400, "interval")
    with tempfile.TemporaryDirectory() as td:
        root = Path(td)
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
                timeout=3600,
            )
        except FileNotFoundError as e:
            raise HTTPException(500, "ffmpeg") from e
        except (subprocess.CalledProcessError, subprocess.TimeoutExpired) as e:
            raise HTTPException(400, "video") from e
        out: list[tuple[str, bytes, str]] = []
        for i, p in enumerate(sorted(root.glob("f_*.jpg"))):
            t = i * interval
            fn = f"{stem}_t{t:g}.jpg"
            out.append((fn, p.read_bytes(), "image/jpeg"))
        if not out:
            raise HTTPException(400, "video")
        return out


def frames_from_video(name: str, body: bytes, interval: float) -> list[tuple[str, bytes, str]]:
    """Extract fixed-interval JPEGs from in-memory video bytes."""
    ext = Path(name).suffix.lower() or ".mp4"
    stem = Path(name).stem or "video"
    with tempfile.TemporaryDirectory() as td:
        src = Path(td) / f"in{ext}"
        src.write_bytes(body)
        return frames_from_path(src, stem, interval)


def verify_image(source, name: str) -> None:
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            with Image.open(source) as image:
                image.verify()
    except (
        UnidentifiedImageError,
        Image.DecompressionBombError,
        Image.DecompressionBombWarning,
        OSError,
        ValueError,
    ):
        raise HTTPException(400, f"corrupt:{name}") from None


def frames_from_youtube(url: str, interval: float) -> list[tuple[str, bytes, str]]:
    """Download a public YouTube video and extract frames."""
    if not 0.1 <= interval <= 5:
        raise HTTPException(400, "interval")
    try:
        import yt_dlp  # type: ignore
    except ImportError as e:
        raise HTTPException(500, "yt-dlp") from e

    with tempfile.TemporaryDirectory() as td:
        root = Path(td)
        outtmpl = str(root / "yt.%(ext)s")
        opts = {
            "outtmpl": outtmpl,
            "noplaylist": True,
            "quiet": True,
            "no_warnings": True,
            # Prefer a single progressive file ffmpeg can open without merge tools.
            "format": "best[ext=mp4]/best[height<=1080]/best",
            "retries": 3,
        }
        for attempt in range(2):
            try:
                with yt_dlp.YoutubeDL(opts) as ydl:
                    info = ydl.extract_info(url, download=True)
                break
            except yt_dlp.utils.DownloadError as e:  # type: ignore[attr-defined]
                msg = str(e).lower()
                if "private" in msg or "login" in msg or "members-only" in msg:
                    raise HTTPException(400, "private") from e
                if attempt == 0 and ("not available" in msg or "unavailable" in msg):
                    continue
                raise HTTPException(400, "youtube") from e
            except Exception as e:  # noqa: BLE001 — surface as bad source
                raise HTTPException(400, "youtube") from e

        files = sorted(root.glob("yt.*"))
        if not files:
            raise HTTPException(400, "youtube")
        src = files[0]
        title = ""
        if isinstance(info, dict):
            title = str(info.get("title") or info.get("id") or "youtube")
        stem = Path(title).stem[:80] or "youtube"
        for bad in '/\\:*?"<>|':
            stem = stem.replace(bad, "_")
        return frames_from_path(src, stem, interval)


@router.get("/projects/{pid}/images")
def images(
    pid: str,
    offset: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=200),
    user: str = Depends(uid),
):
    rows = list_images(pid, user, offset=offset, limit=limit)
    if rows is None:
        raise HTTPException(404)
    return rows


@router.get("/projects/{pid}/images/locate")
def locate(pid: str, image_id: str, user: str = Depends(uid)):
    row = locate_image(pid, image_id, user)
    if not row:
        raise HTTPException(404)
    return row


@router.get("/projects/{pid}/images/next-uncommitted")
def next_uncommitted(pid: str, after_index: int = Query(ge=0), user: str = Depends(uid)):
    if count_images(pid, user) is None:
        raise HTTPException(404)
    row = next_uncommitted_image(pid, user, after_index)
    if not row:
        raise HTTPException(404, "no_uncommitted")
    return row


@router.post("/projects/{pid}/images/presign")
def presign_uploads(pid: str, body: PresignIn, user: str = Depends(uid)):
    """Return S3 PUT URLs so the browser never ships bytes through Vercel."""
    if not get_project(pid, user):
        raise HTTPException(404)
    if not body.files:
        raise HTTPException(400, "files")
    total = 0
    out = []
    for f in body.files:
        name = Path(f.name).name or "file"
        if not _kind(name):
            raise HTTPException(400, "files")
        total += f.size
        if f.size <= 0:
            raise HTTPException(400, f"empty:{name}")
        if total > MAX_B:
            raise HTTPException(400, f"too_large:{name}")
        ct = _ctype(name, f.content_type)
        iid = str(uuid.uuid4())
        key = f"{user}/{pid}/{iid}/{name}"
        out.append(
            {
                "name": name,
                "key": key,
                "content_type": ct,
                "url": s3.presign_put(key, ct),
            }
        )
    return {"items": out}


@router.post("/projects/{pid}/images/complete")
def complete_uploads(pid: str, body: CompleteIn, user: str = Depends(uid)):
    """After browser PUTs to S3: register images or expand video/zip."""
    if not 0.1 <= body.interval <= 5:
        raise HTTPException(400, "interval")
    if count_images(pid, user) is None:
        raise HTTPException(404)
    if not body.files:
        raise HTTPException(400, "files")

    prefix = f"{user}/{pid}/"
    blobs: list[tuple[str, bytes, str]] = []
    direct: list[tuple[str, str]] = []
    expanded: list[str] = []

    for f in body.files:
        name = Path(f.name).name or "file"
        if not _kind(name):
            raise HTTPException(400, "files")
        if not _upload_key(prefix, f.key, name):
            raise HTTPException(400, "key")

    workers = min(8, len(body.files))
    with ThreadPoolExecutor(max_workers=workers) as pool:
        present = list(pool.map(s3.exists, (f.key for f in body.files)))
    for f, exists in zip(body.files, present, strict=True):
        if not exists:
            name = Path(f.name).name or "file"
            raise HTTPException(400, f"missing:{name}")

    image_files = [f for f in body.files if _kind(f.name) == "image"]

    def validate_image(f: CompleteFile) -> tuple[str, str]:
        name = Path(f.name).name or "file"
        with tempfile.TemporaryDirectory() as td:
            path = Path(td) / name
            s3.download(f.key, path)
            verify_image(path, name)
        return name, f.key

    if image_files:
        with ThreadPoolExecutor(max_workers=min(8, len(image_files))) as pool:
            direct.extend(pool.map(validate_image, image_files))

    for f in body.files:
        name = Path(f.name).name or "file"
        key = f.key
        kind = _kind(name)
        if kind in ("video", "zip"):
            ext = Path(name).suffix.lower() or (".mp4" if kind == "video" else ".zip")
            with tempfile.TemporaryDirectory() as td:
                path = Path(td) / f"in{ext}"
                s3.download(key, path)
                raw = path.read_bytes()
                if kind == "video":
                    blobs.extend(frames_from_video(name, raw, body.interval))
                else:
                    blobs.extend(flatten(name, raw))
            expanded.append(key)
        elif kind != "image":
            raise HTTPException(400, "files")

    rows: list[dict] = []
    if direct:
        got = add_image_keys(pid, user, direct)
        if got is None:
            raise HTTPException(404)
        rows.extend(got)
    if blobs:
        got = add_images(pid, user, blobs)
        if got is None:
            raise HTTPException(404)
        rows.extend(got)
    if not rows:
        raise HTTPException(400, "files")
    for key in expanded:
        s3.delete(key)
    return rows


@router.delete("/projects/{pid}/images/uploads")
def discard_uploads(pid: str, body: DiscardIn, user: str = Depends(uid)):
    """Remove an interrupted batch's unregistered presigned objects."""
    if count_images(pid, user) is None:
        raise HTTPException(404)
    prefix = f"{user}/{pid}/"
    if any(not _upload_key(prefix, key, Path(key).name) for key in body.keys):
        raise HTTPException(400, "key")
    if registered_image_keys(pid, user, body.keys):
        raise HTTPException(409, "registered")
    for key in body.keys:
        s3.delete(key)
    return {"deleted": len(body.keys)}


@router.post("/projects/{pid}/images/from_url")
def upload_from_url(pid: str, body: FromUrlIn, user: str = Depends(uid)):
    """Pull a public YouTube URL, extract frames, register images."""
    if not 0.1 <= body.interval <= 5:
        raise HTTPException(400, "interval")
    if count_images(pid, user) is None:
        raise HTTPException(404)
    url = youtube_url(body.url)
    blobs = frames_from_youtube(url, body.interval)
    rows = add_images(pid, user, blobs)
    if rows is None:
        raise HTTPException(404)
    if not rows:
        raise HTTPException(400, "video")
    return rows


@router.post("/projects/{pid}/images")
async def upload(
    pid: str,
    interval: float = 1.0,
    user: str = Depends(uid),
    files: list[UploadFile] = File(),
):
    """Legacy multipart path (local/scripts). Prefer presign + complete."""
    if not 0.1 <= interval <= 5:
        raise HTTPException(400, "interval")
    if count_images(pid, user) is None:
        raise HTTPException(404)

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
            blobs.extend(frames_from_video(name, body, interval))
        else:
            blobs.extend(flatten(name, body))
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


@router.get("/projects/{pid}/comments")
def project_comments(pid: str, user: str = Depends(uid)):
    rows = list_project_comments(pid, user)
    if rows is None:
        raise HTTPException(404)
    return {"images": rows}


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
