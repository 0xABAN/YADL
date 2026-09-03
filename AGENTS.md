# Agent instructions

Do not commit unless the user explicitly asks.

## Lessons

- Frontend is Next.js + TypeScript in `src/frontend`. Do not add pages at the repo root.
- Do not add `package-lock.json`. Deps use `latest`; `.npmrc` has `package-lock=false`.
- Use Playwright to verify UI changes.
