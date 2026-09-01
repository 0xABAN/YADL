"""ponytail: assert-only self-check for export_line shapes."""
from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from backend.domain.export import export_line  # noqa: E402


def main() -> None:
    hand = {
        "label": "open",
        "kind": "hand",
        "geom": {
            "t": "hand",
            "handedness": "Right",
            "landmarks": [{"x": i * 0.01, "y": 0.1, "z": 0.0} for i in range(21)],
        },
    }
    face = {
        "label": "thumbs_down",
        "kind": "face",
        "geom": {
            "t": "face",
            "handedness": None,
            "landmarks": [{"x": 0.5, "y": 0.5, "z": 0.0} for _ in range(478)],
        },
    }
    box = {
        "label": "dog",
        "kind": "box",
        "geom": {"t": "box", "x": 0.1, "y": 0.2, "w": 0.3, "h": 0.4},
    }
    poly = {
        "label": "car",
        "kind": "polygon",
        "geom": {"t": "polygon", "pts": [[0.1, 0.1], [0.2, 0.1], [0.2, 0.2]]},
    }
    skip = {"label": None, "geom": {"t": "box", "x": 0, "y": 0, "w": 1, "h": 1}}

    h = json.loads(export_line("a.jpg", hand) or "")
    assert h["kind"] == "hand" and len(h["landmarks"]) == 21 and h["handedness"] == "Right"

    f = json.loads(export_line("f.jpg", face) or "")
    assert f["kind"] == "face" and len(f["landmarks"]) == 478 and "handedness" not in f

    b = json.loads(export_line("b.jpg", box) or "")
    assert b["kind"] == "box" and b["box"] == {"x": 0.1, "y": 0.2, "w": 0.3, "h": 0.4}
    assert "landmarks" not in b

    p = json.loads(export_line("c.jpg", poly) or "")
    assert p["kind"] == "polygon" and len(p["pts"]) == 3 and p["pts"][0] == [0.1, 0.1]

    assert export_line("d.jpg", skip) is None
    assert export_line("e.jpg", {**box, "geom": {**box["geom"], "w": 0}}) is None
    print("ok")


if __name__ == "__main__":
    main()
