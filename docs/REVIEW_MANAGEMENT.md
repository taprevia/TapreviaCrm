# Review Management — Phase 4D.2 Backend

This document describes the central Review Management backend added in Phase 4D.2.
It does not describe the Phase 4D.3 UI, product opt-in (4D.4), or public review
generation integration.

## 1. ReviewSettings schema

`src/models/ReviewSettings.ts`

- One document per business: `businessId = User._id` (unique).
- `schemaVersion: 1`.
- `general`:
  - `enabled` boolean, default false.
  - `googleReviewUrl` string, default empty; empty or valid http(s), max 2048, no embedded credentials.
  - `welcomeMessage` string, max 500.
- `content`:
  - `category` string, max 60.
  - `languages` string[], max 12, each 1–40, unique, order preserved.
  - `writingStyle`: friendly / professional / casual / simple.
  - `preferredLength`: short / medium / detailed.
  - `styleMode`: fixed / varied.
  - `lengthMode`: fixed / varied.
  - `feedbackTopics`, `services`, `employees`, `keywords`: each max 12, each 1–50, unique.
- `updatedBy` required User reference.
- Timestamps.
- No automatic document creation on GET. No migration.
- An enabled document must contain at least one language.
- No production index is created by this repository. If the model is deployed,
  the unique `businessId` index must be created through the approved maintenance
  procedure before relying on duplicate protection.

## 2. Smart dropdown architecture

`src/lib/services/review-management-options.ts` reads the existing Admin Review
Library. It never writes categories, scenarios, templates, languages or
keywords.

`GET /api/review-management/options` returns:

- Active categories with stable key, label, active status, supported languages
  and active-template scenario count.
- Selected category details.
- Supported languages from active ReviewTemplate rows (not invented values).
- Category scenarios (`key` + human label) for feedback-topic suggestions.
- Suggested keywords from `ReviewTemplate.compatibleKeywords`.
- Writing styles, review lengths, style modes and length modes.
- Empty `suggestedServices` / `suggestedEmployees` until a reliable structured
  source exists.

Bound values: categories 200; templates scanned 5,000; languages/keywords 60
each; scenarios come from the category (max 50 by model validation).

## 3. Category / scenario / language mapping

- Category keys and scenario keys are the stable identifiers managed by the
  Admin Review Library.
- `feedbackTopics` in central settings remains `string[]` for compatibility with
  the existing Card contract. The suggested topic **label** is what should be
  persisted; the scenario `key` is a stable UI identifier.
- Languages come from active templates. The first selected language is the
  effective default; no separate `defaultLanguage` field exists.
- Previously saved inactive categories or unsupported legacy languages are
  preserved by PATCH unless the caller explicitly changes them.
- New language selections must be supported by the selected active category
  (or by the whole active library when no category is selected).

## 4. Custom business fields

- Services and employees are business-supplied custom tags. The backend does
  not invent names.
- Keywords can be suggested from structured `compatibleKeywords` or entered
  manually.
- Keywords are contextual preferences only; they are never required in every
  review and are not inserted automatically.
- Feedback topics can be selected from category scenarios or entered manually.

## 5. Fixed/varied preference semantics

`styleMode` and `lengthMode` are separate fields:

- `fixed` means the existing `writingStyle` / `preferredLength` is the single
  preference.
- `varied` is a stored preference only in Phase 4D.2. It does not change public
  generation, does not add randomness to the resolver, and does not alter the
  existing enums.

A future approved generation phase may choose among supported styles/lengths
when `varied` is set, while preserving customer input, honesty and manual
editing. No such selection is implemented here.

## 6. Settings API contracts

### `GET /api/review-management`

- Authentication required.
- `review_ai_suggestions` capability required.
- Business ID is derived from the session.
- Returns `{ saved, schemaVersion, settings, updatedAt? }`.
- If no document exists, returns `saved: false` with system defaults.
- Never creates a document.

### `PATCH /api/review-management`

- Authentication, capability, CSRF (middleware) and strict validation required.
- Body: `{ general?: {...}, content?: {...} }` only.
- Unknown fields, `schemaVersion`, `businessId`, `_id` and prototype-pollution
  keys are rejected.
- Partial updates preserve unspecified fields.
- Concurrent updates use `__v` optimistic concurrency with bounded retries.
- Duplicate first-time creation is retried as an update.
- Never writes `Card.reviewAssistant`, Card source fields, or rotation state.

## 7. Options API contract

`GET /api/review-management/options[?category=<key>]`

- Authentication + `review_ai_suggestions`.
- Optional category must be an active Review Library category.
- Returns bounded, stable-key option data.
- Does not expose template text, usage counts or other private library internals.
- Does not mutate the library.

