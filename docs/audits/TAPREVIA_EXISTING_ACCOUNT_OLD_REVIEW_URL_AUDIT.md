# Taprevia — Existing Account Old Review URL Audit

**Date:** 2026-11-04  
**Branch:** `Devlopment`  
**HEAD:** `0191bc1889c95e5716afa2f8f67a991ac131c101`  
**Mode:** Strict read-only audit  
**Final status:** **AUDIT COMPLETE — NO CHANGES**

---

## 1. Exact Root Cause

The account is displaying `/review/digital-mw1uek1gzv` because the review experience is **not published**.

The card has a valid branded `publicSlug`:

```text
taprevia/google-review-2
```

But the review is disabled:

- `reviewAssistant.enabled = false`
- `ReviewSettings.general.enabled = false`
- no Google Review destination configured
- no tenant OpenAI provider configured

The branded route is publication-gated:

```text
/taprevia/google-review-2 → 404
```

The customer-facing components therefore deliberately fall back to the existing internal review route:

```text
/review/digital-mw1uek1gzv
```

This is **not** a stale build or a broken branded resolver. The running application is serving the latest branded-rendering behavior for published reviews.

---

## 2. Current Card and Publication Status

| Field | Value |
|---|---|
| Card `_id` | `6aeae9d218200f2461c8cdcb` |
| Card UID | `DIGITAL-MW1UEK1GZV` |
| Owner | `test4@gmail.com` — `6aeae9d218200f2461c8cd1a` |
| Assignment | `6aeae9d218200f2461c8cdd2` — active |
| Product | Google Review NFC Plate — `6ae851d69391bf20babb5210` |
| Product kind | `review` |
| `urlAlias` | `digital-mw1uek1gzv` |
| `routeSlug` / `uid` | `mw1uek1ij3` |
| `publicSlug` | `taprevia/google-review-2` |
| Card status | `active`, `isActive: true` |
| `reviewSettingsSource` | `central` |
| `reviewAssistant.enabled` | **false** |
| Central `ReviewSettings.general.enabled` | **false** |
| Google Review URL | empty |
| Tenant OpenAI provider | not configured |
| Effective review settings | **disabled** |
| Branded route availability | **404 — unpublished** |

Read-only entitlement/effective-settings check:

```json
{
  "entitled": true,
  "effective": {
    "enabled": false,
    "googleReviewUrl": "",
    "source": "legacy",
    "category": "",
    "languages": ["English"]
  },
  "product": {
    "eligible": true,
    "previewAvailable": true,
    "googleDestinationConfigured": false,
    "reviewAssistantEnabled": false,
    "settingsSource": "central",
    "previewUrl": "/review/digital-mw1uek1gzv",
    "effectiveGoogleReviewUrl": ""
  }
}
```

The account is product-entitled, but the review experience is not published.

---

## 3. Current Routing

| URL | Status | Behavior |
|---|---|---|
| `/review/digital-mw1uek1gzv` | **200** | Internal review route; renders the unavailable state because publication is disabled |
| `/taprevia/google-review-2` | **404** | Branded route correctly fails closed for an unpublished review |
| `/r/mw1uek1ij3` | **307** → `/review/digital-mw1uek1gzv` | Permanent NFC/QR route is unchanged |

The live application is serving the latest implementation. A known published review card (`/kaka-pvc/google-review`) returns **200 directly** at its branded URL, which confirms the new branded renderer is active. The old account’s `/review` URL is a publication-state fallback, not an outdated build.

No live `/r` request was made, because that route writes tap analytics. `/r` verification was performed earlier against an isolated clone and remains unchanged.

---

## 4. Which UI Components Display the Old URL

### Components that intentionally use `/review/{urlAlias}` for this unpublished card

| Surface | File | Behavior |
|---|---|---|
| My Products list — Public URL | `src/app/(dashboard)/dashboard/products/page.tsx:312–318` | When `product.preview?.ok` is false, falls back to `resolveCustomerPublicPath({ kind: 'review', urlAlias })` → `/review/digital-mw1uek1gzv` |
| Product detail — Public URL | `src/app/(dashboard)/dashboard/products/[id]/page.tsx:311–319` | Uses `canonicalPublicUrl`; for this unpublished card that is null, so falls back to `/review/digital-mw1uek1gzv` |
| vCards — Public URL / QR modal | `src/app/(dashboard)/dashboard/vcards/page-client.tsx:68–77` | For a review card with `preview.ok === false`, strips `publicSlug` and falls back to `/review/digital-mw1uek1gzv` |
| Review Management preview API | `src/app/api/review-management/preview/route.ts:149` | Returns `previewUrl: /review/digital-mw1uek1gzv` for this card; UI only shows “Open review page” when `published` is true |
| Review product list API | `src/lib/services/review-product-eligibility.ts:224` | `previewUrl` for the card is `/review/digital-mw1uek1gzv` |

