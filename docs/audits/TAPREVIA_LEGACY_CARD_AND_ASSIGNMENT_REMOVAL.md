# Taprevia — Legacy NFC Business Card and Customer Assignment Removal

**Date:** 2026-11-04  
**Branch:** `Devlopment`  
**HEAD:** `0191bc1889c95e5716afa2f8f67a991ac131c101`  
**Mode:** Investigate → backup → isolated removal → verify → rollback test → regression → report → stop  
**Live database:** `mongodb://127.0.0.1:27017/nfc-crm` — **not modified**  
**Isolated clone:** `legacy_card_removal_clone_20261104T070711`  
**Final recommendation:** **SAFE TO APPLY**, subject to the URL-retirement condition in §8

---

## 1. Exact Records Proposed for Deletion

### Customer

| Field | Value |
|---|---|
| Email | `prince@gmail.com` |
| User `_id` | `6ae85874efc853c66c8a10f3` |
| Role / status | `customer` / `active` |

### Legacy card — delete

| Field | Value |
|---|---|
| `_id` | `6ae85874efc853c66c8a1112` |
| `cardLabel` | `NFC Business Card` |
| `routeSlug` / `uid` | `mvz27lrzva` |
| `urlAlias` / `slug` | `digital-mvz27lryec` |
| `cardUid` | `DIGITAL-MVZ27LRYEC` |
| `publicSlug` | `null` |
| Kind / status | `profile` / `active` |

### Legacy assignment — delete

| Field | Value |
|---|---|
| `_id` | `6ae85874efc853c66c8a1118` |
| `userId` | `6ae85874efc853c66c8a10f3` |
| `catalogProductId` | `6a8e70e8c6d1bfed0bd99d7a` |
| `cardId` | `6ae85874efc853c66c8a1112` |
| Status / quantity / unit price | `active` / `1` / `99900` INR |

### Legacy catalog product — delete

| Field | Value |
|---|---|
| `_id` | `6a8e70e8c6d1bfed0bd99d7a` |
| Slug | `nfc-card` |
| Name | `NFC Business Card` |
| `kind` | `null` |
| Category / active | `card` / `true` |

### Protected records — verified unchanged

| Record | Identity |
|---|---|
| Canonical card | `6ae85874efc853c66c8a10fe`; route `mvz27lr78k`; public slug `kaka-pvc/business-card`; alias `digital-mvz27lr4e3` |
| Canonical product | `6ae851d69391bf20babb51f0`; `business-nfc-card`; `Business NFC Card`; `kind: profile`; `BUSINESS_NFC_CARD` |

No other card, assignment, product, user, profile, standee, review, analytics, or media record is in scope.

---

## 2. Complete Dependency Audit

Every collection was scanned for the exact legacy card ID, assignment ID, product ID, route slug, URL alias, card UID, slug, and name.

### Database references found

| Collection | Document | Fields | Action |
|---|---|---|---|
| `cards` | `6ae85874efc853c66c8a1112` | `_id`, `userId`, `assignedUserId`, `cardUid`, `slug`, `urlAlias`, `routeSlug`, `uid`, `cardLabel` | Delete card |
| `userproducts` | `6ae85874efc853c66c8a1118` | `_id`, `userId`, `catalogProductId`, `cardId` | Delete assignment |
| `catalogproducts` | `6a8e70e8c6d1bfed0bd99d7a` | `_id`, `slug`, `name` | Delete product |

No other document contains any of those identifiers or URL strings.

### Collections explicitly checked — no references

| Area | Collection / model | Result |
|---|---|---|
| Tap / visitor analytics | `analyticslogs` | **0 rows** for card ID; no metadata with route/alias |
| Leads | `leads` | **0 rows** |
| Appointments | `appointments` | **0 rows** |
| Contact enquiries | `inquiries`, `productenquiries` | **0 rows** |
| Newsletter subscribers | `newslettersubscribers` | **0 rows** |
| Media / uploads | `media` | **0 rows** |
| Profile data | `profiles` | Profile belongs to the user, not the card; `cardId` is null |
| Catalog products / line items | `products` | **0 rows** |
| Review rotation | `reviewrotationevents`, `reviewrotationstates` | **0 rows** |
| Standees | `standees` | **0 rows** with the legacy card ID |
| vCards | `vcards` | **0 rows** |
| Orders / invoices / payments / subscriptions | No collection or model exists | No database records to migrate |
| Billing | `userproducts.unitPriceMinor` only | Deleted with the assignment; no separate billing document |
| QR/NFC payload inventory | No stored card-QR collection | QR/NFC payload is generated from `routeSlug`; no separate record |

The customer’s `Profile` and `User` documents are shared, not owned by the legacy card, and were preserved.

### Card content audit

The legacy card has:

- no gallery images,
- no uploaded media rows,
- no leads/enquiries,
- no analytics events,
- no appointments,
- no review rotation events,
- no public slug.

