# YADL+ — Project Context

## Identity

- **Name:** YADL+ (yet another data labeler)
- **Local path:** `/Users/adam/dev/imigen`
- **GitHub:** https://github.com/0xABAN/YADL
- **Owner:** `0xABAN` (Adam T.)
- **Purpose:** A WebMCP-powered hand-pose studio. An agent authors labeled landmark samples by moving a constrained hand rig. A human reviews. The product is the data, not a detector.

Not a WebMCP registry. Not a browser extension. Not ASL-specific.

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

**Presets:** `open`, `fist`, `point`, `pinch`, `thumbs_up`, `ok`

## v1 (build this)

Localhost web app in `src/frontend` (Next.js + TypeScript). No login, no cloud, no rate limits.

WebMCP tools:

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
- GPT image API: optional stills augment (not local, not RunPod)
- Optional camera → in-tab MediaPipe (GPU/WASM, VIDEO mode, worker). Tool reads latest landmarks; it does not run inference.

Live landmarks stay in the browser. Heavy jobs (train) may use RunPod. Image gen uses the OpenAI API.

## Locked decisions

- Agent owns pose authoring. Human reviews.
- Joint rig (A), not raw 21 `(x,y,z)` and not presets-only
- Product-agnostic labels. ASL/Micro-keyboard demo is a separate product if ever.
- Web app in a real browser tab (`document.modelContext`). Not Electron/Tauri.
- License still unset (MIT or Apache-2.0 candidates)
