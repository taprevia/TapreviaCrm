# Taprevia — Central Review Management & Permanent URL Architecture Audit

**Date:** 2026-11-04  
**Branch:** `Devlopment`  
**HEAD:** `0191bc1889c95e5716afa2f8f67a991ac131c101`  
**Mode:** Strict read-only audit  
**Final status:** **AUDIT COMPLETE — NO IMPLEMENTATION**

---

## 1. Executive Summary

### Central Review Management

Taprevia currently has a working central `ReviewSettings` document per business, but it is **not yet the single authority** for every eligible product.

- `ReviewSettings` can be authoritative when `reviewSettingsSource` is `central` or `hybrid`.
- `legacy` and unset products continue to use card/standee review data.
- `hybrid` products can override central content through `reviewOverrides`.
- A central gate (`CENTRAL_REVIEW_PUBLIC_INTEGRATION_ENABLED` plus rollout policy) also controls public reads.

Requirement A is therefore a **resolver/precedence and UI/API simplification**, not merely a UI change. Existing stored overrides and legacy values must be preserved for compatibility and rollback, but they can be ignored by resolution after an approved compatibility strategy.

### Permanent URLs

Card and Standee creation already allocates permanent identifiers, and update APIs guard the key URL fields as immutable. However:

- Branded public-slug allocation is currently **best-effort**; failures do not fail assignment.
- The current database contains cards with no `publicSlug` and, separately, cards with no `routeSlug`/`uid`.
- Card and Standee `publicSlug` uniqueness is enforced **per collection**, not across both; current data has no cross-collection collision, but the namespace risk exists.
- AIO standees have a panel `publicSlug`, but **no dedicated branded review URL**. Their review host remains `/standee-review/{routeSlug}`.

### Existing 404

The known card `6aeae9d218200f2461c8cdcb` currently has:

- legacy `reviewAssistant.enabled = true`
- a legacy Google Review URL
- `reviewSettingsSource = central`
- central `ReviewSettings.general.enabled = false`
- central integration active in the running app environment

Because the central source is authoritative and central publication is disabled, the effective review settings are **disabled**, so `/taprevia/google-review-2` correctly returns **404**. This is no longer a missing-destination problem; it is a **central publication/settings** problem.

Published hybrid review cards (for example `/kaka-pvc/google-review`) render directly at their branded URL with **200**, so the current branded renderer works.

---

## 2. Current Review Management Architecture

### 2.1 Central model

`src/models/ReviewSettings.ts:65–190`

- One document per `businessId` (unique index).
- `general`: `enabled`, `googleReviewUrl`, `welcomeMessage`, `businessName`.
- `content`: category, languages, writing style, preferred length, style/length modes, feedback topics, services, employees, keywords.
- Schema version and `updatedBy`.
- Pre-validation requires at least one language when enabled.

### 2.2 Card-level legacy data

`src/models/Card.ts`

- `reviewAssistant`: legacy enabled/Google URL/welcome/style/length/languages/topics/employees/services/keywords.
- `reviewSettingsSource`: `legacy`, `central`, or `hybrid`.
- `reviewOverrides`: optional hybrid overrides.
- `reviewSettingsVersion`, `reviewSettingsUpdatedAt/By`.

### 2.3 Standee-level data

`src/models/Standee.ts:92–103`

- Same `reviewSettingsSource`, `reviewSettingsVersion`, `reviewOverrides`.
- Per-slot `socialQrs[]` with platform and `destinationUrl` (`src/models/Standee.ts:3–15`).
- The Google Review slot destination is the standee’s product-specific Google destination.

### 2.4 Resolver precedence

`src/lib/services/review-settings-resolver.ts:455–502`

| Source | Behavior |
|---|---|
| `legacy` | Card `reviewAssistant` values + defaults |
| `central` | Valid central `ReviewSettings` + defaults; legacy destination fallback only when effective URL is empty |
| `hybrid` | Defaults → central → explicit overrides |
| Invalid/missing central or bad overrides | Complete `legacy-fallback` |

