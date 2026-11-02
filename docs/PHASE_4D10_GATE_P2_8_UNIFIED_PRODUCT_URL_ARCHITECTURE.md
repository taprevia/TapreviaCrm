# TAPREVIA — PHASE 4D.10 GATE P2.8
# UNIFIED PRODUCT URL ARCHITECTURE & PERMANENT-LINK VISIBILITY

**Branch:** `Devlopment`
**HEAD:** `db08e7a80c7c0b2972ebdef4841214478acfd7ae`
**Production:** untouched
**Remote databases / Vercel:** not accessed or modified
**Status:** **LOCAL URL UNIFICATION COMPLETE — PREVIEW VERIFICATION REQUIRED**

---

## 1. Current repository status

- Branch `Devlopment`; HEAD `db08e7a`.
- Working tree: 50 entries (P2.3–P2.8 work, uncommitted).
- No schema/model/migration change in P2.8.
- Flags OFF; `.env.local`/`.env.preview` unchanged.
- No commit/push/deploy/remote DB access.

---

## 2. Complete product inventory

Verified from `src/config/products.ts` and catalog kinds:

| Product | Type | Public experience |
|---|---|---|
| Google Review Card | card / review | `/review/{alias}` |
| Google Review NFC Plate | card / review | `/review/{alias}` |
| Premium NFC Card | card / profile | human profile URL / `/profile/{alias}` |
| Business NFC Card | card / profile | human profile URL / `/profile/{alias}` |
| Google Review Standee | standee | `/standee-review/{route}` when gate ON, else public Standee panel |
| Social/redirect Cards | card / social | configured safe external destination |
| Legacy/other catalog products | card/standee | existing public behavior, no invented URL |

---

## 3. Existing URL route inventory (preserved)

| Route | Role |
|---|---|
| `/review/{alias}` | Canonical public review experience |
| `/{business}/{product}` (publicSlug) | Human business/product URL; dispatches by Card kind |
| `/profile/{alias}` | Legacy profile public page |
| `/c/{slug}` | Legacy printed card shim → profile |
| `/r/{routeSlug}` / `/r/{routeSlug}/{slot}` | Permanent NFC/QR entry route |
| `/qr/{qrId}` | Legacy QR entry route |
| `/standee-review/{routeSlug}` | Gated Standee review host |
| `/panel/{routeSlug}` | Standee panel picker |
| `/admin/users/{id}` | Authorized permanent-link management |

No route handler was removed.

---

## 4. Google Review NFC Plate URL comparison

Reported:
- URL A: `http://localhost:3000/review/digital-mvv8fuge7n`
- URL B: `http://localhost:3000/test-url/google-review-2`

Local route analysis:

- **URL A** is the canonical `/review/{alias}` host. It uses the Card's
  `urlAlias` and effective Review Management settings.
- **URL B** matches the stored `publicSlug` pattern (`{business}/{product}`),
  served by the existing public business/product route. It is **not** the
  permanent `/r/{routeSlug}` route. If it belongs to the same review Card and
  reviews are effectively enabled, it dispatches to the canonical review
  experience; if it belongs to a different Card, ownership is not merged.
- The **permanent entry URL** is the `/r/{routeSlug}` route (or legacy `/c`/
  `/qr` fallback), managed only in Admin → User Details.

Remote ownership of the two reported URLs cannot be verified without approved
Preview data access. The resolver never infers or merges ownership: it accepts
the exact server-resolved instance. Both existing URLs remain functional.

---

## 5. Canonical URL selection rules

One resolver (`src/lib/services/product-preview.ts`) now provides:

- `canonicalPublicUrl` — the single customer-facing URL.
- `permanentEntryUrl` — admin-only physical route metadata.
- `previewUrl` — same canonical experience.
- `productType`, `routeSource`, `configurationStatus`.

Selection:

1. Review Card/Plate: `/review/{urlAlias}` only when entitlement + effective
   settings are enabled; otherwise a setup/disabled result.
2. Profile Card: `/{publicSlug}` → `/profile/{urlAlias}`.
3. Social Card: safe configured external destination.
4. Standee: review host when enabled/eligible; otherwise publicStandee panel /
   existing permanent route fallback for preview.
5. Missing/disabled/unentitled: no fabricated canonical URL; explicit status.

Catalog IDs are never treated as Card IDs; another same-type Card is never
selected.

---

## 6. Permanent URL preservation rules

