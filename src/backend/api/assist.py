import tempfile
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException

from backend.api.deps import uid
from backend.infra.s3 import download
from backend.infra.seed import seed
from backend.infra.store import (
    as_doc,
    empty_images,
    get_project,
    image_row,
    save_objects,
)

router = APIRouter(tags=["assist"])


def seed_row(row: dict, ptype: str, template: str | None = None, *, force: bool = False) -> dict:
    if ptype in ("hands",):
        ptype = "keypoints"
    if ptype != "keypoints":
        return row
    if row["objects"] and not force:
        return row
    tmpl = template if template in ("hand", "pose", "face") else "hand"
    ext = Path(row["filename"]).suffix or ".jpg"
    with tempfile.NamedTemporaryFile(suffix=ext) as tmp:
        path = Path(tmp.name)
        download(row["s3_key"], path)
        objs = [o.model_dump() for o in seed(path, tmpl)]
    save_objects(str(row["id"]), objs)
    row["objects"] = objs
    return row


@router.post("/projects/{pid}/images/{iid}/assist")
def assist(
    pid: str,
    iid: str,
    force: bool = False,
    user: str = Depends(uid),
):
    proj = get_project(pid, user)
    if not proj:
        raise HTTPException(404)
    if proj["type"] not in ("keypoints", "hands"):
        raise HTTPException(400, "assist is keypoints-only")
    row = image_row(pid, iid, user)
    if not row:
        raise HTTPException(404)
    return as_doc(seed_row(row, proj["type"], proj.get("template"), force=force))


@router.post("/projects/{pid}/assist")
def assist_all(pid: str, user: str = Depends(uid)):
    proj = get_project(pid, user)
    if not proj:
        raise HTTPException(404)
    if proj["type"] not in ("keypoints", "hands"):
        return {"seeded": 0}
    rows = empty_images(pid, user)
    if rows is None:
        raise HTTPException(404)
    # ponytail: sync loop, chunk/job if 500 images time out
    n = 0
    for row in rows:
        seed_row(row, proj["type"], proj.get("template"))
        n += 1
    return {"seeded": n}