`applyLegacyDestinationFallback()` (`:418–445`) preserves a legacy Card Google URL only when central/hybrid would otherwise have an empty destination. It never overwrites a non-empty central URL or explicit hybrid URL.

### 2.5 Public effective settings

`src/lib/services/review-effective-settings.ts:32–70`

- Central OFF → source resolves as `legacy`.
- Central ON → stored `central`/`hybrid` remains; unset/legacy stays legacy unless the local force-all switch is active.
- `resolveEffectiveReviewSettingsSource` is in `src/lib/services/review-rollout.ts:167–177`.

### 2.6 Review Management API/UI

| Area | File |
|---|---|
| Central GET/PATCH | `src/app/api/review-management/route.ts:30–129` |
| Per-product PATCH | `src/app/api/review-management/products/[assignmentId]/route.ts:18–100` |
| Product list | `src/app/api/review-management/products/route.ts:10–24` |
| Central persistence | `src/lib/services/review-management-settings.ts` |
| Product eligibility/settings projection | `src/lib/services/review-product-eligibility.ts` |
| Product connection writes | `src/lib/services/review-product-connection.ts` |
| UI product rows/readiness | `src/components/review-management/review-management-client.tsx:783–834, 1198–1340` |
| Override UI | `src/components/review-management/review-management-client.tsx:1231–1266, 1783–1787`; `hybrid-dialog.tsx` |
| Central settings UI | `src/components/review-management/review-management-client.tsx:1458–1530` |

The UI currently exposes:

- **Use central settings**
- **Customize overrides**
- **Use product settings**
- Hybrid override dialog
- Per-product setup for the Google destination

### 2.7 Where overrides can supersede central settings

| Location | Role |
|---|---|
| `resolveReviewSettings` hybrid branch | Explicit `reviewOverrides` are merged over central |
| `review-product-connection.ts` | Writes `reviewSettingsSource` and hybrid `reviewOverrides` |
| `review-management-client.tsx` | Presents the source/override controls |
| `review-product-eligibility.ts` | Projects `settingsSource` and override state into the UI |
| `review-effective-settings.ts` | Chooses source and passes overrides into the resolver |
| Card/Standee model | Stores source/override data |

Central source does not use content overrides for effective content, but legacy destination fallback can fill an empty central Google URL.

---

## 3. Root Cause of the Existing 404

### 3.1 Current card

| Field | Current value |
|---|---|
| Card `_id` | `6aeae9d218200f2461c8cdcb` |
| Owner | `test4@gmail.com` — `6aeae9d218200f2461c8cd1a` |
| Product | Google Review NFC Plate — `6ae851d69391bf20babb5210` |
| `publicSlug` | `taprevia/google-review-2` |
| `urlAlias` | `digital-mw1uek1gzv` |
| `routeSlug` / `uid` | `mw1uek1ij3` |
| `reviewSettingsSource` | `central` |
| Legacy `reviewAssistant.enabled` | **true** |
| Legacy Google URL | `https://g.page/r/CV88rZ6GBWuREBM/review` |
| Central `general.enabled` | **false** |
| Central `general.googleReviewUrl` | empty |
| Tenant OpenAI | not configured |
| Effective source (app env) | **central** |
| Effective enabled | **false** |
| Effective Google URL | legacy fallback URL |

### 3.2 Why 404

The running app has central integration active. The card’s stored source is `central`, so the central document is authoritative. Its `general.enabled` is false. Therefore `resolveReviewAccess` returns null, the branded route fails closed, and `/taprevia/google-review-2` returns **404**.

This is **publication gating**, not a route collision and not a missing branded identifier.

### 3.3 Current routes

