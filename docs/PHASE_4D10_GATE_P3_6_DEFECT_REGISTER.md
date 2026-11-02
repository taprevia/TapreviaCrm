# TAPREVIA — PHASE 4D.10 GATE P3.6
# DEFECT REGISTER

**Final status:** **P3.6 QUALITY AUDIT COMPLETE — VERIFIED RISKS REMAIN**

| ID | Severity | Category | Module / route | File(s) | Reproduction | Expected | Actual before | Root cause | Repair | Regression evidence | Status |
|---|---|---|---|---|---|---|---|---|---|---|---|
| P36-D01 | P1 | Accessibility | Login password toggle; dashboard/admin navigation | `src/app/(auth)/login/page.tsx`, `src/components/layout/navbar.tsx` | 390px; Tab to the password eye or menu button | Accessible name and ≥24px target | `button-name` critical (1 login, 2 per dashboard/admin page); login target <24px | Icon-only buttons had no `aria-label`; eye toggle had no padding | Added `aria-label`, `aria-pressed`/`aria-expanded`, 24px grid target | axe 0 violations; keyboard pass | **FIXED** |
| P36-D02 | P2 | Accessibility | Login semantics, landmarks, product cards, headings, admin definition list | `src/app/(auth)/login/page.tsx`, `src/components/layout/navbar.tsx`, `src/components/marketing/ui/ProductCard.tsx`, `src/app/(admin)/admin/users/[id]/page.tsx`, marketing footer | axe scan of login/landing/dashboard/admin | One named `main`, valid heading order, no nested interactive controls, valid `dl` | Login lacked visible `h1`/`main`; 14 nested interactive nodes; duplicate landmarks; h3 after h1; `dl` contained spans | Semantic wrapper and landmark errors | Added `<main>`/`<aside>`/`h1`, removed outer `role=button`/tabIndex, unique nav/sidebar labels, corrected headings, replaced invalid `dl` | axe 0 violations; UI 29/29 | **FIXED** |
| P36-D03 | P2 | Accessibility | Colour contrast across public, dashboard and admin | `tailwind.config.ts`, `src/components/ui/{button,input}.tsx`, review-management fields/dialog, review assistant, sticky dock, marketing ProductCard/Hero/PreBooking/Footer/WhatsApp/ChatBubble/ForTeamsCTA, contacts template, admin user page | axe colour-contrast rule | ≥4.5:1 normal text | 39 violations (many contrast, worst 1.41:1) | Light-theme grey text used on dark surfaces; muted token too dark; white on WhatsApp green; translucent footer | Dark-safe tokens/labels, darker green backgrounds, raised opacity, corrected accent text | axe 0 violations | **FIXED** |
| P36-D04 | P2 | Reliability / API contract | Any API route with an invalid session cookie | `src/middleware.ts` | `GET /api/settings` with `token=not-a-real-token` | 401 JSON | 307 redirect to `/login` (HTML) | Middleware treated API like a page | API paths now return 401 JSON and clear the cookie; page paths still redirect | Security A2/R3 pass; 56/56 write harness | **FIXED** (intentional contract correction) |
| P36-D05 | P3 | Accessibility | 200% text resize | `src/components/layout/navbar.tsx`, `src/app/(dashboard)/dashboard/products/page.tsx` | 390px + root font 200% on My Products | No horizontal page overflow | Document scrollWidth 494 vs 390 viewport | Navbar gaps/brand text fixed and URL row non-wrapping | Responsive gaps/text truncation, URL row `flex-wrap` | 200% resize overflow false | **FIXED** |
| P36-D06 | P3 | Performance / privacy observation | Landing page external font | landing font link | Load `/` with external egress blocked | No mandatory external asset | 2 Google Fonts requests attempted (blocked, fallback rendered) | External font stylesheet | **Not repaired** — owner decision required (self-host Inter) | 2 blocked requests recorded | **OPEN / NEEDS ACTION** |
| P36-D07 | P3 | Reliability / configuration | Startup with missing `MONGODB_URI` | `src/lib/env.ts`, middleware | Start production with empty `MONGODB_URI` | Fail fast with clear startup error or clean 503 | Per-request Next 500 page; clear log emitted | Validation occurs at module import on first request | **Not repaired** — deployment config hard gate; no env change made | Startup log captured | **OPEN / NEEDS ACTION** |
| P36-D08 | — | Verification limitation | Lighthouse, online advisories, screen reader | — | — | — | Not installed/cached; registry prohibited; no screen reader | Environment/tooling limitation | None | Documented | **NOT VERIFIED** |

## Retained prior repair

| ID | Status |
|---|---|
| P35-D01 — Admin User Details responsive overflow (320–390px) | FIXED, still verified by 35 responsive checks |
| AUD-001 / AUD-002 — P3.2 footer/admin-copy fixes | FIXED, retained |

## Summary

- Confirmed defects: **7** (P1: 1, P2: 3, P3: 3)
- Repaired: **5**
- Remaining verified risks: **2** (external font dependency, missing-config fail-fast)
- Unverified areas: **1 group** (Lighthouse, online advisories, screen reader)
- P0: **0**; P1 remaining: **0**; P2 remaining: **0**
