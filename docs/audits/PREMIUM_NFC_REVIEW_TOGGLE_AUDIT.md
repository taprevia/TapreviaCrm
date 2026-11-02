# Premium NFC Card Review Toggle Audit

**Date:** 2026-11-02  
**Mode:** Read-only scan — no fixes implemented  
**Branch:** `Devlopment`  
**Environment:** `localhost:3000`  
**Database:** `127.0.0.1:27017/nfc-crm`  
**Central Review Integration:** ON locally  
**Local force-all:** ON

---

## 1. Executive summary

The Premium NFC Card is **correctly entitled** to Review Management. The backend returns `review.eligible = true` for the live Premium assignment, and the product-detail page **does render** a “Google Reviews” section with a “Review settings” button.

The reported “toggle” is not missing because of Premium entitlement or Central Review integration.

Confirmed cause:

- **No per-product Review Management enable/disable toggle is rendered in either the Premium product-detail page or the Premium builder.**
- The only per-card toggle component — `ProductSettingsDialog` — contains an “Enable reviews” switch, but that component is **never imported or mounted anywhere** in the application.
- The Premium builder does not receive a “Reviews” tab because builder review tabs are gated to `kind === 'review'`, while Premium NFC Card is `kind: 'profile'`.
- The only visible review toggle in the customer UI is the **global central “Review availability” switch** on the Review Management page. It controls shared central settings, not an individual Premium card.

This is a **UI placement/wiring issue**, not an entitlement, catalog, API, or Central-integration failure.

No files, database records, assignments, or settings were changed during this audit.

---

## 2. Where the toggle is expected

There are three candidate locations, and the intended one is not documented explicitly:

### A. Premium product-detail page

`src/app/(dashboard)/dashboard/products/[id]/page.tsx`

- Lines 315–316 compute `reviewSection`.
- Lines 519–560 render the “Google Reviews” card.
- This card contains:
  - “Open review page” (when a Google URL exists)
  - “Review settings” link
  - “Set up Google review link”
- It contains **no `Switch` and no enable/disable toggle**.

### B. Premium builder

`src/components/builder/builder-shell.tsx`

- Lines 145–160 define `REVIEW_TABS` containing a “Reviews” tab.
- Lines 219–224 select tabs:
  - `kind === 'social'` → `SOCIAL_TABS`
  - `kind === 'review'` → `REVIEW_TABS`
  - otherwise → profile `TABS`
- `src/components/builder/tabs/review-management-link-tab.tsx` lines 15–64 is a link-only page, not a toggle.

Premium NFC Card has `kind: 'profile'`, so it receives the profile tabs and **no Reviews tab**. Browser verification confirmed tabs: Basic, About, Cover & Photos, Gallery, Socials, Business Hours, Theme, Template, Products, Services — no Reviews.

### C. Review Management page

`src/components/review-management/review-management-client.tsx`

- Lines 1048–1072 contain the global “Review availability” `Switch` (`aria-label="Enable reviews for centralized settings"`).
- Lines 1200–1300 render product rows with source controls and setup/preview buttons, but **no per-product enable/disable switch**.

That global switch is present and enabled locally. If the user expects a per-Premium-card toggle there, that control does not exist.

---

## 3. Does the toggle component exist?

Yes, but it is orphaned.

`src/components/review-management/product-settings-dialog.tsx`

- Lines 3–9 document that it is a legacy per-Card settings editor, offered only when the product source is `legacy`.
- Lines 155–165 render the “Enable reviews” `Switch`:
  - label: “Enable reviews”
  - helper: “Publish the review page for this Card.”
  - `aria-label="Enable reviews for this Card"`

However:

```text
grep -RIn "ProductSettingsDialog" src
→ only the component definition itself
```

It is not imported by any page or component. The same result appears in all recovery checkpoints checked:

- `CRM-Audit-final-20261102-143841`
- `CRM-Audit-pre-20261102-143010`
- `ReviewImport-pre-20261102-153424`
- `CentralLocal-pre-20261102-170541`

There is no evidence that a previously rendered Premium toggle was removed by a recent change. It appears never to have been wired into the UI in these checkpoints.

---

## 4. Premium NFC Card entitlement verification

### Catalog

`src/config/products.ts`

- Premium definition: lines 123–140.
- `review_ai_suggestions` capability: line 135.
- Business NFC Card definition: lines 107–121; it does **not** include `review_ai_suggestions`.

### Entitlement service

`src/lib/services/review-entitlement.ts`

- Lines 54–58 resolve the canonical product ID from the active assignment slug and check `review_ai_suggestions`.
- Lines 63–87 evaluate active `UserProduct` assignments first. A lower-tier active assignment cannot inherit an unrelated account capability.
- Premium active assignment therefore returns `entitled: true` with `source: product`.

### Review-product eligibility

`src/lib/services/review-product-eligibility.ts`

