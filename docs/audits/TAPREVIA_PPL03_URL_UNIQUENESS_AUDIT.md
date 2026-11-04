# Taprevia — PPL-03 URL Uniqueness & Collision Security Audit

**Date:** 2026-11-03  
**Branch:** `Devlopment`  
**HEAD:** `0191bc1889c95e5716afa2f8f67a991ac131c101`  
**Mode:** Read-only audit (isolated synthetic write tests only)  
**Database inspected:** `mongodb://localhost:27017/nfc-crm`  
**Production / Preview:** not accessed

---

## A. Executive Summary

**PPL-03 status: PARTIALLY FIXED.**

The originally reported alias-vs-slug defect is largely resolved:

- PPL-02 made `urlAlias` immutable and removed the alias-edit PATCH path.
- The primary creation paths now set `urlAlias = slug`, so the unique `slug` index is the atomic alias guard.
- A concurrent duplicate-alias insert was rejected by the database (`11000`) while only one record survived.
- Live local data has **zero** duplicates, cross-namespace collisions, invalid identifiers, reserved-name claims, or aliases that differ from their slug.

One real residual creation-path gap remains:

**`createUniqueCardSlug()` checks only `slug`, not existing `urlAlias`.**  
A legacy card whose `urlAlias` differs from its `slug` can share its alias with a newly provisioned card whose UID sanitizes to the same value. This was reproduced in an isolated database: two documents matched the same alias key and `findOne` resolution became order-dependent.

Additional low-risk architectural gaps remain (cross-collection identifiers, case-sensitive Standee indexes, QR-ID cross-array uniqueness). None currently permits takeover of a canonical Public URL or permanent route through a normal supported flow.

No CRITICAL/HIGH vulnerability was confirmed against current local data. Production legacy data remains unverified.

---

## B. Identifier Inventory

| Identifier | Owner | Created by | Unique? | Case-normalized on write? | DB enforcement |
|---|---|---|---|---|---|
| `slug` | Card | `createUniqueCardSlug` (`card-identity.ts:59–70`) | Yes | Yes (schema lowercase) | Unique index `slug_1` |
| `routeSlug` | Card | `allocateCardRouteSlug` (`card-identity.ts:79–84`) | Yes per Card collection | Yes (schema lowercase) | Unique sparse `routeSlug_1` |
| `uid` | Card | Mirrors `routeSlug` (`card-identity.ts:163–164`, `183`) | Yes per Card collection | Yes (schema lowercase) | Unique sparse `uid_1` |
| `urlAlias` | Card | `bindAssignedCard` from slug (`card-access.ts:213`) / POST alias=slug (`cards/route.ts:105–132`) | **App-level only** | Yes (schema lowercase) | **Non-unique** `urlAlias_1` |
| `publicSlug` | Card | `ensureCardPublicSlug` (`human-url.ts:172–224`) | Yes per Card collection | Yes (schema lowercase) | Unique sparse `publicSlug_1` |
| `cardUid` | Card | Admin/physical UID or `DIGITAL-…` | Yes | Normalized uppercase | Unique `cardUid_1` |
| `previousCardUids` | Card | Replacement audit | Checked in `findCardByUid` | Uppercase | No unique index (audited via query) |
| `bizSlug` | User | `ensureUserBizSlug` (`human-url.ts:103–125`) | Yes | Yes (`generateSlug`) | Unique sparse `bizSlug_1` |
| `routeSlug` | Standee | `allocateStandeeRouteSlug` (`user-product-assignment.ts:37–43`) | Yes per Standee collection | **No lowercase in schema** | Unique sparse `routeSlug_1` |
| `uid` | Standee | Mirrors routeSlug | Yes per Standee collection | Trim only | Unique sparse `uid_1` |
| `publicSlug` | Standee | `ensureStandeePublicSlug` (`human-url.ts:238–287`) | Yes per Standee collection | **No lowercase in schema** | Unique sparse `publicSlug_1` |
| `panelQr.qrId` | Standee | `generateQrId()` (`user-product-assignment.ts:301`) | Yes per panel namespace | No | Unique `panelQr.qrId_1` |
| `socialQrs[].qrId` | Standee | `generateQrId()` (`:302–307`) | Yes per social namespace | No | Unique sparse `socialQrs.qrId_1` |
| `slug`/`urlAlias` legacy `/r` fallback | Card | Legacy records | No cross-namespace guard | — | See PPL03-05 |

