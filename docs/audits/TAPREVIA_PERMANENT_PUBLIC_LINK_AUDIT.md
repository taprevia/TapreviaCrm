# Taprevia NFC-CRM — Permanent & Public Link Logic Audit

**Date:** 2026-11-03  
**Mode:** Read-only audit — no fixes, no data changes  
**Project:** `/Users/prince/Documents/CRM`  
**Branch:** `Devlopment`  
**HEAD:** `0191bc1889c95e5716afa2f8f67a991ac131c101` — “update review system”  
**Parent:** `db08e7a80c7c0b2972ebdef4841214478acfd7ae`  
**Database inspected:** `mongodb://localhost:27017/nfc-crm` (local only)  
**Production / Preview / Atlas:** not accessed, not verified

---

## 1. Executive summary

The permanent physical identity fields — `routeSlug`, `uid`, and `publicSlug` — are **not editable** anywhere in the customer or admin UI or API. No recent change introduced a write path that overwrites an existing permanent identifier. All existing `/r/{routeSlug}`, `/r/{routeSlug}/{slot}`, and `/qr/{qrId}` routes still resolve, and existing printed NFC/QR destinations are unchanged.

The reported impression that “Permanent Links and Public Links are now editable” is real in two narrower senses:

1. **The editable field is `urlAlias`** (“Profile URL” in the card builder). It has been editable since the initial commit, not introduced recently.
2. **Recent changes now surface alias-derived URLs as the customer-facing “Public URL” and, in vCards, as the customer QR payload.** For review and social cards this replaces the stable `publicSlug` path with either `/review/{urlAlias}` or a raw external destination. That makes a displayed/encoded public link change when the alias changes.

Confirmed highest-impact issues:

| ID | Severity | Finding |
|---|---|---|
| PPL-01 | **HIGH** | Customer vCards QR now encodes the canonical preview URL, not the stable public/permanent URL. Social cards encode the raw external destination; review cards encode the editable `/review/{alias}`. |
| PPL-02 | **HIGH** | `urlAlias` edits have no history/redirect; old `/profile/{alias}` and `/review/{alias}` links break, and a freed alias can be claimed by another account (confirmed takeover). |
| PPL-03 | **MEDIUM** | Alias uniqueness only checks `urlAlias`, not `slug`; alias = another card’s immutable slug is accepted, creating ambiguous `/profile/{key}` and `/c/{key}` resolution. Index is non-unique and check-then-write is race-prone. |
| PPL-04 | **MEDIUM** | Admin “Permanent” QR generation can now encode `/{publicSlug}`, `/profile/{alias}`, or `/c/{slug}` when `routeSlug` is missing; previously it returned “Permanent QR unavailable”. |
| PPL-05 | **MEDIUM** | Admin “Permanent” label can refer to legacy `/c/{slug}` or `/qr/{panelQr}` fallbacks, not `/r/{routeSlug}`. |

No CRITICAL finding: no existing `routeSlug`, `uid`, `publicSlug`, `slug`, or QR ID can be overwritten through a normal request. The database scan found no active customer record lacking its permanent identity.

---

## 2. Intended Permanent Link architecture

**Contract (from code, docs, and tests):**

```
https://www.taprevia.com/r/{routeSlug}
https://www.taprevia.com/r/{routeSlug}/{slot}   (multi-profile standee)
```

- The permanent route is the stable identifier for physical NFC cards and printed QR codes.
- `routeSlug` is allocated once at card/standee provisioning, then never regenerated.
- `uid` mirrors `routeSlug` for new records; legacy records may have only `routeSlug`.
- `publicSlug` (`{business-slug}/{product-slug}[-N]`) is a human-readable public path, allocated once and never regenerated.
- `urlAlias` is a legacy/public profile handle. It is editable and is **not** the permanent NFC route.
- `/r` resolves the current destination from the database, so a destination/configuration change never requires reprinting.
- Permanent link management is admin-only. Customer screens must not expose `/r`, `/qr`, or `/c` (documented in `docs/PHASE_4D10_GATE_P2_8_UNIFIED_PRODUCT_URL_ARCHITECTURE.md`).

**Evidence:**

- `docs/PHASE_4D10_GATE_P2_8_UNIFIED_PRODUCT_URL_ARCHITECTURE.md:43–50, 85–110` — route inventory and permanent preservation rules.
- `docs/DEPLOYMENT.md:103–104` — printed payloads are `/r/{routeSlug}` and `/r/{routeSlug}/{slot}`.
- `scripts/test-card-binding.ts:205–221, 348–359` — routeSlug/publicSlug preserved across hardware bind and replacement.
- `scripts/verify-human-readable-urls.ts:221–257` — `/r` route, idempotent public slug, replacement permanence.

