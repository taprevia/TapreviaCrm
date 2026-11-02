# TAPREVIA — PHASE 4D.10 GATE P2.3 FINAL UNIFIED REVIEW MANAGEMENT

**Status:** LOCAL IMPLEMENTATION COMPLETE — PREVIEW CONFIGURATION VERIFICATION PENDING
**Branch:** `Devlopment`
**HEAD:** `db08e7a80c7c0b2972ebdef4841214478acfd7ae`
**Preview deployment:** NOT AUTHORIZED / NOT EXECUTED
**Remote databases / Vercel settings:** NOT ACCESSED / NOT MODIFIED
**Feature flags:** all four OFF

---

## 1. Executive summary

The fragmented review surfaces were consolidated into **one customer-facing
Review Management module** while preserving every existing data model, route,
entitlement and public review contract.

Delivered locally:

1. **Unified Review Management** — Overview, Review Settings and Analytics in
   one page, with real product rows, a working **Configure** editor, Preview,
   settings-source control and hybrid overrides.
2. **Removed the separate builder Review Assistant settings form.** The vCard
   builder now links to Review Management scoped to the exact Card
   (`/dashboard/review-management?cardId=…`), and the link auto-opens that
   Card's Configure dialog.
3. **Removed the duplicate Google Reviews settings surface** — the legacy
   `/dashboard/reviews` entry now routes review-capable customers to Review
   Management, while legacy accounts keep their previous platform destination.
4. **QR repair** — Card QR generation now falls back to the card's existing
   stable public identity (`/r/{routeSlug}` → `/{publicSlug}` →
   `/profile/{urlAlias}` → `/c/{slug}`) instead of declaring "Permanent QR
   unavailable" when only a legacy route exists. Messages now distinguish a
   missing environment base URL from a genuinely routable card.
5. **Destination repair** — product-aware destination resolution now applies to
   the legacy `/r/` fallback too, and profile Cards with only a `slug` resolve
   through the existing `/c/{slug}` shim instead of returning
   "Destination not configured".
6. **Backward compatibility** — no schema change, no record rewrite, no alias,
   UID, Standee route, NFC/QR or Google destination change, no entitlement
   change and no feature-flag activation.

Preview QR/Standee-base errors cannot be fully closed from local code: the
deployed Preview must set the approved public-base variables. That remains the
single external configuration dependency for QR verification.

---

## 2. Existing architecture findings

| Area | Before P2.3 |
|---|---|
| Dashboard navigation | `Review Management` plus a separate `Google Reviews` redirect entry |
| Builder | Profile Cards had a full `Review Assistant` tab; review Cards had only that tab |
| Review Management | General/Content/Analytics tabs, product list, source selector, Preview, hybrid dialog — but no per-instance Configure editor |
| Google Reviews | Redirect to the customer's platform destination |
| Settings | Global AI switch described as "Review Assistant" |
| Data model | Central `ReviewSettings`; per-host `reviewSettingsSource`/`reviewOverrides`; Card legacy `reviewAssistant` |
| Public routes | `/review/[alias]`, `/standee-review/[routeSlug]`, `/r/`, `/qr/`, `/c/`, `/profile/` |
| QR | Required `PUBLIC_BASE_URL` and `routeSlug`; no legacy fallback |

No P2.1/P2.2 documents existed in the repository at this HEAD.

---

## 3. Final unified architecture

```
Review Management (one module, /dashboard/review-management)
├── Overview
│   ├── product/destination/library summary
│   ├── centralized settings status + Google destination + welcome
│   └── My Review Products (real Card/Standee instances)
│       ├── settings source (Product / Central / Hybrid)
│       ├── Configure (per-instance editor)
│       ├── Preview (read-only effective settings)
│       └── Edit overrides (hybrid dialog)
├── Review Settings
│   ├── category + languages
│   ├── writing style + length (+ modes)
│   ├── feedback topics
│   └── services / employees / keywords
└── Analytics (existing unified review analytics)
```

Entry points:

- Dashboard nav: **Review Management** (capability-gated).
- vCard builder header: **Reviews** link scoped to the Card.
- Standee/card product pages: existing product management remains.
- Google Reviews nav: routes to Review Management for review-capable accounts.
- Admin Review Library: unchanged, still the template source of truth.

Public terminology is `Leave a Review`, `Write a Review`, `Generate Review`,
`Copy Review`, `Continue to Google Reviews`. "Review Assistant" remains only in
internal identifiers/schema/flag names.

---

## 4. Settings ownership matrix

