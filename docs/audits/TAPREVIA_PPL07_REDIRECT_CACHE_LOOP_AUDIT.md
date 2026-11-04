# Taprevia — PPL-07 Permanent Redirect, Cache & Loop Safety Audit

**Date:** 2026-11-03  
**Branch:** `Devlopment`  
**HEAD:** `0191bc1889c95e5716afa2f8f67a991ac131c101`  
**Mode:** Read-only audit + isolated synthetic HTTP tests  
**Database:** live `127.0.0.1:27017/nfc-crm` read-only; synthetic tests in isolated `taprevia_ppl07_http`  
**Production / Preview:** not accessed

---

## 1. Executive Summary

**PPL-07 status: PARTIALLY FIXED.**

Verified actual HTTP behavior:

- No `301`/`308` permanent redirects exist. All permanent/QR redirects are `307` or `302`.
- `/r` and `/qr` redirects have **no `Cache-Control` header**.
- The `/r` card self-redirect guard works (self `/r` → `404`).
- **Loops are not prevented** for:
  - social card → its own Public URL → itself,
  - two cards pointed at each other's `/r` URLs,
  - standee slot → its own `/r/{slug}/{slot}`,
  - `/qr` social slot → a looping `/r` slot.
- Analytics are logged **before** destination validation, so a self-loop 404 still records a successful tap and increments card taps.
- `/qr` card/social-slot redirects do not log taps at all, while `/r` and panel QRs do.
- External destinations are restricted to `http(s)`; `javascript:`, `data:`, `file:` are rejected. Customer-configured external redirects are intentional, not open-redirect vulnerabilities.
- Internal relative redirects use the request URL origin, so Host-header trust is a theoretical low-risk concern.

No customer data or URL identifiers were changed.

---

## 2. Redirect Endpoint Inventory

| Entry point | File | Actual status | Cache-Control observed |
|---|---|---|---|
| `/r/{routeSlug}` card | `src/app/r/[...slug]/route.ts:88–129` | `307` | **none** |
| `/r/{routeSlug}` standee panel | `:135–319` | `307` | **none** |
| `/r/{routeSlug}/{slot}` | `:169–231` | `307` | **none** |
| `/r/{legacy slug/alias/cardUid}` | `:322–357` | `307` | **none** |
| `/qr/{qrId}` card | `src/app/qr/[id]/route.ts:59–81` | `302` | **none** |
| `/qr/{qrId}` standee social | `:83–131` | `302` / `307` review | **none** |
| `/qr/{qrId}` standee panel | `:134–189` | `307` | **none** |
| `/qr/{qrId}` legacy standee QR | `:191–200` | `302` | **none** |
| `/c/{slug}` legacy shim | `src/app/c/[slug]/page.tsx:55–75` | `307` | `private, no-cache, no-store, max-age=0, must-revalidate` |
| `/profile/{alias}` | `src/app/profile/[alias]/page.tsx` → `PublicCardPage` | `200` (or review/social dispatch) | `private, no-cache, no-store, max-age=0, must-revalidate` |
| `/review/{alias}` | `src/app/review/[alias]/page.tsx` | `200` / review flow | same dynamic no-store |
| `/{business}/{product}` social dispatch | `src/components/public/public-card-page.tsx:23–40`; `src/app/[business]/[product]/page.tsx:84–95` | `307` | `private, no-cache, no-store, max-age=0, must-revalidate` |
| `/{business}/{product}` review dispatch | `public-card-page.tsx:49–59` | `307` to `/review/...` | same |
| `/panel/{route}` | `src/app/panel/[slug]/page.tsx` | `200` | dynamic no-store |
| `/standee-review/{slug}` | `src/app/standee-review/[slug]/page.tsx` | review page | dynamic no-store |
| Middleware (protected routes) | `src/middleware.ts:22–27, 127–166` | `307` login/dashboard | only dev no-store |

---

## 3. HTTP Status & Caching Matrix

Observed through a temporary production server on `localhost:3501` with isolated fixtures:

| Request | Status | Location | Cache-Control |
|---|---|---|---|
| `/r/ppl07profile` | `307` | `/ppl07biz/profile` | **none** |
| `/r/ppl07review` | `307` | `/review/ppl07-review-alias` | **none** |
| `/r/ppl07external` | `307` | `https://example.test/destination` | **none** |
| `/r/ppl07self` (self `/r`) | `404` | — | **none** |
| `/r/ppl07loop-a` | `307` | `/r/ppl07loop-b` | **none** |
| `/r/ppl07loop-b` | `307` | `/r/ppl07loop-a` | **none** |
| `/r/ppl07pubself` | `307` | `/ppl07biz/social-pub` | **none** |
| `/r/ppl07standee` | `307` | `/r/ppl07standee/1` | **none** |
| `/r/ppl07standee/1` | `307` | `/r/ppl07standee/1` | **none** |
| `/r/ppl07panel` | `307` | `https://example.test/instagram` | **none** |
| `/qr/ppl07self` | `302` | `/r/ppl07self` | **none** |
| `/qr/ppl07profile` | `302` | `/profile/ppl07-profile-alias` | **none** |
| `/qr/PANELPPL07` | `307` | `/panel/ppl07standee` | **none** |
| `/qr/SOCPPL07` | `302` | `/r/ppl07standee/1` | **none** |
| `/qr/PANELPPL07B` | `307` | `/panel/ppl07panel` | **none** |
| `/qr/SOCPPL07B` | `302` | `https://example.test/instagram` | **none** |
| `/c/ppl07-legacy` | `307` | `/profile/ppl07-legacy-alias` | `private, no-cache, no-store, max-age=0, must-revalidate` |
| `/profile/ppl07-profile-alias` | `200` | — | `private, no-cache, no-store, max-age=0, must-revalidate` |
| `/panel/ppl07panel` | `200` | — | `private, no-cache, no-store, max-age=0, must-revalidate` |
| `/ppl07biz/social-pub` | `307` | `/ppl07biz/social-pub` | `private, no-cache, no-store, max-age=0, must-revalidate` |

### Finding PPL07-01 — `/r` and `/qr` lack `Cache-Control` (MEDIUM)

`/r` and `/qr` return redirects with no `Cache-Control` header (`r/[...slug]/route.ts:122,188,217,223,264,285,292,315,355`; `qr/[id]/route.ts:44,73,76,111,129,174,183,199`). Middleware's dev-only no-store (`middleware.ts:22–27`) does not apply in production.

- Neither endpoint uses `301`/`308`, so browsers should not treat them as permanent.
- However, the task's warning is valid: **307/302 do not guarantee no caching**. Some CDNs/proxies may cache by default or by configuration.
- A cached redirect would keep serving an old destination after the customer changes it.
- `/c`, `/profile`, `/panel`, and `/{business}/{product}` do emit Next.js dynamic no-store, so the gap is specific to the two route handlers.

**Recommendation:** add `Cache-Control: no-store, max-age=0, must-revalidate` (and optionally `CDN-Cache-Control: no-store`) to every `/r`/`/qr` redirect and 404 response. Do not introduce 301/308.

---

## 4. Loop Prevention Findings

### Verified

| Scenario | Result |
|---|---|
| Card social destination = own `/r/{route}` | `/r` self guard returns `404` (`r/[...slug]:117–124`) |
| Social destination = own Public URL | **Loop**: public URL `307` → same public URL, indefinitely |
| Two cards point at each other's `/r` URLs | **Loop**: `/r/loop-a` ↔ `/r/loop-b`, indefinitely |
| Standee slot destination = own `/r/{slug}/{slot}` | **Loop**: `307` → same slot |
| `/qr` social slot → looping `/r` slot | **Loop** via `/qr` `302` → `/r` `307` self |
| Standee panel → own slot | **Loop** for single-slot standee (`/r/standee` → `/r/standee/1` → self) |
| `/c/{slug}` → `/profile/{alias}` | Terminates at profile page (no reverse redirect) |
| External invalid protocol (`javascript:`, `data:`, `file:`) | Rejected by `isSafeExternalUrl` / `SAFE_EXTERNAL` |

### Finding PPL07-02 — Loop guard only covers `/r` card branch (MEDIUM)

`src/app/r/[...slug]/route.ts:117–124` compares only the target origin/pathname with the current request pathname. It does not cover:

- standee panel/slot branches (`:169–231`, `:249–319`),
- `/qr` card/social/panel branches (`qr/[id]/route.ts:71–131, 151–189`),
- `/c` → `/profile` (terminates normally),
- social card `dispatchSocialCard` (`public-card-page.tsx:23–40`),
- review dispatch (`:49–59`) — review target `/review/...` does not normally loop.

