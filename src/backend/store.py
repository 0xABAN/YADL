import hashlib
import hmac
import json
import os
import re
import uuid
from datetime import datetime, timezone
from pathlib import Path

from psycopg.types.json import Json

from backend.db import ROOT, execute, fetch, fetchone
from backend.s3 import delete as s3_delete, presign_get, put

def as_project(row: dict) -> dict:
    return {"id": str(row["id"]), "name": row["name"], "type": row["type"], "classes": row["classes"]}


def _hid(n: int, objs: list) -> str:
    blob = f"{n}:{json.dumps(objs, sort_keys=True, separators=(',', ':'))}".encode()
    return hashlib.sha1(blob).hexdigest()[:7]


def _versions(raw: list) -> list[dict]:
    out = []
    for i, v in enumerate(raw or []):
        if isinstance(v, dict) and "id" in v and "objects" in v:
            out.append({"id": v["id"], "objects": v["objects"], "at": v.get("at")})
        else:
            objs = v if isinstance(v, list) else []
            out.append({"id": _hid(i, objs), "objects": objs, "at": None})
    return out


def _comments(raw: list) -> list[dict]:
    out = []
    for c in raw or []:
        if not isinstance(c, dict) or "id" not in c or "body" not in c:
            continue
        body = str(c["body"])
        mentions = c.get("mentions")
        if not isinstance(mentions, list):
            mentions = _mentions_of(body)
        out.append(
            {
                "id": str(c["id"]),
                "body": body,
                "mentions": [str(m) for m in mentions],
                "at": c.get("at"),
            }
        )
    return out


def _mentions_of(body: str) -> list[str]:
    seen: list[str] = []
    for m in re.findall(r"@\{\{([^}]+)\}\}", body):
        if m not in seen:
            seen.append(m)
    return seen


def as_doc(row: dict) -> dict:
    return {
        "id": str(row["id"]),
        "image": row["filename"],
        "objects": row["objects"] or [],
        "url": presign_get(row["s3_key"]),
        "committed": bool(row.get("committed")),
        "history": _versions(row.get("history") or []),
        "comments": _comments(row.get("comments") or []),
    }


def ensure_user(uid: str) -> None:
    execute("insert into users (id) values (%s) on conflict do nothing", (uid,))


def _hash(pw: str) -> str:
    salt = os.urandom(16)
    dk = hashlib.pbkdf2_hmac("sha256", pw.encode(), salt, 100_000)
    return salt.hex() + "$" + dk.hex()


def _check(pw: str, stored: str) -> bool:
    salt, dk = stored.split("$", 1)
    got = hashlib.pbkdf2_hmac("sha256", pw.encode(), bytes.fromhex(salt), 100_000)
    return hmac.compare_digest(got.hex(), dk)


def create_user(email: str, password: str, name: str) -> dict | None:
    email = email.strip().lower()
    if not email or not password:
        return None
    row = fetchone(
        """insert into users (id, email, password, name) values (%s,%s,%s,%s)
           on conflict (email) do nothing returning id, email, name""",
        (str(uuid.uuid4()), email, _hash(password), name.strip() or None),
    )
    return dict(row) if row else None


def login_user(email: str, password: str) -> dict | None:
    row = fetchone(
        "select id, email, name, password from users where email=%s",
        (email.strip().lower(),),
    )
    if not row or not row["password"] or not _check(password, row["password"]):
        return None
    return {"id": row["id"], "email": row["email"], "name": row["name"]}


def github_user(github_id: str, email: str | None, name: str | None) -> dict:
    row = fetchone("select id, email, name from users where github_id=%s", (github_id,))
    if row:
        return {"id": row["id"], "email": row["email"], "name": row["name"]}
    email = email.strip().lower() if email else None
    name = name.strip() if name else None
    if email:
        row = fetchone("select id, email, name from users where email=%s", (email,))
        if row:
            execute(
                "update users set github_id=%s, name=coalesce(%s, name) where id=%s",
                (github_id, name, row["id"]),
            )
            return {"id": row["id"], "email": row["email"], "name": name or row["name"]}
    row = fetchone(
        "insert into users (id, email, name, github_id) values (%s,%s,%s,%s) returning id, email, name",
        (str(uuid.uuid4()), email, name, github_id),
    )
    return dict(row)


