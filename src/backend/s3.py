import os
from functools import lru_cache
from pathlib import Path

import boto3

import backend.db


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


def presign_get(key: str, seconds: int = 120) -> str:
    return _client().generate_presigned_url(
        "get_object", Params={"Bucket": _bucket(), "Key": key}, ExpiresIn=seconds
    )


def download(key: str, dest: Path) -> None:
    _client().download_file(_bucket(), key, str(dest))
