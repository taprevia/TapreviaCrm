# Taprevia — NFC Business Card Duplicate Deep Audit

**Date:** 2026-11-04  
**Branch:** `Devlopment`  
**HEAD:** `0191bc1889c95e5716afa2f8f67a991ac131c101`  
**Mode:** Strictly read-only; synthetic runtime checks in isolated DB only  
**Live DB:** `mongodb://127.0.0.1:27017/nfc-crm`  
**Production / Preview:** not accessed

---

## A. Executive Summary

**Final classification: B. FUNCTIONAL DUPLICATE.**

Both catalog rows represent the same intended lower-tier Business/Profile NFC card:

- same category (`card`)
- same price (99900 INR)
- same basic profile-card purpose
- same customer owns one of each
- assigned cards use the same template and same configuration shape

However, they are **not exact duplicates at runtime**. The legacy row `nfc-card` is missing `kind` and has no canonical ProductId, so it grants **no capabilities/features**, cannot allocate a `publicSlug`, cannot be assigned to a new customer through the current workflow, and cannot be edited by a customer who owns only that product. The canonical `business-nfc-card` grants the full BUSINESS_NFC_CARD capability set.

No data, product, entitlement, or code was changed.

---

## B. Database Comparison

| Attribute | NFC Business Card | Business NFC Card |
|---|---|---|
| Catalog ID (masked) | `…d99d7a` | `…bb51f0` |
| Slug | `nfc-card` | `business-nfc-card` |
| Name | NFC Business Card | Business NFC Card |
| Category | card | card |
| Kind | **null** | `profile` |
| Canonical ProductId | **none** | `BUSINESS_NFC_CARD` |
| Active | true | true |
| Price | 99900 INR | 99900 INR |
| Currency | INR | INR |
| `features` field | null | null |
| Sort order | 1 | 1 |
| Created | 2026-08-26 | 2026-11-02 |
| Active assignments | 1 | 1 |
| Active customers | 1 | 1 |
| Customer (masked) | `…8a10f3` / `kaka-pvc` | `…8a10f3` / `kaka-pvc` |
| Current seed creates it | **No** | Yes (`scripts/seed.ts:62–101`) |
| New assignment possible | **No** — kind null | Yes |
| Canonical public product slug | **none** | `business-card` |

### Assigned Card comparison (live)

| Attribute | Legacy card (NFC Business Card) | Canonical card (Business NFC Card) |
|---|---|---|
| Card masked | `…8a1112` | `…8a10fe` |
| Card UID | `DIGITAL-*` | `DIGITAL-*` |
| `slug` / `urlAlias` | `digital-mvz27lryec` | `digital-mvz27lr4e3` |
| `routeSlug` / `uid` | `mvz27lrzva` | `mvz27lr78k` |
| `publicSlug` | **null** | `kaka-pvc/business-card` |
| Kind | profile | profile |
| Template | `panthi-event` | `panthi-event` |
| Setup complete | false | false |
| Instagram / WhatsApp / LinkedIn / Facebook configs | present | present |
| `reviewAssistant` block | present/enabled | present/enabled |
| Taps | 0 | 0 |

Both assignment records were created on 2026-11-02 for the same customer. The legacy card has no branded public URL; the canonical card does.

The legacy assignment predates/does not match the current assignment guard. Current code would reject a new `nfc-card` assignment because `kind` is null (`assignUserProduct` → `deriveCardKind` → null).

---

## C. Feature Comparison

