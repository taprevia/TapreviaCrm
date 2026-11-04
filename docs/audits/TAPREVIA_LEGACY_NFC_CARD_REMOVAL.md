# Taprevia — Legacy NFC Business Card Removal

**Date:** 2026-11-04  
**Branch:** `Devlopment`  
**HEAD:** `0191bc1889c95e5716afa2f8f67a991ac131c101`  
**Mode:** Verify → backup → isolated migration → validate → rollback test → regression → report → stop  
**Live database:** `mongodb://127.0.0.1:27017/nfc-crm` (unchanged)  
**Isolated clone:** `mongodb://127.0.0.1:27017/legacy_nfc_removal_clone_20261104T064020`  
**Final status:** **`ISOLATED MIGRATION VERIFIED`**

---

## 1. Executive Summary

The confirmed legacy duplicate product was removed successfully **only in an isolated clone**:

- Removed: `nfc-card` — “NFC Business Card” — `_id 6a8e70e8c6d1bfed0bd99d7a` — `kind: null`
- Preserved: `business-nfc-card` — “Business NFC Card” — `_id 6ae851d69391bf20babb51f0` — `kind: profile` — canonical `BUSINESS_NFC_CARD`
- Migrated: exactly one assignment, `catalogProductId` changed to the canonical product
- Preserved: both customer cards, both card ObjectIds, all card content, both URL identities, all analytics, and billing fields
- Preserved: every other catalog product and every other assignment

**The live `nfc-crm` database still contains all 17 products and was not modified.** A live read-only dry-run confirmed the migration is ready. No destructive live operation was executed.

Isolated results:

| Result | Outcome |
|---|---|
| Catalog products before → after | **17 → 16** |
| Products removed | **exactly 1** — `6a8e70e8c6d1bfed0bd99d7a` |
| Assignments changed | **exactly 1** — `6ae85874efc853c66c8a1118` (`catalogProductId` + `updatedAt`) |
| Cards changed | **0** |
| Other collections changed | **0** |
| Rollback restoration | **exact match, 0 diffs** |
| Idempotency | **pass** |
| URL compatibility | **pass** |
| Entitlement/Review policy | **pass** |
| Regression suite | **pass** |

---

## 2. Verified Legacy Product Identity

The target was verified by full ObjectId, slug, name, and kind — never by suffix alone.

| Field | Value |
|---|---|
| `_id` | `6a8e70e8c6d1bfed0bd99d7a` |
| Slug | `nfc-card` |
| Name | `NFC Business Card` |
| `kind` | `null` |
| Category | `card` |
| Active | `true` |
| Price | `99900` INR |
| `createdAt` | `2026-08-26T04:51:52.434Z` |
| `updatedAt` | `2026-08-26T14:01:56.185Z` |
| Canonical ProductId | none |
| Active assignments | 1 |

Backup copy: `/Users/prince/Documents/CRM-backups/legacy-nfc-card-removal/20261104T064012Z/target-product.json`

---

## 3. Verified Canonical Product Identity

| Field | Value |
|---|---|
| `_id` | `6ae851d69391bf20babb51f0` |
| Slug | `business-nfc-card` |
| Name | `Business NFC Card` |
| `kind` | `profile` |
| Canonical ProductId | `BUSINESS_NFC_CARD` |
| Active | `true` |
| Price | `99900` INR |
| Active assignments before | 1 |
| Active assignments after isolated migration | 2 |

The canonical document was compared byte-for-byte before and after migration: **unchanged**.

Its seeded definition remains in `scripts/seed.ts`. Its identity resolution remains in `src/lib/services/product-identity.ts:12–23` and its experience mapping in `src/lib/feature-keys.ts:124–134`.

---

## 4. Full Product Inventory — Before / After

Live inventory before (17) and isolated clone after migration (16). Assignment counts are whole-document counts, including active and removed assignments.