**Immutability implementation:**

- `routeSlug` is written only at creation or when missing:
  - `src/lib/services/card-identity.ts:158–167` — new card creation.
  - `src/lib/services/card-identity.ts:178–184` — backfill only if missing.
  - `src/lib/services/user-product-assignment.ts:183–188` — backfill only if missing.
  - `src/lib/services/user-product-assignment.ts:286–297` — new standee creation.
- `publicSlug` allocator is guarded by `{ publicSlug: { $in: ['', null] } }`:
  - `src/lib/services/human-url.ts:172–224` (cards).
  - `src/lib/services/human-url.ts:238–287` (standees).
- `slug` is created once from the UID: `src/lib/services/card-identity.ts:59–70`.
- Card replacement preserves `routeSlug`, `slug`, `publicSlug`, and `urlAlias`: `src/lib/services/card-replacement.ts`.
- No request schema accepts `routeSlug`, `uid`, or `publicSlug`:
  - `src/lib/validation/card.ts:153–159` (`createCardSchema`)
  - `src/lib/validation/card.ts:166–...` (`updateCardSchema`)
  - `src/lib/validation/product-config.ts:101–...` (`updateProductConfigSchema`)
  - `src/app/api/admin/users/[id]/products/[userProductId]/card/route.ts:15–17` (`replaceCardSchema` only accepts `cardUid`)

---

## 3. Intended Public Link architecture

Public destinations differ by product type. The documented canonical mapping is:

| Product/route | Canonical public destination |
|---|---|
| Review card / Google Review Plate | `/review/{urlAlias}` |
| Profile card | `/{publicSlug}` → `/profile/{urlAlias}` |
| Social card | configured external destination |
| Card legacy shim | `/c/{slug}` |
| Standee | `/{publicSlug}` panel, `/panel/{slug}`, or `/r/{routeSlug}` |
| Permanent physical entry | `/r/{routeSlug}` (admin-only display) |

**Evidence:** `docs/PHASE_4D10_GATE_P2_8_UNIFIED_PRODUCT_URL_ARCHITECTURE.md:85–96, 136–143`; `src/lib/services/product-preview.ts:68–140`; `src/lib/services/redirect-target.ts:32–59`.

**Important distinction:**

- `publicSlug` is immutable.
- `urlAlias` is editable.
- Review and social canonical URLs use `urlAlias` / external destination, so those canonical links are **not** permanent identities even though they are presented as the product’s public URL.

---

## 4. Current behavior vs previous behavior

### 4.1 Permanent identity (PASS)

| Field | Previous behavior | Current behavior | Status |
|---|---|---|---|
| `routeSlug` | Immutable after allocation | Immutable after allocation; backfill only when missing | **PASS** |
| `uid` | Mirrors `routeSlug` on new records | Same | **PASS** |
| `publicSlug` | Allocated once, never regenerated | Same; `$in:['',null]` guard | **PASS** |
| `slug` | Created from UID, never edited | Same | **PASS** |
| `cardUid` | Replaced only via audited replacement flow | Same; `previousCardUids` audit retained | **PASS** |
| Standee `panelQr` / `socialQrs[].qrId` | Stable | Stable | **PASS** |

### 4.2 Public handle (`urlAlias`) — editable since initial commit

- UI: `src/components/builder/tabs/basic-tab.tsx:227–248` — “Profile URL” input, editable.
- State/save: `src/lib/hooks/use-card-draft.ts:40, 56–60, 453–457` — saved via `PATCH /api/cards/{id}`.
- Backend: `src/app/api/cards/[id]/route.ts:198–203` — accepts `urlAlias`, checks `Card.findOne({ urlAlias })`, then assigns.
- Creation: `src/app/api/cards/route.ts:104–119` — accepts `urlAlias`, checks only `urlAlias`, then uses the alias as `slug` too.
- Validation: `src/lib/validation/common.ts:10–33` — 3–40 lowercase alnum/hyphen, reserved list.

**Git evidence:** `src/components/builder/tabs/basic-tab.tsx` has only one commit (`c999d5e inital commit`); `git show db08e7a:...basic-tab.tsx` already contains the same editable field. The alias PATCH logic also exists at `db08e7a` (`git log -S "data.urlAlias && data.urlAlias !== card.urlAlias"` → `c999d5e`).

**Conclusion:** alias editability was **not introduced by `0191bc1`**. It is a pre-existing contract.

### 4.3 What `0191bc1` actually changed

