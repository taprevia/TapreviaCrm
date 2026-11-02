# TAPREVIA — PHASE 4D.10 GATE P3.2
# COMPLETE CODEBASE AUDIT — FINDINGS & SAFE REPAIR

**Branch:** `Devlopment`
**HEAD:** `db08e7a80c7c0b2972ebdef4841214478acfd7ae`
**Production:** untouched
**Remote DB / Vercel:** not accessed or modified
**Status:** **AUDIT INCOMPLETE — COVERAGE OR TESTING GAPS REMAIN**

---

## 1. Executive summary

A broad local audit covered the architecture, route/API inventory, products,
authentication, entitlements, review management, URLs, Standee flow, build
isolation and available automated suites.

Two confirmed defects were found and repaired:

1. **Dead public Footer links** — About/Contact/Privacy all used `href="#"`.
   Replaced with real `/terms`, `/contacts`, `/privacy` destinations.
2. **Admin public-URL copy could be malformed** — copy actions prepended
   `NEXT_PUBLIC_BASE_URL` to already-absolute (social) or empty URLs. Added an
   `absolutePublicUrl()` helper used by permanent/public copy actions.

No security vulnerability or backward-compatibility regression was found in the
tested scope. All available regression suites pass.

**Coverage is not complete:** not every one of the 43 pages and 83 API routes was
interactively browser-tested, and live AI, Vercel Preview/Production, physical
devices, screen readers and dependency advisories remain unverified. This report
does not claim a full-system PASS.

---

## 2. Repository baseline

| Item | Value |
|---|---|
| Branch | `Devlopment` |
| HEAD | `db08e7a80c7c0b2972ebdef4841214478acfd7ae` |
| Working tree | 53 entries before P3.2 docs |
| Typecheck / ESLint | PASS |
| Build OFF / ON | PASS |
| Flags | all four OFF |
| Env mtimes | unchanged |

No reset/stash/clean/rebase/commit/push/deploy or remote DB access.

---

## 3. Architecture map

- Next.js App Router: public marketing, auth, customer dashboard, admin,
  public Card/review/Standee routes.
- MongoDB/Mongoose models for users, cards, standees, products, assignments,
  review library/settings/rotation, analytics, inquiries, media, settings.
- Service layer for entitlement, product experience, assignment, review
  settings/analytics/generation, URL/preview resolution, storage, auth.
- API layer: 83 route handlers (`src/app/api/**/route.ts`).
- Feature gates: four review flags, OFF by default.
- Build isolation: P2.5 `NEXT_DIST_DIR` (dev `.next-dev`, build `.next`).

---

## 4. Module inventory

Auth/login/register/password reset/account; customer dashboard, products,
vcards/editor, standees/manage, review management, analytics, settings,
subscribers, inquiries/appointments; admin overview/users/products/templates/
review library/user details; public profiles, `/c`, `/profile`, `/r`, `/qr`,
`/t`, `/panel`, `/review`, `/standee-review`, marketing/contacts/privacy/terms;
media/storage; VCF/QR PDF; review library import/export; AI review; public
tracking; health.

Unrelated live modules were not redesigned.

---

## 5. Route inventory

- 43 `page.tsx` routes and 83 API `route.ts` handlers were enumerated.
- Public compatibility routes preserved: `/r`, `/qr`, `/c`, `/profile`,
  `/{business}/{product}`, `/panel`, `/review`, `/standee-review`, `/t`.
- Admin standee QR route now redirects to `/admin/users` by design (P2.8).
- No route removed in P3.2.

---

## 6. UI action inventory (audited areas)

- Review Management: product cards, Complete Setup/Edit Link, inline input,
  save/cancel, Preview, source dropdown removed, central settings.
- vCards: canonical URL, Preview, QR, edit/delete.
- My Products: canonical URL/copy, Manage, Preview, rename.
- Standees: list, Manage, slots, save, QR/public URL.
- Public review: automatic suggestion, language/length refresh, regenerate,
  edit/copy, AI/manual, Google handoff.
- Admin: user details products/Qrs/copy, users list, review library, templates,
  product assignment.
- Footer navigation.

Full per-control browser coverage across all admin/customer screens is not
claimed (see gaps).

---

## 7. Feature-flag inventory

