# Taprevia — Noncanonical Catalog Cleanup Audit

**Date:** 2026-11-04  
**Branch:** `Devlopment`  
**HEAD:** `0191bc1889c95e5716afa2f8f67a991ac131c101`  
**Mode:** Audit → backup → isolated deletion → verification → rollback → report → stop  
**Live database:** `mongodb://127.0.0.1:27017/nfc-crm` — **not modified**  
**Isolated clone:** `noncanonical_cleanup_clone_20261104T075409`  
**Final recommendation:** **NOT SAFE TO APPLY** for the full six-product cleanup

---

## 1. Executive Summary

The isolated cleanup was executed successfully and produced the requested technical result:

| Metric | Before | After |
|---|---:|---:|
| Catalog products | 17 | **11** |
| Assignments | 20 | **11** |
| Cards | 15 | **11** |
| Standees | 7 | **4** |
| Users | 15 | 15 |
| Profiles | 14 | 14 |

All 11 canonical products were preserved exactly, no orphan references remained, and rollback restored the original database exactly.

**However, the full cleanup is NOT SAFE TO APPLY** because it deletes:

- Prince’s **Counter Standee assignment** `6ae85874efc853c66c8a1137`
- Prince’s **Counter Standee** `6ae85874efc853c66c8a1134`
- Its live public URL **`/kaka-pvc/standee`**
- Its live route **`/r/mvz27lsyc6`**

That standee belongs to the genuine `prince@gmail.com` account and was serving HTTP 200 before cleanup. The task explicitly states that only prince’s previously identified legacy NFC card and assignment are eligible for deletion, and says to stop when an unwanted assignment points to a standee that may still be used.

The other five products and eight assignments are technically safe to clean up. The Counter Standee product/assignment/standee requires explicit separate approval or must remain.

---

## 2. Six Product IDs

| Product | `_id` | Slug | Raw `kind` | Active | Assignments |
|---|---|---|---|---|---:|
| qa-ev Other Probe 10433 | `6a8ee86c23096e5a739c86ae` | `qa-ev-other-probe-10433` | missing | true | 1 |
| qa-nexus Card [qa-residue-do-not-use] | `6a8e8fa7f0112218b4c33b46` | `qa-nexus-card` | missing | true | 3 |
| qa-nexus Standee [qa-residue-do-not-use] | `6a8e8fa7f0112218b4c33b4a` | `qa-nexus-standee` | missing | true | 2 |
| qa-nexus Gizmo Deactivated [qa-residue-do-not-use] | `6a8e8fa7f0112218b4c33b4e` | `qa-nexus-gizmo` | missing | **false** | 1 |
| NFC Business Card | `6a8e70e8c6d1bfed0bd99d7a` | `nfc-card` | missing | true | 1 |
| Counter Standee | `6a8e70e8c6d1bfed0bd99d7b` | `counter-standee` | missing | true | 1 |

All six are absent from `ALL_PRODUCT_IDS` / `PRODUCT_CATALOG` in `src/config/products.ts`.

---

## 3. Nine Targeted Assignments and Users