- Lines 133–138: `productGrantsReview` resolves the product slug and checks the capability.
- Lines 156–164: eligibility requires account entitlement, product grant, active Card, and a public alias.
- Lines 186–227: project the Card as an eligible review product, including `cardKind`, source, preview URL, and management state.

### Live local evidence

Premium catalog record:

- `_id`: `6ae851d69391bf20babb51f5`
- slug: `premium-nfc-card`
- active: `true`

Premium assignment:

- assignment: `6ae85874efc853c66c8a1129`
- user: `6ae85874efc853c66c8a10f3`
- card: `6ae85874efc853c66c8a1122`
- status: `active`
- card kind: `profile`
- public alias: present
- card active: `true`
- review source: `hybrid`

Live `GET /api/my/products/6ae85874efc853c66c8a1129` returned:

```json
{
  "review": {
    "eligible": true,
    "cardKind": "profile",
    "url": "/review/digital-mvz27lsbvf",
    "googleConfigured": true,
    "aiConfigured": false,
    "managementUrl": "/dashboard/review-management?cardId=6ae85874efc853c66c8a1122"
  }
}
```

`shouldShowPremiumReviewSection` therefore evaluates to `true`.

Live lower-tier comparison:

- Business NFC Card assignment: `6ae85874efc853c66c8a1104`
- API response: `review: null`
- Section correctly hidden because the product does not grant `review_ai_suggestions`.

---

## 5. Central Review Integration impact

Central ON does **not** hide the Premium review section.

Relevant behavior:

- `resolveEffectiveReviewSettings` resolves the Premium card’s hybrid source.
- `review-product-eligibility.ts` computes `eligible` independently of the central rollout flag.
- `shouldShowPremiumReviewSection` depends only on `eligible` and `cardKind`.
- The product-detail review block is built before/independent of the central “Use product settings” source controls.

Central ON does hide the **legacy source switch** (“Use product settings”) on connected products. That is a source-mode control, not an enable/disable review toggle, and it is not the missing Premium control.

Local force-all changes source resolution for legacy products but does not change Premium entitlement, `eligible`, or `cardKind`.

---

## 6. Frontend-to-backend flow

### Product detail

```text
Premium assignment
→ active UserProduct
→ catalog slug premium-nfc-card
→ capability review_ai_suggestions
→ getReviewProductForUser()
→ review.eligible = true
→ GET /api/my/products/[id] returns product.review
→ shouldShowPremiumReviewSection(true, profile)
→ Google Reviews card renders
→ "Review settings" / "Open review page" buttons
```

`src/app/api/my/products/[id]/route.ts` lines 211–242 build `review`.
`src/lib/services/review-ui.ts` lines 14–19 gate the section.
`src/app/(dashboard)/dashboard/products/[id]/page.tsx` lines 315–316 and 519–560 render it.

### Builder

```text
Premium card kind = profile
→ builder-shell.tsx lines 219–224 select profile TABS
→ REVIEW_TABS is only selected for kind = review
→ no Reviews tab
→ no ReviewManagementLinkTab
→ no toggle
```

### Review Management page

```text
Review product list API
→ Premium appears as eligible
→ row shows source/hybrid/central controls, Edit Link, Preview
→ no per-product enable Switch
```

---

## 7. Existing Premium assignments affected?

No entitlement loss.

The live existing Premium assignment is active and eligible. The product-detail page renders the review section. The existing assignment remains manageable through Review Management.

What is missing is only the per-product toggle UI, not the underlying entitlement or data.

New Premium assignments:

- `src/lib/services/user-product-assignment.ts` lines 196–202 set `reviewSettingsSource = 'central'` for newly provisioned review-capable products.
- The active assignment grants `review_ai_suggestions`.
- The same `review.eligible` path applies.
- No manual entitlement grant is required.

Lower-tier NFC cards remain excluded by product capability.

---

## 8. Affected files and exact lines