| Layer | Storage | Owner UI | Notes |
|---|---|---|---|
| Business central | `ReviewSettings` | Review Management → Review Settings | One doc per business; versioned |
| Product connection | `Card/Standee.reviewSettingsSource` | My Review Products | `legacy`, `central`, `hybrid` |
| Card individual | `Card.reviewAssistant` | Configure dialog (legacy source) | Existing fields only |
| Card overrides | `Card.reviewOverrides` | Hybrid dialog | Additive, central + explicit keys |
| Standee individual | Standee social QR destination | Standee product management | Destination remains authoritative |
| Standee overrides | `Standee.reviewOverrides` | Hybrid dialog | Requires saved central settings |
| Legacy fallback | Card/Standee read paths | unchanged | Missing source = legacy |

No new collection, field, migration or index was introduced.

---

## 5. Configuration precedence

1. **Explicit account entitlement** must grant `review_ai_suggestions`.
2. **Product capability** must grant review for the assigned catalog product.
3. **Host must be active** (Card active/non-suspended, Standee assigned).
4. **Explicit disabled** (`reviewAssistant.enabled=false` in legacy, or an
   explicit disabled override) wins over inherited content.
5. **`source='legacy'`** reads the Card's own `reviewAssistant` (or the
   Standee's own Google slot for its URL).
6. **`source='central'`** reads saved central settings; the Standee's own
   Google URL stays authoritative.
7. **`source='hybrid'`** applies only explicitly saved override keys over
   central; absent keys inherit central.
8. **Missing central/invalid data** falls back to the complete legacy config.
9. **Flags** gate the customer copy flow, rotation, central public reads and
   the Standee host independently; OFF never means "enabled".

Missing values are not permission to activate. Explicitly disabled stays
disabled.

---

## 6. Old-to-new UI navigation map

| Old surface | New behaviour |
|---|---|
| Builder → Review Assistant tab | Removed; header **Reviews** link opens Review Management for that Card |
| Builder review-Card Review Assistant tab | Replaced by **Details** tab + **Reviews** link |
| `/dashboard/reviews` | Redirects review-capable users to Review Management; legacy fallback preserved |
| Settings → "AI Assistant" | Renamed **AI review generation**; master switch retained |
| Products → "enable Review Assistant" copy | Now "enable reviews in Review Management" |
| Review Management source/preview | Retained and extended with **Configure** |
| Review Library | Unchanged admin library; available categories/languages feed Review Management |
| Standee review configuration | Configure switches to hybrid overrides (central settings required) |

Legacy URLs/bookmarks are not broken; no new redirect loop was introduced.

---

## 7. QR repair findings

**Root causes addressed:**

1. `permanentCardUrl()` required `routeSlug`. Legacy/active Cards with only
   `publicSlug`, `urlAlias` or `slug` produced an empty URL and the UI showed
   "Permanent QR unavailable".
2. An empty `PUBLIC_BASE_URL` (Preview env not configured) produced the same
   message for every card, hiding the real cause.

**New behaviour:** `cardPublicQrPath()` uses the existing identities in order:

`/r/{routeSlug}` → `/{publicSlug}` → `/profile/{urlAlias}` → `/c/{slug}`

It never invents an identifier and never rewrites stored fields. The admin UI
now distinguishes:

- `Public base URL not configured` (environment issue),
- `QR unavailable` (route exists but generation failed),
- `No public route` (genuinely no identity).

Server-side QR PDF/download/copy use the same URL. No permanent QR is printed
with a temporary Preview deployment URL; the approved host remains required.

---

## 8. Standee public base URL findings

`src/lib/public-base.ts` already contains the P1.1 exact-host Preview policy:
Preview requires `VERCEL_ENV=preview`, HTTPS, an exact approved hostname, and
no wildcard/Host-header fallback. The deployed Preview currently reports the red
error because its Vercel environment does not provide the approved base/host
variables (or still runs the older deployment).

Local fixes in P2.3 clarify the message and keep the failure safe. **No code can
invent the remote hostname.** Owner must set, in the Preview scope, the same
HTTPS stable branch alias in:

- `NEXT_PUBLIC_BASE_URL`
- `PREVIEW_APPROVED_HOST`
- `NEXT_PUBLIC_PREVIEW_APPROVED_HOST`

Until then Standee QR generation is intentionally disabled rather than emitting
an unsafe URL. This is **PENDING OWNER CONFIGURATION**, not a code failure.

---

## 9. Card destination repair findings

- `/r/{routeSlug}` already used the product-aware resolver.
- The legacy fallback (`cardUid`/`slug`/`urlAlias`) redirected every card with an
  alias to `/profile/...`, and 404'd profile Cards that only had `slug`.
