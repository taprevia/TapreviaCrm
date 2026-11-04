# Taprevia — Review URL & Multi-Profile Standee AI Eligibility Audit

**Date:** 2026-11-04  
**Branch:** `Devlopment`  
**HEAD:** `0191bc1889c95e5716afa2f8f67a991ac131c101`  
**Mode:** Read-only audit  
**Final status:** **AUDIT COMPLETE — NO IMPLEMENTATION**

---

## 1. Executive Summary

### Issue 1 — Review URL

`/review/digital-mw1uek1gzv` is the **review experience URL**, not the permanent QR/NFC URL.

The card behind it is a **Google Review NFC Plate** whose review is **unpublished**:

- `reviewAssistant.enabled = false`
- `reviewSettingsSource = central`
- central `ReviewSettings.general.enabled = false`
- no tenant OpenAI provider configured

The branded `publicSlug` `taprevia/google-review-2` exists, but its route intentionally returns **404** while the review is unpublished. Customer surfaces therefore fall back to the existing `/review/{urlAlias}` route, and `/r/mw1uek1ij3` redirects to that same review page. The internal alias is exposed because the review is not published and because the review page route is `/review/[alias]`.

The permanent NFC/QR URL is already correct and unchanged:

```text
/r/mw1uek1ij3 → 307 → /review/digital-mw1uek1gzv
```

A clean branded URL can be shown in copy/share only for **published** review cards. Keeping it visible in the browser after navigation would require a new server route or rewrite; the current branded route redirects to `/review/{alias}`.

### Issue 2 — Multi-Profile Standee AI Eligibility

All In One Standee 3/4 already declare the `review_ai_suggestions` capability. Their canonical product configuration is not the blocker.

The actual standees are excluded because the **Google Review slot has no destination URL**:

- `resolveStandeeGoogleReviewUrl()` returns `null`
- `projectStandee()` therefore sets `eligible = false`
- `listEligibleReviewProducts()` only returns eligible products
- Review Management consequently omits the AIO standees

A disposable-clone test confirmed that setting the Google Review destination on an AIO standee immediately makes it eligible and visible in Review Management. No product entitlement change is required.

For actual AI draft generation, additional gates still apply: effective review settings must be enabled/published and the tenant must have an enabled OpenAI provider. The affected test account currently has neither.

---

## 2. Review URL Root Cause

### 2.1 Exact Card

| Field | Value |
|---|---|
| Card `_id` | `6aeae9d218200f2461c8cdcb` |
| Card UID | `DIGITAL-MW1UEK1GZV` |
| Owner | `test4@gmail.com` — `6aeae9d218200f2461c8cd1a` |
| Product | Google Review NFC Plate — `6ae851d69391bf20babb5210` |
| Product kind | `review` |
| Assignment | `6aeae9d218200f2461c8cdd2` |
| `routeSlug` | `mw1uek1ij3` |
| `uid` | `mw1uek1ij3` |
| `urlAlias` / `slug` | `digital-mw1uek1gzv` |
| `publicSlug` | `taprevia/google-review-2` |
| Status | `active`, `setupComplete: true` |
| Review published | **No** — `reviewAssistant.enabled: false` |
| Review settings source | `central` |
| Central settings | `general.enabled: false` |
| AI provider | No `TenantSettings` OpenAI configuration |

### 2.2 URL Generation Chain

