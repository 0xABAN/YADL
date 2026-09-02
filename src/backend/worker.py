from __future__ import annotations

import os
import signal
import socket
import time

from backend.domain.augment import apply_pipeline
from backend.infra import augmentation_store as jobs
from backend.infra import s3

_stopping = False


def _stop(_signum, _frame) -> None:
    global _stopping
    _stopping = True


def run_once() -> bool:
    item = jobs.claim_item()
    if not item:
        return False
    item_id = str(item["id"])
    job_id = str(item["job_id"])
    try:
        if item["mode"] != "transform":
            raise ValueError("generation provider is not configured")
        if not item.get("source_s3_key"):
            raise ValueError("source image is missing")
        source = s3.read(item["source_s3_key"])
        config = item["config"] or {}
        result = apply_pipeline(
            source,
            list(config.get("pipeline") or []),
            seed=int(config.get("seed") or 0) + int(item["ordinal"]),
        )
        if jobs.item_cancelled(item_id):
            jobs.cancel_claimed_item(item_id, job_id)
            return True
        jobs.finalize_item(item, result.body, result.content_type)
    except Exception as exc:
        jobs.fail_item(item_id, job_id, str(exc) or exc.__class__.__name__)
    return True


def main() -> None:
    signal.signal(signal.SIGTERM, _stop)
    signal.signal(signal.SIGINT, _stop)
    worker_id = os.environ.get("RAILWAY_REPLICA_ID") or f"{socket.gethostname()}:{os.getpid()}"
    while not _stopping:
        try:
            jobs.heartbeat(worker_id, {"service": "augmentation"})
            jobs.recover_stale_items()
            worked = run_once()
        except Exception:
            worked = False
        if not worked:
            time.sleep(1)


if __name__ == "__main__":
    main()
