"""WaveSpeed request and webhook contract tests (no provider calls)."""
from __future__ import annotations

import hashlib
import hmac
import json
import sys
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from backend.infra.wavespeed import (
    AmbiguousSubmissionError,
    EDIT_MODEL,
    TEXT_MODEL,
    WaveSpeedClient,
    WaveSpeedError,
    build_prediction_input,
    verify_webhook,
)


def _signature(secret: str, webhook_id: str, timestamp: int, body: bytes) -> str:
    key = secret.removeprefix("whsec_").encode()
    payload = f"{webhook_id}.{timestamp}.".encode() + body
    return "v3," + hmac.new(key, payload, hashlib.sha256).hexdigest()


def test_webhook_signature_uses_raw_body_and_rejects_stale_or_tampered_data() -> None:
    body = b'{"data":{"id":"prediction"}}'
    headers = {"webhook-id": "message-1", "webhook-timestamp": "1000"}
    headers["webhook-signature"] = _signature("whsec_secret", "message-1", 1000, body)
    assert verify_webhook(body, headers, "whsec_secret", now=1100)
    assert not verify_webhook(body + b" ", headers, "whsec_secret", now=1100)
    assert not verify_webhook(body, headers, "whsec_secret", now=1401)


def test_payloads_pin_models_and_callback_item_identity() -> None:
    options = {
        "prompt": "A hand against a plain wall",
        "aspect_ratio": "1:1",
        "resolution": "1k",
        "quality": "high",
        "output_format": "png",
    }
    model, text_payload = build_prediction_input("text_to_image", options, "https://api/callback/item", None)
    assert model == TEXT_MODEL
    assert text_payload["callback_url"].endswith("/item")
    assert "model" not in text_payload

    model, edit_payload = build_prediction_input(
        "image_edit", options, "https://api/callback/item", "https://signed/source"
    )
    assert model == EDIT_MODEL
    assert edit_payload["images"] == ["https://signed/source"]


def test_client_extracts_prediction_id_and_result_urls() -> None:
    replies = iter(
        [
            {"data": {"id": "pred-1"}},
            {"data": {"id": "pred-1", "status": "completed", "outputs": ["https://cdn/output.png"]}},
        ]
    )
    client = WaveSpeedClient(api_key="test", request_json=lambda *_args, **_kwargs: next(replies))
    assert client.submit(TEXT_MODEL, {"prompt": "x"}) == "pred-1"
    result = client.result("pred-1")
    assert result.status == "completed"
    assert result.output_urls == ["https://cdn/output.png"]


def test_submit_never_retries_an_ambiguous_post() -> None:
    calls = 0

    def network_failure(*_args, **_kwargs):
        nonlocal calls
        calls += 1
        raise WaveSpeedError("timed out")

    client = WaveSpeedClient(api_key="test", request_json=network_failure)
    try:
        client.submit(TEXT_MODEL, {"prompt": "x"})
        raise AssertionError("expected ambiguous submission")
    except AmbiguousSubmissionError:
        pass
    assert calls == 1


def test_explicit_rate_limit_is_not_marked_ambiguous() -> None:
    def rate_limit(*_args, **_kwargs):
        raise WaveSpeedError("rate limited", status=429)

    client = WaveSpeedClient(api_key="test", request_json=rate_limit)
    try:
        client.submit(TEXT_MODEL, {"prompt": "x"})
        raise AssertionError("expected provider error")
    except AmbiguousSubmissionError as exc:
        raise AssertionError("known HTTP response must not be ambiguous") from exc
    except WaveSpeedError as exc:
        assert exc.status == 429


def test_malformed_successful_submission_response_is_ambiguous() -> None:
    client = WaveSpeedClient(api_key="test", request_json=lambda *_args: [])  # type: ignore[arg-type]
    try:
        client.submit(TEXT_MODEL, {"prompt": "x"})
        raise AssertionError("expected ambiguous submission")
    except AmbiguousSubmissionError:
        pass


def test_malformed_result_outputs_are_treated_as_empty() -> None:
    client = WaveSpeedClient(
        api_key="test",
        request_json=lambda *_args: {
            "data": {"id": "pred-1", "status": "completed", "outputs": 17}
        },
    )
    result = client.result("pred-1")
    assert result.status == "completed"
    assert result.output_urls == []


def test_non_json_submission_response_is_ambiguous() -> None:
    class Response:
        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return None

        def read(self):
            return b"not json"

    client = WaveSpeedClient(api_key="test")
    with patch("backend.infra.wavespeed.urllib.request.urlopen", return_value=Response()):
        try:
            client.submit(TEXT_MODEL, {"prompt": "x"})
            raise AssertionError("expected ambiguous submission")
        except AmbiguousSubmissionError:
            pass


def test_malformed_result_envelope_raises_provider_error() -> None:
    client = WaveSpeedClient(
        api_key="test", request_json=lambda *_args: {"data": ["not", "an", "object"]}
    )
    try:
        client.result("pred-1")
        raise AssertionError("expected provider error")
    except WaveSpeedError as error:
        assert "malformed" in str(error)


if __name__ == "__main__":
    test_webhook_signature_uses_raw_body_and_rejects_stale_or_tampered_data()
    test_payloads_pin_models_and_callback_item_identity()
    test_client_extracts_prediction_id_and_result_urls()
    test_submit_never_retries_an_ambiguous_post()
    test_explicit_rate_limit_is_not_marked_ambiguous()
    test_malformed_successful_submission_response_is_ambiguous()
    test_malformed_result_outputs_are_treated_as_empty()
    test_non_json_submission_response_is_ambiguous()
    test_malformed_result_envelope_raises_provider_error()
    print("ok")