## 8. Authentication and entitlement checks

- Session cookie is verified by the existing auth layer.
- `requireApiEntitlement(..., 'review_ai_suggestions')` provides 401/403
  distinction and admin bypass consistent with existing APIs.
- Cross-tenant access is prevented by querying `UserProduct`/`ReviewSettings`
  with the authenticated user ID.
- CSRF protection is inherited from the global middleware for cookie-authed
  mutations.

## 9. Product eligibility

`src/lib/services/review-product-eligibility.ts`

- Active assignments only.
- Card-backed host only.
- Card must be owned by the business, active, and have a public alias.
- Account must hold `review_ai_suggestions`.
- Google Review Card / NFC Plate grant the capability in the product catalog.
- Premium NFC Card does not grant it by itself; it is eligible only when the
  account separately holds review capability. Existing locked behavior is
  preserved.
- Google Review Standee is excluded from the Card-backed connected-products
  list because it has no Card review host.
- Missing cards, removed assignments and cross-tenant requests are excluded or
  denied.
- No product names are used as entitlement shortcuts.

## 10. Legacy fallback

`src/lib/services/review-settings-resolver.ts`

- Missing `reviewSettingsSource` = legacy.
- Legacy uses `Card.reviewAssistant` and existing defaults.
- Central uses valid central settings + defaults.
- Hybrid uses product overrides, then central values, then defaults.
- Invalid central/hybrid configuration falls back to the complete legacy
  configuration.
- The resolver is pure, deterministic and DB-free. It does not infer
  entitlement, migrate data, mutate cards or add randomness.
- `styleMode` / `lengthMode` are metadata only; effective style/length enums are
  unchanged.

## 11. Future opt-in behavior (design only)

`PATCH /api/review-management/products/[assignmentId]` is intentionally not
implemented in Phase 4D.2. Future work must:

- require ownership, review entitlement, explicit confirmation and audit;
- support legacy → central, legacy → hybrid and disconnect back to legacy;
- support validated product overrides;
- preserve the old `card.reviewAssistant` as rollback data;
- never auto-migrate or auto-enable a product;
- never change rotation state.

## 12. Phase 4D.3 UI requirements

The future UI should:

- use only the options API for categories/scenarios/languages/keywords;
- show saved vs unsaved defaults;
- preserve inactive saved categories as read-only/legacy values;
- treat first language as default;
- present fixed/varied modes without changing the style/length enums;
- show connected products from the read-only products API;
- use the preview API for effective settings;
- not expose rotation data;
- not connect products or activate central settings.

## 13. Phase 4D.4 integration requirements

Before public generation consumes central settings:

- approve product connection and migration behavior;
- add explicit product source/opt-in controls;
- test legacy/central/hybrid cards with real synthetic data;
- verify entitlement and Premium behavior;
- preserve Card.reviewAssistant as fallback;
- add security/regression coverage;
- keep rotation separate and feature-gated;
- never auto-enable the Review Assistant.

## 14. Rollback strategy

- Set `reviewSettingsSource` back to `legacy` (or remove it) and the resolver
  returns existing `Card.reviewAssistant`.
- Central settings documents are additive and can remain without being read.
- No Card data is overwritten by central PATCH; no migration to reverse.
- Feature flags remain OFF by default.
- No production index is created automatically.

## 15. Local testing and production prerequisites

Local tests use disposable synthetic MongoDB databases. Production requires:

1. Approved creation of the `reviewsettings.businessId` unique index (and the
   existing rotation indexes if rotation is ever activated).
2. Explicit approval before enabling any UI or public-generation integration.
3. Both Phase 4D.1 flags off unless separately approved.
4. A review of actual legacy/central data distribution using read-only queries.

## 16. Phase 4D.3 business UI

Implemented at `/dashboard/review-management`, guarded server-side by
`review_ai_suggestions` and listed in the customer navigation as
**Review Management**.

The UI contains exactly two main tabs:

1. **General Settings** — assistant status, Google Review destination,
   welcome message, connected review products, and current-product preview.
2. **Content & Personalization** — category, languages, writing style and
   mode, review length and mode, feedback topics, services, employees and
   keywords.

Important behavior:

- Opening the page never creates a `ReviewSettings` document.
- Save sends only changed fields to `PATCH /api/review-management`.
- Unrelated saved settings are preserved.
- Existing inactive categories and unsupported saved languages are displayed
  as saved values and are not silently deleted.
- Category changes fetch new suggestions without clearing custom topics,
  services, employees or keywords.
- No product connection, disconnection or override controls are shown because
  that API does not exist yet.
- The preview panel is explicitly labelled **Current Product Settings
  Preview**; it shows active product settings, not unsaved central draft state.
