# Taprevia — Central Review Management & Immutable URL System (Phase 2)

**Date:** 2026-11-04  
**Branch:** `Devlopment`  
**Mode:** Approved-scope implementation → regression test → report  
**Final status:** **IMPLEMENTATION COMPLETE — STOPPED BEFORE DATA CHANGES AND DEPLOYMENT**

Authoritative starting point: `docs/audits/TAPREVIA_CENTRAL_REVIEW_AND_PERMANENT_URL_AUDIT.md`.

This phase implemented code-only changes. No customer record, identifier, schema, environment, NFC/QR payload, or deployment was changed. The two data-dependent items (legacy URL repair and standee branded review URLs) are documented as plans awaiting separate approval.

---

## 1. Files Changed

### Application code

| File | Change |
|---|---|
| `src/lib/services/review-effective-settings.ts` | Central authority is applied when central integration is active and a valid central `ReviewSettings` exists; added `applyCardProductDestination()` to retain the card's product-specific Google destination while central content/publication win. |
| `src/lib/services/review-product-eligibility.ts` | Card and standee projections now use central authority for content/publication, with legacy fallback only when central is inactive, absent, or invalid. Card projection restores the product destination. |
| `src/lib/services/review-standee-settings.ts` | Standee resolver treats central as authoritative when integration is active and a central document exists; the standee Google slot remains the destination. |
| `src/app/api/review-management/preview/route.ts` | Preview uses the projected effective settings. Content overrides are ignored under central authority; the product destination is applied only while central authority is active. |
| `src/components/review-management/review-management-client.tsx` | Removed source selectors, override customisation, per-product override dialog wiring, and related state/errors. Eligible product rows now show one source: Central Review Management. |
| `src/lib/services/human-url.ts` | Added an application-level shared Card/Standee `publicSlug` check and collision-offset retry. No index or schema change. |
| `src/lib/services/user-product-assignment.ts` | New canonical card/standee assignments require successful branded public URL allocation; failed allocation rolls back the assignment and any freshly created card/standee. |
| `src/lib/services/review-product-connection.ts` | Standee Google Review setup persists the supplied destination on the existing `google_review` slot on first setup, and validates supported Google URLs. Hybrid content overrides remain stored for compatibility. |
| `src/components/review/review-experience.tsx` | New shared entitlement/publication gate and renderer used by both branded and legacy review routes. |
| `src/app/[business]/[product]/page.tsx` | Published review cards render directly at the existing branded `publicSlug`; unpublished cards fail closed. Standee panel routing unchanged. |
| `src/app/review/[alias]/page.tsx` | Uses the shared `ReviewExperience`; legacy route and behavior preserved. |

### Tests

| File | Change |
|---|---|
| `scripts/test-central-review-authority.ts` | Expectations updated to the new single-authority behavior, including product destination retention and ignored legacy/hybrid content overrides. |

### Documentation

| File | Change |
|---|---|
| `docs/audits/TAPREVIA_CENTRAL_REVIEW_AND_IMMUTABLE_URL_PHASE2.md` | This report. |

**Not changed:** models, database schema, indexes, existing identifiers, existing customer documents, environment variables, NFC/QR payloads, deployment configuration.

---

## 2. Central Review Management Behavior

Central authority now applies when **all** of the following are true:

1. Central public integration is active for the tenant (gate + rollout allowlist/force-all), and
2. A central `ReviewSettings` document exists for the business, and
3. That document resolves to a valid `central` configuration.

When authoritative, central settings control:

- Review publication (`general.enabled`)
- Welcome/content and templates
- Category / review topics
- Languages
- Writing style and preferred length (including style/length modes)
- Keywords
- Services and employees
- Generation source / AI provider and model
- Generation limits

Tenant isolation is unchanged: resolution is keyed by the card/standee owner (`userId ?? assignedUserId`), and existing entitlement checks still run before any public review surface is served.

### Precedence implemented

| Surface | Content/publication | Google destination |
|---|---|---|
| Card | Central when valid central exists; otherwise legacy fallback | Card hybrid destination → card legacy destination → central URL |
| Standee | Central when valid central exists; otherwise legacy fallback | Existing `google_review` slot destination |

Central never replaces a product's Google Review destination with another business's or a single shared listing.

### Failed-closed behavior preserved

- Central integration OFF → previous legacy resolution is used.
- No central document → previous legacy resolution is used.
- Invalid central document → previous legacy resolution is used.
- Central document valid but `general.enabled = false` → review remains unpublished; no legacy `enabled` flag can override it.
- No entitlement → review access denied.