The guard is exact-path only; it does not detect multi-hop cycles or an internal destination that later points back.

### Loop chains observed

```text
/r/ppl07pubself
  → /ppl07biz/social-pub
  → /ppl07biz/social-pub  (cycle)

/r/ppl07loop-a
  → /r/ppl07loop-b
  → /r/ppl07loop-a  (cycle)

/r/ppl07standee/1
  → /r/ppl07standee/1  (cycle)

/qr/SOCPPL07
  → /r/ppl07standee/1
  → /r/ppl07standee/1  (cycle)
```

These are browser request chains; the server does not detect or terminate them. Each hop can write analytics/logs and consume server work.

### Root cause

Customer-configured destinations are allowed to be any `http(s)` URL, including Taprevia's own routes. The resolver has no shared loop detector and no chain state. The only guard is the single exact self-path check in the `/r` card branch.

**Recommendation:** centralize a normalized self/loop check and apply it to every branch. At minimum, reject a destination whose normalized origin/path equals the current request path (case-insensitive, ignore trailing slash/query). Cross-card cycles cannot be fully solved statelessly; document or add a bounded redirect-chain check without breaking legitimate external destinations.

---

## 5. Redirect Security Findings

| Check | Result |
|---|---|
| Protocol validation | PASS — `isSafeExternalUrl` allows only `http:`/`https:` (`safe-url.ts:4–12`); `resolveCardDestination` uses `SAFE_EXTERNAL` (`redirect-target.ts:26,33–34`) |
| JavaScript/data/file URL rejection | PASS by source + security tests |
| Relative internal redirects | Generated from fixed `/profile`, `/review`, `/panel`, `/r`, `/qr` paths |
| Open redirect | Customer-configured external destinations are intentional; no untrusted query parameter is used as a redirect target |
| Host-header trust | **Theoretical/LOW** — relative redirects use `request.url`/`request.nextUrl.origin` (`r:117,224,286,293`; `qr:77,185`), so a trusted proxy that forwards a spoofed Host could influence the origin. External destinations are absolute and unaffected. |
| URL normalization/encoding | Route keys are lowercased; aliases are `encodeURIComponent`d in destination resolution; standee external destinations are preserved as configured |
| Query/fragment preservation | External destinations keep query/fragment; internal destinations are fixed paths |
| Auth boundary | `/r`, `/qr`, `/c`, `/profile`, `/review`, `/panel`, `/standee-review` are intentionally public via middleware (`middleware.ts:5–16`) |
| Entitlement/owner checks | Resolvers use `withPublicCardVisibility`; review/standee hosts re-check eligibility; no new bypass observed |

No open redirect or protocol-jump vulnerability was confirmed. The loop behavior is a reliability/DoS issue, not an authorization bypass.

---

## 6. Analytics Behavior

Controlled isolated run with synthetic requests:

- Analytics log count before: `0`; after: `20`.
- `/r/ppl07self` returned `404` but still logged `route:ppl07self` **twice** across the matrix/chain and incremented `stats.taps` by 2.
- `/r/ppl07loop-a` / `loop-b`: 2 taps each; `/r/ppl07standee/slot:1` logged 3 times; `/r/ppl07pubself` logged route + `social_redirect` alias events.
- `/qr/ppl07self`, `/qr/ppl07profile`, `/qr/SOCPPL07`, `/qr/SOCPPL07B` produced **no card/social tap logs**.
- `/qr/PANELPPL07`, `/qr/PANELPPL07B` produced `qr-panel` logs.
- `/c/ppl07-legacy` produced `card:ppl07-legacy` shim log.

### Finding PPL07-03 — Taps logged before destination validation (MEDIUM)

`/r` logs and increments taps at `r/[...slug]/route.ts:104–111` and `:343–350` before `resolveCardDestination`/destination checks. A self-loop `404` therefore records a successful tap. Same pattern exists in the standee panel branch (`:238–247`) before destination resolution.

**Recommendation:** resolve and validate the destination first; log only when a redirect will actually be emitted. Do not log failed/blocked destinations as successful taps.

### Finding PPL07-04 — `/qr` card/social analytics missing (LOW)

`qr/[id]/route.ts:71–81` and `:94–131` redirect without writing `AnalyticsLog` or incrementing `stats.taps`. Only panel QRs log (`:152`). This makes `/qr` analytics inconsistent with `/r`.