- Premium NFC Card access remains governed by the current backend entitlement;
  the UI does not fake or bypass it.
- `styleMode`/`lengthMode` are presented as future variation preferences and
  are not claimed to be active in public generation.
- The page does not activate the Review Assistant on any product and does not
  touch Smart Review Rotation.

## 17. Phase 4D.4 — Premium entitlement, product connection and public gate

### Premium NFC policy

`PREMIUM_NFC_CARD` now grants `review_ai_suggestions` through the existing
product-capability registry. Existing and new Premium assignments inherit the
grant from the stable catalog slug; no Card data backfill or migration is
required.

Account capability and Card capability are deliberately separate:

- account may access Review Management;
- product must grant `review_ai_suggestions`;
- Card must be an active, owned, Card-backed host;
- Card source determines legacy/central/hybrid settings;
- Card `reviewAssistant.enabled` determines publication.

A lower-tier Card owned by a Premium account does **not** inherit review
access. Cards with no `UserProduct` assignment at all retain the legacy
account-level fallback for backward compatibility; cards with any assignment
are evaluated strictly by their active product.

### Product connection

`PATCH /api/review-management/products/[assignmentId]`

Body:
```json
{
  "source": "legacy | central | hybrid",
  "revision": 0,
  "overrides": {}
}
```

- `legacy` restores the existing `Card.reviewAssistant` behavior.
- `central` uses saved central ReviewSettings.
- `hybrid` uses central settings plus validated product overrides.
- `overrides` is valid only for hybrid and contains optional review fields.
- `revision` is the Card's `reviewSettingsVersion`; stale revisions return 409.
- Connection requires active product-level review capability, ownership,
  active Card, public alias, and saved central settings for central/hybrid.
- The endpoint writes only `reviewSettingsSource`, `reviewSettingsVersion`,
  `reviewOverrides`, `reviewSettingsUpdatedAt`, `reviewSettingsUpdatedBy`.
- It never writes `Card.reviewAssistant`, aliases, URLs, rotation data or
  central settings.
- Returning to legacy unsets overrides and preserves the exact legacy settings.

The Review Management product list exposes functional source controls. Central
and legacy changes require confirmation; hybrid opens the complete override
dialog (status, destination, welcome message, category, languages, style/style
mode, length/length mode, feedback topics, services, employees and keywords).
Successful changes refresh the product list and current preview without
discarding the central draft.

### Public integration gate

`CENTRAL_REVIEW_PUBLIC_INTEGRATION_ENABLED=false` by default.

- OFF: public review page/API reads remain strictly legacy, even for Cards
  whose source is central/hybrid.
- ON: effective settings use the existing pure resolver.
- Missing/invalid central settings fall back to complete legacy settings.
- This flag is independent from the copy-flow and Smart Review Rotation flags.

### Personalization and variation

The public review pipeline now consumes effective central category, languages,
writing style/length, feedback topics, services, employees, keywords, welcome
message and Google destination.

`styleMode`/`lengthMode=varied` is applied in the generation layer, not the
resolver. Selection is deterministic by UTC day and testable via an injected
`now`. An explicit customer length choice always wins. Existing style/length
enums are unchanged. Customer words remain the source of truth; no experiences,
employees, services, positive sentiment or publication claims are fabricated.

### Mobile-first

The Review Management UI uses mobile-first stacking, wrapping chips, full-width
source controls, responsive tabs and a scrollable confirmation modal. Headless
Chrome viewport checks were run at 320, 375, 390, 430, 768, 1024 and 1440 px in
dark and light emulation; no horizontal overflow or missing controls were found.
The hybrid modal was also checked at 320 px.

### Concurrency

Settings GET/PATCH now expose an additive `revision` token (the existing `__v`
as a string). The UI sends it on save. A stale revision returns 409 and offers a
**Reload latest values** action. Clients that omit `revision` retain the prior
partial-update behavior. Internal database version details are not displayed.

### Standee limitation (superseded by Phase 4D.6)

Phases 4D.4–4D.5 deliberately excluded Google Review Standee because it had no
Card-backed review host. Phase 4D.6 adds a **dedicated Standee host** behind
`STANDEE_REVIEW_ASSISTANT_ENABLED`; it does not create a fake Card or alias.
The historical Card-product connection contract remains unchanged.

### Production prerequisites

- Do not enable `CENTRAL_REVIEW_PUBLIC_INTEGRATION_ENABLED` without approval.
- Create the `reviewsettings.businessId` unique index through the approved
  maintenance procedure before relying on saved central settings.
- Keep `NEW_REVIEW_COPY_FLOW_ENABLED` and `SMART_REVIEW_ROTATION_ENABLED` OFF
  unless separately approved.
