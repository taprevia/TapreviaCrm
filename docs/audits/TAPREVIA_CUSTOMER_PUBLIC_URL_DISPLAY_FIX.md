# Taprevia — Customer Public URL Display Fix

**Date:** 2026-11-03  
**Branch:** `Devlopment`  
**HEAD:** `0191bc1889c95e5716afa2f8f67a991ac131c101`  
**Mode:** Audit → minimal implementation → regression test → report  
**Database inspected:** `mongodb://localhost:27017/nfc-crm` (local only)  
**Production / Preview:** not accessed

---

## 1. Customer-facing URL locations audited

| # | Surface | File | Previous behavior | Result |
|---|---|---|---|---|
| 1 | vCards card link | `src/app/(dashboard)/dashboard/vcards/page-client.tsx:57–72, 320–339` | Preview href (`/review/alias`, `/{publicSlug}`, or external social) | Public URL |
| 2 | vCards QR modal text | same `:437–443` | `/r/{routeSlug}` only | Public URL + labelled QR/NFC link |
| 3 | vCards Preview button | same `:363–372` | Preview href | Unchanged (Preview ≠ Public URL) |
| 4 | My Products list — Public URL + Copy | `src/app/(dashboard)/dashboard/products/page.tsx:305–320, 454–484` | Preview href; social external; `window.location.origin` | Public URL; trusted base |
| 5 | Product detail — Public URL + Copy | `src/app/(dashboard)/dashboard/products/[id]/page.tsx:304–320, 478–517` | Preview/`publicUrl`; `window.location.origin` | Public URL; trusted base |
| 6 | Standee manager — panel URL + Copy | `src/components/dashboard/standee-manager.tsx:292–301, 395–414` | Preview href (`/standee-review/...` when gate ON) | `/{publicSlug}` |
| 7 | Public share sheet / Copy link | `src/components/public/sticky-dock.tsx:95–105, 144–191` | `/profile/{alias}` + window origin | Public URL + trusted base |
| 8 | Professional Profile copy link | `src/components/public/templates/professional-profile.tsx:167, 453–474` | `/profile/{alias}` + window origin | Public URL + trusted base |
| 9 | Panthi Event copy link | `src/components/public/templates/panthi-event.tsx:618, 658, 840–860` | `/profile/{alias}` + window origin | Public URL + trusted base |
| 10 | Builder Project URL | `src/components/builder/tabs/basic-tab.tsx:52–66, 174–214` | Always `/profile/{alias}` | Product-specific Public URL |
| 11 | Builder header URL | `src/components/builder/builder-shell.tsx:178–192` | Social → external; review/profile logic split | Public URL resolver |
| 12 | Overview vCard tile | `src/components/dashboard/overview/vcard-strip.tsx:54` | `/{urlAlias}` | Public URL |
| 13 | Subscribers table card link | `src/app/(dashboard)/dashboard/subscribers/page-client.tsx:262–281` | `/profile/{urlAlias}` | Public URL |
| 14 | vCard download URL | `src/lib/vcf.ts:11–35, 159–165` | `/profile/{alias}` | Public URL |
| 15 | vCard endpoint base | `src/app/api/public/cards/[alias]/vcf/route.ts:104` | Request origin | Trusted configured base first |
| 16 | Account Settings “Public Profile” | `src/app/(dashboard)/dashboard/account/account-details.tsx:69–82` | `/profile/{bizSlug}` | **Unchanged legacy company profile** (see §8) |
| 17 | Admin User Details Public/Permanent | `src/app/(admin)/admin/users/[id]/page.tsx` | Both shown for diagnostics | **Unchanged** (admin-only, intentionally permanent) |
| 18 | QR image / PDF / NFC payload | `vcards` + `src/lib/admin-card-view.ts` | `/r/{routeSlug}` | **Unchanged** (PPL-01) |

No customer-facing emails/messages contained card URLs. Review Management/standee review pages do not render the public share dock.

---

## 2. Files changed

