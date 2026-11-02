# TAPREVIA — PHASE 4D.10 GATE P2.5 STANDEE SERVER ERROR REPAIR

**Status:** LOCAL REPAIR COMPLETE — ENVIRONMENT ISSUE IDENTIFIED
**Branch:** `Devlopment`
**HEAD:** `db08e7a80c7c0b2972ebdef4841214478acfd7ae`
**Production:** untouched
**Remote databases / Vercel:** not accessed or modified

---

## 1. Exact reproduced error

Reported path: **My Standee → Manage**.

```text
Server Error
Error: Cannot find module './1682.js'
Require stack:
- .next/server/webpack-runtime.js
- .next/server/pages/_document.js
- next/dist/server/require.js
- next/dist/server/load-components.js
- next/dist/server/dev/hot-middleware.js
- next/dist/server/dev/hot-reloader-webpack.js
```

The same class of failure was independently observed during P2.4 investigation
(`Cannot find module './vendor-chunks/tailwind-merge.js'`) from the same
runtime/build directory.

---

## 2. Verified root cause

**Environment/build-directory collision — not a Standee code defect.**

Evidence before repair:

- A user `next dev` process was running: PID 34145 (parent) / 34147
  (`next-server`), started at 6:00 PM, listening on the default dev port.
- It was using the project default `.next` directory.
- The P2.3/P2.4 verification workflow repeatedly ran
  `next build` / `next start` against that **same** `.next` directory while the
  dev server was live.
- A production build rewrites the `.next` chunk graph and manifests. The running
  dev server's hot middleware still referenced dev chunk ids/files that the
  production build had replaced or removed (e.g. `./1682.js`,
  `./vendor-chunks/tailwind-merge.js`).
- The error stack is dev-server specific (`hot-middleware`,
  `hot-reloader-webpack`), confirming the dev server was serving artifacts that
  no longer matched its runtime.

Additional evidence: during P2.4 a clean `rm -rf .next` + rebuild restored a
failing suite to 20/20, proving the failure was artifact state rather than the
Standee component.

### Code check

- `src/app/(dashboard)/dashboard/products/[id]/page.tsx` imports
  `StandeeManager` statically; there is no invalid dynamic import.
- `StandeeManager` uses normal client component imports and existing APIs.
- No module-resolution, server/client-boundary or dependency error was found.
- The route worked after a clean isolated rebuild without any Standee source
  change in this phase.

---

## 3. Cache-related or code-related?

**Cache/build-artifact related.** The Standee Manage application code was not
the cause. The root cause was concurrent dev + production builds sharing
`.next`. No customer data or route logic was involved.

---

## 4. Build directory / process findings

| Item | Finding |
|---|---|
| Next.js | 14.2.35 (App Router) |
| React | 18 |
| Build dir | default `.next` |
| Dev process before repair | PID 34145/34147, default port, `.next` |
| Concurrent builds | yes — verification builds overwrote `.next` while dev served |
| Evidence preserved | server log with `MODULE_NOT_FOUND` / missing chunk |
| Backup of old `.next` | moved to `/private/var/.../opencode/p25-next-backup-20261031-182041` (retained) |

Recovery performed safely:

1. Gracefully stopped the dev process (TERM, then KILL only if needed).
2. Confirmed no Next process/port remained.
3. **Moved** `.next` to a unique temporary backup outside the project — no
   `rm -rf`, no source deletion.
4. Confirmed `.env.local`/`.env.preview` were untouched.

---

## 5. Changes performed

### 5.1 Build-output isolation

`next.config.mjs`:

```js
const distDir = process.env.NEXT_DIST_DIR?.trim() || '.next';
const nextConfig = { distDir, ... };
```

- `next build` / Vercel: `NEXT_DIST_DIR` unset → `.next` (unchanged deployment
  behavior).
- `npm run dev`: `.next-dev` (isolated from production builds).

`package.json`:

```json
"dev": "NEXT_DIST_DIR=.next-dev next dev"
```

`.gitignore`: added `/.next-dev/` and `/.next-*/`.

`tsconfig.json`: added `.next-dev/types/**/*.ts` to `include` (Next dev type
artifacts; `.next/types` remains).

No application source, schema, database, environment file or public route was
changed in P2.5.

### 5.2 Isolation verification

- A production build was run **while the dev server was live**, targeting
  `.next-prod-check`; it succeeded and the dev server remained healthy.
- `.next-dev` and `.next-prod-check` were separate directories.
- Production-mode server was started from `.next-prod-check` on port 3502 and
  Standee Manage worked.

---

## 6. Standee Manage fixes

No code defect required a change. Existing P2.3/P2.4 behavior is preserved:

- My Standees lists standees, status, public URL, Preview, Manage.
- Profile Slots are **not** rendered on the main page.
- Manage opens `/dashboard/products/{assignmentId}` and renders the scoped
  StandeeManager.
- Existing Profile Slots load with their saved destinations.
- Back to My Standees, refresh, direct URL and multi-Standee switching work.
- Zero-slot/empty configurations render without error.
- Cross-tenant access returns 404.

