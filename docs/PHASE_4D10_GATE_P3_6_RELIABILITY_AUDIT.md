# TAPREVIA — PHASE 4D.10 GATE P3.6
# RELIABILITY AUDIT

**Execution:** local production build + local MongoDB
**Result:** 11/11 reliability scenarios passed; no unhandled customer-facing
stack traces; no background schedulers.

## 1. Failure and recovery scenarios

| ID | Scenario | Result |
|---|---|---|
| R1 | Malformed JSON login → 400, no stack trace | PASS |
| R2 | Missing public card → 404 JSON, no stack trace | PASS |
| R3 | Expired session → 401 JSON (not HTML redirect) | PASS |
| R4 | Stale review-settings write → 409; retry current → 200 | PASS |
| R5 | AI provider unavailable → controlled 503 | PASS |
| R6 | Empty-state dashboard/products render, no crash | PASS |
| R7 | Retry after 404 succeeds | PASS |
| R8 | Concurrent settings write → one 200, one 409 | PASS |
| R9 | Logs contain no JWT secret/raw token/password | PASS |
| R10 | No server cron/queue/worker scheduler in app code | PASS |
| R11 | Health endpoint reports DB up | PASS |

**Totals:** 11 executed, 11 passed, 0 failed.

## 2. Database-unavailable behaviour (separate instance)

Started a local production build pointed at an unreachable local Mongo port:

- `/api/health` → **503** `{ok:false,status:"unhealthy",db:"down"}`.
- `/api/settings` with a session → **500** generic
  `{error:"Internal server error",code:"INTERNAL_ERROR"}` (no stack).
- `/login` → **200** (static shell remains available).
- Authenticated dashboard → **307** to `/login` rather than an infinite hang.

No crash loop and no stack trace was returned to the client.

## 3. Missing-configuration behaviour

With `MONGODB_URI` emptied in a production-mode start:

- The middleware logs
  `Invalid environment configuration: {"MONGODB_URI":["MONGODB_URI is required"]}`.
- Requests return a Next.js **500** page rather than the process refusing to
  start.

This is a **configuration-hardening action** (fail fast at startup or return a
clean 503); it is not a data-corruption risk. No environment file was changed.

## 4. Logging / observability

- Server logs contain request ID, method and path.
- No JWT secret, raw token or password value was found across four server logs.
- Expected failures (AI unavailable, DB down) log a message and return a
  controlled response.
- No external monitoring integration was added.

## 5. Background jobs / lifecycle

- No cron, queue, worker thread or server-side interval scheduler exists in
  `src`; only client toast timing and an analytics comment were found.
- Production build starts cleanly on loopback.
- All audit servers were stopped; ports were released; no orphan process
  remained.

## 6. Concurrency retained from P3.5

- Review settings: 200 + 409 under concurrent writes.
- Appointment slot: 201 + 409.
- Duplicate review copy: idempotent.
- Repeated DELETE: intended 404.

No regression in these behaviours.

**P3.6 QUALITY AUDIT COMPLETE — VERIFIED RISKS REMAIN**

