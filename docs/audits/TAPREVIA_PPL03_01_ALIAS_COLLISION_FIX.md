# Taprevia — PPL03-01 Alias Collision Fix

**Date:** 2026-11-03  
**Branch:** `Devlopment`  
**HEAD:** `0191bc1889c95e5716afa2f8f67a991ac131c101`  
**Mode:** Scan → minimal fix → isolated tests → report  
**Database:** `mongodb://localhost:27017/nfc-crm` (read-only); writes only in isolated `ppl03_*` databases  
**Production / Preview:** not accessed

---

## 1. Root Cause

`createUniqueCardSlug()` in `src/lib/services/card-identity.ts` deduplicated a new card's slug against `Card.slug` only:

```ts
while (await Card.exists({ slug: candidate })) { ... }
```

Card public handles resolve through **both** `slug` and `urlAlias`:

- `getPublicCardByAlias` uses `$or: [{ urlAlias }, { slug }]` (`card-access.ts`)
- `/c/{key}` uses the same `$or` (`c/[slug]/page.tsx`)
- `/r/{alias}` legacy fallback also accepts `urlAlias`

`bindAssignedCard` copies the generated slug into `urlAlias` (`card-access.ts:213`). Therefore a new card whose UID sanitized to a legacy card's `urlAlias` could create two documents matching the same public key. `Card.urlAlias` has no unique index.

Confirmed in the PPL-03 audit and reproduced again before the fix.

---

## 2. Exact Change

**File changed:** `src/lib/services/card-identity.ts`

```ts
// Before
while (await Card.exists({ slug: candidate })) {
  candidate = `${base}-${n}`;
  n += 1;
}

// After
while (await Card.exists({ $or: [{ slug: candidate }, { urlAlias: candidate }] })) {
  candidate = `${base}-${n}`;
  n += 1;
}
```

The existing `generateSlug` normalization, suffix generation (`-1`, `-2`, …), and unique `slug` index behavior are preserved.

No other application logic changed.

---

## 3. Before / After Behavior

| Scenario | Before | After |
|---|---|---|
| Legacy card: `slug=legacy-slug`, `urlAlias=legacy-alias` | — | unchanged |
| New card UID `legacy-alias` | new `slug=legacy-alias`, duplicate public key | new `slug=legacy-alias-1`, alias same |
| `/profile/legacy-alias` | ambiguous (`findOne` order-dependent) | legacy card |
| `/profile/legacy-alias-1` | n/a | new card |
| Existing `slug=slug-only` collision | suffix `slug-only-1` | unchanged |
| Legacy alias/publicSlug | unchanged | unchanged |

---

## 4. Isolated Test Results

New test: `scripts/test-ppl03-01-alias-collision.ts`  
Isolated database: `ppl03_alias_collision` (dropped afterward)

```
PASS new card receives a different slug from the legacy alias
PASS new card alias mirrors its new slug (immutable association)
PASS legacy alias and slug remain unchanged
PASS legacy alias still resolves to the legacy card
PASS new public alias resolves to the new card
PASS legacy publicSlug still resolves to the legacy card
PASS no document shares the legacy alias key
PASS existing slug collision still generates a suffix

INFO concurrent slug-base allocation: ["ok","rejected"]; documents=1; unique=true

PPL03-01 alias collision: 8 passed, 0 failed
```

The test verifies:

1. Legacy `slug`/`urlAlias` remain unchanged.
2. New card receives `legacy-alias-1`.
3. Alias mirrors the new slug.
4. Old public alias resolves to the old card.
5. New public alias resolves to the new card.
6. Legacy `publicSlug` still resolves.
7. Only one document matches the legacy alias key.
8. Existing slug collision still suffixes.

---

## 5. Concurrency Limitation

The new `$or` check is a **read-time** guard, not a cross-field database constraint.

- New-card/new-card concurrency is still atomic because `urlAlias = slug`, and `slug` has a unique index.
- The isolated race test used two different UIDs whose slug base normalized to the same value. Result: one request succeeded, one was rejected by the existing unique `slug` index (`E11000`), and only one document exists. This is the pre-existing PPL03-08 behavior: the assignment path does not retry an `E11000`.
- A concurrent out-of-band write to `urlAlias` could still bypass the read-time check. No supported application path changes `urlAlias` after PPL-02, so this is not reachable through normal APIs.
- No index or schema change was made. A unique/partial `urlAlias` index would require explicit approval and empty-string handling.

---

## 6. PPL-01 Regression

```
scripts/test-ppl01-customer-qr.ts → 18 passed, 0 failed
```

Customer QR remains `{base}/r/{routeSlug}`; QR preview/download match; Public Preview remains separate; no alias/external URL encoded; no identifiers regenerated.

---

## 7. PPL-02 Regression

