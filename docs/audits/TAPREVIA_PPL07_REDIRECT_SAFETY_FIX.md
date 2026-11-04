# Taprevia — PPL-07 Redirect Cache, Loop & Analytics Safety Fix

**Date:** 2026-11-03  
**Branch:** `Devlopment`  
**HEAD:** `0191bc1889c95e5716afa2f8f67a991ac131c101`  
**Mode:** Verify → minimal implementation → HTTP test → regression → report

---

## 1. Files Changed

| File | Purpose |
|---|---|
| `src/lib/no-store.ts` | Shared `noStoreRedirect` / `noStoreText` with `Cache-Control` + `CDN-Cache-Control` |
| `src/lib/services/redirect-loop.ts` | Bounded internal redirect-graph resolver and `wouldRedirectLoop()` |
| `src/app/r/[...slug]/route.ts` | No-store on every response; loop checks; analytics after destination validation |
| `src/app/qr/[id]/route.ts` | No-store; loop checks; panel analytics after destination validation; legacy branch safety |
| `src/app/c/[slug]/page.tsx` | Loop check before shim tap/redirect |
| `src/components/public/public-card-page.tsx` | Social dispatch loop check before analytics/redirect |
| `src/app/profile/[alias]/page.tsx` | Passes current path into `PublicCardPage` |
| `src/app/[business]/[product]/page.tsx` | Passes current public path into `PublicCardPage` |
| `scripts/test-ppl07-redirect-safety.ts` | New focused 11-check loop/no-store regression test |

No customer data, identifiers, routes, indexes, migrations, or environment files changed.

---

## 2. Root Causes

### PPL07-01 — Missing cache headers

`/r` and `/qr` are route handlers returning `NextResponse.redirect(...)` with no `Cache-Control`. The middleware dev-only no-store never applies in production. 307/302 are temporary but do not guarantee no caching by CDNs/proxies.

### PPL07-02 — Incomplete loop protection

Only the `/r` card branch compared the destination pathname to the current request pathname. Standee, `/qr`, social public dispatch, `/c`, and multi-hop cycles had no guard. The check was also a single string comparison, so it could not detect even a two-card cycle.

### PPL07-03 — Analytics before destination validation

`/r` logged taps and incremented `stats.taps` before resolving/validating the destination. A self-loop 404 was therefore counted as a successful tap. Standee panel and `/qr` panel analytics were also written before the final destination was known.

---

## 3. Before / After HTTP Behavior

Actual HTTP probes used isolated DB `taprevia_ppl07fix_http` and a temporary production server on `localhost:3501`.

| Request | Before | After |
|---|---|---|
| `/r/{valid card}` | 307, no cache header | 307, `Cache-Control: no-store, max-age=0, must-revalidate` + `CDN-Cache-Control: no-store` |
| `/r/{valid standee panel/slot}` | 307, no cache | 307, no-store |
| `/r/{self loop}` | 404, no cache header, **logged tap** | 404, no-store, **no analytics/tap increment** |
| `/r/loop-a` ↔ `/r/loop-b` | 307 loop | 404, no-store, no analytics |
| `/r/{permanent→public→permanent}` | 307 loop | 404, no-store, no analytics |
| Social public URL self | 307 to itself | 404, no-store, no analytics |
| Standee slot self | 307 to itself | 404, no-store, no analytics |
| `/qr` → looping `/r` slot | 302 loop | 404, no-store, no analytics |
| `/qr` valid card/panel/social | 302/307, no cache | 302/307, no-store |
| `/qr` missing | 404, no cache | 404, no-store |
| `/c/{legacy}` | 307, Next no-store | unchanged |
| `/profile` / `/panel` | 200, Next no-store | unchanged |

### Actual no-store header

```
Cache-Control: no-store, max-age=0, must-revalidate
CDN-Cache-Control: no-store
```

Applied to successful redirects, missing destinations, invalid identifiers, loop rejections, and 500 error paths in `/r` and `/qr`.

---

## 4. Redirect-Loop Test Matrix

| Case | Result |
|---|---|
| Direct `/r` self | **REJECTED (404)** |
| Case/encoded/query variant of self | **REJECTED** |
| Two-card `/r` cycle | **REJECTED** |
| Public URL self | **REJECTED** |
| Permanent → Public → Permanent | **REJECTED** |
| Standee slot self | **REJECTED** |
| `/qr` → standee slot → `/qr` | **REJECTED** |
| Valid external destination | **ALLOWED (307)** |
| Valid internal profile destination | **ALLOWED (307)** |

The graph walk is bounded to 5 hops. A longer legitimate chain is **not** rejected just because it exceeds the bound; only a proven cycle is blocked. External off-origin destinations terminate the walk and are never blocked for being external.

### Known residual loop limitation

A customer-configured chain longer than 5 internal hops that eventually cycles may not be detected in one request. It will be detected when the chain re-enters the guarded graph within the bound. This is an intentional bounded-strategy limitation, not a claim of full graph closure.