| Flag | Default | Verified |
|---|---|---|
| `NEW_REVIEW_COPY_FLOW_ENABLED` | OFF | matrix 16 combos |
| `SMART_REVIEW_ROTATION_ENABLED` | OFF | matrix + dependency |
| `CENTRAL_REVIEW_PUBLIC_INTEGRATION_ENABLED` | OFF | matrix + BC |
| `STANDEE_REVIEW_ASSISTANT_ENABLED` | OFF | matrix + Standee |

No flag was activated.

---

## 8. Backward-compatibility map

| Contract | Status |
|---|---|
| Accounts/auth/sessions | Preserved; auth suite 7/7 |
| Card IDs/UIDs/aliases/slugs | unchanged (BC snapshot) |
| Standee IDs/routes | unchanged |
| NFC/QR/Google destinations | unchanged |
| ReviewSettings/legacy/hybrid | resolver preserved |
| Review Library/templates | preserved |
| Analytics/rotation | preserved; UI-only hiding |
| Public routes/API fields | preserved/additive |
| Entitlements | unchanged; 130/130 |

P2.7 snapshot harness: 11/11, zero collection mutations.

---

## 9. Findings register

See `docs/PHASE_4D10_GATE_P3_2_FINDINGS_REGISTER.md` for the full table.
Summary:

| ID | Severity | Classification | Status |
|---|---|---|---|
| AUD-001 | P3 | Confirmed bug — dead footer links | FIXED |
| AUD-002 | P3 | Confirmed bug — malformed absolute copy URL | FIXED |
| AUD-003 | — | Intentional legacy routes/aliases | Retained |
| AUD-004 | — | Intentional feature gates/entitlements | Retained |
| AUD-005 | P4 | Dead/unmounted dialogs after P3.0 | Retained |
| AUD-006 | P4 | Bounded preview-resolution queries in vCards API | Observation |
| AUD-007 | — | Dev/build isolation P2.5 | Verified |
| AUD-008 | — | Live AI/Vercel/devices/readers/dependency scan | UNVERIFIED |
| AUD-009 | — | Full per-screen browser action sweep | GAP |

---

## 10. Confirmed defects

### AUD-001 — Footer dead links

- File: `src/components/layout/footer.tsx`.
- Root cause: placeholders `href="#"`.
- Fix: `/terms`, `/contacts`, `/privacy`.
- Evidence: source inventory; routes exist.
- Compatibility: none.

### AUD-002 — Admin copy URL could be malformed

- File: `src/app/(admin)/admin/users/[id]/page.tsx`.
- Root cause: `${PUBLIC_BASE_URL}${path}` assumed a relative path and non-empty
  base; social canonical URLs are absolute, and a missing base produced bad text.
- Fix: `absolutePublicUrl()` preserves absolute URLs and handles empty base.
- Applies to permanent/public copy controls in Admin User Details.
- Compatibility: Admin UI only; public routes unchanged.

---

## 11. Intentional behaviors (not classified as bugs)

- Legacy public routes `/c`, `/profile`, `/r`, `/qr`, `/{business}/{product}`.
- Multiple identifiers (UID, alias, slug, publicSlug, routeSlug) for compatibility.
- Central/individual/hybrid settings and legacy fallback.
- Four review flags default OFF.
- Product entitlement restrictions/lower-tier denial.
- Admin-only permanent-link management; `/admin/standee-qr` redirect.
- Unmounted legacy review/override dialogs retained for compatibility analysis.
- Rotation/unclassified API fields retained while hidden in Analytics UI.

---

## 12. Environment/configuration issues

- P2.5 dev/build isolation remains correct; no chunk collision in clean runs.
- Preview QR/base URL and provider configuration remain external.
- No environment variables changed.

---

## 13. Security findings

No verified vulnerability in the tested scope. Auth/admin authorization,
ownership/tenant isolation, entitlement checks, CSRF/origin, input validation,
safe redirects, rate limiting and secret handling pass existing suites. Public
NFC/QR scanning remains public; permanent-link management is admin-only.
Dependency advisories were not scanned (gap).

---

## 14. Performance findings

- vCards list resolves canonical preview metadata per card (page capped at 5);
  bounded, not a demonstrated defect.
- No unbounded query/duplicate-fetch defect was proven in this audit.
- Full bundle/Lighthouse analysis was not performed (gap).

---

## 15. UX findings

- Footer company links fixed.
- P3.0 Review Management setup now uses premium cards, inline setup and no
  settings-source choice.