- Permanent paths are derived read-only from existing fields:
  Card `/r/{routeSlug|uid}` → `/c/{slug}`; Standee `/r/{routeSlug|uid}` →
  `/qr/{panelQr.qrId}`.
- No UID, alias, slug, route slug or QR ID is regenerated or rewritten.
- Public permanent routes remain accessible to anyone scanning the physical
  product. "Admin-only" restricts management UI, not public scan access.
- Permanent metadata is not included in customer-facing API responses.

---

## 7. Admin-only visibility implementation

- Admin User Details API now adds `canonicalPublicUrl`, `permanentEntryUrl`,
  `configurationStatus`, `routeSource` to that user's cards/standees
  (admin-authorized only).
- Admin User Details displays **Public** (canonical) and **Permanent** links,
  copy controls, QR generation/downloads, assignment status and QR IDs.
- Admin users list no longer links `/c/{slug}`; it directs admins into the
  customer record.
- `/admin/standee-qr` now redirects to `/admin/users`; the duplicate permanent
  QR management page is gone. Permanent QR remains available in User Details.
- Admin navigation item for the removed page was deleted.
- `View Public Profile` in User Details uses the canonical URL, not `/r`.

---

## 8. UI locations cleaned

| Screen | Before | After |
|---|---|---|
| My Products | `publicUrl` (publicSlug) | canonical resolver URL |
| vCards | publicSlug/profile link, no preview | canonical URL + Preview; QR uses canonical |
| Product Setup | publicUrl | `canonicalPublicUrl` |
| Standee main/Manage | publicSlug panel URL | canonical preview/public URL |
| Review Management | `/review/alias` | canonical review URL (already) |
| Builder header | publicSlug before review alias | review alias first; no `/c` fallback |
| Social builder tab | permanent `/c` URL + printed QR | destination only; note permanent is admin-managed |
| Admin users list | `/c/{slug}` links | no permanent link |
| Admin Standee QRs | `/r`/`/qr` payloads | redirects to User Details |
| Admin User Details | `/c` slug + `/r` route | Public canonical + Permanent route + copy/QR |

No customer screen renders `/r`, `/qr`, or `/c` after these changes.

---

## 9. Browser navigation behavior

- Public navigation opens the canonical URL directly (review/profile/Standee).
- Legacy `/{business}/{product}`, `/profile`, `/c`, `/r`, `/qr` remain
  functional; review-kind public aliases dispatch through effective settings.
- No redirect loops introduced; query parameters remain on legacy redirects.
- Authenticated management routes are never redirected into public pages.
- A scanned permanent route may still appear briefly in the address bar; its
  destination remains correct. It was not rewritten.

---

## 10. Legacy compatibility mapping

| Legacy input | Behaviour |
|---|---|
| `/review/{alias}` | Canonical review page |
| `/{business}/{product}` | Saved public experience; review dispatches canonical |
| `/profile/{alias}` | Profile page |
| `/c/{slug}` | Legacy shim → profile |
| `/r/{routeSlug}` | Permanent NFC/QR entry route |
| `/r/{routeSlug}/{slot}` | Standee slot route |
| `/qr/{qrId}` | Legacy QR entry |
| `/standee-review/{route}` | Gated Standee host |
| `/admin/standee-qr` | 307 → `/admin/users` |

No displayed or printed identifier changed.

---

## 11. Files modified (P2.8)

- `src/lib/services/product-preview.ts` — URL classes/resolver extensions.
- `src/app/api/admin/users/[id]/route.ts` — admin canonical/permanent fields.
- `src/app/(admin)/admin/users/[id]/page.tsx` — public/permanent display,
  canonical View Public, copy controls.
- `src/app/(admin)/admin/users/page.tsx` — removed `/c` permanent links.
- `src/app/(admin)/admin/standee-qr/page.tsx` — redirect to User Details.
- `src/config/dashboard-navigation.ts` — removed duplicate admin entry.
- `src/app/(dashboard)/dashboard/products/page.tsx` — canonical URL.
- `src/app/(dashboard)/dashboard/vcards/page-client.tsx` — canonical URL/QR.
- `src/app/(dashboard)/dashboard/products/[id]/page.tsx` — canonical URL.
- `src/app/api/my/products/[id]/route.ts` — additive canonical URL metadata.
- `src/components/dashboard/standee-manager.tsx` — canonical public URL.
- `src/components/builder/builder-shell.tsx` — canonical header path.
- `src/components/builder/tabs/social-tab.tsx` — removed permanent URL/QR.
- `scripts/test-phase4d10p2-preview-routing.ts` — permanent/canonical tests.