| File | Change | Effect |
|---|---|---|
| `src/lib/admin-card-view.ts:37–61` | `permanentCardUrl()` changed from `/r/{routeSlug}` only (empty otherwise) to fallback order `/r` → `/{publicSlug}` → `/profile/{urlAlias}` → `/c/{slug}` | Admin QR/PDF can now be generated from non-permanent paths |
| `src/lib/services/product-preview.ts` (new) | Authoritative canonical/permanent resolver | Introduces `canonicalPublicUrl`, `permanentEntryUrl`, `previewUrl` |
| `src/lib/services/redirect-target.ts:42–51` | Review/profile destinations fall back to `slug` | Compatibility improvement |
| `src/app/(dashboard)/dashboard/vcards/page-client.tsx:54–58, 109–117, 129–132` | QR/public URL now use `preview.href` instead of `publicSlug` | **QR target change for review/social cards** |
| `src/components/builder/builder-shell.tsx:178–197` | Review URL now prefers alias over `publicSlug`; social shows destination | Displays editable alias as “Public URL” |
| `src/app/api/admin/users/[id]/route.ts:44–60` | Spreads `resolveProductUrls()` into cards/standees | Admin sees canonical + permanent |
| `src/app/(admin)/admin/users/[id]/page.tsx:890–918` | Shows “Public” and “Permanent” labels | Labels alias-derived canonical as “Public” |
| `src/lib/services/human-url.ts:29–36, 180` | Adds reserved public segments; publicSlug allocation now requires an active assignment | Hardening; immutability unchanged |
| `src/lib/services/product-preview.ts:159–176` | `permanentEntryPath()` falls back to `/c/{slug}` or `/qr/{panelQr}` | “Permanent” can label a legacy shim |

No change was made to `routeSlug`, `uid`, `publicSlug`, or QR-ID generation.

---

## 5. All editable/displayed link fields

| Field | Editable? | Who | Frontend | Backend | Can it change a permanent ID? | Physical NFC/QR effect |
|---|---|---|---|---|---|---|
| `routeSlug` | **No** | — | Not exposed | Not in any request schema (unknown keys stripped) | No | No |
| `uid` | **No** | — | Not exposed | Not in any request schema | No | No |
| `publicSlug` | **No** | — | Displayed only | Not in any request schema | No | No |
| `slug` | **No** | — | Displayed only | Created at provisioning | No | No |
| `urlAlias` (“Profile URL”) | **Yes** | Customer owner, admin | `basic-tab.tsx:227–248` | `PATCH /api/cards/[id]:198–203`; `POST /api/cards:104–119` | No, but changes `/profile/{alias}` and `/review/{alias}` targets | No for `/r`; yes for QR that encoded alias/path |
| `redirectUrl` / destination | **Yes** | Customer/admin | Product config forms | `PATCH /api/my/products/[id]/config` | No | Destination changes dynamically; `/r` unaffected |
| Standee slot `destinationUrl` | **Yes** | Customer | `standee-manager.tsx` | `PATCH config` | No | Slot destination changes dynamically |
| Standee `displayName` | **Yes** | Customer | Standee manager | `PATCH config` | No | Cosmetic |
| Standee `routeSlug` | **No** | — | Not exposed | Not in schema | No | No |
| Card/Standee QR IDs | **No** | — | Displayed only | Generated once | No | No |
| `routeSlug` in admin replacement dialog | Read-only | Admin | `admin/users/[id]/page.tsx:1585–1589` | Replacement preserves it | No | No |

---

## 6. Route generation and redirect precedence

### 6.1 `/r/[slug]` (`src/app/r/[...slug]/route.ts`)

Actual precedence, confirmed from code:

1. **Card by `routeSlug` or `uid`** (`:88–102`).
2. **Card destination** via `resolveCardDestination` (`:115`), which internally uses:
   1. safe external `redirectUrl` (`redirect-target.ts:33–34`)
   2. `review` → `/review/{urlAlias || slug}` (`:42–45`)
   3. `profile` → `/{publicSlug}` → `/profile/{urlAlias}?src=qr` → `/c/{slug}` (`:46–51`)
   4. `social` → null unless `redirectUrl` is valid (`:52–56`)
3. **Loop check** only for the card branch: target origin/path must differ (`:117–124`).
4. **Standee by `routeSlug`/`uid`** (`:135–152`):
   - slot: Google review host if eligible, else slot destination, else profile alias, else 404 (`:169–231`)
   - no slot: single-purpose review host, else multi-profile `/panel/{routeKey}`, else profile alias, else sole configured slot, else 404 (`:249–319`)
5. **Legacy card fallback** by `cardUid`, `slug`, `urlAlias` (`:322–357`), then same destination resolver.
6. **404** (`:359–360`).

Status: `307` for `/r` redirects. **No explicit `Cache-Control: no-store` header** is set on any `/r` response.

### 6.2 `/qr/[id]` (`src/app/qr/[id]/route.ts`)

