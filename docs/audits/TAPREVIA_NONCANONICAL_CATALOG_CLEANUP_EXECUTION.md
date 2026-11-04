# Taprevia — Noncanonical Catalog Cleanup Execution

**Date:** 2026-11-04  
**Branch:** `Devlopment`  
**HEAD:** `0191bc1889c95e5716afa2f8f67a991ac131c101`  
**Database:** `mongodb://127.0.0.1:27017/nfc-crm`  
**Mode:** Pre-flight → fresh backup → verified cleanup → regression → report  
**Final status:** **SUCCESS**

---

## 1. Backup Location and Integrity

**Backup:** `/Users/prince/Documents/CRM-backups/noncanonical-catalog-cleanup/live-20261104T080745Z/`

Contents:

- `target-products.json` — 6 documents
- `target-assignments.json` — 9 documents
- `target-cards.json` — 4 documents
- `target-standees.json` — 3 documents
- `affected-users.json` — 6 users
- `profile-pointer.json`
- `snapshot-all-collections.json`
- `snapshot-after-live-cleanup.json`
- `manifest.json` with SHA-256 checksums

All checksums were recomputed and verified before the write. Rollback procedure was previously verified in the isolated clone and the execution script was capable of automatic restoration if any post-check failed.

---

## 2. Exact IDs Deleted

### Catalog products — 6

| Product | `_id` |
|---|---|
| qa-ev-other-probe-10433 | `6a8ee86c23096e5a739c86ae` |
| qa-nexus-card | `6a8e8fa7f0112218b4c33b46` |
| qa-nexus-standee | `6a8e8fa7f0112218b4c33b4a` |
| qa-nexus-gizmo | `6a8e8fa7f0112218b4c33b4e` |
| nfc-card | `6a8e70e8c6d1bfed0bd99d7a` |
| counter-standee | `6a8e70e8c6d1bfed0bd99d7b` |

### Assignments — 9

`6a8ee88223096e5a739c86be`, `6a8ee44823096e5a739c861b`, `6a8ee5a323096e5a739c8655`, `6a8ee89323096e5a739c86c6`, `6a8ee57e23096e5a739c863c`, `6a8ee30013e82da69dfaf91c`, `6a8ee78323096e5a739c86a3`, `6ae85874efc853c66c8a1118`, `6ae85874efc853c66c8a1137`

### Cards — 4

`6a8ee44723096e5a739c8600`, `6a8e919ff0112218b4c33bc9`, `6a8e8fa5f0112218b4c33b42`, `6ae85874efc853c66c8a1112`

### Standees — 3

`6a8ee30013e82da69dfaf919`, `6a8ee78323096e5a739c86a0`, `6ae85874efc853c66c8a1134`

---

## 3. Exact Related Documents Modified

No user accounts or profiles were deleted.

| Collection | Document | Change |
|---|---|---|
| `profiles` | `6a8ee86d23096e5a739c86b4` | `cardId` → `null` |
| `users` | `6a8ee2fe13e82da69dfaf910` | `hasStandy` → `false` |
| `users` | `6a8ee78223096e5a739c869b` | `hasStandy` → `false` |

No other documents were modified.

---

## 4. Before / After Collection Counts

| Collection | Before | After | Change |
|---|---:|---:|---|
| `catalogproducts` | 17 | **11** | −6 |
| `userproducts` | 20 | **11** | −9 |
| `cards` | 15 | **11** | −4 |
| `standees` | 7 | **4** | −3 |
| `users` | 15 | 15 | 0 |
| `profiles` | 14 | 14 | 0 (1 pointer cleared) |
| `analyticslogs` | 16 | 16 | 0 |
| `reviewtemplates` | 110 | 110 | 0 |
| `reviewsettings` | 1 | 1 | 0 |
| `tenantsettings` | 2 | 2 | 0 |
| `counters` | 2 | 2 | 0 |

Full snapshot comparison confirmed the only differences were:

- 6 products removed
- 9 assignments removed
- 4 cards removed
- 3 standees removed
- 1 profile `cardId` cleared
- 2 users’ `hasStandy` reset

No unexpected additions or changes.

---

## 5. Customer Data Preservation

`prince@gmail.com` — `6ae85874efc853c66c8a10f3`:

- Account: **preserved**
- Active assignments: 13 → **11**
- Cards: 8 → **7**
- Standees: 5 → **4**
- Canonical Business NFC Card assignment: **preserved**
- Legacy `nfc-card` assignment: **removed as approved**
- Counter Standee assignment: **removed as approved**
- Canonical card `6ae85874efc853c66c8a10fe`: **unchanged**
- Canonical route `/r/mvz27lr78k`: **unchanged**
- Public profile `/kaka-pvc/business-card`: **unchanged**

The five other affected accounts are `@test.local` QA accounts. **No user account was deleted.**

---

## 6. Canonical Product Preservation

All 11 canonical products remain and were compared byte-for-byte against the backup:

- `business-nfc-card`
- `premium-nfc-card`
- `insta-card`
- `google-review-card`
- `linkedin-card`
- `facebook-card`
- `google-review-standee`
- `business-profile-standee`
- `all-in-one-standee-3`
- `all-in-one-standee-4`
- `google-review-nfc-plate`

All 11 canonical assignments are present and unchanged. No canonical product, card, standee, assignment, price, kind, capability, or activation state was modified.

---

## 7. NFC/QR URL Verification

Verified on a disposable post-cleanup clone to avoid writing analytics/taps to the live database.

### Retired URLs — all return 404

| URL | Result |
|---|---|
| `/r/mvz27lrzva` | **404** |
| `/profile/digital-mvz27lryec` | **404** |
| `/r/mvz27lsyc6` | **404** |
| `/kaka-pvc/standee` | **404** |

### Protected canonical URLs

| URL | Result |
|---|---|
| `/r/mvz27lr78k` | **307** → `/kaka-pvc/business-card` |
| `/kaka-pvc/business-card` | **200** |
| `/kaka-pvc/premium-card` | **200** |
| `/kaka-pvc/standee-2` | **200** |
| `/kaka-pvc/standee-3` | **200** |
| `/kaka-pvc/standee-4` | **200** |
| `/kaka-pvc/standee-5` | **200** |

Customer dashboard API returned **11 products**, with Business NFC Card present and no `nfc-card` or `counter-standee` entries.

---

## 8. Regression Results

All tests were run against isolated test databases; none modified `nfc-crm`.

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

---

## 9. Orphan-Reference Scan

| Check | Result |
|---|---|
| Assignments referencing deleted products | **0** |
| Assignments referencing deleted cards/standees | **0** |
| Profiles referencing deleted cards | **0** |
| Stale `hasStandy=true` with no standees | **0** |
| Deleted assignment/product/card/standee records still present | **0** |
| Catalog count | **11** |
| Assignment count | **11** |
| Card count | **11** |
| Standee count | **4** |

---

## 10. Final Status

**SUCCESS**

The approved six-product/nine-assignment cleanup was applied to the local `nfc-crm` database only. All protected canonical records remain intact, the retired URLs return 404, canonical URLs still work, no user accounts were deleted, and no orphan references remain.

- No production or preview access.
- No commit, push, or deployment.
- Temporary execution script removed.
- Backup retained at `/Users/prince/Documents/CRM-backups/noncanonical-catalog-cleanup/live-20261104T080745Z/`.