| Layer | File / function | Behavior |
|---|---|---|
| Permanent resolver | `src/app/r/[...slug]/route.ts:90–123` | Resolves card by `routeSlug`/`uid`; calls `resolveCardDestination` |
| Review destination | `src/lib/services/redirect-target.ts:42–45` | Review card → `/review/{urlAlias \| slug}` |
| Review page | `src/app/review/[alias]/page.tsx:77–96, 124–180` | Resolves card by alias/slug; renders review flow or unavailable state |
| Branded public slug | `src/app/[business]/[product]/page.tsx:20–25, 83–101` | Resolves card by `publicSlug`; delegates to `PublicCardPage` |
| Review dispatch | `src/components/public/public-card-page.tsx:66–76` | Published review → redirect to `/review/{alias}`; unpublished → 404 |
| Middleware | `src/middleware.ts:5–16, 101–106` | `/review/` and `/r/` are public card routes; no auth block |
| Customer Public URL | `src/lib/services/customer-public-url.ts:44–50` | Published review prefers `/{publicSlug}`; otherwise `/review/{alias}` |
| Customer product list | `src/app/(dashboard)/dashboard/products/page.tsx:307–318` | Uses branded URL only when review preview is available; otherwise `/review` fallback |
| Customer product detail | `src/app/(dashboard)/dashboard/products/[id]/page.tsx:306–320` | Uses `canonicalPublicUrl` when published; otherwise `/review` fallback |
| vCards display | `src/app/(dashboard)/dashboard/vcards/page-client.tsx:66–78` | Same published/unpublished fallback |
| Preview resolver | `src/lib/services/product-preview.ts:80–99` | Published review → `/{publicSlug}`; otherwise review alias or disabled state |
| Review Management preview | `src/app/api/review-management/preview/route.ts:140–150` | Preview URL is always `/review/{urlAlias}` |
| Eligibility preview URL | `src/lib/services/review-product-eligibility.ts:224` | Review product `previewUrl` is `/review/{urlAlias}` |
| QR/NFC helpers | `src/lib/admin-card-view.ts:34–48, 79–105`; `src/app/(dashboard)/dashboard/vcards/page-client.tsx:87–91` | QR/NFC payload is `/r/{routeSlug}` only |

### 2.3 Expected vs Actual Behavior

| URL type | Current behavior | Expected behavior | Root cause |
|---|---|---|---|
| Permanent NFC/QR | `/r/mw1uek1ij3` → **307** `/review/digital-mw1uek1gzv` | Same `/r` permanent route | Correct — no defect |
| Customer Public URL | `/review/digital-mw1uek1gzv` (unpublished fallback) | Branded `taprevia/google-review-2` only when published; `/review` fallback otherwise | Review is unpublished; branded route would 404 |
| Final browser URL | `/review/digital-mw1uek1gzv` | Currently necessarily `/review/{alias}`; a branded URL would require a new server route/rewrite | Review page route is `/review/[alias]`; branded route redirects there |
| Review Management preview | `/review/digital-mw1uek1gzv` | Review-page preview; `/review` is appropriate for the review experience | Preview endpoints hardcode the review alias |
| Branded public URL | `/taprevia/google-review-2` → **404** | 307 → `/review/{alias}` once published | `dispatchReviewCard` fails closed while review is disabled |

Verified on a disposable clone:

```text
/review/digital-mw1uek1gzv      200
/taprevia/google-review-2       404
/r/mw1uek1ij3                   307 → /review/digital-mw1uek1gzv
```

Review Management preview API returned:

```json
{
  "previewUrl": "/review/digital-mw1uek1gzv",
  "published": false,
  "previewAvailable": true,
  "hostingEnabled": true,
  "source": "central"
}
```

### 2.4 Why the Internal Alias Is Exposed

1. The card is **not published** (`reviewAssistant.enabled=false`; central `general.enabled=false`).
2. The branded route `/{publicSlug}` intentionally fails closed with 404 for an unpublished review.
3. Customer surfaces therefore keep the existing `/review/{urlAlias}` fallback to avoid advertising a 404.
4. The review page itself is served at `/review/[alias]`, so `/r/{routeSlug}` and the branded route both redirect to that alias.
5. Review Management’s preview URL is always `/review/{urlAlias}` by design; it is a review-page link, not the permanent QR/NFC link.

This is **URL presentation and routing behavior**, not a broken `/r` resolver.

### 2.5 Can a Clean Branded URL Remain Visible in the Browser?

**Not with the current architecture.**

- `/{publicSlug}` is an entry/redirect route; it dispatches to `/review/{alias}`.
- The review UI is only served at `/review/[alias]`.
- The permanent `/r/{routeSlug}` also redirects to `/review/{alias}`.

To keep a branded URL in the browser, one of these would be required:

1. A new server route or rewrite that serves the review UI at `/{business}/{product}` without redirecting.
2. A new branded review route (e.g. `/review/{business}/{product}`), which the prior audit explicitly advised against without a compatibility strategy.
3. Client-side `history.replaceState` after loading `/review/...` — not recommended: it creates a non-server-backed URL, complicates canonical/OG metadata, sharing, analytics, and refresh behavior.

Options 1 and 2 are routing changes and require approval. No such change was made.

### 2.6 Backward Compatibility Impact of Any Future Change

