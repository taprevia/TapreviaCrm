# Taprevia — Google Review Product URL Fix

**Date:** 2026-11-04  
**Branch:** `Devlopment`  
**HEAD:** `0191bc1889c95e5716afa2f8f67a991ac131c101`  
**Mode:** Investigate → root cause → minimal fix → regression → report  
**Final status:** **COMPLETED — MINIMAL DISPLAY/RESOLVER FIX**

---

## 1. Confirmed Root Cause

`http://localhost:3000/review/digital-mw1uejy228` is the **review experience destination**, not the permanent QR/NFC URL.

The affected card:

| Field | Value |
|---|---|
| Card `_id` | `6aeae9d218200f2461c8cd62` |
| Card UID | `DIGITAL-MW1UEJY228` |
| `urlAlias` / `slug` | `digital-mw1uejy228` |
| `routeSlug` / `uid` | `mw1uejy4td` |
| `publicSlug` | `taprevia/google-review` |
| Kind | `review` |
| Review published | **No** — `reviewAssistant.enabled = false` |
| Owner | `test4@gmail.com` — `6aeae9d218200f2461c8cd1a` |
| Product | Google Review Card — `6ae851d69391bf20babb51fb` |

The permanent QR/NFC URL was already correct:

```text
/r/mw1uejy4td  → 307 → /review/digital-mw1uejy228
```

The bug was in **customer-facing Public URL resolution**: review cards with an allocated immutable `publicSlug` bypassed it and always displayed `/review/{urlAlias}`.

The audit `docs/audits/TAPREVIA_BRANDED_PUBLIC_URL_AND_PRODUCT_DUPLICATE_AUDIT.md` classified this as a **confirmed branding gap**, not a broken `/r` resolver.

---

## 2. Exact Files and Functions Changed

| File | Function / area | Change |
|---|---|---|
| `src/lib/services/customer-public-url.ts:44–50` | `resolveCustomerPublicPath` | Review cards prefer `/{publicSlug}`; fall back to `/review/{urlAlias|slug}` |
| `src/lib/services/product-preview.ts:80–99` | `resolveCardPreview` | Review preview returns `/{publicSlug}` when published; otherwise the existing review alias route |
| `src/app/(dashboard)/dashboard/products/page.tsx:307–318` | My Products public URL | Published review cards use branded `publicUrl`; unpublished cards keep `/review` fallback |
| `src/app/(dashboard)/dashboard/products/[id]/page.tsx:306–320` | Product detail public URL | Uses `canonicalPublicUrl` (preview) for published review cards; falls back to `/review` |
| `src/app/(dashboard)/dashboard/vcards/page-client.tsx:19–39, 66–78` | vCards display URL | Adds `kind` to the read model; unpublished review cards keep `/review` fallback |

### Intentionally unchanged

- `src/lib/services/redirect-target.ts` — `/r` still resolves review cards to `/review/{alias}`.
- `src/lib/services/admin-card-view.ts` — permanent QR helper still uses `/r/{routeSlug}` only.
- `src/lib/services/review-product-eligibility.ts` — Review Management “Open review page” remains `/review/{alias}`.
- All card identifiers, route slugs, public slugs, aliases, and QR/NFC payloads.

No new route was introduced. No existing route meaning changed.

---

## 3. Before / After URL Behavior

### Published review card (e.g. prince’s `kaka-pvc/google-review`)

| Surface | Before | After |
|---|---|---|
| Customer Public URL / copy | `/review/digital-mvz27ltm5k` | **`/kaka-pvc/google-review`** |
| Preview resolver | `/review/digital-mvz27ltm5k` | **`/kaka-pvc/google-review`** |
| Existing `/review/{alias}` | 200 | **200 — unchanged** |
| Permanent `/r/{routeSlug}` | `/r/mvz27ltnip` → 307 | **unchanged** |
| Branded `publicSlug` route | 307 → `/review/{alias}` | **307 — unchanged** |

Verified over HTTP on a disposable clone:

```text
/kaka-pvc/google-review         307 → /review/digital-mvz27ltm5k
/review/digital-mvz27ltm5k      200
/r/mvz27ltnip                   307 → /review/digital-mvz27ltm5k
/kaka-pvc/google-review-2       307 → /review/digital-mvz27lvnp0
/review/digital-mvz27lvnp0      200
/r/mvz27lvofa                   307 → /review/digital-mvz27lvnp0
```

### Target card — review currently disabled

