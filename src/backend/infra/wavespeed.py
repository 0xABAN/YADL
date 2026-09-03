from __future__ import annotations

import hashlib
import hmac
import json
import os
import time
import urllib.error
import urllib.request
from dataclasses import dataclass
from typing import Any, Callable, Mapping

TEXT_MODEL = "openai/gpt-image-2/text-to-image"
EDIT_MODEL = "openai/gpt-image-2/edit"
API_BASE = "https://api.wavespeed.ai/api/v3"


class WaveSpeedError(RuntimeError):
    def __init__(self, message: str, *, status: int | None = None):
        super().__init__(message)
        self.status = status


class AmbiguousSubmissionError(WaveSpeedError):
    """The POST outcome is unknown; automatic retry could bill twice."""


@dataclass(frozen=True)
class PredictionResult:
    id: str
    status: str
    output_urls: list[str]
    error: str | None
    payload: dict[str, Any]


def verify_webhook(
    body: bytes,
    headers: Mapping[str, str],
    secret: str,
    *,
    now: float | None = None,
    max_age_seconds: int = 300,
) -> bool:
    try:
        webhook_id = headers["webhook-id"]
        timestamp_text = headers["webhook-timestamp"]
        timestamp = int(timestamp_text)
        supplied = headers["webhook-signature"]
    except (KeyError, TypeError, ValueError):
        return False
    current = time.time() if now is None else now
    if abs(current - timestamp) > max_age_seconds:
        return False
    key = secret.removeprefix("whsec_").encode()
    signed = f"{webhook_id}.{timestamp_text}.".encode() + body
    expected = hmac.new(key, signed, hashlib.sha256).hexdigest()
    signatures = [part.strip() for part in supplied.split()]
    return any(
        part.startswith("v3,") and hmac.compare_digest(part.split(",", 1)[1], expected)
        for part in signatures
    )


def build_prediction_input(
    mode: str,
    config: dict[str, Any],
    callback_url: str,
    source_url: str | None,
) -> tuple[str, dict[str, Any]]:
    payload = {
        "prompt": config["prompt"],
        "aspect_ratio": config.get("aspect_ratio", "1:1"),
        "resolution": config.get("resolution", "1k"),
        "quality": config.get("quality", "medium"),
        "output_format": config.get("output_format", "png"),
        "callback_url": callback_url,
        "enable_sync_mode": False,
        "enable_base64_output": False,
    }
    if mode == "text_to_image":
        return TEXT_MODEL, payload
    if mode == "image_edit" and source_url:
        payload["images"] = [source_url]
        return EDIT_MODEL, payload
    raise ValueError("invalid generation request")


class WaveSpeedClient:
    def __init__(
        self,
        api_key: str | None = None,
        *,
        request_json: Callable[[str, str, dict[str, Any] | None], dict[str, Any]] | None = None,
    ):
        self.api_key = api_key if api_key is not None else os.environ.get("WAVESPEED_API_KEY", "")
        self._request_json_override = request_json

    def _request_json(
        self, method: str, path: str, payload: dict[str, Any] | None = None
    ) -> dict[str, Any]:
        if self._request_json_override:
            return self._request_json_override(method, path, payload)
        if not self.api_key:
            raise WaveSpeedError("WAVESPEED_API_KEY is missing")
        body = json.dumps(payload).encode() if payload is not None else None
        request = urllib.request.Request(
            f"{API_BASE}{path}",
            data=body,
            method=method,
            headers={"Authorization": f"Bearer {self.api_key}", "Content-Type": "application/json"},
        )
        try:
            with urllib.request.urlopen(request, timeout=45) as response:
                return json.loads(response.read())
        except urllib.error.HTTPError as exc:
            detail = exc.read().decode(errors="replace")[:1000]
            raise WaveSpeedError(f"WaveSpeed HTTP {exc.code}: {detail}", status=exc.code) from exc
        except (json.JSONDecodeError, UnicodeDecodeError) as exc:
            raise WaveSpeedError("WaveSpeed returned invalid JSON") from exc
        except (urllib.error.URLError, TimeoutError, OSError) as exc:
            raise WaveSpeedError(f"WaveSpeed network error: {exc}") from exc

    def submit(self, model: str, payload: dict[str, Any]) -> str:
        if model not in {TEXT_MODEL, EDIT_MODEL}:
            raise ValueError("unsupported WaveSpeed model")
        try:
            response = self._request_json("POST", f"/{model}", payload)
        except WaveSpeedError as exc:
            if exc.status is None:
                raise AmbiguousSubmissionError(str(exc)) from exc
            raise
        data = response.get("data") if isinstance(response, dict) else None
        prediction_id = str(data.get("id") or "") if isinstance(data, dict) else ""
        if not prediction_id:
            raise AmbiguousSubmissionError("WaveSpeed response omitted the prediction id")
        return prediction_id

    def result(self, prediction_id: str) -> PredictionResult:
        response = self._request_json("GET", f"/predictions/{prediction_id}/result")
        data = response.get("data") if isinstance(response, dict) else None
        if not isinstance(data, dict):
            raise WaveSpeedError("WaveSpeed returned a malformed prediction result")
        outputs = data.get("outputs") or data.get("output") or []
        if isinstance(outputs, str):
            outputs = [outputs]
        elif not isinstance(outputs, list):
            outputs = []
        error = data.get("error")
        return PredictionResult(
            id=str(data.get("id") or prediction_id),
            status=str(data.get("status") or "unknown").lower(),
            output_urls=[str(url) for url in outputs if isinstance(url, str)],
            error=str(error) if error else None,
            payload=response,
        )

    def delete(self, prediction_ids: list[str]) -> None:
        if prediction_ids:
            self._request_json("POST", "/predictions/delete", {"ids": prediction_ids})

    def download(self, url: str, *, max_bytes: int = 100 * 1024 * 1024) -> tuple[bytes, str]:
        request = urllib.request.Request(url, method="GET")
        try:
            with urllib.request.urlopen(request, timeout=90) as response:
                body = response.read(max_bytes + 1)
                if len(body) > max_bytes:
                    raise WaveSpeedError("generated image exceeds 100 MB")
                return body, response.headers.get_content_type()
        except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError, OSError) as exc:
            raise WaveSpeedError(f"could not download generated image: {exc}") from exc
