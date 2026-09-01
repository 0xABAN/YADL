import hashlib
import hmac
import json
import os
import secrets
import subprocess
import tempfile
import time
import urllib.error
import urllib.request
import zipfile
from io import BytesIO
from pathlib import Path
from typing import Annotated, Literal
from urllib.parse import urlencode

from fastapi import Cookie, Depends, FastAPI, File, Header, HTTPException, Response, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import RedirectResponse
from pydantic import BaseModel

from backend.db import apply_schema, fetchone
from backend.models import Doc
from backend.store import (
    add_images,
    as_doc,
    create_project,
    create_user,
    delete_project,
    ensure_user,
    get_image,
    get_project,
    github_user,
    image_row,
    list_images,
    count_images,
    list_projects,
    login_user,
    put_objects,
    save_objects,
    seed_demo,
    add_class,
    drop_class,
    rename_class,
    commit_image,
    add_comment,
    delete_comment,
    delete_image,
    restore_image,
    empty_images,
    export_jsonl,
)
from backend.s3 import download
from demo.hands import seed

app = FastAPI()
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


class NewProject(BaseModel):
    name: str
    type: Literal["boxes", "polygons", "hands"]


class ClassName(BaseModel):
    name: str


class Rename(BaseModel):
    old: str
    new: str


class Creds(BaseModel):
    email: str
    password: str
    name: str = ""


class CommentIn(BaseModel):
    body: str


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


def _secret() -> bytes:
    return (os.environ.get("SESSION_SECRET") or "dev").encode()


def mint(uid: str) -> str:
    exp = str(int(time.time()) + 30 * 86400)
    msg = f"{uid}.{exp}"
    sig = hmac.new(_secret(), msg.encode(), hashlib.sha256).hexdigest()
    return f"{msg}.{sig}"


def read_sid(sid: str) -> str | None:
    try:
        uid, exp, sig = sid.rsplit(".", 2)
    except ValueError:
        return None
    msg = f"{uid}.{exp}"
    expect = hmac.new(_secret(), msg.encode(), hashlib.sha256).hexdigest()
    if not hmac.compare_digest(sig, expect) or int(exp) < time.time():
        return None
    return uid


def uid(
    sid: Annotated[str | None, Cookie()] = None,
    x_user_id: Annotated[str | None, Header()] = None,
) -> str:
    if sid and (u := read_sid(sid)):
        return u
    if x_user_id:
        return x_user_id
    raise HTTPException(401)


def _cookie(response: Response, user_id: str) -> None:
    response.set_cookie("sid", mint(user_id), httponly=True, samesite="lax", max_age=30 * 86400, path="/")


def origin() -> str:
    return os.environ.get("APP_ORIGIN") or "http://localhost:3000"


def gh_callback() -> str:
    return f"{origin()}/api/auth/github/callback"


