"""Transactional augmentation-store state-machine tests.

The database connection is real, but every case rolls back. Provider and S3
boundaries are always stubbed.
"""
from __future__ import annotations

import contextlib
import sys
import uuid
from collections.abc import Iterator
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from backend.infra import augmentation_store as store
from backend.infra import db


OWNER = "augmentation-store-test-owner"
OTHER_OWNER = "augmentation-store-test-other"
PROJECT = "10000000-0000-0000-0000-000000000001"
OTHER_PROJECT = "10000000-0000-0000-0000-000000000002"


class _TransactionPool:
    def __init__(self, connection):
        self._connection = connection

    @contextlib.contextmanager
    def connection(self):
        yield self._connection


@contextlib.contextmanager
def _transactional_store() -> Iterator:
    connection_pool = db.pool()
    connection = connection_pool.getconn()
    connection.execute("begin")

    def fetch(sql: str, params: tuple = ()):
        with connection.cursor() as cursor:
            cursor.execute(sql, params)
            return cursor.fetchall()

    def fetchone(sql: str, params: tuple = ()):
        with connection.cursor() as cursor:
            cursor.execute(sql, params)
            return cursor.fetchone()

    def execute(sql: str, params: tuple = ()):
        with connection.cursor() as cursor:
            cursor.execute(sql, params)

    def get_project(pid: str, uid: str):
        row = fetchone(
            "select id, name, type, template, classes from projects where id=%s and owner_id=%s",
            (pid, uid),
        )
        return dict(row) if row else None

    try:
        execute("insert into users (id) values (%s) on conflict do nothing", (OWNER,))
        execute("insert into users (id) values (%s) on conflict do nothing", (OTHER_OWNER,))
        execute(
            "insert into projects (id, owner_id, name, type, classes) values (%s,%s,%s,'boxes','[]')",
            (PROJECT, OWNER, "augmentation-store-test"),
        )
        execute(
            "insert into projects (id, owner_id, name, type, classes) values (%s,%s,%s,'boxes','[]')",
            (OTHER_PROJECT, OTHER_OWNER, "augmentation-store-test-other"),
        )
        with patch.multiple(
            store,
            fetch=fetch,
            fetchone=fetchone,
            execute=execute,
            get_project=get_project,
            pool=lambda: _TransactionPool(connection),
        ):
            yield connection
    finally:
        connection.rollback()
        connection_pool.putconn(connection)


def _insert_item(
    connection,
    *,
    status: str,
    cancel_requested: bool = False,
    prediction_id: str | None = None,
) -> tuple[str, str]:
    job_id = str(uuid.uuid4())
    item_id = str(uuid.uuid4())
    output_id = str(uuid.uuid4())
    connection.execute(
        """insert into augmentation_jobs
             (id, project_id, owner_id, mode, config, status, requested_count, cancel_requested)
           values (%s,%s,%s,'text_to_image','{}',%s,1,%s)""",
        (job_id, PROJECT, OWNER, "running", cancel_requested),
    )
    connection.execute(
        """insert into augmentation_items
             (id, job_id, ordinal, output_image_id, output_s3_key, output_filename,
              status, provider_prediction_id)
           values (%s,%s,0,%s,%s,'generated.png',%s,%s)""",
        (item_id, job_id, output_id, f"{OWNER}/{PROJECT}/{output_id}/generated.png", status, prediction_id),
    )
    return job_id, item_id


def _status(connection, item_id: str) -> str:
    return connection.execute(
        "select status from augmentation_items where id=%s", (item_id,)
    ).fetchone()["status"]


def test_create_job_rejects_deleted_and_foreign_sources() -> None:
    with _transactional_store() as connection:
        deleted_id = str(uuid.uuid4())
        foreign_id = str(uuid.uuid4())
        connection.execute(
            """insert into images (id, project_id, s3_key, filename, deleted_at)
               values (%s,%s,'deleted','deleted.png',now()),
                      (%s,%s,'foreign','foreign.png',null)""",
            (deleted_id, PROJECT, foreign_id, OTHER_PROJECT),
        )
        for source_id in (deleted_id, foreign_id):
            try:
                store.create_job(
                    PROJECT,
                    OWNER,
                    "transform",
                    {
                        "source_image_ids": [source_id],
                        "variants_per_source": 1,
                        "pipeline": [{"op": "flip"}],
                    },
                )
                raise AssertionError("expected source rejection")
            except ValueError as error:
                assert "source_image_ids" in str(error)


