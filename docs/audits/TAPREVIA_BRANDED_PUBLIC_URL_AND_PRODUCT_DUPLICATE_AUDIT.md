# Taprevia — Branded Public URL & Duplicate Product Audit

**Date:** 2026-11-04  
**Branch:** `Devlopment`  
**HEAD:** `0191bc1889c95e5716afa2f8f67a991ac131c101`  
**Mode:** Read-only audit — no code, data, identifier, route, or environment changes  
**Database:** `mongodb://127.0.0.1:27017/nfc-crm` (local only)  
**Production / Preview:** not accessed

---

## A. Executive Summary

| Issue | Classification | Summary |
|---|---|---|
| 1 — `/profile/digital-mvz27lryec` | **LEGACY BEHAVIOR / DATA GAP** | The card has no `publicSlug`; its assignment points to legacy catalog product `nfc-card`, which has no canonical product mapping. `/profile/{alias}` is the only current Public URL. No existing branded URL belongs to this card. |
| 2 — “NFC Business Card” vs “Business NFC Card” | **DUPLICATE PRODUCT / LEGACY RECORD** | Two active CatalogProduct rows, same price and same basic profile-card role, both assigned to the same customer. `nfc-card` is a legacy row (kind missing, no canonical mapping); `business-nfc-card` is the current canonical replacement. They are not two intentionally different products. |
| 3 — `/review/digital-mvz27ltm5k` | **CONFIRMED BRANDING GAP** | A branded immutable `publicSlug` already exists (`kaka-pvc/google-review`) and resolves to the same review card. Current customer-facing resolver always displays `/review/{urlAlias}` instead of the branded Public URL. Routing works; branding does not. |

`localhost:3000` is the configured local `NEXT_PUBLIC_BASE_URL`; it is a development configuration, not evidence of a production bug.

No data or identifiers were changed.

---

## B. Exact URL Investigation — `/profile/digital-mvz27lryec`

Read-only lookup:

| Field | Value |
|---|---|
| Card ID (masked) | `…8a1112` |
| Card UID | `DIGITAL-MVZ27LRYEC` |
| `slug` | `digital-mvz27lryec` |
| `urlAlias` | `digital-mvz27lryec` |
| `publicSlug` | **null** |
| `routeSlug` / `uid` | `mvz27lrzva` |
| Kind | `profile` |
| Status | active / `isActive: true` |
| Owner (masked) | `…8a10f3` |
| Owner `bizSlug` | `kaka-pvc` |
| Active assignment | yes |
| Assigned catalog | `nfc-card` / “NFC Business Card” |

### Why this URL is visible

The card has no `publicSlug`, so every customer-facing Public URL resolver falls back to the legacy profile alias:

- `src/lib/services/customer-public-url.ts:44–54` — profile falls back `publicSlug → profile/{alias} → c/{slug}`
- `src/lib/services/product-preview.ts:106–110` — profile preview falls back `/profile/{alias}`
- `src/lib/vcf.ts:163–169` — vCard profile URL falls back to `/profile/{alias}`

Surfaces affected for this card:

- My Products list/detail “Public URL” + Copy
- Builder Basic tab “Public URL” + Copy
- Builder header URL
- vCards card link and QR modal Public URL line
- Public profile page share/copy actions
- vCard contact URL
- Admin User Details “Public” canonical link
- Any review/standee manager display using the shared resolver

QR/NFC do **not** use `/profile`:
- Permanent QR/NFC = `/r/mvz27lrzva`
- Customer vCards QR = `/r/mvz27lrzva` (PPL-01)

### Why `publicSlug` is missing

`ensureCardPublicSlug` resolves the assigned catalog product through `getPublicProductSlug` (`human-url.ts:60–65`). That calls `resolveCanonicalProductId` (`product-identity.ts:16–23`). The legacy slug `nfc-card` is not a ProductId and is not in `LEGACY_PRODUCT_SLUGS` (only `premium-card` is mapped), so:

```
nfc-card → resolveCanonicalProductId = null
→ getPublicProductSlug = null
→ ensureCardPublicSlug returns { assigned: false }
```

The card was created before/without a Public URL allocation; its existing `routeSlug` and `urlAlias` are immutable and must not be regenerated.

### Can it be replaced with an existing branded URL?

**No.**

- `/kaka-pvc/business-card` exists, but it belongs to a **different card** (`…8a10fe`, `digital-mvz27lr4e3`), not `…8a1112`.
- No `publicSlug` exists for `…8a1112`, so there is no existing branded URL to display.
- A branded URL for this card would require a **new immutable `publicSlug`** (for example `kaka-pvc/business-card-2`) and a controlled allocation/backfill. That is a customer-data/identifier change requiring approval; it must not be invented in a display-only fix.