- Complete real-device/browser QA and product approval for hybrid override
  editing before broad rollout.


## 18. Phase 4D.5 — security hardening, complete hybrid UI and release evidence

### 18.1 Zero-assignment entitlement decision table

Account capability, product capability, Card capability, Card ownership, public
host eligibility and connection state remain separate checks.

| Card state | Active assignment | Card kind | Legacy enabled | Result | Source |
|---|---|---|---|---|---|
| Active Premium assignment | Premium NFC | any | any | Allowed | `product` |
| Active lower-tier assignment | Business NFC | profile/social | any | Denied | `none` |
| Removed/inactive assignment | removed/inactive | any | any | Denied | `none` |
| No assignment, review host | none | `review` | any | Allowed | `legacy-review-host` |
| No assignment, already enabled | none | profile/social | `true` | Preserved | `legacy-preserved` |
| No assignment, not enabled | none | profile/social | `false` | Denied | `none` |
| No assignment, no capability | none | any | any | Denied | `none` |
| Missing/unknown product metadata | none/unknown | profile | `false` | Denied | `none` |
| Missing/unknown product metadata | none/unknown | profile | `true` | Preserved | `legacy-preserved` |

The security fix blocks **new** Review Assistant enablement on an ambiguous
zero-assignment profile/social Card. It deliberately does **not** revoke an
already-working legacy configuration. A zero-assignment, already-enabled
profile Card cannot be proven from existing data to have been Premium or
lower-tier; it is preserved for backward compatibility. A production audit and
explicit approval are required before any stricter revocation or allowlist.

### 18.2 Premium catalog identity

- Canonical identity is derived from the product ID, not the display name:
  `PREMIUM_NFC_CARD` → `premium-nfc-card`.
- `scripts/seed.ts` stores that canonical slug on `CatalogProduct`.
- The human `publicSlug` (`premium-card`) is a URL path only and never grants
  entitlement.
- `premium-card`, an unknown slug, or a lower-tier slug with the display name
  “Premium NFC Card” does not grant review capability.
- Existing and new active Premium assignments resolve identically without a
  backfill.

Production verification requirement (read-only, separately approved): confirm
that every production catalog record representing the Premium NFC product
stores `slug: "premium-nfc-card"`. If historical variant slugs exist, stop and
document an explicit mapping; do not guess identifiers.

### 18.3 Complete hybrid override contract

Supported overrides are exactly:

`enabled`, `googleReviewUrl`, `welcomeMessage`, `category`, `languages`,
`writingStyle`, `styleMode`, `preferredLength`, `lengthMode`, `feedbackTopics`,
`services`, `employees`, `keywords`.

The UI exposes every field with an explicit **Override** toggle:

- Unchecked = inherit central (the field is omitted from the saved override).
- Checked = persist the explicit value, including an intentionally empty value.
- Unchecking an existing override removes it and returns to central.
- Only explicitly overridden fields are sent.
- Existing known overrides are loaded into the dialog and round-trip unchanged.
- Unknown/legacy override keys are preserved server-side by path-level writes.
- A saved inactive category or unsupported language is preserved when it is
  resubmitted unchanged; a newly introduced invalid value is rejected.
- The dialog includes an effective-settings preview, validation, save loading
  state, unsaved-changes confirmation, category search, category-aware
  languages, topic suggestions, tag inputs and a sticky mobile footer.

### 18.4 Mobile-first verification — 4D.5

Headless Chrome, final build, synthetic local data:

- 320, 375, 390, 430, 768, 1024 and 1440 px × dark/light emulation = **14/14
  PASS**.
- No horizontal page or dialog overflow; the hybrid dialog fits at every width.
- All 14 field groups and the effective preview are present.
- Footer height is 40 px at every width; Save/Cancel remain reachable.
- 320 px interaction checks PASS: existing overrides load, welcome preview
  updates, invalid URL blocks save, category search works, language selection
  works, keyword tags work, sticky footer stays visible, last preview rows clear
  the footer, and discard confirmation works.
- The dashboard shell is dark-first; light emulation was exercised for
  compatibility but there is no separate light dashboard theme.
- Physical smartphone, touch and screen-reader testing: **NOT TESTED**.

### 18.5 Security and concurrency results

- Authentication: unauthenticated settings/product writes return 401; expired
  tokens are denied by middleware with a login redirect (307).
- CSRF: missing/foreign Origin returns 403.
- Oversized bodies (70 KB) return 413 before parsing.
- Invalid JSON, unknown fields, prototype-pollution keys, invalid source,
  override type, URL, language/topic arrays and revision types return 400.
- Cross-tenant assignments return 404; lower-tier Cards return 403; removed
  assignments return 404; deleted Cards/missing hosts return 404/400.