**Recommendation:** standardize QR analytics per resolution, or explicitly document `/qr` as non-logging during migration.

---

## 7. Product-by-Product Compatibility

| Product | Result |
|---|---|
| Premium NFC Business Card | PASS — dynamic/binding suites |
| Standard NFC Business Card | PASS |
| Google Review NFC Card / Plate | PASS |
| Social NFC Card | PASS — external redirect preserved |
| Legacy NFC Cards | PASS — `/c`, `/profile`, legacy `/r` unchanged |
| Google Review Standee | PASS |
| All-in-One 3 / 4 Standees | PASS |
| `/r/{routeSlug}`, `/r/{uid}`, `/r/{routeSlug}/{slot}` | PASS |
| `/{publicSlug}`, `/profile/{alias}`, `/review/{alias}` | PASS |
| `/c/{slug}`, `/qr/{qrId}`, `/panel/{route}`, `/standee-review/{slug}` | PASS |

No existing route was removed or changed. Existing printed QR/NFC payloads remain unchanged.

---

## 8. Synthetic HTTP Test Results

Temporary server: `localhost:3501`, isolated DB `taprevia_ppl07_http`, fixtures:

- profile/review/social/external/legacy cards,
- self-loop social card,
- public-URL self-loop social card,
- two-card `/r` cycle,
- standee panel/slot self-loop,
- legacy `/c` card,
- panel and social QR standees.

All probes used `redirect: 'manual'` and a maximum 5-hop cycle detector. Database and server were dropped/stopped after the run.

No writes were made to `nfc-crm`.

---

## 9. Regression Results

| Test | Result |
|---|---|
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

---

## 10. Confirmed Vulnerabilities by Severity

| ID | Severity | Finding |
|---|---|---|
| PPL07-01 | **MEDIUM** | `/r` and `/qr` redirects have no `Cache-Control: no-store`; CDN/proxy may cache a stale destination |
| PPL07-02 | **MEDIUM** | Loop prevention only covers `/r` card exact self-path; public-URL self, cross-card, standee slot and `/qr` loops are unbounded |
| PPL07-03 | **MEDIUM** | `/r` logs/increments taps before destination validation; self-loop 404s count as successful taps |
| PPL07-04 | **LOW** | `/qr` card/social redirects do not log analytics, unlike `/r`/panel |
| PPL07-05 | **LOW** | Relative internal redirects use Host-derived origin (theoretical host-header risk) |
| PPL07-06 | **LOW/INFO** | Status inconsistency: `/r` 307, `/qr` 302/307, `/c` 307; no 301/308 anywhere |

No CRITICAL/HIGH open-redirect or authorization bypass was confirmed.

---

## 11. Minimal Recommended Fixes

1. **Cache headers (code-only):** add `Cache-Control: no-store, max-age=0, must-revalidate` to every `/r` and `/qr` redirect/404 response. Optionally `CDN-Cache-Control: no-store`. Keep 307/302; do not add 301/308.
2. **Central loop check (code-only):** normalize and compare target vs current request path (case-insensitive, strip trailing slash/query) in all branches, not just the `/r` card branch. At minimum cover:
   - standee panel/slot,
   - `/qr` card/social/panel,
   - social `dispatchSocialCard`,
   - `/c`/profile dispatches.
3. **Analytics ordering:** validate destination before writing `AnalyticsLog`/incrementing `stats.taps`; log only on actual redirect. Preserve panel/slot metadata.
4. **QR analytics parity:** decide whether `/qr` should log; if not, document it explicitly. If yes, add one event per resolution.
5. **Host trust:** for internal relative redirects, consider building from the configured canonical public base where appropriate, or document the trusted-proxy assumption.
6. **Status consistency:** standardize temporary redirects (307) or document `/qr` 302 historical behavior. Do not introduce permanent cache semantics.

No schema, index, or migration change is required.

---

## 12. Final Classification

**PPL-07: PARTIALLY FIXED.**

- `/r` card self-loop guard exists and works.
- No permanent `301`/`308` caching directives exist.
- Public/legacy routes and all PPL-01…PPL-06 fixes remain working.
- Missing `Cache-Control`, unguarded multi-hop/standee/QR loops, premature analytics, and `/qr` analytics gaps remain.

**No application code, customer data, identifiers, routes, indexes, migrations, or environment files were changed during this audit. Awaiting approval before any fix.**
