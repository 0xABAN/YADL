import os
from functools import lru_cache
from pathlib import Path

import boto3

import backend.infra.db  # noqa: F401 — load_env


@lru_cache(maxsize=1)
def _client():
    kw: dict = {"region_name": os.environ.get("AWS_REGION") or os.environ.get("AWS_DEFAULT_REGION") or "us-east-1"}
    if os.environ.get("S3_ENDPOINT"):
        kw["endpoint_url"] = os.environ["S3_ENDPOINT"]
    return boto3.client("s3", **kw)


def _bucket() -> str:
    b = os.environ.get("S3_BUCKET")
    if not b:
        raise RuntimeError("S3_BUCKET missing (.env at repo root)")
    return b


def put(key: str, body: bytes, content_type: str = "application/octet-stream") -> None:
    _client().put_object(Bucket=_bucket(), Key=key, Body=body, ContentType=content_type)


def read(key: str) -> bytes:
    return _client().get_object(Bucket=_bucket(), Key=key)["Body"].read()


def presign_get(key: str, seconds: int = 120) -> str:
    return _client().generate_presigned_url(
        "get_object", Params={"Bucket": _bucket(), "Key": key}, ExpiresIn=seconds
    )


def presign_put(key: str, content_type: str, seconds: int = 600) -> str:
    """Browser PUT must send the same Content-Type."""
    return _client().generate_presigned_url(
        "put_object",
        Params={"Bucket": _bucket(), "Key": key, "ContentType": content_type},
        ExpiresIn=seconds,
        HttpMethod="PUT",
    )


def exists(key: str) -> bool:
    try:
        _client().head_object(Bucket=_bucket(), Key=key)
        return True
    except Exception:
        return False


def download(key: str, dest: Path) -> None:
    _client().download_file(_bucket(), key, str(dest))


def delete(key: str) -> None:
    _client().delete_object(Bucket=_bucket(), Key=key)