| Area | Impact |
|---|---|
| Existing `/review/{alias}` links | Must remain functional |
| Existing `/r/{routeSlug}` links | Must remain unchanged; physical NFC/QR depends on them |
| Physical NFC cards | Must not be reprogrammed |
| Printed QR codes | Must keep resolving through `/r` |
| Existing `publicSlug` values | Must not change |
| Review publication gating | Must remain: unpublished reviews must not become public |
| Analytics / tap tracking | Redirect attribution must not be bypassed |
| Profile, social, standee routes | Must remain unchanged |
| Preview/copy controls | Must not advertise a 404 |

---

## 3. Multi-Profile Standee Eligibility Root Cause

### 3.1 Canonical Product Configuration

| Product | ProductId | Kind | Review capability | Metadata |
|---|---|---|---|---|
| All In One Standee – 3 Profile | `ALL_IN_ONE_STANDEE_3` | `standee` | **Includes** `google_review`, `review_gate`, `review_ai_suggestions` | `maxProfiles: 3`; fixed profiles `google_review`, `instagram`, `facebook` |
| All In One Standee – 4 Profile | `ALL_IN_ONE_STANDEE_4` | `standee` | **Includes** `google_review`, `review_gate`, `review_ai_suggestions` | `maxProfiles: 4`; fixed profiles `google_review`, `instagram`, `whatsapp`, `facebook` |

Configuration: `src/config/products.ts:247–290`.

Both products are active and resolve to their canonical ProductIds. The product entitlement itself already permits Review Management and AI review capability.

### 3.2 Eligibility Decision Path

```text
Standee
  → UserProduct assignment (status active, owner matches standee.userId)
  → Canonical product slug → ProductId
  → getProductCapabilities(ProductId).includes('review_ai_suggestions')   ✅ true
  → resolveEntitlement(ownerId) has review_ai_suggestions                  ✅ true for test4/prince
  → resolveStandeeGoogleReviewUrl(standee)
       → first socialQrs slot with platform === 'google_review'
       → slot.destinationUrl must be a safe URL
       → fallback Profile.socialLinks google_review URL
  → if no destination → eligible = false
  → listEligibleReviewProducts() omits the product
  → Review Management UI never sees it
```

Exact code:

| Step | File / function | Condition |
|---|---|---|
| Product capability check | `src/lib/services/review-product-eligibility.ts:133–138` | `getProductCapabilities(productId).includes('review_ai_suggestions')` |
| Account entitlement | `src/lib/services/review-product-eligibility.ts:316–318` | `entitlement.capabilities.has('review_ai_suggestions')` |
| Standee eligibility | `src/lib/services/review-product-eligibility.ts:247–249` | `accountReviewEntitled && grants && Boolean(googleReviewUrl)` |
| Google Review destination | `src/lib/services/review-standee-settings.ts:105–121` | Empty slot + empty Profile fallback → `null` |
| List filtering | `src/lib/services/review-product-eligibility.ts:360–382` | Only `projected?.eligible` products are returned |
| API list | `src/app/api/review-management/products/route.ts:19` | Returns `listEligibleReviewProducts()` |
| UI count/list | `src/components/review-management/review-management-client.tsx:1161–1188` | Displays only returned eligible products |

### 3.3 Live Evidence

For both `test4@gmail.com` and `prince@gmail.com`, every AIO 3/4 standee has:

```json
{
  "fixedProfiles": ["google_review", "instagram", "facebook"],
  "socialQrs": [
    { "platform": "google_review", "destinationUrl": "" },
    { "platform": "instagram", "destinationUrl": "" },
    { "platform": "facebook", "destinationUrl": "" }
  ]
}
```

Both profiles also have no `google_review` fallback in `Profile.socialLinks`.

Read-only eligibility service result:

| Assignment | Product grants review | Account entitled | Destination configured | Eligible | Listed in Review Management |
|---|---|---|---|---|---|
| test4 AIO 3 | **true** | **true** | **false** | **false** | **false** |
| test4 AIO 4 | **true** | **true** | **false** | **false** | **false** |
| prince AIO 3 | **true** | **true** | **false** | **false** | **false** |
| prince AIO 4 | **true** | **true** | **false** | **false** | **false** |

Disposable-clone verification:

1. Before changing destinations: AIO 3/4 were not listed.
2. After setting the `google_review` slot destination on test4’s AIO 3/4:
   - both became `eligible: true`
   - both appeared in `listEligibleReviewProducts`
   - `standeeGoogleReviewUrl` returned the configured URL
3. Prince’s AIO standees remained ineligible because only test4’s clone documents were changed.