| URL | Current result |
|---|---|
| `/review/digital-mw1uek1gzv` | **200** — internal review route; unavailable state |
| `/taprevia/google-review-2` | **404** — central publication disabled |
| `/r/mw1uek1ij3` | **307** → `/review/digital-mw1uek1gzv` — unchanged |
| Published `/kaka-pvc/google-review` | **200** — direct branded review renderer |
| Published `/kaka-pvc/google-review-2` | **200** — direct branded review renderer |

The live application is serving the latest branded-rendering implementation; the target remains 404 because it is unpublished at the central layer.

### 3.4 Product-specific settings versus central

The card’s legacy review values are **not effectively active**:

- stored source is `central`;
- central integration is ON;
- central `general.enabled=false`;
- legacy enabled/Google URL are ignored for publication;
- the legacy destination only appears as an effective URL fallback, not as a publication override.

### 3.5 Dashboard presentation

The customer dashboard currently falls back to `/review/{urlAlias}` for this unpublished card and presents it under a **“Public URL”** heading/copy control. That is misleading: it is an internal preview route, not the branded public URL.

This is a presentation issue, not a reason to expose the unpublished branded URL as a working public link.

---

## 4. Central Settings versus Override Analysis

### 4.1 Current stored sources

Current live records (read-only):

| Collection | central | hybrid | legacy | unset |
|---|---:|---:|---:|---:|
| Cards | 3 | 3 | 0 | 18 |
| Standees | 6 | 0 | 0 | 2 |

Cards with non-empty `reviewOverrides`: **3**.  
Standees with non-empty `reviewOverrides`: **0**.

The 3 hybrid cards are the two published review cards and likely one other review-capable card; their overrides are currently effective content.

### 4.2 What removing modes/overrides would require

| Area | Required change | Notes |
|---|---|---|
| Resolver | Make eligible products resolve from central when a valid central document exists | Ignore `reviewSettingsSource` and `reviewOverrides` for content; preserve a legacy fallback for missing/invalid central data |
| Card model | Keep fields for compatibility; stop reading/writing them for effective content | No destructive migration required |
| Standee model | Keep fields for compatibility; stop reading content overrides | Slot destinations remain product-specific |
| Per-product API | Treat source/overrides as compatibility inputs; reject or ignore new override writes | Backward-compatible read behavior for old clients |
| UI | Remove “Use central settings”, “Use product settings”, “Customize overrides”, Hybrid dialog | Keep Google destination setup |
| Central API | Central settings become the only content/publication write path | Existing tenant isolation/validation remains |
| Data | No deletion required; optional later cleanup | Existing hybrid content must be preserved for rollback/audit |

### 4.3 Per-product Google destination

This must remain separate from central **content** settings.

- Card destination today: `reviewAssistant.googleReviewUrl` (legacy) and/or `reviewOverrides.googleReviewUrl` (hybrid).
- Standee destination today: `socialQrs[google_review].destinationUrl`.
- Central `general.googleReviewUrl` exists but is not the same concept as a product-specific destination.

A future central-authority design should explicitly define one destination field per product instance and use central settings only for content/publication/generation policy. Do not repurpose `general.googleReviewUrl` as the per-product destination without approval.

---

## 5. Permanent URL Lifecycle Analysis

### 5.1 Current card creation

`src/lib/services/user-product-assignment.ts:93–246`

1. Resolve canonical product/card kind.
2. Mint synthetic `DIGITAL-` UID when no hardware UID is supplied.
3. `provisionCardForAssignment()` finds/claims the Card or creates it with:
   - `cardUid` (physical or synthetic)
   - `slug` from the UID
   - `routeSlug` from timestamp allocator
   - `uid` mirroring `routeSlug`
4. Bind ownership.
5. Create `UserProduct`.
6. Best-effort `ensureCardPublicSlug()`.

Relevant files:

- `src/lib/services/card-identity.ts:76–89` — timestamp route allocation.
- `src/lib/services/card-identity.ts:140–198` — card provisioning.
- `src/lib/services/human-url.ts:172–223` — publicSlug allocation.
- `src/lib/services/url-identity.ts:15–70` — immutable identity guard.

### 5.2 Current standee creation

`src/lib/services/user-product-assignment.ts:269–337`

- Allocate `routeSlug` via timestamp generator.
- Mirror `uid`.
- Create `panelQr.qrId`, per-slot `socialQrs[].qrId`.
- Set `reviewSettingsSource='central'` for review-capable products.
- Best-effort `ensureStandeePublicSlug()`.

### 5.3 Current immutability

`src/lib/services/url-identity.ts:15–27`

Immutable fields:

- Card: `routeSlug`, `uid`, `publicSlug`, `urlAlias`, `slug`
- Standee: `routeSlug`, `uid`, `publicSlug`
- Standee QR IDs and slot platform identities are also guarded.

Guards exist in:

- `src/app/api/cards/[id]/route.ts:175–188`
- `src/app/api/my/products/[id]/config/route.ts:93–104, 231–241, 359–366, 451+`

`publicSlug` allocation is idempotent and never regenerates an existing value (`human-url.ts:178, 244`). Standee publicSlug is likewise idempotent.

### 5.4 Gaps

1. **Best-effort allocation:** `ensureCardPublicSlug` and `ensureStandeePublicSlug` are wrapped in try/catch; assignment succeeds even if branded URL allocation fails.
2. **Missing fields:** current DB has **10 cards without publicSlug** and **4 cards without routeSlug/uid**. Standees currently have no missing publicSlug or permanent routes.
3. **Namespace:** Card and Standee `publicSlug` unique indexes are separate. Current cross-collection collisions are **0**, but a shared namespace is not enforced.
4. **AIO standee review host:** the panel publicSlug is not a review URL; no dedicated branded review URL exists.
5. **`urlAlias`/`slug`:** both are now guarded immutable by the update APIs; legacy records may predate the guard.
6. **Backfill:** no automatic runtime backfill for already-missing publicSlug; only explicit scripts/repair paths.

---

## 6. Product-by-Product Compatibility Matrix

| Product | Permanent NFC/QR | Branded public behavior | Review entitlement | Central settings | Google destination | Publication / notes |
|---|---|---|---|---|---|---|
| Business NFC Card | `/r/{routeSlug}` | `/{publicSlug}` profile | **None** | N/A | N/A | No Review Management |
| Premium NFC Business Card | `/r/{routeSlug}` | `/{publicSlug}` profile | **Yes** (`review_ai_suggestions`) | central/hybrid/legacy | card review URL | Profile card with optional review; branded profile URL remains profile |
| Google Review Card | `/r/{routeSlug}` | `/{publicSlug}` direct review when published | **Yes** | central/hybrid/legacy | card review URL | Branded review route works; `/review/{alias}` remains |
| Google Review NFC Plate | `/r/{routeSlug}` | `/{publicSlug}` direct review when published | **Yes** | central/hybrid/legacy | card review URL | Current target uses this type |
| Insta Card | `/r/{routeSlug}` | `/{publicSlug}` | **None** | N/A | N/A | Social redirect only |
| LinkedIn Card | `/r/{routeSlug}` | `/{publicSlug}` | **None** | N/A | N/A | Social redirect only |
| Facebook Card | `/r/{routeSlug}` | `/{publicSlug}` | **None** | N/A | N/A | Social redirect only |
| Google Review Standee | `/r/{routeSlug}` | `/{publicSlug}` panel; review host `/standee-review/{routeSlug}` | **Yes** | central/hybrid/legacy | standee Google slot | No dedicated branded review URL |
| Business Profile Standee | `/r/{routeSlug}` | `/{publicSlug}` panel | **None** | N/A | N/A | Panel only |
| All In One Standee – 3 | `/r/{routeSlug}` | `/{publicSlug}` panel; review host `/standee-review/{routeSlug}` | **Yes** | central | Google slot destination | AIO automatically discoverable; setup required without destination |
| All In One Standee – 4 | `/r/{routeSlug}` | `/{publicSlug}` panel; review host `/standee-review/{routeSlug}` | **Yes** | central | Google slot destination | Same as AIO 3 |

