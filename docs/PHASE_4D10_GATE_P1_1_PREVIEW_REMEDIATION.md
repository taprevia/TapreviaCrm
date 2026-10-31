# TAPREVIA — PHASE 4D.10 GATE P1.1 PREVIEW REMEDIATION

**Status:** LOCAL PREVIEW REMEDIATION COMPLETE — EXTERNAL VERIFICATION PENDING
**Preview deployment:** NOT AUTHORIZED / NOT EXECUTED
**Remote database access:** NONE
**Production changes:** NONE
**Feature flags:** all four OFF

This document records the locally authorized remediation from Gate P1 and the
remaining external checks. It does not authorize deployment or environment
changes.

---

## 1. Executive summary

Gate P1.1 fixed three Preview-specific issues locally without changing
Production behavior:

1. **Preview database selection now fails closed.** A deployed non-production
   Vercel environment must provide an explicit, valid `MONGODB_DB`; missing,
   blank or Production database names throw at startup/build. The URI path is
   no longer the only signal, because Mongoose's `dbName` option overrides it.
2. **Deployed Preview no longer auto-creates indexes.** Any runtime with a
   Vercel environment disables `autoIndex`/`autoCreate`, matching Production.
   Isolated local development/tests keep intentional auto-indexing.
3. **Preview QR/NFC generation supports exactly one approved hostname.** A
   Vercel Preview may use `*.vercel.app` only when `VERCEL_ENV=preview`, the base
   URL is HTTPS, and its hostname exactly matches an explicitly configured
   approved host. No wildcard, suffix, port, credential, path or Host-header
   fallback is accepted. Production validation is unchanged.

Additionally, operational scripts no longer print `MONGODB_URI`, and the
conflicting `autoIndex=true` instruction in `docs/DEPLOYMENT.md` was corrected.

Local verification: typecheck, lint, builds OFF/ON, 16-combination matrix
192/192, preview-config 41/41, full regression battery PASS. No remote system
was contacted. External Vercel/Atlas/storage/backup verification remains
pending.

---

## 2. Repository baseline

| Item | Value |
|---|---|
| Branch | `Devlopment` |
| HEAD | `8e9a45fdbae9eef24c1f341594c27bfd209090e0` |
| Working tree before P1.1 | 89 entries |
| Working tree after P1.1 | 94 entries (new test script and this report; three operational scripts newly modified for URI-log redaction; other edits were existing entries) |
| `.env.local` mtime | `2026-10-04 12:13:12` (unchanged) |
| `.env.preview` mtime | `2026-10-09 23:36:49` (unchanged) |
| Flags | all four OFF |
| `git diff --check` | clean |

Pre-change baseline: typecheck/lint PASS, builds OFF/ON PASS, matrix 192/192,
security/entitlement/VCF/QR/Review Library/import PASS. No commit, push, pull,
merge, rebase, reset, stash, clean or branch switch.

---

## 3. Files changed

Application code:

- `src/lib/db-target.ts` — explicit Preview DB resolution, Production-name
  rejection, deployed-runtime detection, URI fail-closed helper.
- `src/lib/db.ts` — uses the new resolver/policy; Preview auto-index disabled.
- `src/lib/public-base.ts` — exact-host Preview QR origin policy; Production
  and local behavior preserved.

Configuration/documentation:

- `.env.example` — documented `MONGODB_DB`, `PREVIEW_APPROVED_HOST`,
  `NEXT_PUBLIC_PREVIEW_APPROVED_HOST`.
- `docs/DEPLOYMENT.md` — corrected conflicting `autoIndex=true` guidance and
  documented the new variables.
- `scripts/smoke-public-routes.ts`, `scripts/smoke-dynamic-routing.ts`,
  `scripts/seed-panthevent-demo.ts` — no longer print connection strings.
- `package.json` — added `test:phase4d10p1`.
- `scripts/test-phase4d10p1-preview-config.ts` — 41 pure configuration tests.
- `docs/PHASE_4D10_GATE_P1_1_PREVIEW_REMEDIATION.md` — this report.

No schema, model field, customer record, alias, route, NFC/QR URL, Google
destination, entitlement or analytics record was changed.

---

## 4. Database selection remediation

### 4.1 New resolution rules

`resolvePrimaryDatabaseName()`:

