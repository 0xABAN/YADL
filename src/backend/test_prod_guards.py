"""ponytail: cookie Secure + SESSION_SECRET prod guard."""
from __future__ import annotations

import os
import sys
from pathlib import Path
from unittest.mock import patch

from fastapi import HTTPException

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


def test_header_identity_is_local_only() -> None:
    with patch.dict(os.environ, {}, clear=False):
        os.environ.pop("RAILWAY_ENVIRONMENT", None)
        os.environ.pop("ENV", None)
        assert deps.uid(sid=None, x_user_id="local-user") == "local-user"

        os.environ["ENV"] = "production"
        try:
            deps.uid(sid=None, x_user_id="spoofed-user")
            raise AssertionError("expected production header auth to fail")
        except HTTPException as exc:
            assert exc.status_code == 401

        assert deps.uid(sid=deps.mint("session-user"), x_user_id="spoofed-user") == "session-user"

        os.environ.pop("ENV", None)
        os.environ["RAILWAY_ENVIRONMENT"] = "production"
        try:
            deps.uid(sid=None, x_user_id="spoofed-user")
            raise AssertionError("expected Railway header auth to fail")
        except HTTPException as exc:
            assert exc.status_code == 401


if __name__ == "__main__":
    main()
