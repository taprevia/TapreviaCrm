# Taprevia NFC-CRM — Full Backward Compatibility Audit

**Date:** 2026-11-02  
**Mode:** Read-only scan — no code, environment, or customer-data changes  
**Project:** `/Users/prince/Documents/CRM`  
**Branch:** `Devlopment`  
**Current commit:** `0191bc1889c95e5716afa2f8f67a991ac131c101` — “update review system”  
**Previous commit:** `db08e7a80c7c0b2972ebdef4841214478acfd7ae` — “review system update”  
**Worktree:** clean (`git status` 0 entries)  
**Database inspected:** `127.0.0.1:27017/nfc-crm` (local only)  
**Production/preview/Atlas:** not accessed

---

## 1. Version comparison

| Item | Result |
|---|---|
| Current branch | `Devlopment` |
| Current HEAD | `0191bc1` |
| Parent | `db08e7a` |
| Worktree | Clean |
| Change set vs parent | **231 files changed, 22,997 insertions, 2,759 deletions** |
| Production version comparison | **NOT TESTED / UNVERIFIED** |

The current branch includes a very large recent change set: Central Review Management, unified review routing, Premium review actions, Review Library import hardening, password-reset OTP, password-reset UI, API validation hardening, PVC/price presentation changes, and many new tests/docs.

**Production version cannot be identified from this environment.** The branch must not be assumed to represent production. Comparisons below are against the previous local commit and recovery checkpoints, not production.

Recovery checkpoints inspected:

- `CentralLocal-pre-20261102-170541`
- `ReviewImport-pre-20261102-153424`
- `CRM-Audit-final-20261102-143841`
- `PhaseG-final-20261102-125235`

They are local snapshots, not verified production releases.

---

## 2. Overall compatibility matrix

| Area | Status | Notes |
|---|---|---|
| Existing MongoDB reads | **PASS** | All inspected collections hydrate through current Mongoose models |
| Existing users/auth records | **PASS** | All 15 users readable; all stored password hashes are full bcrypt hashes |
| Existing cards/profile URLs | **PASS with legacy gaps** | Active customer cards readable; some QA/unassigned rows lack optional legacy fields |
| Existing product assignments | **PASS** | 20 assignments readable; 18 active, 2 removed; no missing catalogProductId |
| Premium entitlement | **PASS** | Premium grants `review_ai_suggestions`; live Premium API returns `review.eligible=true` |
| Lower-tier entitlement | **PASS** | Business NFC Card does not gain review entitlement |
| Central Review Management | **PASS with intentional restrictions** | Central ON works locally; legacy rollback while Central ON is intentionally blocked for connected products |
| Central OFF / legacy restore | **PASS** | Isolated suites restore legacy without data loss |
| Review Library | **PASS** | 1 category, 110 templates; all required fields present; importer tests pass |
| Review copy & redirect | **PASS** | Shared handler opens the resolved destination only after confirmed copy; denial blocks redirect |
| All-in-One 3/4 Standees | **PASS in synthetic tests; live flow blocked by missing URLs** | Routing and shared flow verified with synthetic Standees |
| NFC/QR routing | **PASS (partial)** | Pure/synthetic routing verified; live HTTP tap routes not exercised to avoid analytics writes |
| API paths/methods | **PASS** | No endpoint path/method removals found |
| API response contracts | **PASS with intentional changes** | Additive fields; invalid-payload/error responses intentionally tightened |
| Admin/customer UI smoke | **PASS** | Admin Products, Review Library, Users, User Detail, Dashboard Products, Review Management, Settings, Standees loaded without errors |
| Security/tenant isolation | **PASS** | Existing security boundary tests pass; local override production gates pass |
| Production behavior | **NOT TESTED** | No production/preview access. Production comparison unverified |

---

## 3. Findings

### BCA-01 — Central ON blocks legacy mode switching for connected products