def test_many_sources_and_outputs_are_created_and_paginated() -> None:
    with _transactional_store() as connection:
        source_ids = [str(uuid.uuid4()) for _ in range(101)]
        with connection.cursor() as cursor:
            cursor.executemany(
                "insert into images (id, project_id, s3_key, filename) values (%s,%s,%s,%s)",
                (
                    (source_id, PROJECT, f"source/{source_id}", f"{source_id}.png")
                    for source_id in source_ids
                ),
            )
        created = store.create_job(
            PROJECT,
            OWNER,
            "transform",
            {
                "source_image_ids": source_ids,
                "variants_per_source": 3,
                "pipeline": [{"op": "flip"}],
            },
        )
        assert created is not None
        assert created["requested_count"] == 303
        first = store.get_job(PROJECT, created["id"], OWNER, item_offset=0, item_limit=200)
        second = store.get_job(PROJECT, created["id"], OWNER, item_offset=200, item_limit=200)
        assert first is not None and second is not None
        assert len(first["items"]) == 200
        assert len(second["items"]) == 103
        assert first["items"][0]["ordinal"] == 0
        assert second["items"][0]["ordinal"] == 200


def test_large_text_generation_job_preallocates_1500_unique_outputs() -> None:
    with _transactional_store() as connection:
        created = store.create_job(
            PROJECT,
            OWNER,
            "text_to_image",
            {"prompt": "stress test", "count": 1500, "output_format": "png"},
        )
        assert created is not None
        assert created["requested_count"] == 1500
        row = connection.execute(
            """select count(*) as total, count(distinct output_image_id) as output_ids,
                      count(distinct output_s3_key) as output_keys
               from augmentation_items where job_id=%s""",
            (created["id"],),
        ).fetchone()
        assert row == {"total": 1500, "output_ids": 1500, "output_keys": 1500}


def test_late_progress_webhook_cannot_regress_terminal_or_completed_item() -> None:
    with _transactional_store() as connection:
        for initial in ("queued", "running", "output_ready", "ingesting", "failed"):
            _job_id, item_id = _insert_item(
                connection, status=initial, prediction_id=f"prediction-{initial}"
            )
            assert store.record_provider_result(
                item_id,
                {"data": {"id": f"prediction-{initial}", "status": "processing"}},
            )
            assert _status(connection, item_id) == initial


def test_malformed_completed_output_is_an_actionable_item_failure() -> None:
    with _transactional_store() as connection:
        _job_id, item_id = _insert_item(
            connection, status="provider_pending", prediction_id="prediction-malformed"
        )
        assert store.record_provider_result(
            item_id,
            {"data": {"id": "prediction-malformed", "status": "completed", "outputs": 17}},
        )
        row = connection.execute(
            "select status, error from augmentation_items where id=%s", (item_id,)
        ).fetchone()
        assert row["status"] == "failed"
        assert "output URL" in row["error"]


def test_worker_failure_cannot_overwrite_cancelled_or_succeeded_item() -> None:
    with _transactional_store() as connection:
        for initial in ("cancelled", "succeeded"):
            job_id, item_id = _insert_item(connection, status=initial)
            store.fail_item(item_id, job_id, "late worker failure")
            assert _status(connection, item_id) == initial


def test_provider_id_is_retained_when_cancel_wins_submission_race() -> None:
    with _transactional_store() as connection:
        _job_id, item_id = _insert_item(connection, status="cancelled", cancel_requested=True)
        store.mark_provider_pending(item_id, "prediction-after-cancel")
        row = connection.execute(
            "select status, provider_prediction_id from augmentation_items where id=%s", (item_id,)
        ).fetchone()
        assert row["status"] == "cancelled"
        assert row["provider_prediction_id"] == "prediction-after-cancel"