| # | Product `_id` | Slug | Name | Kind | Category | Active | Price | Assignments before | Assignments after |
|---|---|---|---|---|---|---|---|---|---|
| 1 | `6a8e8fa7f0112218b4c33b46` | `qa-nexus-card` | qa-nexus Card [qa-residue-do-not-use] | null | card | true | 49900 | 3 | 3 |
| 2 | `6a8e8fa7f0112218b4c33b4a` | `qa-nexus-standee` | qa-nexus Standee [qa-residue-do-not-use] | null | standee | true | 249900 | 2 | 2 |
| 3 | `6a8e8fa7f0112218b4c33b4e` | `qa-nexus-gizmo` | qa-nexus Gizmo Deactivated [qa-residue-do-not-use] | null | other | false | 9900 | 1 | 1 |
| 4 | `6a8ee86c23096e5a739c86ae` | `qa-ev-other-probe-10433` | qa-ev Other Probe 10433 | null | other | true | 5000 | 1 | 1 |
| 5 | `6a8e70e8c6d1bfed0bd99d7a` | `nfc-card` | NFC Business Card | null | card | true | 99900 | 1 | **removed** |
| 6 | `6ae851d69391bf20babb51f0` | `business-nfc-card` | Business NFC Card | profile | card | true | 99900 | 1 | **2** |
| 7 | `6a8e70e8c6d1bfed0bd99d7b` | `counter-standee` | Counter Standee | null | standee | true | 249900 | 1 | 1 |
| 8 | `6ae851d69391bf20babb51f5` | `premium-nfc-card` | Premium NFC Card | profile | card | true | 199900 | 1 | 1 |
| 9 | `6ae851d69391bf20babb51f8` | `insta-card` | Insta Card | social | card | true | 149900 | 1 | 1 |
| 10 | `6ae851d69391bf20babb51fb` | `google-review-card` | Google Review Card | review | card | true | 149900 | 1 | 1 |
| 11 | `6ae851d69391bf20babb51fe` | `linkedin-card` | LinkedIn Card | social | card | true | 149900 | 1 | 1 |
| 12 | `6ae851d69391bf20babb5201` | `facebook-card` | Facebook Card | social | card | true | 149900 | 1 | 1 |
| 13 | `6ae851d69391bf20babb5204` | `google-review-standee` | Google Review Standee | standee | standee | true | 249900 | 1 | 1 |
| 14 | `6ae851d69391bf20babb5207` | `business-profile-standee` | Business Profile Standee | standee | standee | true | 249900 | 1 | 1 |
| 15 | `6ae851d69391bf20babb520a` | `all-in-one-standee-3` | All In One Standee - 3 Profile | standee | standee | true | 399900 | 1 | 1 |
| 16 | `6ae851d69391bf20babb520d` | `all-in-one-standee-4` | All In One Standee - 4 Profile | standee | standee | true | 499900 | 1 | 1 |
| 17 | `6ae851d69391bf20babb5210` | `google-review-nfc-plate` | Google Review NFC Plate | review | card | true | 299900 | 1 | 1 |

### Invariant result

A full-document comparison of every collection before and after was run. The only differences were:

1. `catalogproducts`: removed exactly `6a8e70e8c6d1bfed0bd99d7a`.
2. `userproducts`: exactly `6ae85874efc853c66c8a1118` changed `catalogProductId` and `updatedAt`.

No other product, assignment, card, analytics row, profile, user, standee, review, template, tenant, or counter record changed.

The four `qa-*` residue products are outside this task’s scope and were preserved unchanged.

---

## 5. Complete Dependency Scan

### 5.1 Database reference scan

Every collection was scanned recursively for:

- the exact legacy ObjectId `6a8e70e8c6d1bfed0bd99d7a`
- the exact slug string `nfc-card`
- the exact name string `NFC Business Card`

| Collection | Document | Path | Classification |
|---|---|---|---|
| `catalogproducts` | `6a8e70e8c6d1bfed0bd99d7a` | `_id`, `slug`, `name` | **Remove** (the exact target) |
| `userproducts` | `6ae85874efc853c66c8a1118` | `catalogProductId` | **Must migrate** |
| `cards` | `6ae85874efc853c66c8a1112` | `cardLabel` = `NFC Business Card` | **Historical content — retain unchanged** |

