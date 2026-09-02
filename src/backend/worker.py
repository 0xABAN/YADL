from __future__ import annotations

import os
import signal
import socket
import time

from backend.domain.augment import apply_pipeline, normalize_generated_image
from backend.infra import augmentation_store as jobs
from backend.infra import s3
from backend.infra.wavespeed import (
    AmbiguousSubmissionError,
    WaveSpeedClient,
    build_prediction_input,
)

_stopping = False


def _stop(_signum, _frame) -> None:
    global _stopping
    _stopping = True


def run_once() -> bool:
    item = jobs.claim_item()
    if not item:
        ready = jobs.claim_output_item()
        if ready:
            _ingest_output(ready)
            return True
        return _reconcile_one()
    item_id = str(item["id"])
    job_id = str(item["job_id"])
    try:
        if item["mode"] == "transform":
            if not item.get("source_s3_key"):
                raise ValueError("source image is missing")
            source = s3.read(item["source_s3_key"])
            config = item["config"] or {}
            result = apply_pipeline(
                source,
                list(config.get("pipeline") or []),
                seed=int(config.get("seed") or 0) + int(item["ordinal"]),
            )
        else:
            _submit_generation(item)
            return True
        if jobs.item_cancelled(item_id):
            jobs.cancel_claimed_item(item_id, job_id)
            return True
        jobs.finalize_item(item, result.body, result.content_type)
    except Exception as exc:
        jobs.fail_item(item_id, job_id, str(exc) or exc.__class__.__name__)
    return True


def _submit_generation(item: dict) -> None:
    item_id = str(item["id"])
    job_id = str(item["job_id"])
    base = os.environ.get("WAVESPEED_CALLBACK_BASE_URL", "").rstrip("/")
    if not base:
        jobs.fail_item(item_id, job_id, "WAVESPEED_CALLBACK_BASE_URL is missing")
        return
    source_url = s3.presign_get(item["source_s3_key"], 3600) if item.get("source_s3_key") else None
    model, payload = build_prediction_input(
        item["mode"], item["config"] or {}, f"{base}/augmentation-callbacks/{item_id}", source_url
    )
    client = WaveSpeedClient()
    jobs.mark_submitting(item_id)
    try:
        prediction_id = client.submit(model, payload)
    except AmbiguousSubmissionError as exc:
        jobs.fail_item(item_id, job_id, str(exc), status="submission_unknown")
        return
    except Exception as exc:
        jobs.fail_item(item_id, job_id, str(exc) or exc.__class__.__name__)
        return
    jobs.mark_provider_pending(item_id, prediction_id)


def _reconcile_one() -> bool:
    pending = jobs.pending_predictions(1)
    if not pending:
        return False
    item = pending[0]
    try:
        result = WaveSpeedClient().result(str(item["provider_prediction_id"]))
        jobs.record_provider_result(str(item["id"]), result.payload)
    except Exception:
        # GET reconciliation is safe to repeat; leave the item pending.
        pass
    return True


def _ingest_output(item: dict) -> None:
    item_id = str(item["id"])
    job_id = str(item["job_id"])
    try:
        payload = item.get("provider_payload") or {}
        data = payload.get("data") if isinstance(payload.get("data"), dict) else payload
        outputs = data.get("outputs") or data.get("output") or []
        if isinstance(outputs, str):
            outputs = [outputs]
        if not outputs or not isinstance(outputs[0], str):
            raise ValueError("WaveSpeed completed without an output URL")
        body, _content_type = WaveSpeedClient().download(outputs[0])
        result = normalize_generated_image(body, str((item["config"] or {}).get("output_format", "png")))
        if jobs.item_cancelled(item_id):
            jobs.cancel_claimed_item(item_id, job_id)
            return
        jobs.finalize_item(item, result.body, result.content_type)
    except Exception as exc:
        jobs.fail_item(item_id, job_id, str(exc) or exc.__class__.__name__)


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