**Safe display-only options (not implemented):**
1. Keep `/profile/digital-…` and explicitly label it Legacy.
2. After approval, allocate a new `publicSlug` for this card and then display the branded URL.
3. After approval, map the legacy catalog slug `nfc-card` to the canonical business product and run an approved backfill; this would also restore canonical feature/public-slug resolution for the existing assignment.

---

## C. Duplicate Product Investigation

Mirroring current code and database:

| Attribute | “NFC Business Card” | “Business NFC Card” |
|---|---|---|
| Catalog ID (masked) | `…d99d7a` | `…bb51f0` |
| Catalog slug | `nfc-card` | `business-nfc-card` |
| Internal canonical ID | **none** (`resolveCanonicalProductId` = null) | `BUSINESS_NFC_CARD` |
| Display name | NFC Business Card | Business NFC Card |
| Category | card | card |
| Kind | **null** | profile |
| Active | true | true |
| Price | 99900 INR | 99900 INR |
| Features field | null | null |
| Canonical capabilities | none resolved | qr, nfc, public_profile, profile_edit, contact_save, social_links, catalogue, portfolio, lead_capture, dynamic_link, multi_language, tap_analytics, dynamic_dashboard |
| Review Management | not entitled | not entitled |
| Public slug mapping | **none** (causes missing publicSlug) | `business-card` |
| Active assignments | 1 | 1 |
| Active customers | 1 | 1 |
| Customer | `kaka-pvc` | `kaka-pvc` |
| Created | 2026-08-26 | 2026-11-02 |
| Current seed creates it? | **No** | Yes (`scripts/seed.ts:62–101`) |
| Visible in Admin assignment selector | Yes (`/api/admin/catalog` active, non-PVC) | Yes |
| Visible in Admin Products table | No (table renders hard-coded `PRODUCT_CATALOG` only) | Yes |
| Visible in Customer My Products | Yes, for assigned customer | Yes, for assigned customer |
| New assignment possible | **No** — `assignUserProduct` rejects missing `kind` (`:95–101`) | Yes |

### Finding

These are **not two intentionally different products**. They are:

- a legacy catalog row (`nfc-card`, created August, missing `kind`, no canonical product mapping), and
- its current canonical replacement (`business-nfc-card`, created November from the current seed).

They have the same price, category, basic profile-card role, and the same active customer. The legacy row is still `active: true`, so it remains visible in the admin assignment selector even though new assignment attempts fail because `kind` is missing.

The admin Products page does not show the legacy row because it renders only hard-coded `PRODUCT_CATALOG`; the Admin User Details “Assign Product” dropdown fetches `/api/admin/catalog` and shows both.

**Classification: DUPLICATE PRODUCT (legacy record + canonical replacement).**

Safe consolidation options (not implemented):
- Deactivate/hide the legacy `nfc-card` row after verifying active assignments remain readable.
- Or add `nfc-card → BUSINESS_NFC_CARD` to `LEGACY_PRODUCT_SLUGS` for read-time canonicalization (would restore feature/public-slug resolution without rewriting the catalog row).
- Do not merge, rename, delete, or repoint the existing assignment without approval.

---

## D. Review URL Branding — `/review/digital-mvz27ltm5k`

| Field | Value |
|---|---|
| Card ID (masked) | `…8a1156` |
| Product | Google Review Card (`google-review-card`) |
| Kind | review |
| `urlAlias` | `digital-mvz27ltm5k` |
| **`publicSlug`** | **`kaka-pvc/google-review`** |
| `routeSlug` / `uid` | `mvz27ltnip` |
| Owner (masked) | `…8a10f3` |
| Owner `bizSlug` | `kaka-pvc` |
| Permanent QR | `/r/mvz27ltnip` |

The branded route **already exists and resolves**:

```
/kaka-pvc/google-review → same card …8a1156 → /review/digital-mvz27ltm5k
```

Read-only resolver check confirmed `getPublicCardByPublicSlug('kaka-pvc/google-review')` returns card `…8a1156`.

The second review card (`…8a11bf`, Google Review NFC Plate) has `publicSlug: kaka-pvc/google-review-2` and resolves the same way.

### Why the generic URL is shown

The review branch of the customer resolver bypasses `publicSlug`:

- `src/lib/services/customer-public-url.ts:44–46` — review returns `/review/{urlAlias}` first
- `src/lib/services/product-preview.ts:78–95` — review preview returns `/review/{urlAlias}`
- `src/components/builder/tabs/review-management-link-tab.tsx:24,58–63,102,196` — review builder link uses alias
- `src/components/builder/builder-shell.tsx:189` — builder header delegates to the same resolver