| # | Assignment `_id` | Product | User `_id` | Email | Status |
|---|---|---|---|---|---|
| 1 | `6a8ee88223096e5a739c86be` | qa-ev-other-probe-10433 | `6a8ee88223096e5a739c86b9` | `nexus-ev-c-10433@test.local` | removed |
| 2 | `6a8ee44823096e5a739c861b` | qa-nexus-card | `6a8ee44723096e5a739c860a` | `qa-fix-two@test.local` | active |
| 3 | `6a8ee5a323096e5a739c8655` | qa-nexus-card | `6a8ee44723096e5a739c860a` | `qa-fix-two@test.local` | removed |
| 4 | `6a8ee89323096e5a739c86c6` | qa-nexus-card | `6a8ee86c23096e5a739c86b2` | `nexus-ev-b-10433@test.local` | active |
| 5 | `6a8ee57e23096e5a739c863c` | qa-nexus-gizmo | `6a8ee44723096e5a739c860a` | `qa-fix-two@test.local` | active |
| 6 | `6a8ee30013e82da69dfaf91c` | qa-nexus-standee | `6a8ee2fe13e82da69dfaf910` | `qa-fix-user2@test.local` | active |
| 7 | `6a8ee78323096e5a739c86a3` | qa-nexus-standee | `6a8ee78223096e5a739c869b` | `nexus-ev-ac8-10433@test.local` | active |
| 8 | `6ae85874efc853c66c8a1118` | nfc-card | `6ae85874efc853c66c8a10f3` | `prince@gmail.com` | active |
| 9 | `6ae85874efc853c66c8a1137` | counter-standee | `6ae85874efc853c66c8a10f3` | `prince@gmail.com` | active — **blocker** |

Five accounts use `@test.local` addresses and QA fixture names. **No user accounts were deleted.** Prince’s account was preserved.

---

## 4. Associated Cards and Standees

### Cards — 4 targeted

| Card `_id` | Card UID | Assignment | Card status | URL risk |
|---|---|---|---|---|
| `6a8ee44723096e5a739c8600` | `qa-fix-card-9` | #2 | unassigned | No route/public URL |
| `6a8e919ff0112218b4c33bc9` | `qa-nexus-card-3` | #3 | unassigned | No route/public URL |
| `6a8e8fa5f0112218b4c33b42` | `qa-nexus-card-1` | #4 | active | No route/public URL |
| `6ae85874efc853c66c8a1112` | `DIGITAL-MVZ27LRYEC` | #8 | active | Prince legacy NFC card, previously authorized |

**Dependency found:** profile `6a8ee86d23096e5a739c86b4` (user `nexus-ev-b-10433@test.local`) has `cardId = 6a8e8fa5f0112218b4c33b42`. The cleanup plan clears this pointer; it does not delete the profile.

### Standees — 3 targeted

| Standee `_id` | Assignment | Owner | Route | Public URL | Risk |
|---|---|---|---|---|---|
| `6a8ee30013e82da69dfaf919` | #6 | `qa-fix-user2@test.local` | none | null | QA standee |
| `6a8ee78323096e5a739c86a0` | #7 | `nexus-ev-ac8-10433@test.local` | none | null | QA standee |
| `6ae85874efc853c66c8a1134` | #9 | `prince@gmail.com` | `mvz27lsyc6` | `kaka-pvc/standee` | **Live customer standee — blocker** |

Two QA users had `hasStandy = true`; the simulation reset it to `false` after their only standees were removed. Prince has four other canonical standees, so his `hasStandy` remains `true`.

---

## 5. Affected NFC/QR URLs

### Removed by the simulated cleanup

| URL | Before cleanup | After cleanup |
|---|---|---|
| `/r/mvz27lrzva` — prince legacy NFC card | 307 → `/profile/digital-mvz27lryec?src=qr` | **404** |
| `/profile/digital-mvz27lryec` | 200 | **404** |
| `/r/mvz27lsyc6` — prince Counter Standee | **200** | **404 — blocker** |
| `/kaka-pvc/standee` — prince Counter Standee | **200** | **404 — blocker** |

### Preserved canonical URLs

| URL | Result |
|---|---|
| `/r/mvz27lr78k` | 307 → `/kaka-pvc/business-card` |
| `/kaka-pvc/business-card` | 200 |
| `/kaka-pvc/premium-card` | 200 |
| `/kaka-pvc/standee-2` through `/kaka-pvc/standee-5` | 200 |
| `/r/mvz27lsd4h` | 307 → `/kaka-pvc/premium-card` |
| `/r/mvz27lt8jy` | 307 → Instagram |
| `/r/mvz27ltnip` | 307 → review host |
| `/r/mvz27lvofa` | 307 → review host |