- Parallel settings writes with the same revision: one 200, one 409; no lost
  field writes. Revision-less legacy clients still apply both partial patches.
- Parallel product connections: one 200, one 409; no partial Card state.
- Parallel hybrid override updates: one complete winner, no field merging.
- New settings documents advance the revision atomically to `1`.
- Retry after a conflict succeeds with the refreshed revision.

### 18.6 Test evidence

- `npx tsx scripts/test-review-management.ts` (new full suite): **54/54 PASS**
  with `CENTRAL_REVIEW_PUBLIC_INTEGRATION_ENABLED=false` and **54/54 PASS** with
  it `true`.
- Copy-flow × rotation × integration matrix: **8/8 combinations, 48/48 checks
  PASS**.
- Typecheck, lint and production builds with flags OFF/ON: PASS.
- Security boundaries, Review Library import (13/13), entitlement (130/130),
  Review Library (48/48), card binding (49/49), VCF (69/69), QR PDF: PASS.
- Tests that require physical hardware, a real clipboard, a real Google
  navigation or a screen reader remain **NOT TESTED**.

### 18.7 Production index plan (READ ONLY — not applied)

Required indexes:

| Collection | Keys | Options |
|---|---|---|
| `reviewsettings` | `{ businessId: 1 }` | unique, name `businessId_1` |
| `reviewrotationevents` | `{ businessId: 1, categoryKey: 1, templateId: 1, cycle: 1 }` | unique |
| `reviewrotationevents` | `{ copyId: 1 }` | unique, name `copyId_1` |
| `reviewrotationevents` | `{ businessId: 1, categoryKey: 1, copiedAt: -1 }` | non-unique |
| `reviewrotationstates` | `{ businessId: 1, categoryKey: 1 }` | unique |

No new product-connection index is required; existing `UserProduct` indexes
cover assignment ownership lookups.

Preflight (authorized operator only, read-only):

```js
db.reviewsettings.aggregate([
  { $group: { _id: '$businessId', count: { $sum: 1 } } },
  { $match: { count: { $gt: 1 } } },
]);
db.reviewrotationevents.aggregate([
  { $group: { _id: {
      businessId: '$businessId', categoryKey: '$categoryKey',
      templateId: '$templateId', cycle: '$cycle' }, count: { $sum: 1 } } },
  { $match: { count: { $gt: 1 } } },
]);
db.reviewrotationevents.aggregate([
  { $group: { _id: '$copyId', count: { $sum: 1 } } },
  { $match: { count: { $gt: 1 } } },
]);
db.reviewrotationstates.aggregate([
  { $group: { _id: {
      businessId: '$businessId', categoryKey: '$categoryKey' }, count: { $sum: 1 } } },
  { $match: { count: { $gt: 1 } } },
]);
```

Any duplicate blocks the unique index. Do not delete or merge customer data
without explicit approval; report the conflicting records instead.

Creation must run in the approved maintenance window (application startup does
not create production indexes). Verify with:

```js
db.reviewsettings.getIndexes();
db.reviewrotationevents.getIndexes();
db.reviewrotationstates.getIndexes();
```

Operational risks: index build time on large collections, write latency during
build, duplicate-data failure, and rotation/copy downtime if the window is not
coordinated. Rollback is limited to dropping only the newly created indexes; no
data is mutated by index creation.

Activation order:

1. Deploy code with all three review flags OFF.
2. Create and verify the indexes.
3. Run post-deploy smoke tests with flags OFF.
4. Enable `CENTRAL_REVIEW_PUBLIC_INTEGRATION_ENABLED` only after approval.
5. Enable copy flow/rotation separately, only after their prerequisites and QA.
6. Monitor 5xx/409/E11000 rates, public review errors, fallback-source spikes,
   latency and copy-event recording; roll back the relevant flag on regression.

### 18.8 Outstanding limitations

- Production indexes are not created; activation remains blocked.
- Real-device touch/keyboard/screen-reader QA is not complete.
- Zero-assignment enabled profile Cards require a production audit before any
  stricter revocation policy.
- Production catalog slug verification is required.
- The hybrid UI edits all supported fields but intentionally does not expose
  unknown/legacy override keys; those are preserved server-side.
- Google Review Standee still has no Card-backed review host; no fake host is
  created.
- The dashboard remains dark-first; a separate light dashboard theme is not part
  of this phase.


## 19. Phase 4D.6 — Google Review Standee AI Review Assistant

### 19.1 Architecture finding

- The Google Review Standee is a `Standee` document, not a Card and not a
  `/review/[alias]` host.
