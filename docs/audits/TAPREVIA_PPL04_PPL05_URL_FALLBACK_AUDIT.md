# Taprevia — PPL-04 & PPL-05 Permanent URL Fallback Audit

**Date:** 2026-11-03  
**Branch:** `Devlopment`  
**HEAD:** `0191bc1889c95e5716afa2f8f67a991ac131c101`  
**Mode:** Read-only audit (isolated test databases only)  
**Database inspected:** `mongodb://localhost:27017/nfc-crm`  
**Production / Preview:** not accessed

---

## A. Executive Summary

| Finding | Classification | Current severity |
|---|---|---|
| **PPL-04** — Admin “Permanent” QR encodes non-permanent fallbacks | **PARTIALLY FIXED** | Medium (admin-only) |
| **PPL-05** — Admin “Permanent” label can be `/c` or `/qr` | **STILL VULNERABLE / NOT FIXED** | Medium (admin confusion) |
| PPL-04-A — fallback path not URL-encoded (`/c/panthi events`) | **STILL VULNERABLE** | Low |
| PPL-04-B — `/api/my/qr` still encodes the Public URL, not `/r` | **STILL VULNERABLE (dormant)** | Low/Medium |
| PPL-01 customer QR (routeSlug cards) | **FIXED** | — |
| Standee panel/slot QR stability | **PASS** | — |

The customer vCards QR path was corrected by PPL-01: it now passes only `routeSlug`/`publicSlug`, never the editable alias, external destination, or `/c`. However the shared `permanentCardUrl()` helper is still overloaded for admin use, where it falls back to `/c`, `/profile`, or `/{publicSlug}`. The admin “Permanent” link comes from a different helper (`permanentEntryPath`) that falls back to `/c` or `/qr`. Those are still labelled **Permanent**.

Live local data:

- **8 / 15 cards** produce an admin QR `/r/{routeSlug}`.
- **7 / 15 cards** (all legacy, no `routeSlug`) produce an admin QR `/c/{slug}`.
- **1 of those 7 is an active assigned customer card** (`1D:47:…`), so this is not purely QA data.
- **5 / 7 standees** produce `/r/{routeSlug}`; **2 / 7** produce `/qr/{panelQr}`.
- The same 7 cards and 2 standees are labelled **Permanent** while pointing at `/c` or `/qr`.

No identifiers were modified; no customer data was written.

---

## B. Root Causes

### Root cause 1 — One helper serves two different contracts

`src/lib/admin-card-view.ts:37–61`

```ts
export function cardPublicQrPath(card) {
  if (routeSlug) return `/r/${routeSlug}`;
  if (publicSlug) return `/${publicSlug}`;
  if (urlAlias) return `/profile/${urlAlias}`;
  if (slug) return `/c/${slug}`;
  return '';
}

export function permanentCardUrl(card, base) {
  const path = cardPublicQrPath(card);
  if (!base || !path) return '';
  return `${base}${path}`;
}
```

The function is named `permanentCardUrl` but implements “best stable public path”. The doc comment itself says “best stable public path”. Admin callers treat it as permanent.

### Root cause 2 — A separate helper also falls back

`src/lib/services/product-preview.ts:151–176`

```ts
export function permanentEntryPath(instanceType, instance) {
  // Card: /r/{routeSlug|uid} → /c/{slug}
  // Standee: /r/{routeSlug|uid} → /qr/{panelQr.qrId}
}
```

`resolveProductUrls` exposes this as `permanentEntryUrl` (`:197, :219`), and Admin User Details renders it under the label **Permanent** (`admin/users/[id]/page.tsx:901–918, 1023–1038`).

### Root cause 3 — Two different fallback orders

For a card without `routeSlug`:

- Admin QR: `permanentCardUrl` → `/{publicSlug}` → `/profile/{alias}` → `/c/{slug}`
- Admin “Permanent” label: `permanentEntryPath` → `/c/{slug}`

So the QR payload and the “Permanent” link can disagree, even when both are non-`/r`.

---

## C. Current Permanent / Public / QR Behavior