No other collection referenced the target ObjectId, slug, or name.

The card `cardLabel` is customer-visible content chosen on the card, not a foreign key to the catalog. It was deliberately not rewritten.

### 5.2 Code and seed scan

| Area | Finding | Classification |
|---|---|---|
| Exact catalog slug `nfc-card` in `src/` or `scripts/` | **No references** except this removal script | Safe |
| `scripts/seed.ts` | Seeds canonical `business-nfc-card`; does **not** create `nfc-card` | Safe |
| `src/lib/services/product-identity.ts` | Only canonical IDs and `premium-card` legacy mapping; no `nfc-card` mapping | Retain |
| `src/lib/services/capability-access.ts` | Resolves capabilities by canonical product identity, not display name | Retain |
| `src/lib/services/feature-access.ts` / `feature-keys.ts` | Resolves by product `kind`; target was `null` | Retain |
| `src/lib/services/human-url.ts` | Canonical public slug mapping; no `nfc-card` entry | Retain |
| `src/app/api/admin/catalog/route.ts:17–31` | Lists active catalog rows dynamically; deleted row disappears automatically | No change needed |
| `src/app/api/my/products/route.ts` | Populates assignment’s catalog row; migrated assignment now shows canonical | No change needed |
| `src/app/r/[...slug]/route.ts:90–123` | Resolves Cards by `routeSlug` / `uid`, not by catalog slug | Retain |
| `src/app/profile/[alias]/page.tsx` | Resolves Card by alias | Retain |
| `src/lib/services/customer-public-url.ts` | Uses card `publicSlug`, then alias fallback | Retain |
| `src/lib/services/review-product-connection.ts:111–123` | Central-ON policy blocks legacy source while central/hybrid connected | Retain |
| `src/lib/review-feature-flags.ts:29–30` | Runtime Review gates, unrelated to catalog deletion | Retain |
| `src/app/(public)/contacts/page.tsx:71–114` | Marketing copy “NFC Business Card” | Retain — generic commerce copy, not the catalog slug |
| `src/components/marketing/sections/Hero.tsx:124`, `PreBookingSection.tsx:8–9` | Marketing copy | Retain |
| `src/config/products.ts:132` | Comment about Premium NFC Business Card | Retain |

### 5.3 Classification

1. **Safe to remove:** the exact `catalogproducts` record.
2. **Must migrate:** one `userproducts.catalogProductId`.
3. **Must retain for backward compatibility:** `/r`, `/profile`, `/review`, `/c`, `/qr`, card identifiers, trust/analytics, marketing copy, central-review policy.
4. **Historical reference that must remain unchanged:** the legacy card’s `cardLabel`, URLs, analytics, and billing fields.
5. **Unresolved dependencies:** **none**.

---

## 6. Existing Assignment Analysis

### Legacy assignment

| Field | Value |
|---|---|
| `_id` | `6ae85874efc853c66c8a1118` |
| `userId` | `6ae85874efc853c66c8a10f3` |
| `catalogProductId` | `6a8e70e8c6d1bfed0bd99d7a` (target) |
| `cardId` | `6ae85874efc853c66c8a1112` |
| Status | `active` |
| Quantity | `1` |
| `unitPriceMinor` | `99900` |
| `createdAt` | `2026-11-02T09:31:32.743Z` |
| `assignedBy` | `6a89fcb0d1c80f17f7a2a8f6` |

### Both customer cards

| Attribute | Legacy card | Canonical card |
|---|---|---|
| Card `_id` | `6ae85874efc853c66c8a1112` | `6ae85874efc853c66c8a10fe` |
| Card UID | `DIGITAL-MVZ27LRYEC` | `DIGITAL-*` |
| `slug` / `urlAlias` | `digital-mvz27lryec` | `digital-mvz27lr4e3` |
| `routeSlug` / `uid` | `mvz27lrzva` | `mvz27lr78k` |
| `publicSlug` | `null` | `kaka-pvc/business-card` |
| Kind | `profile` | `profile` |
| Template | `panthi-event` | `panthi-event` |
| Status / active | `active` / `true` | `active` / `true` |
| Review entitlement | `false` | `false` |

