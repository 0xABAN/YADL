from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from backend.api.deps import uid
from backend.infra.store import (
    add_class,
    create_project,
    delete_project,
    drop_class,
    export_jsonl,
    get_project,
    list_projects,
    rename_class,
)

router = APIRouter(tags=["projects"])


class NewProject(BaseModel):
    name: str
    type: Literal["boxes", "polygons", "keypoints", "hands"]  # hands=legacy alias
    template: Literal["hand", "pose", "face"] | None = None


class ClassName(BaseModel):
    name: str


class Rename(BaseModel):
    old: str
    new: str


@router.get("/projects")
def projects(user: str = Depends(uid)):
    return list_projects(user)


@router.post("/projects")
def new_project(body: NewProject, user: str = Depends(uid)):
    name = body.name.strip()
    if not name:
        raise HTTPException(400, "name")
    ptype = "keypoints" if body.type == "hands" else body.type
    row = create_project(user, name, ptype, body.template)
    if not row:
        raise HTTPException(409, "name")
    return row


@router.delete("/projects/{pid}")
def drop_project(pid: str, user: str = Depends(uid)):
    if not delete_project(pid, user):
        raise HTTPException(404)


@router.post("/projects/{pid}/classes")
def new_class(pid: str, body: ClassName, user: str = Depends(uid)):
    row = add_class(pid, user, body.name)
    if not row:
        raise HTTPException(404)
    return row


@router.patch("/projects/{pid}/classes")
def patch_class(pid: str, body: Rename, user: str = Depends(uid)):
    row = rename_class(pid, user, body.old, body.new)
    if not row:
        raise HTTPException(404)
    return row


@router.delete("/projects/{pid}/classes")
def remove_class(pid: str, body: ClassName, user: str = Depends(uid)):
    row = drop_class(pid, user, body.name)
    if not row:
        raise HTTPException(404)
    return row


@router.get("/projects/{pid}")
def project(pid: str, user: str = Depends(uid)):
    row = get_project(pid, user)
    if not row:
        raise HTTPException(404)
    return row


@router.get("/projects/{pid}/export")
def dump(pid: str, user: str = Depends(uid)):
    out = export_jsonl(pid, user)
    if out is None:
        raise HTTPException(404)
    name, body = out
    safe = "".join(c if c.isalnum() or c in "-_" else "_" for c in name) or "export"
    return StreamingResponse(
        body,
        media_type="application/x-ndjson",
        headers={"Content-Disposition": f'attachment; filename="{safe}.jsonl"'},
    )