Pre-existing 404s unrelated to cleanup were confirmed both before and after: `/kaka-pvc/linkedin`, `/kaka-pvc/facebook`, `/r/mvz27lu378`, `/r/mvz27luh0o`, `/r/mvz27luvka`.

---

## 6. Dependency Audit

Every collection was scanned for the six product IDs, nine assignment IDs, four card IDs, and three standee IDs.

### References found

- 6 catalog product documents
- 9 assignment documents
- 4 card documents
- 3 standee documents
- 1 profile pointer (`profiles.cardId` → `qa-nexus-card-1`)
- 2 user `hasStandy` flags affected by QA standee removal

### Collections with no references

- `analyticslogs`
- `leads`
- `appointments`
- `inquiries`
- `productenquiries`
- `newslettersubscribers`
- `media`
- `products`
- `reviewrotationevents`
- `reviewrotationstates`
- `vcards`
- `standeeqrs`

No orders, invoices, payments, or subscriptions collections/models exist. No external billing reference was found.

### No silent cascade

The deletion manifest is explicit: 9 assignments, 4 cards, 3 standees, 6 products, plus one profile pointer update and two `hasStandy` resets. No user, profile document, canonical product, canonical card, or unrelated record is deleted.

---

## 7. Exact Deletion Manifest

### Delete assignments

`6a8ee88223096e5a739c86be`, `6a8ee44823096e5a739c861b`, `6a8ee5a323096e5a739c8655`, `6a8ee89323096e5a739c86c6`, `6a8ee57e23096e5a739c863c`, `6a8ee30013e82da69dfaf91c`, `6a8ee78323096e5a739c86a3`, `6ae85874efc853c66c8a1118`, `6ae85874efc853c66c8a1137`

### Delete cards

`6a8ee44723096e5a739c8600`, `6a8e919ff0112218b4c33bc9`, `6a8e8fa5f0112218b4c33b42`, `6ae85874efc853c66c8a1112`

### Delete standees

`6a8ee30013e82da69dfaf919`, `6a8ee78323096e5a739c86a0`, `6ae85874efc853c66c8a1134`

### Delete products

`6a8ee86c23096e5a739c86ae`, `6a8e8fa7f0112218b4c33b46`, `6a8e8fa7f0112218b4c33b4a`, `6a8e8fa7f0112218b4c33b4e`, `6a8e70e8c6d1bfed0bd99d7a`, `6a8e70e8c6d1bfed0bd99d7b`

### Update

- `profiles` `6a8ee86d23096e5a739c86b4`: `cardId` → `null`
- `users` `6a8ee2fe13e82da69dfaf910`: `hasStandy` → `false`
- `users` `6a8ee78223096e5a739c869b`: `hasStandy` → `false`

### Never delete

- All 15 user accounts
- All 14 profiles
- All 11 canonical products
- All canonical assignments/cards/standees
- Prince’s canonical Business NFC Card `6ae85874efc853c66c8a10fe`
- All analytics, leads, reviews, media, enquiries, and unrelated records

---

## 8. Before / After Database Counts

Isolated clone only:

| Collection | Before | After | Change |
|---|---:|---:|---|
| `catalogproducts` | 17 | 11 | −6 |
| `userproducts` | 20 | 11 | −9 |
| `cards` | 15 | 11 | −4 |
| `standees` | 7 | 4 | −3 |
| `users` | 15 | 15 | 0 |
| `profiles` | 14 | 14 | 0 (1 pointer cleared) |
| `analyticslogs` | 16 | 16 | 0 |
| `reviewtemplates` | 110 | 110 | 0 |
| `reviewsettings` | 1 | 1 | 0 |
| `tenantsettings` | 2 | 2 | 0 |
| `counters` | 2 | 2 | 0 |

Full-document comparison found exactly:

- 6 catalog products removed
- 9 assignments removed
- 4 cards removed
- 3 standees removed
- 1 profile changed (`cardId` only)
- 2 users changed (`hasStandy` only)

