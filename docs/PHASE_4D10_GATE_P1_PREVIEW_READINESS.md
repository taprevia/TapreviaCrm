# TAPREVIA — PHASE 4D.10 GATE P1 PREVIEW READINESS

**Stage:** Gate P1 — Preview environment isolation, deployment readiness and backward-compatibility audit
**Status:** PREVIEW READINESS INCOMPLETE — VERIFICATION PENDING
**Preview deployment:** NOT AUTHORIZED / NOT EXECUTED
**Remote database access:** NONE
**Vercel settings changed:** NONE
**Feature flags activated:** NONE

This document is preparation and evidence only. It does not authorize deployment,
environment changes, index creation, data changes or feature activation.

---

## 1. Executive summary

Source inspection, local builds and the full local regression battery pass. The
application has strong fail-closed behavior for production, but **Preview
database selection cannot be certified from the repository alone**:

1. `src/lib/db.ts` always passes an explicit `dbName` option to Mongoose. That
   option overrides the database name in the connection URI. Local
   `.env.preview` has **no `MONGODB_DB`**, so the app falls back to
   `taprevia_V2`, while the URI path is `taprevia-preview`. Unless Vercel
   Preview sets `MONGODB_DB=taprevia-preview` (or the intended name is actually
   `taprevia_V2`), Preview will not select the database the owner named.
2. Preview runs with `NODE_ENV=production` but `VERCEL_ENV=preview`, so
   `autoIndex`/`autoCreate` are **true** in Preview. A Preview deployment can
   therefore create schema-declared indexes at startup, unlike Production.
3. `canonicalPublicBase()` rejects `*.vercel.app` when `NODE_ENV=production`.
   The local `.env.preview` base URL is a `vercel.app` host, so QR/NFC URL
   generation is disabled in Preview unless a non-`vercel.app` preview domain
   is configured or this behavior is explicitly accepted.
4. Current work is uncommitted (87 entries at audit start; HEAD unchanged).
   Vercel Git integration would deploy HEAD `8e9a45f` and omit all Phase
   4D.5–4D.10 work. A CLI deployment from the working tree or an
   owner-approved commit/push is required.
5. Actual Preview/Production credential scoping, JWT/APP_KEY separation, S3
   bucket separation, Resend behavior and backup readiness cannot be verified
   without authorized Vercel/Atlas read-only access and are marked
   **PENDING EXTERNAL VERIFICATION**.

Local code quality is green; Preview deployment safety depends on environment
verification and owner decisions.

---

## 2. Branch, HEAD and working-tree status

| Item | Value |
|---|---|
| Branch | `Devlopment` |
| HEAD | `8e9a45fdbae9eef24c1f341594c27bfd209090e0` |
| Working tree at audit start | 87 modified/untracked entries |
| Phase 4D.9 changes | present |
| Phase 4D.10 Gate A document | present |
| `.env.local` mtime | `2026-10-04 12:13:12` (unchanged) |
| `.env.preview` mtime | `2026-10-09 23:36:49` (unchanged) |
| Local feature flags | all four OFF |
| `git diff --check` | clean |

No commit, push, pull, merge, rebase, reset, stash, clean or branch switch.

---

## 3. Deployment source and uncommitted-change strategy

### 3.1 Current reality

- `HEAD` is unchanged since Phase 4D.8.
- All Phase 4D.5–4D.10 work is in the working tree (87 entries before this
  document, 89 after adding `.vercelignore` and this report).
- `.vercel/repo.json` links the directory to the `taprevia-crm` Vercel project.
- `vercel.json` only sets a `maxDuration` for the review-generate function; it
  defines no crons and no environment values.
- CI (`.github/workflows/ci.yml`) runs on `main`/`master` pushes and pull
  requests only — not on `Devlopment` pushes.

### 3.2 What Git-based Preview would deploy

Vercel Git integration builds a **pushed commit**, not the local working tree.
A Preview deployment of `Devlopment` today would build `8e9a45f`, which does not
contain Review Management, Standee review, unified analytics, the 4D.8 fixes,
the 4D.9 concurrency fix or the 4D.10 documents. It is **not** a valid Preview
of the release candidate.