def test_cancelling_provider_item_keeps_prediction_available_for_deletion() -> None:
    with _transactional_store() as _connection:
        job_id, _item_id = _insert_item(
            _connection, status="provider_pending", prediction_id="prediction-to-delete"
        )
        result = store.cancel_job(PROJECT, job_id, OWNER)
        assert result is not None
        assert result["status"] == "cancelled"
        assert store.provider_predictions(job_id) == ["prediction-to-delete"]


def test_duplicate_completion_is_idempotent_and_wrong_prediction_is_ignored() -> None:
    with _transactional_store() as connection:
        _job_id, item_id = _insert_item(
            connection, status="provider_pending", prediction_id="prediction-right"
        )
        completed = {
            "data": {
                "id": "prediction-right",
                "status": "completed",
                "outputs": ["https://cdn/output.png"],
            }
        }
        assert not store.record_provider_result(
            item_id,
            {"data": {"id": "prediction-wrong", "status": "failed", "error": "wrong"}},
        )
        assert _status(connection, item_id) == "provider_pending"
        assert store.record_provider_result(item_id, completed)
        assert store.record_provider_result(item_id, completed)
        row = connection.execute(
            "select status, provider_payload from augmentation_items where id=%s", (item_id,)
        ).fetchone()
        assert row["status"] == "output_ready"
        assert row["provider_payload"] == completed


def test_late_cancel_cannot_overwrite_succeeded_item() -> None:
    with _transactional_store() as connection:
        job_id, item_id = _insert_item(connection, status="succeeded", cancel_requested=True)
        store.cancel_claimed_item(item_id, job_id)
        assert _status(connection, item_id) == "succeeded"


def test_stale_ingestion_is_requeued_for_idempotent_finalization() -> None:
    with _transactional_store() as connection:
        _job_id, item_id = _insert_item(connection, status="ingesting")
        connection.execute(
            "update augmentation_items set updated_at=now() - interval '30 minutes' where id=%s",
            (item_id,),
        )
        assert store.recover_stale_items(10) == 1
        row = connection.execute(
            "select status, error from augmentation_items where id=%s", (item_id,)
        ).fetchone()
        assert row["status"] == "output_ready"
        assert "requeued" in row["error"]


def test_stale_running_and_submission_states_recover_without_duplicate_post() -> None:
    with _transactional_store() as connection:
        _running_job, running_item = _insert_item(connection, status="running")
        _submitting_job, submitting_item = _insert_item(connection, status="submitting")
        connection.execute(
            """update augmentation_items set updated_at=now() - interval '30 minutes'
               where id = any(%s::uuid[])""",
            ([running_item, submitting_item],),
        )
        assert store.recover_stale_items(10) == 2
        rows = connection.execute(
            """select id, status, error from augmentation_items
               where id = any(%s::uuid[]) order by id""",
            ([running_item, submitting_item],),
        ).fetchall()
        by_id = {str(row["id"]): row for row in rows}
        assert by_id[running_item]["status"] == "queued"
        assert "safely requeued" in by_id[running_item]["error"]
        assert by_id[submitting_item]["status"] == "submission_unknown"
        assert "explicit retry" in by_id[submitting_item]["error"]


def test_finalization_refuses_cancelled_items_without_uploading() -> None:
    with _transactional_store() as connection:
        job_id, item_id = _insert_item(
            connection, status="cancelled", cancel_requested=True
        )
        row = connection.execute(
            """select i.*, j.project_id, j.owner_id
               from augmentation_items i join augmentation_jobs j on j.id=i.job_id
               where i.id=%s""",
            (item_id,),
        ).fetchone()
        with patch("backend.infra.s3.put") as put:
            assert store.finalize_item(dict(row), b"image", "image/png") is False
        put.assert_not_called()
        assert _status(connection, item_id) == "cancelled"
        assert connection.execute(
            "select count(*) as n from images where id=%s", (str(row["output_image_id"]),)
        ).fetchone()["n"] == 0
        assert store.refresh_job_status(job_id) == "cancelled"