| Field | Detail |
|---|---|
| Severity | Medium |
| Affected feature | Central Review Management |
| Previous behavior | A connected central/hybrid product could be switched back to `legacy` via the product connection API. |
| Current behavior | When Central is effective for the tenant and the product is central/hybrid, `source: "legacy"` returns `400 VALIDATION_ERROR` and writes nothing. |
| Evidence | `src/lib/services/review-product-connection.ts:108–124` |
| Regression? | **No — intentional policy change.** |
| Customer impact | Connected products cannot return to product-specific mode while Central is ON. Existing legacy settings and overrides remain stored. Turning Central OFF restores legacy behavior. |
| Recommended fix | None. If rollback is required, turn Central OFF or change policy explicitly. |
| Tests | `test-central-review-authority.ts`: 19/19 Central ON; `test-review-management.ts` Central ON: 17/20 with 3 expected policy failures. |
| Rollback risk | Low. No customer data is rewritten by the blocked request. |

---

### BCA-02 — Local force-all changes local effective source

| Field | Detail |
|---|---|
| Severity | Low |
| Affected feature | Local Central Review development override |
| Previous behavior | Unconnected legacy products remained legacy even when Central was ON. |
| Current behavior | With `CENTRAL_REVIEW_LOCAL_FORCE_ALL=true` and local Mongo, legacy-source eligible products resolve to Central locally. |
| Evidence | `src/lib/services/review-rollout.ts:121–176`; `src/lib/services/review-effective-settings.ts:32–65` |
| Regression? | **No — intentional local-only override.** |
| Customer impact | Local testing only. Production/preview/Atlas are explicitly gated out by runtime and Mongo-host checks. |
| Recommended fix | None locally. Keep the override out of production. |
| Tests | `test-local-central-force.ts` force-ON 14/14; force-OFF 6/6; production/preview/remote gates 3/3. |
| Rollback risk | None for stored data; disabling the flag restores opt-in behavior. |

---

### BCA-03 — Standee review gate enabled locally

| Field | Detail |
|---|---|
| Severity | Low |
| Affected feature | Standee review hosting |
| Previous behavior | `STANDEE_REVIEW_ASSISTANT_ENABLED` was unset locally; all standee review hosts returned unavailable. |
| Current behavior | Gate is ON in local `.env.local`; capability-eligible standees with a Google URL enter `/standee-review/[slug]`. |
| Evidence | `.env.local` (ignored); `src/lib/services/review-standee-settings.ts:293,380`; `src/lib/review-feature-flags.ts:30` |
| Regression? | **No — intentional local activation.** |
| Customer impact | Local only. Non-review standees remain excluded by capability. Google Review Standee and All-in-One 3/4 are capability-eligible when configured. |
| Recommended fix | None. Verify production/preview flags remain unchanged. |
| Tests | Synthetic All-in-One 3/4 browser/route tests; `test-standee-review.ts` Standee ON/Central OFF 20/20. |
| Rollback risk | Setting the flag false restores prior unavailable behavior; no data change. |

---

### BCA-04 — Review Library import rejects invalid payloads before writes

| Field | Detail |
|---|---|
| Severity | Medium |
| Affected feature | Admin Review Library import |
| Previous behavior | Some semantic failures could return `200` with per-item `errors[]`, after valid records had already been written. |
| Current behavior | Invalid, duplicate, missing-relationship, and empty payloads return `400` with structured details; no writes occur. Valid import response remains `{ imported, skipped, errors }`. |
| Evidence | `src/app/api/admin/review-library/import/route.ts:77,84–88,116–119,199`; `src/lib/review-library-import-payload.ts` |
| Regression? | **No — intentional all-or-nothing behavior.** |
| Customer impact | Import clients must handle `400` for invalid payloads. Existing valid exports import normally. |
| Recommended fix | Update any external import client that assumed `200` for invalid rows. |
| Tests | `test-review-import-payload.ts` 15/15; `test-review-import-repair.ts` 17/17 (standalone); earlier transaction run 17/17 on a replica set. |
| Rollback risk | No data loss; import is non-destructive. |

---

### BCA-05 — VCF download now validates contact details

| Field | Detail |
|---|---|
| Severity | Medium |
| Affected feature | Public vCard download / inquiry capture |
| Previous behavior | Name/email/phone were truncated and accepted; missing contact returned 428. |
| Current behavior | Contact is normalized and validated; malformed name/email/phone returns `400 VALIDATION_ERROR`. |
| Evidence | `src/app/api/public/cards/[alias]/vcf/route.ts:62–75`; `src/lib/validation/vcf-contact.ts` |
| Regression? | **No — intentional security/validation hardening.** |
| Customer impact | Legacy clients submitting malformed contact data may now be rejected. Valid downloads remain unchanged. |
| Recommended fix | Update any legacy client that sends malformed VCF contact data. |
| Tests | `test-security-boundaries.ts` (VCF public identifier, validation helpers); `test-phase3-hardening.ts` 24/24. |
| Rollback risk | Do not revert blindly; this is a security/validation fix. |