1. Card by `routeSlug`/`uid` → social `redirectUrl`, else `/profile/{urlAlias}` (`:59–81`).
2. Standee social QR → gated review host for Google slot, else slot destination, else profile card (`:83–132`).
3. Panel QR → single-purpose review host, else `/panel/{routeSlug}`, else profile card (`:134–189`).
4. Legacy `Profile.standeeQr` (`:191–200`).
5. 404.

Status: `302` (307 for review hosts). No explicit no-store.

### 6.3 Human URLs

- `/{business}/{product}`: `src/app/[business]/[product]/page.tsx:20–25` → `getPublicCardByPublicSlug` (`human-url.ts:306–310`), then standee panel, then 404.
- `/profile/{alias}`: `src/app/profile/[alias]/page.tsx:13–18` → `resolvePublicCardProfile`.
- `/c/{slug}`: `src/app/c/[slug]/page.tsx:51–75` → `$or [{urlAlias}, {slug}]`, then `cardUid`, then redirect to `/profile/{urlAlias || slug}`.
- `/panel/{slug}`: `src/app/panel/[slug]/page.tsx:33–59`.

### 6.4 Precedence anomalies (documented, not changed)

- Review cards redirect to `/review/{alias}` even if the review assistant is disabled; the resolver does not consult effective settings. This can produce a 404 from `/r` for a disabled review card. Pre-existing in `redirect-target.ts`; `0191bc1` only added the `slug` fallback.
- `/qr` card branch uses `302` and ignores `publicSlug`, while `/r` uses `307` and prefers `publicSlug` for profile cards.
- Loop prevention exists only in the `/r` card branch; standee and `/qr` branches have none.
- `/{publicSlug}` resolution does not apply the owner-suspension check that `/profile/{alias}` does.

---

## 7. QR / NFC compatibility

| Surface | Current payload | Stability | Status |
|---|---|---|---|
| Physical printed card QR/NFC | `/r/{routeSlug}` | Permanent; resolver unchanged | **PASS** |
| Physical standee panel QR | `/r/{routeSlug}`, `/panel/{slug}`, or `/qr/{qrId}` | Permanent; unchanged | **PASS** |
| Standee Google slot QR | `/r/{routeSlug}/{slot}` or `/qr/{socialQr.qrId}` → gated review host | Stable | **PASS** |
| `/api/my/qr` (customer product QR) | `origin/{publicSlug}` | Immutable `publicSlug` | **PASS** |
| Admin User Details permanent QR/PDF | `permanentCardUrl()` → `/r/{routeSlug}` if present | Stable for live customer cards | **PASS (with PPL-04 caveat)** |
| Customer vCards QR | `resolveCardPublicUrl()` → `preview.href` | **Changed** | **FAIL for review/social** |
| Builder header “Public URL” | review → `/review/{alias}`; social → external; profile → `/{publicSlug}` or `/profile/{alias}` | Alias-dependent for review/social | **Intentional but risky** |

### PPL-01 — Customer vCards QR now encodes the canonical preview URL (HIGH, confirmed regression)

**Files/lines:**

- `src/app/(dashboard)/dashboard/vcards/page-client.tsx:51–59` — `resolveCardPublicUrl` returns `vcard.preview.href`.
- `src/app/(dashboard)/dashboard/vcards/page-client.tsx:108–117` — QR image uses that URL.
- `src/app/(dashboard)/dashboard/vcards/page-client.tsx:124–132` — QR PDF uses the same URL.
- `src/lib/services/product-preview.ts:95` — review canonical is `/review/{urlAlias}`.
- `src/lib/services/product-preview.ts:98–103` — social canonical is the raw `redirectUrl`.
- `src/lib/services/product-preview.ts:106–108` — profile canonical prefers `publicSlug`.

**Previous behavior (`db08e7a`):**

```ts
function resolveCardPublicUrl(vcard, origin) {
  const publicSlug = (vcard.publicSlug ?? '').trim();
  if (publicSlug && origin) return `${origin}/${publicSlug}`;
  return `/profile/${vcard.urlAlias}`;
}
```

**Current behavior:** `preview.href`.

**Consequences:**

