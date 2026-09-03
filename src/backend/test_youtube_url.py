"""youtube_url host and runtime checks."""
from __future__ import annotations

import importlib.util
import shutil
from pathlib import Path

from fastapi import HTTPException
import yt_dlp

from backend.api import images as images_api
from backend.api.images import youtube_url


def test_youtube_runtime_dependencies_are_available() -> None:
    assert shutil.which("deno") is not None
    assert importlib.util.find_spec("yt_dlp_ejs") is not None


def test_youtube_download_retries_a_transient_extractor_failure(monkeypatch) -> None:
    attempts = 0

    class FlakyYDL:
        def __init__(self, opts: dict) -> None:
            self.opts = opts

        def __enter__(self):
            return self

        def __exit__(self, *_args) -> None:
            return None

        def extract_info(self, _url: str, download: bool) -> dict:
            nonlocal attempts
            attempts += 1
            assert download is True
            if attempts == 1:
                raise yt_dlp.utils.DownloadError("This video is not available")
            Path(self.opts["outtmpl"].replace("%(ext)s", "mp4")).write_bytes(b"video")
            return {"title": "dogs"}

    expected = [("dogs_t0.jpg", b"jpeg", "image/jpeg")]
    monkeypatch.setattr(yt_dlp, "YoutubeDL", FlakyYDL)
    monkeypatch.setattr(images_api, "frames_from_path", lambda *_args: expected)

    assert images_api.frames_from_youtube("https://youtu.be/2R2eDKY4fjU", 5.0) == expected
    assert attempts == 2


def test_accepts_public_forms() -> None:
    assert youtube_url("https://www.youtube.com/watch?v=dQw4w9WgXcQ").startswith("https://")
    assert "youtu.be" in youtube_url("https://youtu.be/dQw4w9WgXcQ")
    assert youtube_url("youtube.com/watch?v=abc123") == "https://youtube.com/watch?v=abc123"
    assert "shorts" in youtube_url("https://m.youtube.com/shorts/xyz")


def test_rejects_non_youtube() -> None:
    for bad in ("", "https://vimeo.com/1", "ftp://youtube.com/watch?v=x", "not a url"):
        try:
            youtube_url(bad)
            raise AssertionError(bad)
        except HTTPException as e:
            assert e.status_code == 400
            assert e.detail == "url"


if __name__ == "__main__":
    test_youtube_runtime_dependencies_are_available()
    test_accepts_public_forms()
    test_rejects_non_youtube()
    print("ok")
