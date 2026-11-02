# TAPREVIA — PHASE 4D.10 GATE P3.6
# RELEASE-READINESS CHECKLIST

**Overall:** **NEEDS ACTION**
**Local audit:** complete · **Backward compatibility:** passed
**No deployment performed.**

| Area | Status | Evidence / required action |
|---|---|---|
| Production build health | READY | `next build` PASS; typecheck/lint PASS |
| Local startup/shutdown | READY | Clean start; ports released; no orphans |
| Security headers | READY | CSP, nosniff, no-referrer, Permissions-Policy, XFO, HSTS |
| Auth/session security | READY | 24/24 checks; cookie flags; CSRF; invalid API session 401 |
| Tenant/role isolation | READY | 58 P3.5 security scenarios, 0 failures |
| Input/output security | READY | XSS/NoSQL/redirect/CSV/upload checks pass |
| Secrets exposure | READY | Source, bundle and log scans clean |
| Dependency advisories | **NEEDS ACTION** | `npm audit --offline` 0, but online advisory DB NOT VERIFIED |
| Network isolation | READY (local scope) | Process egress guard; loopback only; external AI blocked |
| Accessibility automated | READY | axe 0 violations on 11 pages |
| Accessibility keyboard/responsive | READY | Keyboard pass; 35/35 responsive; 200% resize pass |
| Screen-reader certification | **NOT VERIFIED** | VoiceOver/TalkBack not performed |
| Performance — rendering | NEEDS ACTION | LCP ≤2.52 s locally; Lighthouse/INP not verified |
| Performance — API/DB | READY (local) | Median 1.8–9.8 ms; indexes used; 0 errors |
| External font dependency | **NEEDS ACTION** | Landing requests Google Fonts; self-host decision required |
| Reliability/failure handling | READY | 11/11 scenarios; DB-down controlled |
| Missing critical env fail-fast | **NEEDS ACTION** | Currently request-time 500 page; make startup hard-fail/503 |
| Logging/observability | READY (local) | No secret/token/password leakage; request IDs present |
| Background jobs | READY | No server cron/queue/worker found |
| Database migrations | READY | None introduced; no destructive migration |
| Environment configuration | **NEEDS ACTION** | Production requires MONGODB_URI, JWT_SECRET, APP_KEY; verify deployment values |
| Backup/recovery | **NOT VERIFIED** | No production backup/restore drill in this gate |
| Rollback strategy | **NOT VERIFIED** | No deployment performed; define Vercel rollback owner/step |
| NFC/QR printed-route compatibility | READY | `/r`, `/c`, `/profile`, `/review`, `/panel` verified unchanged |
| Canonical URL / destination compatibility | READY | URL 15/15; BC 11/11 ×2 |
| Customer data preservation | READY | No data migration; synthetic fixtures only |
| Feature-flag defaults | READY | All 16 combinations pass |
| Monitoring/alerting readiness | **NOT VERIFIED** | No production monitoring integration tested |
| Deployment | **BLOCKED BY POLICY** | Not authorized in this gate |

## Required actions before release

1. Run an approved online dependency-advisory audit and triage results.
2. Decide and implement (or formally accept) self-hosted fonts.
3. Make missing `MONGODB_URI`/`JWT_SECRET`/`APP_KEY` fail at startup with a
   clear error, or return a clean 503 instead of a 500 page.
4. Run Lighthouse/real INP in a production-like environment.
5. Perform screen-reader spot checks on login, product edit, review flow and
   admin dialogs.
6. Confirm production backup/restore and rollback ownership.

**RELEASE READINESS: NEEDS ACTION**

**P3.6 QUALITY AUDIT COMPLETE — VERIFIED RISKS REMAIN**