- A social card with `redirectUrl = https://instagram.com/` now produces a QR that points **directly at Instagram**, not at the stable Taprevia public URL. The QR can no longer be updated centrally, and tap analytics are bypassed.
- A review card produces a QR pointing at `/review/{urlAlias}` instead of `origin/{publicSlug}`. The target changes when the customer edits “Profile URL”.
- This contradicts `src/app/api/my/qr/route.ts:15–18, 59–62`, which explicitly says the encoded value is **always** the domain-qualified public URL (`publicSlug`), never an internal route.
- Live data confirms exposure: cards `6ae85874efc853c66c8a1142` (social, `publicSlug=kaka-pvc/instagram`, `redirectUrl=https://instagram.com/`) and `...1156` (review, `publicSlug=kaka-pvc/google-review`) would produce a different QR payload under the new UI than under `/api/my/qr`.
- Documentation conflict: `docs/PHASE_4D10_GATE_P2_4_FINAL_BUG_FIX_REPORT.md:322–328` says the vCards QR modal is “Unchanged; still QR-specific”, while `docs/PHASE_4D10_GATE_P2_8_UNIFIED_PRODUCT_URL_ARCHITECTURE.md:137` says “QR uses canonical”. Both cannot be true.

**Classification:** Confirmed code regression in customer QR generation. Existing printed QRs are not affected; newly downloaded QRs and future prints are.

---

## 8. Security findings

### PPL-02 — Editable alias + no history + freed-alias takeover (HIGH, confirmed)

**Files/lines:**

- `src/components/builder/tabs/basic-tab.tsx:227–248` — customer can change alias.
- `src/app/api/cards/[id]/route.ts:198–203` — write path, only checks current `urlAlias`.
- `src/lib/services/card-access.ts:103–124` — resolution by `$or [{urlAlias}, {slug}]`.
- `src/app/c/[slug]/page.tsx:55–63` — same `$or`.
- `src/app/r/[...slug]/route.ts:322–341` — legacy fallback resolves by `urlAlias` and `slug`.
- No alias-history collection or redirect-on-rename exists.

**Confirmed synthetic test (isolated DB, dropped afterwards):**

```json
{"patchUniquenessProbeFound":false,"aliasSchemaAcceptsVictimSlug":true}
{"oldAliasAfterRenameResolves":false}
{"oldAliasResolvedCardUid":"AUDIT-ATTACKER","takeoverConfirmed":true}
```

Interpretation:

1. Victim card `slug=victim-slug`, `urlAlias=victim-alias`.
2. Attacker card sets `urlAlias=victim-slug`; the PATCH uniqueness probe does **not** find it (it only checks `urlAlias`), and the schema accepts it.
3. Victim renames from `victim-alias` to `victim-alias-new`; `victim-alias` immediately stops resolving.
4. Attacker claims `victim-alias`; the victim’s old shared link now resolves to the attacker’s card.

**Impact:**

- Any previously shared/printed `/profile/{alias}` or `/review/{alias}` link can break on rename.
- A freed alias can be claimed by another tenant (phishing / impersonation).
- Legacy admin “Permanent” QR fallback (`/profile/{alias}`) inherits this mutability.

**Note:** alias editability is pre-existing, but the recent adoption of alias-based URLs as the customer “Public URL” and QR payload increases the practical impact.

### PPL-03 — Alias uniqueness ignores `slug`; non-unique index; race (MEDIUM, confirmed)

**Files/lines:**

- `src/models/Card.ts:285` — `CardSchema.index({ urlAlias: 1 })` is **not unique**.
- `src/app/api/cards/[id]/route.ts:198–203` — `Card.findOne({ urlAlias: alias })` only.
- `src/app/api/cards/route.ts:104–107` — same probe on creation.
- `src/app/api/cards/check-alias/route.ts:51–57` — availability probe also only checks `urlAlias`.
- `src/lib/services/card-access.ts:109–112` — `$or [{urlAlias}, {slug}]`.
- `src/app/c/[slug]/page.tsx:55–57` — `$or [{urlAlias}, {slug}]`.

**Confirmed:** alias = another card’s `slug` passes validation and is persisted. Requests for that key then match two documents; `findOne` resolution depends on query order, not on a deterministic owner. Concurrent PATCHes can also create duplicate aliases because the index is not unique.

### PPL-06 — Reserved alias lists diverge (LOW, confirmed)

| Alias | `check-alias` probe | Write validation (`aliasSchema`) |
|---|---|---|
| `public` | available | reserved |
| `qr` | available | reserved |
| `assets` | taken | accepted |
| `static` | taken | accepted |

**Files:** `src/app/api/cards/check-alias/route.ts:14–26` vs `src/lib/validation/common.ts:10–22`.

**Impact:** misleading “Available”/“Taken” feedback; no permanent-identifier corruption.

### PPL-08 — `/{publicSlug}` does not apply owner-suspension check (LOW, pre-existing)

`src/lib/services/human-url.ts:306–310`:

```ts
return Card.findOne({ publicSlug: normalized, isActive: true });
```

`/profile/{alias}` explicitly checks `User.status === 'suspended'` (`card-access.ts:116–122`). `/{publicSlug}` and `getPublicStandeeByPublicSlug` do not. If account suspension is represented only by `User.status`, the publicSlug page can remain reachable. This predates `0191bc1`; reported as a security consistency gap, not a regression.