| Environment | `MONGODB_DB` | Result |
|---|---|---|
| Vercel Preview (`VERCEL_ENV=preview`) | valid explicit | use it |
| Vercel Preview | missing/blank | **throw** — fails closed |
| Vercel Preview | `test` or `taprevia_backup` | **throw** — Production name refused |
| Other deployed non-production Vercel env | missing/blank | **throw** |
| Other deployed non-production Vercel env | valid non-Production name | use it |
| Vercel Production | explicit valid | use it (unchanged) |
| Vercel Production | missing | `test` (unchanged) |
| Local `NODE_ENV=production` | missing | `test` (unchanged) |
| Local development | missing | `taprevia_V2` (unchanged) |

Invalid names (whitespace/slash/backslash/over 63 chars) throw. Errors contain
variable names only — no URI, host, user or password.

`requireMongoUriValue()` keeps the existing rule: Production without
`MONGODB_URI` throws; local development may use the local fallback.

### 4.2 Integration proof without remote access

Importing `src/lib/db.ts` under simulated env:

| Env | Result |
|---|---|
| `VERCEL_ENV=preview`, no `MONGODB_DB` | `Error: MONGODB_DB is required for Vercel preview deployments…` |
| `VERCEL_ENV=preview`, `MONGODB_DB=test` | `Error: Refusing MONGODB_DB="test" … Production database name` |
| `VERCEL_ENV=preview`, `MONGODB_DB=taprevia-preview` | imports successfully |
| `VERCEL_ENV=production`, no `MONGODB_URI` | `Error: MONGODB_URI is required in production` |

### 4.3 Required owner configuration (documentation only)

Vercel **Preview** scope:

```text
MONGODB_URI=<Preview-scoped Atlas URI>
MONGODB_DB=taprevia-preview        # or the owner-confirmed Preview database name
```

The local `.env.preview` URI path is `taprevia-preview`, but the owner must
confirm the actual Preview database name and set it explicitly. `taprevia_V2`
is no longer an implicit Preview default.

Vercel **Production** scope (unchanged behavior; explicit recommended):

```text
MONGODB_URI=<Production URI>
MONGODB_DB=test
```

A missing Preview `MONGODB_DB` will fail the Preview build/startup intentionally.
That is safer than silently selecting another database.

---

## 5. Preview index safety

`isDeployedRuntime()` returns true for any Vercel environment or local
`NODE_ENV=production`. `indexCreationOptions()` therefore disables
`autoIndex`/`autoCreate` for **Preview and Production**. Only isolated local
development/tests (no `VERCEL_ENV`, non-production `NODE_ENV`) keep automatic
index creation.

| Runtime | autoIndex | autoCreate |
|---|---|---|
| Vercel Preview | false | false |
| Vercel Production | false | false |
| Local `npm start` (NODE_ENV=production) | false | false |
| Local dev / synthetic tests | true | true |

No Vercel setting is needed. No index was created or dropped in this phase.
Preview indexes must be reviewed and created later through the approved
maintenance procedure (`docs/DATABASE_INDEX_RUNBOOK.md`); the optional
active-assignment partial unique index remains separately approved and is not
required by the code fix.

`docs/DEPLOYMENT.md` no longer recommends `autoIndex=true` for deployments.

---

## 6. Safe Vercel Preview QR support

### 6.1 Policy

| Environment | Behavior |
|---|---|
| Local development | unchanged (configured value or browser origin) |
| Vercel Preview | only HTTPS + exact approved hostname; no fallback/Host header |
| Vercel Production | unchanged (custom https domain accepted; localhost/`*.vercel.app` rejected) |
| Unknown Vercel env | fails safe (`''`, QR disabled) |
| Missing Preview approval | fails safe (`''`) |

Preview requires all of:

1. `VERCEL_ENV=preview` (server) or the public approved-host signal (client).
2. `NEXT_PUBLIC_BASE_URL` explicitly configured.
3. HTTPS.
4. Hostname exactly equals `PREVIEW_APPROVED_HOST` /
   `NEXT_PUBLIC_PREVIEW_APPROVED_HOST`.
5. No wildcard, suffix trust, port, credentials, path or query.
6. No browser/Host-header fallback.

### 6.2 Required Preview variables

Because there is no custom Preview domain, use the **stable Preview branch
alias** (not a per-deployment hash URL):

```text
VERCEL_ENV=preview                              # set automatically by Vercel
NEXT_PUBLIC_BASE_URL=https://<stable-preview-branch-alias>
PREVIEW_APPROVED_HOST=<stable-preview-branch-alias>
NEXT_PUBLIC_PREVIEW_APPROVED_HOST=<stable-preview-branch-alias>
```

All three host values must be identical. If the alias changes, update them
together; otherwise QR generation stays disabled (fail safe). Do not use a
temporary deployment URL to print permanent customer QR codes.

