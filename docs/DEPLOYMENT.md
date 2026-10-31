# Deploying Taprevia CRM to Production

Target topology: **Vercel serverless** (Next.js App Router, `next@14.2.35`) +
**MongoDB Atlas** + **Cloudflare R2** (or any S3-compatible store) + **Resend**
(email). There is no Docker/`output: 'standalone'` configuration — the project
is built and served by `next start`.

> Note: `next@14.2.35` is EOL. A tracked migration to `next@15`/`react@19`
> lives in `docs/next15-migration-track.md` — plan it after launch.

---

## 1. Required environment variables

Set these in **Project → Settings → Environment Variables** (Vercel) *before*
importing the project. `MONGODB_URI` and `JWT_SECRET` are read at module scope,
so `next build` **fails hard** if either is missing and `NODE_ENV=production`.

| Variable | Required | Purpose |
| --- | --- | --- |
| `MONGODB_URI` | ✅ (build + runtime) | MongoDB Atlas SRV string. Read by `src/lib/env.ts`/`db.ts` at build. |
| `MONGODB_DB` | ✅ Preview; recommended Production | Explicit database name; overrides the URI path. Preview fails closed when missing. Production defaults to `test`. |
| `PREVIEW_APPROVED_HOST` / `NEXT_PUBLIC_PREVIEW_APPROVED_HOST` | Preview only | Exact approved Preview hostname for QR/NFC generation. Never set in Production. |
| `JWT_SECRET` | ✅ (build + runtime) | JWT signing secret, **≥ 24 chars**. Generate fresh: `openssl rand -base64 32`. Never reuse the dev value. |
| `APP_KEY` | ✅ (runtime) | AES-256-GCM key that decrypts per-tenant secrets (OpenAI API keys). Generate: `openssl rand -base64 32`. Required to *read* any previously encrypted key. |
| `NEXT_PUBLIC_BASE_URL` | ✅ (runtime) | Public origin baked into QR/NFC permanent URLs. E.g. `https://taprevia.com`. **Changing it later breaks printed QR routes.** |
| `MEDIA_DRIVER` | ✅ (`s3`) | `s3` in production. Unset + prod defaults to `s3` and then requires `S3_BUCKET`. |
| `S3_BUCKET` / `S3_REGION` / `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY` | ✅ (runtime) | Object store credentials (or canonical `AWS_*` spellings). |
| `S3_ENDPOINT` | ✅ for R2 | `https://<account-id>.r2.cloudflarestorage.com` (forces path-style). |
| `RESEND_API_KEY` | ✅ (runtime) | Resend API key for forgot-password emails. |
| `EMAIL_FROM` | ✅ (runtime) | Verified sender, e.g. `Taprevia <no-reply@yourdomain.com>`. |
| `NEXT_PUBLIC_WHATSAPP_NUMBER` | optional | Marketing-site WhatsApp CTA number (E.164 digits). |
| `IMAGE_HOSTS` | optional | Comma-separated hosts for `next/image` remotePatterns (media renders via `<img>`, usually unset). |
| `PORT` | optional | Only when running non-default port. |

Referenced-but-forgotten footguns: `NODE_ENV` is set by the platform; do not
override it. Any deployment SSR/edge runtime reading `APP_KEY` must have it —
missing `APP_KEY` turns into 500s on `/api/settings` and review flows, not a
clean startup error.

## 2. Database (MongoDB Atlas)

Indexes are declared in Mongoose schemas. Development connections may create
them automatically (`autoIndex`), but **production disables `autoIndex` and
`autoCreate`**. Build every required index explicitly with `mongosh` in an
approved maintenance window after preflighting duplicate keys:

```javascript
// Unique/permanent-route indexes (build these FIRST — unique builds need an
// empty or de-duplicated collection):
db.cards.createIndex({ routeSlug: 1 }, { unique: true, sparse: true });
db.cards.createIndex({ publicSlug: 1 }, { unique: true, sparse: true });
db.users.createIndex({ bizSlug: 1 }, { unique: true, sparse: true });
db.users.createIndex({ customerId: 1 }, { unique: true, sparse: true });
db.media.createIndex({ key: 1 }, { unique: true });
db.standees.createIndex({ "panelQr.qrId": 1 }, { unique: true });
db.standees.createIndex({ "socialQrs.qrId": 1 }, { unique: true, sparse: true });
db.standees.createIndex({ routeSlug: 1 }, { unique: true, sparse: true });
db.standees.createIndex({ publicSlug: 1 }, { unique: true, sparse: true });
db.profiles.createIndex({ "standeeQr.qrId": 1 }, { unique: true, sparse: true });
db.newslettersubscribers.createIndex({ cardId: 1, email: 1 }, { unique: true });
db.ratecounters.createIndex({ key: 1, window: 1 }, { unique: true });

// Smart Review Rotation (create BEFORE setting SMART_REVIEW_ROTATION_ENABLED=true;
// the feature stays disabled by default and is not required for existing review flows):
db.reviewrotationevents.createIndex(
  { businessId: 1, categoryKey: 1, templateId: 1, cycle: 1 },
  { unique: true }
);
db.reviewrotationevents.createIndex({ copyId: 1 }, { unique: true });
db.reviewrotationevents.createIndex({ businessId: 1, categoryKey: 1, copiedAt: -1 });
db.reviewrotationstates.createIndex({ businessId: 1, categoryKey: 1 }, { unique: true });

// Central Review Management (additive Phase 4D.2):
db.reviewsettings.createIndex({ businessId: 1 }, { unique: true });

// Review feature gates (both default OFF; rotation requires both):
//   NEW_REVIEW_COPY_FLOW_ENABLED=true  → two-button customer copy experience
//   SMART_REVIEW_ROTATION_ENABLED=true → rotation exclusions/tokens/recording
// Copy flow OFF + rotation ON is intentionally inert (server warning) because
// no active customer path would record rotation copies. Create the indexes above
// before enabling rotation. No production activation is authorized by this document.
//
// Flag matrix:
//   copy OFF, rotation OFF → existing UI/API, no tokens, no exclusions
//   copy ON,  rotation OFF → two-button UI, no tokens, no rotation events
//   copy OFF, rotation ON  → effective rotation OFF (same as both OFF)
//   copy ON,  rotation ON  → full Phase 4C copy + rotation flow
//
// CENTRAL_REVIEW_PUBLIC_INTEGRATION_ENABLED=false
//   When OFF (default), public review reads remain strictly legacy even if a
//   Card is configured as central/hybrid. When ON, the effective-settings
//   resolver may apply saved ReviewSettings and product overrides.
//
// STANDEE_REVIEW_ASSISTANT_ENABLED=false
//   When OFF (default), every existing Google Review Standee /r/... and /qr/...
//   destination keeps its current Google/profile/panel behavior exactly.
//   When ON, eligible Google Review Standees route their EXISTING printed
//   QR/NFC URLs to /standee-review/{routeSlug}. The Standee's own Google URL is
//   preserved; central content never replaces it unless a hybrid override
//   explicitly sets the URL.
//
//   The payloads printed by Taprevia are /r/{routeSlug} and
//   /r/{routeSlug}/{slot} (or legacy /qr/{qrId}), so no reprint is required
//   for Taprevia-generated Standee QR codes. A QR code that directly encodes
//   an external Google URL cannot be changed remotely; document a reprint /
//   opt-in path for those separately.
//
//   Production indexes required for attribution + unified analytics:
//     db.analyticslogs.createIndex({ standeeId: 1, timestamp: -1 });
//     db.analyticslogs.createIndex({ cardId: 1, action: 1, createdAt: -1 });
//     db.analyticslogs.createIndex({ standeeId: 1, action: 1, createdAt: -1 });
//     db.reviewrotationevents.createIndex({ businessId: 1, copiedAt: -1 });
//   (The review settings/rotation indexes above are already required.)
//
// PHASE 4D.5 RELEASE PREREQUISITES (all flags remain OFF by default):
//   1. Deploy code with all three review flags OFF.
//   2. Preflight duplicates and create/verify ALL indexes above.
//   3. Run post-deploy smoke tests with flags OFF.
//   4. Enable CENTRAL_REVIEW_PUBLIC_INTEGRATION_ENABLED only after approval.
//   5. Enable copy flow/rotation separately after their own QA.
//   6. Confirm production CatalogProduct PREMIUM_NFC_CARD uses the canonical
//      slug `premium-nfc-card`; never infer entitlement from display names.
//   7. Audit zero-assignment, already-enabled profile Cards before approving
//      any stricter revocation policy. 4D.5 preserves active legacy access and
//      blocks NEW lower-tier enablement; it does not revoke existing access.
//   8. Complete real-device touch/keyboard/screen-reader QA.
//
// Duplicate preflight, index verification, monitoring and rollback details:
// docs/REVIEW_MANAGEMENT.md §18.7.
//
// Post-activation smoke (authorized operator):
//   GET /api/review-management              → 200, saved settings/revision
//   GET /api/review-management/products     → eligible Card products only
//   GET /api/review-management/preview      → source/effective settings correct
//   GET /review/<central-card-alias>        → 200 only when the gate is ON
//   POST /api/public/reviews/<alias>/suggestions → 200
//   PATCH settings with a stale revision    → 409, no write
//   Confirm no 5xx/E11000 spikes and no unexpected fallback-source increase.
//
// High-read/scan hot paths:
db.cards.createIndex({ urlAlias: 1 });
db.cards.createIndex({ userId: 1 });
db.cards.createIndex({ assignedUserId: 1 });
db.cards.createIndex({ status: 1 });
db.products.createIndex({ cardId: 1, sortOrder: 1 });
db.products.createIndex({ userId: 1 });
db.inquiries.createIndex({ userId: 1, createdAt: -1 });
db.leads.createIndex({ cardOwnerId: 1, createdAt: -1 });
db.media.createIndex({ userId: 1, createdAt: -1 });
db.media.createIndex({ userId: 1, category: 1 });

// TTL collectors (drop + re-create to apply fresh TTLs):
db.analyticslogs.createIndex({ timestamp: 1 }, { expireAfterSeconds: 15552000 }); // 180d
db.adminauditlogs.createIndex({ createdAt: 1 }, { expireAfterSeconds: 31536000 }); // 365d
db.producttitlelogs.createIndex({ createdAt: 1 }, { expireAfterSeconds: 31536000 }); // 365d
db.media.createIndex(
  { createdAt: 1 },
  { expireAfterSeconds: 86400, partialFilterExpression: { status: "pending" } }
); // pending upload rows purge after 24h
db.ratecounters.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
db.passwordresetokens.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
```