---

### BCA-06 — Unauthenticated API requests now return JSON 401

| Field | Detail |
|---|---|
| Severity | Low |
| Affected feature | Middleware/auth boundary |
| Previous behavior | Invalid/missing token redirected every protected path to `/login`, including API paths. |
| Current behavior | `/api/*` paths return `401 {"error":"Unauthorized","code":"UNAUTHORIZED"}`; browser pages still redirect. |
| Evidence | `src/middleware.ts:144–155` |
| Regression? | **No — intentional API/security improvement.** |
| Customer impact | API clients gain correct machine-readable status. Legacy clients expecting a redirect may need adjustment. |
| Recommended fix | None. Document the 401 behavior for API consumers. |
| Tests | `test-security-boundaries.ts`; `test-phase3-hardening.ts`; API smoke/UI checks. |
| Rollback risk | Reverting would restore an insecure/incorrect API redirect. |

---

### BCA-07 — `UserProduct.material` default removed

| Field | Detail |
|---|---|
| Severity | Low |
| Affected feature | Product assignment / PVC policy |
| Previous behavior | Missing `material` defaulted to `'pvc'`. |
| Current behavior | New assignments omit material unless explicitly metal/wooden; existing stored values remain readable. |
| Evidence | `src/models/UserProduct.ts:60–64`; `src/lib/services/user-product-assignment.ts:81–90,212`; `src/lib/validation/catalog.ts:73–74` |
| Regression? | **No — intentional PVC removal from new assignments.** |
| Customer impact | UI treats missing material as optional. Existing assignments with material remain intact. |
| Recommended fix | None. Existing `material: 'pvc'` records are preserved. |
| Tests | `test-pvc-product-visibility.ts` 9/9; live assignment scan: 20 assignments, 0 PVC, all material-optional reads OK. |
| Rollback risk | Low; re-adding a default would change new-write behavior only. |

---

### BCA-08 — Production JWT secret must be 24–512 characters

| Field | Detail |
|---|---|
| Severity | Medium (configuration prerequisite) |
| Affected feature | Authentication |
| Previous behavior | Any non-empty production JWT secret was accepted. |
| Current behavior | Production requires 24–512 characters; otherwise auth/runtime configuration fails closed. |
| Evidence | `src/lib/env.ts:62–78` |
| Regression? | **No — intentional security hardening.** |
| Customer impact | A short production JWT_SECRET would fail authentication/startup. Local `.env.local` secret is compatible. |
| Recommended fix | Verify production JWT_SECRET length before deployment. Do not shorten or revert the policy. |
| Tests | `test-phase3-hardening.ts`; environment/health checks; local auth reads. |
| Rollback risk | Reverting would weaken a security control. |

---

### BCA-09 — Search terms are literal and capped at 100 characters

| Field | Detail |
|---|---|
| Severity | Low |
| Affected feature | Admin/customer search |
| Previous behavior | User input was used as a regex and had no explicit length cap. |
| Current behavior | Regex metacharacters are escaped; terms over 100 chars return `400 VALIDATION_ERROR`. |
| Evidence | `src/lib/search.ts:9–30`; `src/app/api/cards/route.ts:31–37`; `src/app/api/admin/users/route.ts:25–31` |
| Regression? | **No — intentional security hardening.** |
| Customer impact | Normal searches unchanged. Very long search strings now fail clearly. |
| Recommended fix | None; update exotic clients if needed. |
| Tests | `test-security-boundaries.ts`; UI smoke; `test-phase3-hardening.ts`. |
| Rollback risk | Low; reverting would restore regex-injection risk. |

---

### BCA-10 — Legacy/QA rows with missing optional fields

