  # Taprevia CRM — Digital vCard SaaS Platform

  A Next.js 14 full-stack platform for **NFC-enabled digital business cards** ("vCards"), inspired by the Cardexia demo set. Customers build rich mobile-first card pages, share them via NFC taps / QR / links, and manage the resulting pipeline — inquiries, appointments, products with WhatsApp ordering, media uploads, and tenant settings. An admin console manages users, physical NFC cards, and platform stats. An optional **AI Review Assistant** turns customer feedback into editable Google-review drafts (per-card, opt-in, OpenAI key shared with tenant settings).

  > **Status:** v2 rebuild complete through Phase 11 of 11 (see [Build Status & Roadmap](#build-status--roadmap)). Core flows plus the AI Review Assistant and the Vercel/Atlas/R2 hosting-hardening pass verified end-to-end (`tsc`, ESLint, DB suites, HTTP smokes green).

  ---

  ## Table of Contents

  1. [Tech Stack](#tech-stack)
  2. [Quick Start](#quick-start)
  3. [Environment Variables](#environment-variables)
  4. [Architecture & Directory Layout](#architecture--directory-layout)
  5. [Domain Model (Collections)](#domain-model-collections)
  6. [Users, Tenants & Roles](#users-tenants--roles)
  7. [Authentication, Roles & Access Control](#authentication-roles--access-control)
  8. [Features by Area](#features-by-area)
  9. [API Reference](#api-reference)
  10. [Public Routes & NFC/QR Routing](#public-routes--nfcqr-routing)
  11. [Analytics Architecture](#analytics-architecture)
  12. [Media Pipeline](#media-pipeline)
  13. [Payments, Product Assignment & Plans](#payments-product-assignment--plans)
  14. [Feature Flags & Permissions](#feature-flags--permissions)
  15. [Design System](#design-system)
  16. [Code Conventions](#code-conventions)
  17. [Scripts](#scripts)
  18. [Build Status & Roadmap](#build-status--roadmap)
  19. [Known Gaps / Open Items](#known-gaps--open-items)
  20. [Security Notes](#security-notes)

  ---

  ## Tech Stack

  | Layer      | Choice |
  |------------|--------|
  | Framework  | Next.js 14.2 App Router, React 18, TypeScript (strict) |
  | Styling    | Tailwind CSS 3 (custom dark design tokens), lucide-react icons |
  | Database   | MongoDB via Mongoose 8 (connectDB pool sized for serverless) |
  | Auth       | JWT (`jose` edge verify + `jsonwebtoken`) in http-only cookie `token`, RBAC `admin`/`customer` |
  | Validation | Zod 4 — every request body/query validated against schemas in `src/lib/validation/` |
  | Files      | **S3-compatible object store** (Cloudflare R2, free tier) with presigned direct uploads; `local` driver for dev only |
  | Hosting    | Vercel (serverless) + MongoDB Atlas M0 + Cloudflare R2 — free tier, no Docker |
  | CSV/Export | papaparse (inquiries), xlsx (admin export) |
  | Secrets    | AES-256-GCM envelope encryption for tenant secrets (OpenAI keys) |

  ---

  ## Quick Start

  ```bash
  # 1. Install deps
  npm install

  # 2. Start MongoDB locally (data lives in .data/db, gitignored)
  mkdir -p .data/db && mongod --dbpath .data/db &

  # 3. Configure environment
  cp .env.example .env.local        # defaults work for local dev

  # 4. Seed database (templates + default admin)
  npm run seed                      # → admin@taprevia.com / admin123
  # 5. Run
  npm run dev                       # http://localhost:3000
  ```

  **Quality gates used throughout development:** `npx tsc --noEmit` and `npx eslint <paths>` must both pass clean.

  ### Hosting: Vercel + MongoDB Atlas (M0) + Cloudflare R2 — free tier

  The app is serverless-ready (edge-safe middleware, cached mongoose connection, in-memory QR/vCard/CSV generation, DB-backed rate limiting). No Docker is involved — those artifacts were removed.

  ```bash
  # 1. Push to GitHub → import in Vercel (auto-detects Next.js).
  # 2. Create MongoDB Atlas M0 (free) + Cloudflare R2 bucket + R2 access keys.
  # 3. Copy existing local media into R2 once:
  #      MEDIA_DRIVER=s3 S3_BUCKET=… S3_ACCESS_KEY_ID=… S3_SECRET_ACCESS_KEY=… \
  #      S3_ENDPOINT=https://<acct>.r2.cloudflarestorage.com S3_REGION=auto \
  #      MONGODB_URI=<atlas srv> npx tsx scripts/migrate-uploads-to-r2.ts --dry-run   # then without --dry-run
  # 4. Add R2 CORS rule for the app origin: methods GET/PUT/HEAD, headers
  #    Content-Type, Authorization.
  ```

  **Vercel env** (Project → Settings → Environment Variables):
  `MONGODB_URI` (Atlas SRV), `JWT_SECRET` (fresh 64-byte value), `APP_KEY` (`openssl rand -base64 32`), `MEDIA_DRIVER=s3`, `S3_BUCKET`, `S3_REGION=auto`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_ENDPOINT=https://<acct>.r2.cloudflarestorage.com`, `NEXT_PUBLIC_BASE_URL=https://taprev.in`, `RESEND_API_KEY`, `EMAIL_FROM` (`Taprevia <no-reply@yourdomain.com>` — sender/domain pre-verified in Resend).

  DB-only scripts (`seed`, `integrity`, `test:cards`, `test:entitlement`, `migrate:*`, `backfill:*`) run against Atlas by just setting `MONGODB_URI`. HTTP suites point at the deployed URL via `SMOKE_BASE_URL`/`BASE_URL`.

  ---

  ## Environment Variables

  | Var | Purpose |
  |-----|---------|
  | `MONGODB_URI` | Mongo connection string (local default: `mongodb://localhost:27017/nfc-crm`) |
  | `JWT_SECRET` | Signs auth tokens |
  | `NEXT_PUBLIC_BASE_URL` | Public origin used in links/QR |
  | `APP_KEY` | **Required in production before saving any OpenAI key.** AES master key (`openssl rand -base64 -32`). Falls back to a JWT_SECRET-derived key in dev |
  | `MEDIA_DRIVER` | `s3` (default in `NODE_ENV=production`; **requires `S3_BUCKET`**) or `local` (dev; also used when the var is unset outside production) |
  | `UPLOAD_DIR` | Local driver root (default `.data/uploads`) |
  | `S3_ENDPOINT` `S3_REGION` `S3_BUCKET` `S3_ACCESS_KEY_ID` `S3_SECRET_ACCESS_KEY` | Cloudflare R2 values (acct-hosted endpoint, region `auto`) |
  | `AWS_REGION` `AWS_ACCESS_KEY_ID` `AWS_SECRET_ACCESS_KEY` | Canonical AWS names (take precedence, optionally used instead of `S3_*`) |
  | `RESEND_API_KEY` | Resend API key for production transactional email (password reset). Optional in dev — reset links are logged to the console instead |
  | `EMAIL_FROM` | **Required in production before sending email.** Verified sender shown to recipients, e.g. `Taprevia <no-reply@yourdomain.com>` |

  ---

  ## Architecture & Directory Layout

  ```
  src/
  ├── app/
  │   ├── (dashboard)/dashboard/     # Customer app (dark UI)
  │   │   ├── page.tsx               #   Overview: stats, recent inquiries, upcoming appts
  │   │   ├── vcards/                #   List + [id]/edit → full builder
  │   │   ├── inquiries/             #   Pipeline + notes drawer + CSV export
  │   │   ├── appointments/          #   Day-grouped bookings, transitions
  │   │   ├── orders/                #   WhatsApp product-enquiry pipeline
  │   │   ├── subscribers/           #   Newsletter subscribers + CSV export
  │   │   ├── analytics/             #   Per-card action timeseries + totals
  │   │   ├── account/               #   Profile/social links
  │   │   └── settings/              #   Tenant settings (general/OpenAI)
  │   ├── (admin)/admin/             # Admin console (users, cards, templates, standee QRs)
  │   ├── profile/[alias]/           # PUBLIC SSR vCard page (+ OG metadata)
  │   ├── review/[alias]/            # PUBLIC AI Review Assistant page
  │   ├── c/[slug]/                  # Legacy printed-card URL → redirects to /profile
  │   ├── t/[uid]/                   # NFC tap resolver → logs tap → redirects to /profile
  │   ├── media/[...key]/            # Public immutable file server
  │   └── api/                       # Route handlers (see API Reference)
  ├── components/
  │   ├── builder/                   # Builder shell, 10 tabs, live preview panel, uploader
  │   ├── dashboard/{inquiries,settings,overview}/
  │   ├── layout/                    # navbar (topbar+sidebar), shared shell
  │   ├── public/                    # vCard renderer kit: hero, banner, socials, products,
  │   │                              # gallery+lightbox, contact form, exchange modal,
  │   │                              # sticky dock, newsletter popup, business hours,
  │   │                              # template registry (profile|simple|corporate)
  │   ├── review/                    # Review-assistant flow (client page glue)
  │   └── ui/                        # Primitives: Button Input Select Switch Modal Drawer
  │                                  # DropdownMenu ToastProvider StatCard DonutChart
  │                                  # Sparkline EmptyState Badge
  ├── lib/
  │   ├── api.ts                     # ok()/fail() response helpers, typed error codes
  │   ├── auth.ts / auth-edge.ts     # requireAuth/requireAdmin + edge token verify
  │   ├── crypto.ts                  # encryptSecret/decryptSecret (AES-256-GCM)
  │   ├── db.ts                      # connectDB singleton (serverless-tuned pool)
  │   ├── rate-limit.ts              # DB-backed fixed-window check(key, limit, windowMs)
  │   ├── upload-client.ts           # browser: webp preprocess → presigned PUT (or proxy fallback)
  │   ├── services/                  # card-access, slots, whatsapp, template-access
  │   ├── storage/                   # StorageDriver iface, local.ts, s3.ts (presign GET/PUT)
  │   ├── openai.ts                  # chat-completions client (uses tenant key)
  │   └── validation/                # zod schemas: card, product, inquiry, appointment,
  │                                  # catalog, settings, media, common
  ├── models/                        # Mongoose models (see below)
  ├── types/index.ts                 # CANONICAL TS contract (ICard etc.) — single source of truth
  └── middleware.ts                  # Auth gate + role guard + CSRF + request-id logging;
                                     # whitelists /c /t /media /review /api/public
  ```

  ---

  ## Domain Model (Collections)

  Core v2 models (all `{ timestamps: true }`, registered via `mongoose.models.X || mongoose.model(...)`; the canonical TS contract lives in `src/types/index.ts`, not duplicated in schemas):

  | Model | Key fields |
  |-------|-----------|
  | **User** | name, email(uniq, lowercase), passwordHash(bcrypt, pre-save guarded against double-hash), role `admin\|customer`, status `active\|suspended`, hasStandy (bool), planId (stub, `'free'`) |
  | **Card** (single entity absorbing former `Vcard` + physical inventory) | **Physical identity**: cardUid (uniq, upper), slug, assignedUserId, status `unassigned\|active\|suspended`, totalTaps. **Digital profile**: userId, urlAlias (uniq lower), name, occupation, descriptionHtml, templateKey `profile\|simple\|corporate`, isActive, coverType/CoverStyle/coverValue, profileImageUrl, galleryImages[], themeConfig {accentColor, bgColor}, basic {firstName…defaultLanguage}, location {link\|embedded_map\|latlng}, businessHours[7], socialLinks[], banner, privacyPolicyHtml, termsHtml, config* flags, sections* toggles, **reviewAssistant {enabled, googleReviewUrl, writingStyle `friendly\|professional\|casual\|simple`, preferredLength `short\|medium\|detailed`, languages[], feedbackTopics[], welcomeMessage?}**, stats {taps} |
  | **Product** | cardId, userId, title, description, priceMinor (int), currency, imageUrl, category, active, sortOrder, enquiryCount (indexed) |
  | **Inquiry** | cardId, userId, visitor fields, attachmentUrl, source contact_form/exchange_modal/vcf_gate, status new→contacted→won/lost, notes [{text, at}] |
  | **Appointment** | cardId, userId, visitorName/Email/Phone, date (UTC midnight), slot `'h:mm AM'`, service, note, status pending→confirmed→completed / →cancelled. Partial unique index `{cardId, date, slot}` on pending+confirmed = race-safe double-book prevention |
  | **ProductEnquiry** | cardId, productId (+ title snapshot), name, note, quantity, channel whatsapp, status new→contacted→won/lost |
  | **NewsletterSubscriber** | cardId, email (unique per card) |
  | **TenantSettings** | **one per user** (userId unique): general {currency, timeFormat12h, newsletterModalDelaySeconds, inquiryAttachmentsEnabled, askDetailsBeforeDownload, enablePWA}, openai {enabled, apiKeyEnc, model}, paymentGateways (stub) |
  | **Media** | userId, category enum, key (uniq), url `/media/<key>`, bytes, width/height, mime, status `pending\|ready` (`pending` rows TTL-purged after 24h) |
  | **RateCounter** | rate-limiter fixed-window counters: key (sha256 hashed), window, hits; unique `{key, window}`, TTL-purged per window |
  | **AdminAuditLog** | admin action audit: adminId, action (e.g. `export`), resource, metadata, ip; TTL-purged after 365 days |
  | **CatalogProduct** | Admin-defined purchasable platform items: name, slug, description, category `card\|standee\|other`, priceMinor, currency, imageUrl, active, sortOrder |
  | **UserProduct** | What a customer owns: userId, catalogProductId, cardId\|standeeId, quantity, unitPriceMinor, status `active\|removed`, notes, assignedBy (admin) |
  | **Standee** | userId, name, panelQr {qrId uniq, qrColor}, socialQrs[] {qrId uniq, platform, qrColor, label} — unique QR ids |
  | **AnalyticsLog** | cardId, action `tap/vcard_download/link_click/form_submit/exchange/product_enquiry/share/review_page_view/review_started/review_generated/review_copied/review_google_clicked`, metadata, ip, userAgent, timestamp; index `{cardId, timestamp:-1}`; **TTL-purged after 180 days** |

  Legacy v1 models still present until final cleanup: `Profile`, `Lead`, `Template`, `MediaAsset`.

  ---

  ## Users, Tenants & Roles

  - **Tenancy model is *uniquely per-user*.** There are no teams/orgs — each customer `User` is its own tenant: 1:1 `TenantSettings`, per-user quotas (5 cards, per-card products), customer-scoped data (cards, inquiries, appointments, orders, media, analytics). An `admin` user is a platform operator, not a tenant.
  - **Roles:** `admin` | `customer` (default). **Status:** `active` | `suspended` (suspended = can't log in / use the app).
  - **Customers own data through `Card.userId`** (the digital-profile owner) and **physical NFC cards attach via `Card.assignedUserId`** — a customer's inventory = cards where `userId` or `assignedUserId` matches them. Staff/admin pages filter by both fields.
  - **Admins can also open the customer dashboard** (`/dashboard`), but customers can never reach `/admin` (role-checked in middleware).
  - Registration is **disabled by policy** (`/api/auth/register` returns 403) — customer accounts and standee upgrades are created/assigned by admins.

  ---

  ## Authentication, Roles & Access Control

  - **Session = http-only JWT cookie** (`token`, 7-day, `secure` in prod, `sameSite: lax`). Signed with `JWT_SECRET` (`src/lib/auth.ts`).
  - **Two check layers:**
    1. **Edge** (`src/middleware.ts`) — token presence/validity via `verifyTokenEdge`, redirects to `/login?redirect=…` for `/dashboard` & `/admin`; non-admins hitting `/admin` are bounced to `/dashboard`; static/public/API routes whitelisted (see [Public Routes](#public-routes--nfcqr-routing)). Also enforces **CSRF** (cookie-authed mutations require a same-origin `Origin` value → else 403) and stamps an `X-Request-Id` + `X-Response-Time` on every response.
    2. **Server-side** (`src/lib/auth.ts`) — every mutation re-verifies with `requireAuth` / `requireAdmin`; users are looked up fresh (role/status from DB), never trusted from the token alone.
  - **RBAC pattern:** owner-or-admin ownership checks on every mutation (`Card.userId`/`assignedUserId` match the caller, or `user.role === 'admin'`); admins bypass with explicit role checks, never implicit.
  - **Feature gating** (settings, OpenAI, review assistant, standee) is honored server-side too — e.g. the review generator refuses when `reviewAssistant.enabled` or tenant `openai.enabled` is false.

  ---

  ## Features by Area

  ### Customer dashboard (dark theme)
  - **Overview** — greeting, stat tiles (taps / active vCards / inquiries), recent inquiries, upcoming appointments, horizontal vCard strip, quick actions.
  - **vCards** — grid with cover/avatar previews, taps counter, template badge, create modal (5-card quota `MAX_CARDS_PER_USER`), delete cascade.
  - **Builder** (`/dashboard/vcards/[id]/edit`) — left rail tabs + sticky live preview:
    Basic · About · Cover & Photos (uploads) · Gallery · Socials (reorderable) · Business Hours (copy-Monday) · Theme (accent/bg pickers w/ contrast preview) · Template · Products (CRUD + image upload) · Review Assistant (enable, Google review URL, writing style, preferred length, languages, feedback topics, welcome message, `<QR>` access to `/review/[alias]`).
    Debounced autosave sends only dirty sections; alias editor with live availability check (`check-alias`) + suggestion chips.
  - **Inquiries** — filter bar (search/status/source/vCard), transition buttons enforcing state machine, notes drawer (note on fresh inquiry auto-advances new→contacted), CSV export mirroring filters.
  - **Appointments** — range pills + custom dates, UTC-safe day grouping, within-day chronological sort, confirm/cancel/complete transitions.
  - **Product Enquiries** — WhatsApp enquiry log with same pipeline UX; rows show product snapshot + price.
  - **Virtual Backgrounds** — upload grid, hover overlay Set-as-cover (any vCard) / delete.
  - **Standees** — per-standee panel QR + social QRs (rendered once admin has granted a standee via `hasStandy`).
  - **Subscribers** — newsletter list + CSV export.
  - **Analytics** — per-card action timeseries + totals over selectable windows (see [Analytics Architecture](#analytics-architecture)).
  - **Account** — profile/social links.
  - **Settings** — general (time format, newsletter delay), AI section (paste/replace/clear OpenAI key — encrypted at rest, never echoed).

  ### Public portal (per-vCard theming via scoped CSS vars `--v-accent/--v-bg`)
  Three templates (profile/simple/corporate): hero w/ cover styles, save-contact (RFC-6350 VCF gated download), socials row, products grid → **WhatsApp deep-link ordering** (no payment gateway, by design), services, gallery + lightbox, contact form, exchange-modal lead capture, business hours, newsletter popup (configurable delay), banner CTA, sticky dock (share/VCF/tap-save).

  ### AI Review Assistant (per-card, opt-in)
  On `/review/[alias]` (mobile-first, themed like the vCard): branded welcome message → select feedback topics → describe the experience in their own words (≥20 chars) → choose language → generate an editable AI draft (with regenerate + length adjust) → copy → "Continue to Google Reviews". The API rewrites only the customer's genuine input — it never invents facts, ratings, staff, or positive sentiment; selected topics are context only. Requires **Settings → OpenAI** enabled on the owner's tenant. Funnel is tracked privacy-consciously via `review_page_view/review_started/review_generated/review_copied/review_google_clicked` (no review text stored).

  ### Admin console (`/admin`, role-gated — admins only)
  - **Overview** — KPI totals: users (split admin/customer), cards by status (active/unassigned/suspended), inquiries + new, appointments + upcoming, products, product enquiries, newsletter subscribers, media files/bytes; recent inquiries; quick links.
  - **Users** — list with role badges + status, create account, suspend/activate. **Standee upgrade** per user (`POST/DELETE /api/admin/users/[id]/standy`) creates a `Standee` (panel QR + social QRs) and sets `hasStandy`.
  - **Cards** — physical NFC inventory: provision `cardUid` + slug, bind/assign to a customer (sets `assignedUserId`, status `active`), suspend/unassign.
  - **Templates** — legacy HTML card templates.
  - **Products / Catalog** — platform catalog (`CatalogProduct`: cards, standees, other) and **assignment to customers** → creates `UserProduct` (auto-assigns matching NFC card / standee, `assignedBy` = admin). This is the platform's monetization backoffice.
  - **Standee QR** — generate printable standee QR sheets.
  - **Export** — CSV: users / leads / inquiries via `GET /api/admin/export?type=…`.
  - Fully dark-reskinned.

  ---

  ## API Reference

  Envelope convention: success `{...data}` via `ok(data, status?)`; errors `{ error, code?, details? }` via `fail(status, code, message, details?)`. Auth = http-only cookie. Pagination: `{items, meta:{page,limit,total,totalPages}}`.

  ### Auth
  | Method | Route | Notes |
  |--------|-------|-------|
  | POST | `/api/auth/login` | email+password → sets cookie |
  | POST | `/api/auth/logout` | clears cookie |
  | GET | `/api/auth/me` | current user |
  | POST | `/api/auth/register` | disabled-by-policy path |

  ### Cards (the digital profile — historically "vCards")
  | Method | Route | Notes |
  |--------|-------|-------|
  | GET / POST | `/api/cards` | list own (paginated) / create (403 QUOTA at 5) |
  | GET / PATCH / DELETE | `/api/cards/[id]` | deep-partial patch incl. nested merges (basic/location/banner/config/sections/themeConfig/**reviewAssistant**), businessHours normalized mon-first, urlAlias uniqueness 409; DELETE cascades products/inquiries/appointments/enquiries/subscribers + unbinds cards |
  | GET | `/api/cards/check-alias?alias=&excludeId=` | `{available, suggestion?, reason?}`; reserved words blocked |

  ### Products
  | Method | Route |
  |--------|-------|
  | GET / POST | `/api/cards/[id]/products` (30-per-card quota) |
  | PATCH / DELETE | `/api/products/[id]` (delete also removes its Media object) |

  ### Inquiries & Appointments (owner-scoped)
  | Method | Route | Notes |
  |--------|-------|-------|
  | GET | `/api/inquiries` | filters search/status/source/cardId |
  | PATCH | `/api/inquiries/[id]` | `{status, note?}`; legal: new→contacted\|lost; contacted→won\|lost; terminal locked |
  | GET | `/api/inquiries/export` | CSV, cap 5000 |
  | GET | `/api/appointments` | filters status/cardId/from/to |
  | PATCH | `/api/appointments/[id]` | pending→confirmed\|cancelled; confirmed→completed\|cancelled |

  ### Product Enquiries
  | Method | Route |
  |--------|-------|
  | GET | `/api/product-enquiries` (filters status/cardId, populated product+card) |
  | PATCH | `/api/product-enquiries/[id]` (same transition map as inquiries) |

  ### Settings / Analytics / Uploads
  | Method | Route | Notes |
  |--------|-------|-------|
  | GET / PATCH | `/api/settings` | deep one-level merge; numeric guards (delay 0–60); `openai.apiKey` write-only ('' clears) |
  | GET | `/api/analytics?cardId=&from=&to=` | contiguous daily timeseries per action + totals (max 366d) |
  | POST | `/api/uploads/presign` | auth, 30/min; validates category/type/size + ownership → returns `{mode:'direct', uploadUrl, key, headers}` (object store) or `{mode:'proxy'}` (local driver) |
  | POST | `/api/uploads/confirm` | auth; after a successful direct PUT, marks the `pending` Media row `ready` (final meta) |
  | POST | `/api/uploads` | **proxy fallback** (local dev only): multipart file+category(+cardId); sharp re-encode + real byte-sniffing (avatar 512² webp q82; others ≤1600w q80); caps 8MB img / 10MB other |
  | GET | `/api/uploads` | own-media listing (category/cardId/mime filters) |
  | DELETE | `/api/uploads?key=` | ownership-checked, best-effort object delete |

  ### Public (no auth, rate-limited)
  | Method | Route |
  |--------|-------|
  | GET | `/api/public/cards/[alias]` (full render payload) |
  | POST | `/api/public/cards/[alias]/inquiries` |
  | POST | `/api/public/cards/[alias]/newsletter` |
  | GET | `/api/public/cards/[alias]/vcf` (gated download → logs analytics) |
  | GET | `/api/public/cards/[alias]/appointments/slots?date=YYYY-MM-DD` |
  | POST | `/api/public/cards/[alias]/appointments` (11000 → 409 'Slot just taken') |
  | POST | `/api/public/cards/[alias]/product-enquiries` → `{whatsappUrl}` (null if no phone) |
  | POST | `/api/public/reviews/[alias]/generate` | Zod `{feedback ≥20 chars, topics?, language?, length?}`; 10/min per IP; requires card `reviewAssistant.enabled` + tenant OpenAI enabled; returns `{review}`; logs `review_generated` (tuning metadata only) |
  | POST | `/api/public/track` |

  ### Admin
  `/api/admin/overview`, `/api/admin/users[/id]`, `/api/admin/users/[id]/products[/.../card]`, `/api/admin/card-templates`, `/api/admin/catalog[/id]`, `/api/admin/standee-qr`, `/api/admin/export?type=…`

  ### Analytics / Track
  | Method | Route | Notes |
  |--------|-------|-------|
  | POST | `/api/public/track` | fire-and-forget: parses `{alias, action}` or `{cardUid, action}` → resolves cardId → writes AnalyticsLog (+ `$inc` taps); unknown actions silently skipped |

  ### Legacy (still live, slated for cleanup)
  `/api/leads*`, `/api/profile/*`, `/api/public/card/[slug]/*`

  ---

  ## Public Routes & NFC/QR Routing

  **Public route map** (from `src/middleware.ts` whitelist — no auth token required; `/api/public/*` additionally rate-limited):

  | Route | Kind | Purpose |
  |-------|------|---------|
  | `/`, `/login`, `/register` | page | landing + auth screens |
  | `/profile/[alias]` | page | SSR vCard page, force-dynamic; `generateMetadata` emits OG/Twitter tags from card data; wraps renderer in `.vcard-root` with inline CSS vars (auto text-on-accent + dark-bg surface adjustments) |
  | `/review/[alias]` | page | AI Review Assistant (mobile-first, themed): disabled/invalid → unavailable state/404; else full feedback→draft→copy→Google flow |
  | `/c/[slug]` | page | Printed-card shim: direct `urlAlias`/`slug` hit → 307 `/profile/<alias>`; else matches physical `cardUid` → redirect; else 404 |
  | `/t/[cardUid]` | redirect | **NFC tap resolver**: uppercase UID match → logs `tap` (server-side AnalyticsLog + `$inc stats.taps` when card active) → 302 `/profile/<alias>?src=nfc`; unknown/error → `/` |
  | `/media/<userId>/<yyyy-mm>/<uuid>.<ext>` | asset | Public immutable serve; remote drivers **302-redirect** to a short-lived presigned GET; local driver streams from disk. Strict key grammar + traversal guard |
  | `/api/public/*` | API | card payload, inquiries, newsletter, vcf, appointment slots/book, product-enquiries, **review generate**, track |

  Everything else is behind auth (`/dashboard/*`, `/admin/*`; `/c/`, `/profile/`, `/t/`, `/media/`, `/review/`, `/api/public/` are always public even with a stale token cookie).

  **QR code flows** (`qrcode` package, `src/utils/qr.ts`, rendered into PNG/data-URL):
  - **NFC tap** → `/t/<cardUid>` → `src=nfc` on the profile (prints as physical card QR).
  - **Profile share/download QR** → `/profile/<alias>` (public portal "download QR" section).
  - **Review Assistant access QR** (builder tab) → `/review/<alias>`.
  - **Standee QRs** → `Standee.panelQr` (links card) + per-platform `socialQrs[]` (admin-generated, printed on counter standees).

  ---

  ## Analytics Architecture

  - **Store:** append-only `AnalyticsLog` rows (cardId, action, metadata, ip, userAgent, timestamp; indexed `{cardId, timestamp:-1}`); per-card tap counter `Card.stats.taps` (`$inc`) denormalized for cheap previews.
  - **Writers:** server-side events = `tap` (via `/t/[cardUid]` resolver) and `review_generated` (via the review API — stores tuning metadata only, **never review text**). All remaining actions are client-dispatched **fire-and-forget** (`navigator.sendBeacon`/fetch, no await) to `POST /api/public/track`, which parses `{alias, action}` or `{cardUid, action}`, resolves to a cardId, and writes; unknown actions are silently skipped.
  - **Reader:** `GET /api/analytics?cardId=&from=&to=` runs a Mongo aggregation grouping by `{day, action}`, then **zero-fills a contiguous UTC-day series** (default 30 days, max 366) so charts never show gaps. Owner or admin only. The dashboard renders per-action lines + totals via `src/components/dashboard/analytics/action-meta.ts` (label/color per action).
  - **Privacy-tuned for reviews:** the funnel tracks only *funnel* events (`review_page_view … review_google_clicked`); review content stays on-device/Google, never in logs.
  - **Retention:** rows are TTL-purged after 180 days (time-series index `{timestamp:1}` on `AnalyticsLog`).

  ---

  ## Media Pipeline

  1. `POST /api/uploads/presign` (auth, 30/min) → validates category/type/size + ownership, then either returns a **presigned PUT URL** (object store, production) or `{mode:'proxy'}` (local).
  2. Direct path: the browser processes images (orientation applied, 512² avatar cover-crop / ≤1600w no-upscale, webp q80–82 — mirroring the old sharp defaults), PUTs bytes straight to the store (bypasses the serverless request-body cap), then `POST /api/uploads/confirm` marks the Media row `ready`. Proxy path: legacy multipart `POST /api/uploads` with real byte-sniffing via sharp.
  3. Key `${userId}/${UTC yyyy-mm}/${uuid}.<ext>` → driver putObject → Media meta row (`status pending→ready`; orphaned `pending` rows TTL-purged after 24h).
  4. `GET /media/[...key]` — remote drivers **302-redirect** to a short-lived presigned GET (no bytes through a function); local dev proxies from disk. Drivers behind `StorageDriver` interface: **local** (UPLOAD_DIR under cwd, resolve+startsWith traversal guard) or **s3** (@aws-sdk/client-s3, lazy client init). Driver selected by `MEDIA_DRIVER`; production defaults to `s3` (Vercel's filesystem is non-persistent) and requires `S3_BUCKET`. R2 bucket needs a CORS rule allowing `GET/PUT/HEAD` with `Content-Type`/`Authorization` for the app origin.
  5. Deletes free quota immediately (meta deleted even if object deletion errors).

  ---

  ## Payments, Product Assignment & Plans

  - **No payment/billing integration — by design.** Customer-facing "ordering" is **WhatsApp deep-link only** (public product grid → `WA.me` prefilled enquery; logged as `ProductEnquiry`). There is no checkout, no gateway, no Stripe/PayPal.
  - **Platform monetization = admin backoffice assignment.** Admins define purchasable items in the **Catalog** (`CatalogProduct`: cards, standees, other) and **assign them to customers** → a `UserProduct` (`status active|removed`, `assignedBy` = admin), which auto-assigns the matching NFC `Card` (`assignedUserId`, `status active`) or `Standee` and flips `User.standy` flags. No money moves in-code; payment happens offline.
  - **"Plans" are quota constants, not billing:** `MAX_CARDS_PER_USER = 5`, `MAX_PRODUCTS_PER_CARD = 30`. Exceeding → `403 FORBIDDEN` with `QUOTA`-style messages ("Upgrade your plan…").
  - **Stubs / unused:** `User.planId` (default `'free'`) and `TenantSettings.paymentGateways Map` are scaffolding — not enforced anywhere.

  ---

  ## Feature Flags & Permissions

  Where capability is gated (enforced **server-side**, not just hidden in UI):

  - **Roles/permissions:** `admin` vs `customer`; owner-or-admin ACL on every mutation; `/admin/*` edge-guarded; admins double as customers (`/dashboard`).
  - **Card lifecycle:** `isActive` (published/hidden), `status` (physical card), ownership `userId`/`assignedUserId`.
  - **Per-card publish toggles:** `templateKey` (profile/simple/corporate); `sections.*` (`header`, `contact`, `businessHours`, `map`, `banner`, `newsletterPopup`); `config.*` (`displayLocalization`, `displayDownloadQrIcon`, `displayQrSection`, `displayAddToContact`, `hideStickyBar`, `displayWhatsAppShare`, `qrDownloadSize`); `reviewAssistant.enabled` (turns `/review/[alias]` on, 404/unavailable otherwise).
  - **Tenant settings flags:** `openai.enabled` (review assistant + any future AI), `general.*` (`currency`, `timeFormat12h`, `newsletterModalDelaySeconds`, `inquiryAttachmentsEnabled`, `askDetailsBeforeDownload`, `enablePWA`).
  - **User flags:** `status active|suspended`, `hasStandy` (standee access granted by admin).
  - **Pages/views:** 404/unavailable states for private or feature-disabled routes; forms disabled client-side reflect server truth after a failed request.

  ## Design System

  Dark-first tokens in `tailwind.config.ts`: `bg, bg-raised, surface, field, ink, ink-mute, ink-faint, line, line-subtle, accent(-400/-500/-600), ok, warn, bad, shadow e1–e3/pop`. Light-styled base primitives are darkened at call sites via twMerge-safe overrides (established pattern across all pages).

  Per-card theming: public page computes luminance → sets `--v-bg/--v-accent/--v-on-accent` (+ dark-surface overrides when bg is dark) consumed by every public component.

  Fonts: Geist Sans/Mono wired as CSS vars. Animations: `animate-fade-in`, `animate-slide-in` staggered nav.

  ---

  ## Code Conventions

  - **Types**: `src/types/index.ts` is canonical; models mirror it; validation schemas in `src/lib/validation/*` define the exact accepted wire shapes.
  - **Models**: default-export `mongoose.models.X || mongoose.model('X', Schema)`, timestamps on.
  - **Auth**: `requireAuth(request)` / `requireAdmin(request)` → `AuthUser | null`; respond `fail(401,'UNAUTHORIZED',…)`. Ownership = load → 404 → compare `userId` → 403 (admin bypass).
  - **Validation**: zod `safeParse`; failures return flattened fieldErrors. Query enums reject invalid values with 400 rather than ignoring.
  - **Rate limiting**: fixed-window counters in the `ratecounters` Mongo collection (TTL-purged) — works across serverless instances; fail-open if the store is unreachable.
  - **No comments unless essential**; ESLint (`next/core-web-vitals`) + tsc strict kept green at every step.

  ## Adding a Card Template (code-only)

  Card templates are registered **in code only** — the admin "Templates" page is a
  permission-grant matrix, not a template editor. To add a new layout:

  1. **Write the renderer** — a client component in `src/components/public/`
     (e.g. `panthevent-template.tsx`) that receives `{ vcard: IVcard, products: IProduct[] }`
     and renders every editable string/image/link from the `vcard` object (never hardcoded).
     Reuse platform primitives (`hero.tsx`, `socials-row.tsx`, `sticky-dock.tsx`,
     `exchange-modal.tsx`) where possible.
  2. **Register the component** — add the import and add a `panthevent`-style key to the
     `CARD_TEMPLATES` map in `src/components/public/template-registry.tsx`. The registry is a
     server component; keep it that way by importing the client template (do not add
     `'use client'` to it).
  3. **Add metadata** — append an entry (`{ key, name, description }`) to `CARD_TEMPLATE_META`
     in `src/lib/card-templates.ts` so pickers/headings can describe it.
  4. **Add any template-specific data fields** end-to-end: the interface on `ICard`
     (`src/types/index.ts`), the Mongoose schema (`src/models/Card.ts`), the update validation
     (`src/lib/validation/card.ts`), the PATCH allow-list (`src/app/api/cards/[id]/route.ts`),
     and — so the builder autosaves them — a `DirtyOwner` + canonical sanitizer in
     `src/lib/hooks/use-card-draft.ts`.
  5. **Add a builder tab** (if the template introduces user-editable content) — a tab component
     under `src/components/builder/tabs/`, registered in the `TABS` array and
     `renderActivePanel()` in `src/components/builder/builder-shell.tsx`.

  `TemplateKey` is `'profile' | 'simple' | 'corporate' | (string & {})`, so new keys need no
  type changes. Run `npm run typecheck` and `npm run lint` (and `npm run build` for route
  additions) before considering the template done.

  ---

  ## Scripts

```bash
npm run dev                          # next dev
npm run build && npm start           # production build/serve
npm run lint / typecheck             # eslint / tsc --noEmit
npm run preflight                    # lint + typecheck + entitlement + cards + integrity
npm run seed                         # templates + admin@taprevia.com/admin123 (DB scripts honor MONGODB_URI)
npm run integrity                    # data-integrity report (collections, gaps, invariants)
npm run test:cards / test:entitlement / test:auth   # DB-level suite (auth covers rate-limit 429s)
npm run smoke / smoke:dynamic        # HTTP suites; set MONGODB_URI + BASE_URL / SMOKE_BASE_URL
npx tsx scripts/migrate-bind-assigned-cards.ts      # backfill assigned-card bindings (idempotent)
npx tsx scripts/migrate-uploads-to-r2.ts [--dry-run] # copy local uploads into R2 (idempotent)
```

  **Quality gates:** `npx tsc --noEmit` and `npx eslint <paths>` must pass clean; `npm run build` is used as the final integration check for route additions.

  ---

  ## Build Status & Roadmap

  | Phase | Scope | Status |
  |-------|-------|--------|
  | 0 | Repo recon, conventions | ✅ |
  | 1 | Dark foundations, primitives, models, validation libs, migration script | ✅ |
  | 2 | vCard CRUD APIs, public APIs, SSR portal, /c shim, /t resolver, list page | ✅ smoke-tested |
  | 3–4 | Full builder (10 tabs + live preview + autosave) | ✅ |
  | 5 | Inquiries + Appointments (APIs + pages) | ✅ |
  | 6 | Products manager + WhatsApp enquiry flow + Orders page | ✅ |
  | 7 | Media pipeline (local+S3), uploads API, Virtual Backgrounds | ✅ |
  | 8 | Tenant Settings incl. encrypted OpenAI key | ✅ |
  | 9 | Admin dark conversion | ✅ reskin only — see gaps |
  | 10 | AI Review Assistant (config + public flow + OpenAI API + analytics + QR) | ✅ |
  | 11 | Hosting readiness: Vercel + MongoDB Atlas M0 + Cloudflare R2 (presigned direct uploads, serverless-safe media serve, DB-backed rate limiting, export caps, log TTLs) | ✅ verified locally |

  **End-to-end smoke results (all passing):** login (after double-hash fix) · vCard create/patch(themeConfig)/delete-cascade · public payload + SSR render marker · /c redirect chain · tap fallback · inquiry capture→list · upload→webp→media serve→traversal block · hours→slots(end-exclusive)→book→double-book-reject→confirm→illegal-block · product→WhatsApp log (null URL sans phone, correct) · analytics series · settings get/patch. Test artifacts cleaned up after run.

  ---

  ## Known Gaps / Open Items

1. **Ops** — set a real `APP_KEY` in production before storing any OpenAI key (rotating it invalidates previously stored encrypted keys); R2 migration + live-bucket smoke still pending your R2/Atlas credentials (dry-run verified).
2. **AI cost guardrails** — the review funnel relies on OpenAI requests capped only by the per-IP rate limit; no per-account daily token budget yet. Tenant OpenAI `enabled` is account-wide, not feature-scoped.
3. **Legacy cleanup** — v1 models (`Profile`, `Lead`, `MediaAsset`, etc.) and legacy routes still present until final removal; `scripts/` currently ships `seed.ts` + `migrate-bind-assigned-cards.ts` + `migrate-uploads-to-r2.ts` (the older `migrate-v2.ts` flow is superseded — settle on one migration story).
4. **Admin console** — card inventory/template/catalog management is functional but light on bulk operations (e.g. batch assign).

  ---

  ## Security Notes

- Passwords bcrypt(12) with double-hash pre-save guard; JWT http-only SameSite cookie, edge-verified middleware, RBAC route guards.
- All mutations ownership-checked server-side; admins explicitly bypass with role check.
- **CSRF guard** on cookie-authed mutations (same-origin `Origin` required) + `X-Request-Id`/`X-Response-Time` tracing headers.
- Uploads: browser-side image preprocess + byte sniffing on the proxy path, size caps, filename randomization, path-traversal guards on both write and serve paths.
- OpenAI keys encrypted AES-256-GCM; ciphertext never leaves the server (`hasApiKey` boolean only).
- Rate limits on public + auth write endpoints, stored in MongoDB (works across serverless instances), fail-open.
- `.data/` (DB files + uploads) gitignored; no secrets committed.
