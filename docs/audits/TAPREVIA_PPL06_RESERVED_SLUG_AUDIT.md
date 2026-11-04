# Taprevia — PPL-06 Reserved URL & Slug Validation Audit

**Date:** 2026-11-03  
**Branch:** `Devlopment`  
**HEAD:** `0191bc1889c95e5716afa2f8f67a991ac131c101`  
**Mode:** Read-only audit (isolated synthetic write tests only)  
**Database inspected:** `mongodb://localhost:27017/nfc-crm`  
**Production / Preview:** not accessed

---

## 1. Executive Summary

**PPL-06 status: PARTIALLY FIXED.**

- `RESERVED_PUBLIC_SEGMENTS` is **complete for every actual two-segment static route** that could shadow `/{business}/{product}`.
- New business/public slugs are sanitized, lowercased, reserved-checked, and suffixed (`admin` → `admin-2`, `standee-review` → `standee-review-2`, etc.).
- Live local data contains **zero** reserved, invalid, duplicate, case-variant, or cross-namespace public slug conflicts.
- Alias validation still has **two low-severity inconsistencies**:
  1. `check-alias` uses a different reserved list from `aliasSchema` (and checks only `urlAlias`).
  2. `aliasSchema` accepts a trailing hyphen despite its error message claiming otherwise.
- Aliases are namespaced under `/profile`, `/review`, `/c`, and legacy `/r` fallback, so the alias reserved-list drift does **not** create a current top-level route collision.
- `settings` and `signup` are not reserved because neither exists as a top-level route today; `settings` is nested under `/dashboard`. This is a future-route risk, not a current collision.

No route conflict, URL takeover, or inaccessible public page was found in current code/data.

---

## 2. Reserved-Word Inventory

### 2.1 Public slug (`User.bizSlug` → `/{business}/{product}`)

`src/lib/services/human-url.ts:19–40`:

```
admin, api, c, dashboard, login, media, panel, profile, qr, r,
register, review, standee-review, preview, contacts, privacy,
terms, cookies, fonts, t
```

Applied by `ensureUserBizSlug` (`human-url.ts:103–125`). A reserved base is suffixed `-2`, `-3`, … using the monotonic `bizslug:{base}` counter.

### 2.2 Card alias (`urlAlias` → `/profile/{alias}`, `/review/{alias}`, `/c/{key}`)

`src/lib/validation/common.ts:10–33`:

```
api, admin, dashboard, login, register, profile, t, qr, c,
media, public
```

Format: `/^[a-z0-9][a-z0-9-]{2,39}$/`.

### 2.3 Alias availability probe

`src/app/api/cards/check-alias/route.ts:14–26`:

```
admin, api, login, register, dashboard, profile, c, t,
media, assets, static
```

Uses the same format regex but only queries `Card.urlAlias` (`:51–56`).

### 2.4 Actual application routes

Top-level `src/app` directories:

```
(admin)/admin, (auth)/..., (dashboard)/dashboard, (public)/...,
[business], api, c, fonts, media, panel, preview, profile, qr,
r, review, standee-review, t
```

Actual static two-segment prefixes:

```
admin/*, api/*, c/[slug], dashboard/*, media/[...key],
panel/[slug], preview/*, profile/[alias], qr/[id],
r/[...slug], review/[alias], standee-review/[slug], t/[uid]
```

Every one of these is covered by `RESERVED_PUBLIC_SEGMENTS`. There is no missing actual two-segment static prefix.

`signup` and `settings` are not top-level routes:
- `settings` exists only at `/dashboard/settings`.
- `signup` does not exist (registration is `/register`).

They are therefore correctly **not** in the public-slug reserved list today. They become a risk only if top-level routes are later added.

---

## 3. Creation-Path Validation Matrix

| Path | Identifier | Validation | Result |
|---|---|---|---|
| Auth registration (`api/auth/register`) | `User.bizSlug` | `generateSlug` + `RESERVED_PUBLIC_SEGMENTS` + unique index | PASS — reserved names suffixed |
| Admin customer creation (`createCustomerSchema` → `ensureUserBizSlug`) | explicit `urlSlug` / `bizSlug` | Trim → `generateSlug` (lowercase/ASCII/hyphen, max 40) → reserved check → unique counter | PASS — invalid characters normalized; reserved suffixed |
| Product assignment (`ensureCardPublicSlug`) | `Card.publicSlug` | `ensureUserBizSlug` + canonical product segment + unique index | PASS |
| Standee assignment (`ensureStandeePublicSlug`) | `Standee.publicSlug` | `ensureUserBizSlug` + fixed `standee` segment + unique index | PASS |
| Customer/card provisioning (`createUniqueCardSlug`) | `Card.slug`/`urlAlias` | UID-derived `generateSlug`, dedupe against `slug` + `urlAlias` (PPL03-01) | PASS |
| Admin card create (`POST /api/cards`) | alias/slug | `aliasSchema` + `$or` uniqueness check + unique slug index; duplicate 409 | PASS |
| Builder alias editing | `urlAlias` | Blocked by PPL-02 (read-only) | PASS |
| Card/standee update APIs | identifiers | PPL-02 immutability guards | PASS |
| `check-alias` endpoint | availability probe | Separate list, only `urlAlias` | **INCONSISTENT** (see PPL06-01) |

