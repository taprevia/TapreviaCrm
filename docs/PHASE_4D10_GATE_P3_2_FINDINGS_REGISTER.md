# TAPREVIA — PHASE 4D.10 P3.2 FINDINGS REGISTER

| ID | Severity | Classification | Module | File | Root Cause | Evidence | Fix | Test | Status |
|---|---|---|---|---|---|---|---|---|---|
| AUD-001 | P3 | Confirmed bug | Public layout / Footer | `src/components/layout/footer.tsx` | Placeholder `href="#"` for About/Contact/Privacy | Source inventory; `/terms`, `/contacts`, `/privacy` routes exist | Replaced with real `Link` destinations (Terms/Contact/Privacy) | Typecheck/lint/build; source check | FIXED |
| AUD-002 | P3 | Confirmed bug | Admin User Details copy actions | `src/app/(admin)/admin/users/[id]/page.tsx` | `${PUBLIC_BASE_URL}${path}` assumed relative path + non-empty base; social canonical URLs are absolute | Code path inspection; canonical resolver can return `https://…` or relative; base may be empty | Added `absolutePublicUrl()` preserving absolute paths and empty base; used for permanent/public copy | Typecheck/lint/build | FIXED |
| AUD-003 | — | Intentional / backward compatibility | Public routing | `/c`, `/profile`, `/r`, `/qr`, `/{business}/{product}` | Legacy identifiers/printed links must remain valid | Route inventory; regression suites; BC harness | Retained | 4D.6/dynamic/BC | INTENTIONAL |
| AUD-004 | — | Expected feature-gated behavior | Review/AI/Standee | flag modules, entitlement services | Flags default OFF; lower-tier restrictions | Flag matrix; entitlement suite | Retained | 192/192 matrix; 130/130 | INTENTIONAL |
| AUD-005 | — | Intentional / security | Admin permanent links | Admin User Details; `/admin/standee-qr` | Permanent NFC/QR metadata is privileged; page consolidated | P2.8 UI; redirect | Retained | URL resolver 15/15 | INTENTIONAL |
| AUD-006 | P4 | Dead / unused code | Review Management | `src/components/review-management/hybrid-dialog.tsx`, `product-settings-dialog.tsx` | P3.0 removed source/hybrid UI mounts; components remain for compatibility analysis | No active imports | None (cleanup later) | Typecheck/lint | PENDING CLEANUP |
| AUD-007 | P4 | Performance observation | vCards API | `src/app/api/cards/route.ts` | Preview resolver performs entitlement/settings lookups per card, bounded by page size 5 | Source inspection; no measured slowdown | None | — | OBSERVATION |
| AUD-008 | — | Environment | Build runtime | `next.config.mjs`, `package.json` | Historical dev/build `.next` collision | P2.5 fixed with `NEXT_DIST_DIR`; clean dev/prod runs | Retained | P2.5 dev/prod stability | VERIFIED |
| AUD-009 | — | Unverified | External integrations | AI, Vercel, devices | No authorized live credentials/remote access | No live calls performed | None | — | UNVERIFIED |
| AUD-010 | — | Unverified | Whole app UI/API | 43 pages / 83 API routes | Not every page/control was interactively browser-tested | Coverage inventory only | None | — | GAP |
| AUD-011 | — | Unverified | Dependencies | `package-lock.json`/packages | No advisory scan executed | No audit run | None | — | GAP |
| AUD-012 | — | Unverified | Accessibility/performance | All UI | No physical screen-reader or Lighthouse run | Automated-only checks | None | — | GAP |

## Summary

- Confirmed defects found: **2** (both P3, both fixed).
- Known P0/P1/P2 local defects remaining: **0**.
- Intentional compatibility behaviors: retained.
- Unverified coverage: full per-screen/action sweep, external integrations,
  dependency advisories, physical/screen-reader and performance audits.

**AUDIT INCOMPLETE — COVERAGE OR TESTING GAPS REMAIN**