| Surface | Behavior |
|---|---|
| `/review/digital-mw1uejy228` | **200** — existing review route remains functional (unavailable state) |
| `/r/mw1uejy4td` | **307** → `/review/digital-mw1uejy228` — permanent route unchanged |
| `/taprevia/google-review` | **404** — branded route is publish-gated while review is disabled |
| Dashboard Public URL | **Keeps `/review/digital-mw1uejy228` fallback** until review is enabled |

This fallback is deliberate: the dashboard must not advertise a branded URL that currently 404s because the review is unpublished.

Once the review is enabled/published, the card will display and copy:

```text
http://localhost:3000/taprevia/google-review
```

which already dispatches to the same review experience.

---

## 4. Backward Compatibility Verification

| Requirement | Result |
|---|---|
| Card IDs / ObjectIds unchanged | **PASS** |
| `uid`, `routeSlug`, `urlAlias`, `publicSlug` unchanged | **PASS** |
| Existing `/review/{urlAlias}` links functional | **PASS** |
| Existing `/r/{routeSlug}` resolver behavior | **PASS** |
| Permanent QR/NFC payloads still `/r/{routeSlug}` | **PASS** — PPL-01 18/18 |
| Branded `/{publicSlug}` review routes | **PASS** for published cards |
| Business/Premium profile public URLs | **PASS** — unchanged |
| Social card redirects | **PASS** |
| Standee routes | **PASS** |
| QR downloads / copy controls | **PASS** — QR helper untouched |
| Review Management settings/entitlements | **PASS** — untouched |
| Redirect loops introduced | **None** |
| Database schema/migrations | **None** |
| Customer data / assignments / entitlements | **No writes by this task** |

The QR/NFC generation path was not changed. QR codes continue to encode `/r/{routeSlug}` only.

---

## 5. Regression Results

### Targeted tests

| Test | Before fix | After fix |
|---|---|---|
| `test-customer-public-url-display.ts` | **28 passed, 1 failed** — review ignored `publicSlug` | **29/29 PASS** |
| `test-phase4d10p2-preview-routing.ts` | **15/18** — new publicSlug tests failed | **17/18** — new tests pass; one known stale fixture remains |
| `test-phase4d10p2-backward-compat.ts` | n/a | **11/11 PASS** |

The existing `review-noalias` fixture failure in `test-phase4d10p2-preview-routing.ts` is pre-existing and unchanged: the fixture supplies a `slug`, so the resolver correctly returns a preview instead of `missing-alias`. It is unrelated to this fix.

### Full relevant suite

| Suite | Result |
|---|---|
| PPL-01 stable NFC/QR | **18/18 PASS** |
| PPL-02 immutable identifiers | **23/23 PASS** |
| PPL03-01 alias collision | **8/8 PASS** |
| PPL-04/PPL-05 Permanent/Legacy separation | **16/16 PASS** |
| PPL-06 alias validation | **41/41 PASS** |
| PPL-07 redirect/cache/loop safety | **11/11 PASS** |
| Customer Public URL display | **29/29 PASS** |
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

### Not tested

- Browser-level `test-phase4d10p3-ui-workflows.ts` was not executed (requires browser/server orchestration). Its expected customer destination was updated to the branded URL for the published `p35-grc` fixture.
- `test-review-phase2-products.ts` was not run; it uses the unchanged Review Management `previewUrl` (`/review/{alias}`) and is not affected by the public display change.
- Live physical NFC scanning and printed QR scanning were not performed.

---

## 6. Remaining Risks / Limitations

1. **Unpublished review cards** keep the `/review/{alias}` fallback. Their branded `publicSlug` route returns 404 until the review is enabled. This is intentional publish-gating, not a broken identifier.
2. The target card `6aeae9d218200f2461c8cd62` currently has review disabled, so its dashboard URL remains `/review/digital-mw1uejy228`. Enabling/publishing review would switch it to the branded `taprevia/google-review` URL. No customer data was changed to do that.
3. Review Management’s “Open review page” continues to use `/review/{alias}` intentionally; it is an admin review-page link, not the customer-facing Public URL.
4. The underlying `NEXT_PUBLIC_BASE_URL` remains the local development value (`http://localhost:3000`); it was not changed.

---

## 7. Database / Customer Record Confirmation

- **No database writes** were made by this task.
- All database inspection was read-only.
- All test writes were confined to disposable databases and dropped afterward.
- The target card’s `_id`, `cardUid`, `slug`, `urlAlias`, `routeSlug`, `uid`, `publicSlug`, kind, status, and `isActive` values are unchanged.
- No assignments, entitlements, profiles, standees, reviews, analytics, or canonical products were modified.
- No production or preview database was accessed.
- No commit, push, or deployment was performed.
