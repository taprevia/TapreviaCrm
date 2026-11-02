# TAPREVIA — P3.4 DEFECT REGISTER

| ID | Severity | Classification | Module | Route | File | Root Cause | Evidence | Fix | Test | Status |
|---|---|---|---|---|---|---|---|---|---|---|
| AUD-001 | P3 | Confirmed bug (P3.2) | Footer | Public pages | `src/components/layout/footer.tsx` | `href="#"` placeholders | Source + browser | `/terms`, `/contacts`, `/privacy` | P3.2 build/browser | FIXED |
| AUD-002 | P3 | Confirmed bug (P3.2) | Admin copy | `/admin/users/[id]` | `src/app/(admin)/admin/users/[id]/page.tsx` | Base URL prepended to absolute/empty paths | Canonical resolver; admin smoke | `absolutePublicUrl()` | Typecheck/lint/browser | FIXED |
| P34-V01 | — | Verified | Customer links | My Products/vCards | — | — | Canonical `/review`/profile; no `/r` | None | Browser/API | PASS |
| P34-V02 | — | Verified | Destination button | `/dashboard/products/[id]` | — | — | UI save → reload → DB | None | Browser/DB | PASS |
| P34-V03 | — | Verified | One-click review setup | Review Management | — | — | Complete Setup → Save & Activate → Ready | None | Browser | PASS |
| P34-V04 | — | Verified | Partial save | Review products API | — | — | stale 409, no false Ready, retry 200 | None | API/DB | PASS |
| P34-V05 | — | Verified | Admin/customer URL parity | Admin/User/My Products | — | — | same canonical; permanent admin-only | None | Browser/API | PASS |
| P34-G01 | — | Coverage gap | API positive CRUD | All non-GET APIs | — | Not every authorized scenario executed | 99 route-level negatives; 43 GET positives | None | — | GAP |
| P34-G02 | — | Coverage gap | UI actions | 1234 controls | — | Not every control/dialog/destructive action executed | DOM inventory only | None | — | GAP |
| P34-G03 | — | Unverified | External | AI/Vercel/Google/devices | — | Local-only/no credentials | Not executed | None | — | NOT VERIFIED |
| P34-G04 | — | Unverified | Dependencies | package lock | — | No advisory scan | Not executed | None | — | GAP |
| P34-G05 | P4 | Dead code | Legacy dialogs | — | `hybrid-dialog.tsx`, `product-settings-dialog.tsx` | Unmounted after P3.0 | No active imports | Pending cleanup | Typecheck | KNOWN |

## Summary

- New P0–P2 defects in P3.4: **0**.
- Previously repaired P3 defects: **2**.
- API methods executed route-level: **99/99**, full matrix incomplete.
- UI controls inventoried: **1234**, exhaustive execution incomplete.
- Backward compatibility: no failures in executed checks.

**P3.4 INCOMPLETE — API OR UI COVERAGE GAPS REMAIN**
