# TAPREVIA — PHASE 4D.10 GATE P3.7
# FONT SELF-HOSTING

**Result:** external font dependency **NOT REMOVED** — blocked on an approved
locally licensed Inter asset. No typography was silently replaced.

## 1. Inventory

| Usage | Current source | Weights |
|---|---|---|
| App shell | `next/font/local` — `GeistVF.woff`, `GeistMonoVF.woff` | variable |
| Contact-card template (`/contacts`) | `@import` Google Fonts **Inter** | 400/500/600/700 |
| Event-card template (`panthi-event`) | `@import` Google Fonts **Inter** | 400/500/600/700 |

External requests observed: **2** per landing page load
(`fonts.googleapis.com/css2?family=Inter...`). Both were blocked during the
audit; fallback system fonts rendered without functional failure.

## 2. Why it was not removed

- No licensed Inter `.woff2` assets exist in the repository, `public/`, the
  npm cache, `@fontsource`, or system font directories.
- Inter assets found in browser-extension caches were **not used**: provenance
  and license files could not be established, and copying them would violate
  the “legally obtained/verified licensing” rule.
- Downloading from Google Fonts was not authorized.
- Replacing Inter with Geist/system fonts would change the brand appearance of
  the public card templates, which the gate forbids without approval.

## 3. Exact approved remediation (needs owner approval)

1. Obtain Inter 400/500/600/700 WOFF2 under SIL OFL 1.1 with its `OFL.txt`.
2. Place under `public/fonts/inter/` (or install a licensed `@fontsource/inter`
   package at a pinned version).
3. Replace both `@import` lines with local `@font-face` declarations using
   `font-display: swap` and `unicode-range`.
4. Remove `https://fonts.googleapis.com` from CSP `style-src` and
   `https://fonts.gstatic.com` from `font-src` if no longer needed.
5. Re-run: no external font requests, visual comparison of `/contacts`,
   `/preview/panthi-event`, 200% resize, axe, 35 responsive checks, build.

## 4. Verification performed without remediation

- External requests: 2 before, **2 after** (unchanged).
- Layout/typography: no change applied, so no visual regression introduced.
- Accessibility/responsive: P3.6 repairs retained; axe 0, 35/35 responsive.
- No font files added or distributed.

**P3.7 INCOMPLETE — REQUIRED VERIFICATION GAPS REMAIN**

