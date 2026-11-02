# TAPREVIA — PHASE 4D.10 P3.3 DEFECT REGISTER

| ID | Severity | Classification | Module | Route | File | Root Cause | Evidence | Fix | Regression test | Status |
|---|---|---|---|---|---|---|---|---|---|---|
| AUD-001 | P3 | Confirmed bug | Public footer | All pages using Footer | `src/components/layout/footer.tsx` | Company links used `href="#"` | Source inventory; browser footer links | Replaced with `/terms`, `/contacts`, `/privacy` | Source/browser; P3.2 build | FIXED (P3.2) |
| AUD-002 | P3 | Confirmed bug | Admin User Details copy | `/admin/users/[id]` | `src/app/(admin)/admin/users/[id]/page.tsx` | Copy prepended base URL to absolute/empty paths | Canonical resolver can return absolute or relative; base may be empty | Added `absolutePublicUrl()` | Typecheck/lint; admin smoke | FIXED (P3.2) |
| P33-V01 | — | Verified workflow | Customer product links | `/dashboard/products`, `/dashboard/vcards` | — | — | Browser + `/api/cards` canonical previews | None | P3.3 smoke | PASS |
| P33-V02 | — | Verified workflow | Destination button | `/dashboard/products/[id]` | — | — | UI save → DB/reload `social-ui-updated` | None | Browser + DB | PASS |
| P33-V03 | — | Verified workflow | Review one-click setup | `/dashboard/review-management` | — | — | Complete Setup → Save & Activate → Ready; 2 PATCHes | None | Browser | PASS |
| P33-V04 | — | Verified workflow | Partial save | `/api/review-management/products/[assignmentId]` | — | — | Central 200; stale product 409; no false Ready; retry 200 | None | API/DB | PASS |
| P33-V05 | — | Verified workflow | Admin/customer parity | `/admin/users/[id]` vs My Products | — | — | Canonical review URL on both; permanent only admin | None | Browser/API | PASS |
| P33-G01 | — | Coverage gap | API methods | All APIs | — | 99 methods discovered; not exhaustively executed per method | Inventory only | None | — | GAP |
| P33-G02 | — | Coverage gap | UI actions | All pages | — | Not every button/link/input counted/executed | Page smoke only | None | — | GAP |
| P33-G03 | — | External | AI/Vercel/Google/devices | — | — | Local-only mandate/no credentials | Not executed | None | — | NOT VERIFIED |
| P33-G04 | — | External | Dependency advisories | `package-lock.json` | — | No audit run | Not executed | None | — | GAP |
| P33-G05 | P4 | Dead code | Review dialogs | — | `hybrid-dialog.tsx`, `product-settings-dialog.tsx` | P3.0 removed mounts; components remain | No active imports | Pending cleanup | Typecheck | KNOWN |

## Summary

- New confirmed P0–P2 defects in P3.3: **0**.
- Prior P3 defects repaired: **2**.
- Verified previously reported workflows: customer product links, destination
  button, one-click setup, partial-save recovery, admin/customer URL parity.
- Remaining coverage gaps: exhaustive API/UI-action matrix, live external
  systems, devices/readers, dependency advisories.

**P3.3 INCOMPLETE — COVERAGE OR TESTING GAPS REMAIN**
