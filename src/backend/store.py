import shutil
from pathlib import Path

from backend.models import Doc

ROOT = Path(__file__).resolve().parents[2]
DATA = ROOT / "data"
IMAGES = DATA / "images"
ANNS = DATA / "annotations"
MODELS = DATA / "models"
EXTS = {".jpg", ".jpeg", ".png", ".webp"}


def ensure_layout() -> None:
    IMAGES.mkdir(parents=True, exist_ok=True)
    ANNS.mkdir(parents=True, exist_ok=True)
    MODELS.mkdir(parents=True, exist_ok=True)
    src = ROOT / "src" / "frontend" / "public" / "default.jpg"
    dest = IMAGES / "default.jpg"
    if src.exists() and not dest.exists():
        shutil.copy(src, dest)


def list_images() -> list[dict]:
    files = sorted(p for p in IMAGES.iterdir() if p.suffix.lower() in EXTS)
    return [{"id": p.stem, "image": p.name} for p in files]


def image_path(id: str) -> Path | None:
    for p in IMAGES.iterdir():
        if p.stem == id and p.suffix.lower() in EXTS:
            return p
    return None


def load_doc(id: str) -> Doc | None:
    path = image_path(id)
    if not path:
        return None
    ann = ANNS / f"{id}.json"
    if ann.exists():
        return Doc.model_validate_json(ann.read_text())
    return Doc(id=id, image=path.name, objects=[])


def save_doc(doc: Doc) -> None:
    ANNS.mkdir(parents=True, exist_ok=True)
    (ANNS / f"{doc.id}.json").write_text(doc.model_dump_json(indent=2))
