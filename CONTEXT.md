# YADL+ — Project Context

## Identity

- **Name:** YADL+ (yet another data labeler)
- **Local path:** `/Users/adam/dev/imigen`
- **GitHub:** https://github.com/0xABAN/YADL
- **Owner:** `0xABAN` (Adam T.)
- **Purpose:** A WebMCP-powered hand-pose studio. An agent authors labeled landmark samples by moving a constrained hand rig. A human reviews. The product is the data, not a detector.

Not a WebMCP registry. Not a browser extension. Core labeler stays product-agnostic; ASL→Codex Micro is a demo vocab on top.

## WebMCP Challenge

- Challenge: https://webmcp.devpost.com/
- Deadline: September 3, 2026, 1:00 PM Pacific
- Need a live WebMCP app judges can open in ChatGPT’s in-app browser or Chrome 149+ with WebMCP enabled
- Public repo, visible license, <3 min YouTube demo with audio
- v1 is localhost. Hosting (Vercel), auth, and rate limits come last.

## Product

The page is a 21-point hand driven by **FK joints**, not raw dots.

- Agent sets joints → rig updates → MediaPipe-shaped landmarks are derived
- Human sees the hand move and confirms commits
- Camera is optional (seed a real pose). Most samples are agent-authored.

**Joints:** wrist pitch/yaw/roll; per finger MCP (flex, spread), PIP, DIP; thumb opposition. DIP follows PIP. Clamped so the hand stays legal.

**Presets:** `open`, `fist`, `point`, `pinch`, `thumbs_up`, `thumbs_down`, `ok`, `rock`

### ASL → Codex Micro (demo vocab)

Static one-hand control signs mapped to Codex Micro Command Keys. Not full ASL.

| Label | Sign | Emoji | Codex action |
|---|---|---|---|
| `thumbs_up` | thumbs up | 👍 | Approve |
| `thumbs_down` | thumbs down | 👎 | Decline |
| `point` | index point | ☝️ | Send |
| `fist` | closed fist | ✊ | Push-to-talk (hold) |
| `open` | open hand | 🖐️ | New chat / branch |
| `rock` | index + pinky | 🤘 | Fast mode toggle |

Hold `fist` = PTT on; release = stop. Skip Agent Keys / dial / stick until the demo needs them.

## v1 (build this)

Localhost. No login, no cloud, no rate limits.

- **Frontend:** `src/frontend` — Next.js + TypeScript
- **Backend:** `src/backend` — Python + uv + FastAPI. Writes `./data/`.

Project types: `boxes` | `polygons` | `keypoints` (renamed from `hands`).
Keypoints carry `template`: `hand` (21) | `pose` (33) | `face` (mesh). Assist seeds via MediaPipe still-image models. Object wire format still `kind: hand` / `geom.t: hand` for now (shared landmark list).

Joints are the **Phase 2** authoring type for hand FK; landmarks are derived. Phase 2 WebMCP (studio, not done yet):

| Tool | Role |
|---|---|
| `set_pose` | named preset |
| `set_joint` | one joint, clamped |
| `get_landmarks` | points from the rig |
| `commit_sample` | write `{label, joints, landmarks}` and advance |

Do not rate-limit `set_joint`.

### WebMCP Phase 1 (create page)

| Tool | Role |
|---|---|
| `list_projects` | recent projects |
| `create_project` | `{name, type, template?}` — returns `upload_url` / `studio_url`; does not upload |
| `open_project` | by id or name → studio |

No WebMCP upload tool — media pick/submit is human or computer-use on `/upload`.

Human flow: `/create` → `/upload?name=&type=` (create-on-submit). Agent: `create_project` then CU on `upload_url`.

### WebMCP Studio (general, type-agnostic)

Registered on `/studio/:id` only. Live Studio state (same path as UI). **No geometry** — label/delete existing objects only. FK/landmarks = later Phase 2.

| Tool | Role |
|---|---|
| `get_studio` | project + progress + current (objects without geometry) + `can_commit` / `unlabeled` + `export_url` |
| `open_image` | exactly one of `index` \| `id` \| `next_uncommitted` |
| `set_label` | `{object_id, label}` — null/`""` clears; new label creates class |
| `delete_object` | `{object_id}` on current image |
| `commit_image` | current only; Footer rules; first commit advances |
| `delete_image` | current only |
| `comment` | `add`+`body` or `delete`+`id` on current |
| `open_upload` | open add-media modal; CU on `[data-webmcp=select-files]` (no bytes tool) |

SSOT: `src/frontend/lib/studioTools.ts`.

Register via `document.modelContext`; no-op if unavailable.

### WebMCP evals (repo-scoped)

- Package: `webmcp-evals` (devDep under `src/frontend` only)
- Create SSOT: `lib/createTools.ts` → `webmcp-evals/{schema,evals}.json`
- Studio SSOT: `lib/studioTools.ts` → `webmcp-evals/studio-{schema,evals}.json`
- Smoke create: `npm run webmcp:smoke` (page `/create`)
- Smoke studio: `npm run webmcp:smoke:studio` (needs a real `/studio/:id` URL — set `STUDIO_URL`)
- Reports: `src/frontend/.evals/` (gitignored)

## Infra (current)

- **Postgres:** AWS RDS `yadl` (`yadl.cwn6yemo6ox8.us-east-1.rds.amazonaws.com:5432`), publicly accessible.
- **SG:** `yadl-db` / `sg-0ce58793eb1e0ab3b`
- **Was:** inbound 5432 locked to a single laptop `/32` → breaks on new Wi‑Fi/IP; uvicorn boot hangs on pool timeout; Next `/api/*` then returns plain 500.
- **Hackathon now:** 5432 open to `0.0.0.0/0` (temp). Password stays in local `.env` `DATABASE_URL` only — never commit it.
- **After demo / lock down:** revoke world access; prefer API in the same VPC and SG only from that service (or a bastion/VPN). Do not leave public 5432 long-term.
- Judges hit the **web app**, not RDS. Opening the DB only unblocks the **backend** from any network. Live judge URL still needs hosted frontend + API (Vercel etc.), not just open Postgres.

Local run still needs: backend `uv run uvicorn … :8000`, frontend Next, reachable `DATABASE_URL`.

## Later (not v1)

- Vercel + GitHub OAuth
- R2 (S3 API) for committed samples only — never the live webcam stream
- Presigned uploads
- Harsh caps on commits / image-gen / train
- RunPod: train a classifier on labeled landmarks
- RunPod **serverless** for MediaPipe still-image seed (and later similar assist). Low traffic; pay only when a job runs. Hosted API stays JSON/files — do not run `detect()` on the web worker.
- GPT image API: optional stills augment (not local, not RunPod)
- Optional camera → in-tab MediaPipe (GPU/WASM, VIDEO mode, worker). Tool reads latest landmarks; it does not run inference.
- Lock RDS SG after hackathon; colocate API with DB (no public 5432).

Live camera stays in the browser. Stills seed and train may use RunPod. Image gen uses the OpenAI API.

## Locked decisions

- Agent owns pose authoring. Human reviews.
- Joint rig (A), not raw 21 `(x,y,z)` and not presets-only
- Core labels stay free-form. Demo vocab above is the locked ASL→Codex Micro set when that path is shown.
- Web app in a real browser tab (`document.modelContext`). Not Electron/Tauri.
- License still unset (MIT or Apache-2.0 candidates)
