# Taprevia — PPL-02 Immutable URL Implementation

**Date:** 2026-11-03  
**Branch:** `Devlopment`  
**HEAD:** `0191bc1889c95e5716afa2f8f67a991ac131c101`  
**Mode:** Scan → data audit → minimal implementation → tests → report  
**Database inspected:** `mongodb://localhost:27017/nfc-crm` (local only)  
**Production / Preview:** not accessed

---

## A. Original Architecture

### Permanent URL

```
https://www.taprevia.com/r/{routeSlug}
https://www.taprevia.com/r/{routeSlug}/{slot}   (multi-profile standee)
```

- Generated once at card/standee provisioning.
- `uid` mirrors `routeSlug` on new records.
- Resolved dynamically by `src/app/r/[...slug]/route.ts`.
- The permanent route is the printed NFC/QR identity; changing destinations never requires a reprint.
- Admin-only management metadata (`permanentEntryUrl`), never intended to be edited.

### Public URL

| Product | Canonical public URL |
|---|---|
| Profile card | `/{publicSlug}` → `/profile/{urlAlias}` fallback |
| Review card / Plate | `/review/{urlAlias}` |
| Social card | configured external destination (product-specific exception) |
| Standee | `/{publicSlug}`, `/panel/{routeSlug}`, `/standee-review/{routeSlug}` |
| Legacy shims | `/c/{slug}`, `/profile/{alias}`, `/qr/{qrId}` |

`publicSlug` was already immutable (`{business}/{product}[-N]`, unique sparse index).
`urlAlias` was editable in the builder and PATCH API, which is the defect PPL-02 addressed.

**Evidence:**

- `docs/PHASE_4D10_GATE_P2_8_UNIFIED_PRODUCT_URL_ARCHITECTURE.md:43–50, 85–110`
- `docs/DEPLOYMENT.md:103–104`
- `src/lib/services/human-url.ts:172–224, 238–287`
- `src/lib/services/card-identity.ts:136–194`
- `src/lib/services/card-replacement.ts`
- `scripts/test-card-binding.ts:205–221, 348–359`
- `scripts/verify-human-readable-urls.ts:221–257`

---

## B. Current Architecture (after this change)

### Creation

Customer/card creation now guarantees both identities before the card is usable:

1. `routeSlug` + `uid` — minted by `provisionCardForAssignment` / `allocateCardRouteSlug` (`src/lib/services/card-identity.ts`), or by the admin card-create API.
2. `publicSlug` — allocated once from `User.bizSlug` + canonical product slug (`ensureCardPublicSlug`).
3. `urlAlias` — set from the card's immutable `slug` at bind time (`bindAssignedCard`), or equal to the admin-supplied creation alias.
4. Standee `routeSlug`, `uid`, `publicSlug`, `panelQr.qrId`, `socialQrs[].qrId` — minted at standee creation.

`publicSlug` allocation remains guarded by `{ publicSlug: { $in: ['', null] } }` and the existing unique sparse indexes provide atomic uniqueness for `slug`, `routeSlug`, `uid`, and `publicSlug`. **No schema or index change was required.**

### Immutability

A shared guard (`src/lib/services/url-identity.ts`) compares submitted values with stored values:

- Cards: `routeSlug`, `uid`, `publicSlug`, `urlAlias`, `slug`.
- Standees: `routeSlug`, `uid`, `publicSlug`, `panelQr.qrId`, `socialQrs[].qrId`, `socialQrs[].platform`.

Changed values → `403 FORBIDDEN`. Identical values are tolerated (legacy/idempotent clients). Unrelated profile/settings/destination edits remain allowed.

### Resolution

No route precedence was changed. `/r`, `/qr`, `/profile`, `/review`, `/c`, `/panel`, `/standee-review`, and `/{business}/{product}` retain their existing behavior.

### Social exception

Social cards intentionally keep their historical contract: `/r/{routeSlug}` redirects directly to the configured external destination. There is no intermediate Taprevia public page for a social card.

---

## C. Changes Implemented

