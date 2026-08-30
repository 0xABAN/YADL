import tempfile
import zipfile
from io import BytesIO
from pathlib import Path
from typing import Annotated, Literal

from fastapi import Depends, FastAPI, File, Header, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from backend.db import apply_schema, fetchone
from backend.models import Doc
from backend.store import (
    add_images,
    as_doc,
    create_project,
    delete_project,
    ensure_user,
    get_image,
    get_project,
    image_row,
    list_images,
    list_projects,
    put_objects,
    save_objects,
    seed_demo,
)
from backend.s3 import download
from demo.hands import seed

app = FastAPI()
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


class NewProject(BaseModel):
    name: str
    type: Literal["boxes", "polygons", "hands"]


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
MAX_N, MAX_B = 500, 100 * 1024 * 1024


def uid(x_user_id: Annotated[str | None, Header()] = None) -> str:
    return x_user_id or "dev"


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


@app.on_event("startup")
def boot() -> None:
    apply_schema()
    ensure_user("dev")
    seed_demo()


@app.get("/health")
def health():
    fetchone("select 1")
    return {"ok": True}


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
async def upload(pid: str, user: str = Depends(uid), files: list[UploadFile] = File()):
    blobs = []
    for f in files:
        blobs.extend(flatten(f.filename or "", await f.read()))
        if len(blobs) > MAX_N:
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


@app.put("/projects/{pid}/images/{iid}")
def save(pid: str, iid: str, body: Doc, user: str = Depends(uid)):
    row = put_objects(pid, iid, user, [o.model_dump() for o in body.objects])
    if not row:
        raise HTTPException(404)
    return row


@app.post("/projects/{pid}/images/{iid}/assist")
def assist(pid: str, iid: str, user: str = Depends(uid)):
    row = image_row(pid, iid, user)
    if not row:
        raise HTTPException(404)
    if row["objects"]:
        return as_doc(row)
    ext = Path(row["filename"]).suffix or ".jpg"
    with tempfile.NamedTemporaryFile(suffix=ext) as tmp:
        path = Path(tmp.name)
        download(row["s3_key"], path)
        objs = [o.model_dump() for o in seed(path)]
    save_objects(str(row["id"]), objs)
    row["objects"] = objs
    return as_doc(row)