### 3.3 Safe options for later owner approval

| Option | Includes uncommitted work | Git provenance | Commit required | Notes |
|---|---|---|---|---|
| A. Owner-approved commit + push to `Devlopment`, Vercel Git Preview | Yes (after commit) | Yes | Yes | Recommended for auditability; requires confirming the project’s Preview branch mapping and that `Devlopment` is not the Production branch |
| B. Vercel CLI Preview deploy from the working tree | Yes | No | No | `vercel deploy` (never `--prod`) uploads the local source and builds with Preview env; `.vercelignore` now excludes env files |
| C. Patch onto a temporary branch | Yes | Partial | Yes | Adds branch/commit complexity; not recommended |

Gate P1 does **not** execute any option. `.vercelignore` was added so a future
CLI deployment cannot upload `.env`, `.env.*` (except `.env.example`), or
`.next`.

---

## 4. Preview/Production database isolation assessment

### 4.1 Verified source behavior

| Control | Behavior | Assessment |
|---|---|---|
| Explicit database option | `mongoose.connect(uri, { dbName: PRIMARY_DB_NAME })` and `createConnection(..., { dbName: BACKUP_DB_NAME })` | URI path is overridden by `dbName` — verified locally |
| Name resolution | `MONGODB_DB` wins; otherwise `VERCEL_ENV !== 'production'` → `taprevia_V2`; production → `test` | Explicit name is mandatory for certainty |
| Production missing URI | Throws (`MONGODB_URI is required in production`) | Fails closed |
| Preview missing URI | `NODE_ENV=production` on Vercel → same throw | Fails closed (no localhost fallback) |
| Invalid database name | `resolveBackupDbName` validates primary and backup names; throws | Fails closed at module load |
| Production backup name | `taprevia_backup` | Matches source constant |
| Preview backup name | `<primary>_backup` by default; explicit `MONGODB_BACKUP_DB` wins | Preview cannot target `taprevia_backup`; throws |
| Startup index policy | Production: `autoIndex/autoCreate=false`; Preview/development: `true` | Preview may create schema indexes |
| Connection logging | Host + expected/actual DB name only; no URI or credentials | No secret logging found |
| Secondary connection | `connectBackupDB()` uses `MONGODB_BACKUP_URI ?? MONGODB_URI`, same environment-aware DB name | No bypass found; currently no caller in app code |

Local simulation of the pure resolution logic:

| Case | Result |
|---|---|
| Preview, no `MONGODB_DB` | primary `taprevia_V2`, backup `taprevia_V2_backup`, autoIndex true |
| Preview, `MONGODB_DB=taprevia-preview` | primary `taprevia-preview`, backup `taprevia-preview_backup`, autoIndex true |
| Preview targeting `taprevia_backup` | refused (throws) |
| Production, no `MONGODB_DB` | primary `test`, backup `taprevia_backup`, autoIndex false |
| Invalid name | throws |

A local Mongoose probe confirmed that a URI path (`uri-path-db`) is replaced by
the `dbName` option (`option-db`).

### 4.2 Local `.env.preview` metadata (no secret values)

| Item | Observed |
|---|---|
| `MONGODB_URI` present | Yes (Atlas cluster, database path `taprevia-preview`) |
| `MONGODB_DB` | **Absent** |
| `MONGODB_BACKUP_URI` / `MONGODB_BACKUP_DB` | Absent |
| JWT secret | present (44 chars) |
| APP_KEY | present, decodes to 32 bytes |
| `MEDIA_DRIVER` | `s3` |
| S3 credentials | **incomplete locally** (`S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` empty; endpoint/bucket present) |
| `NEXT_PUBLIC_BASE_URL` | `*.vercel.app` class |
| Resend key | **empty locally**; `EMAIL_FROM` present |
| Feature flags | absent (default OFF) |

### 4.3 Required verification

- [ ] Vercel **Preview** scope explicitly sets `MONGODB_DB` to the intended
      Preview database (`taprevia-preview` per URI path, or the owner-confirmed
      name). Do not rely on the default `taprevia_V2`.
