# Taprevia — PPL-04 & PPL-05 Fix

**Date:** 2026-11-03  
**Branch:** `Devlopment`  
**HEAD:** `0191bc1889c95e5716afa2f8f67a991ac131c101`  
**Mode:** Verify → minimal implementation → regression test → report

---

## 1. Files Changed

| File | Purpose |
|---|---|
| `src/lib/admin-card-view.ts` | Added strict `/r` permanent resolver and explicit legacy resolver. Existing `permanentCardUrl` kept for PPL-01 customer QR compatibility. |
| `src/lib/services/product-preview.ts` | `permanentEntryPath` is now strict `/r` only; added `legacyEntryPath` and `legacyEntryUrl`. |
| `src/app/(admin)/admin/users/[id]/page.tsx` | Admin QR/PDF uses strict permanent first; legacy QR/URL shown separately and labelled. Standee `/qr` fallback labelled Legacy. |
| `scripts/test-ppl04-05-permanent-urls.ts` | New focused regression test (16 checks). |
| `scripts/test-phase4d10p2-preview-routing.ts` | Updated assertions for the explicitly changed strict permanent/legacy split. |

No customer records, identifiers, indexes, migrations, environment files, or routes were changed.

---

## 2. Before / After URL Behavior

| Surface | Before | After |
|---|---|---|
| Card with `routeSlug` — admin QR | `/r/{routeSlug}` | `/r/{routeSlug}` (unchanged) |
| Card with `uid` only — admin QR | `/c/{slug}` fallback | `/r/{uid}` |
| Legacy card without permanent ID — admin QR | `/c/{slug}` (or public/alias) under Permanent context | **Legacy QR** `/c/{slug}`, clearly labelled; Permanent unavailable |
| Legacy card “Permanent” link | `/c/{slug}` labelled Permanent | **Permanent URL unavailable — legacy card** + separate **Legacy URL** `/c/{slug}` |
| `panthi events` legacy QR | `…/c/panthi events` (raw space) | `…/c/panthi%20events` |
| Standee with `routeSlug` | `/r/{routeSlug}` | `/r/{routeSlug}` (unchanged) |
| Standee with `uid` only | `/qr/{panelQr}` | `/r/{uid}` |
| Legacy standee | `/qr/{panelQr}` labelled Permanent | Permanent unavailable + **Legacy URL** `/qr/{panelQr}`; panel/social rows labelled **Legacy QR** |
| Customer vCards QR | `/r` or immutable `publicSlug` (PPL-01) | unchanged |
| Customer Public URL display/copy/share | Public URL | unchanged |

---

## 3. Permanent vs Public vs Legacy Classification

| Class | Definition | Where used |
|---|---|---|
| **Permanent** | `/r/{routeSlug}` or `/r/{uid}` only | Admin “Permanent”, admin permanent QR/PDF, customer QR (PPL-01) |
| **Public** | Product-specific immutable URL (`/{publicSlug}`, `/review/{alias}`, etc.) | Customer display/copy/share; admin “Public” |
| **Legacy** | `/c/{slug}`, `/profile/{alias}`, `/qr/{qrId}` | Explicitly labelled Legacy only; existing routes remain functional |

No Public URL or external social destination is encoded as a Permanent QR. No Legacy route is labelled Permanent.

---

## 4. Admin QR Behavior

- **Card QR image** (`admin/users/[id]/page.tsx` effect) and **PDF** both call the same `cardQrPayload(c)` helper.
- `cardQrPayload` = strict permanent (`/r/{routeSlug|uid}`) if available, else legacy `/c/{slug}`.
- Legacy QR image is captioned **Legacy QR** with “Not the permanent /r URL”.
- Legacy PDF title is `Legacy QR - …`; filename prefixed `legacy-`.
- If neither permanent nor legacy exists: “Permanent URL unavailable — legacy card”.
- Standee panel/social QR uses `/r/{routeSlug|uid}` when available; `/qr/{qrId}` only for legacy records and is labelled **Legacy QR**.
- Existing legacy preview/download workflow is preserved (not removed), only re-labelled.

---

## 5. Legacy Card Handling

- No identifiers generated, rewritten, or backfilled.
- Live data mapping after the fix:
  - **8/15 cards** have a strict Permanent `/r` URL.
  - **7/15 cards** have no permanent identifier (all legacy); each gets a separate Legacy `/c/{slug}` URL.
  - **1 of the 7 is an active assigned customer card** (`1D:47:97:0B:66:00:00`, anonymized `…e5a9d6`).
  - No card has neither permanent nor legacy.
- `uid` is accepted as a permanent identifier only because the `/r` resolver explicitly supports it (`Card.findOne({ $or: [{ routeSlug }, { uid }] })`).
- Legacy `/c`, `/profile`, `/qr` routes remain unchanged and functional.

---

## 6. Standee Handling

- `permanentEntryPath('standee', …)` now returns `/r/{routeSlug|uid}` only.
- `legacyEntryPath('standee', …)` returns `/qr/{panelQr.qrId}`.
- Admin User Details shows Permanent only when `/r` exists; otherwise “Permanent URL unavailable — legacy standee” plus a separate **Legacy URL**.
- Panel/social QR rows for legacy standees are labelled **Legacy QR**.
- Live: **5/7** standees have `/r`; **2/7** are legacy `/qr`.
- Panel and slot routing, AIO 3/4, Google Review slot routing, and existing printed QRs remain unchanged.

