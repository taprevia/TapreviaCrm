# TAPREVIA — PHASE 4D.10 GATE P3.6
# ACCESSIBILITY AUDIT

**Engine:** axe-core 4.13.0 (locally installed) · headless Chrome
**Target:** WCAG 2.2 AA-oriented automated and keyboard checks
**Result:** **0 axe violations** on 11 pages after repair; 35/35 responsive;
keyboard checks pass; screen-reader verification **NOT VERIFIED**

## 1. Before / after

| Measure | Before | After |
|---|---:|---:|
| Pages scanned | 11 | 11 |
| axe violations | 39 | **0** |
| Pages with violations | 11 | **0** |
| Serious/critical violations | 21 | **0** |
| Responsive overflow failures | 0 | 0 |
| 200% text-resize overflow | Yes (My Products) | **No** |

## 2. Defects found and repaired

1. **Icon-only controls had no accessible name** (critical `button-name`):
   password show/hide and mobile navigation/sidebar buttons. Added
   `aria-label`, `aria-pressed`/`aria-expanded`, and 24px targets.
2. **Login semantics** (moderate): no visible `main`/`h1`; added `<main>`,
   `<aside>`, visible `h1`.
3. **Nested interactive controls** (serious) on marketing product cards: outer
   `role="button"`/tabIndex/aria-label wrapped inner links; removed the nested
   interactive wrapper while keeping mouse click behavior.
4. **Colour contrast** (serious, multiple pages): raised muted/faint tokens,
   fixed light-on-dark and dark-on-dark combinations, corrected ghost-button
   and label colours, marketing footer text, WhatsApp CTA text, review-page
   surface, and success/error badges.
5. **Landmark duplication/nesting**: unique nav/sidebar labels, removed the
   nested `<main>` on the contact-card template.
6. **Heading order/definition list**: corrected section headings and replaced a
   non-definition `<dl>` with a plain container.
7. **Target size**: login toggle, admin copy controls, contact meta links now
   meet 24×24 CSS px.
8. **200% text resize**: navbar logo/gaps and the public-URL row now reflow
   without horizontal page overflow.

Files touched are listed in the defect register. No routes, identifiers,
destinations, API contracts or entitlements changed.

## 3. Scanned pages

`/`, `/login`, `/contacts`, `/p35/premium`, `/review/p35-grc`,
`/dashboard`, `/dashboard/products`, `/dashboard/review-management`,
`/dashboard/standees`, `/admin/review-library`,
`/admin/users/[id]`.

## 4. Keyboard and dialogs

- Tab reaches the login email/password controls in order; focus is visibly
  outlined.
- Admin credentials dialog receives initial focus, Tab stays inside, Escape
  closes it, and focus returns to the trigger.
- Escape closes the inline rename editor.
- Button/Space/Enter activation is native; no keyboard trap observed.

## 5. Responsive / text resize

- 5 representative routes × 320/375/390/430/768/1024/1440 = **35 checks**,
  **0 horizontal overflow**.
- 200% root text resize on My Products: **0 overflow** after repair.

## 6. Limitations

- VoiceOver/TalkBack and other physical screen-reader testing were **NOT
  VERIFIED**.
- Automated axe checks do not prove full WCAG 2.2 AA compliance.
- Colour contrast was validated by axe for rendered states, not every theme/
  template combination.

**P3.6 QUALITY AUDIT COMPLETE — VERIFIED RISKS REMAIN**