---

## C. Database Index Analysis

Verified live indexes on `nfc-crm`:

### Cards

```
slug_1            unique
cardUid_1         unique
routeSlug_1       unique, sparse
uid_1             unique, sparse
publicSlug_1      unique, sparse
urlAlias_1        NON-UNIQUE
```

### Standees

```
panelQr.qrId_1       unique
socialQrs.qrId_1     unique, sparse
routeSlug_1          unique, sparse
uid_1                unique, sparse
publicSlug_1         unique, sparse
```

### Users / Catalog

```
users.bizSlug_1          unique, sparse
users.customerId_1       unique, sparse
users.email_1            unique
catalogproducts.slug_1   unique
```

### Cross-namespace observations

- Card and Standee collections have **separate** unique indexes. Nothing prevents:
  - the same `routeSlug`/`uid` in both collections,
  - the same `publicSlug` in both collections,
  - the same QR ID in one standee's `panelQr` and another standee's `socialQrs`.
- `urlAlias` has no unique index and does not share a namespace with `slug` at the DB level.
- Card `publicSlug`/`routeSlug`/`uid` are schema-lowercase; Standee equivalents are **not** schema-lowercased, so their unique indexes are case-sensitive while their resolvers normalize to lowercase.

---

## D. Existing Data Analysis

Read-only aggregate scan of local `nfc-crm` (15 cards, 7 standees):

| Check | Result |
|---|---|
| Duplicate `routeSlug` (exact / normalized) | 0 / 0 |
| Duplicate `uid` (exact / normalized) | 0 / 0 |
| Duplicate `publicSlug` (exact / normalized) | 0 / 0 |
| Duplicate `urlAlias` (exact / normalized) | 0 / 0 |
| Duplicate `slug` (exact / normalized) | 0 / 0 |
| Standee duplicate `routeSlug` / `uid` / `publicSlug` | 0 / 0 / 0 |
| Card alias colliding with another Card `slug` | 0 |
| Card alias colliding with another Card `routeSlug`/`uid` | 0 / 0 |
| Card `slug` colliding with another Card `routeSlug` | 0 |
| Card vs Standee `routeSlug` / `uid` / `publicSlug` collision | 0 / 0 / 0 |
| QR ID collision (panel vs social, across standees) | 0 |
| Malformed or reserved Card `publicSlug` | 0 |
| Malformed or reserved Standee `publicSlug` | 0 |
| Case-variant duplicates | 0 |
| `urlAlias !== slug` | **0** (8 aliases, all equal their slug) |

Legacy identity gaps (not collisions):

- 7 cards lack `routeSlug`; 8 lack `publicSlug` (mostly QA/unassigned; 2 active legacy cards lack a complete pair).
- 2 standees lack `routeSlug`/`publicSlug` (legacy/QA).
- No data was modified.

**Production data is unverified.** The residual alias gap matters only if production has legacy aliases that differ from their slug (possible before PPL-02 froze editing).

---

## E. Creation Path Analysis

| Path | Identifier behavior | Assessment |
|---|---|---|
| Admin customer creation (`customer-creation.ts`) | `ensureUserBizSlug` → `assignUserProduct` → `provisionCardForAssignment` → `bindAssignedCard` (alias=slug) → `ensureCardPublicSlug` | Both identities created; publicSlug best-effort |
| Product assignment (`user-product-assignment.ts:150–246`) | Card UID → slug (`createUniqueCardSlug`) → routeSlug/uid → alias=slug → publicSlug | **Alias check gap**: slug dedupe ignores existing `urlAlias` |
| Digital-first assignment | Synthetic `DIGITAL-…` UID → same path | Same gap, but synthetic UID collision with human alias is unlikely |
| `POST /api/cards` (admin only) | Alias/slug checked against `urlAlias` **and** `slug`; unique slug catch returns 409; routeSlug minted | Correct within Card collection |
| Standee assignment | Timestamp routeSlug/uid; publicSlug allocation; random panel/social QR IDs | Correct within Standee collection |
| Card replacement | Preserves routeSlug/uid/slug/publicSlug/alias | Correct |
| Backfill/repair scripts | Only write when missing; never overwrite | Correct |
| Legacy/import paths | No other Card/Standee creation sites found | No bypass identified |