### PPL-07 — Redirect hardening gaps (LOW, suspected)

- `/r` and `/qr` set no explicit `Cache-Control: no-store` on redirect responses.
- Loop prevention exists only for card resolution in `/r` (`r/[...slug]/route.ts:117–124`); standee branches and `/qr` have no self-redirect guard.
- `/r` returns `307`; `/qr` returns `302`. This is inconsistent but not a breakage.

No open redirect was found: external destinations pass `isSafeExternalUrl` and `resolveCardDestination` only accepts `http(s)`.

---

## 9. Confirmed regressions vs suspected risks

### Confirmed problems

| ID | Severity | Problem |
|---|---|---|
| PPL-01 | HIGH | Customer vCards QR encodes canonical preview (external/alias) instead of stable public URL |
| PPL-02 | HIGH | Alias rename breaks old links; freed alias can be claimed by another tenant (confirmed) |
| PPL-03 | MEDIUM | Alias uniqueness ignores `slug`; ambiguous route; non-unique index; race |
| PPL-04 | MEDIUM | Admin “Permanent” QR can encode fallback paths when `routeSlug` is absent |
| PPL-05 | MEDIUM | “Permanent” label can refer to legacy `/c`/`/qr` fallbacks |
| PPL-06 | LOW | Reserved alias lists disagree |
| PPL-08 | LOW | `/{publicSlug}` bypasses owner-suspension check (pre-existing) |

### Suspected risks (not fully proven without production)

| ID | Severity | Risk |
|---|---|---|
| PPL-07 | LOW | Missing `Cache-Control: no-store`; incomplete loop guards |
| PPL-09 | LOW/INFO | Builder header review URL prefers editable alias over immutable `publicSlug` (intentional per P2.8) |
| PPL-10 | INFO | Stale regression tests assert removed `/r` customer labels and old service return shape |

### PPL-04 — Admin permanent QR fallback (MEDIUM, confirmed change)

**Files/lines:** `src/lib/admin-card-view.ts:37–61`; used at `src/app/(admin)/admin/users/[id]/page.tsx:279, 368`.

**Previous (`db08e7a`):** `permanentCardUrl()` returned `''` unless `routeSlug` existed; UI showed “Permanent QR unavailable”.

**Current:** fallback order `/r/{routeSlug}` → `/{publicSlug}` → `/profile/{urlAlias}` → `/c/{slug}`.

**Impact:** For a legacy card with no `routeSlug`, the admin QR now encodes a non-permanent path. The `/profile/{alias}` fallback is mutable. This is the documented P2.3 “QR repair” intent (`docs/PHASE_4D10_GATE_P2_3_FINAL_UNIFIED_REVIEW_MANAGEMENT.md:155–176`) but conflicts with the permanence contract in P2.8. Live customer cards currently all have `routeSlug`; exposure is limited to older/unassigned records.

### PPL-05 — “Permanent” label fallback (MEDIUM, confirmed)

**Files/lines:** `src/lib/services/product-preview.ts:159–176`; displayed at `src/app/(admin)/admin/users/[id]/page.tsx:901–918`.

- Card: `/r/{routeSlug|uid}` → `/c/{slug}`.
- Standee: `/r/{routeSlug|uid}` → `/qr/{panelQr.qrId}`.

For legacy rows, “Permanent” is not `/r/...`. No identifier is modified; the risk is administrative/contract confusion.

---

## 10. Backward compatibility

| Area | Result | Evidence |
|---|---|---|
| `routeSlug`/`uid` resolution | **PASS** | `r/[...slug]/route.ts:86–102`; `verify-timestamp-uid.ts` |
| Legacy `/r/{cardUid|slug|urlAlias}` | **PASS** | `r/[...slug]/route.ts:322–357` |
| `/qr/{qrId}` | **PASS** | `qr/[id]/route.ts` unchanged for identifier lookup |
| `/profile/{alias}` | **PASS** (existing links) | `card-access.ts:103–124` |
| `/c/{slug}` | **PASS** (existing links) | `c/[slug]/page.tsx` |
| `/review/{alias}` | **PASS** (existing links) | `product-preview.ts:78–96` |
| `/{business}/{product}` | **PASS** | `[business]/[product]/page.tsx`, `human-url.ts:306–310` |
| `/panel/{slug}` | **PASS** | `panel/[slug]/page.tsx` |
| Standee Google slot / AIO 3/4 routing | **PASS** | `r/[slug]:169–231`, `qr/[id]:83–132`; prior synthetic tests |
| Existing physical NFC/QR payloads | **PASS** | No identifier rewritten; resolver accepts all legacy keys |
| Customer QR payload (new downloads) | **FAIL for review/social** | PPL-01 |