| File | Purpose |
|---|---|
| `src/lib/services/customer-public-url.ts` | New shared Public URL resolver (cards + standees) |
| `src/app/(dashboard)/dashboard/vcards/page-client.tsx` | Display Public URL; QR modal shows Public URL + labelled QR/NFC link; QR payload unchanged |
| `src/app/(dashboard)/dashboard/products/page.tsx` | Public URL display/copy from publicSlug/review route; trusted base |
| `src/app/(dashboard)/dashboard/products/[id]/page.tsx` | Same for product detail |
| `src/components/dashboard/standee-manager.tsx` | Display/copy `/{publicSlug}`; unavailable state; trusted base |
| `src/components/dashboard/overview/vcard-strip.tsx` + `types.ts` | Tile shows Public URL |
| `src/app/(dashboard)/dashboard/subscribers/page-client.tsx` + `types.ts` | Subscriber card link shows Public URL |
| `src/app/api/newsletter-subscribers/route.ts` | Adds `kind`/`publicSlug` to populated card ref |
| `src/components/public/sticky-dock.tsx` | Share/Copy uses Public URL; no window origin |
| `src/components/public/templates/professional-profile.tsx` | Copy link uses Public URL; trusted base |
| `src/components/public/templates/panthi-event.tsx` | Copy link uses Public URL; trusted base |
| `src/components/builder/tabs/basic-tab.tsx` | Product-specific Public URL (read-only, copy) |
| `src/components/builder/builder-shell.tsx` | Header uses Public URL resolver |
| `src/lib/vcf.ts` | vCard profile URL uses publicSlug when allocated |
| `src/app/api/public/cards/[alias]/vcf/route.ts` | Trusted base first |
| `scripts/test-customer-public-url-display.ts` | New 28-check regression test |

No changes to `/r`, `/qr`, standee routing, PPL-02 identifier fields, entitlements, or database schemas.

---

## 3. Before / After examples

| Product | Before (customer display) | After (customer display) | QR/NFC payload |
|---|---|---|---|
| Premium NFC Card | `…/{publicSlug}` on products; `/profile/{alias}` on public share | `…/{publicSlug}` | `…/r/{routeSlug}` |
| Google Review Card | `/review/{alias}` on products; `/profile/{alias}` in builder | `/review/{alias}` | `…/r/{routeSlug}` |
| Google Review Plate | Same as review card | `/review/{alias}` | `…/r/{routeSlug}` |
| Social Card | Raw external destination shown as “Public URL” | `…/{publicSlug}` (Taprevia route → external) | `…/r/{routeSlug}` |
| Standee | Preview could be `/standee-review/{route}` | `…/{publicSlug}` | `…/r/{routeSlug}` / slot routes unchanged |
| Legacy profile (alias only) | `/profile/{alias}` | `/profile/{alias}` (supported legacy) | unchanged |
| Legacy missing publicSlug | Could show preview/external | “Public URL unavailable” | `/r` unchanged if route exists |

Example:

```
Public URL:      https://www.taprevia.com/kaka-pvc/google-review
QR/NFC payload:  https://www.taprevia.com/r/mvz27ltnip
```

---

## 4. Display / Copy / Share consistency

| Action | Source | Result |
|---|---|---|
| My Products display + Copy | `publicUrlFull` | Same value |
| Product detail display + Copy | `publicUrlFull` | Same value |
| Standee display + Copy | `publicPanelUrl` | Same value |
| Builder display + Copy | `publicUrl` | Same value |
| Public Share sheet WhatsApp/SMS/Email/Copy | `shareUrl` | Same value |
| Profile template Copy | `data.cardUrl` + trusted base | Same value |
| vCards link display / QR modal | `resolveCardDisplayUrl` | Same value |
| QR image / PDF | `resolveCardQrUrl` | Permanent `/r` — intentionally different |
| Public Preview button | `preview.href` | Canonical preview — intentionally separate |

`window.location.origin` was removed from all audited customer dashboard/share surfaces; `canonicalPublicBase()` is used instead.

---

## 5. Product-by-product compatibility

| Product | Result | Notes |
|---|---|---|
| Premium NFC Business Card | PASS | Displays `/{publicSlug}` |
| Standard NFC Business Card | PASS | Displays `/{publicSlug}` |
| Google Review NFC Card | PASS | Displays `/review/{alias}` |
| Google Review NFC Plate | PASS | Displays `/review/{alias}` |
| Social NFC Card | PASS | Displays `/{publicSlug}`; tap destination stays external |
| Legacy NFC Cards | PASS | `/profile/{alias}` or `/c/{slug}`; never `/r` |
| Google Review Standee | PASS | Displays `/{publicSlug}` |
| All-in-One 3 Standee | PASS | Displays `/{publicSlug}` |
| All-in-One 4 Standee | PASS | Displays `/{publicSlug}` |