- [ ] Vercel **Production** scope explicitly sets `MONGODB_DB=test` (or relies
      on the documented production default) and the Production URI.
- [ ] Preview MongoDB user is scoped to the Preview database only; it must not
      hold read/write on the Production database or `taprevia_backup`.
- [ ] Production user cannot be used by Preview.
- [ ] Atlas network access and roles reviewed.
- [ ] The actual connected database is confirmed from Preview runtime logs
      (`[db] primary connected — actualDb=...`) without exposing credentials.
- [ ] Backup connection, if ever enabled, resolves to `<preview>_backup`, not
      `taprevia_backup`.

**Database-level permission isolation: PENDING EXTERNAL VERIFICATION.** Source
inspection does not prove Atlas permissions.

---

## 5. Vercel environment mapping assessment

No Vercel settings or secret values were read or changed. The repository only
proves variable **names** used by the app.

| Variable | Code usage | Preview requirement | Production requirement |
|---|---|---|---|
| `MONGODB_URI` | primary connection | Preview cluster URI, Preview database path | Production cluster URI, Production database path |
| `MONGODB_DB` | explicit DB name (wins over URI path) | **Must be set explicitly** (e.g. `taprevia-preview`) | `test` (explicit preferred) |
| `MONGODB_BACKUP_URI` / `MONGODB_BACKUP_DB` | backup connection | Optional; never `taprevia_backup` | `taprevia_backup` semantics |
| `JWT_SECRET` | session signing | **Must differ from Production** | Unique production secret |
| `APP_KEY` | AES-GCM tenant secrets | **Must differ from Production** | Unique production key |
| `NEXT_PUBLIC_BASE_URL` | QR/NFC public origin | Custom preview domain (not `*.vercel.app` for QR generation) | Canonical production origin |
| `MEDIA_DRIVER` | storage driver | `s3` with Preview-scoped bucket/credentials | `s3` production bucket |
| `S3_*` | object storage | Separate bucket or prefix; no Production write | Production bucket |
| `RESEND_API_KEY` / `EMAIL_FROM` | password-reset email | Disabled or restricted test sender; never real customer sends | Production sender |
| `NEXT_PUBLIC_WHATSAPP_NUMBER` | marketing CTA | Optional | Production number |
| `IMAGE_HOSTS` | next/image allowlist | Optional | Optional |
| `NEW_REVIEW_COPY_FLOW_ENABLED` | feature gate | Must be absent or `false` | `false` until approved |
| `SMART_REVIEW_ROTATION_ENABLED` | feature gate | Must be absent or `false` | `false` |
| `CENTRAL_REVIEW_PUBLIC_INTEGRATION_ENABLED` | feature gate | Must be absent or `false` | `false` |
| `STANDEE_REVIEW_ASSISTANT_ENABLED` | feature gate | Must be absent or `false` | `false` |

Manual Vercel checklist (requires authorized dashboard/CLI read access):

- [ ] Preview scope contains its own `MONGODB_URI` and explicit `MONGODB_DB`.
- [ ] Production scope variables are not inherited by Preview via a shared
      “All Environments” entry.
- [ ] Branch-specific overrides (if any) map `Devlopment` to Preview, not
      Production.
- [ ] Production branch is `main`/`master` (or the owner-confirmed branch); it
      is not `Devlopment`.
- [ ] JWT/APP_KEY differ between scopes.
- [ ] Preview base URL and auth callback/origin behavior are correct.
- [ ] Storage bucket/prefix is Preview-only.
- [ ] Email key is disabled or restricted; no real customer sends.
- [ ] AI configuration is per-tenant and no production provider key is shared.
- [ ] All four flags are OFF in Preview.
- [ ] No cron/background jobs exist (repository has none).
- [ ] Deployment protection (password/SSO) is enabled for Preview.

**Vercel mapping: PENDING EXTERNAL VERIFICATION.**

---

## 6. Preview data-protection plan

Preview contains customer-like data. No Preview data was accessed or modified in
Gate P1.

### 6.1 Prohibited during any future Preview work

- No database reset, reseed, migration or bulk update.
- No seed scripts (`npm run seed`, demo/sparse seeds) against Preview.
- No account deletion, assignment replacement, Card UID regeneration, alias
  changes, QR destination overwrite or settings overwrite.