**Live read-only database scan** (`nfc-crm`, no writes):

- 15 cards. 7 lack `routeSlug` and 8 lack `publicSlug`; those are QA/unassigned legacy rows (`qa-*`, `1d-47-...`).
- All active customer cards (`6ae85874...` series) have `routeSlug`, `uid`, `publicSlug`, and `urlAlias`.
- 7 standees. 2 QA standees lack `routeSlug`/`uid`; all active customer standees (including AIO 3/4) have both plus `publicSlug`.
- No active assignment depends on a missing permanent identifier.

---

## 11. Test results and limitations

### Read-only/synthetic tests run for this audit

| Test | Result | Notes |
|---|---|---|
| `scripts/test-security-boundaries.ts` | **PASS** | Includes `permanentCardUrl` fallback expectations and destination matrix |
| `scripts/test-phase4d10p2-preview-routing.ts` | **14/15** | 1 stale expectation: “missing alias” fixture still has `slug`, so code correctly returns `disabled`. Not a product defect |
| `scripts/verify-human-readable-urls.ts` | **57/61** | 4 stale assertions: 2 expect the old service return shape (`products[].data.card`), 2 expect removed customer “Permanent NFC/QR route”/`permanentRoute` fields (removed intentionally by P2.8) |
| `scripts/test-card-binding.ts` | **SKIPPED** | Isolated DB had no seeded catalog; not a failure |
| Synthetic alias collision/takeover | **CONFIRMED** | See PPL-02/PPL-03; isolated DB dropped |
| Live DB schema read | **PASS** | 15 cards, 7 standees, 20 assignments; no writes |

No test wrote to `nfc-crm`. All write tests used an isolated MongoDB on port `27019`, which was dropped and stopped afterwards.

### Not tested / unverified

1. Production and Preview behavior — no access; production version is unverified.
2. Live `/r`/`/qr` HTTP taps against the customer database — avoided to prevent analytics/tap writes.
3. End-to-end evidence that a printed customer QR used `publicSlug`; the code diff proves the payload source changed, but actual printed assets are not inspectable here.
4. Full `test-phase4d10p3-write-api.ts` matrix.
5. Cross-browser visual check of the builder “Profile URL” field.
6. Whether any external client depends on `permanentRoute` in customer API responses (field is absent now; docs say intentional).

---

## 12. Minimum recommended fixes (not applied)

| Priority | Fix | Scope |
|---|---|---|
| **P0** | Make customer vCards QR use `publicSlug` again (or the `/r/{routeSlug}` permanent route) instead of `preview.href`. Keep Preview as a separate action. | `vcards/page-client.tsx:54–58, 108–132` |
| **P0** | Add alias history/redirect, or stop treating `urlAlias` as a permanent sharing identity. At minimum, block alias changes on cards whose public QR/links already exist, or preserve old aliases in a lookup. | alias update path + resolver |
| **P1** | Make alias uniqueness include `slug` and enforce it with a unique index (or a normalized alias table); replace check-then-write with an atomic write. | `Card.ts`, `cards/route.ts`, `cards/[id]/route.ts`, `check-alias` |
| **P1** | Prevent a freed alias from being claimed while old printed material may exist (retain alias reservations, or require admin approval on reuse). | alias allocation |
| **P2** | Restrict `permanentCardUrl()` to `/r/{routeSlug}` (and standee `/r`) for QR generation; use the fallback only for display, or label it “Legacy”. | `admin-card-view.ts` |
| **P2** | Label `/c/{slug}` and `/qr/{panelQr}` fallbacks explicitly as “Legacy”, not “Permanent”. | `product-preview.ts` + admin UI |
| **P3** | Unify the reserved-alias lists into one shared constant. | `check-alias` + `validation/common.ts` |
| **P3** | Add `Cache-Control: no-store` and self-redirect guards to `/r` and `/qr`. | route handlers |
| **P3** | Apply the owner-suspension check to `/{publicSlug}` and public standee slugs. | `human-url.ts`, `[business]/[product]` |

Do **not** regenerate any identifier, rewrite existing aliases, or migrate customer records to implement these.

---

## 13. Required summary table