```
scripts/test-ppl02-immutable-urls.ts → 23 passed, 0 failed
```

- `routeSlug`, `uid`, `publicSlug`, `urlAlias`, `slug` remain immutable.
- Creation still allocates routeSlug + publicSlug + alias.
- Builder remains read-only; no identifier edits accepted.

---

## 8. Customer Public URL Display Regression

```
scripts/test-customer-public-url-display.ts → 28 passed, 0 failed
```

- Display/copy/share use the Public URL.
- QR/NFC payload remains the permanent `/r` route.
- Social cards use the Taprevia public route, not the raw external destination.
- Missing identifiers show unavailable.

---

## 9. Backward Compatibility Verification

| Area | Result | Evidence |
|---|---|---|
| Premium / Standard NFC Card | PASS | dynamic routing 29/29 |
| Google Review Card / Plate | PASS | backcompat 11/11 ×2 |
| Social Card | PASS | dynamic routing |
| Legacy NFC Cards | PASS | `/r` fallback unchanged |
| Google Review Standee | PASS | standee 20/20 |
| AIO 3 / AIO 4 Standees | PASS | standee 20/20 |
| `/r/{routeSlug}`, `/r/{uid}`, `/r/{routeSlug}/{slot}` | PASS | backcompat |
| `/{publicSlug}`, `/profile/{alias}`, `/review/{alias}` | PASS | backcompat |
| `/c/{key}`, `/qr/{qrId}`, `/panel/{route}`, `/standee-review/{slug}` | PASS | dynamic/standee suites |
| Existing printed QR/NFC links | PASS | no identifier or route changed |
| Existing aliases/publicSlugs | PASS | isolated test verifies unchanged |
| Review Management | PASS | standee suite |
| Entitlements | PASS | dashboard 130/130 |
| Analytics | PASS | QR still routes through `/r` |

No existing URL or identifier was rewritten. The only behavior change applies to a **newly created card** when its requested slug matches an existing alias: it receives a suffixed slug.

---

## 10. Full Test Results

| Test | Result |
|---|---|
| `test-ppl03-01-alias-collision.ts` | **8/8** |
| `test-ppl01-customer-qr.ts` | **18/18** |
| `test-ppl02-immutable-urls.ts` | **23/23** |
| `test-customer-public-url-display.ts` | **28/28** |
| `test-security-boundaries.ts` | PASS |
| `test-dashboard-entitlement.ts` | **130/130** |
| `test-phase4d10p2-builder-tabs.ts` | **9/9** |
| `test-dynamic-routing.ts` | **29/29** |
| `test-card-binding.ts` | **49/49** |
| `test-phase4d10p2-backward-compat.ts` | **11/11** OFF, **11/11** ON |
| `test-standee-review.ts` | **20/20** |
| `tsc --noEmit` | PASS |
| `next lint` | PASS |
| `npm run build` | PASS |

Not run: live customer `/r`/`/qr` HTTP taps, physical NFC/QR scanning, production/preview verification.

---

## 11. Remaining PPL-03 Findings

Unchanged by this fix:

| ID | Finding | Status |
|---|---|---|
| PPL03-02 | Card/Standee cross-collection `routeSlug`/`uid` duplicates | Low; separate indexes; `/r` Card-first |
| PPL03-03 | Card/Standee cross-collection `publicSlug` duplicates | Low; creation namespaces disjoint |
| PPL03-04 | Standee identifiers not schema-lowercased | Low; legacy/out-of-band only |
| PPL03-05 | Alias vs another card's `routeSlug`/`uid` in `/r` | Low; canonical Public URL unaffected |
| PPL03-06 | Panel/social QR ID cross-array collisions | Low; separate indexes |
| PPL03-07 | `check-alias` incomplete/stale | Informational; unused by builder |
| PPL03-08 | Read-time allocation races can return 500 | Low; unique index prevents duplicates |
| PPL03-09 | Hard-deleted records free identifiers | Informational; explicit admin action |

**PPL03-01 is now FIXED for the supported creation path.** The read-time concurrency limitation remains documented under PPL03-08 and was not addressed without schema/index approval.

---

## 12. Safety Confirmation

- No customer data changed; `nfc-crm` was read-only.
- No identifiers regenerated or rewritten.
- No migrations, index creation, or schema changes.
- No environment file changes; `.env` hashes unchanged.
- No production or preview access.
- No commits, pushes, or deployments.
- Isolated databases (`ppl03_*`, `ppl02_*`, `taprevia_*`) and temporary servers were dropped/stopped.
- Live counts unchanged: 15 users, 15 cards, 7 standees, 20 assignments, 17 catalog products, 1 review category, 110 templates, 1 review settings, 16 analytics logs.

**PPL03-01 fixed. PPL-01, PPL-02, and customer Public URL display remain green. Awaiting approval before any further changes.**