- Its Google destination lives on the `google_review` slot
  (`socialQrs[].destinationUrl`), with a legacy `Profile.socialLinks` fallback.
- Taprevia-generated QR payloads point to controlled routes:
  - panel: `/r/{routeSlug}` or legacy `/qr/{panelQr.qrId}`;
  - Google slot: `/r/{routeSlug}/{slot}` or legacy `/qr/{socialQr.qrId}`.
- Therefore existing printed Taprevia QR codes can reach the new host without
  reprinting. Each route keeps resolving dynamically.
- A QR code that directly encodes an external Google URL (for example, a
  third-party or manually generated code) cannot be changed remotely. No
  silent rewrite is possible; those customers need a separately approved
  reprint/opt-in path.

### 19.2 Entitlement

`GOOGLE_REVIEW_STANDEE` already grants `review_ai_suggestions`. 4D.6 keeps that
canonical product identity and requires:

- an active `UserProduct` assignment for the Standee;
- canonical `google-review-standee` product slug;
- owner not suspended;
- a safe Google Review destination;
- `STANDEE_REVIEW_ASSISTANT_ENABLED=true` for public hosting.

It does not infer entitlement from display names, does not create a Card, and
does not unlock lower-tier Cards.

### 19.3 Public host

`/standee-review/{routeSlug}` (or the Standee `uid`):

- opaque route identifier already issued at assignment time;
- resolves the active assignment and owner;
- serves the shared `ReviewAssistantFlow` engine;
- returns a neutral unavailable state for gate OFF, removed/inactive ownership,
  suspended owners, unknown products, missing Google URLs, or disabled effective
  settings;
- logs page-view/suggestion/generation analytics with `standeeId`, never review
  text or tokens.

When the gate is ON:

- `/r/{routeSlug}` for a single-profile Google Review Standee goes to the host;
- `/r/{routeSlug}/{slot}` goes to the host for the `google_review` slot;
- legacy `/qr/{qrId}` for the Google slot or panel goes to the host;
- multi-profile/all-in-one Standees and non-Google Standees keep their existing
  behavior.

When the gate is OFF, none of the above changes: the original Google/profile/
panel redirects are byte-for-byte behavior-equivalent.

### 19.4 Settings and Google URL preservation

The Standee has additive optional `reviewSettingsSource`,
`reviewSettingsVersion`, `reviewOverrides` and audit fields. There is no
Card-backed legacy configuration.

Initial strategy:

- explicit Standee source wins;
- otherwise use saved Central Settings when available;
- otherwise use Standee product settings (safe defaults + the Standee's own
  Google URL).

The Standee's own Google destination is authoritative in every source. Central
Settings never replaces it. Only an explicit hybrid `googleReviewUrl` override
may replace it. Switching back to central/legacy restores the Standee URL.

Public central/hybrid resolution honors
`CENTRAL_REVIEW_PUBLIC_INTEGRATION_ENABLED`. Management and preview can still
show configured central content while that public gate is OFF.

The Review Management product list now includes eligible Standees with
`instanceType='standee'`, source, revision, overrides, destination status,
preview link and `hostingEnabled`. Legacy source is labelled “Use Standee
Settings”. The full hybrid dialog works for Standees; the inherited destination
is the Standee URL.

### 19.5 Rotation, copy events and analytics

- Suggestions use the existing Review Library, category/language selection,
  business rotation state and signed tokens.
- Standee tokens add optional `hostType='standee'` / `hostId` claims. Legacy
  Card tokens have no host claim and remain Card-scoped.
- Card copy endpoints reject Standee tokens; Standee copy endpoints require a
  matching Standee token.
- Copy events use the existing business/category/template/cycle and copyId
  idempotency. `standeeId` is additive/optional; `cardId` is null for Standee
  events. Historical Card records are unchanged and readable.
- Manual customer copy does not consume smart rotation.
- Analytics rows use the additive optional `standeeId` column; no visitor text
  is stored.

### 19.6 Feature gates

- `STANDEE_REVIEW_ASSISTANT_ENABLED=false` (new, default OFF).
- `NEW_REVIEW_COPY_FLOW_ENABLED=false`.
- `SMART_REVIEW_ROTATION_ENABLED=false`.
- `CENTRAL_REVIEW_PUBLIC_INTEGRATION_ENABLED=false`.

All combinations were exercised; Gate OFF preserves the original Standee
destinations, Gate ON activates only eligible hosts.

### 19.7 Verification evidence

- Standee suite `scripts/test-standee-review.ts`: **20/20 PASS** in four
  configurations:
  - Standee OFF / central OFF;
  - Standee ON / central OFF;
  - Standee ON / central ON;
  - Standee ON / central ON / copy + rotation ON.