`createUniqueCardSlug` (`card-identity.ts:59–70`) is the key residual:

```ts
while (await Card.exists({ slug: candidate })) {
  candidate = `${base}-${n}`;
  n += 1;
}
```

It does not check `urlAlias`, `routeSlug`, or `uid`.

---

## F. Concurrency Findings

Isolated synthetic database (`ppl03_audit_*`, indexes explicitly initialized; dropped afterwards):

| Test | Result |
|---|---|
| Two concurrent Cards with same `slug`/`urlAlias` | **One `11000`, one success; final count 1** |
| Two concurrent `ensureUserBizSlug('Audit Biz')` | `audit-biz`, `audit-biz-2` (distinct) |
| Two concurrent `ensureCardPublicSlug` under one business | `audit-biz/premium-card`, `audit-biz/premium-card-2` (distinct) |
| Cross-collection Card + Standee same `routeSlug` | Both accepted (separate indexes) |
| Cross-collection Card + Standee same `publicSlug` | Both accepted (separate indexes) |
| Case-variant Standee `CaseRoute` + `caseroute` | Both accepted (case-sensitive unique index) |
| Card alias equal to another Card's `routeSlug` | Both accepted; `/r` lookup returns the routeSlug owner |
| New card UID equal to a legacy card's different `urlAlias` | **Two documents match the alias key; resolution order-dependent** |

**Conclusion:** same-collection slug claims are atomic via unique indexes. Alias uniqueness is *not* independently atomic because `urlAlias` is non-unique and one creation path does not check it. Cross-collection identifiers are not atomic across namespaces.

---

## G. Security Findings

### PPL03-01 — Creation-path alias collision (PARTIALLY FIXED, Medium/Low)

- **Root cause:** `createUniqueCardSlug` checks only `slug`; `bindAssignedCard` then copies it to `urlAlias`; `Card.urlAlias` is non-unique.
- **Confirmed:** isolated test created legacy card `slug=legacy-slug, urlAlias=legacy-alias`, then provisioned a card with UID `legacy-alias`; both records matched `{urlAlias: 'legacy-alias'}` and `getPublicCardByAlias` returned only one arbitrarily.
- **Affected routes:** `/profile/{alias}`, `/review/{alias}`, `/c/{key}`, legacy `/r/{alias}`.
- **Exploitability:** requires a legacy card with `urlAlias !== slug` plus a new card UID that sanitizes to that alias (admin-supplied physical UID or custom UID). Local data has none; production is unverified.
- **Impact:** ambiguous public link resolution; one card's Public URL can render the other card. No permanent route takeover.
- **Backward compatibility:** fixing the creation check is code-only and does not alter existing identifiers.

### PPL03-02 — Card/Standee cross-collection route/uid collisions (Low)

- Separate unique indexes; allocation checks only own collection (`card-identity.ts:79–84`, `user-product-assignment.ts:37–43`).
- `/r` resolves Card first (`r/[...slug]/route.ts:88–102`) before Standee (`:135–140`).
- Confirmed both accepted in an isolated DB.
- IDs are timestamp+entropy and not attacker-chosen; probability is low. A collision would shadow the Standee permanent route, not a Public URL.

### PPL03-03 — Card/Standee cross-collection `publicSlug` (Low residual, not reachable via supported creation)

- Separate unique indexes allow the same `{business}/{product}` in both collections; `/{business}/{product}` resolves Card first (`[business]/[product]/page.tsx:84–94`).
- Supported creation is disjoint: Card product segments come from product definitions (`business-card`, `premium-card`, `instagram`, `google-review`, `linkedin`, `facebook`); Standees always use `standee`.
- No supported path can create a collision. Manual/legacy data could; local data has none.

### PPL03-04 — Case-sensitive Standee identifiers (Low)

- Standee schema does not lowercase `routeSlug`, `uid`, or `publicSlug` (`Standee.ts:70, 75, 79`); unique indexes are case-sensitive.
- Resolvers lowercase the request key (`human-url.ts:293–297`; `r/[...slug]:132–140`).
- Confirmed two case-variant standees can coexist; normalized lookup then returns one arbitrarily, or an uppercase-only legacy standee is unreachable.
- New creation emits lowercase, so this is a legacy/out-of-band risk only.