| Feature | NFC Business Card (`nfc-card`) | Business NFC Card (`business-nfc-card`) | Same/Different | Evidence |
|---|---|---|---|---|
| Product ID / DB record | `…d99d7a` | `…bb51f0` | **Different record** | live DB |
| Slug | `nfc-card` | `business-nfc-card` | Different | live DB |
| Display name | NFC Business Card | Business NFC Card | Different label, same intended role | live DB |
| Category | card | card | Same | live DB |
| Kind / internal type | null | profile | **Different metadata** | live DB |
| Canonical ProductId | none | `BUSINESS_NFC_CARD` | **Different** | `product-identity.ts:12–23` |
| Price / billing | 99900 INR | 99900 INR | Same | live DB |
| Product `features` field | null | null | Same | live DB |
| Feature grants (isolated) | all false | profile=true, social=true | **Different runtime** | isolated `resolveFeatureAccess` |
| Capabilities | `[]` | 13 capabilities | **Different runtime** | isolated `getUserCapabilities` |
| Owned ProductIds | `[]` | `BUSINESS_NFC_CARD` | **Different runtime** | isolated `getUserProductIds` |
| NFC capability | none (no canonical caps) | `nfc` | Different runtime | `PRODUCT_CATALOG.BUSINESS_NFC_CARD` |
| QR capability | none | `qr` | Different runtime | same |
| Profile creation/editing | canEdit false for legacy-only user | canEdit true | **Different runtime** | isolated `canEditCardExperience` |
| Public URL | `/profile/{alias}` fallback; no `publicSlug` | `/{publicSlug}` = `kaka-pvc/business-card` | **Different** | live data + `customer-public-url.ts:44–54` |
| Permanent URL `/r` | `/r/mvz27lrzva` | `/r/mvz27lr78k` | Same pattern; card-owned | `r/[...slug]/route.ts:88–129` |
| Dashboard visibility | `/api/my/products` lists it; `/api/cards` requires `profile_edit` and is denied for legacy-only | full dashboard access | **Different runtime** | `api/cards/route.ts:21–23`; isolated capabilities |
| Templates/customization | `panthi-event`, profile configs present | `panthi-event`, same configs | Same for these live cards | live card docs |
| Analytics/tap tracking | no `tap_analytics` capability for legacy-only | `tap_analytics` | **Different runtime** | isolated capabilities |
| Contact saving / VCF | no `contact_save` capability; public profile gate can fail for legacy-only | `contact_save` | **Different runtime** | isolated features + `public-card-page.tsx` gate |
| WhatsApp / social links | no `social_links` capability | `social_links` | **Different runtime** | isolated features |
| Product entitlements | none | full BUSINESS_NFC_CARD capabilities | **Different runtime** | `capability-access.ts:107–164` |
| Review Management eligibility | false | false | Same (both not entitled) | isolated `getCardReviewEntitlement` |
| Admin assignment selector | shown (active catalog row) | shown | Both shown; only B succeeds | `api/admin/catalog/route.ts:17–31`; isolated assignment |
| New assignment workflow | **fails 400** (`Product kind 'null' cannot be allocated`) | succeeds 201 | **Different** | isolated `assignUserProduct` |
| Existing customer assignment | active, card exists | active, card exists | Both readable | live DB |
| Product activation/status | active | active | Same | live DB |
| API authorization (`profile_edit`) | denied for legacy-only | allowed | **Different runtime** | isolated capabilities |
| Legacy compatibility | existing card/route survive; missing entitlements/metadata | full | **Different** | isolated + live |
| Public slug allocation | `{ assigned: false }` | allocates `…/business-card`, `…-2` | **Different** | isolated `ensureCardPublicSlug` |
| Review Assistant card flag | present/enabled on live card | present/enabled on live card | Same card-level flag; both not entitled | live DB + `getCardReviewEntitlement` |

---

## D. Entitlement Comparison

Isolated runtime comparison used exact live product shapes (`nfc-card` with `kind: null`; `business-nfc-card` with `kind: profile`), one customer each, one active assignment each.

### Feature access

| Feature | NFC Business Card | Business NFC Card |
|---|---|---|
| profile | false | true |
| social | false | true, max 4 |
| review | false | false |
| standee | false | false |

### Capability access

| Product | Capabilities |
|---|---|
| NFC Business Card | `[]` |
| Business NFC Card | `qr`, `nfc`, `public_profile`, `profile_edit`, `contact_save`, `social_links`, `catalogue`, `portfolio`, `lead_capture`, `dynamic_link`, `multi_language`, `tap_analytics`, `dynamic_dashboard` |

### Review Management

Both `getCardReviewEntitlement` results:

```
{ entitled: false, source: 'none' }
```

Neither product grants Review Management. The `reviewAssistant` block present on the live cards does not create entitlement; entitlement is product-driven.

### Runtime gates

| Check | NFC Business Card | Business NFC Card |
|---|---|---|
| `canUseFeature(user,'profile')` | false | true |
| `canEditCardExperience` | false | true |
| `resolveCardPreview` | `/profile/deep-a` | `/deep-b/business-card` |
| `resolveCardDestination` | `/profile/deep-a?src=qr` | `/deep-b/business-card` |
| `getPublicProductSlug` | null | `business-card` |
| `ensureCardPublicSlug` | `{ assigned: false }` | `{ assigned: true, publicSlug: '…/business-card-2' }` |
| New assignment | 400 — kind null | 201 |

A customer with only the legacy product cannot edit their card or use profile/social/contact/tap APIs, even though the card document itself renders the profile page if a different product grants `profile`.

---

## E. Assignment Compatibility

- Live customer `kaka-pvc` has both assignments active.
- The canonical card gets a branded `publicSlug`; the legacy card does not.
- The legacy assignment/card remains readable, but contributes no product capabilities.
- Current assignment path rejects a new legacy assignment because `kind` is null.
- Admin Assign Product dropdown lists both because `/api/admin/catalog` returns all active non-PVC rows; selecting the legacy row would fail at submission.
- Admin Products page does not show the legacy row because it renders only hard-coded `PRODUCT_CATALOG` entries; the Customer My Products surface shows the legacy assignment name because it reads the assigned catalog row.

