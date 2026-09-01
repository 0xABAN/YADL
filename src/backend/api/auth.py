import hmac
import json
import os
import secrets
import urllib.error
import urllib.request
from typing import Annotated
from urllib.parse import urlencode

from fastapi import APIRouter, Cookie, HTTPException, Response
from fastapi.responses import RedirectResponse
from pydantic import BaseModel

from backend.api.deps import gh_callback, origin, set_session
from backend.infra.store import create_user, github_user, login_user

router = APIRouter(tags=["auth"])


class Creds(BaseModel):
    email: str
    password: str
    name: str = ""


def _gh(url: str, token: str | None = None, data: dict | None = None):
    headers = {"User-Agent": "yadl", "Accept": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    body = json.dumps(data).encode() if data is not None else None
    if body:
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request(url, data=body, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            return json.loads(r.read())
    except urllib.error.HTTPError:
        return None


@router.post("/auth/signup")
def signup(body: Creds, response: Response):
    if not body.email.strip() or not body.password:
        raise HTTPException(400)
    row = create_user(body.email, body.password, body.name)
    if not row:
        raise HTTPException(409, "email")
    set_session(response, row["id"])
    return row


@router.post("/auth/login")
def login(body: Creds, response: Response):
    row = login_user(body.email, body.password)
    if not row:
        raise HTTPException(401)
    set_session(response, row["id"])
    return row


@router.get("/auth/github")
def github_start():
    cid = os.environ.get("GITHUB_CLIENT_ID")
    if not cid:
        return RedirectResponse(f"{origin()}/auth?err=github")
    state = secrets.token_urlsafe(24)
    url = "https://github.com/login/oauth/authorize?" + urlencode(
        {
            "client_id": cid,
            "redirect_uri": gh_callback(),
            "scope": "read:user user:email",
            "state": state,
        }
    )
    r = RedirectResponse(url)
    r.set_cookie("oauth_state", state, httponly=True, samesite="lax", max_age=600, path="/")
    return r


@router.get("/auth/github/callback")
def github_cb(
    code: str | None = None,
    state: str | None = None,
    error: str | None = None,
    oauth_state: Annotated[str | None, Cookie()] = None,
):
    fail = RedirectResponse(f"{origin()}/auth?err=github")
    if error or not code or not state or not oauth_state or not hmac.compare_digest(state, oauth_state):
        return fail
    tok = _gh(
        "https://github.com/login/oauth/access_token",
        data={
            "client_id": os.environ.get("GITHUB_CLIENT_ID"),
            "client_secret": os.environ.get("GITHUB_CLIENT_SECRET"),
            "code": code,
            "redirect_uri": gh_callback(),
        },
    )
    token = (tok or {}).get("access_token")
    if not token:
        return fail
    gh = _gh("https://api.github.com/user", token)
    if not gh or not gh.get("id"):
        return fail
    email = gh.get("email")
    if not email:
        mails = _gh("https://api.github.com/user/emails", token)
        if isinstance(mails, list):
            for e in mails:
                if e.get("verified") and (e.get("primary") or not email):
                    email = e.get("email")
                    if e.get("primary"):
                        break
    row = github_user(str(gh["id"]), email, gh.get("name") or gh.get("login"))
    r = RedirectResponse(f"{origin()}/create")
    set_session(r, row["id"])
    r.delete_cookie("oauth_state", path="/")
    return r
