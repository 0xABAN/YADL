from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from backend.api import assist, augmentations, auth, images, projects
from backend.api.deps import require_session_secret
from backend.infra.db import apply_schema, fetchone
from backend.infra.store import ensure_user, seed_demo

app = FastAPI()
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

app.include_router(auth.router)
app.include_router(projects.router)
app.include_router(images.router)
app.include_router(assist.router)
app.include_router(augmentations.router)


@app.on_event("startup")
def boot() -> None:
    require_session_secret()
    apply_schema()
    ensure_user("dev")
    seed_demo()


@app.get("/health")
def health():
    fetchone("select 1")
    return {"ok": True}