Both cards belong to the same customer. Duplicate canonical assignments are supported because `UserProduct` has no unique `(userId, catalogProductId)` index — only `userId+status`, `catalogProductId`, and `cardId` indexes (`src/models/UserProduct.ts:69–71`).

The migration did not create a second assignment. It repointed the existing assignment, so the customer still has exactly two card assignments total.

---

## 7. Migration Design

Script added:

`scripts/migrate-remove-legacy-nfc-card.ts`

### Exact identity constants

```ts
TARGET_ID   = 6a8e70e8c6d1bfed0bd99d7a
TARGET_SLUG = 'nfc-card'
TARGET_NAME = 'NFC Business Card'
CANONICAL_ID   = 6ae851d69391bf20babb51f0
CANONICAL_SLUG = 'business-nfc-card'
CANONICAL_NAME = 'Business NFC Card'
```

### Sequence

1. Refuse Atlas/production URIs.
2. Verify resolved DB name matches `MONGODB_URI`.
3. Refuse unknown database names.
4. Live `nfc-crm` writes require `--allow-live-destructive`; read-only dry-runs are allowed.
5. Assert canonical product exists with exact `_id`, slug, name, `kind: profile`, and `active: true`.
6. Assert target exists with exact `_id`, slug, name, and `kind: null`.
7. Find assignments whose `catalogProductId` is exactly the target ObjectId.
8. Reject any same-card duplicate canonical assignment.
9. Confirm the only non-display reference is `userproducts`.
10. Update each assignment’s `catalogProductId` to the canonical ObjectId; set `updatedAt`.
11. Re-scan for legacy references.
12. Delete exactly one product guarded by `_id + slug + name`.
13. Verify deletion count is exactly 1.
14. Verify canonical product is byte-identical to its pre-migration document.
15. Verify every migrated assignment preserved `userId`, `cardId`, status, quantity, unit price, `createdAt`, and `assignedBy`.
16. Verify both cards still exist with unchanged ownership and identifiers.

### Safety properties

- Dry-run by default; `--apply` required for writes.
- ID-based scope, not name/slug replacement.
- Idempotent: second apply detects the target absent and no references, then exits without writes.
- Rollback mode: `--rollback <backupDir> --apply`.
- No schema, index, seed, or environment changes.

---

## 8. Isolated Migration Results

### Clone creation

- Source: `nfc-crm`
- Clone: `legacy_nfc_removal_clone_20261104T064020`
- Dump/restore: **224 documents restored, 0 failures**
- Collection list and per-collection counts matched the source exactly.

### Applied migration

```
Database: legacy_nfc_removal_clone_20261104T064020
Mode: APPLY
Legacy product verified: _id=6a8e70e8c6d1bfed0bd99d7a slug=nfc-card name=NFC Business Card kind=null
Assignments to migrate: 1
  assignment 8a1118 card 8a1112 status active
  reference: userproducts/8a1118 at catalogProductId
Migrated assignments: 1
Deleted legacy catalog product: 1 document
Preserved card 8a1112 routeSlug=mvz27lrzva urlAlias=digital-mvz27lryec publicSlug=null
```

### Post-migration diff

| Collection | Before | After | Difference |
|---|---|---|---|
| `catalogproducts` | 17 | 16 | Removed `6a8e70e8c6d1bfed0bd99d7a` |
| `userproducts` | 20 | 20 | `6ae85874efc853c66c8a1118` changed `catalogProductId`, `updatedAt` |
| `cards` | 15 | 15 | None |
| All other collections | unchanged | unchanged | None |

### Idempotency

A second `--apply` run returned:

```
Already applied: legacy product and references are absent. No changes made.
```

No documents were inserted, updated, or deleted on the second run.

---

## 9. Exact Application Files Changed

| File | Change |
|---|---|
| `scripts/migrate-remove-legacy-nfc-card.ts` | **Added** — idempotent migration + rollback + live safety guard |
| `docs/audits/TAPREVIA_LEGACY_NFC_CARD_REMOVAL.md` | **Added** — this report |

