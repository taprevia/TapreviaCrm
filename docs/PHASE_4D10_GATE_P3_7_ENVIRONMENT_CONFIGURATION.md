# TAPREVIA — PHASE 4D.10 GATE P3.7
# ENVIRONMENT CONFIGURATION

**Branch:** `Devlopment` · **HEAD:** `db08e7a80c7c0b2972ebdef4841214478acfd7ae`
**Architecture:** production variables are managed in Vercel; local files are
not the production source of truth.

## 1. Variable inventory (names only; no values)

| Variable | Class | Required? | Purpose |
|---|---|---|---|
| `MONGODB_URI` | server runtime | **yes** | Primary MongoDB connection |
| `JWT_SECRET` | server/edge runtime | **yes** | Session and review-rotation tokens |
| `APP_KEY` | server runtime | **feature-critical** | AES encryption of tenant AI keys |
| `MONGODB_DB` | runtime | production explicit/Vercel | Database name selection |
| `MONGODB_BACKUP_URI` / `MONGODB_BACKUP_DB` | runtime | optional | Dedicated backup connection |
| `MEDIA_DRIVER` / `UPLOAD_DIR` | runtime | optional | Local/S3 media selection |
| `RESEND_API_KEY` / `EMAIL_FROM` | runtime | optional | Password-reset email |
| `IMAGE_HOSTS` | build/runtime | optional | next/image remote allowlist |
| `NEXT_PUBLIC_BASE_URL` | build/public | recommended | Public absolute URLs |
| `NEXT_PUBLIC_WHATSAPP_NUMBER` | build/public | optional | Public WhatsApp link |
| `VERCEL_ENV` / `VERCEL_OIDC_TOKEN` | platform | Vercel-supplied | Deployment context |

No secret value was printed, copied or written to a report.

## 2. Defect P36-D07 and repair

**Before:** missing `MONGODB_URI` caused a request-time 500 because middleware
imported the full env schema through `auth-edge`.

**Repair:**
1. `requireJwtSecret()` now validates only `JWT_SECRET`; it no longer requires
   database configuration at module import.
2. `auth.ts` / `auth-edge.ts` resolve the secret lazily instead of at import.
3. `db.ts` resolves `MONGODB_URI`/database names lazily inside the connection
   functions, so `next build` does not need runtime-only variables.
4. Added `src/instrumentation.ts` with a production Node startup gate:
   missing/invalid `MONGODB_URI` or `JWT_SECRET` logs names/reasons only and
   exits before serving.
5. `/api/health` reports `503 config=invalid` with variable names only if the
   startup gate is bypassed.
6. Missing `APP_KEY` no longer produces a generic 500 on AI-key save; the
   settings API returns `503 UNAVAILABLE` with a clear action.
7. `experimental.instrumentationHook` enabled in `next.config.mjs`.

## 3. Test matrix (actual)

| Scenario | Result |
|---|---|
| All required variables present | health **200**, login **200** |
| Production build with **no runtime env** (`MONGODB_URI`/`JWT_SECRET`/`APP_KEY` empty) | **PASS** (`next build` exit 0) |
| Missing `MONGODB_URI` | process **exits**, clear startup log |
| Invalid `MONGODB_URI` | process **exits**, clear startup log |
| Missing/blank `JWT_SECRET` | process **exits**, clear startup log |
| Missing `APP_KEY` | server healthy; general settings **200**; AI key save **503** |
| Missing AI key | generate **503** controlled |
| Missing email config | forgot-password **200** generic |
| Recovery with valid config | login **200**, health **200** |
| Secrets in error/log | none (names/reasons only) |

## 4. Vercel compatibility

- Build-time validation is explicitly skipped during
  `phase-production-build`, so a Vercel build does not require runtime-only
  secrets in the build environment.
- Runtime validation runs only in the Node server runtime.
- Vercel-managed values are read from `process.env`; no local `.env` file is
  required or modified.
- If a required runtime variable is absent in a deployment, the server exits
  before serving rather than running half-configured.

## 5. Remaining limitation

No actual Vercel deployment was performed or inspected (prohibited). The local
production-mode simulation is the verification boundary.

**P3.7 INCOMPLETE — REQUIRED VERIFICATION GAPS REMAIN**