This confirms the product configuration and entitlement are already sufficient; the missing per-standee Google Review destination is the blocker.

### 3.4 Multi-Profile Behavior

| Question | Finding |
|---|---|
| Does each standee profile have its own business identity? | **No.** All slots share the standee owner and the same `Profile`/`TenantSettings`. |
| Does each profile have its own Google Review destination? | Each `socialQrs` slot has its own `destinationUrl`, but only the slot with `platform: 'google_review'` is used as the review host. AIO 3/4 have exactly one Google Review slot. |
| Does each profile have its own Review Management configuration? | **No.** Review settings/overrides live on the whole `Standee`, not per slot. |
| Does each profile have its own AI provider configuration? | **No.** AI provider configuration is per tenant in `TenantSettings.openai`. |
| Independent keywords/services/employees/topics per profile? | **No.** They come from central `ReviewSettings` or the standee-level `reviewOverrides`. |
| Does the current model support independent AI review generation per profile? | **Not for multiple Google Review profiles.** The resolver finds the first `google_review` slot and creates one host per standee route. AIO 3/4’s single Google Review slot is supported; multiple independent Google Review profiles would require new per-slot data/API/UI. |

Relevant model details:

- `src/models/Standee.ts:3–15` — per-slot `socialQrs` with independent `destinationUrl`.
- `src/models/Standee.ts:92–103` — standee-level review source/version/overrides, not slot-level.
- `src/models/TenantSettings.ts:25–34` — one OpenAI provider config per tenant.
- `src/lib/services/review-standee-settings.ts:105–121` — first `google_review` slot only.
- `src/lib/services/review-standee-settings.ts:290–346` — one `resolveStandeeReviewHost(routeSlug)` per standee route.

### 3.5 Additional AI Generation Gates

Even after a Google Review destination is configured, actual AI draft generation requires:

1. **Review publication:** `resolveEffectiveReviewSettings(...).enabled` must be true; otherwise `resolveStandeeReviewHost` returns `null` (`review-standee-settings.ts:346`).
2. **AI provider:** `TenantSettings.openai.enabled === true` and a stored `apiKeyEnc`; otherwise `generateReviewForHost` returns `AI_NOT_CONFIGURED` (`review-generate.ts:276–293`).
3. **Rate/cost controls:** daily reservation and per-host limits (`review-generate.ts:296–340`).

Current test4 configuration:

- No `TenantSettings` document → no OpenAI provider.
- Central `ReviewSettings.general.enabled = false` → review host not published.

Therefore, configuring the AIO destination makes the product appear in Review Management, but AI generation still remains correctly restricted until the review is published and the tenant AI provider is configured.

---

## 4. Impact Assessment

### Issue 1 — Review URL

| Area | Risk / impact |
|---|---|
| Existing `/review/{alias}` links | Must remain; no change needed |
| Existing `/r/{routeSlug}` links | Must remain; QR/NFC depends on them |
| Physical NFC / printed QR | No impact if `/r` unchanged |
| Public slugs | No new slugs required; existing `taprevia/google-review-2` remains |
| Publication restrictions | Must not allow unpublished review pages to become public |
| Analytics | A new branded review route could change tap attribution; `/r` must remain the tracked permanent entry |
| Preview/copy | Unpublished cards must not advertise a 404 branded URL |
| Profile/social/standee routes | Unaffected |

### Issue 2 — Multi-Profile Standee

| Area | Risk / impact |
|---|---|
| AIO 3/4 entitlement | Already granted; no change needed |
| AIO destinations | Configuring the Google Review slot is a customer-data change |
| Other slots | Instagram/WhatsApp/Facebook destinations must remain independent and unchanged |
| Premium / GRC / Plate | Must not inherit broader AIO behavior accidentally |
| Business NFC Card | Must remain excluded from review AI capability |
| AI provider | Per tenant; configuring it affects all review hosts for that tenant |
| Public standee routing | Existing `/r` and `/panel` behavior must remain |
| Analytics | Standee review events already attribute by `standeeId`; no change needed |

---

## 5. Proposed Solutions — Not Implemented

### Issue 1 — Review URL

**Option A — Publish the review (recommended if the goal is a usable branded URL).**

- Configure/enable the card’s Review Management publication and Google Review destination.
- The existing branded `publicSlug` route then dispatches to `/review/{alias}` and customer copy uses `/{publicSlug}`.
- Requires customer-data/config change, not code.
- Final browser URL remains `/review/{alias}` unless routing is also changed.