### Components that are not the source

| Surface | Behavior |
|---|---|
| Permanent NFC/QR | `/r/mw1uek1ij3` — unchanged and correct |
| Admin “Permanent” URL | `/r/{routeSlug}` — not `/review` |
| Admin “Public URL” | Uses preview/canonical URL; for this unpublished card it is unavailable rather than a working branded URL |
| Review Management “Open review page” | Hidden while `published` is false |
| Branded route | `/taprevia/google-review-2` is 404 while unpublished |
| Profile/social/standee routes | Unaffected |

### Important distinction

- **Permanent NFC/QR URL:** `/r/mw1uek1ij3` — always uses `/r`.
- **Branded public URL:** `/taprevia/google-review-2` — allocated, but currently unpublished/404.
- **Internal review route:** `/review/digital-mw1uek1gzv` — the current fallback and the route used by the final browser URL after `/r`.
- **Unpublished preview URL:** `/review/digital-mw1uek1gzv` — should be labelled as preview, not advertised as a public URL.

The old URL is therefore **not** being used as a permanent QR/NFC payload. It is the customer-facing fallback and Review Management preview URL while the review is unpublished.

---

## 5. Existing vs Expected Behavior

| URL type | Current behavior | Expected behavior |
|---|---|---|
| Permanent NFC/QR | `/r/mw1uek1ij3` → 307 → `/review/...` | Unchanged |
| Customer Public URL | `/review/digital-mw1uek1gzv` fallback | Branded `/taprevia/google-review-2` only after publication |
| Final browser URL | `/review/digital-mw1uek1gzv` | Branded URL only if the review is published and the branded route renders directly |
| Review Management preview | `/review/digital-mw1uek1gzv`, `published: false` | Clearly labelled preview while unpublished |
| Branded public URL | **404** | 200 after publication, or 404 while unpublished |

The requested expectation — show `/taprevia/google-review-2` — is only valid once the review is **published**. Showing it earlier would advertise a 404 and violate the publication gate.

---

## 6. Minimal Recommended Correction

### If the account is intended to be public

**No code change is required.** Publish/configure the existing review experience:

1. Save/enable the central Review Settings (`general.enabled`).
2. Configure a valid Google Review destination.
3. Optionally configure the tenant OpenAI provider for AI drafts.

After publication, the existing implementation will:

- Serve `/taprevia/google-review-2` directly with HTTP 200.
- Use the branded public URL in customer-facing resolution.
- Keep `/review/digital-mw1uek1gzv` and `/r/mw1uek1ij3` working.
- Preserve every identifier and QR/NFC payload.

This is a customer configuration/data change and requires approval; it was not performed.

### If the account must remain unpublished

Keep `/review/digital-mw1uek1gzv` as an **internal preview** and label it clearly. Do not present it as the Public URL or as a working branded public link. The correct small UI correction would be:

- Label the value “Review preview (not published)”.
- Show “Public URL unavailable until published” rather than a public URL.

That is a display-label change only; it does not require changing identifiers, routes, or publication behavior.

### Do not

- Force the branded URL to display while unpublished.
- Change `publicSlug`, `urlAlias`, `routeSlug`, or QR/NFC payloads.
- Redirect `/review/{alias}` away or remove it.
- Change `/r` destinations.
- Bypass publication gating.

---

## 7. Backward Compatibility Risks

| Change | Risk |
|---|---|
| Publishing the review | Low data risk; required for branded public URL |
| Showing branded URL while unpublished | High — exposes a 404 and violates publication gating |
| Changing `publicSlug` / aliases | High — breaks existing identifiers/links |
| Redirecting `/review` to branded URL | Medium/high — changes legacy behavior and analytics |
| Changing `/r` | High — affects physical NFC/printed QR |
| Restyling unrelated URL surfaces | Unnecessary risk |

---

## 8. Safety Confirmation

- No source code was modified during this audit.
- No database writes, migrations, schema changes, or customer-record changes were made.
- No publication settings, API keys, slugs, routes, or QR/NFC identifiers were changed.
- All live database access was read-only.
- No production or preview database was accessed.
- No commit, push, or deployment was performed.

**Audit complete. Awaiting approval before any publication change or UI-label correction.**