| Field | Detail |
| Severity | Low |
| Affected feature | Legacy cards/standees |
| Previous behavior | Older/QA records lacked some optional fields. |
| Current behavior | Current Mongoose reads succeed. Cards without `kind` fall back to profile; missing source means legacy. Standees without route/uid cannot enter route-based review hosting. |
| Evidence | Live DB scan: 15 cards, 7 standees, 20 assignments; 2 QA standees missing route/uid; 2 QA cards missing userId; 7 cards missing reviewAssistant/source fields. |
| Regression? | **No confirmed regression — historical data gap.** |
| Customer impact | Active customer cards with complete aliases/ownership read and route correctly. QA/unassigned rows remain legacy gaps. |
| Recommended fix | Owner-approved data cleanup only; do not auto-backfill. |
| Tests | Read-only live schema scan; `test-phase4d10p2-backward-compat.ts` 11/11 OFF/ON; `test-security-boundaries.ts`. |
| Rollback risk | None; no writes were made. |

---

### BCA-11 — Live All-in-One standees have no Google Review URL

| Field | Detail |
|---|---|
| Severity | Low (data/config gap) |
| Affected feature | All-in-One review flow |
| Previous behavior | Same records already had empty Google slots. |
| Current behavior | Product is review-capable and routing support exists, but review host returns unavailable until a Google URL is saved. |
| Evidence | Live standees `mvz27lv9bo` (3-profile) and `mvz27lvg8e` (4-profile), Google slot `destinationUrl: ""`. `src/lib/services/review-standee-settings.ts` resolves by platform. |
| Regression? | **No — data not configured.** |
| Customer impact | The two live AIO standees cannot use review flow until the customer configures the Google slot. Setup UI exposes the field correctly. |
| Recommended fix | Customer/admin configures the existing Google Review slot URL. No code change required. |
| Tests | Synthetic AIO 3/4 with URLs: routing and browser copy/redirect PASS; live setup UI shows both slot layouts. |
| Rollback risk | None; no customer data changed. |

---

### BCA-12 — Existing Standee suite has Central-ON policy failures

| Field | Detail |
|---|---|
| Severity | Low (test expectation) |
| Affected feature | Standee regression suite |
| Previous behavior | Suite expected connected products to switch to legacy while Central ON. |
| Current behavior | Test returns `legacy 400` under Central ON, cascading to 2 additional 409 checks. |
| Evidence | `test-standee-review.ts`, expected legacy rollback; BCA-01 policy. |
| Regression? | **No — stale test expectation, not product regression.** |
| Customer impact | None. |
| Recommended fix | Update the suite’s Central-ON expectations; keep Central-OFF legacy rollback coverage. |
| Tests | Standee ON/Central OFF 20/20; Standee ON/Central ON 17/20. |
| Rollback risk | None. |

---

### BCA-13 — Premium Builder Google Reviews tab added

| Field | Detail |
|---|---|
| Severity | Info |
| Affected feature | Premium NFC Card builder |
| Previous behavior | Premium profile builder had no review entry; product-detail page had a review section. |
| Current behavior | Premium profile builder keeps all profile tabs and adds an entitlement-gated “Google Reviews” tab. |
| Evidence | `src/components/builder/builder-shell.tsx:170,236–269,380`; `src/components/builder/tabs/review-management-link-tab.tsx:100–214` |
| Regression? | **No — intentional additive feature.** |
| Customer impact | Lower-tier cards do not get the tab; review-only builders remain unchanged. |
| Recommended fix | None. |
| Tests | Browser: tab visible, profile tabs kept, lower-tier excluded, review-only unchanged, responsive 390/1280 no overflow. |
| Rollback risk | Low; additive UI. |

---

### BCA-14 — Shared Copy & Continue action and destination fallback

| Field | Detail |
|---|---|
| Severity | Info |
| Affected feature | Public review copy/redirect |
| Previous behavior | Legacy page used an anchor that opened Google immediately and copied asynchronously; copy-flow two-button path was gated by a flag. |
| Current behavior | A single shared “Copy & Continue to Google Reviews” action waits for copy success, then opens the resolved URL; failure blocks redirect; blocked popups fall back same-tab. |
| Evidence | `src/components/review/review-assistant.tsx:799,918,1295,1338`; `src/lib/services/review-settings-resolver.ts:431–444,481,501` |
| Regression? | **No — intentional fix.** Old exact copy-anchor UI test may need updating. |
| Customer impact | Review pages without a URL still support manual copy. Invalid URLs are not opened. |
| Recommended fix | None. Update any UI test asserting the removed “Continue to Google Reviews” anchor. |
| Tests | Browser Premium/GRC/Plate: exact edited text passed to Clipboard API, Google opened; clipboard denied: no redirect + error. Destination matrix 8/8. |
| Rollback risk | Low; stored URLs/settings untouched. |