No existing application source file, model, schema, index, route, seed, entitlement, or environment file was changed.

The pre-existing working tree (59 uncommitted entries) was preserved. No commit, push, or deploy was performed.

---

## 10. Exact Database Records Affected in the Test Clone

### Deleted

| Collection | `_id` | Identity |
|---|---|---|
| `catalogproducts` | `6a8e70e8c6d1bfed0bd99d7a` | `nfc-card` / “NFC Business Card” / `kind: null` |

### Updated — one assignment

Before:

```json
{
  "_id": "6ae85874efc853c66c8a1118",
  "userId": "6ae85874efc853c66c8a10f3",
  "catalogProductId": "6a8e70e8c6d1bfed0bd99d7a",
  "cardId": "6ae85874efc853c66c8a1112",
  "standeeId": null,
  "pendingConfig": null,
  "quantity": 1,
  "unitPriceMinor": 99900,
  "status": "active",
  "notes": "",
  "assignedBy": "6a89fcb0d1c80f17f7a2a8f6",
  "createdAt": "2026-11-02T09:31:32.743Z",
  "updatedAt": "2026-11-02T09:31:32.743Z",
  "__v": 0
}
```

After:

```json
{
  "_id": "6ae85874efc853c66c8a1118",
  "userId": "6ae85874efc853c66c8a10f3",
  "catalogProductId": "6ae851d69391bf20babb51f0",
  "cardId": "6ae85874efc853c66c8a1112",
  "standeeId": null,
  "pendingConfig": null,
  "quantity": 1,
  "unitPriceMinor": 99900,
  "status": "active",
  "notes": "",
  "assignedBy": "6a89fcb0d1c80f17f7a2a8f6",
  "createdAt": "2026-11-02T09:31:32.743Z",
  "updatedAt": "2026-11-04T06:41:46.450Z",
  "__v": 0
}
```

Only `catalogProductId` and `updatedAt` differ. Billing fields, ownership, card binding, status, quantity, notes, and history timestamps are intact.

### Unchanged

- Canonical product `6ae851d69391bf20babb51f0` — byte-identical.
- Both cards `6ae85874efc853c66c8a1112` and `6ae85874efc853c66c8a10fe`.
- All 19 other assignments.
- All 16 remaining products.
- All analytics, profiles, standees, review settings/templates, users, tenants, counters.

---

## 11. Customer-Card Preservation Results

Both cards were preserved in full.

| Preservation requirement | Legacy card | Canonical card |
|---|---|---|
| ObjectId unchanged | ✅ `6ae85874efc853c66c8a1112` | ✅ `6ae85874efc853c66c8a10fe` |
| Customer ownership unchanged | ✅ | ✅ |
| `slug` | ✅ `digital-mvz27lryec` | ✅ `digital-mvz27lr4e3` |
| `urlAlias` | ✅ `digital-mvz27lryec` | ✅ `digital-mvz27lr4e3` |
| `routeSlug` / `uid` | ✅ `mvz27lrzva` | ✅ `mvz27lr78k` |
| `publicSlug` | ✅ still `null` | ✅ `kaka-pvc/business-card` |
| `cardUid` | ✅ `DIGITAL-MVZ27LRYEC` | ✅ unchanged |
| Kind | ✅ `profile` | ✅ `profile` |
| Template | ✅ `panthi-event` | ✅ `panthi-event` |
| Profile configs / content | ✅ unchanged | ✅ unchanged |
| Activation status | ✅ active | ✅ active |
| Analytics / taps | ✅ unchanged in clone | ✅ unchanged in clone |

**No `publicSlug` backfill was performed.** The legacy card was not redirected to the customer’s canonical card.

---

## 12. URL Compatibility Verification

HTTP verification was run against a **second disposable clone** of the post-migration state, served on `127.0.0.1:3503`, then dropped.