### Isolated creation tests

Isolated DB `ppl06_reserved` (dropped afterward), `ensureUserBizSlug`:

| Input | Result |
|---|---|
| `admin` | `admin-2` |
| `api` | `api-2` |
| `dashboard` | `dashboard-2` |
| `profile` | `profile-2` |
| `review` | `review-2` |
| `preview` | `preview-2` |
| `standee-review` | `standee-review-2` |
| `login` | `login-2` |
| `qr` | `qr-2` |
| `r` | `r-2` |
| `panel` | `panel-2` |
| `t` | `t-2` |
| `contacts` / `privacy` / `terms` / `cookies` / `fonts` | `…-2` |
| `media` / `c` / `register` | `…-2` |
| `settings` | `settings` (no current top-level route) |
| `signup` | `signup` (no current top-level route) |
| `My Biz!!!` | `my-biz` |
| `日本語` | `business` (fallback; safe) |
| `  ADMIN  ` | `admin-3` (after `admin-2` was taken) |
| `admin/` | `admin-4` |
| `My Company` | `my-company` |

Reserved suffixing, case folding, whitespace, slash, punctuation, and Unicode fallback all behave safely.

### Alias validation matrix

`aliasSchema.safeParse` results:

| Value | Accepted? |
|---|---|
| `admin`, `api`, `dashboard`, `profile`, `t`, `qr`, `c`, `media`, `public` | No |
| `review`, `panel`, `standee-review`, `preview` | **Yes** |
| `settings`, `signup`, `assets`, `static` | **Yes** |
| `valid-alias` | Yes |
| `legacy_alias` | No (underscore) |
| `-bad` | No (leading hyphen) |
| `bad-` | **Yes — trailing hyphen accepted** |

`check-alias` differences:

| Value | `aliasSchema` | `check-alias` |
|---|---|---|
| `qr` | rejected | **available** |
| `public` | rejected | **available** |
| `assets` | accepted | **taken** |
| `static` | accepted | **taken** |
| `review` / `panel` / `standee-review` / `preview` | accepted | available |

---

## 4. Actual Route-Conflict Analysis

### Public URLs

`/{business}/{product}` is the dynamic route. If `business` equals a static two-segment prefix, Next.js static routing wins and the card/standee page is unreachable. The reserved list covers all actual two-segment prefixes. No gap found.

- `admin`, `api`, `dashboard`, `profile`, `review`, `r`, `qr`, `panel`, `standee-review`, `c`, `preview`, `media`, `t` → covered.
- `login`, `register`, `contacts`, `privacy`, `terms`, `cookies`, `fonts` → one-segment routes; included as defense-in-depth; not harmful.
- `settings` → only `/dashboard/settings`; `/settings/{product}` would be dynamic and valid. No collision today.
- `signup` → no route; no collision today.

### Alias URLs

Aliases are used only as path parameters:

- `/profile/{alias}`
- `/review/{alias}`
- `/c/{key}` (alias/slug lookup)
- `/r/{alias}` legacy fallback

They are **not** mounted at the root. Therefore aliases named `review`, `panel`, `preview`, `standee-review`, `settings`, or `signup` cannot shadow top-level routes. Their omission from `RESERVED_ALIASES` is not a route-conflict vulnerability.

### Permanent / legacy identifiers

`routeSlug`, `uid`, `panelQr.qrId`, and social QR IDs are used under `/r`, `/qr`, `/panel`, `/standee-review`, or as query identifiers. They are not affected by root-segment reserved words.

### Case / encoding / normalization

- `generateSlug` lowercases, converts non-`[a-z0-9]` runs to `-`, trims edge hyphens, and slices to 40 chars.
- `aliasSchema` requires lowercase ASCII; API inputs are lowercased.
- `publicSlug` Card schema is lowercase; creation paths are lowercase. Standee schema is not declared lowercase, but creation emits lowercase; live data has no case variants.
- PublicSlug resolvers lowercase the request and validate `^[a-z0-9-]+/[a-z0-9-]+$`.
- Unicode business names fall back to `business`; no Unicode slug is persisted.
- Trailing slash cannot be stored in `publicSlug`; `generateSlug` turns `/` into `-`.

---

## 5. Existing Data Findings

Read-only scan of local `nfc-crm` (15 users, 15 cards, 7 standees):