---

### BCA-15 — PVC/price presentation changes

| Field | Detail |
|---|---|
| Severity | Info |
| Affected feature | Product discovery / pricing UI |
| Previous behavior | Product prices were shown; PVC-named products could appear in new assignment options. |
| Current behavior | Product price output removed from UI; PVC hidden from new listings/assignment selectors; pricing fields/data remain in API/DB. |
| Evidence | `src/lib/marketing/product-visibility.ts`; `src/app/api/admin/catalog/route.ts:23–31`; prior price/PVC UI changes. |
| Regression? | **No — intentional presentation change.** |
| Customer impact | Existing PVC assignments/data remain; only new discovery is hidden. |
| Recommended fix | None. Do not remove pricing fields. |
| Tests | `test-pvc-product-visibility.ts` 9/9; `test-price-ui-removal.ts` 5/5; admin catalog 11 canonical + 6 legacy preserved. |
| Rollback risk | Low; data untouched. |

---

### BCA-16 — Password-reset OTP endpoints added; legacy reset remains

| Field | Detail |
|---|---|
| Severity | Info |
| Affected feature | Authentication/password reset |
| Previous behavior | Token-based forgot/reset endpoints and pages. |
| Current behavior | New OTP endpoints and updated forgot-password UI; legacy `/api/auth/forgot-password` and `/api/auth/reset-password` remain. |
| Evidence | New routes under `src/app/api/auth/password-reset/`; legacy routes present. |
| Regression? | **No — additive.** |
| Customer impact | Existing reset links/endpoints still exist. New OTP path is additional. |
| Recommended fix | None. |
| Tests | **NOT TESTED** in this audit; OTP suite requires server/mock provider. |
| Rollback risk | Low; additive routes. |

---

### BCA-17 — Settings GET no longer creates a tenant document

| Field | Detail |
|---|---|
| Severity | Low |
| Affected feature | Dashboard settings |
| Previous behavior | GET `/api/settings` created missing TenantSettings. |
| Current behavior | GET returns defaults without creating a document; PATCH still persists. |
| Evidence | `src/app/api/settings/route.ts:61–67` |
| Regression? | **No — intentional non-mutating read.** |
| Customer impact | Response shape unchanged; fewer accidental writes. |
| Recommended fix | None. |
| Tests | UI smoke `/dashboard/settings`; read-only DB scan. |
| Rollback risk | Low. |

---

## 4. Database compatibility

Read-only live scan (`127.0.0.1:27017/nfc-crm`):

| Collection | Count | Compatibility |
|---|---:|---|
| users | 15 | PASS — required fields present; 15/15 full bcrypt hashes |
| cards | 15 | PASS with legacy gaps — active customer cards readable; some QA/unassigned rows lack optional fields |
| standees | 7 | PASS with legacy gaps — 2 QA rows lack route/uid; active customer standees readable |
| userproducts | 20 | PASS — 18 active, 2 removed; no missing catalogProductId; material optional |
| catalogproducts | 17 | PASS — 11 canonical + 6 legacy/QA preserved |
| reviewsettings | 1 | PASS — schemaVersion 1; general/content present |
| reviewcategories | 1 | PASS — required fields present |
| reviewtemplates | 110 | PASS — required fields present |
| analyticslogs | 16 | PASS — model reads |
| leads/inquiries/productenquiries | 0 | PASS — empty, model reads |

All tested models hydrate historical documents without cast/validation errors:
User, Card, Standee, UserProduct, CatalogProduct, ReviewSettings, ReviewCategory, ReviewTemplate, AnalyticsLog, Lead, Inquiry.

No destructive migration is required for the inspected data.

---

## 5. NFC/QR compatibility

