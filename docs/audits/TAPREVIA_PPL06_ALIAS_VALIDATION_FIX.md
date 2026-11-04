# Taprevia — PPL06-01 / PPL06-02 Alias Validation Fix

**Date:** 2026-11-03  
**Branch:** `Devlopment`  
**HEAD:** `0191bc1889c95e5716afa2f8f67a991ac131c101`  
**Mode:** Verify → minimal fix → isolated tests → report

---

## 1. Files Changed

| File | Purpose |
|---|---|
| `src/lib/validation/common.ts` | Single shared alias regex/list/validator; fixed trailing-hyphen rule; schema now normalizes trim/lowercase |
| `src/app/api/cards/check-alias/route.ts` | Uses the shared validator; checks both `Card.slug` and `Card.urlAlias`; response shape/authorization/rate limit preserved |
| `scripts/test-ppl06-alias-validation.ts` | New focused 41-check regression test |

No other application code, customer data, identifiers, routes, schema documents, indexes, migrations, or environment files changed.

---

## 2. Before / After Validation Behavior

| Input | Before | After |
|---|---|---|
| `business-name` | Valid | Valid |
| `business123` | Valid | Valid |
| `-business` | Invalid | Invalid |
| `business-` | **Valid (bug)** | **Invalid** |
| `business--name` | Valid | Valid (preserved) |
| `business_name` | Invalid | Invalid |
| Empty | Invalid | Invalid |
| `admin`, `api`, `qr`, `public` | Invalid/reserved | Invalid/reserved |
| `assets`, `static` | Schema valid; check-alias “taken” | Valid/available in both |
| `review`, `panel`, `preview`, `standee-review` | Valid | Valid (namespaced; no route conflict) |
| Uppercase `Business-Name` | Schema rejected; endpoint normalized | Both normalize to `business-name` |
| Existing `slug` only (`taken-slug`) | check-alias only checked `urlAlias` | Unavailable in both namespaces |
| Existing `urlAlias` only (`taken-alias`) | Unavailable | Unavailable |

`qr` and `public` now return `RESERVED` from the endpoint, matching the schema; `assets`/`static` are accepted by both.

---

## 3. Shared Validation Design

`src/lib/validation/common.ts` now owns:

- `RESERVED_ALIASES`
- `ALIAS_FORMAT_RE = /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/`
- `ALIAS_FORMAT_MESSAGE`
- `validateAlias(input)` → `{ ok: true, value }` or `{ ok: false, reason: 'INVALID' | 'RESERVED' }`
- `aliasSchema` built on the same `validateAlias` rules via `z.preprocess` + `superRefine`

Behavior details:

- Trim + lowercase normalization is shared.
- Reserved check runs before format so short reserved values (`qr`, `c`, `t`) return the same `RESERVED` reason in both paths.
- Consecutive internal hyphens remain valid; leading/trailing hyphens are invalid.
- Aliases are namespaced (`/profile/{alias}`, `/review/{alias}`, `/c/{key}`), so no additional top-level route names were added to `RESERVED_ALIASES`.

`check-alias` now imports `validateAlias`, so syntax, normalization, and reserved rules cannot drift again.

---

## 4. Availability Endpoint Compatibility

Response shape is unchanged:

- `{ available: true }`
- `{ available: false, reason: 'INVALID' | 'RESERVED' }`
- `{ available: false, suggestion: '…' }`

Authorization (`requireAuth`), per-user rate limit, and `excludeId` behavior are unchanged.

The only semantic expansion:

```ts
$or: [{ urlAlias: alias }, { slug: alias }]
```

This catches existing `Card.slug` collisions, matching how `/profile/{alias}` and `/c/{key}` resolve.

No alias editing was introduced; PPL-02 immutability remains in force.

---

## 5. Focused Test Results

`scripts/test-ppl06-alias-validation.ts` — isolated DB `ppl06_alias_validation`, dropped afterward:

```
PPL06 alias validation: 41 passed, 0 failed
```

Coverage:

- Schema/shared-validator agreement across 22 format cases.
- Trailing hyphen rejected; leading hyphen rejected; consecutive hyphens preserved.
- Reserved `admin`, `qr`, `public`, `api` rejected with `RESERVED`.
- `assets`/`static` accepted consistently.
- Endpoint detects `Card.slug` collision.
- Endpoint detects `Card.urlAlias` collision.
- `excludeId` still allows the owning card.
- Free alias available.
- Invalid values return `INVALID`.
- Existing `slug`, `urlAlias`, `routeSlug`, and `uid` unchanged.

---

## 6. Full Regression Results

| Test | Result |
|---|---|
| `test-ppl06-alias-validation.ts` | **41/41** |
| `test-ppl01-customer-qr.ts` | **18/18** |
| `test-ppl02-immutable-urls.ts` | **23/23** |
| `test-ppl03-01-alias-collision.ts` | **8/8** |
| `test-ppl04-05-permanent-urls.ts` | **16/16** |
| `test-customer-public-url-display.ts` | **28/28** |
| `test-security-boundaries.ts` | PASS |
| `test-dashboard-entitlement.ts` | **130/130** |
| `test-dynamic-routing.ts` | **29/29** |
| `test-card-binding.ts` | **49/49** |
| `test-standee-review.ts` | **20/20** |
| `test-phase4d10p2-preview-routing.ts` | **15/16** — known stale `review-noalias` fixture supplies `slug`, so the resolver correctly returns `disabled` |
| `tsc --noEmit` | PASS |
| `next lint` | PASS |
| `npm run build` | PASS |

---

## 7. Remaining Limitations

1. **`check-alias` still does not check `routeSlug`/`uid`.** Not part of PPL06-01/02; route/uid are in a separate permanent namespace.
2. **Aliases are still namespaced, not root-level.** `RESERVED_ALIASES` intentionally does not include every top-level route. Adding them would be unnecessary restriction, not a security fix.
3. **Uppercase input is now normalized and accepted.** Previously the schema rejected uppercase while the endpoint normalized it. The shared contract now accepts and lowercases; stored identifiers are not rewritten.
4. **Existing aliases with trailing hyphens** (if any exist in production) remain stored and immutable; validation affects future writes only. Local data has none.
5. **Production data unverified.** Local `nfc-crm` has no invalid/reserved/colliding aliases.
6. **`aliasSchema` message** remains the same for format errors; reserved errors use the existing “This alias is reserved” message.

No schema/index/migration is required.

---

## 8. Safety Confirmation

- No customer data modified; live `nfc-crm` was read-only.
- No existing alias, slug, publicSlug, routeSlug, uid, or QR identifier changed.
- No alias editing introduced.
- No database migration, index creation, or stored-document schema change.
- No environment changes; `.env` hashes unchanged.
- No production/preview access.
- No commits, pushes, or deployments.
- Isolated databases (`ppl06_*`, `ppl02_*`, `ppl03_*`, `ppl0601_*`, `taprevia_*`) and temporary servers were dropped/stopped.

**PPL06-01 and PPL06-02 are fixed. PPL-01, PPL-02, PPL03-01, PPL-04/PPL-05, Customer Public URL Display, and all existing routes remain green.**