Production must not set `PREVIEW_APPROVED_HOST` or
`NEXT_PUBLIC_PREVIEW_APPROVED_HOST`.

### 6.3 Backward compatibility

No Production QR/NFC behavior, Card alias, Standee slug, Google destination or
QR PDF contract changed. Existing Production custom domains remain accepted;
`*.vercel.app` remains rejected in Production; local development is unchanged.

---

## 7. Vercel environment mapping checklist

**PENDING OWNER VERIFICATION** — no Vercel settings were read or changed.

Preview scope:

- [ ] `MONGODB_URI` is Preview-scoped.
- [ ] `MONGODB_DB` is explicitly the Preview database.
- [ ] `PREVIEW_APPROVED_HOST` / `NEXT_PUBLIC_PREVIEW_APPROVED_HOST` set to the
      same stable branch alias.
- [ ] `NEXT_PUBLIC_BASE_URL` is the same HTTPS origin.
- [ ] `JWT_SECRET` differs from Production.
- [ ] `APP_KEY` differs from Production.
- [ ] `MEDIA_DRIVER=s3` with Preview-scoped bucket/credentials.
- [ ] `RESEND_API_KEY` disabled/restricted; no real customer sends.
- [ ] All four review flags absent or `false`.
- [ ] No cron/background jobs.
- [ ] Deployment protection enabled.
- [ ] Preview branch mapping points to Preview, not Production.

Production scope:

- [ ] `MONGODB_URI`/`MONGODB_DB` remain the Production target (`test` by default).
- [ ] Preview-only host variables are absent.
- [ ] All four flags remain OFF until separately approved.
- [ ] Existing JWT/APP_KEY/storage/email values unchanged.

No environment variable was modified.

---

## 8. Atlas permission checklist

**PENDING OWNER VERIFICATION** — no Atlas connection was made.

- [ ] Preview application user has read/write only on the Preview database.
- [ ] Preview user cannot read or write the Production database or
      `taprevia_backup`.
- [ ] Production user cannot be used by Preview.
- [ ] Preview user has no `dbAdmin`/`userAdmin`/cluster-admin role.
- [ ] Network access rules reviewed.
- [ ] Shared-cluster resource impact noted; no stress/large unbounded queries.
- [ ] Backup connection (if ever enabled) derives `<preview>_backup`, never
      `taprevia_backup`.

Source code cannot prove Atlas roles; the owner must inspect them in Atlas.

---

## 9. Storage and external-service isolation

**PENDING OWNER VERIFICATION.**

| Service | Requirement |
|---|---|
| S3/R2 storage | Separate Preview bucket or prefix; Preview credentials must not overwrite/delete Production media |
| Email (Resend) | Disabled or sandboxed in Preview; no real customer emails |
| WhatsApp/SMS | No outbound sends from Preview tests |
| Payment | No payment integration exists in this codebase |
| Webhooks/cron | None found in the repository |
| AI provider | Per-tenant encrypted keys; Preview must not use Production provider credentials; use authorized non-production config |
| Analytics | Preview writes stay in the Preview database |

Local `.env.preview` has `MEDIA_DRIVER=s3` but empty S3 access/secret values and
an empty Resend key. This fails safely locally but must be verified in Vercel.
No credential was changed.

---

## 10. Preview data baseline plan

Not executed. Use an approved read-only Preview connection only.

```js
// Collection counts (no PII)
db.getCollectionNames().sort().map((name) => ({
  name,
  count: db.getCollection(name).estimatedDocumentCount()
}));

// Non-sensitive ID bounds for key collections
['users','cards','standees','userproducts','catalogproducts','reviewsettings',
 'reviewtemplates','reviewrotationevents','reviewrotationstates','analyticslogs']
  .forEach((name) => printjson({
    collection: name,
    ...db.getCollection(name).aggregate([
      { $group: { _id: null, count: { $sum: 1 }, minId: { $min: '$_id' }, maxId: { $max: '$_id' } } }
    ]).toArray()[0]
  }));

// Distributions
db.cards.aggregate([{ $group: { _id: { status: '$status', kind: '$kind', isActive: '$isActive' }, count: { $sum: 1 } } }]);
db.userproducts.aggregate([{ $group: { _id: { status: '$status' }, count: { $sum: 1 } } }]);
db.users.aggregate([{ $group: { _id: { role: '$role', status: '$status' }, count: { $sum: 1 } } }]);
```