---

## 5. Analytics Before / After

### Rejected/loop requests

- `/r/self`, `/r/loop-a`, `/r/pubself`, `/r/standee/1`, `/qr/SOCPPL07F`, `/qr/ppl07fself`, direct social self, and missing route.
- Result: **0 analytics logs**, **0 tap increments**.

### Valid `/r` requests

Five valid requests (`profile`, `review`, `external`, standee slot, legacy) produced:

- **5 analytics events**, one per resolution.
- Card tap counters each incremented once (profile/review/external/legacy).
- Loop card counter remained 0.

### `/qr`

- Panel QR produced exactly one `qr-panel` event.
- Card/social QR analytics behavior unchanged (PPL07-04 deliberately not expanded).

### One test-expectation issue

The temporary HTTP harness initially expected `/r/ppl07f-legacy` to log `card:ppl07f-legacy`; the actual and correct metadata is `route:ppl07f-legacy` because the request resolved through `/r`, not `/c`. The `/c` request separately logs `card:...`. This was a test-label error, not an application failure.

---

## 6. Product Compatibility Matrix

| Product / route | Result |
|---|---|
| Premium NFC Business Card | PASS |
| Standard NFC Business Card | PASS |
| Google Review NFC Card / Plate | PASS |
| Social NFC Card | PASS |
| Legacy NFC Cards | PASS (`/c`, `/profile`, `/r` fallback) |
| Google Review Standee | PASS |
| All-in-One 3 / 4 Standees | PASS |
| `/r/{routeSlug}`, `/r/{uid}`, `/r/{routeSlug}/{slot}` | PASS |
| `/{publicSlug}`, `/profile/{alias}`, `/review/{alias}` | PASS |
| `/c/{slug}`, `/qr/{qrId}`, `/panel/{route}`, `/standee-review/{slug}` | PASS |

Existing permanent/public identifiers and printed payloads are unchanged.

---

## 7. Regression Results

| Test | Result |
|---|---|
| `test-ppl07-redirect-safety.ts` | **11/11** |
| PPL-01 customer QR | **18/18** |
| PPL-02 immutable URLs | **23/23** |
| PPL03-01 alias collision | **8/8** |
| PPL04/05 permanent URLs | **16/16** |
| PPL-06 alias validation | **41/41** |
| Customer Public URL display | **28/28** |
| Security boundaries | PASS |
| Dynamic routing | **29/29** |
| Card binding | **49/49** |
| Standee review | **20/20** |
| Dashboard entitlement | **130/130** |
| `test-phase4d10p2-preview-routing.ts` | **15/16** — known stale `review-noalias` fixture; unrelated |
| `tsc --noEmit` | PASS |
| `next lint` | PASS |
| `npm run build` | PASS |

Actual HTTP matrix: all loop/cache/no-store assertions passed; the only harness mismatch was the legacy metadata label noted above.

---

## 8. Remaining Low-Severity Risks

1. **PPL07-04 — `/qr` card/social analytics** remain absent by design (not expanded without approval).
2. **PPL07-05 — Host-derived origin** is still used for internal redirect resolution/URL construction where headers are available. Loop detection prefers the request host for correctness; trusted-proxy assumptions remain documented.
3. **PPL07-06 — Status inconsistency** `/r` 307 vs `/qr` 302/307 remains; no 301/308 introduced.
4. **Bounded graph:** cycles longer than 5 internal hops are not precomputed.
5. **External destination chain** on a different host cannot be followed by the internal graph; this is intentional and avoids fetching arbitrary external URLs.
6. **No-store** is applied at route handlers; any future redirect helper added outside these routes must use the shared helper.

---

## 9. Safety Confirmation

- No customer data modified; live `nfc-crm` was read-only.
- No identifiers regenerated or rewritten.
- No URL or route changes.
- No schema, index, migration, or environment changes.
- No production/preview access.
- No commits, pushes, or deployments.
- Isolated DB/server (`taprevia_ppl07fix_http`, `ppl07_redirect_safety`) and temporary servers were dropped/stopped.
- Live counts and `.env` hashes unchanged.

---

## 10. Final PPL-07 Status

**PPL-07: FIXED for the three confirmed medium findings.**

- **PPL07-01 FIXED:** `/r` and `/qr` redirects/404/errors now emit no-store headers.
- **PPL07-02 FIXED for tested cycles:** bounded internal graph rejects direct, two-card, permanent→public→permanent, standee slot, and `/qr` loops; valid external/internal destinations remain allowed.
- **PPL07-03 FIXED:** analytics/tap counters are written only after destination validation/loop check.
- **PPL07-04/05/06 remain documented low-severity limitations** and were intentionally not expanded.

**No customer data, identifiers, routes, or environment settings were changed. Awaiting approval before any further changes.**