| Route / product | Status | Evidence |
|---|---|---|
| `/review/[alias]` — Premium, Review Card, Plate | PASS | Synthetic and live browser tests (destination, copy) |
| `/r/[routeSlug]` — cards | PASS (pure) | `resolveCardDestination` / p27 routing tests |
| `/qr/[id]` — cards | PASS (pure) | p27/security routing checks |
| `/panel/[route]` — multi-profile standee | PASS | Synthetic AIO 3/4 route tests |
| `/standee-review/[slug]` — AIO 3/4 | PASS with synthetic data | Browser/route tests |
| AIO panel QR | PASS | Panel QRs preserved to `/panel/...` |
| Google slot QR — AIO | PASS with synthetic data | Redirects to `/standee-review/...` |
| Non-Google slots — AIO | PASS | Instagram/WhatsApp destinations unchanged |
| Dedicated Google Review Standee | PARTIAL | Capability supported; live standee has no Google URL |
| Existing live AIO review pages | NOT TESTED (data gap) | Live Google slots empty; no customer data changed |

**Important:** The current local standee gate enables review hosting for capability-eligible standees. Business Profile/other non-review standees remain excluded. The Standee panel QR no longer gets hijacked into the review host for multi-profile products.

Live `/r` and `/qr` HTTP tests were intentionally not run against the customer database to avoid analytics/tap writes. Pure routing and isolated synthetic HTTP tests were used instead.

---

## 6. Review Management compatibility matrix

| Configuration | Result |
|---|---|
| Central OFF | PASS — legacy behavior preserved |
| Central ON | PASS with intentional connected-product legacy-switch block |
| Local force-all ON | PASS local; production/preview/remote gates OFF |
| Local force-all OFF | PASS — legacy/opt-in restored |
| Legacy source | PASS |
| Central source | PASS |
| Hybrid source | PASS — overrides preserved |
| Missing central settings | PASS — complete legacy fallback |
| Existing product-specific Google URL | PASS — used when central effective URL is empty |
| Explicit empty hybrid override | PASS — respected, no legacy fallback |
| Missing/invalid destination | PASS — no unsafe redirect; manual copy path |
| Existing review entitlement | PASS — Premium and review-capable standees retained; lower-tier excluded |

Intentional Central-ON restrictions are documented separately in BCA-01 and BCA-12.

---

## 7. Product entitlement compatibility

| Check | Result |
|---|---|
| Premium NFC Card includes Review Management | PASS — `review_ai_suggestions` in catalog |
| Existing Premium assignment eligible | PASS — live API `review.eligible=true` |
| New Premium assignment eligible | PASS — current assignment logic grants via active product |
| Lower-tier NFC card does not gain review | PASS — Business NFC Card review API returns `null` |
| Review-enabled Standee eligibility retained | PASS with configured URL; live AIO missing URL |
| Ineligible products restricted | PASS |
| Existing assignments silently changed | PASS — no assignment/card/standee writes |

---

## 8. API compatibility

### Preserved

- Existing endpoint paths and HTTP methods.
- Existing authentication/session contract, except unauthenticated API now returns JSON 401.
- Existing valid Review Library import response shape.
- Existing valid product, user, card, review, settings and VCF response fields.
- Additive fields only on card/product/review responses (`preview`, `canonicalPublicUrl`, `review`, etc.).
- Legacy password reset endpoints remain.

### Intentional changes requiring client awareness

| Change | Evidence | Classification |
|---|---|---|
| Invalid Review Library import now `400` with details | import route | Intentional |
| Unauthenticated API now JSON `401` | middleware | Intentional/security |
| VCF malformed contact now `400` | VCF route | Intentional/security |
| Search >100 chars now `400`; literal regex | search helper/routes | Intentional/security |
| PVC hidden from new catalog list | admin catalog route | Intentional/presentation |
| Central ON blocks connected legacy switch | review-product-connection | Intentional/policy |
| Settings GET no longer creates tenant doc | settings route | Intentional |
| Price UI removed | prior UI changes | Intentional |

No removed endpoint paths, methods, or required response fields were found.

**Full API write matrix (`test-phase4d10p3-write-api.ts`) was not run in this audit.**

---

## 9. UI compatibility

Smoke-tested read-only:

- `/admin/products` — loaded
- `/admin/users` — loaded (`Users Management`)
- `/admin/users/[id]` — loaded
- `/admin/review-library` — loaded
- `/dashboard/products` — loaded
- `/dashboard/review-management` — loaded
- `/dashboard/settings` — loaded
- `/dashboard/standees` — loaded

No “Couldn’t load”, “Something went wrong”, or “Internal Server Error” text appeared.

Previously verified browser behavior:

- Premium Builder: profile tabs retained plus Google Reviews tab; lower-tier excluded; review-only unchanged; mobile/desktop no overflow.
- AIO 3/4 Standee setup: 3/4 slots, Google Review/Instagram/WhatsApp/Facebook fields retained.
- Review copy: exact edited text passed to Clipboard API; Google destination opened; clipboard denial blocked redirect.
- Standee panel QRs preserve profile picker.

**Full dark-theme/mobile matrix across every admin/customer page: NOT TESTED in this audit.**

---

## 10. Security and tenant isolation

| Check | Result |
|---|---|
| Existing ownership checks | PASS — security boundary and review cross-tenant tests |
| Cross-tenant product/review access | PASS — refused in suites |
| Legacy records bypassing entitlement | PASS — product capability checks retained |
| Local override production gate | PASS — production/preview/remote Mongo all disable force-all |
| Admin-only routes | PASS in API suites/smoke |
| Search regex injection | PASS — escaped literal search |
| VCF contact validation | PASS |
| API auth boundary | PASS — JSON 401, no redirect |
| JWT secret production policy | PASS by design; requires production secret length verification |

No new tested path allowed cross-tenant access. Security hardening should not be reverted to preserve older insecure behavior.

---

## 11. Regression and rollback testing

### Current audit test counts

- **338 enumerated checks** run in this audit: **338 PASS, 0 FAIL**.
- `test-security-boundaries.ts` — PASS separately.
- No database writes to `nfc-crm`; all write tests used isolated 27019 databases.
- No migrations/reseeds/environment changes.

### Same-code suite evidence

| Suite | Result |
|---|---|
| Review Management regression — Central OFF | **58/58 PASS** |
| Standee regression — Standee ON, Central OFF | **20/20 PASS** |
| Standee regression — Standee ON, Central ON | **17/20 PASS** — 3 intentional policy failures (BCA-01/BCA-12) |
| Total including same-code suites | **433 checks: 430 PASS, 3 intentional, 0 unclassified failures** |

Rollback safety:

- Disabling Central/local-force/Standee flags restores prior effective behavior.
- No code rollback was performed.
- No customer data was changed.
- Review Library import is non-destructive.
- Destination fallback is read-only and does not rewrite stored URLs.

---

## 12. Data-loss risks

No confirmed data-loss risk was observed.

| Risk | Status |
|---|---|
| Customer records deleted/overwritten | None found |
| Product assignment changes | None; read-only scan |
| Card/standee identifiers rewritten | None |
| Review settings migrated | None |
| Review Library replaced | None |
| PVC/price data removed from DB | No — UI only |
| Local override touching production | Gated out by runtime and Mongo host |
| Legacy review URL fallback | Read-only; explicit hybrid empty override respected |

The only write-path behavior changes are intentional: import rejection, VCF/search validation, material default removal, blocked Central-ON legacy switch, and settings read non-mutation.

---

## 13. Recommended priority

| Priority | Action |
|---|---|
| **P0** | None — no unclassified breaking regression found in tested paths. |
| **P1** | Verify production `JWT_SECRET` is 24–512 chars and production env has no local force-all/standee-local flags. |
| **P1** | Run the full write-API, auth-security, and password-reset OTP suites in an isolated environment before release. |
| **P2** | Update API consumers for intentional `400`/JSON-401 behavior and Review Library invalid-payload responses. |
| **P2** | Update the Standee regression suite’s Central-ON legacy-rollback expectations. |
| **P2** | Configure the live All-in-One 3/4 Google Review slot URLs if the owner wants those existing standees active. This is customer data, not code. |
| **P3** | Run a full mobile/dark-theme matrix and live production comparison when production access is available. |

---

## 14. Not tested / unresolved

1. Production/preview version comparison — production version unavailable.
2. Full `test-phase4d10p3-write-api.ts` API matrix.
3. `test-auth-security.ts` against a server.
4. Password-reset OTP suite with mock Resend.
5. Live customer `/r` and `/qr` HTTP taps (avoided analytics writes).
6. Live All-in-One review flow — existing Google URLs empty; no customer data changed.
7. Full dark-theme/mobile visual matrix.
8. Full 16-combination feature-flag matrix.

**No application code, environment file, database, customer record, NFC/QR identifier, or production/preview setting was changed during this audit.**