No Review Management entitlement is proposed for Business NFC Card, Insta/LinkedIn/Facebook, or Business Profile Standee.

---

## 7. Existing Database Findings

Read-only snapshot at audit time:

| Metric | Value |
|---|---:|
| Canonical products | **11** |
| Cards | **24** |
| Standees | **8** |
| Active assignments | **23** |
| Review-entitled assignments | **13** |
| Review Cards | **10** |
| ReviewSettings documents | **2** |
| TenantSettings documents | **3** |

### Missing / collisions

| Check | Result |
|---|---:|
| Cards missing `publicSlug` | **10** |
| Standees missing `publicSlug` | **0** |
| Cards missing `routeSlug`/`uid` | **4** |
| Standees missing `routeSlug`/`uid` | **0** |
| Duplicate card publicSlug | **0** |
| Duplicate standee publicSlug | **0** |
| Duplicate card routeSlug | **0** |
| Duplicate standee routeSlug | **0** |
| Duplicate card urlAlias | **0** |
| Cross-collection publicSlug collision | **0** |

The 10 missing card publicSlugs include test/verification cards and legacy records; they are not all canonical customer products. No missing publicSlug should be repurposed or guessed.

### Review settings

| Business | Central enabled | Central Google URL | Category | Languages |
|---|---|---|---|---|
| `6ae85874efc853c66c8a10f3` | **true** | empty (legacy fallback in use) | real-estate | 1 |
| `6aeae9d218200f2461c8cd1a` | **false** | empty | real-estate | 1 |

### Branded review cards

| Card | publicSlug | Source | Published | Result |
|---|---|---|---|---|
| `6ae85874efc853c66c8a1156` | `kaka-pvc/google-review` | hybrid | yes | 200 |
| `6ae85874efc853c66c8a11bf` | `kaka-pvc/google-review-2` | hybrid | yes | 200 |
| `6aeae9d218200f2461c8cd62` | `taprevia/google-review` | central | **no** | **404** |
| `6aeae9d218200f2461c8cdcb` | `taprevia/google-review-2` | central | **no** | **404** |

Six review cards currently have no `publicSlug` (test/verification fixtures); they have no branded URL to test.

### Settings/tenant notes

- Two central `ReviewSettings` documents exist.
- Three `TenantSettings` documents exist; one has an enabled OpenAI provider/key (not exposed here).
- No API keys or secrets are printed or modified.

The current database contains more cards/standees than earlier baselines because of external app/test activity. This audit made no writes.

---

## 8. Proposed Minimal Implementation Plan — Not Executed

### Step 1 — Central Settings Enforcement

**Goal:** central settings authoritative for all eligible review products.

Files:

- `src/lib/services/review-settings-resolver.ts`
- `src/lib/services/review-effective-settings.ts`
- `src/lib/services/review-product-eligibility.ts`
- `src/lib/services/review-product-connection.ts`
- `src/components/review-management/review-management-client.tsx`

Proposed behavior:

- If a valid central `ReviewSettings` exists, resolve content/publication from central for every eligible product.
- Ignore `reviewSettingsSource` and content `reviewOverrides` for effective content.
- Preserve a complete legacy fallback only when central settings are missing/invalid (or during an approved migration window).
- Keep per-product Google destination separate:
  - Card: explicit destination field (currently legacy `reviewAssistant.googleReviewUrl`, with legacy read compatibility).
  - Standee: Google Review slot destination.
- Keep tenant isolation and `requireApiEntitlement`.