| Check | Result |
|---|---|
| Reserved `User.bizSlug` | 0 |
| Duplicate `bizSlug` (exact / normalized) | 0 / 0 |
| Reserved first segment in `Card.publicSlug` | 0 |
| Reserved first segment in `Standee.publicSlug` | 0 |
| Duplicate `publicSlug` (Card, exact / normalized) | 0 / 0 |
| Duplicate `publicSlug` (Standee, exact / normalized) | 0 / 0 |
| Invalid Card/Standee `publicSlug` | 0 |
| Duplicate `urlAlias` (exact / normalized) | 0 / 0 |
| Invalid `urlAlias` | 0 |
| `urlAlias` in alias reserved list | 0 |
| `urlAlias` equal to a top-level route name | 0 |
| Card vs Standee `publicSlug` collision | 0 |
| `publicSlug` prefix mismatch vs `User.bizSlug` | 0 |
| Case-variant public slug | 0 |

Current data uses one business prefix (`kaka-pvc`) with product-specific paths such as:

```
kaka-pvc/business-card
kaka-pvc/premium-card
kaka-pvc/instagram
kaka-pvc/standee
kaka-pvc/standee-2
```

No data was modified.

---

## 6. Security and Backward Compatibility

### Security

- No reserved public slug can currently shadow a static route; reserved suffixing is enforced server-side at allocation.
- No cross-tenant public-slug collision was found.
- Aliases cannot shadow top-level routes because they are namespaced.
- `aliasSchema` trailing hyphen is a validation-quality issue, not a route/security issue.
- `check-alias` mismatch is misleading but no supported write path relies on it:
  - Builder no longer calls it after PPL-02.
  - `POST /api/cards` uses `aliasSchema`.
  - Alias updates are blocked.
- `urlSlug` silently normalizes invalid characters instead of rejecting; this is safe but can surprise admins (`My Biz!!!` → `my-biz`). It cannot produce a reserved or invalid public slug.
- No production data was accessible; production legacy values remain unverified.

### Backward compatibility

- Existing public URLs and reserved/suffixed business slugs are unchanged.
- Existing Card/Standee/legacy routes remain untouched.
- PPL-01 (customer QR), PPL-02 (immutability), PPL03-01 (alias collision), Customer Public URL Display, PPL-04/PPL-05 (strict Permanent/Legacy) remain intact.
- No customer data or identifiers changed.

---

## 7. Regression Results

| Test | Result |
|---|---|
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
| `test-phase4d10p2-preview-routing.ts` | **15/16** — known stale `review-noalias` fixture supplies `slug`, so the resolver correctly returns `disabled` instead of `missing-alias` |
| `tsc --noEmit` | PASS |
| `next lint` | PASS |
| `npm run build` | PASS |

No writes were made to `nfc-crm`. All write tests used isolated databases and temporary servers, which were dropped/stopped.

---

## 8. Recommended Minimal Fixes (Not Implemented)

1. **Unify alias validation.** Export one shared reserved/format definition and use it in `aliasSchema` and `check-alias`; align `check-alias` to also check `slug` (PPL-03) and the same reserved list.
2. **Fix the alias regex trailing hyphen.**
   - Current: `/^[a-z0-9][a-z0-9-]{2,39}$/` accepts `bad-`.
   - Suggested: require the final character to be alphanumeric (or a negative lookbehind/lookahead for `-$`).
   - Add a focused test for `-bad`, `bad-`, `a--b`, and valid aliases.
3. **Remove or deprecate `check-alias`.** The builder no longer uses it; keeping a second rule set is the source of the drift. If retained for external clients, delegate to the shared schema.
4. **Keep `RESERVED_PUBLIC_SEGMENTS` synchronized with actual two-segment routes.** Add `settings`/`signup` only if those top-level routes are introduced. Do not add restrictions for paths that cannot collide.
5. **Document explicit `urlSlug` normalization** (or reject invalid characters in `createCustomerSchema` if strict rejection is preferred). This is a UX policy decision, not a route-safety fix.

No schema change, index change, or migration is required for any of the above.

---

## 9. Final Classification

| Aspect | Status |
|---|---|
| Public slug reserved segments | **FIXED** — list matches actual two-segment routes; reserved names suffixed |
| Public slug case/Unicode/whitespace/trailing behavior | **PASS** — normalized safely |
| Existing data reserved conflicts | **PASS** — zero |
| Alias reserved-list consistency | **PARTIALLY FIXED** — `check-alias` differs from `aliasSchema` |
| Alias format validation | **PARTIALLY FIXED** — trailing hyphen accepted despite message |
| Top-level route shadowing by alias | **NOT VULNERABLE** — aliases are namespaced |
| `settings`/`signup` collision | **NOT VULNERABLE today** — no top-level routes; future risk only |
| Backward compatibility | **PASS** |
| **PPL-06 overall** | **PARTIALLY FIXED** |

**No application code, customer data, identifiers, indexes, migrations, or environment files were changed during this audit. Awaiting approval before any fix.**
