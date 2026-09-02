<h1 align="center">YADL</h1>

<p align=center>
  <a href="https://skillicons.dev">
    <img src="https://skillicons.dev/icons?i=python,typescript,fastapi,nextjs,react,postgres,aws,docker,vercel" alt="python, typescript, fastapi, nextjs, react, postgres, aws, docker, vercel" />
  </a>
</p>

<p align="center">
  <em>Yet another data labeler, but in this one, you don't have to click.</em>
</p>

## Why this exists

Computer vision tasks need lots of labeled data. Most data labeling apps make you draw every box by hand. YADL (and WebMCP) lets Codex do it for you while you sleep.

## What YADL does

You create a project. Our studio registers WebMCP tools for that project. Codex (or any WebMCP client) calls them to draw geometry, name classes, and commit frames onto the same canvas you see. You review, provide comments, fix stragglers, export. The output is a labeled dataset.

```mermaid
flowchart TD
  A[raw data] --> B[pick annotation type]
  B --> U[augment]
  U -->|WebMCP| G[agent: label N frames]
  U -.->|optional| H[human: label N frames]
  G --> C[commit]
  H --> C
  C --> Q{needs work?}
  Q -->|no| F[export]
  Q -->|yes| U

  classDef step fill:#1e293b,stroke:#94a3b8,color:#f8fafc
  classDef human fill:#0c4a6e,stroke:#38bdf8,color:#e0f2fe
  classDef agent fill:#312e81,stroke:#818cf8,color:#e0e7ff
  classDef gate fill:#422006,stroke:#fbbf24,color:#fef3c7
  classDef done fill:#14532d,stroke:#4ade80,color:#dcfce7
  class A,B,C,U step
  class H human
  class G agent
  class Q gate
  class F done
```

---

## WebMCP tools

YADL registers **15 WebMCP tools** on the open page (`document.modelContext`): project setup, studio navigation, labels, commit, comments, plus a 3-tool geometry pack for the active style (boxes, polygons, or keypoints).

### Example: keypoints

The agent does not free-drag dots. It drives a small FK **rig** (joints in, landmarks out):

| Tool | Does |
| --- | --- |
| `add_instance` | Spawn a hand / pose / face on the image |
| `set_rig` | Move root and joints in one shot |
| `get_rig` | Read back the live rig (and optional landmarks) |

Then the shared tools finish the frame: open image → rig tools → set label → commit. Humans can still free-drag dots and run MediaPipe assist; that path is UI-only.

---

## Stack

Vercel (Next.js UI + tool registration) → Railway (FastAPI) → Postgres + S3. Browser uses same-origin `/api/*`; large files presign to S3.

```
src/frontend   UI + WebMCP tools
src/backend    API, assist, storage
schema.sql     DB
```

---

## License

[Apache License 2.0](LICENSE)