- Redirects, public suggestions/copy/AI orchestration, host-scoped rotation
  tokens, cross-host token rejection, concurrent copies, management connection,
  stale revisions, CSRF/oversized/prototype checks, URL preservation and
  historical template/rotation preservation are covered.
- Existing Review Management suite: rerun in both central-gate modes.
- Browser viewport and manual-copy checks are recorded in the final 4D.6 report.

### 19.8 Production plan (READ ONLY — not applied)

Required additive index:

```javascript
db.analyticslogs.createIndex({ standeeId: 1, timestamp: -1 });
```

Existing review settings/rotation indexes from §18.7 remain required. No new
unique public-identifier or Standee index is required.

Activation order:

1. Deploy code with all flags OFF.
2. Create/verify indexes.
3. Smoke test Standee OFF behavior: `/r/{routeSlug}` and `/qr/{qrId}` still hit
   the original Google/profile destination.
4. Enable `STANDEE_REVIEW_ASSISTANT_ENABLED` for approved accounts/regions only
   if a staged rollout is required; otherwise enable after approval.
5. Enable central/copy/rotation gates independently only after their own QA.
6. Post-activation: verify `/r/` and `/qr/` 307 to `/standee-review/...`,
   suggestions/copy, AI availability, Google CTA, analytics and historical
   templates/rotation events.
7. Rollback: set `STANDEE_REVIEW_ASSISTANT_ENABLED=false`. Routing immediately
   returns to the original destinations; no data rewrite is needed.

Monitoring: host 5xx, redirect 5xx, suggestion/copy failure rates, 409 token
storms, analytics write errors, unexpected route destinations, and any increase
in missing-Google-URL standees.

### 19.9 Limitations

- Direct-external-Google QR codes cannot be redirected without a reprint.
- The host is behind an OFF-by-default gate.
- Real-device/screen-reader QA remains required.
- Production index creation and activation remain unauthorized.
- Standee analytics display in the legacy card-centric analytics dashboard may
  not surface standee rows yet; the rows are correctly attributed via
  `standeeId`.

## 20. Phase 4D.7 — Unified Review Analytics

### 20.1 Architecture finding

- The legacy `/dashboard/analytics` API is target-scoped (`cardId` or
  `standeeId`) and reads `AnalyticsLog` only.
- Card review events use `cardId`. Standee review events use the additive
  `standeeId`. Standee client tracking previously failed because
  `/api/public/track` resolved Cards only; 4D.7 resolves an opaque Standee
  routeSlug/uid when no Card matches, preserving Card-first behavior.
- Successful rotation/template copies are audited in `ReviewRotationEvent`.
  Manual copies are not rotation events. Therefore rotation events are a
  **separate rotation metric**, never added to total copy counts.
- `AnalyticsLog.review_copied` is the canonical copy metric. New events carry
  `metadata.source='ai'|'manual'`; historical rows without a source remain in
  the total and are reported as unclassified. No backfill.
- The Standee public page logs `review_page_view` server-side; the client page
  view tracker is disabled for that host to prevent double counting. Card page
  views continue through the existing client tracker.

### 20.2 Metric definitions

| Metric | Canonical source | Definition |
|---|---|---|
| Review Assistant visits | `AnalyticsLog.review_page_view` | Public review-host page views with a Card or Standee id |
| AI reviews copied | `AnalyticsLog.review_copied` with `metadata.source='ai'` | Successfully copied AI/template drafts |
| Manual reviews copied | `AnalyticsLog.review_copied` with `metadata.source='manual'` | Successfully copied customer-written drafts |
| Total reviews copied | all `AnalyticsLog.review_copied` | AI + manual + historical unclassified |
| Unclassified copies | `review_copied` without a valid source | Historical rows only; never fabricated into AI/manual |
| Rotation template copies | `ReviewRotationEvent` in range | Separate rotation audit metric; not added to total copies |

A copied review is **not** a posted Google review. No “posted” or “published”
metric is shown.

### 20.3 API

`GET /api/review-management/analytics?range=7d|30d|90d&host=all|card:<id>|standee:<id>`

- Authenticated with `review_ai_suggestions`.
- Host IDs are resolved from the authenticated business's own Cards/Standees.
  Cross-tenant host filters return 400.
- No client `businessId` is accepted.
- Date ranges are bounded to 366 days; invalid filters/ranges return 400.
- Returns totals, a daily series, and product-level rows. Product options remain
  stable across a host filter; all review-capable or historically active hosts
  are included.
- Inactive/removed hosts with historical activity remain attributable when the
  host document still exists. Deleted hosts cannot be attributed.
- Existing `/api/analytics` Card/Standee contracts are unchanged.

### 20.4 UI

A third **Review Analytics** tab in Review Management provides:

