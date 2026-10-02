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
| `JWT_SECRET` | ✅ (build + runtime) | JWT signing secret, **≥ 24 chars**. Generate fresh: `openssl rand -base64 32`. Never reuse the dev value. |
| `APP_KEY` | ✅ (runtime) | AES-256-GCM key that decrypts per-tenant secrets (OpenAI API keys). Generate: `openssl rand -base64 32`. Required to *read* any previously encrypted key. |
| `NEXT_PUBLIC_BASE_URL` | ✅ (runtime) | Public origin baked into QR/NFC permanent URLs. E.g. `https://taprev.in`. **Changing it later breaks printed QR routes.** |
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

Indexes are declared in Mongoose schemas and are created automatically the
first time each model is used (via `autoIndex`). For a large existing
collection, build the critical ones explicitly with `mongosh` before switching
traffic:

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
exact names with `show collections` in your target DB. Keep
`autoIndex=true` so new index definitions in code still apply on deploy.

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