- `resolveCardDestination()` now supports a `slug` fallback **for profile Cards
  only** (`/c/{slug}`); review Cards still require an alias and social Cards
  still require a safe external destination.
- The legacy `/r/` branch now uses the same resolver, so review Cards with an
  alias reach `/review/...`, profile Cards reach their human/profile route, and
  social Cards keep their configured destination.
- Missing destinations still return the explicit "Destination not configured"
  404 — no invented Google URL and no unrelated profile substitution.

No stored destination, alias, UID or Google URL was modified.

---

## 10. Review generation workflow

Unchanged public contract:

1. Open `/review/{alias}` or the gated `/standee-review/{routeSlug}`.
2. Resolve owner/product/host and effective settings (respecting source/flags).
3. Customer describes their genuine experience.
4. Suggestions come from the Review Library for the configured category/language.
5. AI generation remains optional, entitlement/provider gated, and returns an
   editable draft; empty/failed provider responses do not fabricate a review.
6. Manual writing remains available.
7. Copy is explicit, idempotent and reported truthfully.
8. Google handoff opens only the configured destination; nothing is posted
   automatically.

No public copy/analytics/rotation behavior changed.

---

## 11. Product configuration workflow

For each real assigned instance, **Configure** now:

- **Card + legacy source:** opens the new per-Card editor (enable, Google URL,
  welcome, category, languages, style, length, topics, services, employees,
  keywords), saves through the existing owner-scoped `/api/cards/[id]` contract,
  and updates only that Card.
- **Hybrid source:** opens the existing hybrid override dialog.
- **Central source:** explains that Central Settings own the values and offers
  the Review Settings tab; no silent per-card mutation.
- **Standee:** Configure switches to explicit hybrid overrides (central settings
  must be saved first), using the existing standee override path.

Dialog behaviour: Save, Cancel, loading, success toast, validation errors,
unsaved-changes confirmation, revision/source safety. A save to Card A does not
touch Card B (tested).

---

## 12. Public review workflow

Public routes and their destination resolution remain compatible:

- `/review/[alias]` — Card review page.
- `/standee-review/[routeSlug]` — gated Standee host.
- `/r/[...]`, `/qr/[id]` — permanent NFC/QR routing (gate-aware).
- `/c/[slug]` — legacy printed card shim.
- `/profile/[alias]` — digital profile.

No route was removed or renamed. No existing NFC/QR/Google destination changed.

---

## 13. Entitlement verification — PASS

- Premium NFC Card, Google Review Card, NFC Plate: review-capable.
- Google Review Standee: active product + Google destination required.
- Business/lower-tier Card: review denied, including mixed accounts.
- Suspended owners, removed assignments, zero-assignment disabled Cards:
  denied.
- Existing zero-assignment review hosts / already-enabled legacy Cards:
  preserved.
- Display-name spoofing and unknown slugs do not grant access.
- Server-side enforcement remains authoritative.

Evidence: entitlement 130/130, 4D.5 57/57 (both gates), 4D.6 80/80, matrix 192/192.

---

## 14. Security verification — PASS

- Auth, ownership, tenant isolation, card/Standee isolation: PASS.
- CSRF/origin, rate limits, input validation, prototype pollution, unsafe
  redirects, token integrity/expiry/scope/replay, copy idempotency: PASS.
- Preview hostname policy remains exact-host; no wildcard/Host-header fallback.
- New Configure dialog uses the existing authenticated Card PATCH endpoint;
  lower-tier/cross-tenant writes are rejected (4D.5 and security suites).
- No credential logging or cross-database fallback introduced.

---

## 15. Backward compatibility verification — PASS

Preserved: accounts, sessions, Card IDs/UIDs/aliases/slugs, Standee routes, NFC
and QR destinations, Google URLs, profiles, assignments, entitlements, settings,
ReviewSettings, templates, rotation events, analytics, admin activation, VCF,
QR PDF, API contracts, legacy routes, zero-assignment behaviour, lower-tier
restrictions.

No record was deleted, rewritten or backfilled. Deleted-host analytics remain a
documented limitation.

---

## 16. Database compatibility verification — PASS

- No schema/field/collection/index change.
- No migration, backfill, seed, delete or remote write.
- Existing `reviewAssistant`, `reviewSettingsSource`, `reviewOverrides`,
  `ReviewSettings`, rotation and analytics documents remain readable.
- `legacySettings` is an additive response field derived from existing data.
- Deployed Preview/Production still run with `autoIndex:false`.

