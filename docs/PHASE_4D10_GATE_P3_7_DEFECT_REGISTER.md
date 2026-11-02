# TAPREVIA — PHASE 4D.10 GATE P3.7
# DEFECT REGISTER

**Final status:** **P3.7 INCOMPLETE — REQUIRED VERIFICATION GAPS REMAIN**
**Release readiness:** **NEEDS ACTION**

| ID | Severity | Category | Module | Reproduction | Expected | Actual before | Root cause | Repair | Regression evidence | Status |
|---|---|---|---|---|---|---|---|---|---|---|
| P37-D01 | P3 | Reliability / configuration | `src/lib/env.ts`, `src/lib/auth.ts`, `src/lib/auth-edge.ts`, `src/lib/db.ts`, `src/instrumentation.ts`, `/api/health`, `/api/settings` | Production start with missing/invalid `MONGODB_URI` or `JWT_SECRET` | Clear fail-fast before serving; Vercel build without runtime env succeeds | Request-time 500; full env schema imported by middleware; build required runtime env | Eager env validation at module import and no startup gate | Lazy JWT/DB resolution; startup exit gate; health config 503; APP_KEY AI-key write 503; build skips runtime-only validation | Missing vars exit; no-env build PASS; valid health 200; APP_KEY 503 | **FIXED** |
| P37-D02 | P3 | Performance / privacy | Inter font imports in `contacts/page.tsx`, `panthi-event.tsx` | Load `/contacts` or preview with external egress blocked | No mandatory external font request | 2 Google Fonts requests | No licensed local Inter asset; external `@import` | **Not repaired** — exact Inter assets/licensing unavailable; owner approval required | 2 blocked requests before/after | **OPEN / BLOCKED** |
| P37-D03 | — | Verification gap | Lighthouse | `npx --offline lighthouse --version` | Run Lighthouse locally | Not installed/cached; `ENOTCACHED` | Tool acquisition requires network | None | Executed command recorded | **BLOCKED / NOT VERIFIED** |
| P37-D04 | — | Verification gap | VoiceOver | AppleScript System Events | Genuine screen-reader check | Apple event authorization denied (`-1743`) | No accessibility permission; auditory output cannot be verified | None | Command recorded | **NOT VERIFIED** |
| P37-D05 | — | Verification gap | Dependency advisories | Online advisory database | Current advisory result | Offline DB only | Registry access prohibited | None | `npm audit --offline` 0 | **BLOCKED / NOT VERIFIED** |
| P37-D06 | — | Operational gap | Backup/rollback ownership | Production RPO/RTO/owner/rollback authority | Documented and owned | Not inspectable locally | No Vercel/Atlas access allowed | Documentation only | Synthetic dump/restore PASS | **NOT VERIFIED** |

## Retained from P3.6

| ID | Status |
|---|---|
| P36-D01 P1 accessibility icon names/targets | FIXED, retained |
| P36-D02 P2 accessibility semantics/landmarks/nesting | FIXED, retained |
| P36-D03 P2 accessibility contrast | FIXED, retained |
| P36-D04 P2 API invalid-session 307 → 401 JSON | FIXED, retained |
| P36-D05 P3 200% text overflow | FIXED, retained |

## Summary

- New confirmed app defects: **1** (P37-D01, P3)
- Repaired: **1**
- Remaining app defects: **0**
- Verification/operational gaps: **4** (fonts, Lighthouse, screen reader, online advisories) + backup/rollback ownership
- P0/P1/P2 remaining: **0**