def list_projects(uid: str) -> list[dict]:
    return [as_project(r) for r in fetch(
        "select id, name, type, classes from projects where owner_id=%s order by created_at desc limit 50",
        (uid,),
    )]


def get_project(pid: str, uid: str) -> dict | None:
    row = fetchone(
        "select id, name, type, classes from projects where id=%s and owner_id=%s",
        (pid, uid),
    )
    return as_project(row) if row else None


def create_project(uid: str, name: str, type: str) -> dict | None:
    pid = uuid.uuid4()
    row = fetchone(
        """insert into projects (id, owner_id, name, type, classes) values (%s,%s,%s,%s,%s)
           on conflict (owner_id, name) do nothing returning *""",
        (str(pid), uid, name, type, Json([])),
    )
    return as_project(row) if row else None


def delete_project(pid: str, uid: str) -> bool:
    if not get_project(pid, uid):
        return False
    keys = [r["s3_key"] for r in fetch("select s3_key from images where project_id=%s", (pid,))]
    if not fetchone("delete from projects where id=%s and owner_id=%s returning id", (pid, uid)):
        return False
    for k in keys:
        s3_delete(k)
    return True


def add_class(pid: str, uid: str, name: str) -> dict | None:
    name = name.strip()
    proj = get_project(pid, uid)
    if not name or not proj:
        return None
    if name not in proj["classes"]:
        proj["classes"] = [*proj["classes"], name]
        execute("update projects set classes=%s where id=%s", (Json(proj["classes"]), pid))
    return proj


def rename_class(pid: str, uid: str, old: str, new: str) -> dict | None:
    old, new = old.strip(), new.strip()
    proj = get_project(pid, uid)
    if not proj or not old or not new or old not in proj["classes"]:
        return proj
    if old == new:
        return proj
    if new in proj["classes"]:
        classes = [c for c in proj["classes"] if c != old]
    else:
        classes = [new if c == old else c for c in proj["classes"]]
    execute("update projects set classes=%s where id=%s", (Json(classes), pid))
    for row in fetch("select id, objects from images where project_id=%s", (pid,)):
        objs = row["objects"] or []
        nxt = [{**o, "label": new} if o.get("label") == old else o for o in objs]
        if nxt != objs:
            save_objects(str(row["id"]), nxt)
    proj["classes"] = classes
    return proj


def drop_class(pid: str, uid: str, name: str) -> dict | None:
    name = name.strip()
    proj = get_project(pid, uid)
    if not proj or not name:
        return None
    classes = [c for c in proj["classes"] if c != name]
    execute("update projects set classes=%s where id=%s", (Json(classes), pid))
    for row in fetch("select id, objects from images where project_id=%s", (pid,)):
        objs = row["objects"] or []
        nxt = [{**o, "label": None} if o.get("label") == name else o for o in objs]
        if nxt != objs:
            save_objects(str(row["id"]), nxt)
    proj["classes"] = classes
    return proj


def list_images(pid: str, uid: str) -> list[dict] | None:
    if not get_project(pid, uid):
        return None
    rows = fetch(
        """select id, filename, committed, objects from images
           where project_id=%s order by created_at, id limit 500""",
        (pid,),
    )
    return [
        {
            "id": str(r["id"]),
            "filename": r["filename"],
            "committed": bool(r["committed"]),
            "empty": not (r["objects"] or []),
        }
        for r in rows
    ]


def image_row(pid: str, iid: str, uid: str) -> dict | None:
    return fetchone(
        """select i.* from images i
           join projects p on p.id=i.project_id
           where i.id=%s and p.id=%s and p.owner_id=%s""",
        (iid, pid, uid),
    )


def get_image(pid: str, iid: str, uid: str) -> dict | None:
    row = image_row(pid, iid, uid)
    return as_doc(row) if row else None


def save_objects(iid: str, objects: list) -> None:
    execute("update images set objects=%s where id=%s", (Json(objects), iid))


def put_objects(pid: str, iid: str, uid: str, objects: list) -> dict | None:
    row = image_row(pid, iid, uid)
    if not row:
        return None
    save_objects(str(row["id"]), objects)
    row["objects"] = objects
    return as_doc(row)