- No analytics rewrite or backfill.
- No outbound email/WhatsApp/SMS/payment notifications to copied contacts.
- No use of real customer accounts for destructive tests; use dedicated Preview
  test accounts approved by the owner.
- No scripts that print `MONGODB_URI` (`smoke-public-routes`,
  `smoke-dynamic-routing`, `seed-panthevent-demo`) against Preview/Production —
  they can expose credentials in logs and some write data.

### 6.2 Read-only baseline procedure (not executed)

Run only with an approved read-only Preview connection:

```js
// Collection counts
db.getCollectionNames().sort().map((name) => ({
  name,
  count: db.getCollection(name).estimatedDocumentCount()
}));

// Stable non-sensitive ID bounds and counts for key collections
['users','cards','standees','userproducts','catalogproducts','reviewsettings',
 'reviewrotationevents','reviewrotationstates','analyticslogs'].forEach((name) => {
  printjson({ collection: name, ...db.getCollection(name).aggregate([
    { $group: { _id: null, count: { $sum: 1 }, minId: { $min: '$_id' }, maxId: { $max: '$_id' } } }
  ]).toArray()[0] });
});

// Status/kind distributions (no PII)
db.cards.aggregate([{ $group: { _id: { status: '$status', kind: '$kind', isActive: '$isActive' }, count: { $sum: 1 } } }]);
db.userproducts.aggregate([{ $group: { _id: { status: '$status' }, count: { $sum: 1 } } }]);
db.users.aggregate([{ $group: { _id: { role: '$role', status: '$status' }, count: { $sum: 1 } } }]);
```

Record the output before and after a future deployment and compare. Optional
stronger fingerprint: export sorted `_id` values per collection and hash them
app-side; do not export names, emails, phones or secrets. Never use `$out` or
`$merge`.

---

## 7. Database index and duplicate-preflight plan

Index specifications are the same as Gate A and were verified locally against
the schemas:

- `reviewsettings.businessId_1` unique.
- `reviewrotationevents` composite unique + `copyId_1` unique + two reporting
  indexes.
- `reviewrotationstates` business/category unique.
- `analyticslogs` timestamp/action indexes + 180-day TTL.
- Existing Card/Standee/Catalog identity indexes unchanged.

### 7.1 Preview-specific warning

Preview currently runs with `autoIndex: true`, so a deployment may create
schema-declared indexes automatically. Before deploying, the owner must either:

1. accept additive auto-index creation in Preview, or
2. approve a code change to disable auto-indexing outside local development.

No index was created in Gate P1.

### 7.2 Optional active-assignment index

```js
db.userproducts.createIndex(
  { userId: 1, cardId: 1 },
  {
    unique: true,
    name: 'userId_1_cardId_1_active_unique',
    partialFilterExpression: { status: 'active', cardId: { $type: 'objectId' } }
  }
);
```

**DOCUMENTATION ONLY — DO NOT EXECUTE.** Locally verified behavior:

- Allows removed historical + new active rows, different Cards, and null-card
  Standee/other assignments.
- Rejects duplicate active `userId` + `cardId`.
- **Allows the same Card active for different customers** — it is not a global
  ownership constraint.

### 7.3 Read-only Preview preflight

```js
// Blocking for the optional index
db.userproducts.aggregate([
  { $match: { status: 'active', cardId: { $type: 'objectId' } } },
  { $group: { _id: { userId: '$userId', cardId: '$cardId' }, count: { $sum: 1 } } },
  { $match: { count: { $gt: 1 } } },
  { $lookup: { from: 'cards', localField: '_id.cardId', foreignField: '_id', as: 'card' } },
  { $project: { userId: '$_id.userId', cardId: '$_id.cardId', count: 1,
      cardUid: { $arrayElemAt: ['$card.cardUid', 0] } } }
]);

// Cross-customer ownership check (separate escalation)
db.userproducts.aggregate([
  { $match: { status: 'active', cardId: { $type: 'objectId' } } },
  { $group: { _id: '$cardId', users: { $addToSet: '$userId' }, count: { $sum: 1 } } },
  { $match: { $expr: { $gt: [{ $size: '$users' }, 1] } } },
  { $lookup: { from: 'cards', localField: '_id', foreignField: '_id', as: 'card' } },
  { $project: { cardId: '$_id', users: 1, count: 1,
      cardUid: { $arrayElemAt: ['$card.cardUid', 0] } } }
]);

// Review unique-index preflight (same four queries as Gate A §5.5)
```