Its profile content is stored entirely on the card document and is removed with it. The user-level Profile remains.

---

## 3. Related Data at Risk

| Data | Risk | Decision |
|---|---|---|
| Legacy card document and its card content | Deleted by design | Approved scope |
| Legacy assignment and its `unitPriceMinor` record | Deleted by design | Approved scope |
| Legacy catalog product | Deleted by design | Approved scope |
| Shared customer profile | Would be dangerous | **Not modified** |
| Canonical card | Would be dangerous | **Not modified** |
| Canonical product | Would be dangerous | **Not modified** |
| Other customer cards and standees | Would be dangerous | **Not modified** |
| Other users’ data | Would be dangerous | **Not modified** |
| Analytics/leads/reviews | No references exist | **Not modified** |
| Physical/printed QR/NFC using `/r/mvz27lrzva` | Link will stop resolving | **Documented in §8** |

No cascade deletion was performed. There were no dependent records to cascade.

---

## 4. Before / After Database Counts

Isolated clone comparison; live database remains at the before state.

| Collection | Before | After | Change |
|---|---:|---:|---|
| `catalogproducts` | 17 | 16 | **−1** legacy product |
| `userproducts` | 20 | 19 | **−1** legacy assignment |
| `cards` | 15 | 14 | **−1** legacy card |
| `users` | 15 | 15 | 0 |
| `profiles` | 14 | 14 | 0 |
| `analyticslogs` | 16 | 16 | 0 |
| `standees` | 7 | 7 | 0 |
| `reviewtemplates` | 110 | 110 | 0 |
| `reviewsettings` | 1 | 1 | 0 |
| `reviewcategories` | 1 | 1 | 0 |
| `templates` | 4 | 4 | 0 |
| `tenantsettings` | 2 | 2 | 0 |
| `counters` | 2 | 2 | 0 |

Full-document comparison found exactly three removed documents and **zero changed documents** in every other collection.

Customer-level result:

| Check | Before | After |
|---|---:|---:|
| Active assignments | 13 | 12 |
| Cards | 8 | 7 |
| Legacy `nfc-card` assignments | 1 | **0** |
| Canonical `business-nfc-card` assignments | 1 | **1** |

The customer retains the canonical Business NFC Card plus their other unrelated products.

---

## 5. Isolated Test Results

### Removal script

Added: `scripts/remove-legacy-nfc-card-account.ts`

The script is:

- dry-run by default; `--apply` required for writes;
- refuses Atlas/production URIs;
- refuses live `nfc-crm` writes without `--allow-live-destructive`;
- identity-guarded by full ObjectId, slug, name, label, route slug, alias, and card UID;
- dependency-guarded — stops if any unexpected document references the trio;
- idempotent;
- rollback-capable from the backup directory.

### Applied in clone only

```text
Database: legacy_card_removal_clone_20261104T070711
Mode: APPLY
Exact records verified:
  card       6ae85874efc853c66c8a1112 label=NFC Business Card route=mvz27lrzva alias=digital-mvz27lryec
  assignment 6ae85874efc853c66c8a1118 product=6a8e70e8c6d1bfed0bd99d7a card=6ae85874efc853c66c8a1112
  product    6a8e70e8c6d1bfed0bd99d7a slug=nfc-card kind=null
Deleted legacy assignment: 1 document
Deleted legacy card: 1 document
Deleted legacy catalog product: 1 document
Removal applied successfully. Canonical card/product untouched.
```

A second `--apply` returned:

```text
Already applied: card, assignment and product are absent. No changes made.
```

### Post-removal orphan scan

Scanned every collection for the card ID, assignment ID, product ID, route slug, alias, card UID, product slug, and old name:

```json
{
  "hits": [],
  "counts": { "catalog": 16, "assignments": 19, "cards": 14 },
  "customerActiveAssignments": 12,
  "customerHasCanonical": true,
  "customerHasLegacy": false
}
```

### Customer dashboard verification

An HTTP server was started against a disposable post-removal clone and queried with a real customer JWT.

`GET /api/my/products` returned **12 products**:

- `NFC Business Card` / `nfc-card`: **absent**
- `Business NFC Card` / `business-nfc-card`: **present**
- Card `6ae85874efc853c66c8a10fe`, public URL `/kaka-pvc/business-card`: **present**

### Canonical URL verification

| URL | Result |
|---|---|
| `/r/mvz27lr78k` | **307** → `/kaka-pvc/business-card` |
| `/kaka-pvc/business-card` | **200** |
| `/profile/digital-mvz27lr4e3` | **200** |

### Retired legacy URL verification

| URL | Result |
|---|---|
| `/r/mvz27lrzva` | **404 Not Found** |
| `/profile/digital-mvz27lryec` | **404** |

This is expected after deleting the card. No tombstone or redirect was implemented.

---

## 6. Regression Test Results

All tests were run against isolated test databases; none touched `nfc-crm`.