**Option B — Keep `/review/{alias}` as fallback for unpublished reviews (current safe behavior).**

- No code change.
- No 404 copy links.
- Branded URL is used only when published.

**Option C — Make a branded URL remain in the browser.**

- Requires a new server route or rewrite that renders the review UI at `/{business}/{product}` or another approved branded path.
- Must preserve `/review/{alias}`, `/r/{routeSlug}`, QR/NFC payloads, publication gating, analytics, canonical metadata, and redirect-loop protection.
- Requires product-owner approval; not recommended as a quick change.

**Do not** use client-side `history.replaceState` as the primary solution; it creates a URL not backed by a server route and complicates sharing, refresh, analytics, and canonical behavior.

### Issue 2 — Multi-Profile Standee

**Option A — Configure the Google Review slot destination (recommended, no code).**

Use the existing Standee Manager / product configuration:

- `src/components/dashboard/standee-manager.tsx:446–469`
- `src/app/api/my/products/[id]/config/route.ts:262–296`

Set a safe Google Review URL on the `google_review` slot. The existing AIO eligibility path will then list the standee in Review Management. Also publish effective review settings and configure the tenant OpenAI provider if AI drafts are required.

**Option B — Show AIO as “setup required” before destination (code/UX change, not recommended without approval).**

Could separate “review-capable” from “ready for generation” and show a setup state in Review Management. This would require changes to `projectStandee`/list filtering and UI. It must not allow generation without a Google Review destination.

**Option C — Independent review generation per profile (larger development).**

Would require:

- per-slot review configuration on `Standee`
- slot-scoped eligibility
- slot-aware review host route
- per-slot or per-profile settings UI
- migration/compatibility strategy

Not needed for AIO 3/4 as currently designed because they contain exactly one Google Review profile.

---

## 6. Regression Test Plan for Any Future Implementation

### Issue 1 — Review URL

1. `/review/{existingAlias}` returns 200 and renders the review flow.
2. `/r/{routeSlug}` remains 307 to the current review destination.
3. Published branded `/{publicSlug}` returns 307 to `/review/{alias}`.
4. Unpublished branded `/{publicSlug}` remains 404.
5. Customer Public URL uses `/{publicSlug}` only when published; otherwise `/review`.
6. Review Management preview remains functional.
7. QR/NFC generation still encodes `/r/{routeSlug}` only.
8. No redirect loop; no duplicate route precedence.
9. Analytics/tap tracking remains attached to the `/r` entry.
10. PPL-01, PPL-02, PPL-04/05, PPL-06, PPL-07, security, and review suites pass.

### Issue 2 — AIO Standee Eligibility

1. AIO 3/4 product capability remains `review_ai_suggestions`.
2. `listEligibleReviewProducts` includes AIO only when its Google Review slot has a safe destination.
3. `getReviewProductForUser` returns `eligible: true` for configured AIO and false for unconfigured AIO.
4. `resolveStandeeReviewHost` succeeds only when review settings are enabled/published.
5. Suggestions and generation work with AI configured and fall back correctly without AI.
6. Per-slot destinations remain independent.
7. Business NFC Card remains review-ineligible.
8. Premium NFC Card and Google Review Card/Plate behavior remains unchanged.
9. Standee `/r/{routeSlug}/{slot}` and panel routes remain unchanged.
10. Review Management, Standee Review, entitlements, TypeScript, ESLint, and build pass.

---

## 7. Safety Confirmation

- **No application source code was modified during this audit.**
- No live database records were written, deleted, or updated.
- No schema changes, migrations, entitlement changes, API key changes, or environment changes.
- All live database access was read-only.
- The only write was to a disposable isolated clone to test AIO destination eligibility; that clone was dropped afterward.
- No production or preview database was accessed.
- No commit, push, or deployment was performed.

---

## 8. Approval Required

The following decisions require explicit product-owner approval before any implementation:

1. Whether to configure real Google Review destinations on the AIO 3/4 standee slots.
2. Whether to publish central Review Settings for the affected account(s).
3. Whether to configure an OpenAI provider for AI draft generation.
4. Whether to change Review Management to list AIO before a destination exists (not recommended).
5. Whether to introduce a new branded review URL route/rewrite that keeps the branded URL visible in the browser.
6. Whether independent per-profile review generation is a future requirement (larger schema/API/UI work).

**Audit complete. No implementation performed.**