---

## 3. Legacy Override Handling

Legacy records are **not deleted or rewritten**. This includes:

- `reviewSettingsSource`
- `reviewOverrides`
- Legacy `Card.reviewAssistant`
- Standee social QR slot destinations
- Rotation history and template references

Under valid central authority:

- Stored `central` / `hybrid` / `legacy` source selectors are ignored for effective content and publication.
- Content overrides (`welcomeMessage`, category, languages, style, length, topics, services, employees, keywords) are ignored.
- Product-specific Google destinations are still read from the card's own stored destination.

When central authority is not active, the existing safe legacy path remains intact, including the gate-OFF behavior covered by the legacy suites.

### API compatibility

- Existing `source` / `overrides` inputs remain accepted so older clients do not break.
- Under central authority those inputs cannot re-enable custom content or publication.
- Unrelated product configuration APIs were not removed.
- Standee Google Review setup still validates the destination URL and writes it to the existing slot.

---

## 4. Removed UI Controls

Removed from Review Management:

- “Use central settings”
- “Use product settings”
- “Customize overrides”
- Per-product review content override form/dialog wiring
- Source/override error and saving state associated with those controls

Retained:

- Central Review Management settings
- Eligible product list and setup status
- Google Review destination configuration
- Review previews
- Template/library generation
- AI configuration
- Publication controls

The AI configuration warning was not reintroduced.

`src/components/review-management/hybrid-dialog.tsx` still exists in the tree but is no longer imported or rendered. It can be removed in a later cleanup with approval; leaving it does not expose the retired workflow.

---

## 5. New Product URL Allocation Guarantees

For new canonical card and standee assignments:

1. Permanent `routeSlug` is allocated if missing; `uid` follows the existing route convention.
2. Branded `publicSlug` allocation is now **mandatory** for canonical card products and for new standees.
3. If allocation fails:
   - the newly created `UserProduct` is deleted,
   - a freshly provisioned card/standee is deleted or released according to the existing rollback path,
   - the assignment does not return success with an incomplete identity.
4. Updates still cannot change permanent identifiers; the existing immutability guards were not relaxed.
5. Existing identifiers are never regenerated.
6. Card replacement keeps the existing identifiers.

### Shared namespace

`allocateCardPublicSlug` and `allocateStandeePublicSlug` now consult a shared application-level check across `Card` and `Standee`.

- It prevents a new card from taking a standee path and vice versa.
- It does not add a database index or migration.
- Concurrent cross-collection allocation still relies on the duplicate-key retry path plus the new collision offset.
- The shared check is best-effort against a race between two collections; a true database-level cross-collection constraint would require a schema/index change and is **not** implemented.

### Immutability

No change was made to the rule that existing `publicSlug`, `routeSlug`, `uid`, and `urlAlias` values are permanent. No identifier was generated, repaired, or overwritten in the live database.

---

## 6. Existing URL Compatibility

Preserved:

- `/review/{urlAlias}` — legacy review route, now rendered through the shared experience.
- `/r/{routeSlug}` — permanent NFC/QR route; unchanged.
- `/{business}/{product}` — branded public slug route.
- `/standee-review/{routeSlug}` — existing standee review host.
- Standee panel `publicSlug` routes.
- Existing NFC/QR payloads and their analytics attribution.
- Publication gating and entitlement checks.
- Direct navigation and refresh on branded review URLs.

The branded review route now renders the review experience directly for a published review card instead of relying on the legacy alias route. It does **not** reuse a standee panel `publicSlug` as a review URL.

### Verified routing behavior

| Case | Behavior |
|---|---|
| Published review card at `/{publicSlug}` | Renders directly |
| Unpublished review card at `/{publicSlug}` | `notFound()` / no review content exposure |
| `/review/{alias}` for a published card | Renders through the shared experience |
| `/review/{alias}` for an unpublished card | Fails closed |
| `/r/{routeSlug}` | Unchanged permanent route |
| Standee panel and `/standee-review/{routeSlug}` | Unchanged |

---

## 7. Unpublished URL Display Behavior

- An unpublished branded slug is retained and **not** reassigned.
- Unpublished review content is not exposed at the branded URL.
- The URL fails closed (404) rather than redirecting to a public review.
- `/review/{alias}` remains available as the internal legacy/preview path when access allows it, but it is not presented as the product's Public URL.
- Review Management continues to show setup/publication status so an operator can see why a product is not published.

### Existing 404 card

Card `6aeae9d218200f2461c8cdcb`:

- `publicSlug`: `taprevia/google-review-2`
- `urlAlias`: `digital-mw1uek1gzv`
- `routeSlug` / `uid`: `mw1uek1ij3`
- `reviewSettingsSource`: `central`
- Legacy `reviewAssistant.enabled`: `true` (with a Google URL)
- Central `ReviewSettings.general.enabled`: `false`
- Central `general.googleReviewUrl`: empty
- Effective publication: **disabled**
- Observed: `/taprevia/google-review-2` → 404, `/review/digital-mw1uek1gzv` → 200

This is correct fail-closed behavior, not a routing bug. No bypass, central enablement, or destination change was performed.

**Configuration actions required to publish (not performed):**

1. In central Review Management for the owning business, enable review publication (`general.enabled = true`).
2. Set the central Google Review destination **or** confirm the product's existing Google destination is intentional. Under the implemented precedence, the card's own legacy destination is retained, so this step is only needed if the operator wants to change it.
3. Confirm the business has the review entitlement and that at least one valid language/category configuration exists.
4. Re-check `/taprevia/google-review-2` and Review Management preview.

---

## 8. AIO 3/4 Integration Status

Both standee products remain automatically discoverable in Review Management:

- All In One Standee – 3 Profile (`all-in-one-standee-3`)
- All In One Standee – 4 Profile (`all-in-one-standee-4`)

Preserved behavior:

- “Needs setup” state when the Google Review slot destination is missing.
- Complete Setup workflow.
- Google Review destination validation.
- Other social slots.
- Assignment and ownership checks.
- Existing standee panel URLs.
- Existing `/standee-review/{routeSlug}` review host.
- Google slot destination as the single standee review destination (central content does not replace it).

No standee `reviewPublicSlug` field or new review URL architecture was implemented.

---

## 9. Regression Results

All write-based tests used disposable databases or a `mongodump`/`mongorestore` clone. Clones and temporary databases were dropped after each run. No live customer document was written.

### Passing suites

| Suite | Result |
|---|---|
| `scripts/test-review-management.ts` (gate OFF) | **58/58** |
| `scripts/test-standee-review.ts` (gate OFF) | **20/20** |
| `scripts/test-review-phase2-products.ts` | **21/21** |
| `scripts/test-central-review-authority.ts` OFF → ON → OFF | **10/10**, **20/20**, **8/8** |
| `scripts/test-card-binding.ts` | **49/49** |
| `scripts/test-dynamic-routing.ts` | **29/29** |
| `scripts/verify-m10-feature-access.ts` | **16/16** |
| `scripts/test-ppl01-customer-qr.ts` | **18/18** |
| `scripts/test-ppl02-immutable-urls.ts` | **23/23** |
| `scripts/test-ppl03-01-alias-collision.ts` | **8/8** |
| `scripts/test-ppl04-05-permanent-urls.ts` | **16/16** |
| `scripts/test-ppl06-alias-validation.ts` | **41/41** |
| `scripts/test-ppl07-redirect-safety.ts` | **11/11** |
| `scripts/test-customer-public-url-display.ts` | **29/29** |
| `scripts/test-dashboard-entitlement.ts` | **130/130** |
| `scripts/test-security-boundaries.ts` | **Passed** |
| `scripts/test-vcf.ts` | **69/69** |
| TypeScript (`tsc --noEmit`) | **Passed** |
| ESLint (`npm run lint`) | **Passed, no warnings/errors** |
| Production build (`npm run build`) | **Passed** |

### Central authority matrix

The dedicated matrix verifies, across OFF → ON → OFF:

- Legacy products switch to central content when authority is active.
- Legacy products retain their product-specific destination.
- Hybrid content overrides are ignored, while the hybrid product destination is retained.
- Blocked/ineligible products do not get central settings rewritten.
- Stored legacy data and source fields are not migrated.
- Turning central OFF restores the previous legacy behavior.

### Standee central-authority verification

A disposable clone was seeded with a hybrid standee whose `reviewOverrides` contained a conflicting welcome message and URL. With central active:

- Effective source: `central`
- Welcome message: central value (override ignored)
- Destination: the standee's own Google slot (`https://example.test/standee-slot`), not the override

### Known unresolved test expectations (gate ON)

The legacy suites still contain assertions for the retired hybrid override workflow. They were **not weakened or deleted**.

`scripts/test-review-management.ts` with `EXPECT_GATE=true`:

- `preview API: legacy/central/hybrid/fallback are read-only and correct: legacy source central`
- `connection: hybrid accepts the full supported override set: welcome override missing`
- `connection: removing overrides returns to central values: status 409`
- `connection: unknown/legacy override keys are preserved: status 409`
- `connection: legacy rollback restores exact legacy state: status 400`
- `connection: repeated cycles remain reversible: central 409`
- `connection: stale revision returns 409 and retry succeeds: retry 400`
- `concurrency: settings update + product connection remain consistent: connection 409`
- `compatibility: aliases, templates, rotation history and reviewAssistant survive: connection 409`

Result: **9 failures**.

`scripts/test-standee-review.ts` with `EXPECT_CENTRAL=true`:

- `management: save central then connect Standee central/hybrid/legacy reversibly: hybrid URL override missing`
- `management: stale revision, parallel connection and security boundaries: parallel statuses 409,409`
- `management: unknown override keys survive Standee updates: hybrid update 409`

Result: **3 failures**.

These tests assert the old “hybrid override changes effective content” contract. Under the approved single-authority model that contract is intentionally retired. They must be **updated or formally retired with approval**; they must not be quietly weakened or marked skipped without a decision.

---

## 10. Remaining Issues

1. **Gate-ON legacy override assertions** — 9 + 3 failures described above. Decision required: update to the single-authority contract or retire the obsolete cases.
2. **Legacy cards missing identifiers** — 10 cards lack `publicSlug`; 10 lack `uid`; 4 of those also lack `routeSlug`. No repair performed. See section 11.
3. **Target card publication** — `6aeae9d218200f2461c8cdcb` remains unpublished because central `general.enabled = false`. See section 7.
4. **Cross-collection race** — the shared public-slug check is application-level only; a database-level cross-collection constraint would require schema/index approval.
5. **Unused hybrid dialog** — `src/components/review-management/hybrid-dialog.tsx` remains but is unreachable. Cleanup requires approval only if file removal is desired.
6. **AIO branded review URL** — not implemented; design only. See section 12.

---

## 11. Legacy URL Repair Dry-Run

**Status: DRY-RUN ONLY. No value was assigned, no record was modified, no migration was run.**

### Live snapshot (read-only)

- 24 Cards total
- 8 Standees total
- 11 canonical catalog products
- 10 Cards missing `publicSlug`
- 10 Cards missing `uid`
- 4 Cards missing `routeSlug` (and also `uid` and `publicSlug`)
- 0 duplicate existing `publicSlug` values
- 0 duplicate existing `routeSlug` values
- 0 duplicate existing `urlAlias` values
- 0 collisions between existing Card and Standee `publicSlug` values

### Affected records

| Card ID | Owner | Existing alias | Existing route | Existing uid | Existing publicSlug | Missing | Shape |
|---|---|---|---|---|---|---|---|
| `6a87e9c84ceaba7e811d2fed` | `one@gmail.com` | — | — | — | — | alias, route, uid, public | Legacy active card, no catalog assignment found |
| `6a881ee9e30913cf3fe1f979` | `two@gmail.com` | — | — | — | — | alias, route, uid, public | Legacy active card, no catalog assignment found |
| `6a8878b55f1322f8f0ecb978` | `three@gmail.com` | — | — | — | — | alias, route, uid, public | Legacy active card, no catalog assignment found |
| `6a9274dcc538bd6293e5a9d6` | `het@gmail.com` | — | — | — | — | alias, route, uid, public | Legacy active card, no catalog assignment found |
| `6aeaf75a2c28aca802c32077` | `m12-verify@example.com` | `m12verify01` | `m12r-m12verify01` | — | — | uid, public | Review card, no catalog assignment found |
| `6aeaf75a2c28aca802c32078` | `m12-verify@example.com` | `m12verify02` | `m12r-m12verify02` | — | — | uid, public | Review card, no catalog assignment found |
| `6aeaf75a2c28aca802c32079` | `m12-verify@example.com` | `m12verify03` | `m12r-m12verify03` | — | — | uid, public | Review card, no catalog assignment found |
| `6aeaf75a2c28aca802c3207a` | `m12-verify@example.com` | `m12verify04` | `m12r-m12verify04` | — | — | uid, public | Review card, no catalog assignment found |
| `6aeaf75a2c28aca802c3207b` | `m12-verify@example.com` | `m12verify05` | `m12r-m12verify05` | — | — | uid, public | Review card, no catalog assignment found |
| `6aeaf75a2c28aca802c3208d` | `m12-verify@example.com` | `m14verifybare` | `m14r-m14verifybare` | — | — | uid, public | Review card, no catalog assignment found |

### Proposed allocation strategy (not executed)