Collection names are lowercased model names (`newsletterSubscribers` →
`newslettersubscribers`, `passwordResetToken` → `passwordresetokens`). Confirm
exact names with `show collections` in your target DB. Deployed Production **and
Preview** run with `autoIndex:false`/`autoCreate:false`; never rely on startup
to create indexes. Create them explicitly through the approved index procedure.
Only isolated local development keeps automatic index creation.

## 3. Object storage (Cloudflare R2 / S3) CORS

Direct browser uploads (`PUT` to a presigned URL) require a CORS rule on the
bucket **allowing the app origin**. In the R2 dashboard: **Bucket →
Settings → CORS policy**; for AWS: bucket policy + `cors.json`. Minimal R2
policy:

```json
[
  {
    "AllowedOrigins": ["https://your-app.vercel.app", "http://localhost:3000"],
    "AllowedMethods": ["GET", "PUT", "HEAD"],
    "AllowedHeaders": ["Content-Type", "Content-Length", "Authorization", "x-amz-*"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3600
  }
]
```

- `GET` is also needed even though serving uses presigned-read URLs (some
  clients preflight).
- `HEAD` is used by the confirm step (`storage.headObject`) to verify size and
  content-type before a `pending` media row is marked `ready`.
- Keep `PUT` scoped to `https:` origins only — a `*` origin would let any site
  write to your bucket keys (keys are unguessable UUIDs, but don't rely on it).
- The served domain is the R2 bucket endpoint (`https://your-domain.r2.dev` or
  a custom CNAME), not `pub-*.r2.dev`.

## 4. Verification

Pre-deploy, from the repo root:

```bash
cp .env.example .env.local   # fill values
npm ci
npm run typecheck
npm run lint
npm run build                # fails fast if MONGODB_URI/JWT_SECRET missing
```

CI on `main`/PRs already runs lint, typecheck, integrity, a Mongo-backed test
suite, and a production build + HTTP smoke check (`.github/workflows/ci.yml`),
so a green CI is a strong signal. After the first successful deploy, run these
**post-launch smoke tests** against the live origin:

```bash
# Home + marketing pages render
curl -s -o /dev/null -w "%{http_code}\n"  $BASE/            # 200
curl -s -o /dev/null -w "%{http_code}\n"  $BASE/privacy     # 200
curl -s -o /dev/null -w "%{http_code}\n"  $BASE/contacts    # 200

# Auth flow — login/register pages reachable, /api/health answers
curl -s -o /dev/null -w "%{http_code}\n"  $BASE/login       # 200
curl -s $BASE/api/health                                    # {"ok":true,...}

# A public card resolves (use a real alias) — expects a 200 or redirect
curl -s -o /dev/null -w "%{http_code}\n"  $BASE/c/<alias>

# Static media asset (uploaded image URL) — expect immutable-cached 200
curl -s -o /dev/null -w "%{http_code}\n"  $BASE/media/<key>

# Reserved public surfaces must NOT be intercepted by auth middleware
curl -s -o /dev/null -w "%{http_code}\n"  $BASE/qr/<id>     # 302 (or 200)
curl -s -o /dev/null -w "%{http_code}\n"  $BASE/r/<slug>    # 302 (or 404)
```

Authenticated checks (login as a real account):

- **Card builder upload** — upload an avatar in the vCard builder. Confirm the
  object lands in R2 (`List` in the dashboard) and the `/media/<key>` URL
  serves. Delete it — confirm the object is removed from the bucket (no
  orphan).
- **Card delete cascade** — create/populate a card (avatar, cover, gallery,
  product images), delete it, and confirm *no* objects remain in R2 under that
  user's prefix.
- **Direct-upload size gate** — craft a `POST /api/uploads/presign` for a
  10MB+ image (category `avatar`), PUT it, then `POST /api/uploads/confirm` —
  confirm rejects with `File too large` and removes the stray object.
- **Password reset** — request a reset; the email arrives via Resend and the
  one-time link works once before expiring.

## 5. Launch checklist (last mile)

- [ ] Marketing merge committed atomically on `main` (old `src/app/page.tsx`
      deleted together with `src/app/(public)/`, `src/components/marketing/`,
      `src/lib/marketing/`, `src/types/marketing.ts`, `public/`).
- [ ] `MONGODB_URI`, `JWT_SECRET`, `APP_KEY` set in Vercel env **before** first
      build.
- [ ] S3/R2 bucket + CORS rule applied; `MEDIA_DRIVER=s3` and credentials set.
- [ ] Resend domain verified (DNS/DKIM/SPF); `RESEND_API_KEY` + `EMAIL_FROM`
      set; first reset email actually delivered.
- [ ] `NEXT_PUBLIC_WHATSAPP_NUMBER` set to the live number.
- [ ] CI green on the deploy commit; smoke tests in §4 pass against the live
      origin.
- [ ] Consider adding `src/app/robots.ts` + `sitemap.ts` for the marketing
      site and a custom `not-found.tsx`/`error.tsx` (currently Next defaults).
- [ ] Schedule the `next@15` migration track (`docs/next15-migration-track.md`).
## Index changes

Production connections run with `autoIndex: false` and `autoCreate: false`.
Application startup must never create or alter indexes/collections. Apply index
changes only through an explicitly approved maintenance window using reviewed
commands (for example, the statements earlier in this document), after checking
for duplicate keys. Development may keep automatic index creation for local work.