Also record: existing duplicate active `userId+cardId`; same Card active for
multiple customers; duplicate Card UIDs; missing Card references; index
inventory; missing catalog references; zero-assignment Card counts.

Do not export names, emails, phones, tokens or credentials. Never use
`$out`/`$merge`. Do not reset or reseed Preview.

---

## 11. Backup verification

**PENDING OWNER VERIFICATION.** No backup/restore was initiated.

- [ ] Atlas continuous backup/snapshot enabled for the shared cluster.
- [ ] Latest successful snapshot timestamp and retention recorded.
- [ ] Preview database included in the backup scope (`test`/`taprevia-preview`
      naming confirmed).
- [ ] Restore procedure rehearsed in an isolated project/database, never into
      Production.
- [ ] Restore permissions and time objective recorded.
- [ ] Rollback limitations documented (snapshot granularity; no point-in-time
      guarantees beyond the provider plan).
- [ ] Monitoring/alerting for backup failures enabled.

Preview backup DB naming derives from the primary name; it must never target
`taprevia_backup` (enforced in code).

---

## 12. Deployment source strategy and release manifest

### 12.1 Source strategy

HEAD `8e9a45f` does not include the release work. A Git-based Preview would
build stale code. Preferred later path:

1. Review the working-tree manifest below.
2. Owner-approved commit on `Devlopment`.
3. Owner-approved push.
4. Confirm Vercel builds that commit as a **Preview** deployment.
5. Verify flags OFF and environment mapping before testing.

Alternative: `npx vercel deploy` (Preview only, never `--prod`) from the working
tree. `.vercelignore` excludes `.env`, `.env.*` (except `.env.example`) and
`.next`. CLI deployment lacks Git provenance and is not preferred.

No file was staged, committed or pushed.

### 12.2 Proposed release manifest (review required)

Exact machine-readable list: `git status --short` (91 entries). Groups:

- **Review backend:** `src/models/ReviewSettings.ts`,
  `ReviewRotationEvent.ts`, `ReviewRotationState.ts`, updated `AnalyticsLog.ts`,
  `Card.ts`, `Standee.ts`, `index.ts`, types, services
  (`review-*.ts`, `review-library-import.ts`, `user-product-assignment.ts`),
  validation.
- **APIs/routes:** review-management, review-library, public Track/reviews/
  standee-reviews, copied/generate/suggestions, review-entitlement, `/r/`,
  `/qr/`, `/standee-review/`.
- **UI:** `components/review-management/`, `components/review/`,
  `components/builder/`, public card page, dashboard navigation/pages, admin
  review-library/standee QR/user assignment.
- **Config/infra:** `src/config/products.ts`, `src/lib/db.ts`,
  `db-target.ts`, `review-feature-flags.ts`, `public-base.ts`, `qr-pdf.ts`,
  `review-attribution.ts`, middleware, `package.json`, `.vercelignore`,
  `.env.example`.
- **Docs:** Phase 4D.5–4D.10 reports/runbooks/checklists.
- **Tests:** review-management, standee-review, review-analytics, 4D.9
  matrix/historical/fixes, QR PDF, preview-config.

Explicitly excluded from any commit/deploy: `.env`, `.env.local`,
`.env.preview`, `.next`, `node_modules`, local databases/artifacts, `.vercel`
local metadata, any secret or generated credential file.

Files under `scripts/` and `docs/` are part of provenance but not required at
runtime; they can be included in the commit.

### 12.3 Reproducibility and rollback

Local `npm ci && npm run build` with flags OFF/ON reproduces the artifact.
Vercel Preview rollback to a previous deployment is possible only after the
first approved Git/CLI deployment; no deployment exists yet.

---

## 13. Full backward compatibility results

| Area | Result |
|---|---|
| Google Review Card host/entitlement/copy/analytics | PASS |
| Google Review NFC Plate | PASS |
| Premium NFC Business Card (profile/VCF/QR/editor) | PASS |
| Google Review Standee `/r/`, `/qr/`, panel, multi-profile | PASS |
| Lower-tier Cards remain review-restricted | PASS |
| Existing accounts/sessions | PASS (auth/security suites) |
| Suspended/removed/zero-assignment legacy behavior | PASS |
| Mixed-product accounts | PASS |
| Legacy/central/hybrid settings | PASS |
| Unknown slugs / spoofed display names | PASS (denied) |
| Existing API contracts | PASS |
| Admin activation / duplicate UID / concurrency | PASS |
| Dashboard/editor/mobile | PASS (browser emulation) |
| NFC/QR/Google destinations | unchanged; matrix verifies every combination |
| Historical analytics/copy/rotation | readable; deleted-host limitation unchanged |