- No other UX defect was reproduced in tested screens.
- Full keyboard/screen-reader sweep across every page remains a gap.

---

## 16. Files changed

- `src/components/layout/footer.tsx` — real footer destinations.
- `src/app/(admin)/admin/users/[id]/page.tsx` — `absolutePublicUrl()` helper and
  copy usage.
- `docs/PHASE_4D10_GATE_P3_2_COMPLETE_CODEBASE_AUDIT.md`
- `docs/PHASE_4D10_GATE_P3_2_FINDINGS_REGISTER.md`

No schema/database/route/destination changes.

---

## 17. Root-cause analysis

Both confirmed defects were client-side URL/navigation defects:

- Static placeholder anchor values, never wired to existing public pages.
- A copy helper that assumed all admin URLs were relative and base-configured.

Neither affected server authorization, data or public routing.

---

## 18. Fixes implemented

Minimal, additive UI fixes. No service/API/schema changes. No redesign of
unrelated screens.

---

## 19. Regression tests added

No new test harness was necessary for two UI link/copy defects; existing suites
were rerun. A future browser assertion for footer links and Admin copy output is
recommended (coverage gap).

---

## 20. Exact test results

| Suite | Result |
|---|---|
| Typecheck / ESLint | PASS |
| Build OFF / ON | PASS |
| 4D.5 Review Management | 57/57 OFF · 57/57 ON |
| 4D.6 Standee | 20/20 × 4 = 80/80 |
| Unified analytics | 9/9 |
| Historical analytics | 9/9 |
| 16-combination matrix | 192/192 |
| 4D.8/4D.9 fixes | 0 failures; 14/14 rows |
| URL resolver / BC harness | 15/15 · 11/11 |
| Builder / preview config | 9/9 · 41/41 |
| Security / entitlement | PASS · 130/130 |
| Review Library / import | 48/48 · 13/13 |
| Card / dynamic / Standee lifecycle | 49/49 · 29/29 · 24/24 |
| VCF / QR PDF | 69/69 · PASS |
| Auth / password reset | 7/7 · 18/18 |
| Mail provider | 21/21 |
| Identity / timestamp UID / integrity | 17/17 · 19/19 · all invariants |
| `git diff --check` | clean |

Auth/password-reset ran earlier in P3.2 against a disposable local server;
other suites ran against the final tree.

---

## 21. Unverified areas

- Full browser/action verification of all 43 pages and 83 APIs.
- Live AI provider, Vercel Preview/Production, external Google navigation.
- Physical NFC/QR, mobile devices, TalkBack/VoiceOver.
- Dependency vulnerability advisories.
- Real customer remote data/ownership of the reported test-url alias.
- Bundle/Lighthouse performance and exhaustive accessibility audit.

---

## 22. Remaining risks

- Unverified screens/actions could contain additional defects.
- External environment/QR/AI issues remain.
- Unmounted legacy dialogs are dead code awaiting cleanup.
- Bounded vCards preview lookups could be optimized later.

No known P0/P1 local defect remains.

---

## 23. Preview verification checklist

- [ ] Footer links open Terms/Contact/Privacy.
- [ ] Admin User Details Public/Permanent copy works for relative and absolute
      canonical URLs and with/without base URL.
- [ ] Review Management one-click setup still works.
- [ ] Canonical URLs only on customer screens; permanent only Admin Details.
- [ ] Legacy `/r`, `/qr`, `/c`, `/profile`, `/review` work.
- [ ] Public review/AI/library/copy/Google works.
- [ ] Standee Manage slots.
- [ ] Lower-tier/cross-tenant denial.
- [ ] Mobile 320–1440 and refresh.

---

## 24. Rollback plan

Revert the two UI changes (footer links, admin absolute-URL helper) if needed.
No database, schema, route, identifier or destination rollback is required.
Flags stay OFF. P2.3–P3.0 behavior remains intact.

---

## 25. Backward Compatibility Certification

**Certified locally for the tested scope:** no schema/data/route/identifier/
destination change; BC snapshot 11/11 with central gate OFF and ON; all existing
public routes and API contracts preserved; entitlements unchanged; no read-side
mutations.

**Not certified for:** untested screens/actions, live external integrations,
physical devices, screen readers, dependency advisories, Vercel runtime.

**AUDIT INCOMPLETE — COVERAGE OR TESTING GAPS REMAIN**

Stopped. No commit, push, deployment, remote database access or feature
activation occurred.