| Surface | Helper | Current payload |
|---|---|---|
| Customer vCards QR image/PDF | `resolveCardQrUrl` → `permanentCardUrl({routeSlug, publicSlug})` (`vcards/page-client.tsx:87–92`) | `/r/{routeSlug}` or `/{publicSlug}`; never alias/external/`/c` |
| Customer vCards QR modal | Public URL + labelled QR/NFC link (`:439–442`) | Public URL primary; `/r` technical line |
| Admin card QR image | `permanentCardUrl(c, base)` (`admin/users/[id]/page.tsx:279`) | `/r` → `/{publicSlug}` → `/profile` → `/c` |
| Admin card QR PDF | same (`:368`) | same as image |
| Admin card “Permanent” link | `permanentEntryUrl` (`:901–918`) | `/r` → `/c` |
| Admin standee QR (panel/social) | `standeeQrUrl` (`:321–331`) | `/r/{routeSlug}` or `/qr/{qrId}` |
| Admin standee “Permanent” link | `permanentEntryUrl` (`:1023–1038`) | `/r` → `/qr/{panelQr}` |
| Public/customer display | `resolveCustomerPublicPath` | Product-specific Public URL |
| `/api/my/qr` | `makeQr(publicSlug)` (`my/qr/route.ts:30–34, 49–78`) | `{request.origin}/{publicSlug}` |

---

## D. Incorrect Fallback Examples (Live Data)

### Cards

| Card (anonymized) | Active customer? | `routeSlug` | Admin QR | Admin “Permanent” label |
|---|---|---|---|---|
| `…1d2fed` | yes | missing | `https://…/c/taprevia` | `/c/taprevia` |
| `…e1f979` | yes | missing | `https://…/c/panthi events` | `/c/panthi%20events` |
| `…ecb978` | yes | missing | `https://…/c/ui3` | `/c/ui3` |
| `…c33b42` | yes | missing | `https://…/c/qa-nexus-card-1` | `/c/qa-nexus-card-1` |
| `…c33bc9` | no | missing | `https://…/c/qa-nexus-card-3` | `/c/qa-nexus-card-3` |
| `…9c8600` | no | missing | `https://…/c/qa-fix-card-9` | `/c/qa-fix-card-9` |
| `…e5a9d6` | **yes, active** | missing | `https://…/c/1d-47-97-0b-66-00-00` | `/c/1d-47-97-0b-66-00-00` |
| 8 newer cards | yes | present | `https://…/r/{routeSlug}` | `/r/{routeSlug}` |

Concrete mismatch:

- `e1f979` (`panthi events`):
  - Admin QR: `https://www.taprevia.com/c/panthi events` (literal space; `cardPublicQrPath` does not encode)
  - Admin “Permanent”: `/c/panthi%20events` (`permanentEntryPath` encodes)
  - These are the same logical route but different payload strings.

### Standees

| Standee (anonymized) | `routeSlug` | Admin panel QR | “Permanent” |
|---|---|---|---|
| `…faf919` | missing | `/qr/kkFW1X6g` | `/qr/kkFW1X6g` |
| `…9c86a0` | missing | `/qr/fmNsn0xZ` | `/qr/fmNsn0xZ` |
| 5 other standees | present | `/r/{routeSlug}` | `/r/{routeSlug}` |

---

## E. Actual QR / NFC Payload Behavior

| Requirement | Result |
|---|---|
| QR preview and download encode the same payload | **PASS** for admin cards (`:279` and `:368` both `permanentCardUrl`); **PASS** for standees (`standeeQrUrl`); **PASS** for customer vCards (`resolveCardQrUrl` both) |
| QR/NFC payload is the permanent `/r` route | **PASS** for 8/15 cards and 5/7 standees; **FAIL** for 7 legacy cards and 2 legacy standees |
| Customer QR avoids mutable alias/external destination | **PASS** (PPL-01) |
| Admin QR avoids fallback | **FAIL** (PPL-04) |
| Standee panel/slot payload stable | **PASS** (existing `/r` or legacy `/qr`) |
| Social/review routing preserved | **PASS** (`/r` behavior unchanged) |
| Missing identifiers handled without writes | **PASS** (fallback or empty; no backfill) |
| `/api/my/qr` uses permanent route | **FAIL** — encodes `publicSlug` |

