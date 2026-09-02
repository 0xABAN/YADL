from __future__ import annotations

import uuid
from typing import Any

from psycopg.types.json import Json

from backend.domain.augment import plan_items
from backend.infra.db import execute, fetch, fetchone, pool
from backend.infra.store import get_project


def _item(row: dict) -> dict:
    return {
        "id": str(row["id"]),
        "ordinal": int(row["ordinal"]),
        "source_image_id": str(row["source_image_id"]) if row.get("source_image_id") else None,
        "status": row["status"],
        "attempts": int(row["attempts"]),
        "error": row.get("error"),
        "provider_prediction_id": row.get("provider_prediction_id"),
        "output_image_id": str(row["output_image_id"]) if row.get("output_image_id") else None,
    }


def _job(row: dict, counts: dict | None = None) -> dict:
    counts = counts or {}
    return {
        "id": str(row["id"]),
        "project_id": str(row["project_id"]),
        "mode": row["mode"],
        "config": row["config"],
        "status": row["status"],
        "requested_count": int(row["requested_count"]),
        "progress": {
            "queued": int(counts.get("queued") or 0),
            "running": int(counts.get("running") or 0),
            "succeeded": int(counts.get("succeeded") or 0),
            "failed": int(counts.get("failed") or 0),
            "cancelled": int(counts.get("cancelled") or 0),
            "submission_unknown": int(counts.get("submission_unknown") or 0),
        },
        "cancel_requested": bool(row.get("cancel_requested")),
        "created_at": row["created_at"].isoformat() if row.get("created_at") else None,
        "started_at": row["started_at"].isoformat() if row.get("started_at") else None,
        "finished_at": row["finished_at"].isoformat() if row.get("finished_at") else None,
    }


def _counts(job_id: str) -> dict:
    return fetchone(
        """select
             count(*) filter (where status='queued')::int as queued,
             count(*) filter (where status in ('running','provider_pending','output_ready'))::int as running,
             count(*) filter (where status='succeeded')::int as succeeded,
             count(*) filter (where status='failed')::int as failed,
             count(*) filter (where status='cancelled')::int as cancelled,
             count(*) filter (where status='submission_unknown')::int as submission_unknown
           from augmentation_items where job_id=%s""",
        (job_id,),
    ) or {}


def create_job(pid: str, uid: str, mode: str, config: dict[str, Any]) -> dict | None:
    if not get_project(pid, uid):
        return None
    source_ids = [str(value) for value in config.get("source_image_ids") or []]
    sources: dict[str, dict] = {}
    if source_ids:
        rows = fetch(
            """select id, s3_key, filename from images
               where project_id=%s and deleted_at is null and id = any(%s::uuid[])""",
            (pid, source_ids),
        )
        sources = {str(row["id"]): row for row in rows}
        if set(sources) != set(source_ids):
            raise ValueError("source_image_ids")

    job_id = str(uuid.uuid4())
    extension = "png" if mode == "transform" else str(config.get("output_format", "png"))
    planned = plan_items(
        owner_id=uid,
        project_id=pid,
        job_id=job_id,
        mode=mode,
        source_image_ids=source_ids,
        variants_per_source=int(config.get("variants_per_source") or 1),
        count=int(config.get("count") or 0),
        extension="jpg" if extension in {"jpeg", "jpg"} else extension,
    )
    if not planned:
        raise ValueError("outputs")

    with pool().connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """insert into augmentation_jobs
                     (id, project_id, owner_id, mode, config, requested_count)
                   values (%s,%s,%s,%s,%s,%s)""",
                (job_id, pid, uid, mode, Json(config), len(planned)),
            )
            for item in planned:
                source = sources.get(item.source_image_id or "")
                cur.execute(
                    """insert into augmentation_items
                         (id, job_id, ordinal, source_image_id, source_s3_key,
                          source_filename, output_image_id, output_s3_key, output_filename)
                       values (%s,%s,%s,%s,%s,%s,%s,%s,%s)""",
                    (
                        item.id,
                        job_id,
                        item.ordinal,
                        item.source_image_id,
                        source["s3_key"] if source else None,
                        source["filename"] if source else None,
                        item.output_image_id,
                        item.output_key,
                        item.filename,
                    ),
                )
    result = get_job(pid, job_id, uid)
    assert result is not None
    return result


def list_jobs(pid: str, uid: str, *, offset: int = 0, limit: int = 50) -> dict | None:
    if not get_project(pid, uid):
        return None
    rows = fetch(
        """select * from augmentation_jobs where project_id=%s and owner_id=%s
           order by created_at desc limit %s offset %s""",
        (pid, uid, limit, offset),
    )
    total = fetchone(
        "select count(*)::int as n from augmentation_jobs where project_id=%s and owner_id=%s",
        (pid, uid),
    )
    return {
        "items": [_job(row, _counts(str(row["id"]))) for row in rows],
        "total": int(total["n"]) if total else 0,
        "offset": offset,
        "limit": limit,
    }


def get_job(
    pid: str,
    job_id: str,
    uid: str,
    *,
    item_offset: int = 0,
    item_limit: int = 100,
) -> dict | None:
    row = fetchone(
        "select * from augmentation_jobs where id=%s and project_id=%s and owner_id=%s",
        (job_id, pid, uid),
    )
    if not row:
        return None
    items = fetch(
        """select * from augmentation_items where job_id=%s
           order by ordinal limit %s offset %s""",
        (job_id, item_limit, item_offset),
    )
    result = _job(row, _counts(job_id))
    result["items"] = [_item(item) for item in items]
    result["item_offset"] = item_offset
    result["item_limit"] = item_limit
    return result