Existing public URLs, permanent URLs, printed QR codes, NFC routes, product assignments, Review Management, standee routing, analytics, and entitlements are unchanged.

---

## 6. PPL-01 regression

```
scripts/test-ppl01-customer-qr.ts → 18 passed, 0 failed
```

- Customer QR still encodes `{base}/r/{routeSlug}`.
- QR image, PDF, and download share the same permanent payload.
- Public Preview remains separate.
- No mutable alias or external social URL is encoded.
- No identifiers regenerated.

The vCards QR modal now shows the Public URL as the primary value and a clearly labelled “QR/NFC link” line for the permanent payload; the QR itself remains `/r/{routeSlug}`.

---

## 7. PPL-02 regression

```
scripts/test-ppl02-immutable-urls.ts → 23 passed, 0 failed
```

- `routeSlug`, `uid`, `publicSlug`, `urlAlias`, `slug` remain immutable.
- Builder field remains read-only.
- Public URL resolver never emits `/r/{routeSlug}`.
- No database writes or identifier changes.

---

## 8. Remaining legacy URL limitations

1. **Two active assigned legacy cards lack `publicSlug`** (one lacks both `routeSlug` and `publicSlug`). They display “Public URL unavailable” in surfaces that require a Public URL. NFC/QR routes are unchanged; no backfill performed.
2. **Two legacy/QA standees lack `publicSlug`**; standee manager shows “Public URL unavailable”. No `/r` substitution.
3. **Account Settings “Public Profile”** continues to use `/profile/{bizSlug}` — an established legacy company-profile route that resolves the account’s canonical card. It is not a card-level `/{publicSlug}` and has no product context on that page; left unchanged rather than inventing a URL.
4. **Historical aliases** cannot be reconstructed (no alias-history table).
5. **PPL-03–PPL-08** remain unresolved and were not touched.
6. Admin User Details intentionally continues to show Permanent and Public identifiers for diagnostics.

---

## 9. Test results

### Passed

| Suite | Result |
|---|---|
| `test-customer-public-url-display.ts` | **28/28** |
| `test-ppl01-customer-qr.ts` | **18/18** |
| `test-ppl02-immutable-urls.ts` | **23/23** |
| `test-vcf.ts` | **69/69** |
| `test-security-boundaries.ts` | PASS |
| `test-dashboard-entitlement.ts` | **130/130** |
| `test-phase4d10p2-builder-tabs.ts` | **9/9** |
| `test-phase4d10p2-backward-compat.ts` | **11/11** OFF, **11/11** ON |
| `test-dynamic-routing.ts` | **29/29** |
| `test-card-binding.ts` | **49/49** |
| `test-standee-review.ts` | **20/20** |
| `test-review-management.ts` | **58/58** (gate OFF) |
| `tsc --noEmit` | PASS |
| `next lint` | PASS |
| `npm run build` | PASS |

### Not tested

- Live customer `/r`/`/qr` HTTP taps (avoided analytics writes).
- Physical NFC/printed QR scanning.
- Browser desktop/mobile visual matrix.
- Full write-API matrix was not rerun for this display-only change; prior PPL-02 run covered its URL-relevant cases.
- Production/Preview behavior.

---

## 10. No database / customer-data changes

- No customer records created, updated, or deleted.
- No identifiers regenerated or rewritten.
- No migrations, index changes, or backfills.
- No environment changes; `.env.local`, `.env.preview`, `.env.example` hashes unchanged.
- No production/preview changes.
- No commits, pushes, or deployments.
- Live `nfc-crm` counts unchanged: 15 users, 15 cards, 7 standees, 20 assignments, 17 catalog products, 1 review category, 110 templates, 1 review settings, 16 analytics logs.
- All isolated databases and temporary servers were dropped/stopped.

**Customer-facing screens now display/copy/share the immutable Public URL; NFC/QR continues to encode the permanent `/r/{routeSlug}` route. Awaiting approval before any further changes.**
