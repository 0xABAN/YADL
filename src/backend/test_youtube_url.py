"""youtube_url host checks."""
from __future__ import annotations

from fastapi import HTTPException

from backend.api.images import youtube_url


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
    test_accepts_public_forms()
    test_rejects_non_youtube()
    print("ok")