| File | Lines | Relevance |
|---|---:|---|
| `src/config/products.ts` | 123–140 | Premium definition; `review_ai_suggestions` at 135 |
| `src/config/products.ts` | 107–121 | Business NFC Card; no review capability |
| `src/lib/services/review-entitlement.ts` | 54–87 | Product-aware entitlement |
| `src/lib/services/review-product-eligibility.ts` | 133–164 | Product grant and eligibility |
| `src/lib/services/review-product-eligibility.ts` | 186–227 | Eligible product projection |
| `src/app/api/my/products/[id]/route.ts` | 211–242 | `review` API payload |
| `src/lib/services/review-ui.ts` | 14–19 | Section visibility rule |
| `src/app/(dashboard)/dashboard/products/[id]/page.tsx` | 315–316 | `reviewSection` computation |
| `src/app/(dashboard)/dashboard/products/[id]/page.tsx` | 519–560 | Google Reviews card; buttons only, no toggle |
| `src/components/review-management/product-settings-dialog.tsx` | 3–9, 155–165 | Orphaned per-Card “Enable reviews” toggle |
| `src/components/review-management/review-management-client.tsx` | 1048–1072 | Global Review availability switch |
| `src/components/review-management/review-management-client.tsx` | 1200–1300 | Product rows; no per-product toggle |
| `src/components/builder/builder-shell.tsx` | 145–160 | REVIEW_TABS with Reviews tab |
| `src/components/builder/builder-shell.tsx` | 219–224 | Tabs selected by `kind`; profile gets TABS |
| `src/components/builder/builder-shell.tsx` | 328–336 | Reviews tab renders link-only component |
| `src/components/builder/tabs/review-management-link-tab.tsx` | 15–64 | Link-only Review Management entry |
| `src/app/api/cards/[id]/review-entitlement/route.ts` | 25–36 | Entitlement API; returns correct product decision |
| `src/lib/services/user-product-assignment.ts` | 196–202 | New review-capable products start on central source |
| `src/lib/services/review-effective-settings.ts` | 30–60 | Central/hybrid effective settings |
| `src/lib/services/review-rollout.ts` | 130–190 | Rollout and local force-all source resolution |

---

## 9. Minimum recommended fix (not implemented)

The intended behavior/location must be confirmed first.

### Option A — Per-card toggle on Premium product detail

Add an explicit Review Management enable/disable control to the existing “Google Reviews” card at:

- `src/app/(dashboard)/dashboard/products/[id]/page.tsx` lines 519–560.

It should use the existing Review Management API rather than a new legacy path. Under Central ON, the control should likely write a **hybrid `reviewOverrides.enabled`** value or a central setting — not rewrite `Card.reviewAssistant` directly.

### Option B — Per-card toggle via `ProductSettingsDialog`

Mount the existing orphaned dialog and its “Enable reviews” switch. This is **not safe as-is** while Central is ON because the dialog writes legacy `Card.reviewAssistant` through `/api/cards/[id]`. It would need Central-aware behavior first.

### Option C — Builder Reviews tab for Premium/profile cards

Show a Reviews tab for profile-kind cards whose active product grants `review_ai_suggestions`. The existing `ReviewManagementLinkTab` is link-only and contains no toggle. This would provide access, not an enable/disable control.

### Option D — Global Review availability toggle

If the intended toggle is the central “Review availability” switch, it already exists at `review-management-client.tsx` lines 1048–1072 and is enabled locally. No fix is required; the user may be looking for it on the wrong page.

**Recommendation:** confirm whether the desired control is per-Premium-card enable/disable or simply a link/tab to Review Management. Do not implement until that is approved.

---

## 10. Backward-compatibility risks of any future fix

- Mounting `ProductSettingsDialog` as-is would write legacy `Card.reviewAssistant` values and could create a competing legacy configuration path while Central is ON.
- Adding a per-card toggle that writes central shared settings could unintentionally enable/disable reviews for all products.
- Adding a Reviews tab to all profile cards could expose review UI to lower-tier cards; it must be gated by `review_ai_suggestions`.
- Any toggle must preserve existing `reviewAssistant`, `reviewSettingsSource`, `reviewOverrides`, aliases, and public URLs.
- Central OFF behavior must remain exactly as before.

---

## 11. Tests performed and results

| Check | Result |
|---|---|
| Live Premium catalog/assignment/card inspection | PASS |
| Live Premium `GET /api/my/products/[id]` | PASS — `review.eligible = true`, `cardKind = profile` |
| Live lower-tier Business NFC Card API | PASS — `review: null` |
| Browser: Premium product detail | PASS — “Google Reviews” and “Review settings” visible; no toggle |
| Browser: Premium builder | PASS — no Reviews tab; no enable toggle |
| Browser: Review Management page | PASS — Premium row present; global Review availability toggle present; no per-product toggle |
| `scripts/test-phase3-hardening.ts` | **24/24 PASS** — includes premium review-section visibility rule |
| Existing `test-review-management.ts` (current working tree) | **58/58 PASS** in prior validation — covers Premium entitlement and lower-tier exclusion |
| Database writes during audit | **None** |

No migrations, seeds, resets, assignments, settings, Review Library, NFC/QR, or public URL changes were made.

---

## 12. Unresolved questions

1. Which exact UI location does the user mean by “Review Management toggle”?
   - Premium product-detail “Google Reviews” card?
   - Premium builder tab?
   - Review Management product row?
   - Global “Review availability” switch?
2. Should the control enable/disable reviews for **this Premium card only** or for the business’s shared central settings?
3. Under Central ON, should the control write a hybrid product override, central settings, or only navigate to Review Management?
4. Should Premium/profile cards receive a Reviews builder tab even though their card kind is `profile`?
5. Is the orphaned `ProductSettingsDialog` intended to be restored, replaced, or deleted later?

**No fix has been implemented. Awaiting approval.**
