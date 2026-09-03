# YADL hand-sign demo

This standalone demo trains a compact PyTorch classifier from committed YADL hand landmarks and runs it against one local webcam. It does not depend on the application backend package and never sends webcam frames over the network.

## Train

From `demo/`:

```bash
uv sync
uv run yadl-train \
  --project-id a397a808-14ef-4528-b822-9a92bfac7c3e \
  --device mps \
  --output artifacts/hand-sign.pt
```

Training refuses CPU execution. Use `--device cuda` on a CUDA machine; `--device auto` selects MPS first, then CUDA, and fails if neither accelerator is available. The command reads `DATABASE_URL` from the process environment or the repository-level `.env` without displaying it.

The artifact contains the model weights, ordered class names, model dimensions, preprocessing contract, calibration, decision policy, validation results, and source provenance. Generated artifacts are intentionally ignored by Git.

Additional landmark-only capture sessions can be merged without uploading images:

```bash
uv run yadl-train \
  --project-id a397a808-14ef-4528-b822-9a92bfac7c3e \
  --supplement capture.jsonl \
  --device mps
```

## Inference API

```python
from pathlib import Path

from backend.train.model import HandSignClassifier

classifier = HandSignClassifier.load(Path("artifacts/hand-sign.pt"), device="mps")
prediction = classifier.predict(landmarks, handedness=handedness)
print(prediction.label, prediction.confidence, prediction.probabilities)
```

`landmarks` is a `float32`-compatible array with shape `(21, 3)`. Preprocessing translates the wrist to the origin, scales by stable palm anchors, aligns the middle-MCP axis, normalizes chirality from geometry rather than noisy MediaPipe handedness metadata, and retains palm orientation as sine/cosine features. The latter keeps `thumbs_up` and `thumbs_down` distinguishable.

## Webcam service

The service targets [FreeFlow](https://github.com/zachlatta/freeflow): a stable fist holds the macOS Fn key, FreeFlow’s default hold-to-dictate shortcut. Configure FreeFlow’s dictation shortcut as **Hold Fn**, then run:

```bash
uv sync
uv run yadl-gestures
```

That one command creates the configuration when needed, checks the model, MediaPipe asset, MPS, camera, and macOS Accessibility authorization, then opens the live preview and begins emitting key events. The configuration is stored in `~/Library/Application Support/YADL Hand Demo/`. Press `Q`, `Esc`, or `Ctrl+C` to stop.

The service detects at most one hand. A stable fist sends one Fn-down event, holds Fn for the recognized fist’s duration without repeats, and sends one Fn-up event on release. An open hand taps Cmd+N once per presentation to open a new Codex chat, and pointing taps Return to send the current message. The rock sign types `/fast` and presses Return once per presentation, so Codex must be foregrounded with an empty composer focused. Camera stalls, inference failures, `SIGINT`, and `SIGTERM` all release held keys. Other labels remain unbound.

## Validation policy

Adjacent frames from one video are not independent. The splitter identifies contiguous label episodes and holds out the latest whole episode for a class only when at least two episodes exist. Classes represented by one episode remain training-only and are listed under `unvalidated_classes`; the tool does not present their fit as holdout evidence.

Run unit tests and the live-database integration test separately:

```bash
uv run pytest
uv run pytest -m integration tests/test_database.py
```

Key emission requires an exact artifact hash match, MPS inference, Camera access, and Accessibility authorization. The temporal gate and watchdog continue to prevent key repeats and release Fn after detection loss or a stalled pipeline.