No existing URL, destination, entitlement or record was rewritten.

---

## 14. Security results

- Authentication/authorization/tenant/product isolation: PASS.
- CSRF/origin/rate limits/input validation/prototype pollution: PASS.
- Signed token validity/expiry/tamper/cross-host/cross-business/replay/idempotency: PASS.
- Unsafe external redirect rejection: PASS.
- Cross-environment selection: Preview fails closed on missing/blank DB and
  refuses Production database names; errors contain no credentials.
- Preview auto-index creation disabled in deployed runtimes.
- Preview QR origin: exact approved host only; no wildcard/suffix/Host-header
  fallback; Production validation unchanged.
- No `MONGODB_URI` logging remains in operational scripts.
- No secret value was printed or changed.

---

## 15. Test evidence

| Suite | Result |
|---|---|
| Typecheck / ESLint | PASS |
| Build flags OFF / ON | PASS |
| Preview-config pure tests | 41/41 |
| 16-combination matrix | 192/192 |
| 4D.5 Review Management | 56/56 OFF · 56/56 ON |
| 4D.6 Standee | 20/20 × 4 = 80/80 |
| Unified analytics | 9/9 |
| Historical analytics | 9/9 |
| 4D.8/4D.9 fixes (editor + UID/concurrency) | 0 failures; 14/14 responsive rows; 201/409, 1 active |
| Security boundaries | PASS |
| Entitlement | 130/130 |
| Review Library | 48/48 |
| Review import | 13/13 |
| Card binding | 49/49 |
| Dynamic QR/NFC | 29/29 |
| Standee lifecycle | 24/24 |
| VCF | 69/69 |
| QR PDF | PASS |
| `git diff --check` | clean |

Responsive rows: 320/375/390/430/768/1024/1440 × light/dark, zero page overflow.
Physical-device, screen-reader, live AI and real Google navigation remain
NOT TESTED.

---

## 16. Remaining blockers

| Item | Classification |
|---|---|
| Vercel Preview/Production env mapping | PENDING OWNER VERIFICATION |
| Explicit Preview `MONGODB_DB` value | PENDING OWNER CONFIGURATION |
| Atlas Preview/Production role isolation | PENDING EXTERNAL VERIFICATION |
| JWT_SECRET / APP_KEY separation | PENDING EXTERNAL VERIFICATION |
| Stable Preview branch alias + approved host vars | PENDING OWNER CONFIGURATION |
| Preview S3 bucket/credentials isolation | PENDING EXTERNAL VERIFICATION |
| Preview Resend disable/restriction | PENDING EXTERNAL VERIFICATION |
| Preview backup/restore readiness | PENDING EXTERNAL VERIFICATION |
| Deployment source (uncommitted release) | PENDING OWNER APPROVAL |
| Physical/screen-reader/live-AI/Google QA | EXTERNAL QA PENDING |
| Deleted-host analytics attribution | DOCUMENTED LIMITATION |
| Multi-instance duplicate assignment without DB index | DOCUMENTED LIMITATION |

No unresolved local code, entitlement or backward-compatibility blocker.

---

## 17. Owner actions required

1. Set Vercel Preview `MONGODB_DB` explicitly (do not rely on URI path).
2. Set Preview `NEXT_PUBLIC_BASE_URL`, `PREVIEW_APPROVED_HOST`,
   `NEXT_PUBLIC_PREVIEW_APPROVED_HOST` to the same stable HTTPS branch alias.
3. Confirm/rotate Preview-only `JWT_SECRET` and `APP_KEY`.
4. Scope the Preview Atlas user to the Preview database only.
5. Configure Preview-only storage bucket/prefix and disable/sandbox Resend.
6. Keep all four flags OFF.
7. Enable deployment protection; confirm `Devlopment` → Preview mapping.
8. Record the read-only Preview baseline.
9. Review and approve the release manifest; commit/push or approve CLI Preview.
10. Verify Preview indexes/duplicates; approve any index creation separately.
11. Verify Atlas backup/restore readiness.
12. Approve any Preview deployment, flag activation or mutating test separately.

---

## 18. Preview deployment readiness decision

Local remediation is complete and backward-compatible. Preview deployment is
still gated on the external configuration checks above; no remote system was
verified in Gate P1.1.

**LOCAL PREVIEW REMEDIATION COMPLETE — EXTERNAL VERIFICATION PENDING**

Stop here. Wait for explicit owner approval before any Preview deployment or
remote verification.