def aggregate_job_status(pid: str, uid: str) -> dict:
    row = fetchone(
        """select
             count(*) filter (where status in ('queued','running'))::int as active,
             count(*) filter (where status='succeeded')::int as succeeded,
             count(*) filter (where status='partially_succeeded')::int as partially_succeeded,
             count(*) filter (where status='failed')::int as failed
           from augmentation_jobs where project_id=%s and owner_id=%s""",
        (pid, uid),
    ) or {}
    return {key: int(row.get(key) or 0) for key in ("active", "succeeded", "partially_succeeded", "failed")}


def cancel_job(pid: str, job_id: str, uid: str) -> dict | None:
    row = fetchone(
        """update augmentation_jobs set cancel_requested=true, updated_at=now()
           where id=%s and project_id=%s and owner_id=%s returning id""",
        (job_id, pid, uid),
    )
    if not row:
        return None
    execute(
        """update augmentation_items set status='cancelled', finished_at=now(), updated_at=now()
           where job_id=%s and status='queued'""",
        (job_id,),
    )
    refresh_job_status(job_id)
    return get_job(pid, job_id, uid)


def retry_job(pid: str, job_id: str, uid: str) -> dict | None:
    row = fetchone(
        """update augmentation_jobs set cancel_requested=false, status='queued',
             finished_at=null, updated_at=now()
           where id=%s and project_id=%s and owner_id=%s returning id""",
        (job_id, pid, uid),
    )
    if not row:
        return None
    execute(
        """update augmentation_items set status='queued', error=null,
             provider_prediction_id=null, provider_payload=null, finished_at=null, updated_at=now()
           where job_id=%s and status in ('failed','cancelled','submission_unknown')""",
        (job_id,),
    )
    refresh_job_status(job_id)
    return get_job(pid, job_id, uid)


def heartbeat(worker_id: str, metadata: dict[str, Any] | None = None) -> None:
    execute(
        """insert into worker_heartbeats (worker_id, metadata, updated_at)
           values (%s,%s,now()) on conflict (worker_id) do update
           set metadata=excluded.metadata, updated_at=excluded.updated_at""",
        (worker_id, Json(metadata or {})),
    )


def claim_item() -> dict | None:
    with pool().connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """select i.*, j.mode, j.config, j.project_id, j.owner_id
                   from augmentation_items i join augmentation_jobs j on j.id=i.job_id
                   where i.status='queued' and not j.cancel_requested
                   order by i.created_at, i.ordinal for update of i skip locked limit 1"""
            )
            row = cur.fetchone()
            if not row:
                return None
            cur.execute(
                """update augmentation_items set status='running', attempts=attempts+1,
                     started_at=coalesce(started_at, now()), updated_at=now() where id=%s""",
                (str(row["id"]),),
            )
            cur.execute(
                """update augmentation_jobs set status='running',
                     started_at=coalesce(started_at, now()), updated_at=now() where id=%s""",
                (str(row["job_id"]),),
            )
            row["attempts"] = int(row["attempts"]) + 1
            row["status"] = "running"
            return row


def item_cancelled(item_id: str) -> bool:
    row = fetchone(
        """select j.cancel_requested from augmentation_items i
           join augmentation_jobs j on j.id=i.job_id where i.id=%s""",
        (item_id,),
    )
    return bool(row and row["cancel_requested"])


def finalize_item(item: dict, body: bytes, content_type: str) -> None:
    from backend.infra import s3

    s3.put(item["output_s3_key"], body, content_type)
    with pool().connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """insert into images (id, project_id, s3_key, filename, objects, committed)
                   values (%s,%s,%s,%s,%s,false) on conflict (id) do nothing""",
                (
                    str(item["output_image_id"]),
                    str(item["project_id"]),
                    item["output_s3_key"],
                    item["output_filename"],
                    Json([]),
                ),
            )
            cur.execute(
                """update augmentation_items set status='succeeded', error=null,
                     finished_at=now(), updated_at=now() where id=%s""",
                (str(item["id"]),),
            )
    refresh_job_status(str(item["job_id"]))


def fail_item(item_id: str, job_id: str, error: str, status: str = "failed") -> None:
    execute(
        """update augmentation_items set status=%s, error=%s,
             finished_at=now(), updated_at=now() where id=%s""",
        (status, error[:2000], item_id),
    )
    refresh_job_status(job_id)


def cancel_claimed_item(item_id: str, job_id: str) -> None:
    execute(
        """update augmentation_items set status='cancelled', error=null,
             finished_at=now(), updated_at=now() where id=%s""",
        (item_id,),
    )
    refresh_job_status(job_id)


def recover_stale_items(minutes: int = 10) -> int:
    rows = fetch(
        """update augmentation_items set status='queued',
             error='worker interrupted; safely requeued', updated_at=now()
           where status='running' and updated_at < now() - (%s * interval '1 minute')
           returning job_id""",
        (minutes,),
    )
    for job_id in {str(row["job_id"]) for row in rows}:
        refresh_job_status(job_id)
    return len(rows)


def refresh_job_status(job_id: str) -> str:
    counts = _counts(job_id)
    active = int(counts.get("queued") or 0) + int(counts.get("running") or 0)
    succeeded = int(counts.get("succeeded") or 0)
    failed = int(counts.get("failed") or 0) + int(counts.get("submission_unknown") or 0)
    cancelled = int(counts.get("cancelled") or 0)
    if active:
        status = "running"
    elif succeeded and not failed and not cancelled:
        status = "succeeded"
    elif succeeded:
        status = "partially_succeeded"
    elif cancelled and not failed:
        status = "cancelled"
    else:
        status = "failed"
    terminal = status not in {"queued", "running"}
    execute(
        """update augmentation_jobs set status=%s, updated_at=now(),
             finished_at=case when %s then now() else null end where id=%s""",
        (status, terminal, job_id),
    )
    return status