### PPL03-05 — Alias vs `routeSlug`/`uid` shadowing in `/r` (Low)

- `POST /api/cards` checks alias against `urlAlias` and `slug` only, not `routeSlug`/`uid` (`cards/route.ts:111–119`).
- `/r` resolves `routeSlug`/`uid` before the legacy alias/slug fallback (`r/[...slug]:88–102, 322–329`).
- Confirmed alias equal to another routeSlug is accepted; `/r/{key}` returns the routeSlug owner. Canonical `/profile/{alias}` still works; only the legacy `/r/{alias}` fallback is shadowed.

### PPL03-06 — QR ID cross-array collisions (Low)

- `panelQr.qrId` and `socialQrs.qrId` have separate unique indexes (`Standee.ts:109–110`).
- `/qr/[id]` checks social QR first (`qr/[id]/route.ts:84`) before panel (`:137`).
- Same QR ID in a panel and a social slot is allowed by the DB; IDs are random and no app path produces a collision. A collision would shadow one legacy QR route.

### PPL03-07 — `check-alias` probe is incomplete/stale (Low/Informational)

- `check-alias` checks only `urlAlias` (`check-alias/route.ts:51–56`) and uses a reserved list different from `aliasSchema` (`:14–26` vs `common.ts:10–22`).
- The builder no longer calls it after PPL-02 (`basic-tab.tsx` has no `check-alias` reference); the authoritative admin create path checks both namespaces.
- No write path relies on this probe, so it is misleading rather than exploitable.

### PPL03-08 — Rare allocation race returns 500 rather than retrying (Low)

- `createUniqueCardSlug` and `allocateCardRouteSlug` are check-then-insert.
- Unique indexes prevent duplicate ownership, but `provisionCardForAssignment` / Standee creation do not catch `E11000` to retry.
- Result under a rare collision is a failed assignment (500), not a duplicate or takeover.

### PPL03-09 — Hard-deleted records free identifiers (Informational)

- Inactive/unbound cards retain `slug`, `urlAlias`, and `publicSlug`; allocation counts all statuses, so slots are not reused.
- Explicit admin hard deletion removes the record; a later allocation could reuse a freed `publicSlug` within the same business. No tombstone exists. This is an intentional destructive admin action, not routine lifecycle behavior.

### Reserved routes

`RESERVED_PUBLIC_SEGMENTS` (`human-url.ts:19–40`) covers the actual static two-segment prefixes in `src/app`: `admin`, `api`, `c`, `dashboard`, `media`, `panel`, `preview`, `profile`, `qr`, `r`, `review`, `standee-review`, `t`, plus one-segment `login`/`register`/`contacts`/`privacy`/`terms`/`cookies`/`fonts`. No missing two-segment static prefix was found. `signup`/`settings` are not top-level routes in this app.

Alias reserved names are narrower, but aliases are namespaced under `/profile`, `/review`, and `/c`; they cannot shadow top-level routes. The `check-alias`/schema mismatch remains a UX inconsistency, not a route takeover.

---

## H. Backward Compatibility Matrix

| Product | Status | Evidence |
|---|---|---|
| Premium NFC Business Card | PASS | dynamic routing / PPL tests |
| Standard NFC Business Card | PASS | dynamic routing |
| Google Review NFC Card | PASS | backcompat 11/11 ×2 |
| Google Review NFC Plate | PASS | backcompat + review suites |
| Social NFC Card | PASS | dynamic routing; external redirect preserved |
| Legacy NFC Cards | PASS | `/r` fallback unchanged |
| Google Review Standee | PASS | standee 20/20 |
| All-in-One 3 Standee | PASS | standee 20/20 |
| All-in-One 4 Standee | PASS | standee 20/20 |

| Route | Status |
|---|---|
| `/r/{routeSlug}` | PASS |
| `/r/{uid}` | PASS |
| `/r/{routeSlug}/{slot}` | PASS |
| `/{publicSlug}` | PASS |
| `/profile/{alias}` | PASS |
| `/review/{alias}` | PASS |
| `/c/{key}` | PASS |
| `/qr/{qrId}` | PASS |
| `/panel/{route}` | PASS |
| `/standee-review/{slug}` | PASS |

Existing public URLs, permanent URLs, NFC/QR links, assignments, Review Management, standee routing, entitlements, and analytics remain unchanged. No identifiers were rewritten.

---