def test_finalization_is_idempotent_and_creates_an_empty_uncommitted_image() -> None:
    with _transactional_store() as connection:
        job_id, item_id = _insert_item(connection, status="running")
        row = connection.execute(
            """select i.*, j.project_id, j.owner_id
               from augmentation_items i join augmentation_jobs j on j.id=i.job_id
               where i.id=%s""",
            (item_id,),
        ).fetchone()
        with patch("backend.infra.s3.put") as put:
            assert store.finalize_item(dict(row), b"image", "image/png") is True
            assert store.finalize_item(dict(row), b"image", "image/png") is False
        put.assert_called_once_with(row["output_s3_key"], b"image", "image/png")
        output = connection.execute(
            "select objects, committed from images where id=%s", (str(row["output_image_id"]),)
        ).fetchone()
        assert output == {"objects": [], "committed": False}
        assert _status(connection, item_id) == "succeeded"
        assert store.refresh_job_status(job_id) == "succeeded"


def test_partial_success_retry_preserves_outputs_and_requeues_only_failures() -> None:
    with _transactional_store() as connection:
        job_id, first = _insert_item(connection, status="succeeded")
        output_ids = [
            connection.execute(
                "select output_image_id from augmentation_items where id=%s", (first,)
            ).fetchone()["output_image_id"]
        ]
        for ordinal, status in enumerate(("failed", "submission_unknown"), start=1):
            item_id = str(uuid.uuid4())
            output_id = str(uuid.uuid4())
            output_ids.append(output_id)
            connection.execute(
                """insert into augmentation_items
                     (id, job_id, ordinal, output_image_id, output_s3_key, output_filename,
                      status, attempts, error, provider_prediction_id)
                   values (%s,%s,%s,%s,%s,%s,%s,2,'failure','old-prediction')""",
                (
                    item_id,
                    job_id,
                    ordinal,
                    output_id,
                    f"output/{output_id}",
                    f"{ordinal}.png",
                    status,
                ),
            )
        connection.execute(
            "update augmentation_jobs set requested_count=3, status='partially_succeeded' where id=%s",
            (job_id,),
        )
        result = store.retry_job(PROJECT, job_id, OWNER)
        assert result is not None
        assert result["status"] == "running"
        statuses = [
            row["status"]
            for row in connection.execute(
                "select status from augmentation_items where job_id=%s order by ordinal", (job_id,)
            ).fetchall()
        ]
        assert statuses == ["succeeded", "queued", "queued"]
        assert [str(value) for value in output_ids] == [
            str(row["output_image_id"])
            for row in connection.execute(
                "select output_image_id from augmentation_items where job_id=%s order by ordinal",
                (job_id,),
            ).fetchall()
        ]


if __name__ == "__main__":
    test_create_job_rejects_deleted_and_foreign_sources()
    test_many_sources_and_outputs_are_created_and_paginated()
    test_large_text_generation_job_preallocates_1500_unique_outputs()
    test_late_progress_webhook_cannot_regress_terminal_or_completed_item()
    test_malformed_completed_output_is_an_actionable_item_failure()
    test_worker_failure_cannot_overwrite_cancelled_or_succeeded_item()
    test_provider_id_is_retained_when_cancel_wins_submission_race()
    test_cancelling_provider_item_keeps_prediction_available_for_deletion()
    test_duplicate_completion_is_idempotent_and_wrong_prediction_is_ignored()
    test_late_cancel_cannot_overwrite_succeeded_item()
    test_stale_ingestion_is_requeued_for_idempotent_finalization()
    test_stale_running_and_submission_states_recover_without_duplicate_post()
    test_finalization_refuses_cancelled_items_without_uploading()
    test_finalization_is_idempotent_and_creates_an_empty_uncommitted_image()
    test_partial_success_retry_preserves_outputs_and_requeues_only_failures()
    print("ok")