Consequences:

- Customer My Products / details copy `/review/digital-…`
- Builder header / review link tab show `/review/digital-…`
- Admin User Details “Public” shows `/review/digital-…`
- The branded `/{publicSlug}` is available but not selected.

The alias itself is auto-generated from the card UID at creation (`createUniqueCardSlug` / bind) and is immutable under PPL-02. It must not be changed. The branded `publicSlug` is also immutable and already allocated.

### Safest branding option

Prefer the **existing** `publicSlug` for review customer-facing display:

```
https://www.taprevia.com/{businessSlug}/{productSlug}
→ https://www.taprevia.com/kaka-pvc/google-review
```

No new route is required: `/{business}/{product}` already dispatches review cards through `PublicCardPage` to `/review/{alias}`. Existing `/review/{alias}` URLs and printed/shared links must remain available. This is a display/resolver change only, but it changes customer-facing copy/share behavior and should be approved first.

Do **not** introduce `/review/{businessSlug}/{reviewSlug}`: it is not currently supported and would require new route/data work.

---

## E. Customer-Facing URL Inventory

| Surface | Current target for Issue 1 card | Current target for review card | Classification |
|---|---|---|---|
| My Products list/detail | `/profile/digital-mvz27lryec` | `/review/digital-mvz27ltm5k` | Public display; review branding gap |
| Builder Basic tab | `/profile/digital-mvz27lryec` | `/review/digital-mvz27ltm5k` | Public display |
| Builder header | `/profile/digital-mvz27lryec` | `/review/digital-mvz27ltm5k` | Public display |
| Review Management link tab | n/a | `/review/digital-mvz27ltm5k` | Branding gap |
| vCards card link | `/profile/digital-mvz27lryec` | `/review/digital-mvz27ltm5k` | Public display |
| vCards QR modal | Public URL + `/r/mvz27lrzva` / `/r/mvz27ltnip` | same pattern | Permanent payload correct |
| Public profile share/copy | `/profile/digital-mvz27lryec` | n/a (review page) | Legacy public fallback |
| vCard download URL | `/profile/digital-mvz27lryec` | n/a (profile-only) | Legacy public fallback |
| Admin User Details “Public” | `/profile/digital-mvz27lryec` | `/review/digital-mvz27ltm5k` | Branding gap |
| Admin User Details “Permanent” | `/r/mvz27lrzva` | `/r/mvz27ltnip` | Correct |
| Account Settings | `/profile/kaka-pvc` (legacy company route) | same | Legacy company profile |
| Standee Manager | `/{publicSlug}` | same | Correct |
| `/api/my/qr` | publicSlug if allocated; 409 otherwise | publicSlug | Public URL API (PPL07-04) |
| `localhost:3000` | `NEXT_PUBLIC_BASE_URL` local dev | same | Configuration, not production bug |

No `/review/digital-*` or `/profile/digital-*` value is used as a permanent QR/NFC payload for these cards; QR/NFC use `/r/{routeSlug}`.

---

## F. Existing Data Analysis

Read-only aggregate (masked):

| Metric | Count |
|---|---|
| Cards | 15 |
| Cards with branded `publicSlug` | 7 |
| Cards missing `publicSlug` | 8 |
| Generic `digital-*` aliases | 8 |
| Review cards | 2 |
| Review cards with branded `publicSlug` | 2 |
| Review cards missing branded `publicSlug` | 0 |
| `nfc-card` active assignments | 1 |
| `business-nfc-card` active assignments | 1 |
| Active customers for each candidate | 1 each |

Target profile card: no `publicSlug`, active assignment via `nfc-card`.
Target review card: branded `publicSlug` present, resolves correctly.

The other 7 cards missing `publicSlug` are legacy/QA records; not all are active customer products.

---

## G. Root Cause Analysis

| Issue | Root cause | Files / lines |
|---|---|---|
| Issue 1 legacy profile URL | Legacy catalog slug `nfc-card` has no canonical ProductId/publicSlug mapping; card never received `publicSlug`; display falls back to profile alias | `src/lib/services/product-identity.ts:12–23`; `src/lib/services/human-url.ts:60–65,172–187`; `src/lib/services/customer-public-url.ts:44–54`; `src/lib/services/product-preview.ts:106–110`; `src/lib/vcf.ts:163–169` |
| Issue 2 duplicate products | Legacy active catalog row `nfc-card` remains in DB alongside canonical `business-nfc-card`; admin assign selector lists all active catalog rows | DB records; `src/app/api/admin/catalog/route.ts:17–31`; admin assign selector; `scripts/seed.ts:62–101`; `src/lib/services/user-product-assignment.ts:95–101` |
| Issue 3 review branding | Review branch of the Public URL resolver always uses `urlAlias`, ignoring existing `publicSlug` | `src/lib/services/customer-public-url.ts:44–46`; `src/lib/services/product-preview.ts:78–95`; review link tab; builder header |