| Item | Original Behavior | Current Behavior | Compatibility | Risk |
|---|---|---|---|---|
| **Permanent Link** | `/r/{routeSlug}`; allocated once; not editable | `/r/{routeSlug}` or `/r/{uid}`; not editable; backfill only when missing | **PASS** | LOW — admin QR fallback can display non-`/r` paths (PPL-04/PPL-05) |
| **Public Link** | Profile/review/social public URLs; `publicSlug` immutable; `urlAlias` editable | Same underlying fields, but customer “Public URL” now resolves through canonical preview; review uses `/review/{alias}`, social uses external URL | **PARTIAL** | **HIGH** — alias edits change displayed public link; old links break and can be taken over (PPL-02) |
| **QR destination** | vCards QR used `publicSlug` or `/profile/{alias}`; admin QR used `/r/{routeSlug}` | vCards QR uses `preview.href`; admin QR uses `/r` then fallbacks; `/api/my/qr` still uses `publicSlug` | **FAIL for review/social customer QR** | **HIGH** — PPL-01 |
| **NFC destination** | `/r/{routeSlug}` (or `/r/{slug}/{slot}`) | Unchanged resolver; all identifier generations accepted | **PASS** | LOW — no printed payload rewritten |
| **Standee panel URL** | `/r/{routeSlug}`, `/panel/{slug}`, or `/qr/{panelQr}` | Unchanged; AIO 3/4 still route to `/panel/{slug}` and Google slots to review host | **PASS** | LOW — no change |

---

## 14. Root causes and affected files

### Root cause 1 — Canonical preview adopted as QR/public payload

`src/lib/services/product-preview.ts` defines review/social canonical URLs from `urlAlias`/`redirectUrl`. `vcards/page-client.tsx` then uses `preview.href` for both display and QR. This makes a non-permanent, sometimes editable URL the QR target.

### Root cause 2 — `urlAlias` remains freely editable with no history

`basic-tab.tsx` + `PATCH /api/cards/[id]` allow alias changes; resolvers (`card-access.ts`, `c/[slug]`, `r/[...slug]`) look up the current alias only. No alias history, no redirect, no reservation.

### Root cause 3 — Alias uniqueness is incomplete

Only `urlAlias` is checked, the index is non-unique, and `slug` is part of the same resolution key space. This allows ambiguity and race conditions.

### Root cause 4 — “Permanent” fallbacks

`admin-card-view.ts` and `product-preview.ts` intentionally fall back to `publicSlug`, `urlAlias`, `/c/{slug}`, and `/qr/{panelQr}` so legacy rows are not dead. The fallbacks are useful, but conflating them with “Permanent” and using them for QR generation weakens the contract.

### Affected files

- `src/components/builder/tabs/basic-tab.tsx`
- `src/lib/hooks/use-card-draft.ts`
- `src/app/api/cards/route.ts`
- `src/app/api/cards/[id]/route.ts`
- `src/app/api/cards/check-alias/route.ts`
- `src/lib/validation/common.ts`
- `src/models/Card.ts`
- `src/lib/services/card-access.ts`
- `src/lib/services/human-url.ts`
- `src/lib/services/redirect-target.ts`
- `src/lib/services/product-preview.ts`
- `src/lib/admin-card-view.ts`
- `src/app/r/[...slug]/route.ts`
- `src/app/qr/[id]/route.ts`
- `src/app/c/[slug]/page.tsx`
- `src/app/profile/[alias]/page.tsx`
- `src/app/[business]/[product]/page.tsx`
- `src/app/panel/[slug]/page.tsx`
- `src/app/(dashboard)/dashboard/vcards/page-client.tsx`
- `src/app/(dashboard)/dashboard/products/page.tsx`
- `src/app/(dashboard)/dashboard/products/[id]/page.tsx`
- `src/components/builder/builder-shell.tsx`
- `src/components/dashboard/standee-manager.tsx`
- `src/app/api/my/qr/route.ts`
- `src/app/api/admin/users/[id]/route.ts`
- `src/app/(admin)/admin/users/[id]/page.tsx`

---

## 15. Final verdict

- **Permanent Link (`/r/{routeSlug}`) is not editable.** `routeSlug`, `uid`, `publicSlug`, `slug`, and QR IDs have no customer/admin write path and are preserved by replacement and backfill logic.
- **Public Link editability is real but comes from `urlAlias`**, which has been editable since the initial commit. It is not a new field.
- **The recent change is how those URLs are surfaced and encoded.** `0191bc1` made the canonical preview the customer public URL and vCards QR payload, which:
  - moves review cards to `/review/{alias}` and social cards to their raw destination,
  - makes newly generated QR codes depend on an editable alias or bypass Taprevia routing,
  - creates the appearance that “Permanent/Public Links are editable.”
- **Existing NFC/QR routes still resolve.** No stored identifier or printed destination was changed by this audit or by the recent code.
- **No CRITICAL identifier-overwrite defect exists.** The highest risks are QR-target stability (PPL-01) and alias rename/takeover (PPL-02), both HIGH.

**No code, database, environment, identifier, QR, or URL change was made during this audit. Awaiting approval before implementing any fix.**
