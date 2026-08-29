from pathlib import Path
import sys

SRC = Path(__file__).resolve().parents[1]
if str(SRC) not in sys.path:
    sys.path.insert(0, str(SRC))

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse

from backend.models import Doc
from backend.store import ensure_layout, image_path, list_images, load_doc, save_doc
from demo.hands import seed
from demo.project import PROJECT

app = FastAPI()
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


@app.on_event("startup")
def boot() -> None:
    ensure_layout()


@app.get("/project")
def project():
    return PROJECT


@app.get("/images")
def images():
    ensure_layout()
    return list_images()


@app.get("/images/{id}")
def get_image(id: str):
    doc = load_doc(id)
    if doc is None:
        raise HTTPException(404)
    if not doc.objects:
        path = image_path(id)
        if path:
            doc.objects = seed(path)
            save_doc(doc)
    return doc


@app.put("/images/{id}")
def put_image(id: str, body: Doc):
    if load_doc(id) is None:
        raise HTTPException(404)
    body.id = id
    save_doc(body)
    return body


@app.post("/images/{id}/assist")
def assist(id: str):
    doc = load_doc(id)
    if doc is None:
        raise HTTPException(404)
    if doc.objects:
        return doc
    path = image_path(id)
    if path:
        doc.objects = seed(path)
        save_doc(doc)
    return doc


@app.get("/images/{id}/file")
def file(id: str):
    path = image_path(id)
    if not path:
        raise HTTPException(404)
    return FileResponse(path)
