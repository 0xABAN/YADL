"""ponytail: cookie Secure + SESSION_SECRET prod guard."""
from __future__ import annotations

import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from backend.api import deps  # noqa: E402


def main() -> None:
    os.environ.pop("RAILWAY_ENVIRONMENT", None)
    os.environ.pop("ENV", None)
    os.environ["APP_ORIGIN"] = "http://localhost:3000"
    assert deps.cookie_secure() is False
    os.environ["APP_ORIGIN"] = "https://yadl.vercel.app"
    assert deps.cookie_secure() is True

    os.environ.pop("SESSION_SECRET", None)
    deps.require_session_secret()  # local: no-op

    os.environ["ENV"] = "production"
    os.environ["SESSION_SECRET"] = "dev"
    try:
        deps.require_session_secret()
        raise AssertionError("expected fail")
    except RuntimeError:
        pass

    os.environ["SESSION_SECRET"] = "not-a-default-secret"
    deps.require_session_secret()
    print("ok")


if __name__ == "__main__":
    main()
