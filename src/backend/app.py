import tempfile
from pathlib import Path
from typing import Annotated, Literal

from fastapi import Depends, FastAPI, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from backend.db import apply_schema, fetchone
from backend.models import Doc
from backend.store import (
    as_doc,
    create_project,
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


def uid(x_user_id: Annotated[str | None, Header()] = None) -> str:
    return x_user_id or "dev"


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
    return create_project(user, name, body.type)


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