---

## 17. Files modified

Modified:

- `src/components/builder/builder-shell.tsx` — remove Review Assistant tab;
  add Card-scoped Review Management link.
- `src/components/review-management/review-management-client.tsx` — unified
  tabs, summary, Configure, auto-open, labels.
- `src/components/review-management/types.ts` — additive `legacySettings`.
- `src/components/review-management/hybrid-dialog.tsx` — terminology.
- `src/app/(dashboard)/dashboard/review-management/page.tsx` — `cardId` param.
- `src/app/(dashboard)/dashboard/reviews/page.tsx` — redirect to Review
  Management with legacy fallback.
- `src/app/(dashboard)/dashboard/settings/page.tsx` — terminology.
- `src/app/(dashboard)/dashboard/products/[id]/page.tsx` — terminology.
- `src/lib/services/review-product-eligibility.ts` — expose raw legacy settings.
- `src/lib/admin-card-view.ts` — QR public-route fallbacks.
- `src/lib/services/redirect-target.ts` — profile slug fallback.
- `src/app/r/[...slug]/route.ts` — product-aware legacy fallback.
- `src/app/(admin)/admin/users/[id]/page.tsx` — QR status clarity.
- `src/app/(admin)/admin/standee-qr/page.tsx` — actionable base-URL message.
- Test suites: `test-review-management.ts`, `test-security-boundaries.ts`,
  `test-phase4d9-fixes.ts`.

Created:

- `src/components/review-management/product-settings-dialog.tsx`
- `docs/PHASE_4D10_GATE_P2_3_FINAL_UNIFIED_REVIEW_MANAGEMENT.md`

---

## 18. Automated test evidence

| Suite | Command | Result |
|---|---|---|
| Typecheck | `npm run typecheck` | PASS |
| ESLint | `npm run lint` | PASS |
| Build flags OFF | `npm run build` | PASS |
| Build flags ON | `npm run build` | PASS |
| Preview config | `npm run test:phase4d10p1` | 41/41 |
| 4D.5 Review Management | `scripts/test-review-management.ts` | 57/57 OFF · 57/57 ON |
| 4D.6 Standee | `scripts/test-standee-review.ts` | 20/20 × 4 = 80/80 |
| Unified analytics | `scripts/test-review-analytics.ts` | 9/9 |
| Historical analytics | `scripts/test-phase4d9-historical.ts` | 9/9 |
| 16-combination matrix | `scripts/test-phase4d9-matrix.ts` | 192/192 |
| 4D.8/4D.9 fixes + builder | `scripts/test-phase4d9-fixes.ts` | 0 failures; 14/14 rows; 10 tabs; link present; race 201/409, 1 active |
| Security | `npm run test:security` | PASS |
| Entitlement | `npm run test:entitlement` | 130/130 |
| Review Library | `npm run test:review` | 48/48 |
| Review import | `npm run test:review-import` | 13/13 |
| Card binding | `npm run test:cards` | 49/49 |
| Dynamic routing | `npm run test:dynamic` | 29/29 |
| Standee lifecycle | `npm run test:standee` | 24/24 |
| VCF | `npm run test:vcf` | 69/69 |
| QR PDF | `npm run test:qr-pdf` | PASS |
| `git diff --check` | — | clean |

New 4D.5 assertions: product rows expose `legacySettings`; a Card save changes
only that Card.

---

## 19. Responsive test evidence

- Builder: 320/375/390/430/768/1024/1440 × dark/light, zero page overflow,
  10 tabs (Review Assistant tab absent), Reviews link present, desktop preview.
- Review Management: 320 and 1440, Overview/Review Settings/Analytics tabs,
  Configure button, 320 px dialog fits (255 px), Save visible, zero page
  overflow.
- Card-scoped query auto-opens the correct Configure dialog.
- Mobile device/NFC/screen-reader testing remains **NOT TESTED** (emulation is
  not physical evidence).

---

## 20. Manual Preview QA checklist

Use dedicated Preview test accounts; do not mutate copied real customer records.