---

## F. Exact Differences

1. **Missing canonical identity:** `nfc-card` is not a `ProductId` and is not in `LEGACY_PRODUCT_SLUGS`, so entitlement, review, public-slug, and capability resolution all return empty.
2. **Missing `kind`:** `nfc-card.kind` is null. `resolveFeatureAccess` gives no experience grants; `assignUserProduct` rejects new card allocation.
3. **No public product slug:** `getPublicProductSlug('nfc-card')` is null, so the existing card cannot receive a branded `publicSlug`; display falls back to `/profile/{alias}`.
4. **Assignment workflow:** legacy row is active and visible in the admin assignment selector but cannot be assigned through current code.
5. **No customer-facing feature access for legacy-only owners:** no profile_edit, contact_save, social_links, tap_analytics, etc., despite a valid Card/profile document.

The live cards themselves have identical template/configuration shapes; the differences are product metadata/entitlement differences, not intentional feature differences.

---

## G. Recommended Safe Action

**Do not merge, delete, or rename either product.**

Recommended sequence (requires approval):

1. **Add read-time legacy mapping** in `src/lib/services/product-identity.ts`:
   ```ts
   'nfc-card': 'BUSINESS_NFC_CARD'
   ```
   This is non-destructive and makes existing `nfc-card` assignments resolve the canonical product definition (capabilities, feature grants, review policy, public slug mapping).
2. **Hide/deactivate `nfc-card` from new assignment discovery** after verifying existing assignments remain readable. The Admin User Details assignment selector should stop offering it; historical assignments and customer displays must remain.
3. **Optionally backfill the existing target card's `publicSlug`** via an approved, idempotent allocation (e.g. `kaka-pvc/business-card-2`) so `/profile/digital-mvz27lryec` can be replaced in customer-facing display. This is a data/identifier change and must be approved separately.
4. Keep `/profile/digital-mvz27lryec`, `/r/mvz27lrzva`, and all existing links working throughout.
5. Do not remove the legacy catalog row until all historical assignments, analytics, and support references are verified.

If mapping is not approved, at minimum hide `nfc-card` from new assignment while preserving the existing assignment; do not change its entitlements or data.

---

## H. Risks of Merging/Deleting

| Action | Risk |
|---|---|
| Delete `nfc-card` | Breaks active UserProduct assignment, card display, support/history; not safe |
| Rename `nfc-card` | Does not fix canonical resolution; could confuse historical records |
| Merge assignments into `business-nfc-card` | Changes product ownership/history and may duplicate card-assignment constraints |
| Deactivate `nfc-card` without mapping | Hides new assignment but existing legacy customer still lacks entitlements/public slug |
| Add read-time mapping | Restores capabilities/feature grants/public slug mapping without rewriting records; low data risk but changes effective entitlements, so approval needed |
| Backfill `publicSlug` | Creates a new immutable identifier; requires uniqueness/reservation approval |

No change is safe to apply silently.

---

## I. Test Results

| Test | Result |
|---|---|
| Isolated runtime comparison (features, capabilities, review, preview, destination, edit, assignment, publicSlug) | Completed; see §D |
| PPL-01 customer QR | 18/18 |
| PPL-02 immutable URLs | 23/23 |
| PPL03-01 alias collision | 8/8 |
| PPL04/05 permanent URL separation | 16/16 |
| PPL-06 alias validation | 41/41 |
| PPL-07 redirect safety | 11/11 |
| Customer Public URL display | 28/28 |
| Security boundaries | PASS |
| Dynamic routing | 29/29 |
| Card binding | 49/49 |
| Standee review | 20/20 |
| Review Management | 58/58 |
| Dashboard entitlement | 130/130 |
| `test-phase4d10p2-preview-routing.ts` | 15/16 — known stale `review-noalias` fixture; unrelated |
| `tsc --noEmit` | PASS |
| `next lint` | PASS |
| `npm run build` | PASS |

The deep runtime test used an isolated database (`branddeep_runtime2`) and was dropped afterward. No live customer data was written.

---

## J. Final Classification

**B. FUNCTIONAL DUPLICATE.**

`nfc-card` (“NFC Business Card”) and `business-nfc-card` (“Business NFC Card”) are the same intended lower-tier Business/Profile NFC card. They are not exact duplicates at runtime because the legacy row is missing `kind` and canonical product identity, which causes:

- no feature/capability grants,
- no public product slug or branded Public URL,
- failed new assignment,
- denied profile editing/API access for legacy-only customers.

The canonical `business-nfc-card` is the supported product for future assignments. The legacy row should be preserved for historical compatibility and, if approved, mapped read-time to `BUSINESS_NFC_CARD` and hidden from new assignment discovery.

**No code, database, product, entitlement, assignment, or environment changes were made.**
