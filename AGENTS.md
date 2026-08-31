# Agent instructions

Read `CONTEXT.md` before doing anything else.

Do not commit until the user says so.

## Lessons

- Frontend is Next.js + TypeScript in `src/frontend`. Do not add pages at the repo root.
- Do not add `package-lock.json`. Deps use `latest`; `.npmrc` has `package-lock=false`.
- Do not commit unless the user explicitly asks.
- Use Playwright to verify UI changes.
