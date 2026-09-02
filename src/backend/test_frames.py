"""Smoke: ffmpeg frame extract + flatten stay under caps."""
from __future__ import annotations

import subprocess
import tempfile
from pathlib import Path

from backend.api.images import flatten, frames_from_video


def _tiny_mp4(path: Path, seconds: float = 2.0) -> None:
    subprocess.run(
        [
            "ffmpeg",
            "-hide_banner",
            "-loglevel",
            "error",
            "-y",
            "-f",
            "lavfi",
            "-i",
            f"color=c=red:s=64x64:d={seconds}",
            "-pix_fmt",
            "yuv420p",
            str(path),
        ],
        check=True,
    )


def test_frames_interval():
    with tempfile.TemporaryDirectory() as td:
        mp4 = Path(td) / "clip.mp4"
        _tiny_mp4(mp4, 2.2)
        body = mp4.read_bytes()
        out = frames_from_video("clip.mp4", body, interval=1.0)
        assert 2 <= len(out) <= 4
        assert all(n.endswith(".jpg") and ct == "image/jpeg" for n, _, ct in out)
        assert out[0][0].startswith("clip_t")


def test_flatten_image():
    blobs = flatten("x.png", b"\x89PNG\r\n\x1a\n")
    assert len(blobs) == 1 and blobs[0][2] == "image/png"


def test_flatten_skips_unknown():
    assert flatten("x.txt", b"hi") == []


if __name__ == "__main__":
    test_frames_interval()
    test_flatten_image()
    test_flatten_skips_unknown()
    print("ok")