Database impact: no destructive migration required to stop reading overrides; existing fields remain. Optional later cleanup only with approval.

Risk: **High** — existing hybrid/customized content would be ignored; customer-visible content changes. Requires owner approval and a migration/communication plan.

### Step 2 — Remove Override UI

Files:

- `src/components/review-management/review-management-client.tsx`
- `src/components/review-management/hybrid-dialog.tsx`
- `src/components/review-management/product-settings-dialog.tsx`
- `src/components/review-management/types.ts`

Changes:

- Remove “Use central settings”, “Use product settings”, and “Customize overrides”.
- Keep the Google destination setup and setup-required state.
- API can accept old clients but ignore/reject new source/override writes in favor of central.

Database impact: none required. Existing overrides remain stored for audit/rollback.

Risk: **Medium** — UI/API compatibility; requires approval and old-client behavior decision.

### Step 3 — Immutable URL Protection

Files:

- `src/lib/services/human-url.ts`
- `src/lib/services/card-identity.ts`
- `src/lib/services/user-product-assignment.ts`
- `src/lib/services/url-identity.ts`
- `src/models/Card.ts`
- `src/models/Standee.ts`

Changes:

- Make `publicSlug` allocation mandatory/retriable for new canonical cards/standees; do not silently succeed assignment with a missing branded URL.
- Preserve existing identifiers; never regenerate.
- Add an explicit repair/backfill path for legacy missing publicSlug/routeSlug records (data change, approval required).
- Consider enforcing publicSlug uniqueness across Card + Standee namespaces or route precedence.
- Keep `urlAlias`/`slug` immutable guards (already present).

Database impact: possible backfill/repair for legacy records; no identifier changes for records that already have values.

Risk: **Medium/High** — existing missing identifiers; collision handling; assignment failure behavior.

### Step 4 — Public Review URL Correction

The card branded route is already implemented:

- Published review Cards render at `/{publicSlug}` with 200.
- `/review/{alias}` and `/r/{routeSlug}` remain.
- Unpublished branded URLs remain 404.

Remaining work is publication-state presentation:

- Label `/review/{alias}` for unpublished cards as **“Review preview (not published)”**.
- Do not present it as Public URL.
- Show “Public URL available after publication” when appropriate.
- Do not expose unpublished content.

Files:

- `src/components/review-management/review-management-client.tsx`
- `src/app/(dashboard)/dashboard/products/page.tsx`
- `src/app/(dashboard)/dashboard/products/[id]/page.tsx`
- `src/app/(dashboard)/dashboard/vcards/page-client.tsx`
- `src/lib/services/customer-public-url.ts` and `product-preview.ts` (only if display semantics are approved)

Risk: **Low** if display-only; **High** if publication gating is bypassed.

### Step 5 — AIO Standee Branded Review URL Strategy

Current AIO publicSlug is the panel URL (`{business}/standee-N`), not the review host. Reusing it would mix two experiences.

Proposed design requiring approval:

- Add a dedicated immutable `reviewPublicSlug` on Standee, allocated once (e.g. `{business}/google-review-standee[-N]`), unique across the shared public namespace.
- Add a resolver that maps that branded review URL to the standee Google Review host.
- Preserve panel `publicSlug` and `/standee-review/{routeSlug}`.
- Do not allocate or rewrite existing standee identifiers automatically.
- No schema/route change until approved.

Database impact: new field + backfill allocation for existing AIO standees; approval and migration required.

Risk: **High** — schema/route design, cross-collection collisions, publication gating, analytics.

### Step 6 — Regression Testing

At minimum:

- Central settings authority for Cards and Standees.
- Missing central document fallback.
- Legacy data preservation.
- Google destination separation.
- AIO setup-required → destination → ready.
- Published branded review Card 200.
- Unpublished branded Card 404.
- `/review/{alias}`, `/r/{routeSlug}`, `/profile`, `/c`, social, standee panel and slot routes.
- URL immutability and collision checks.
- Review generation library/OpenAI paths.
- Entitlement isolation and cross-tenant checks.
- TypeScript, ESLint, build.