No schema/data changes.

---

## 12. API compatibility

- Customer APIs add `canonicalPublicUrl`/`previewUrl` (additive); they do not
  expose `permanentEntryUrl`.
- Admin User Details API adds admin-only URL metadata.
- Existing `publicUrl` fields remain for compatibility but UI prefers the
  canonical resolver.
- No endpoint removed or response field renamed.
- Admin `/api/admin/standee-qr` remains available for authorized admin use; its
  UI route redirects.

---

## 13. Database compatibility

No collection, field, index, migration or record change. Stored UIDs, aliases,
slugs, route slugs, publicSlugs, QR IDs and Google URLs are untouched. The BC
harness (P2.7) still proves zero mutations across resolution.

---

## 14. Security verification

- Permanent metadata only in the admin-authorized User Details API/UI.
- Customer APIs do not return permanent routes.
- Admin endpoint remains behind `requireAdminStrict`; hidden UI is not the
  control.
- Public routes remain public by design; no URL is treated as a secret.
- Ownership/tenant checks unchanged; no cross-customer resolution.
- No open redirects added; only existing safe destination logic.

---

## 15. Test results

| Suite | Result |
|---|---|
| Typecheck / ESLint | PASS |
| Build OFF / ON | PASS |
| URL resolver (canonical/permanent) | 15/15 |
| P2.7 BC harness central OFF/ON | 11/11 · 11/11 |
| 4D.5 Review Management | 57/57 OFF · 57/57 ON |
| 4D.6 Standee | 20/20 × 4 = 80/80 |
| Unified / historical analytics | 9/9 · 9/9 |
| 16-combination matrix | 192/192 |
| 4D.8/4D.9 fixes | 0 failures; 14/14 rows |
| Builder / preview config | 9/9 · 41/41 |
| Security / entitlement | PASS · 130/130 |
| Review Library / import | 48/48 · 13/13 |
| Card / dynamic / Standee lifecycle | 49/49 · 29/29 · 24/24 |
| VCF / QR PDF | 69/69 · PASS |
| `git diff --check` | clean |

Browser evidence (synthetic owner/admin):
- My Products/vCards/Standee show canonical `/review/...` or `/p27/standee`;
  no `/r`, `/qr`, or `/c` in customer text.
- Admin User Details shows both Public canonical and Permanent `/r` links.
- `/admin/standee-qr` returns 307 → `/admin/users`.
- No overflow at the tested mobile/desktop widths.

---

## 16. Unverified external behavior

- Actual remote ownership of the reported `test-url/google-review-2` URL.
- Vercel Preview/Production base URLs and QR rendering.
- Real printed NFC/QR scans and physical devices.
- External Google navigation and live AI provider.
- Real customer records (synthetic fixtures only).

---

## 17. Preview verification checklist

- [ ] Deploy/refresh the approved Preview build.
- [ ] My Products: review Card shows one `/review/{alias}` URL; Preview opens it.
- [ ] vCards: canonical URL and Preview; QR encodes canonical URL.
- [ ] Product setup: canonical public URL only.
- [ ] Standee main/Manage: canonical public URL only; slots remain in Manage.
- [ ] Review Management: Preview opens canonical review page; Google destination unchanged.
- [ ] Admin User Details: Public + Permanent links, copy and QR work.
- [ ] Customer pages contain no `/r`, `/qr`, or `/c` links.
- [ ] `/admin/standee-qr` redirects to Users.
- [ ] `/r/...`, `/qr/...`, `/c/...`, `/review/...` legacy scans still work.
- [ ] Multiple same-type products resolve distinctly.
- [ ] Lower-tier/cross-tenant access denied.

---

## 18. Rollback

Revert the P2.8 file set (resolver extension, admin/customer UI canonical
changes, admin standee-QR redirect/nav removal, social-tab cleanup, tests/docs)
to restore the previous UI. No database, URL, alias, UID or destination rollback
is required. Legacy public routes remain available in either direction. Flags
stay OFF.

**LOCAL URL UNIFICATION COMPLETE — PREVIEW VERIFICATION REQUIRED**

Stopped. No commit, push, deployment, remote database access or feature
activation occurred.