| Suite | Result |
|---|---|
| PPL-01 stable NFC/QR | **18/18 PASS** |
| PPL-02 immutable identifiers | **23/23 PASS** |
| PPL03-01 alias collision | **8/8 PASS** |
| PPL-04/PPL-05 Permanent/Legacy separation | **16/16 PASS** |
| PPL-06 alias validation | **41/41 PASS** |
| PPL-07 redirect/cache/loop safety | **11/11 PASS** |
| Customer Public URL display | **28/28 PASS** |
| Dashboard entitlements | **130/130 PASS** |
| Product entitlements (M10) | **16/16 PASS** |
| Card binding | **49/49 PASS** |
| Dynamic routing | **29/29 PASS** |
| Security boundaries | **PASS** |
| Review Management | **58/58 PASS** |
| Standee Review | **20/20 PASS** |
| VCF generation | **69/69 PASS** |
| TypeScript `tsc --noEmit` | **PASS** |
| ESLint | **PASS** — no warnings/errors |
| Production build | **PASS** |

**Failures attributable to this removal: none.**

The known stale `review-noalias` preview-routing fixture remains **NOT TESTED** in this run; it is unrelated to this card removal.

---

## 7. Backup and Rollback Verification

### Backup

`/Users/prince/Documents/CRM-backups/legacy-card-removal/20261104T070705Z/`

Contents:

- `target-card.json`
- `target-assignment.json`
- `target-product.json`
- `customer-user.json`
- `customer-profile.json`
- `canonical-card.json`
- `canonical-product.json`
- `snapshot-all-collections.json`
- `manifest.json` with SHA-256 hashes
- `snapshot-clone-after-removal.json` (post-removal evidence)

### Rollback test

```bash
MONGODB_URI=mongodb://127.0.0.1:27017/legacy_card_removal_clone_20261104T070711 \
MONGODB_DB=legacy_card_removal_clone_20261104T070711 \
npx tsx scripts/remove-legacy-nfc-card-account.ts \
  --rollback /Users/prince/Documents/CRM-backups/legacy-card-removal/20261104T070705Z \
  --apply
```

Result:

- Legacy product restored.
- Legacy card restored.
- Legacy assignment restored.
- Target documents compared to backup: **all three EXACT**.
- All persistent collections compared to the original snapshot: **exact match**.
- Only a `ratecounters` TTL document differed: it expired naturally at `2026-11-04T07:08:39.545Z` after the backup. It is a transient rate-limit counter, unrelated to the removal, and was not restored.
- The removal was then re-applied; the persistent post-removal state matched the first removal exactly.

Rollback is verified in isolation. It has not been run against live data.

---

## 8. Route Retirement / Tombstone Decision

Deleting the card removes the database resolution for:

- `/r/mvz27lrzva`
- `/profile/digital-mvz27lryec`

Both return **404** after deletion.

### Is a redirect or tombstone necessary?

- **No, if the legacy digital card and its links are intentionally retired.** The card was a `DIGITAL-` UID card with no taps, no analytics, no leads, and no public slug. Its routes can be retired with it.
- **Yes, if the old QR/NFC URL is still printed, shared, or expected to work.** In that case the safe handling would be a `410 Gone` tombstone or an explicit redirect to the canonical card. This would require separate routing/code approval and was **not implemented** because it changes existing route behavior and is outside the requested deletion scope.

No route, slug, alias, or public slug was changed.

---

## 9. Unresolved Risks and Final Recommendation

### Unresolved risks

| Risk | Status |
|---|---|
| Old `/r/mvz27lrzva` and `/profile/digital-mvz27lryec` links stop working | **Known and documented**; acceptable only if legacy card is retired |
| No redirect/tombstone | **Not implemented**; requires separate approval if old links must remain usable |
| Backup contains customer data | Local backup outside the repo; protect per local policy |
| Isolated clone contains copied customer data | Retained for inspection; drop after approval/closure |
| Physical QR/NFC printed with old route | No evidence of a physical card (`DIGITAL-` UID), but distribution cannot be proven from the database |
| External billing/order systems | No local records exist; verify externally if applicable |

### Final recommendation

**SAFE TO APPLY** for the requested legacy-card removal, **provided** the legacy digital QR/URL is intentionally retired and a 404 for `/r/mvz27lrzva` and `/profile/digital-mvz27lryec` is acceptable.

If those old links must continue to work, do **not** apply until a separate tombstone/redirect decision is approved.

### Live state

The live `nfc-crm` database was **not modified**:

| Check | Value |
|---|---:|
| Products | 17 |
| Assignments | 20 |
| Cards | 15 |
| Analytics | 16 |
| Legacy card present | Yes |
| Legacy assignment present and pointing to `nfc-card` | Yes |
| Legacy product present | Yes |
| Canonical card/product | Unchanged |

No production/preview access, no commit, no push, no deployment. A read-only live dry-run confirmed the script is ready and made no writes.