def _named(label: object) -> bool:
    return bool(label) and label != "untitled"


def commit_image(pid: str, iid: str, uid: str) -> dict | None:
    row = image_row(pid, iid, uid)
    if not row:
        return None
    objs = row["objects"] or []
    if not any(_named(o.get("label")) for o in objs):
        raise ValueError("unlabeled")
    hist = _versions(row.get("history") or [])
    hist.append(
        {
            "id": _hid(len(hist), objs),
            "objects": objs,
            "at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        }
    )
    execute(
        "update images set committed=true, history=%s where id=%s",
        (Json(hist), str(row["id"])),
    )
    row["committed"] = True
    row["history"] = hist
    return as_doc(row)


def add_comment(pid: str, iid: str, uid: str, body: str) -> dict | None:
    row = image_row(pid, iid, uid)
    if not row:
        return None
    body = (body or "").strip()
    if not body:
        raise ValueError("empty")
    obj_ids = {str(o.get("id")) for o in (row.get("objects") or []) if isinstance(o, dict)}
    mentions = [m for m in _mentions_of(body) if m in obj_ids]
    # drop tokens for unknown ids so agents don't chase ghosts
    clean = re.sub(
        r"@\{\{([^}]+)\}\}",
        lambda m: m.group(0) if m.group(1) in obj_ids else "",
        body,
    ).strip()
    if not clean:
        raise ValueError("empty")
    mentions = _mentions_of(clean)
    note = {
        "id": uuid.uuid4().hex[:10],
        "body": clean,
        "mentions": mentions,
        "at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
    }
    comments = _comments(row.get("comments") or [])
    comments.append(note)
    execute("update images set comments=%s where id=%s", (Json(comments), str(row["id"])))
    row["comments"] = comments
    return as_doc(row)


def delete_comment(pid: str, iid: str, uid: str, cid: str) -> dict | None:
    row = image_row(pid, iid, uid)
    if not row:
        return None
    comments = [c for c in _comments(row.get("comments") or []) if c["id"] != cid]
    execute("update images set comments=%s where id=%s", (Json(comments), str(row["id"])))
    row["comments"] = comments
    return as_doc(row)


def empty_images(pid: str, uid: str) -> list[dict] | None:
    if not get_project(pid, uid):
        return None
    return fetch(
        """select * from images where project_id=%s
           and coalesce(objects, '[]'::jsonb) = '[]'::jsonb""",
        (pid,),
    )


def export_jsonl(pid: str, uid: str) -> tuple[str, str] | None:
    proj = get_project(pid, uid)
    if not proj:
        return None
    rows = fetch(
        """select filename, objects, committed from images
           where project_id=%s order by created_at, id""",
        (pid,),
    )
    lines = []
    for row in rows:
        if not row["committed"]:
            continue
        for o in row["objects"] or []:
            label = o.get("label")
            if not _named(label):
                continue
            geom = o.get("geom") or {}
            lines.append(
                json.dumps(
                    {"image": row["filename"], "label": label, "landmarks": geom.get("landmarks") or []},
                    separators=(",", ":"),
                )
            )
    return proj["name"], ("\n".join(lines) + ("\n" if lines else ""))


def add_images(pid: str, uid: str, files: list[tuple[str, bytes, str]]) -> list[dict] | None:
    if not get_project(pid, uid):
        return None
    out = []
    for name, body, ctype in files:
        iid = uuid.uuid4()
        filename = Path(name).name or "image.jpg"
        key = f"{uid}/{pid}/{iid}/{filename}"
        put(key, body, ctype)
        execute(
            "insert into images (id, project_id, s3_key, filename) values (%s,%s,%s,%s)",
            (str(iid), pid, key, filename),
        )
        out.append({"id": str(iid), "filename": filename})
    return out


def seed_demo() -> None:
    if fetchone("select id from projects where owner_id=%s limit 1", ("dev",)):
        return
    src = ROOT / "src" / "frontend" / "public" / "default.jpg"
    if not src.exists():
        return
    proj = create_project("dev", "Hands", "hands")
    if not proj:
        return
    add_images(proj["id"], "dev", [(src.name, src.read_bytes(), "image/jpeg")])
