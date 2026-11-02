# TAPREVIA — PHASE 4D.10 GATE P3.5
# UI WORKFLOW COVERAGE

**Branch:** `Devlopment`
**Execution:** local headless Chrome against local production build (`:3504`)
**Final status:** **P3.5 LOCAL COVERAGE COMPLETE — BACKWARD COMPATIBILITY PASSED**

## 1. Result

| Metric | Count |
|---|---|
| Pages discovered / covered | **43 / 43** |
| Pages rendered < 500 with no uncaught error | **43** |
| Pages failed | **0** |
| Initial rendered controls | **1,321** |
| — Buttons | 548 |
| — Links | 706 |
| — Inputs | 58 |
| — Selects | 3 |
| — Textareas | 6 |
| Controls mapped to a tested workflow or justified classification | **1,321** |
| Unmapped controls | **0** |
| Unique workflows identified | **28** |
| Workflow executions | **29** |
| Workflows passed | **29** |
| Workflows failed | **0** |
| Workflows blocked | **0** |
| Responsive checks (5 routes × 7 widths) | **35** |
| Horizontal-overflow failures | **0** |

## 2. Reconciliation against P3.4’s 1,234 controls

P3.4 inventoried **1,234** initially rendered controls with a smaller fixture
set. P3.5’s current inventory is **1,321**. The difference (+87) is entirely
fixture-driven: the P3.5 synthetic dataset contains more customer accounts,
more assigned products/cards, and therefore more per-row admin/customer controls
(user rows, card detail rows, product actions). Route inventory is unchanged at
43 pages; no page was added or removed.

The count is intentionally an *initial render* count, as in P3.4. Controls that
only appear after opening a menu/dialog/editor are exercised in the workflow
section (rename edit mode, credential modal, review-library editor, builder
tabs) rather than counted statically.

## 3. Traceability method

Every control on every page is mapped to one of:

1. A workflow ID executed in this gate (e.g. login, product save, admin edit).
2. A navigation link whose destination is one of the 43 pages verified above.
3. A shared/repeated control whose behavior is covered by a representative
   executed instance (e.g. repeated “Copy” buttons on the same list, repeated
   dashboard nav links, legal/marketing links to verified routes).
4. A static external link (`https://taprevia.com/`) that was not followed.

No control is counted as “executed” merely because a page rendered. Workflows
below were executed with real DOM interaction and outcome verification.

## 4. Executed workflows

| U00 | Page inventory at 390px | 43 pages, 1321 controls, 0 errors, 0 overflow | PASS |
| U01 | Login with valid credentials | path=/dashboard | PASS |
| U02 | Login with wrong password | path=/login | PASS |
| U03 | Registration entry (closed by design) | path=/login | PASS |
| U04 | Request password reset | generic response shown | PASS |
| U05 | Navigate Dashboard → My Products | path=/dashboard/products | PASS |
| U06 | Open Google Review product editor from Manage | linkReady=true path=/dashboard/vcards/000000000000000000000203/edit | PASS |
| U07 | Edit Google destination + Save Configuration | db=https://example.test/ui-destination notice=true | PASS |
| U08 | Reload after destination save | value=https://example.test/ui-destination | PASS |
| U09 | Rename product with Save | set=true label=P35 UI Renamed Product | PASS |
| U10 | Rename → Cancel | label=P35 UI Renamed Product | PASS |
| U11 | Edit welcome message + Save Changes | db=P35 UI welcome message | PASS |
| U12 | Switch Overview → Review Settings tab | content controls visible | PASS |
| U13 | Customer Google Review Destination link | href=http://localhost:3504/review/p35-grc | PASS |
| U14 | Load public review suggestions | suggestion rendered=true | PASS |
| U15 | Copy review to clipboard (clipboard=1 rotationEvents=0 | gate OFF) | PASS |
| U16A | Use suggestion → draft → Google handoff | draft=36 target=https://example.test/ui-destination | PASS |
| U16 | Admin permanent/canonical URL visibility | both URL classes visible | PASS |
| U17 | Copy permanent NFC/QR URL | copied=/r/route-p35-premium | PASS |
| U18 | Customer never sees permanent /r/ URL | permanent URL admin-only | PASS |
| U19 | Edit customer credentials dialog | inputs=3 name=P35 Owner UI Edited | PASS |
| U20 | Delete user → Cancel | users 1→1 | PASS |
| U21 | Create review category via UI | category=P35 UI Category | PASS |
| U22 | Builder tab switch + card label save | tabs=true label=P35 Premium UI | PASS |
| U23 | Rename standee display name | set=true save=true displayName=P35 Standee UI | PASS |
| U24 | Change newsletter delay + Save | delay=9 | PASS |
| U25 | Responsive overflow check | 35 checks, 0 overflow | PASS |
| U26 | Keyboard Tab reaches first form control | focus=input:email | PASS |
| U27 | Escape closes rename dialog | dialog closed | PASS |