Any duplicate is a blocker for the related unique index. Never delete or merge
automatically. Before creating any unique index, inspect existing indexes in
Preview — auto-index may already have created some.

---

## 8. Four-product compatibility test plan

Use dedicated Preview test accounts and existing Preview records read-only where
possible. Do not mutate real customer records. Mutating tests (assignment/edit)
require an approved test account.

| Area | Google Review Card | NFC Plate | Premium NFC Card | Google Review Standee | Lower-tier Card |
|---|---|---|---|---|---|
| Product assignment | Preview test account | Test account | Test account | Test account | Test account |
| Entitlement | review-capable | review-capable | review-capable | active product only | denied |
| Review Assistant availability | enabled/disabled states | same | same | gate OFF = legacy redirect; gate ON = host | denied |
| Public review route | `/review/{alias}` | `/review/{alias}` | `/review/{alias}` | `/standee-review/{route}` + legacy `/r/`, `/qr/` | unavailable |
| NFC/QR destination | `/r/{route}` → review | same | profile destination | gate-aware | unchanged legacy |
| Google Review link | unchanged | unchanged | unchanged | standalone URL preserved | n/a |
| Legacy/central/hybrid | legacy first | legacy | legacy + central/hybrid | own URL authoritative | n/a |
| AI generation | mocked/synthetic only | same | same | same | denied |
| Manual review | yes | yes | yes | yes | no |
| Copy behavior | legacy/copy-flow | same | same | same | no |
| Rotation | OFF baseline; ON after approval | same | same | same | no |
| Analytics | tenant-scoped | same | same | standee attribution | excluded |
| Product editor | existing builder | existing | existing | standee manage | locked |
| Mobile | 320–430 | same | same | same | same |
| Customer dashboard | product listed | listed | listed | listed | listed, review locked |

Evidence from local suites: matrix 192/192, 4D.5 112/112, 4D.6 80/80, analytics
9/9, historical 9/9, entitlement 130/130, security PASS. Preview-specific
verification remains pending.

---

## 9. Feature-flag activation and rollback plan

All four flags must be absent or `false` for the first Preview deployment:

- `NEW_REVIEW_COPY_FLOW_ENABLED`
- `SMART_REVIEW_ROTATION_ENABLED`
- `CENTRAL_REVIEW_PUBLIC_INTEGRATION_ENABLED`
- `STANDEE_REVIEW_ASSISTANT_ENABLED`

### 9.1 OFF baseline

Verify: Card review pages unchanged, Standee `/r/`/`/qr/` keep their Google/
profile destinations, central reads stay legacy, rotation is inert even if its
flag is accidentally set, analytics readable, entitlements unchanged.

### 9.2 Activation order (only after separate approval)

1. Copy flow.
2. Rotation (requires copy flow; inert otherwise).
3. Central public integration.
4. Standee public host.

One flag at a time, with smoke tests and an observation window between flags.
Never enable all four at once.

### 9.3 Required combinations

Exercise the 16 combinations in Preview before activating anything beyond the
first flag. Locally verified: 192/192.

### 9.4 Rollback order

Reverse: Standee → Central → Rotation → Copy. Disabling flags must not delete
data, reset rotation state, rewrite URLs, remove analytics or revoke
entitlements. No flag was activated in Gate P1.

---

## 10. Preview deployment procedure (documentation only)

### 10.1 Prerequisites

- [ ] Owner approves the source strategy (commit/push vs CLI).
- [ ] Vercel Preview branch mapping confirmed (`Devlopment` = Preview, not
      Production).
- [ ] Preview env verified: explicit `MONGODB_DB`, Preview-scoped credentials,
      distinct JWT/APP_KEY, Preview base URL, storage and email restrictions.