| URL | Result | Evidence |
|---|---|---|
| `/r/mvz27lrzva` | **307** → `/profile/digital-mvz27lryec?src=qr` | Permanent legacy card route preserved |
| `/profile/digital-mvz27lryec` | **200** | Legacy card rendered; “prince bhimani” present |
| `/r/mvz27lr78k` | **307** → `/kaka-pvc/business-card` | Canonical card route preserved |
| `/kaka-pvc/business-card` | **200** | Canonical public URL preserved |
| `/profile/digital-mvz27lr4e3` | **200** | Canonical legacy alias preserved |

The legacy card was **not** redirected to the canonical card. The HTTP clone recorded 2 analytics rows and one tap increment as expected from `/r`; those writes occurred only in the disposable clone, which was dropped. The live database analytics and tap count remain unchanged.

Route logic remains in `src/app/r/[...slug]/route.ts:90–123`, and card destinations remain card-owned.

---

## 13. Entitlement Verification

### Actual migrated assignment in the clone

| Check | Result |
|---|---|
| Assignment product | `business-nfc-card` / `BUSINESS_NFC_CARD` |
| Product `kind` | `profile` |
| `canEditCardExperience` for the formerly legacy card | **true** |
| `profile_edit` | **granted** |
| `contact_save` | **granted** |
| `social_links` | **granted** |
| `tap_analytics` | **granted** |
| Preview | `/profile/digital-mvz27lryec` |
| QR destination | `/profile/digital-mvz27lryec?src=qr` |
| Card review entitlement | **`{ entitled: false, source: 'none' }`** |
| Legacy `publicSlug` | still `null` |
| Branded public product slug | `business-card` (canonical only) |

This customer also owns Premium and other products, so their account-level feature set and capabilities already included review/standee and other grants. The migration did **not** add or remove any account-level entitlement; it restored canonical product identity and card-level access for the formerly legacy card. The card-level Review entitlement remains false.

### Synthetic post-migration account (only the migrated assignment)

To prove the product behavior without other owned products, an isolated synthetic DB was used:

| Check | Result |
|---|---|
| Capabilities | exactly 13 standard BUSINESS_NFC_CARD capabilities (`qr`, `nfc`, `public_profile`, `profile_edit`, `contact_save`, `social_links`, `catalogue`, `portfolio`, `lead_capture`, `dynamic_link`, `multi_language`, `tap_analytics`, `dynamic_dashboard`) |
| `profile` / `social` | enabled |
| `review` / `standee` | **false** |
| `canEdit` | true |
| Card review entitlement | false |
| New canonical assignment | **201** |
| Duplicate canonical assignments (same user, different cards) | supported; product IDs deduplicated |
| Public slug allocation | available (`…/business-card-2` in synthetic DB only) |

### Premium Review Management

Premium Review Management / Review Assistant remains **false** for the migrated card and for a canonical-only synthetic account. No Review entitlement rule or Premium product entitlement was modified.

The central-review policy remains in `src/lib/services/review-product-connection.ts:111–123`; it was not changed.

---

## 14. Product-by-Product Preservation Results

Full-document comparison result:

```text
catalogproducts: 17 before, 16 after
  removed: 6a8e70e8c6d1bfed0bd99d7a
  added: none
  changed: none
userproducts: 20 before, 20 after
  removed: none
  added: none
  changed: 6ae85874efc853c66c8a1118
  fields changed: catalogProductId, updatedAt
all other collections: identical
```

Every non-target product preserved:

- Same `_id`
- Same slug
- Same name
- Same `kind`
- Same category
- Same active/inactive status
- Same price/currency
- Same features/entitlements
- Same assignment relationships

The canonical `business-nfc-card` remains active, `kind: profile`, price `99900` INR, and available for new assignments (verified with a synthetic `assignUserProduct` returning **201**).

---

## 15. Regression Test Results

### Passed