---

## 7. `/api/my/qr` Findings

`src/app/api/my/qr/route.ts` still encodes `{request.nextUrl.origin}/{publicSlug}`.

- Its own contract says: “Generates a server-side QR PNG for a customer-owned product's Public URL … ALWAYS the domain-qualified public URL — never the internal /r/ routing URL.”
- Its only caller in the repository is `scripts/smoke-dynamic-routing.ts`; no current dashboard UI calls it.
- It uses Host-derived origin, not the trusted configured base.
- **Not changed in this task.** Changing it to `/r` would break its documented Public URL API contract. This requires an explicit decision/approval:
  - If it is intended as an NFC/Permanent QR API → change to trusted base + `/r/{routeSlug|uid}`.
  - If it is a Public URL sharing API → keep the publicSlug path, but fix the origin to `canonicalPublicBase()`.
- It was not removed.

---

## 8. Regression Results

| Test | Result |
|---|---|
| `test-ppl04-05-permanent-urls.ts` | **16/16** |
| `scripts/test-ppl01-customer-qr.ts` | **18/18** |
| `scripts/test-ppl02-immutable-urls.ts` | **23/23** |
| `scripts/test-ppl03-01-alias-collision.ts` | **8/8** |
| `scripts/test-customer-public-url-display.ts` | **28/28** |
| `scripts/test-security-boundaries.ts` | PASS |
| `scripts/test-dashboard-entitlement.ts` | **130/130** |
| `scripts/test-phase4d10p2-builder-tabs.ts` | **9/9** |
| `scripts/test-dynamic-routing.ts` | **29/29** |
| `scripts/test-card-binding.ts` | **49/49** |
| `scripts/test-phase4d10p2-backward-compat.ts` | **11/11** OFF, **11/11** ON |
| `scripts/test-standee-review.ts` | **20/20** |
| `tsc --noEmit` | PASS |
| `next lint` | PASS |
| `npm run build` | PASS |

### Stale assertion

`test-phase4d10p2-preview-routing.ts` — **15/16**. The single failure is the pre-existing fixture where `review-noalias` still supplies a `slug`, so the resolver correctly returns `disabled` instead of `missing-alias`. Unchanged from prior audits; not caused by this fix.

Not tested: live customer `/r`/`/qr` HTTP taps, physical NFC/QR scanning, production/preview behavior, and Admin UI browser interaction.

---

## 9. Backward Compatibility Matrix

| Product | Status |
|---|---|
| Premium NFC Business Card | PASS |
| Standard NFC Business Card | PASS |
| Google Review NFC Card | PASS |
| Google Review NFC Plate | PASS |
| Social NFC Card | PASS |
| Legacy NFC Cards | PASS — `/c` works; labelled Legacy |
| Google Review Standee | PASS |
| All-in-One 3 Profile Standee | PASS |
| All-in-One 4 Profile Standee | PASS |

| Route | Status |
|---|---|
| `/r/{routeSlug}` | PASS |
| `/r/{uid}` | PASS |
| `/r/{routeSlug}/{slot}` | PASS |
| `/{publicSlug}` | PASS |
| `/profile/{alias}` | PASS |
| `/review/{alias}` | PASS |
| `/c/{slug}` | PASS |
| `/qr/{qrId}` | PASS |
| `/panel/{route}` | PASS |
| `/standee-review/{slug}` | PASS |

Existing printed QR/NFC payloads are unchanged. No identifier was modified.

---

## 10. Remaining Risks

1. **`/api/my/qr` contract conflict** — still Public URL + Host origin; requires approval to change or deprecate.
2. **Legacy records without `routeSlug`** — 7 cards and 2 standees have no permanent `/r` URL. They remain functional through labelled Legacy routes; no backfill was performed.
3. **`permanentCardUrl` name** — the fallback helper is still named “permanent” for PPL-01 compatibility and is still used by the customer vCards QR. It is documented as the stable customer QR fallback and is no longer used by Admin Permanent UI. A future rename to `stableCardQrUrl` would reduce confusion but would require updating PPL-01 tests.
4. **Production data unverified** — legacy distribution may differ; no production access.
5. **Admin browser interaction not exercised** — static/test coverage only for the UI labels.

---

## 11. Safety Confirmation

- No customer data changed; live `nfc-crm` was read-only.
- No identifiers regenerated or rewritten.
- No database migration, index creation, or schema change.
- No environment file changes; `.env` hashes unchanged.
- No production or preview access.
- No commits, pushes, or deployments.
- Isolated databases (`ppl02_*`, `ppl03_*`, `ppl0405_*`, `taprevia_*`) and temporary servers were dropped/stopped.
- Live counts unchanged: 15 users, 15 cards, 7 standees, 20 assignments, 17 catalog products, 1 review category, 110 templates, 1 review settings, 16 analytics logs.

**PPL-04 and PPL-05 fixed for admin Permanent URL/QR labeling. PPL-01, PPL-02, PPL03-01, and Customer Public URL Display remain green. `/api/my/qr` requires an explicit contract decision before any change.**
