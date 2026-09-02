"""ponytail: key prefix + ctype helpers for S3 upload flow."""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from backend.api.images import _ctype, _kind  # noqa: E402


def main() -> None:
    assert _kind("a.jpg") == "image"
    assert _kind("a.MP4") is None or _kind("a.mp4") == "video"
    assert _kind("a.mp4") == "video"
    assert _kind("a.zip") == "zip"
    assert _kind("a.txt") is None
    assert _ctype("x.png", "") == "image/png"
    assert _ctype("x.mp4", "video/mp4") == "video/mp4"
    assert _ctype("x.zip", "") == "application/zip"
    print("ok")


if __name__ == "__main__":
    main()