| File | Lines | Change |
|---|---|---|
| `src/lib/services/url-identity.ts` | new | Immutable-field guard for cards and standees |
| `src/app/api/cards/[id]/route.ts` | 22–23, 175–188, 218–219 | Reject changed identifiers; remove alias write |
| `src/app/api/cards/route.ts` | 11, 104–140 | Allocate `routeSlug`/`uid` at creation; cross-namespace alias check; duplicate-key 409 |
| `src/app/api/my/products/[id]/config/route.ts` | 12–16, 93–104, 224–236, 359–367, 448–456 | Guard card/standee identifiers in bound and uninstantiated branches |
| `src/app/api/admin/users/[id]/products/[userProductId]/card/route.ts` | 14, 37–53 | Reject identifier fields during physical card replacement |
| `src/lib/validation/card.ts` | 168–171 | Remove `urlAlias` from `updateCardSchema` |
| `src/components/builder/tabs/basic-tab.tsx` | 1–20, 48–69, 175–214 | Read-only Profile URL + Copy action; remove alias probe/edit logic |
| `src/components/builder/builder-shell.tsx` | 385 | `BasicTab` no longer needs a card id for alias probing |
| `scripts/test-phase4d10p3-write-api.ts` | W27/W29 | Alias change now expects 403; add same-value 200; assert routeSlug on admin create |
| `scripts/test-ppl02-immutable-urls.ts` | new | 23 focused creation/immutability assertions |

No changes to `/r`, `/qr`, standee routing, Review Management logic, catalog, entitlements, or PPL-01 QR behavior.

---

## D. URL Immutability

### Permanent URL

- `routeSlug`/`uid` have no customer/admin write path.
- `POST /api/cards` mints them at creation.
- `provisionCardForAssignment` and assignment backfill only write when missing.
- Card replacement preserves them.
- Any PATCH/replace payload attempting a different value is rejected.

### Public URL

- `publicSlug` remains write-once (`$in: ['', null]` guard + unique sparse index).
- `urlAlias` is now write-once:
  - removed from `updateCardSchema`;
  - PATCH rejects a changed value with `403`;
  - builder field is read-only and no longer calls `check-alias`;
  - product-config, pending-config, and card-replacement payloads reject identifier fields.
- `User.bizSlug` was already write-once and is not exposed by update APIs.

### Backend proof

- Card PATCH: `src/app/api/cards/[id]/route.ts:175–188`
- Config PATCH: `src/app/api/my/products/[id]/config/route.ts:93–104`, `224–236`, `359–367`, `448–456`
- Admin replacement: `src/app/api/admin/users/[id]/products/[userProductId]/card/route.ts:37–53`
- Guard semantics: `src/lib/services/url-identity.ts:54–126`

### Frontend proof

`src/components/builder/tabs/basic-tab.tsx:175–214` renders the Profile URL with `readOnly`, a Copy button, and “This URL cannot be changed.” No edit/availability controls remain.

---

## E. Existing Data Safety

Read-only scan of `nfc-crm` (15 cards, 15 users, 7 standees):

| Check | Result |
|---|---|
| Cards with `routeSlug` | 8 |
| Cards without `routeSlug` | 7 (QA/unassigned/legacy) |
| Cards with `publicSlug` | 7 |
| Cards without `publicSlug` | 8 |
| Cards with `urlAlias` | 8 |
| Duplicate `slug` | 0 |
| Duplicate `routeSlug` | 0 |
| Duplicate `uid` | 0 |
| Duplicate `publicSlug` | 0 |
| Duplicate `urlAlias` | 0 |
| Alias colliding with another card's `slug` | 0 |
| Malformed `publicSlug` | 0 |
| `publicSlug` prefix mismatching `User.bizSlug` | 0 |
| Reserved alias in use | 0 |
| Standees with `routeSlug` / without | 5 / 2 |
| Standees with `publicSlug` / without | 5 / 2 |
| Missing standee panel QR | 0 |

Two active assigned legacy cards lack a full identity pair:

- `1D:47:97:0B:66:00:00` — no `routeSlug`, no `publicSlug`; still resolves through the legacy `/r` fallback.
- `DIGITAL-MVZ27LRYEC` — has `routeSlug`, no `publicSlug`; `/r` resolves to `/profile/{alias}`.

No identifier was rewritten, and no data migration or backfill was performed. These legacy gaps are reported, not silently “fixed”.

**No database indexes, migrations, or customer records were created, changed, or deleted.**

---

## F. Backward Compatibility Matrix

### Products

| Product | Status | Evidence |
|---|---|---|
| Premium NFC Business Card | PASS | creation test + PPL-01 + write-api |
| Standard NFC Business Card | PASS | dynamic routing 29/29 |
| Google Review NFC Card | PASS | backcompat 11/11 ×2; review routing |
| Google Review NFC Plate | PASS | backcompat + preview routing |
| Social NFC Card | PASS | dynamic routing; external redirect preserved |
| Legacy NFC Cards | PASS | `/r` fallback unchanged; missing identifiers preserved |
| Dedicated Google Review Standee | PASS | standee suite 20/20 |
| All-in-One 3 Profile Standee | PASS | standee suite 20/20 |
| All-in-One 4 Profile Standee | PASS | standee suite 20/20 |
| Other catalog products | PASS | entitlement suite 130/130 |

### Routes

| Route | Status | Evidence |
|---|---|---|
| `/r/{routeSlug}` | PASS | backcompat 11/11; dynamic routing |
| `/r/{uid}` | PASS | unchanged resolver; timestamp UID tests |
| `/{publicSlug}` | PASS | backcompat; dynamic routing |
| `/profile/{alias}` | PASS | backcompat |
| `/review/{alias}` | PASS | backcompat; standee/review suites |
| `/c/{key}` | PASS | unchanged shim |
| `/qr/{qrId}` | PASS | unchanged resolver |
| `/panel/{route}` | PASS | standee suite |
| `/standee-review/{slug}` | PASS | standee suite |
| `/r/{routeSlug}/{slot}` | PASS | standee suite |

### Compatibility checks

| Check | Result |
|---|---|
| Existing links resolve to same owner | PASS |
| Existing QR codes remain usable | PASS (routes unchanged) |
| Existing NFC cards remain usable | PASS |
| Existing public profiles accessible | PASS |
| Existing review pages accessible | PASS |
| Existing social redirects correct | PASS |
| Analytics behavior correct | PASS (PPL-01 routes taps through `/r`) |
| Entitlements unchanged | PASS (130/130) |
| Existing records unchanged | PASS (read-only scan; no writes) |
| New records immutable | PASS (23/23) |
| Identifier edits rejected | PASS (write-api W27 403) |
| Unrelated edits still work | PASS (write-api W27-P) |

---

## G. PPL-01 Verification

`scripts/test-ppl01-customer-qr.ts`:

```
PPL-01 QR regression: 18 passed, 0 failed
```

Confirmed:

- Customer QR = `{base}/r/{routeSlug}`.
- QR image, modal payload, and PDF use the same helper.
- Public Preview still uses `preview.href`.
- Legacy `publicSlug` fallback remains when `routeSlug` is absent.
- No alias/external destination is encoded.
- No identifier is regenerated.

PPL-01 was not reverted; its helper and page behavior remain intact.

---

## H. Test Results

### Passed

| Suite | Result |
|---|---|
| `test-ppl02-immutable-urls.ts` | **23/23** |
| `test-ppl01-customer-qr.ts` | **18/18** |
| `test-security-boundaries.ts` | PASS |
| `test-dashboard-entitlement.ts` | **130/130** |
| `test-phase4d10p2-builder-tabs.ts` | **9/9** |
| `test-phase4d10p2-backward-compat.ts` (Central OFF/ON) | **11/11**, **11/11** |
| `test-dynamic-routing.ts` | **29/29** |
| `test-card-binding.ts` | **49/49** |
| `test-standee-review.ts` | **20/20** |
| `test-phase4d10p3-write-api.ts` — PPL-02-relevant cases | PASS |
| `tsc --noEmit` | PASS |
| `next lint` (changed files) | PASS |
| `npm run build` | PASS |