---

## 9. Risk Assessment

| Area | Risk | Notes |
|---|---|---|
| Central authority | High | Existing hybrid content stops applying; customer-visible changes; approval required |
| Legacy fallback removal | High | Could disable legacy customers if no central settings exist |
| Override UI removal | Medium | Existing clients/API; keep compatibility or gate |
| Per-product destination | High | Must not be conflated with central content or lost |
| PublicSlug backfill | Medium/High | Identifier creation; no guessing |
| Cross-collection URL collisions | Medium | Current 0, but namespace not enforced |
| AIO branded review URL | High | New schema/route; separate from panel |
| Publication display | Low | Label-only; no exposure of unpublished content |
| Analytics | Medium | New routes must not duplicate taps |
| Physical NFC/QR | High | Must preserve `/r` and every existing identifier |

---

## 10. Regression Test Plan

### Central settings

1. Central document valid/enabled → all eligible Cards/Standees use central content.
2. Central document missing/invalid → approved legacy fallback behavior.
3. Hybrid/legacy records remain readable and unchanged in storage.
4. Central disabled → public review pages fail closed.
5. Tenant isolation and API entitlement unchanged.
6. AIO 3/4 discovery and setup state.

### Permanent URLs

1. New card/standee gets `routeSlug`, `uid`, `publicSlug` atomically.
2. PublicSlug allocation failure does not lose an identifier; retry/repair works.
3. Existing identifiers never change on edits, product update, business-name change, or review settings update.
4. Collision handling within and across Card/Standee namespaces.
5. Card replacement keeps routeSlug/uid/publicSlug.
6. Legacy records with missing identifiers remain readable; backfill is explicit.

### Review routing

1. Published branded Card `/{publicSlug}` → 200 direct.
2. Unpublished branded Card → 404.
3. `/review/{alias}` → 200/legacy behavior.
4. `/r/{routeSlug}` → unchanged 307.
5. `/profile/{alias}`, `/c/{slug}`, social routes, standee panel and slot routes.
6. No redirect loops; analytics attribution unchanged.
7. AIO standee review host and any future branded review URL.

### Existing suites

- `test-review-management.ts` (58)
- `test-standee-review.ts` (20)
- `test-review-phase2-products.ts` (21)
- `test-phase4d10p2-preview-routing.ts` (17/18 known stale)
- `test-phase4d10p2-backward-compat.ts` (11)
- PPL-01/02/03-01/04-05/06/07
- Dashboard/product entitlements, card binding, dynamic routing, security, VCF
- TypeScript, ESLint, production build

---

## 11. Decisions Requiring Approval

1. Whether central settings should override all existing hybrid/legacy content, and the migration/communication policy.
2. Whether existing overrides should be preserved as read-only history, merged into central, or eventually removed.
3. Whether legacy fallback remains when no central document exists.
4. How per-product Google destinations are represented going forward (Card field vs central field; Standee slot).
5. Whether the override UI/API is removed immediately or hidden first.
6. Whether to backfill missing publicSlug/routeSlug records and how collisions are resolved.
7. Whether to enforce a shared Card+Standee publicSlug namespace.
8. Whether AIO standees get a new `reviewPublicSlug` and branded review route; this requires schema/route design.
9. Whether to relabel unpublished `/review` URLs as preview (recommended) or take another display approach.

---

## 12. Safety Confirmation

- No source code was modified during this audit.
- No database writes, migrations, schema changes, identifier changes, entitlement changes, or customer-data changes were made.
- No publication settings or API keys were changed.
- All database access was read-only.
- No production or preview database was accessed.
- No commit, push, or deployment was performed.

**Audit complete. Awaiting explicit product-owner approval and a separate implementation prompt.**