| Suite | Result |
|---|---|
| PPL-01 stable NFC/QR | **18/18 PASS** |
| PPL-02 immutable identifiers | **23/23 PASS** |
| PPL03-01 alias collision | **8/8 PASS** |
| PPL-04/PPL-05 Permanent/Legacy separation | **16/16 PASS** |
| PPL-06 alias validation | **41/41 PASS** |
| PPL-07 redirect/cache/loop safety | **11/11 PASS** |
| Customer Public URL display | **28/28 PASS** |
| Product entitlements (M10 feature access) | **16/16 PASS** |
| Dashboard entitlements | **130/130 PASS** |
| Card binding | **49/49 PASS** |
| Dynamic routing | **29/29 PASS** |
| Security boundaries | **PASS** |
| Review Management | **58/58 PASS** |
| Standee Review | **20/20 PASS** |
| VCF generation | **69/69 PASS** |
| TypeScript `tsc --noEmit` | **PASS** |
| ESLint | **PASS** — no warnings/errors |
| Production build | **PASS** |

### Failed attributable to this removal

**None.**

### Test-environment notes

1. **Review Management:** the suite’s legacy-rollback assertions require `CENTRAL_REVIEW_PUBLIC_INTEGRATION_ENABLED=false`. With that gate OFF, the suite passed **58/58**. With central integration ON, legacy rollback is intentionally rejected by `connectReviewProduct` (400); that is existing policy, not a removal regression.
2. **Standee Review:** passed **20/20** with `STANDEE_REVIEW_ASSISTANT_ENABLED=true` and `CENTRAL_REVIEW_PUBLIC_INTEGRATION_ENABLED=false`. The documented central-ON variant produced **17/20**; the three failures all cascade from the same intentional “central ON blocks legacy source” policy and are unrelated to catalog deletion.
3. **Preview routing stale fixture:** `scripts/test-phase4d10p2-preview-routing.ts` is **NOT TESTED** in this run. It is the known stale `review-noalias` fixture previously reported at 15/16 and requires its own `taprevia_p24_` database/server. It is unrelated to the removed catalog row.
4. No unrelated test was modified to force a pass.

---

## 16. Rollback Test Results

Backup directory:

`/Users/prince/Documents/CRM-backups/legacy-nfc-card-removal/20261104T064012Z/`

Contents:

- `target-product.json`
- `canonical-product.json`
- `target-assignments.json`
- `target-cards.json`
- `snapshot-all-collections.json`
- `manifest.json` (SHA-256 per file)
- `snapshot-clone-after.json` (post-migration evidence)

### Rollback procedure tested

```bash
MONGODB_URI=mongodb://127.0.0.1:27017/legacy_nfc_removal_clone_20261104T064020 \
MONGODB_DB=legacy_nfc_removal_clone_20261104T064020 \
npx tsx scripts/migrate-remove-legacy-nfc-card.ts \
  --rollback /Users/prince/Documents/CRM-backups/legacy-nfc-card-removal/20261104T064012Z \
  --apply
```

Result:

- Legacy product restored with exact `_id`, slug, name, `kind: null`, timestamps, and `__v`.
- Assignment `6ae85874efc853c66c8a1118` restored to `catalogProductId 6a8e70e8c6d1bfed0bd99d7a` and original `updatedAt`.
- Both cards untouched.
- Full database snapshot comparison after rollback: **exact match, 0 diffs**.
- Migration was then re-applied; the only difference from the first post-migration snapshot was the expected `updatedAt` timestamp on the migrated assignment.

Rollback is verified in isolation. It has not been run against live data.

---

## 17. Remaining Risks and Blockers

| Item | Status / risk |
|---|---|
| Live `nfc-crm` still contains the legacy product | **Expected** — no live destructive write without approval |
| Approval to execute live migration | **Required blocker before live deletion** |
| Admin assignment selector | Until live deletion, `nfc-card` remains visible as an active catalog row. The current assignment guard rejects new legacy assignments (`kind: null`), but the row should be removed promptly after approval. |
| Concurrent writes during migration | The script is narrow and idempotent, but production should pause assignment/catalog writes during the apply window |
| Backup contains customer data | Backup is local, outside the git working tree, and must be protected/retained according to local data-handling policy |
| Isolated clone contains copied customer data | Retained locally for inspection; should be dropped after approval/closure |
| QA residue products | Out of scope and preserved exactly; not modified |
| External billing/transaction systems | No billing collection or external reference to the target was found in this database. If an external billing system stores the legacy catalog ID, reconcile it separately after approval. |
| Central Review policy | Existing behavior intentionally blocks legacy rollback while central integration is ON; not caused by this removal |