def _gh(url: str, token: str | None = None, data: dict | None = None):
    headers = {"User-Agent": "yadl", "Accept": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    body = json.dumps(data).encode() if data is not None else None
    if body:
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request(url, data=body, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            return json.loads(r.read())
    except urllib.error.HTTPError:
        return None


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
    # 0.1–5s; matches frontend slider
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
            # e.g. clip_t0.jpg, clip_t1.5.jpg
            fn = f"{stem}_t{t:g}.jpg"
            out.append((fn, p.read_bytes(), "image/jpeg"))
        if not out:
            raise HTTPException(400, "video")
        return out


@app.on_event("startup")
def boot() -> None:
    apply_schema()
    ensure_user("dev")
    seed_demo()


@app.get("/health")
def health():
    fetchone("select 1")
    return {"ok": True}


@app.post("/auth/signup")
def signup(body: Creds, response: Response):
    if not body.email.strip() or not body.password:
        raise HTTPException(400)
    row = create_user(body.email, body.password, body.name)
    if not row:
        raise HTTPException(409, "email")
    _cookie(response, row["id"])
    return row


@app.post("/auth/login")
def login(body: Creds, response: Response):
    row = login_user(body.email, body.password)
    if not row:
        raise HTTPException(401)
    _cookie(response, row["id"])
    return row


@app.get("/auth/github")
def github_start():
    cid = os.environ.get("GITHUB_CLIENT_ID")
    if not cid:
        return RedirectResponse(f"{origin()}/auth?err=github")
    state = secrets.token_urlsafe(24)
    url = "https://github.com/login/oauth/authorize?" + urlencode(
        {
            "client_id": cid,
            "redirect_uri": gh_callback(),
            "scope": "read:user user:email",
            "state": state,
        }
    )
    r = RedirectResponse(url)
    r.set_cookie("oauth_state", state, httponly=True, samesite="lax", max_age=600, path="/")
    return r


@app.get("/auth/github/callback")
def github_cb(
    code: str | None = None,
    state: str | None = None,
    error: str | None = None,
    oauth_state: Annotated[str | None, Cookie()] = None,
):
    fail = RedirectResponse(f"{origin()}/auth?err=github")
    if error or not code or not state or not oauth_state or not hmac.compare_digest(state, oauth_state):
        return fail
    tok = _gh(
        "https://github.com/login/oauth/access_token",
        data={
            "client_id": os.environ.get("GITHUB_CLIENT_ID"),
            "client_secret": os.environ.get("GITHUB_CLIENT_SECRET"),
            "code": code,
            "redirect_uri": gh_callback(),
        },
    )
    token = (tok or {}).get("access_token")
    if not token:
        return fail
    gh = _gh("https://api.github.com/user", token)
    if not gh or not gh.get("id"):
        return fail
    email = gh.get("email")
    if not email:
        mails = _gh("https://api.github.com/user/emails", token)
        if isinstance(mails, list):
            for e in mails:
                if e.get("verified") and (e.get("primary") or not email):
                    email = e.get("email")
                    if e.get("primary"):
                        break
    row = github_user(str(gh["id"]), email, gh.get("name") or gh.get("login"))
    r = RedirectResponse(f"{origin()}/create")
    _cookie(r, row["id"])
    r.delete_cookie("oauth_state", path="/")
    return r


@app.get("/projects")
def projects(user: str = Depends(uid)):
    return list_projects(user)


@app.post("/projects")
def new_project(body: NewProject, user: str = Depends(uid)):
    name = body.name.strip()
    if not name:
        raise HTTPException(400, "name")
    row = create_project(user, name, body.type)
    if not row:
        raise HTTPException(409, "name")
    return row


@app.delete("/projects/{pid}")
def drop_project(pid: str, user: str = Depends(uid)):
    if not delete_project(pid, user):
        raise HTTPException(404)


@app.post("/projects/{pid}/classes")
def new_class(pid: str, body: ClassName, user: str = Depends(uid)):
    row = add_class(pid, user, body.name)
    if not row:
        raise HTTPException(404)
    return row


@app.patch("/projects/{pid}/classes")
def patch_class(pid: str, body: Rename, user: str = Depends(uid)):
    row = rename_class(pid, user, body.old, body.new)
    if not row:
        raise HTTPException(404)
    return row


@app.delete("/projects/{pid}/classes")
def remove_class(pid: str, body: ClassName, user: str = Depends(uid)):
    row = drop_class(pid, user, body.name)
    if not row:
        raise HTTPException(404)
    return row


@app.get("/projects/{pid}")
def project(pid: str, user: str = Depends(uid)):
    row = get_project(pid, user)
    if not row:
        raise HTTPException(404)
    return row


@app.get("/projects/{pid}/images")
def images(pid: str, user: str = Depends(uid)):
    rows = list_images(pid, user)
    if rows is None:
        raise HTTPException(404)
    return rows


@app.post("/projects/{pid}/images")
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


@app.get("/projects/{pid}/images/{iid}")
def image(pid: str, iid: str, user: str = Depends(uid)):
    row = get_image(pid, iid, user)
    if not row:
        raise HTTPException(404)
    return row



@app.delete("/projects/{pid}/images/{iid}")
def drop_image(pid: str, iid: str, user: str = Depends(uid)):
    row = delete_image(pid, iid, user)
    if not row:
        raise HTTPException(404)
    return row


@app.post("/projects/{pid}/images/{iid}/restore")
def undelete_image(pid: str, iid: str, user: str = Depends(uid)):
    row = restore_image(pid, iid, user)
    if not row:
        raise HTTPException(404)
    return row

@app.put("/projects/{pid}/images/{iid}")
def save(pid: str, iid: str, body: Doc, user: str = Depends(uid)):
    row = put_objects(pid, iid, user, [o.model_dump() for o in body.objects])
    if not row:
        raise HTTPException(404)
    return row


def seed_row(row: dict, ptype: str, *, force: bool = False) -> dict:
    # MediaPipe hand landmarks only — never for boxes/polygons
    if ptype != "hands":
        return row
    if row["objects"] and not force:
        return row
    ext = Path(row["filename"]).suffix or ".jpg"
    with tempfile.NamedTemporaryFile(suffix=ext) as tmp:
        path = Path(tmp.name)
        download(row["s3_key"], path)
        objs = [o.model_dump() for o in seed(path)]
    save_objects(str(row["id"]), objs)
    row["objects"] = objs
    return row


@app.post("/projects/{pid}/images/{iid}/assist")
def assist(
    pid: str,
    iid: str,
    force: bool = False,
    user: str = Depends(uid),
):
    proj = get_project(pid, user)
    if not proj:
        raise HTTPException(404)
    if proj["type"] != "hands":
        raise HTTPException(400, "assist is hands-only")
    row = image_row(pid, iid, user)
    if not row:
        raise HTTPException(404)
    return as_doc(seed_row(row, proj["type"], force=force))


@app.post("/projects/{pid}/assist")
def assist_all(pid: str, user: str = Depends(uid)):
    proj = get_project(pid, user)
    if not proj:
        raise HTTPException(404)
    if proj["type"] != "hands":
        return {"seeded": 0}
    rows = empty_images(pid, user)
    if rows is None:
        raise HTTPException(404)
    # ponytail: sync loop, chunk/job if 500 images time out
    n = 0
    for row in rows:
        seed_row(row, proj["type"])
        n += 1
    return {"seeded": n}


@app.post("/projects/{pid}/images/{iid}/commit")
def commit(pid: str, iid: str, user: str = Depends(uid)):
    try:
        row = commit_image(pid, iid, user)
    except ValueError:
        raise HTTPException(400)
    if not row:
        raise HTTPException(404)
    return row


@app.post("/projects/{pid}/images/{iid}/comments")
def post_comment(pid: str, iid: str, body: CommentIn, user: str = Depends(uid)):
    try:
        row = add_comment(pid, iid, user, body.body)
    except ValueError:
        raise HTTPException(400, "empty")
    if not row:
        raise HTTPException(404)
    return row


@app.delete("/projects/{pid}/images/{iid}/comments/{cid}")
def drop_comment(pid: str, iid: str, cid: str, user: str = Depends(uid)):
    row = delete_comment(pid, iid, user, cid)
    if not row:
        raise HTTPException(404)
    return row


@app.get("/projects/{pid}/export")
def dump(pid: str, user: str = Depends(uid)):
    out = export_jsonl(pid, user)
    if out is None:
        raise HTTPException(404)
    name, body = out
    safe = "".join(c if c.isalnum() or c in "-_" else "_" for c in name) or "export"
    return Response(
        body,
        media_type="application/x-ndjson",
        headers={"Content-Disposition": f'attachment; filename="{safe}.jsonl"'},
    )
