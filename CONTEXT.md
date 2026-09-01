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

Landmarks match MediaPipe Hands: 21 points, `{x, y, z}`, `x,y ∈ [0,1]` of the image, `z` wrist-relative, MediaPipe index order. Joints are the authoring type; landmarks are derived. WebMCP comes last.

WebMCP tools (later):

| Tool | Role |
|---|---|
| `set_pose` | named preset |
| `set_joint` | one joint, clamped |
| `get_landmarks` | 21 points from the rig |
| `commit_sample` | confirm, then write `{label, joints, landmarks}` to `./data/` |

Do not rate-limit `set_joint`.

## Later (not v1)

- Vercel + GitHub OAuth
- R2 (S3 API) for committed samples only — never the live webcam stream
- Presigned uploads
- Harsh caps on commits / image-gen / train
- RunPod: train a classifier on labeled landmarks
- RunPod **serverless** for MediaPipe still-image seed (and later similar assist). Low traffic; pay only when a job runs. Hosted API stays JSON/files — do not run `detect()` on the web worker.
- GPT image API: optional stills augment (not local, not RunPod)
- Optional camera → in-tab MediaPipe (GPU/WASM, VIDEO mode, worker). Tool reads latest landmarks; it does not run inference.

Live camera stays in the browser. Stills seed and train may use RunPod. Image gen uses the OpenAI API.

## Locked decisions

- Agent owns pose authoring. Human reviews.
- Joint rig (A), not raw 21 `(x,y,z)` and not presets-only
- Core labels stay free-form. Demo vocab above is the locked ASL→Codex Micro set when that path is shown.
- Web app in a real browser tab (`document.modelContext`). Not Electron/Tauri.
- License still unset (MIT or Apache-2.0 candidates)