- Review Assistant visits, AI copies, manual copies, total copies and separate
  rotation template copies.
- 7/30/90-day range and product filter.
- Daily visits/copies trends.
- Product activity breakdown with active/historical labels.
- Accurate empty, loading and error states.
- Mobile-first stacking and accessible labels/roles; no global style changes.

### 20.5 Copy-tracking hardening

- `/api/public/track` resolves Card first, then Standee; Card analytics is
  unchanged.
- New copy events carry an explicit AI/manual source from the shared review
  component.
- Rapid duplicate copy clicks and “Copy” → “Continue to Google” for the same
  draft are deduplicated client-side (5-second same-text guard) and guarded by
  an in-flight copy lock. Failed clipboard attempts are never recorded.
- Rotation copy idempotency remains server-side and independent.

### 20.6 Verification evidence

- `scripts/test-review-analytics.ts`: **9/9 PASS** covering canonical totals,
  AI/manual/unclassified counts, rotation separation, 7/30/90 ranges, product
  filters, historical inactive/removed hosts, tenant isolation, legacy
  `/api/analytics` contracts, Standee tracking, four-product public hosts,
  copy idempotency, and deterministic AI success/empty/provider-failure paths.
- Analytics UI: 14/14 viewport/theme rows, product filter, 7/90-day ranges,
  keyboard radio navigation, tab focus, charts, no horizontal overflow.
- Four review products: 56/56 viewport/theme rows; manual clipboard success on
  all four; double-click produced exactly one copy event per host; Google
  destination/link correct; failure path produced no copy event and no false
  success. Copy-flow ON produced both buttons, correct clipboard and captured
  Google destination for all four products.
- Existing 4D.5/4D.6 suites and the 16-combination flag matrix are rerun after
  the final code:
  - 4D.5 Review Management: 56/56 with central gate OFF and ON.
  - 4D.6 Standee: 20/20 in four gate configurations.
  - Feature matrix: 16 combinations × 9 checks = 144/144.
- Automated accessibility checks: analytics tablist/tabpanel/radiogroup/select
  labels, chart role/label, keyboard focus; review feedback label/describedby,
  draft label, copy/Google accessible names. Contrast measured: analytics
  metric 14.63:1, secondary label 5.71:1. Real screen-reader/device QA is NOT
  TESTED.

### 20.7 Production indexes (READ ONLY — not applied)

```javascript
// Unified review analytics filters
db.analyticslogs.createIndex({ cardId: 1, action: 1, createdAt: -1 });
db.analyticslogs.createIndex({ standeeId: 1, action: 1, createdAt: -1 });

// Business-wide rotation analytics
db.reviewrotationevents.createIndex({ businessId: 1, copiedAt: -1 });
```

Existing review settings/rotation/AnalyticsLog `standeeId` indexes remain
required. No data migration is required. Production activation remains blocked
on the prior index/QA/approval prerequisites.

### 20.8 Limitations

- Deleted host documents cannot be attributed; historical event rows remain
  stored but are not shown without an owned host.
- Pre-4D.7 Standee copies exist only in rotation events and are shown as
  rotation activity, not total copies. Historical Card `review_copied` rows
  without a source are shown as unclassified.
- Live OpenAI provider verification and physical screen-reader/device QA are
  NOT TESTED.
- Actual external Google navigation is not performed in automated tests;
  destination/link correctness is verified.

## 21. Phase 4D.9 — final local release gate

- Complete **16-combination × 12-check matrix = 192/192**, executed twice
  (before and after the final concurrency fix). Harness:
  `scripts/test-phase4d9-matrix.ts`.
- The matrix verifies Card/Standee hosts, Google destinations, entitlements,
  lower-tier restriction, legacy/central/hybrid resolution, copy flow, rotation
  dependency, analytics, tenant isolation, `/r/` + `/qr/` routing and rollback
  invariants for every flag combination.
- Concurrent same-UID assignment was reproducible; a post-insert reconciliation
  now keeps exactly one active record (201/409). See
  `docs/PHASE_4D.9_FINAL_LOCAL_RELEASE_GATE.md` §11.
- Deleted-host `AnalyticsLog` events cannot be attributed (no persisted
  `businessId`); raw events remain, totals exclude them, rotation totals retain
  business attribution. No backfill or inference was performed.
- 4D.9 regression: typecheck/lint, builds OFF/ON, 4D.5 112/112, 4D.6 80/80,
  analytics 9/9, historical 9/9, security PASS, entitlement 130/130, Review
  Library 48/48, import 13/13, card binding 49/49, dynamic 29/29, Standee
  lifecycle 24/24, VCF 69/69, QR PDF PASS, `git diff --check` clean.