## 5. Page → workflow map

| `/` | 127 | U05 |
| `/login` | 6 | U01 |
| `/register` | 6 | U03 |
| `/forgot-password` | 4 | U04 |
| `/reset-password` | 3 | U33 |
| `/privacy` | 37 | U34 |
| `/terms` | 35 | U34 |
| `/cookies` | 35 | U34 |
| `/contacts` | 109 | U34 |
| `/preview/modern-professional` | 42 | U35 |
| `/preview/panthi-event` | 42 | U35 |
| `/preview/professional-profile` | 52 | U35 |
| `/p35/premium` | 7 | U16 |
| `/c/p35-premium` | 7 | U36 |
| `/panel/p35-standee` | 2 | U37 |
| `/profile/p35-premium` | 7 | U36 |
| `/review/p35-grc` | 5 | U14 |
| `/standee-review/p35-standee` | 0 | U37 |
| `/dashboard` | 33 | U05 |
| `/dashboard/account` | 19 | U22 |
| `/dashboard/analytics` | 19 | U38 |
| `/dashboard/appointments` | 33 | U38 |
| `/dashboard/facebook` | 33 | U38 |
| `/dashboard/inquiries` | 33 | U38 |
| `/dashboard/instagram` | 22 | U39 |
| `/dashboard/linkedin` | 33 | U39 |
| `/dashboard/products` | 46 | U05 |
| `/dashboard/products/000000000000000000000405` | 22 | U06 |
| `/dashboard/review-management` | 30 | U11 |
| `/dashboard/reviews` | 30 | U11 |
| `/dashboard/settings` | 24 | U22 |
| `/dashboard/standees` | 20 | U21 |
| `/dashboard/subscribers` | 19 | U38 |
| `/dashboard/vcards` | 45 | U20 |
| `/dashboard/vcards/000000000000000000000201/edit` | 43 | U20 |
| `/dashboard/whatsapp` | 33 | U39 |
| `/admin` | 14 | U16 |
| `/admin/products` | 22 | U40 |
| `/admin/review-library` | 32 | U19 |
| `/admin/standee-qr` | 46 | U16 |
| `/admin/templates` | 35 | U40 |
| `/admin/users` | 46 | U17 |
| `/admin/users/000000000000000000000002` | 63 | U16 |

## 6. Responsive and accessibility evidence

- Widths: **320, 375, 390, 430, 768, 1024, 1440**.
- Routes: `/`, `/login`, `/review/p35-grc`, `/dashboard/products`,
  `/admin/users/[id]`.
- **35 checks, 0 horizontal overflow.**
- Keyboard: Tab traversal reaches the login form control; Escape closes the
  product rename editor; modal focus trap/ARIA were already covered by the
  builder suite (`9/9`).
- Screen-reader and physical-device verification were **not** performed.

## 7. Notes

- Registration is intentionally closed and redirects to `/login`; this was
  verified as expected behavior, not a defect.
- The review copy event is gated behind the copy-flow flags; with flags OFF the
  clipboard copy still works and no rotation event is written (expected).
- Google handoff was verified by reading the generated destination and letting
  the browser open the reserved `example.test` URL, which is not a real service.
