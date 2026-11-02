# TAPREVIA — PHASE 4D.10 P3.3 FUNCTIONAL COVERAGE MATRIX

**Status:** P3.3 INCOMPLETE — COVERAGE OR TESTING GAPS REMAIN

## Scope counts

| Metric | Count |
|---|---|
| Application pages (`page.tsx`) discovered | 43 |
| Pages visited in a local browser | 43 |
| Pages accounted for (pass/expected gate/redirect) | 43 |
| Pages with 5xx/uncaught runtime failure | 0 |
| Pages not tested | 0 |
| API route files | 79 |
| API methods discovered | 99 |
| API methods exhaustively executed method-by-method | **not achieved (gap)** |
| UI actions exhaustively inventoried/executed | **not achieved (gap)** |
| Confirmed new P0–P2 defects | 0 |
| Prior P3 defects still open | 0 |
| Backward-compatibility harness | 11/11 |
| URL resolver suite | 15/15 |

## Page coverage

| Area | Routes visited | Result |
|---|---|---|
| Public/marketing | `/`, contacts, privacy, terms, cookies, previews | PASS / expected |
| Auth | login, register, forgot, reset | PASS / safe invalid-link state |
| Public product | review, profile, `/c`, `/r`, `/qr`, panel, standee-review, business/product | PASS / expected gates |
| Customer | dashboard, products, product detail, vcards/editor, standees, review management, analytics, settings, account, reviews, subscribers | PASS / expected redirects |
| Admin | overview, users, user detail, products, templates, review library, standee-qr | PASS / expected redirect |

Expected non-errors: capability-gated dashboard pages redirect to `/dashboard`;
Standee review host unavailable with flag OFF; `/admin/standee-qr` 307 to Users.

## Key action execution

| Action | Result |
|---|---|
| My Products links/preview | PASS (canonical) |
| vCards canonical preview API | PASS |
| Product destination edit/save/reload/DB | PASS |
| Review Management Complete Setup → Save & Activate | PASS (2 PATCH, Ready) |
| Edit Link/Save Link | PASS (UI present; setup flow) |
| Partial save: stale second PATCH | 409, no false Ready, retry 200 |
| Admin Public/Permanent copy/QR | PASS |
| Footer links | PASS after repair |
| Public review initial suggestion/language/length/AI-unavailable | PASS |
| Standee Manage slots | PASS |

## API method coverage

Discovered methods by verb: GET 43, POST 29, PATCH 13, PUT 6, DELETE 8 = 99.

Representative API families executed through suites: auth/session, health,
security boundaries, entitlements, customer/product/assignments, review
settings/products/preview/analytics/suggestions/generate/copied, Standee
settings/lifecycle, card binding, dynamic QR/NFC, VCF, QR PDF, library/import,
admin users/catalog/review-library, password reset.

**Not completed:** a 99-row, per-method matrix covering valid, missing-auth,
wrong-role/tenant, invalid-input, missing-resource and side-effect assertions.
This is the principal coverage gap.

## Regression suites executed

| Suite | Result |
|---|---|
| Typecheck / ESLint | PASS |
| Build OFF / ON | PASS |
| 4D.5 Review Management | 57/57 ×2 |
| 4D.6 Standee | 20/20 ×4 |
| Unified analytics | 9/9 |
| Historical analytics | 9/9 |
| Feature-flag matrix | 192/192 |
| 4D.8/4D.9 fixes | 0 failures; 14/14 |
| URL resolver / BC harness | 15/15 · 11/11 |
| Builder / preview config | 9/9 · 41/41 |
| Security / entitlement | PASS · 130/130 |
| Review Library / import | 48/48 · 13/13 |
| Card / dynamic / Standee lifecycle | 49/49 · 29/29 · 24/24 |
| VCF / QR PDF | 69/69 · PASS |
| Auth / password reset | 7/7 · 18/18 |
| Mail / identity / UID / integrity | 21/21 · 17/17 · 19/19 · hold |
| `git diff --check` | clean |

## Not verified

- Exhaustive 99-method API matrix.
- Complete UI-action count/execution across all pages.
- Live AI, Vercel/Preview, external Google navigation.
- Physical devices, NFC/QR scans, TalkBack/VoiceOver.
- Dependency advisories, Lighthouse/axe, real customer data.

**P3.3 INCOMPLETE — COVERAGE OR TESTING GAPS REMAIN**
