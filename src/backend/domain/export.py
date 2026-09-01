"""Pure export shapes — no DB/S3."""
from __future__ import annotations

import json


def named(label: object) -> bool:
    return bool(label) and label != "untitled"


def export_line(filename: str, obj: dict) -> str | None:
    """One JSONL row for a named object, or None if skip."""
    label = obj.get("label")
    if not named(label):
        return None
    geom = obj.get("geom") or {}
    t = geom.get("t") or obj.get("kind")
    base = {"image": filename, "label": label, "kind": t}
    if t in ("hand", "pose", "face"):
        lms = geom.get("landmarks") or []
        if len(lms) < 1:
            return None
        base["landmarks"] = lms
        if t == "hand" and geom.get("handedness") is not None:
            base["handedness"] = geom.get("handedness")
        if geom.get("rig") is not None:
            base["rig"] = geom.get("rig")
    elif t == "box":
        x, y = float(geom.get("x") or 0), float(geom.get("y") or 0)
        w, h = float(geom.get("w") or 0), float(geom.get("h") or 0)
        if w <= 0 or h <= 0:
            return None
        base["box"] = {"x": x, "y": y, "w": w, "h": h}
    elif t == "polygon":
        raw = geom.get("pts") or []
        pts = []
        for p in raw:
            if isinstance(p, (list, tuple)) and len(p) >= 2:
                pts.append([float(p[0]), float(p[1])])
            elif isinstance(p, dict):
                pts.append([float(p.get("x") or 0), float(p.get("y") or 0)])
        if len(pts) < 3:
            return None
        base["pts"] = pts
    else:
        return None
    return json.dumps(base, separators=(",", ":"))