---

## H. Proposed Minimal Fixes

### Issue 3 — Review branding (lowest risk, code-only)

Change the review branch of `resolveCustomerPublicPath` and `resolveCardPreview` to prefer `publicSlug`:

```
review + publicSlug → /{publicSlug}
else review → /review/{urlAlias|slug}
```

- No new route.
- No identifier changes.
- Existing `/review/{alias}` remains valid.
- Customer display/copy/share becomes branded.
- Requires approval because it changes customer-facing URLs.

Do not change `urlAlias`, `routeSlug`, or QR payloads.

### Issue 2 — Duplicate catalog row

Options requiring approval:
1. Deactivate/hide `nfc-card` from new-assignment discovery; preserve existing assignments and customer displays.
2. Map `nfc-card → BUSINESS_NFC_CARD` in `LEGACY_PRODUCT_SLUGS` so canonical feature/public-slug resolution works read-only.
3. Combine both: map for compatibility, hide legacy from new assignment.

Do not merge/delete records or repoint existing assignments.

### Issue 1 — Branded profile URL

There is no existing branded URL for this card. Options:
1. Leave `/profile/digital-…` and label it Legacy.
2. After approval, allocate a new immutable `publicSlug` for this card (must reserve a unique path such as `kaka-pvc/business-card-2`).
3. After approval, map the legacy product slug and run an approved backfill/allocation.

This requires a customer-data/identifier change and must not be bundled with a display-only fix.

---

## I. Backward Compatibility Impact

- Existing `/profile/digital-mvz27lryec` must remain accessible.
- Existing `/review/digital-mvz27ltm5k` must remain accessible.
- Existing `/r/mvz27lrzva` and `/r/mvz27ltnip` must remain unchanged.
- Existing printed NFC/QR payloads are unaffected.
- Branded `/kaka-pvc/google-review` already resolves; preferring it for display does not remove the alias route.
- Product assignments and catalog records must not be altered by a display fix.
- PPL-01 through PPL-07 behavior remains in force.

---

## J. Regression Test Results

| Test | Result |
|---|---|
| PPL-01 customer QR | **18/18** |
| PPL-02 immutable URLs | **23/23** |
| PPL03-01 alias collision | **8/8** |
| PPL04/05 permanent URL separation | **16/16** |
| PPL-06 alias validation | **41/41** |
| PPL-07 redirect safety | **11/11** |
| Customer Public URL display | **28/28** |
| Security boundaries | PASS |
| Dynamic routing | **29/29** |
| Card binding | **49/49** |
| Standee review | **20/20** |
| Review Management | **58/58** |
| Dashboard entitlement | **130/130** |
| `test-phase4d10p2-preview-routing.ts` | **15/16** — known stale `review-noalias` fixture (unrelated) |
| `tsc --noEmit` | PASS |
| `next lint` | PASS |
| `npm run build` | PASS |

No live HTTP page requests were made against customer data to avoid analytics writes. Branded-route existence was verified through read-only `getPublicCardByPublicSlug`/`getPublicCardByAlias` calls.

---

## K. Recommended Implementation Order

1. **Review branding (Issue 3)** — code-only; prefer existing `publicSlug`; lowest risk.
2. **Duplicate catalog handling (Issue 2)** — code/data governance decision; hide legacy from new assignment and/or add read-time canonical mapping.
3. **Branded profile URL (Issue 1)** — highest risk; requires new `publicSlug` allocation/backfill or leaving the legacy profile URL as-is.

---

## L. Final Classification

| Issue | Classification |
|---|---|
| `/profile/digital-mvz27lryec` | **LEGACY BEHAVIOR / DATA GAP** — no existing branded `publicSlug`; `/profile` fallback is correct for current data. |
| NFC Business Card vs Business NFC Card | **DUPLICATE PRODUCT** — legacy `nfc-card` row plus canonical `business-nfc-card`; not two intentional products. |
| `/review/digital-mvz27ltm5k` | **CONFIRMED BRANDING GAP** — branded `publicSlug` exists and works, but review display prefers the generic alias. |
| `localhost:3000` in links | **CONFIGURATION ISSUE** — local development base URL, not a production defect. |

**No application code, customer data, identifiers, products, routes, indexes, migrations, or environment files were changed during this audit. Awaiting approval before any fix.**