| # | Route | Account | Action | Expected | Failure |
|---|---|---|---|---|---|
| 1 | `/login` | Admin | Sign in | Dashboard loads | Auth error |
| 2 | `/dashboard/review-management` | Premium | Open | One module, 3 tabs, products | Separate Review Assistant surface |
| 3 | same | Premium | Configure a Card | Dialog saves only that Card | Other Card changes |
| 4 | same | Premium | Preview | Effective saved settings | Missing/incorrect settings |
| 5 | same | Premium | Switch source | Central/hybrid/legacy reflected | Silent overwrite |
| 6 | `/dashboard/vcards/{id}/edit` | Premium | Open | No Review Assistant tab; Reviews link | Old settings tab |
| 7 | link | Premium | Click Reviews | Review Management opens that Card | Wrong/no Card |
| 8 | `/dashboard/reviews` | Premium | Open | Redirects to Review Management | 404/loop |
| 9 | `/review/{alias}` | Public | Open | Correct business/settings | Wrong tenant |
| 10 | same | Public | Generate/manual/copy | Editable draft; truthful copy | Fabricated review |
| 11 | same | Public | Continue to Google | Configured destination | Wrong/other URL |
| 12 | Admin user details | Admin | Card QR | QR/URL shown when base configured | Permanent QR unavailable |
| 13 | `/admin/standee-qr` | Admin | Select customer | QR renders when base configured | Red base error |
| 14 | `/r/{route}`, `/qr/{id}` | Public | Scan | Unchanged destination | 404/other tenant |
| 15 | `/c/{slug}`, `/profile/{alias}` | Public | Open | Legacy profile works | Destination not configured |
| 16 | Standee panel | Public | Open | Existing picker/slots | Missing slot |
| 17 | Review Management analytics | Premium | Open | Existing metrics | Fabricated/empty error |
| 18 | 320 px mobile | Premium | Navigate/dialog | No overflow, usable controls | Clipped |
| 19 | Lower-tier Card | Customer | Open review Management | Denied/restricted | Unauthorized access |
| 20 | Preview QR | Admin | Export QR | Approved stable host only | vercel.app temp host |

---

## 21. Known limitations

1. **Preview environment variables still required** for QR/Standee QR; local
   code cannot invent the approved hostname. Without them QR remains safely
   disabled.
2. Standee legacy settings are product-derived; individual Standee Configure
   uses hybrid overrides and requires saved central settings.
3. Review Library and Smart Rotation remain the existing admin/flag-controlled
   subsystems; no new customer rotation UI was invented.
4. Deleted-host analytics attribution remains unavailable by design (no
   persisted businessId).
5. Physical NFC, real screen-reader and live AI provider verification remain
   NOT TESTED.
6. Multi-instance duplicate-assignment residual risk remains without the
   separately approved partial unique index.

---

## 22. Remaining configuration blockers

- Vercel Preview `MONGODB_DB` explicit value.
- Preview `NEXT_PUBLIC_BASE_URL`, `PREVIEW_APPROVED_HOST`,
  `NEXT_PUBLIC_PREVIEW_APPROVED_HOST` set to the same stable HTTPS alias.
- Preview-only JWT/APP_KEY, S3 bucket/prefix, Resend restriction.
- Atlas Preview credential isolation and backup/restore readiness.
- Deployment source approval (19 uncommitted entries at HEAD `db08e7a`).
- Preview database index/duplicate preflight.

---

## 23. Deployment source and rollback plan

Current work is uncommitted on `Devlopment` at `db08e7a`. Git Preview would omit
it. Preferred: review the 19-file change set, owner-approved commit/push, then a
Vercel **Preview** build of that commit (never `--prod`), or a CLI Preview
deploy from the working tree with `.vercelignore` protection.

Rollback: redeploy the previous Preview deployment/commit; no schema or data
rollback is required. Feature flags remain OFF. If a Card setting was saved in
Preview during testing, revert that Card's `reviewAssistant` values through the
same UI; no Production data is involved.

---

## 24. Owner approvals required

1. Approve the unified Review Management UI and removal of the builder tab.
2. Set the Preview database/base-URL/host variables and restart Preview.
3. Verify Preview Vercel/Atlas/storage/email isolation.
4. Approve the commit/push or CLI Preview deployment source.
5. Approve any Preview index work separately.
6. Approve Preview QA with dedicated test accounts.
7. Approve any feature-flag activation separately.
8. Approve Production actions separately (never as part of this phase).

---

## 25. Final readiness decision

Local implementation is complete, builds pass, the unified module is functional
at 320–1440, product Configure/Preview work, QR/destination fallbacks are fixed,
and the complete regression matrix passes without data, entitlement or route
changes.

Deployed Preview QR/Standee verification still depends on the owner configuring
the approved Preview base URL/hostname and completing the external environment
checks. Therefore:

**LOCAL IMPLEMENTATION COMPLETE — PREVIEW CONFIGURATION VERIFICATION PENDING**

Stop here. No commit, push, deployment, remote database access, environment
change or feature activation occurred.