## I. PPL-01 / PPL-02 / Display Regression Results

| Suite | Result |
|---|---|
| `scripts/test-ppl01-customer-qr.ts` | **18/18** |
| `scripts/test-ppl02-immutable-urls.ts` | **23/23** |
| `scripts/test-customer-public-url-display.ts` | **28/28** |
| `scripts/test-security-boundaries.ts` | PASS |
| `scripts/test-dashboard-entitlement.ts` | **130/130** |
| `scripts/test-dynamic-routing.ts` | **29/29** |
| `scripts/test-card-binding.ts` | **49/49** |
| `scripts/test-phase4d10p2-backward-compat.ts` | **11/11** OFF, **11/11** ON |
| `scripts/test-standee-review.ts` | **20/20** |
| `tsc --noEmit` | PASS |
| `next lint` | PASS |
| `npm run build` | PASS |

PPL-01 stable QR behavior, PPL-02 immutability, and customer Public URL display remain green.

---

## J. Recommended Minimal Fix

### Required for PPL-03 closure

**Code-only:** extend `createUniqueCardSlug` (`src/lib/services/card-identity.ts:59–70`) to reject candidates colliding with either mutable public namespace:

```ts
while (await Card.exists({ $or: [{ slug: candidate }, { urlAlias: candidate }] })) { ... }
```

Optionally include `routeSlug`/`uid` if the legacy `/r/{alias}` shadowing is also to be closed.

No schema change or migration is required for this check. It closes the confirmed alias duplicate creation path.

### Optional hardening

1. **Unique `urlAlias` index** — strongest guarantee, but requires a schema/index change and explicit approval. Current data is clean (no duplicates; all aliases equal their slug), but the schema default `''` needs a partial index or normalization to avoid empty-string collisions.
2. **Shared alias/key availability helper** used by both `POST /api/cards` and `createUniqueCardSlug`, checking `slug`, `urlAlias`, and optionally `routeSlug`/`uid`.
3. **Cross-collection reservation** for `routeSlug`/`uid`/`publicSlug` across Cards and Standees — optional; no supported collision path exists today.
4. **Lowercase Standee identifiers on write** (code-only for new records) — closes the case-variant legacy risk without changing existing data.
5. **Cross-check QR IDs** across panel/social namespaces at creation — optional.
6. **Consolidate/remove `check-alias`** or align it with the authoritative validation and both card namespaces.

Do not regenerate or rewrite existing identifiers.

---

## K. Migration and Deployment Risks

| Fix | Code-only? | Schema/index? | Migration? | Risk |
|---|---|---|---|---|
| `createUniqueCardSlug` checks `urlAlias` | Yes | No | No | Low; may append `-1` to a new slug when an old alias occupies the base, which is correct |
| Unique `urlAlias` index | No | Yes (partial/sparse unique) | Maybe normalize `''` | Requires approval; data currently clean but empty-string handling must be designed |
| Cross-collection reservation | Yes | No | No | Adds checks; no existing data change |
| Lowercase Standee identifiers | Yes (new writes) | No | No (existing uppercase remains) | No destructive rewrite |
| QR cross-namespace check | Yes | No | No | Low |

No database change was made or executed during this audit.

---

## L. Final Status

**PPL-03: PARTIALLY FIXED.**

- **FIXED:** concurrent same-alias creation is atomically rejected within the Card namespace; PPL-02 immutability blocks alias edits; live data has no duplicates or cross-namespace collisions; `POST /api/cards` checks both `urlAlias` and `slug`.
- **PARTIALLY FIXED:** `createUniqueCardSlug` still ignores existing `urlAlias`; the non-unique `urlAlias` index remains. A legacy alias that differs from its slug can collide with a newly provisioned card. Reproduced in isolation.
- **LOW / NOT CURRENTLY EXPLOITABLE:** cross-collection Card/Standee identifiers, case-variant Standee legacy identifiers, QR-ID cross-array namespaces, and alias-vs-routeSlug `/r` shadowing.
- **NOT VERIFIED:** production legacy data and production behavior.

No canonical Public URL or permanent route takeover was demonstrated against current local data. The minimum next step is the code-only `createUniqueCardSlug` alias check; stronger index enforcement requires separate approval.

**No application code, database record, index, migration, environment file, identifier, or route was changed during this audit. Awaiting approval before any fix.**