- [ ] All four flags OFF.
- [ ] Preview read-only baseline recorded.
- [ ] Index inventory + duplicate preflight reviewed; autoIndex decision made.
- [ ] Atlas snapshot/restore readiness confirmed for Preview.
- [ ] Monitoring available.

### 10.2 Deployment options

**Git path (recommended for provenance):** after approval, commit the release
work on `Devlopment` and push; Vercel builds a Preview deployment from that
commit. Verify the deployment’s branch/commit in Vercel before testing.

**CLI path (includes uncommitted work):**

```bash
# DOCUMENTATION ONLY — DO NOT EXECUTE IN GATE P1
npx vercel deploy            # Preview deployment; NEVER add --prod
```

`.vercelignore` excludes `.env*` and `.next` from the upload. Confirm the
deployment URL and that it is not a Production deployment.

### 10.3 Flags-OFF smoke sequence

1. `/login`, `/` and a known public profile return expected status.
2. Existing Card `/review/{alias}` and `/r/{route}` destinations unchanged.
3. Existing Standee `/r/{route}`, `/qr/{qrId}`, `/panel/{route}` unchanged.
4. Review Management loads; existing settings readable.
5. Analytics loads; historical metrics present.
6. Entitlements: existing products accessible, lower-tier review locked.
7. VCF/contact and QR PDF behavior checked (QR may be disabled with a
   `vercel.app` base URL — see §5).
8. No 5xx spike, no auth failures, no duplicate-key/index errors in logs.

### 10.4 Monitoring and rollback triggers

Watch Function errors/5xx, DB connection errors, `[db] ... MISMATCH`, duplicate
key `E11000`, auth failures, storage errors, email failures and unexpected
redirects. Rollback triggers: wrong database name, cross-environment auth,
Production URL emitted in Preview, data mutation outside test accounts,
sustained 5xx, or duplicate/entitlement anomalies.

### 10.5 Recovery verification

After rollback: correct Preview DB, login, public routes, NFC/QR destinations,
Google URLs, entitlements, analytics, Review Management, no data loss.

No deployment was executed.

---

## 11. Security and tenant isolation assessment

| Control | Local status | Preview status |
|---|---|---|
| Auth/session signing | PASS locally | JWT separation PENDING |
| Tenant isolation | PASS (matrix + entitlement) | PENDING runtime verification |
| Product entitlement isolation | PASS | PENDING |
| Lower-tier restriction | PASS | PENDING |
| Signed rotation tokens | PASS | PENDING (flags OFF) |
| CSRF/origin/rate limits | PASS | Applies in Preview |
| Public host guards | PASS | PENDING |
| Secret logging | No URI/credential logging in app; some scripts print URI | Do not run those scripts |
| DB credential scope | Cannot verify locally | PENDING EXTERNAL |
| Cross-env token/secret risk | Unknown | PENDING (JWT/APP_KEY must differ) |
| Preview data exposure | Preview has customer-like data | Deployment protection required |

Deployment protection, unique secrets and DB-role scoping are mandatory before
any Preview test. If JWT_SECRET or APP_KEY is shared with Production, tokens or
encrypted tenant keys could cross environments.

---

## 12. Local test results

| Check | Result |
|---|---|
| TypeScript typecheck | PASS |
| ESLint | PASS |
| Build flags OFF | PASS |
| Build flags ON | PASS |
| 16-combination matrix | 192/192 |
| 4D.5 Review Management | 56/56 OFF · 56/56 ON |
| 4D.6 Standee | 20/20 × 4 = 80/80 |
| Unified analytics | 9/9 |
| Historical analytics | 9/9 |
| 4D.8/4D.9 fixes harness | 0 failures; concurrency 201/409, 1 active |
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

All database-backed tests used disposable local `taprevia_4d5_`…`taprevia_4d9_`
databases. No remote database or API was used.

---

## 13. External verification still required

1. Vercel Preview/Production environment mapping and explicit `MONGODB_DB`.
2. Atlas role scoping: Preview credentials cannot access Production or
   `taprevia_backup`.
