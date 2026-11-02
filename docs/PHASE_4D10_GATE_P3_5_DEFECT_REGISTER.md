# TAPREVIA — PHASE 4D.10 GATE P3.5
# DEFECT REGISTER

**Status:** **P3.5 LOCAL COVERAGE COMPLETE — BACKWARD COMPATIBILITY PASSED**

| ID | Severity | Classification | Module / route | File | Reproduction | Expected | Actual (before) | Root cause | Fix | Regression test | Status |
|---|---|---|---|---|---|---|---|---|---|---|---|
| P35-D01 | P3 (UX) | Confirmed defect | Admin User Details `/admin/users/[id]` | `src/app/(admin)/admin/users/[id]/page.tsx` | Open the page at 320, 375 or 390 px with several assigned products | No horizontal page overflow | Document scrollWidth 419 at 320 px; NFC card grid track and “Assigned Products” badge row extended past the viewport | Grid item lacked `min-w-0`; product row/badge group were non-wrapping and `shrink-0`, so long labels set the track min-content width | Added `min-w-0` to the NFC card item; made the assigned-product row `flex-wrap` and its badge group `min-w-0 flex-wrap` | `U25` in `scripts/test-phase4d10p3-ui-workflows.ts` — 5 routes × 7 widths, 35 checks, 0 overflow | **FIXED** |
| AUD-001 | P3 | Prior confirmed defect (P3.2) | Public footer | `src/components/layout/footer.tsx` | Footer links pointed at `href="#"` | Real `/terms`, `/contacts`, `/privacy` destinations | Placeholder anchors | Placeholder markup | Real routes | P3.2 browser/build + P3.5 page inventory | FIXED (retained) |
| AUD-002 | P3 | Prior confirmed defect (P3.2) | Admin copy URL | `src/app/(admin)/admin/users/[id]/page.tsx` | Admin copy produced a malformed absolute URL | Absolute public URL | Base URL prepended to absolute/empty paths | String concatenation | `absolutePublicUrl()` helper | P3.2 + P3.5 U16/U17 | FIXED (retained) |

## Findings that were not defects

| Observation | Classification |
|---|---|
| `POST /api/admin/catalog` returns 403 and creates nothing | Intentional: catalog is code-defined |
| Registration page redirects to `/login` | Intentional: self-registration closed |
| Standee review endpoints return 404 with gate OFF | Expected feature-gated behavior |
| Review AI returns 503 without a key | Expected unconfigured-provider contract |
| Review copy writes no rotation event with flags OFF | Expected feature-gated behavior |
| Customer cannot delete an assigned card | Intentional: product allocation is admin-authoritative |
| `DELETE` repeat returns 404 | Intended idempotent-delete contract |

## Confirmed defect summary

- P0: **0**
- P1: **0**
- P2: **0**
- P3: **1 confirmed, 1 repaired, 0 remaining**
- P4: **0 new**

## Unverified / blocked

- Live external services, screen readers, physical devices, dependency advisories.
- OS-level outbound network sandbox.