`test-phase4d10p3-write-api.ts` relevant results:

- `W27-N1` alias change → **403** PASS
- `W27-P0` same-value alias → **200** PASS
- `W27-P` unrelated name/config update → **200** PASS
- `W29-P` admin card create → **201**, `routeSlug`/`uid` minted PASS

### Failed (unrelated harness/environment)

Full write-API run had 8 failures unrelated to PPL-02:

| Test | Failure | Cause |
|---|---|---|
| W05-P2 | review-library import category not found | isolated DB category fixture absent |
| W44-P | expected 503, got 200 library engine | AI/provider expectation vs library fallback |
| W46-GATE / W47-GATE / W48-GATE | expected 404, got active responses | local `.env.local` has `STANDEE_REVIEW_ASSISTANT_ENABLED=true`; suite expected OFF |
| W46-P / W47-P | expected 201/503, got 200 | same standee-gate environment |
| W39-CONCURRENCY | dual 201 appointment race | concurrency fixture, not URL code |

None of these touch identifier creation or immutability.

### Known stale assertion

`test-phase4d10p2-preview-routing.ts` — **14/15**; the same pre-existing “missing alias” fixture supplies `slug`, so the resolver correctly returns `disabled`. Unchanged from the audit baseline.

### Skipped / not tested

- Live `/r`/`/qr` HTTP taps against the customer database (avoided analytics writes).
- Physical NFC scanning and printed-QR scanning.
- Admin replacement HTTP rejection end-to-end (source + guard unit coverage only).
- Production/Preview behavior.

---

## I. Remaining Risks

1. **Unrecoverable historical aliases.** No alias-history/audit table exists. Aliases changed before this fix cannot be reconstructed; old released aliases are not guaranteed.
2. **Legacy records with missing identifiers.** Two active assigned cards lack `publicSlug`; one lacks both `routeSlug` and `publicSlug`. They keep working through legacy routes but cannot get a permanent/public pair without an approved backfill.
3. **Admin-only standalone cards.** `POST /api/cards` mints `routeSlug`/`uid` but has no product assignment, so `publicSlug` is allocated only when the card is assigned to a customer product. This endpoint is admin-only and is not the customer creation workflow.
4. **Best-effort publicSlug allocation.** `ensureCardPublicSlug` failures are logged but do not roll back assignment (existing behavior). Supported catalog products allocate successfully in tests.
5. **PPL-03 (alias uniqueness/index).** No index change was made. New creation paths are atomic via unique `slug` (`urlAlias` = `slug` at creation), and alias updates are now blocked. Existing duplicate aliases would remain; none were found.
6. **PPL-04–PPL-08 remain unresolved** (admin “Permanent” fallbacks, reserved-list divergence, cache/loop guards, publicSlug suspension check).
7. **Deployment prerequisite.** No migration is required. Existing indexes must remain as documented (`routeSlug`, `uid`, `publicSlug` unique sparse).

---

## J. Final Safety Confirmation

- No production or preview database accessed or changed.
- No customer data modified, deleted, or rewritten.
- No permanent identifiers regenerated.
- No database migration, index creation, or backfill executed.
- No environment file changed.
- No commit, push, or deployment.
- All write tests used isolated databases (`ppl02_*`, `taprevia_p27_*`, `taprevia_4d6_*`, `taprevia_p35_*`) and temporary servers; they were dropped/stopped afterwards.
- Live `nfc-crm` counts before/after remained: 15 users, 15 cards, 7 standees, 20 assignments, 17 catalog products, 1 review category, 110 templates, 1 review settings, 16 analytics logs.
- `.env.local`, `.env.preview`, `.env.example` hashes unchanged.

**PPL-02 implementation complete. PPL-01 remains green. Awaiting approval before any further changes.**
