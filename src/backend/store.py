import uuid

from psycopg.types.json import Json

from backend.db import ROOT, execute, fetch, fetchone
from backend.s3 import presign_get, put

HANDS_CLASSES = ["open", "fist", "point", "pinch", "thumbs up", "ok"]


def as_project(row: dict) -> dict:
    return {"id": str(row["id"]), "name": row["name"], "type": row["type"], "classes": row["classes"]}


def as_doc(row: dict) -> dict:
    return {
        "id": str(row["id"]),
        "image": row["filename"],
        "objects": row["objects"] or [],
        "url": presign_get(row["s3_key"]),
    }


def ensure_user(uid: str) -> None:
    execute("insert into users (id) values (%s) on conflict do nothing", (uid,))


def list_projects(uid: str) -> list[dict]:
    return [as_project(r) for r in fetch(
        "select * from projects where owner_id=%s order by created_at desc", (uid,)
    )]


def get_project(pid: str, uid: str) -> dict | None:
    row = fetchone("select * from projects where id=%s and owner_id=%s", (pid, uid))
    return as_project(row) if row else None


def create_project(uid: str, name: str, type: str) -> dict:
    pid = uuid.uuid4()
    classes = HANDS_CLASSES if type == "hands" else []
    row = fetchone(
        "insert into projects (id, owner_id, name, type, classes) values (%s,%s,%s,%s,%s) returning *",
        (str(pid), uid, name, type, Json(classes)),
    )
    return as_project(row)


def list_images(pid: str, uid: str) -> list[dict] | None:
    if not get_project(pid, uid):
        return None
    rows = fetch(
        "select id, filename from images where project_id=%s order by created_at, id limit 50",
        (pid,),
    )
    return [{"id": str(r["id"]), "filename": r["filename"]} for r in rows]


def get_image(pid: str, iid: str, uid: str) -> dict | None:
    row = fetchone(
        """select i.* from images i
           join projects p on p.id=i.project_id
           where i.id=%s and p.id=%s and p.owner_id=%s""",
        (iid, pid, uid),
    )
    return as_doc(row) if row else None


def put_objects(pid: str, iid: str, uid: str, objects: list) -> dict | None:
    row = fetchone(
        """select i.id from images i
           join projects p on p.id=i.project_id
           where i.id=%s and p.id=%s and p.owner_id=%s""",
        (iid, pid, uid),
    )
    if not row:
        return None
    fetchone("update images set objects=%s where id=%s returning id", (Json(objects), iid))
    return get_image(pid, iid, uid)


def image_row(pid: str, iid: str, uid: str) -> dict | None:
    return fetchone(
        """select i.* from images i
           join projects p on p.id=i.project_id
           where i.id=%s and p.id=%s and p.owner_id=%s""",
        (iid, pid, uid),
    )


def save_objects(iid: str, objects: list) -> None:
    execute("update images set objects=%s where id=%s", (Json(objects), iid))


def seed_demo() -> None:
    ensure_user("dev")
    if fetchone("select id from projects where owner_id=%s limit 1", ("dev",)):
        return
    src = ROOT / "src" / "frontend" / "public" / "default.jpg"
    if not src.exists():
        return
    proj = create_project("dev", "Hands", "hands")
    iid = uuid.uuid4()
    key = f"dev/{proj['id']}/{iid}/default.jpg"
    put(key, src.read_bytes(), "image/jpeg")
    execute(
        "insert into images (id, project_id, s3_key, filename) values (%s,%s,%s,%s)",
        (str(iid), proj["id"], key, "default.jpg"),
    )