3. JWT_SECRET and APP_KEY separation.
4. Preview base URL / auth origin / deployment protection.
5. S3 bucket/prefix isolation and Preview credentials.
6. Resend disabled or restricted; no real emails.
7. Preview read-only data baseline.
8. Preview index inventory, duplicate preflight and autoIndex decision.
9. Atlas Backup snapshot/restore readiness for Preview.
10. Preview smoke and four-product tests.
11. Role `Devlopment` → Preview branch mapping confirmation.
12. Deployment-source decision (commit/push vs CLI).

Physical-device, screen-reader, live AI and external Google navigation QA also
remain NOT TESTED from earlier gates.

---

## 14. Deployment blockers

| Item | Classification |
|---|---|
| Preview DB name not explicit in local config; URI path is overridden | **VERIFICATION PENDING** (blocks deployment until Vercel scope confirmed) |
| Vercel Preview/Production env mapping unverified | **VERIFICATION PENDING** |
| DB credential/role isolation unverified | **VERIFICATION PENDING** |
| JWT/APP_KEY separation unverified | **SECURITY VERIFICATION PENDING** |
| QR generation disabled with `*.vercel.app` base URL | **PREVIEW LIMITATION / DECISION** |
| Preview autoIndex may create schema indexes | **DECISION REQUIRED** |
| Uncommitted work not deployable via Git integration | **SOURCE STRATEGY REQUIRED** |
| Preview backup/restore readiness unverified | **VERIFICATION PENDING** |
| Local `.env.preview` S3 credentials incomplete | **VERIFICATION PENDING** |
| Local `.env.preview` Resend key empty | **SAFE BY DEFAULT; verify Vercel** |
| `docs/DEPLOYMENT.md` says “Keep autoIndex=true” | **DOCUMENTATION CONFLICT** with production `autoIndex=false`; correct before use |
| Scripts print `MONGODB_URI` | **OPERATIONAL RISK**; do not run against Preview/Production |

No code-level, entitlement or backward-compatibility blocker was found.

---

## 15. Files modified

Created in Gate P1:

- `docs/PHASE_4D10_GATE_P1_PREVIEW_READINESS.md` (this document)
- `.vercelignore` — excludes `.env`, `.env.*` (except `.env.example`) and
  `.next` from CLI deployments.

No application code, schema, environment file or customer data was changed.

---

## 16. Production untouched — confirmed

No Production database/API access, no Production env change, no Production
deployment, no index creation, no migration, no customer-record change and no
outbound message. The local `.env.local` and `.env.preview` files are unchanged
by mtime.

---

## 17. Preview untouched — confirmed

No Preview database/API access, no Preview deployment, no Preview env change,
no index creation, no seed/reset, no data mutation and no email/WhatsApp/SMS.
All remote isolation and permission checks are marked pending.

---

## 18. Exact actions requiring owner approval

1. Read-only Vercel environment inspection (Preview and Production scopes).
2. Read-only Atlas role/permission and backup inspection.
3. Confirming/setting `MONGODB_DB` in Preview and Production scopes.
4. Confirming JWT_SECRET and APP_KEY separation.
5. Choosing the deployment source: approved commit/push or Vercel CLI Preview.
6. Accepting or disabling Preview autoIndex behavior.
7. Accepting the `vercel.app` base-URL QR limitation or configuring a custom
   preview domain.
8. Recording the Preview read-only data baseline.
9. Running Preview index/duplicate preflight.
10. Any Preview deployment (`vercel deploy`, never `--prod`).
11. Any feature-flag activation (one at a time, after baseline).
12. Any test that mutates Preview data (dedicated test accounts only).
13. Sending any email/notification.
14. Proceeding to Gate B or any Production action.

---

## Gate P1 conclusion

The release candidate is locally green and backward-compatible in every tested
combination. Preview deployment is **not yet safe to authorize** because the
actual Preview database selection, credential scoping and Vercel environment
mapping cannot be verified from the repository, and the current deployment
source is uncommitted.

**PREVIEW READINESS INCOMPLETE — VERIFICATION PENDING**

Wait for explicit owner approval before any Preview deployment or remote
read-only verification.