---

## F. Product-by-Product Compatibility

| Product | Admin QR | Permanent label | Public display | Status |
|---|---|---|---|---|
| Premium NFC Business Card | `/r` when routeSlug present | `/r` | `/{publicSlug}` | PASS |
| Standard NFC Business Card | `/r` when routeSlug present | `/r` | `/{publicSlug}` | PASS |
| Google Review NFC Card | `/r` | `/r` | `/review/{alias}` | PASS |
| Google Review Plate | `/r` | `/r` | `/review/{alias}` | PASS |
| Social NFC Card | `/r` | `/r` | `/{publicSlug}` | PASS |
| Legacy NFC Cards | `/c/{slug}` | `/c/{slug}` | `/c/{slug}` | PASS routing; **FAIL labeling** |
| Google Review Standee | `/r` or `/qr` | `/r` or `/qr` | `/{publicSlug}` | PASS routing; **FAIL labeling for legacy** |
| All-in-One 3 Standee | `/r` | `/r` | `/{publicSlug}` | PASS |
| All-in-One 4 Standee | `/r` | `/r` | `/{publicSlug}` | PASS |

Existing printed QR/NFC links, public routes, Review Management, standee routing, entitlements, and analytics remain functional.

---

## G. Existing Legacy Identifier Limitations

Read-only counts:

- Cards: 7/15 missing `routeSlug`; 8/15 missing `publicSlug`; 7/15 missing `urlAlias`.
- Of the 7 missing `routeSlug`, all also lack `publicSlug` and `urlAlias`; all fall back to `/c/{slug}`.
- One active assigned customer card (`1D:47:97:0B:66:00:00`, anonymized `…e5a9d6`) is in this group.
- Standees: 2/7 missing `routeSlug` and `publicSlug`; both fall back to `/qr/{panelQr}`.
- No identifiers were regenerated, backfilled, or modified.

These legacy records have no `/r` permanent route. Any strict “Permanent = `/r` only” UI must show unavailable (or a clearly labelled legacy fallback), not imply `/c`/`/qr` is permanent.

---

## H. Security Implications

- No secret or private identifier is exposed by the fallbacks; `/c/{slug}` and `/qr/{qrId}` are public legacy routes.
- No route takeover or cross-tenant access was found.
- Alias immutability (PPL-02) means the `/profile/{alias}` fallback is no longer mutable through normal APIs, but it is still not a permanent resolver route.
- `/api/my/qr` uses `request.nextUrl.origin` (`my/qr/route.ts:30`), which is Host-derived rather than the trusted configured base. An authenticated caller with a manipulated Host could receive a QR containing an unintended origin. The endpoint is not used by current UI (only `scripts/smoke-dynamic-routing.ts`).
- Admin mislabeling is operational, not an authorization issue: printing a `/c` or `/qr` payload still resolves today, but does not have `/r` resolver semantics/analytics.
- The raw-space payload (`/c/panthi events`) is an encoding defect: some QR scanners may auto-encode it, others may treat it inconsistently.

---

## I. Regression Test Results

| Test | Result |
|---|---|
| `scripts/test-ppl01-customer-qr.ts` | **18/18** |
| `scripts/test-ppl02-immutable-urls.ts` | **23/23** |
| `scripts/test-customer-public-url-display.ts` | **28/28** |
| `scripts/test-ppl03-01-alias-collision.ts` | **8/8** |
| `scripts/test-dynamic-routing.ts` | **29/29** |
| `scripts/test-card-binding.ts` | **49/49** |
| `scripts/test-standee-review.ts` | **20/20** |
| `scripts/test-security-boundaries.ts` | PASS |
| `tsc --noEmit` | PASS |
| `next lint` | PASS |
| `npm run build` | PASS |