No other persistent collection changed.

---

## 9. Isolated Verification Results

- All 6 target products absent.
- All 9 target assignments absent.
- All 4 target cards and 3 target standees absent.
- No remaining assignment references a deleted product, card, or standee.
- No profile references a deleted card.
- No user has `hasStandy = true` without a standee.
- All 11 canonical products present and byte-identical.
- Prince’s account remains; canonical Business NFC Card remains.
- `GET /api/my/products` for prince returns **11 products**, including Business NFC Card, without `nfc-card` or `counter-standee`.
- Canonical Business NFC Card URL still returns 200.
- Removed legacy and Counter Standee URLs return 404.

### The blocker

The Counter Standee URL `/kaka-pvc/standee` returned **200 before** cleanup and **404 after** cleanup. It is a live customer-facing standee on the genuine `prince@gmail.com` account. This is outside the allowed prince deletion scope and triggers the stop condition.

---

## 10. Regression Results

All tests were run against isolated databases; none touched `nfc-crm`.

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
| ESLint | **PASS** |
| Production build | **PASS** |

No test failure was attributable to the cleanup simulation.

---

## 11. Backup and Rollback

Backup:

`/Users/prince/Documents/CRM-backups/noncanonical-catalog-cleanup/20261104T075348Z/`

Contents include:

- `target-products.json` — 6 documents
- `target-assignments.json` — 9 documents
- `target-cards.json` — 4 documents
- `target-standees.json` — 3 documents
- `affected-users.json` — 6 users
- `profile-pointer.json`
- `snapshot-all-collections.json`
- `manifest.json` with SHA-256 checksums
- `snapshot-clone-after-cleanup.json`

Rollback restored all 6 products, 9 assignments, 4 cards, 3 standees, the profile `cardId` pointer, and both `hasStandy` flags. Persistent collections matched the original snapshot exactly. Only a transient `ratecounters` TTL document expired naturally after backup; it is unrelated.

The cleanup was then re-applied and matched the first cleanup snapshot exactly.

---

## 12. Risks and Unexpected Dependencies

| Risk | Status |
|---|---|
| **Prince’s live Counter Standee** | **Blocker — would delete live public URL/route** |
| Profile `cardId` dependency on QA card | Found; plan clears pointer, keeps profile |
| QA users’ `hasStandy` flags | Found; plan resets to false |
| Legacy NFC card URLs | Removed as previously authorized |
| QA cards/standees | Test-only, no URLs or analytics |
| TTL ratecounter | Transient, unrelated |
| User accounts | All preserved |
| Canonical products/cards | All preserved |

The QA accounts have `@test.local` emails and QA fixture names. Nevertheless, **no user account is proposed for deletion**, as required.

---

## 13. Final Recommendation

**NOT SAFE TO APPLY** for the full six-product cleanup as specified.

Reason: it deletes prince’s active Counter Standee assignment/standee and breaks its live public URL and route, contrary to the preservation rules.

### Safe options requiring approval

1. **Reduced cleanup — recommended:** remove the five noncanonical products other than `counter-standee`, plus eight assignments, four cards, and two QA standees. Leave the Counter Standee product, prince’s assignment, and his standee untouched. Catalog would become **12**, not 11.
2. **Full cleanup with explicit authorization:** separately approve deletion of prince’s Counter Standee assignment `6ae85874efc853c66c8a1137`, standee `6ae85874efc853c66c8a1134`, public URL `kaka-pvc/standee`, and route `mvz27lsyc6`. Then the verified 17→11 state can be applied.
3. **Do not apply** until the Counter Standee decision is made.

### Live safety

The live `nfc-crm` database remains unchanged:

- 17 catalog products
- 20 assignments
- 15 cards
- 7 standees
- 15 users
- 16 analytics rows
- All target records still present

No production/preview access, no commit, push, or deployment.