No need to add a dynamic import, Suspense boundary or error boundary workaround:
the missing chunk was not produced by Standee code.

---

## 7. Backward compatibility verification

- Branch/HEAD preserved; all P2.3/P2.4 changes retained.
- No schema, record, Standee ID, assignment, slot order, slot destination,
  public URL, NFC/QR route, Google destination, Review Management setting,
  analytics or entitlement changed.
- No customer data was read from remote systems; all tests used disposable
  local synthetic databases.
- Public `/r/...`, `/qr/...`, panel routes and Standee review behavior were not
  modified.
- Vercel production build remains `.next` with the same build script.

---

## 8. Functional test results

| Test | Result |
|---|---|
| My Standees page loads (3 synthetic standees) | PASS |
| Main page exposes no slot inputs | PASS (`slotInputs = 0`) |
| Manage opens without server error | PASS (dev + production) |
| Direct Manage URL | PASS |
| Browser refresh | PASS |
| Multi-Standee switching (one/two slots) | PASS |
| Existing slots load with destinations | PASS |
| Zero-slot Manage state | PASS (no crash) |
| Back to My Standees | PASS |
| Cross-tenant access | 404 |
| Public/QR/NFC routes | unchanged; regression suites pass |

Add/remove/reorder are not supported by the existing fixed-slot model and were
not invented; existing edit/save behavior remains.

---

## 9. Runtime stability test results

| Test | Result |
|---|---|
| Clean dev server start | PASS (`Ready`, login 200) |
| Manage at 320/1440 | PASS, no overflow |
| Refresh repeatedly | PASS |
| Navigate away/back and direct URL | PASS |
| Controlled `touch` hot reload | PASS; route recompiled and served 200 |
| Production build while dev runs (isolated dirs) | PASS |
| Dev server remains healthy after build | PASS |
| Production server from isolated build | PASS |
| Dev/prod logs: `MODULE_NOT_FOUND`, `ChunkLoadError`, hydration errors | none in the repaired runs |

---

## 10. Regression test results

| Suite | Result |
|---|---|
| Typecheck / ESLint | PASS |
| Build flags OFF / ON | PASS |
| 4D.5 Review Management | 57/57 OFF · 57/57 ON |
| 4D.6 Standee | 20/20 × 4 = 80/80 |
| Unified analytics | 9/9 |
| Historical analytics | 9/9 |
| 16-combination matrix | 192/192 |
| 4D.8/4D.9 fixes | 0 failures; 14/14 responsive rows |
| Builder tab-state / preview resolver | 9/9 · 13/13 |
| Security | PASS |
| Entitlement | 130/130 |
| Review Library / import | 48/48 · 13/13 |
| Card binding / dynamic / Standee lifecycle | 49/49 · 29/29 · 24/24 |
| VCF / QR PDF | 69/69 · PASS |
| `git diff --check` | clean |

---

## 11. Responsive results

Standee main + Manage verified at 320 and 1440 (plus one 375/390/430/768/1024
sampling in the P2.4 harness); no horizontal overflow, no clipped Save/controls,
no dialogs. Light/dark styling uses existing tokens. Physical-device and
screen-reader testing remain NOT TESTED.

---

## 12. Files modified

- `next.config.mjs` — env-aware `distDir`.
- `package.json` — isolated `dev` script.
- `.gitignore` — ignore `.next-dev` / `.next-*`.
- `tsconfig.json` — include `.next-dev/types`.
- `docs/PHASE_4D10_GATE_P2_5_STANDEE_SERVER_ERROR_REPAIR.md` (this report).

No Standee component/API/schema changes were required in P2.5.

---

## 13. Remaining limitations

- The isolation relies on using `npm run dev` (or setting
  `NEXT_DIST_DIR=.next-dev`). An operator who manually runs `next dev` against
  `.next` and then builds can still reproduce the collision. Documented.
- The `NEXT_DIST_DIR=.next-dev` script uses POSIX env syntax; this project is
  macOS/Linux. Windows PowerShell would need `cross-env` (not installed).
- Old `.next` backup is retained at the temp path until owner approves cleanup.
- Vercel Preview/Production environment verification and physical QA remain
  pending from earlier gates.

---

## 14. Preview deployment impact

- Vercel does not set `NEXT_DIST_DIR`, so `next build` still produces `.next` and
  deployment behavior is unchanged.
- `dev` script is local-only and does not affect Preview/Production.
- No Vercel environment variable or remote setting was changed.
- Preview redeployment is not required for this local environment fix, though a
  fresh Preview build is always required for prior P2.3/P2.4 changes.

---

## 15. Rollback instructions

Revert `next.config.mjs`, `package.json`, `.gitignore` and `tsconfig.json` to
their pre-P2.5 content if the isolation approach must be removed. Before doing
so, stop all Next dev/start processes so the old shared `.next` cannot be
corrupted. The retained `.next` backup is outside the project and can be used
for investigation; do not delete it without owner approval. No database or
customer-data rollback is needed.

**LOCAL REPAIR COMPLETE — ENVIRONMENT ISSUE IDENTIFIED**

Stopped. No commit, push, deployment, remote database access or flag activation
occurred.