1. **`uid`** — use the existing `routeSlug` when present; otherwise allocate a new permanent route slug using the existing allocator. Never regenerate an existing route.
2. **`routeSlug`** — for the 4 cards without one, allocate through the existing permanent route allocator.
3. **`urlAlias`** — for the 4 cards without one, allocate a legacy alias only if the product is review-capable and the owner intends to use `/review/{alias}`.
4. **`publicSlug`** — allocate using the business slug plus a product-derived segment:
   - Review cards: `{bizSlug}/google-review-card[-N]`
   - Other cards: `{bizSlug}/{productSlug}[-N]`
   - If no catalog product is linked, the operator must confirm the product segment before allocation.
5. **Collision checks** — preflight within `Card`, within `Standee`, and across both; then rely on the unique sparse indexes for same-collection races.
6. **Idempotency** — each allocation is conditional on the field being empty; re-running the repair must be a no-op.

### Blockers before execution

- The 4 legacy cards (`one@`, `two@`, `three@`, `het@`) have **no `UserProduct` and no catalog product**. A repair cannot infer a correct product segment without operator confirmation.
- The 6 review cards are owned by a verification account and have no catalog assignment. They may be test artifacts; they should be classified (repair or retire) before any value is assigned.
- Publication is separate from identifier repair. Allocating a `publicSlug` must not publish a review or enable central settings.

### Links that must remain functional

- Existing `/review/{alias}` links for the 6 cards that already have aliases.
- Existing `/r/{routeSlug}` links for the 6 cards that already have routes.
- Existing NFC/QR payloads that encode those aliases/routes.
- No existing identifier may be replaced by a “cleaner” value.

**No identifiers were generated and no documents were updated.**

---

## 12. Standee Branded-Review URL Proposal

**Status: DESIGN ONLY. Not implemented. Requires separate approval.**

### Problem

An AIO standee currently has a panel `publicSlug` such as `{business}/standee-2`. Reusing it for the review page would mix the panel experience with the review experience. The review host today is `/standee-review/{routeSlug}`.

### Proposed design

| Item | Proposal |
|---|---|
| Field | New immutable `reviewPublicSlug` on `Standee` |
| Format | `{business}/review-standee[-N]` |
| Allocation | Once, at first successful Google Review setup, using the shared namespace allocator |
| Resolver | Add a review branch to `/{business}/{product}` for standees with a matching `reviewPublicSlug` |
| Publication | Only render when effective review settings are enabled and the standee is entitled; otherwise fail closed |
| Destination | Existing `google_review` slot destination only |
| Legacy compatibility | Keep panel `publicSlug`, `/standee-review/{routeSlug}`, NFC/QR payloads, and analytics intact |
| Analytics | Attribute to the standee's existing `routeSlug`; do not create a second event stream or double-count |
| Collision prevention | Shared Card/Standee namespace check plus unique index; no value assigned to existing standees without approval |
| Database impact | New field and optional index; backfill for existing AIO standees only with explicit approval |
| Rollback | Feature-flag the branded route; `/standee-review/{routeSlug}` remains the permanent fallback |

### Explicitly not done

- No `reviewPublicSlug` field added.
- No new route added.
- No existing standee modified.
- No panel `publicSlug` reused as a review URL.
- No schema migration or backfill.

This design must be approved before any implementation because it adds a new identifier architecture and a potential schema change.

---

## 13. Confirmation: Customer Data and Production Untouched

- No live customer document was created, updated, or deleted.
- No `publicSlug`, `routeSlug`, `uid`, or `urlAlias` was generated, repaired, or overwritten in the live database.
- No migrations were run.
- No schema or index was changed.
- No central `ReviewSettings` was enabled.
- No Google Review destination was changed.
- No NFC/QR payload was reprogrammed.
- No production or preview environment was accessed.
- No commit, push, or deployment was performed.
- All write-based tests ran against disposable databases or a temporary clone, which were dropped afterward.
- The live 404 on `taprevia/google-review-2` was left as-is because publishing it requires an explicit central configuration action.

---

## Stop Point

Implementation, static checks, build, and the passing regression suites are complete. The remaining work requires approval or data changes:

1. Decide whether to update or retire the obsolete gate-ON hybrid override assertions (9 + 3 failures).
2. Approve and classify the 10 cards in the legacy URL repair dry-run before assigning any identifier.
3. Approve the standee branded-review URL design before adding a field, route, or backfill.
4. Enable central Review Management for card `6aeae9d218200f2461c8cdcb` if the business intends to publish `/taprevia/google-review-2`.

No further code, database, or deployment action was taken.
