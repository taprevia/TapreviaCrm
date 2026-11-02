# TAPREVIA — P3.4 BACKWARD-COMPATIBILITY CERTIFICATION

**Status:** PASS for the locally executed scope; full external/exhaustive verification pending.

**P3.4 INCOMPLETE — API OR UI COVERAGE GAPS REMAIN**

## Certified locally

| Contract | Evidence | Result |
|---|---|---|
| Accounts/auth/roles | Auth 7/7; login smoke | PASS |
| Password reset | 18/18 | PASS |
| Product assignments/entitlements | 130/130; product smoke | PASS |
| Card IDs/UIDs/aliases/slugs | P2.7 snapshot; no writes | unchanged |
| Standee IDs/routes | Standee lifecycle 24/24 | unchanged |
| NFC/QR routes `/r`, `/qr`, `/c`, `/profile` | Dynamic 29/29; page smoke | PASS |
| Canonical public URLs | URL resolver 15/15; customer/admin smoke | PASS |
| Google destinations | fixtures unchanged; explicit test edits only | PASS |
| Social destinations | explicit product UI edit only | PASS |
| ReviewSettings legacy/central/hybrid | 4D.5 57/57 ×2; BC 11/11 | PASS |
| Missing central settings | BC harness central OFF | PASS |
| Flags OFF / ON combinations | matrix 192/192 | PASS |
| Lower-tier denial | entitlement suite | PASS |
| Review Library/import | 48/48 + 13/13 | PASS |
| Analytics history | 9/9; no read-side mutation | PASS |
| VCF/QR PDF | 69/69 + PASS | PASS |
| Permanent URL visibility | Admin only; customer smoke | PASS |
| Admin/Customer canonical parity | same `/review` path | PASS |

## Snapshot / mutation safety

P2.7 harness snapshots all relevant collections before/after resolution:

- **11/11 central OFF**
- **11/11 central ON**
- **Zero collection mutations**

P3.4 executed 99 unauthenticated/invalid API calls and 43 authorized GETs; no
source changes and no customer/remote data. UI smoke and destination workflows
used synthetic records only.

## API/UI coverage qualification

- All 99 API methods were executed at least once at route level with no 5xx.
- Full positive/negative/tenant/stale matrix for every non-GET method is not
  complete.
- 1234 initially rendered UI controls were inventoried; not all were executed.
- These are coverage gaps, not compatibility failures.

## Exclusions

Live AI/Vercel/Google, physical NFC/QR/devices, screen readers, dependency
advisories, real customer records.

**Certification:** no backward-compatibility regression was observed in the
executed local scope. Release remains contingent on the unverified external and
exhaustive-coverage items.
