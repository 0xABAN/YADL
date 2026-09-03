import hashlib
import hmac
import os
import time
from typing import Annotated

from fastapi import Cookie, Header, HTTPException, Response


def _secret() -> bytes:
    return (os.environ.get("SESSION_SECRET") or "dev").encode()


def origin() -> str:
    return os.environ.get("APP_ORIGIN") or "http://localhost:3000"


def cookie_secure() -> bool:
    """HTTPS sites need Secure cookies; local http keeps them off."""
    return origin().startswith("https://")


def _deployed() -> bool:
    return bool(os.environ.get("RAILWAY_ENVIRONMENT")) or os.environ.get("ENV") == "production"


def mint(uid: str) -> str:
    exp = str(int(time.time()) + 30 * 86400)
    msg = f"{uid}.{exp}"
    sig = hmac.new(_secret(), msg.encode(), hashlib.sha256).hexdigest()
    return f"{msg}.{sig}"


def read_sid(sid: str) -> str | None:
    try:
        uid, exp, sig = sid.rsplit(".", 2)
    except ValueError:
        return None
    msg = f"{uid}.{exp}"
    expect = hmac.new(_secret(), msg.encode(), hashlib.sha256).hexdigest()
    if not hmac.compare_digest(sig, expect) or int(exp) < time.time():
        return None
    return uid


def uid(
    sid: Annotated[str | None, Cookie()] = None,
    x_user_id: Annotated[str | None, Header()] = None,
) -> str:
    if sid and (u := read_sid(sid)):
        return u
    if x_user_id and not _deployed():
        return x_user_id
    raise HTTPException(401)


def set_session(response: Response, user_id: str) -> None:
    response.set_cookie(
        "sid",
        mint(user_id),
        httponly=True,
        samesite="lax",
        secure=cookie_secure(),
        max_age=30 * 86400,
        path="/",
    )


def set_oauth_state(response: Response, state: str) -> None:
    response.set_cookie(
        "oauth_state",
        state,
        httponly=True,
        samesite="lax",
        secure=cookie_secure(),
        max_age=600,
        path="/",
    )


def gh_callback() -> str:
    return f"{origin()}/api/auth/github/callback"


def require_session_secret() -> None:
    """Prod (Railway or ENV=production) must set a real SESSION_SECRET."""
    if not _deployed():
        return
    s = os.environ.get("SESSION_SECRET") or ""
    if not s or s in ("dev", "change-me"):
        raise RuntimeError("SESSION_SECRET required in production (not dev/change-me)")
