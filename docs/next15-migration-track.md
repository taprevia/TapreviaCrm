# Next 15 / React 19 Migration Track

> Flagged during the Startup MVP Build (Sprint Prioritizer, Phase 2, Sprint 3+).
> Deliberately de-scoped from MVP sprints S1–S3. Do not fold into the MVP
> backlog — schedule as its own capacity track.

## Why

- `next@14.2.35` is EOL (See alerts) — no security patches.
- Carries `react@^18` → must move to `react@^19`/`react-dom@^19`.

## Scope (grouped)

1. **Runtime upgrade**: `next@15` LTS → `@next/next` + peer deps; verify async
   `params`/`searchParams` page contract (`generateMetadata`/page props already
   migrated style-wise where fixed).
2. **Consolidate JWT libraries**: `jsonwebtoken` (route auth, `src/lib/auth.ts`)
   and `jose` (edge, `src/lib/auth-edge.ts`) → single lib. Touches the whole
   auth surface — do not land piecemeal.
3. **SSR re-architecture (follow-on)**: 68/99 `'use client'` tsx files —
   reduce client-side rendering footprint (dashboard, admin, public cards).
   Independent of items 1–2; can be its own epics.

## Not in scope

- Any MVP sprint (S1–S3) item.

## Evidence gate before start

- `npm run lint`, `npm run typecheck`, `npm run integrity`, `npm run test:cards`,
  `npm run test:entitlement`, `npm run test:auth` all green on 14.2 baseline.
- CI (`github/workflows/ci.yml`) green on the branch.

## Entry criteria / how to file

When `gh` is available on this machine, file as a GitHub issue on
`PrinceBhimaniDev/TapreviaCRM`:

```sh
gh issue create \
  --title "Track: Next 15 / React 19 migration (EOL on 14.2.35)" \
  --body-file docs/next15-migration-track.md
```