No safety condition failed. No unexpected dependency or inventory difference was found.

---

## 18. Proposed Production Migration Procedure

Do **not** execute until explicit approval is granted.

1. **Freeze writes** to product assignments, catalog administration, and card creation during the window.
2. **Re-verify identity:**
   ```bash
   MONGODB_URI=mongodb://127.0.0.1:27017/nfc-crm MONGODB_DB=nfc-crm \
     npx tsx scripts/migrate-remove-legacy-nfc-card.ts
   ```
   Expected: target `6a8e70e8c6d1bfed0bd99d7a`, one assignment, dry-run only.
3. **Take a fresh backup** to a new timestamped directory outside the repository.
4. **Apply with backup:**
   ```bash
   MONGODB_URI=mongodb://127.0.0.1:27017/nfc-crm MONGODB_DB=nfc-crm \
     npx tsx scripts/migrate-remove-legacy-nfc-card.ts \
       --apply --allow-live-destructive \
       --backup-dir /Users/prince/Documents/CRM-backups/legacy-nfc-card-removal/<new-timestamp>
   ```
5. **Verify:**
   - catalog count decreases by exactly 1;
   - assignment `6ae85874efc853c66c8a1118` points to `6ae851d69391bf20babb51f0`;
   - both cards retain ObjectIds, URLs, content, activation, and billing fields;
   - canonical product is byte-identical;
   - no references to the legacy `_id` or slug remain.
6. **Re-run the same command** to prove idempotency. Expect “Already applied”.
7. **Smoke test URLs** `/r/mvz27lrzva`, `/profile/digital-mvz27lryec`, `/r/mvz27lr78k`, and `/kaka-pvc/business-card`.
8. **Verify Review entitlement** for the formerly legacy card remains false.
9. **Rollback if any invariant fails:**
   ```bash
   MONGODB_URI=mongodb://127.0.0.1:27017/nfc-crm MONGODB_DB=nfc-crm \
     npx tsx scripts/migrate-remove-legacy-nfc-card.ts \
       --rollback <backup-dir> --apply --allow-live-destructive
   ```
10. **Unfreeze writes** only after verification passes.

The live migration must not be run without the separate approval the task requires.

---

## 19. Confirmation of No Production/Preview Changes

| Check | Result |
|---|---|
| Production accessed | **No** |
| Preview accessed | **No** |
| Atlas / `mongodb.net` accessed | **No** |
| Live `nfc-crm` modified | **No** — full snapshot exact match |
| Live product count | **17** (unchanged) |
| Live legacy product present | **Yes** (unchanged) |
| Live assignment still points to legacy | **Yes** (unchanged) |
| Live cards changed | **No** |
| Live analytics changed | **No** — 16 rows before and after |
| `.env.local`, `.env.preview`, `.env.example` changed | **No** — SHA-256 hashes unchanged |
| Commits / pushes / deploys | **None** |
| Production build | **Yes** — local build only, no deployment |
| Isolated clone | `legacy_nfc_removal_clone_20261104T064020` retained for inspection |
| Disposable HTTP clone | Dropped after verification |

Environment SHA-256:

```text
d5fa97f5b6730c3efa5a82bacc5b7e34c85adf149e94fe2b3916fac5a330f8ee  .env.local
161eca7b5ec8f3936a4cad36a35191a5fb622d619678cc217ab3e54fddaa72a5  .env.preview
2463e522db16e0d77ce69db06960f5d0daae6d892b241c7d11835f0091564a31  .env.example
```

---

## 20. Final Status

**`ISOLATED MIGRATION VERIFIED`**

The exact legacy duplicate was removed and the sole assignment migrated in an isolated clone. Both existing customer cards, all URLs, all analytics, billing fields, entitlements, and all 16 non-target products were preserved exactly. Rollback restored the original state with zero diffs.

The live `nfc-crm` database remains unchanged and still contains 17 products. **No destructive live operation was performed.** Live execution is ready for separate approval using the procedure in §18.