Not tested: live customer `/r`/`/qr` HTTP taps, physical NFC/QR scanning, production/preview behavior. No writes were made to `nfc-crm`; all state-changing tests used isolated databases and temporary servers, which were dropped/stopped.

---

## J. Recommended Minimal Fixes (Not Implemented)

1. **Split permanent from fallback helpers.**
   - `permanentCardPath(card)`: returns `/r/{routeSlug|uid}` only, else `null`.
   - `legacyCardPath(card)`: `/c/{slug}`, `/profile/{alias}`, `/{publicSlug}` for explicitly labelled legacy contexts.
   - Keep `permanentCardUrl` strict, or rename the current fallback helper to `stableCardQrUrl`.

2. **Admin QR behavior.**
   - Use the strict permanent helper for “Permanent QR”.
   - If no `routeSlug`/`uid`, show “Permanent QR unavailable” rather than generating `/c` under a permanent label.
   - If legacy fallback is intentionally supported, label it **Legacy QR (fallback)** and show the actual payload.

3. **Admin “Permanent” label.**
   - `permanentEntryPath` should return only `/r/...`.
   - Add `legacyEntryPath` for `/c/{slug}`/`/qr/{qrId}` and render it as **Legacy**.
   - This affects 7 cards and 2 standees in local data.

4. **Encode fallback segments.**
   - `cardPublicQrPath` should `encodeURIComponent` `slug`/`urlAlias` (publicSlug is already validated).
   - Fixes `/c/panthi events` vs `/c/panthi%20events`.

5. **`/api/my/qr`.**
   - Encode `/r/{routeSlug|uid}` from the trusted configured base, or deprecate/remove the endpoint.
   - If retained for Public URL sharing, rename/document it explicitly as Public, not permanent.
   - Verify any legacy client before changing; current UI does not call it.

6. **Tests.**
   - Existing tests intentionally assert fallback behavior:
     - `test-security-boundaries.ts:136–138`
     - `test-phase4d10p2-preview-routing.ts:193–213`
     - `test-phase4d10p2-backward-compat.ts:244–245`
   - Any strict-permanent change requires updating those expectations and adding explicit “no routeSlug → Permanent unavailable / Legacy fallback” cases.

---

## K. Deployment Risks

| Change | Risk | Mitigation |
|---|---|---|
| Strict admin permanent QR | Admins lose QR generation for 7 legacy cards (or must use explicitly labelled legacy QR) | Keep a separate legacy action; do not remove `/c` route |
| Rename/re-label Permanent | Admin UI text changes only | No customer-facing change |
| Encode fallback slug | QR payload changes for legacy cards; previously generated QR unaffected | Existing scanned `/c` URLs still resolve |
| Change `/api/my/qr` | Legacy API clients could break | Deprecation window or dual behavior |
| No schema/index/migration | — | All fixes are code-only |

Existing printed QR/NFC codes continue to resolve because no route or identifier is removed. No customer data rewrite is required.

---

## L. Final Status

| Finding | Status |
|---|---|
| **PPL-04** — admin QR fallback | **PARTIALLY FIXED** — customer PPL-01 path fixed; admin fallback still encodes `/c` for 7 legacy cards; `/api/my/qr` still encodes Public URL |
| **PPL-05** — “Permanent” label fallback | **STILL VULNERABLE / NOT FIXED** — 7 cards show `/c`, 2 standees show `/qr` as Permanent |
| PPL-04-A — unencoded fallback | **STILL VULNERABLE** (Low) — `/c/panthi events` |
| PPL-04-B — `/api/my/qr` | **STILL VULNERABLE (dormant)** (Low/Medium) — Public URL encoded, Host-derived origin |
| PPL-01 customer QR | **FIXED** |
| PPL-02 immutability | **FIXED / PASS** |
| Customer Public URL display | **PASS** |
| PPL03-01 alias collision | **FIXED / PASS** |
| Standee QR stability | **PASS** |

**No application code, customer data, identifiers, indexes, migrations, or environment files were changed during this audit. Awaiting approval before any fix.**
