# Taprevia — Phase 3: Central Review Management, Permanent URLs & Regression Safety Audit

**Date:** 2026-11-04  
**Branch:** `Devlopment`  
**HEAD:** `0191bc1889c95e5716afa2f8f67a991ac131c101`  
**Mode:** Strict read-only audit  
**Final status:** **AUDIT COMPLETE — NO IMPLEMENTATION — STOPPED FOR OWNER APPROVAL**

Authoritative inputs:

1. `docs/audits/TAPREVIA_CENTRAL_REVIEW_AND_PERMANENT_URL_AUDIT.md`
2. `docs/audits/TAPREVIA_CENTRAL_REVIEW_AND_IMMUTABLE_URL_PHASE2.md`

This report verifies Phase 2 against the current source, classifies all 12 reported Gate-ON failures, revalidates the live local database, and proposes a staged implementation sequence. **No Stage A–F work was started.** No source code, schema, index, identifier, publication setting, migration, or deployment was changed.

### Method and evidence

- Read-only source inspection with line references.
- Read-only MongoDB queries against the local `nfc-crm` database.
- Read-only HTTP GET probes against the local app at `http://localhost:3000`.
- Static checks: `tsc --noEmit` and `npm run lint` (both passed).
- Phase 2 Gate-ON logs were used as the failure evidence (`/tmp/phase2-review-on.log`, `/tmp/phase2-standee-on.log`); the relevant source paths were re-inspected in the current tree.
- No write-based regression suite was executed during Phase 3.

### Safety note (disclosed up front)

The audit intentionally avoided write APIs and migrations. However, local HTTP GET probes to `/r/{...}` and `/c/{...}` exercised the application’s existing tap-analytics handlers. Those handlers wrote **6 `AnalyticsLog` rows** and incremented tap counters on three cards (details in §16). No customer identifiers, settings, publication state, or URL fields were changed. No cleanup/rollback was performed because deleting analytics would itself be a data write. This is disclosed rather than hidden.

---

## 1. Executive Summary

### 1.1 What Phase 2 actually achieved

Phase 2 did implement a real central-authority path:

- When central integration is active **and** a valid central `ReviewSettings` document exists, card and standee resolution uses central content and central publication.
- Legacy/hybrid content overrides are ignored for effective content on that path.
- Product-specific Google destinations are retained.
- The Review Management source/override buttons were removed from the main UI.
- New assignments through `assignUserProduct` now require a branded `publicSlug`.
- Published review cards render directly at `/{business}/{product}`.
- `/review/{alias}`, `/r/{routeSlug}`, standee panels, and `/standee-review/{routeSlug}` remain available.

### 1.2 The central design is not yet “central-only”

The resolver is still a **central-preferred** design, not a strict central-only design:

- If central integration is OFF, resolution returns to legacy behavior and a legacy `enabled=true` can publish a review.
- If the central document is missing, resolution falls back to legacy and can publish.
- If the central document is invalid, resolution falls back to legacy and can publish.
- Old clients can still write legacy/hybrid settings through `/api/cards/[id]` and the hybrid product-connection API. Those writes do not change effective content while central is active, but they persist and can become effective again if central is later turned OFF.
- The main UI still uses a `source: 'hybrid'` write during Google-destination setup, and two retired override dialogs remain in the tree unused.

**Conclusion:** the Phase 2 behavior is internally consistent for “central ON + valid central document,” but it does **not** satisfy the Phase 3 target that central settings are the only source of review content/publication and that missing/invalid central settings fail closed.

### 1.3 The 12 Gate-ON failures are not a code regression

All 12 failures are classified **A — obsolete expectation** or **A + C — obsolete expectation with a real compatibility decision**:

- 2 direct assertions still expect hybrid override content to win (`test-review-management.ts:1199`, `:1291`).
- 1 direct assertion still expects a hybrid URL override to replace the standee slot (`test-standee-review.ts:946`).
- 2 assertions still expect `source: 'legacy'` rollback to be accepted while central is ON (`test-review-management.ts:1329`, `:1446`).
- 7 failures are cascading test-state failures: an earlier failed assertion leaves `connectorRevision` / hard-coded revision numbers stale, so subsequent requests correctly receive `409`.

No evidence of a `B` (real regression) or `D` (security/concurrency defect) was found. Concurrency and stale-revision behavior that did run passed (`concurrency: simultaneous product connections have one winner`, the initial stale revision `409`, etc.).

### 1.4 URL system: strong for new assignments, incomplete around edges

- All 14 active card assignments and all 8 active standee assignments currently have a `publicSlug`.
- New assignments through `assignUserProduct` are hardened.
- The admin “link pending assignment” path still treats public-slug allocation as best-effort and returns success on failure (`src/app/api/admin/users/[id]/products/[userProductId]/card/route.ts:149-153`).
- The admin-only direct card creation path creates a card without `publicSlug` (`src/app/api/cards/route.ts:125-135`).
- Cross-collection uniqueness is application-level only and remains racy.
- A card re-bound to a different customer keeps its old `publicSlug`, which can expose the old business path under the new owner.
- A failed allocation on a pre-existing card can unbind/deactivate a card that was already owned by the same customer.

### 1.5 Missing-identifier findings changed materially from Phase 2

Phase 2 reported “10 missing publicSlug, 10 missing uid, 4 missing routeSlug.” That is numerically correct, but the audit found two important additions:

- **3 active legacy customer cards are not publicly resolvable at all** because `isActive` is missing and `withPublicCardVisibility` requires `isActive: true`. Their `/r/{cardUid}` probes returned `404`.
- The 4 cards missing `routeSlug` have **no `UserProduct` assignment and no catalog product link**, so the existing backfill scripts cannot allocate a correct product segment for them. They require manual classification.

### 1.6 The existing 404 is intentional; the dashboard status is not

Card `6aeae9d218200f2461c8cdcb` is a Google Review NFC Plate owned by an active customer with a valid plate assignment. Its central settings are valid but `general.enabled = false`. The branded URL correctly returns `404`; `/review/{alias}` returns `200` with the “Reviews aren’t available right now” state; `/r/{routeSlug}` returns `307` to the legacy review alias.

The routing is correct. The dashboard is not fully correct:

- The product list treats the legacy `/review/{alias}` as a “Public URL” even when the branded URL is not published (`src/app/(dashboard)/dashboard/products/page.tsx:312-320`).
- The product detail page uses the legacy `reviewAssistant.enabled` flag rather than effective central publication (`src/app/(dashboard)/dashboard/products/[id]/page.tsx:346-348`), so it can label the URL as live while the branded URL is 404.

### 1.7 AIO 3/4 status

AIO 3/4 remain automatically discoverable in Review Management with “Needs setup” state. All 6 review-capable standees in the live database (2 × Google Review Standee, 2 × AIO 3, 2 × AIO 4) currently have **empty Google Review slot destinations**, so none has a working standee review host yet. The panel URLs and `/standee-review/{routeSlug}` architecture are unchanged. A separate branded standee review URL is still design-only and requires approval.

### 1.8 Highest-priority findings

| Priority | Finding | Risk |
|---|---|---|
| P0 | Strict central-only is not enforced: gate OFF / missing central / invalid central can publish from legacy. | Customer-visible publication and content |
| P0 | 3 active legacy cards are publicly unreachable because `isActive` is missing. | Existing NFC/QR links broken |
| P1 | Re-binding a card with an existing `publicSlug` to a different customer can expose the old business path. | Cross-tenant brand/tenant confusion |
| P1 | Allocation failure can unbind a pre-existing, already-owned card. | Data integrity |
| P1 | Legacy/hybrid writes remain accepted under central ON and persist dormant configuration. | Rollback can resurrect overrides |
| P1 | Admin link path ignores `publicSlug` allocation failure and returns success. | Incomplete new records |
| P1 | Cross-collection slug allocation is not atomic. | Duplicate public URLs |
| P2 | Dashboard treats unpublished legacy review URLs as live/public. | Misleading operator status |
| P2 | Premium profile card with central enabled but legacy `enabled=false` gets no review link. | Missing review entry point |
| P2 | 4 orphan/legacy cards need manual classification before any repair. | Unsafe repair risk |

---

## 2. Phase 2 Implementation Verification

| Phase 2 claim | Verdict | Evidence / qualification |
|---|---|---|
| Central settings are authoritative when central integration is active and a valid central document exists. | **TRUE** | `src/lib/services/review-effective-settings.ts:62-97`; `review-product-eligibility.ts:172-198, 276-303`; `review-standee-settings.ts:320-352`. |
| Legacy `reviewSettingsSource` cannot change effective content under central authority. | **TRUE** | The central branch always passes `source: 'central'`; stored source is not consulted. |
| Legacy `reviewOverrides` cannot supersede central content. | **TRUE for content** | `resolveReviewSettings` central branch ignores `overrides` for content; `applyCardProductDestination` still reads only `googleReviewUrl` for destination. |
| Legacy `reviewOverrides` cannot supersede central publication. | **TRUE** | `enabled` comes from central `general.enabled`; overrides cannot change it on the central path. |
| Gate OFF / missing central / invalid central fall back to legacy. | **TRUE — this is the gap** | `review-effective-settings.ts:99-130`; `review-settings-resolver.ts:469-472`; `review-rollout.ts:167-177`. |
| UI source and override controls removed. | **PARTIAL** | Buttons removed from `review-management-client.tsx`; `hybrid-dialog.tsx` and `product-settings-dialog.tsx` remain present but unused. The setup flow still writes `source: 'hybrid'` (`review-management-client.tsx:643-648`). |
| New canonical assignments require a publicSlug. | **PARTIAL** | True in `user-product-assignment.ts:239-244, 333-337`; false in the admin link path (`admin/.../card/route.ts:149-153`) and direct admin card creation (`api/cards/route.ts:125-135`). |
| Shared Card/Standee publicSlug check added. | **TRUE but non-atomic** | `human-url.ts:166-172, 220-243, 284-311`; check-then-write across two collections. |
| Standee Google slot persists destination on first setup. | **TRUE** | `review-product-connection.ts:183-213, 313-342`. |
| Shared `ReviewExperience` used by branded and legacy routes. | **TRUE** | `src/components/review/review-experience.tsx`; `src/app/[business]/[product]/page.tsx:120-135`; `src/app/review/[alias]/page.tsx:46-93`. |
| Published review cards render directly at branded URL. | **TRUE** | `[business]/[product]/page.tsx:120-135`; live `/kaka-pvc/google-review` → `200`. |
| Unpublished branded review cards fail closed. | **TRUE** | `[business]/[product]/page.tsx:126-127`; live `/taprevia/google-review-2` → `404`. |
| Legacy `/review/{alias}` and `/r/{routeSlug}` preserved. | **TRUE** | Live `/review/digital-mw1uek1gzv` → `200` unavailable state; `/r/mw1uek1ij3` → `307`. |
| Customer data and production untouched in Phase 2. | **TRUE (no contrary evidence)** | Current live data still shows the same identifiers and settings; Phase 3 itself caused analytics-only writes (§16). |

---

## 3. Central-Only Architecture Gaps

### 3.1 Direct answers to the audit questions

**1. Does every eligible product use central settings when central integration is enabled?**  
**No, not universally.** It does when a valid central document exists. If the document is missing or invalid, the resolver falls back to legacy and can publish.

**2. Can `reviewSettingsSource` still change effective review content?**  
**Yes, when central integration is OFF.** `resolveEffectiveReviewSettingsSource` returns `legacy` for every product when central is disabled (`review-rollout.ts:174`). Under central ON with a valid document, the stored source is ignored.

**3. Can `reviewOverrides` still supersede central settings?**  
**Content: no on the central path. Destination: yes, intentionally.** A hybrid `googleReviewUrl` still wins as the product destination. Under gate OFF, all overrides can win again because hybrid resolution remains supported.

**4. Can legacy API requests restore custom review behavior?**  
**Not immediately under central ON, but they can persist dormant behavior.**  
- `/api/cards/[id]` PATCH still accepts the full `reviewAssistant` content payload (`src/lib/validation/card.ts:136-149, 211`; applied at `src/app/api/cards/[id]/route.ts:322-329`).  
- The product connection API still accepts `source: 'hybrid'` and writes overrides (`review-product-connection.ts:322-342`).  
- The Review Management setup UI uses that hybrid path (`review-management-client.tsx:643-648`).  
Effective content stays central while central is ON, but turning central OFF reactivates the stored overrides.

**5. What happens when central integration is disabled?**  
Legacy resolution is used. A legacy `reviewAssistant.enabled = true` can publish a review. This is the historical rollback behavior.

**6. What happens when central ReviewSettings is missing?**  
The resolver returns `legacy-fallback` and uses legacy content/publication (`review-settings-resolver.ts:469-472`; `review-effective-settings.ts:99-130`).

**7. What happens when central ReviewSettings is invalid?**  
Same as missing: complete legacy fallback. The invalid document is not partially merged (`review-settings-resolver.ts:469-472`).

**8. Can legacy settings publish a review when central settings are unavailable?**  
**Yes.** The Phase 2 suite explicitly verifies this: `src/scripts/test-review-management.ts:1642-1648` asserts that missing/invalid central pages are available and render “Legacy welcome.” That is the opposite of strict central-only fail-closed behavior.

**9. Are any product-specific publication or generation settings still active?**  
Yes:
- Legacy `enabled` is active whenever fallback is used.
- Hybrid `enabled` overrides are active under gate OFF.
- Card-level `reviewAssistant` content remains writable through `/api/cards/[id]`.
- Generation uses effective settings, so fallback settings also affect generation.

**10. Can old frontend clients bypass central authority?**  
They cannot change **effective** content while central is ON and valid. They can:
- write legacy/hybrid settings that persist,
- write a destination override,
- use the setup UI’s hybrid path,
- rely on legacy publication when the central gate is OFF.

### 3.2 Precise live impact of strict central-only

Live review-entitled assignments: **13 across 3 owners**.

| Owner | Products | Central state | Current effective state | Strict central-only impact |
|---|---|---|---|---|
| `kaka-pvc` (`prince@gmail.com`) | Premium card, Google Review Card, Google Review plate, Google Review Standee, AIO 3, AIO 4 | Valid, `enabled=true` | Central content + product destinations; 2 review cards published; standees setup-required | No publication loss. If the central gate is OFF in any environment, content would switch from legacy/hybrid to central (category `real-estate`, varied style/length). Customer-visible content change. |
| `taprevia` (`test4@gmail.com`) | Premium card, Google Review Card, Google Review plate, Google Review Standee, AIO 3, AIO 4 | Valid, `enabled=false` | Effective disabled; target branded URL 404 | Remains unpublished. No new loss. Publication requires enabling central. |
| `m12-verify@example.com` | One active Google Review Card assignment with no instance | Missing | Setup-required; no public review | Remains setup-required. No public loss. |

**No live, currently-published review product depends on legacy fallback.** The only live review product without central settings is an uninstantiated verification assignment. Therefore strict central-only is low-risk for live publication, but it changes gate-OFF rollback semantics and would keep the target 404 until central publication is enabled.

The 4 legacy cards with no review assignment are not affected by review central-only; they are affected by the separate `isActive`/identifier issues in §7.

### 3.3 Recommended strict central-only semantics

Recommended staged model:

1. **Central ON + valid central:** central content, central publication, product destination. (Current behavior.)
2. **Central ON + missing/invalid central:** fail closed for publication (`enabled=false`), but keep legacy content available for setup/preview display if useful. Do not publish.
3. **Central OFF:** either (a) keep legacy temporarily as a controlled rollback, or (b) fail closed for review-entitled products. Option (a) preserves the existing operational kill switch; option (b) is the literal “central-only” target. **Owner decision required.**
4. **All eligible products:** reject/ignore legacy content writes while central is active. Allow destination-only updates through one explicit path.
5. **Stored legacy data:** never delete or rewrite. Keep it for rollback/audit.
6. **UI:** show “Setup required — central review settings missing/invalid” rather than “Central Review Management” when central is not actually authoritative.

---

## 4. All 12 Gate-ON Failures — Individual Analysis

Evidence files:

- `/tmp/phase2-review-on.log` — 49/58 passed, 9 failures.
- `/tmp/phase2-standee-on.log` — 17/20 passed, 3 failures.

Classification key:

- **A** = obsolete expectation (retired hybrid/legacy behavior).
- **B** = real regression.
- **C** = compatibility decision required.
- **D** = security/concurrency/data-integrity issue.

### 4.1 Summary table

| # | Test | File:line | Expected | Actual | Classification | Production change? | Risk |
|---|---|---|---|---|---|---|---|
| 1 | `preview API: legacy/central/hybrid/fallback are read-only and correct` | `scripts/test-review-management.ts:1199` | `source === 'legacy'` for `apiProduct` | `source === 'central'` | A | Yes (intended central content) | Medium |
| 2 | `connection: hybrid accepts the full supported override set` | `scripts/test-review-management.ts:1291` | `welcomeMessage === 'Connector welcome'` | central welcome, override ineffective | A | Yes (intended) | Medium/High |
| 3 | `connection: removing overrides returns to central values` | `scripts/test-review-management.ts:1302` | `200` | `409` | A (cascade) | No | Low |
| 4 | `connection: unknown/legacy override keys are preserved` | `scripts/test-review-management.ts:1320` | `200` | `409` | A (cascade) | No | Low |
| 5 | `connection: legacy rollback restores exact legacy state` | `scripts/test-review-management.ts:1329` | `200` then legacy | `400` | A + C | Yes (legacy write blocked under central ON) | Medium |
| 6 | `connection: repeated cycles remain reversible` | `scripts/test-review-management.ts:1339` | central `200` | `409` | A (cascade) | No | Low |
| 7 | `connection: stale revision returns 409 and retry succeeds` | `scripts/test-review-management.ts:1446` | retry `200` | retry `400` | A + C | Yes (retry uses legacy) | Medium |
| 8 | `concurrency: settings update + product connection remain consistent` | `scripts/test-review-management.ts:1515` | connection `200` | `409` | A (cascade) | No | Low |
| 9 | `compatibility: aliases, templates, rotation history and reviewAssistant survive` | `scripts/test-review-management.ts:1675` | connection `200` | `409` | A (cascade) | No | Low |
| 10 | `management: save central then connect Standee central/hybrid/legacy reversibly` | `scripts/test-standee-review.ts:946` | hybrid URL override wins | standee slot URL wins | A | Yes (intended slot authority) | Medium |
| 11 | `management: stale revision, parallel connection and security boundaries` | `scripts/test-standee-review.ts:998` | `200,409` | `409,409` | A (cascade) | No | Low |
| 12 | `management: unknown override keys survive Standee updates` | `scripts/test-standee-review.ts:1063` | `200` | `409` | A (cascade) | No | Low |

### 4.2 Detailed analysis

#### Failure 1 — legacy preview now resolves central

- **Test:** `scripts/test-review-management.ts:1193-1228`, failing assertion at `:1199`.
- **Expected:** `legacyBody.source === 'legacy'` for `assignments.apiProduct` (owner `users.apiuser`).
- **Actual:** `central`.
- **Root cause:** the seed creates valid, enabled central settings for `users.apiuser` (`scripts/test-review-management.ts:588-595`). With Gate ON, central authority ignores the card’s stored legacy source and uses central content. The destination assertion at `:1200` still passes because the card’s legacy Google URL is retained as the product destination.
- **Classification:** **A**.
- **Recommended correction:** assert `source === 'central'`, central welcome `API central welcome`, and destination still `legacy-api-review`; add/retain a Gate-OFF case that asserts `legacy`. This preserves coverage of both contracts.
- **Production vs test:** production behavior is intentionally changed; only the test expectation must change.
- **Risk:** Medium — central content becomes customer-visible for legacy cards when the gate is ON.

#### Failure 2 — hybrid content override no longer wins

- **Test:** `scripts/test-review-management.ts:1264-1295`, failing assertion at `:1291`.
- **Expected:** preview `welcomeMessage === 'Connector welcome'` from the hybrid override.
- **Actual:** central welcome; the override is not effective.
- **Root cause:** `connectReviewProduct` still stores the hybrid overrides, but the effective resolver ignores content overrides under central authority (`review-settings-resolver.ts:474-482`; `review-product-eligibility.ts:191-198`).
- **Classification:** **A**.
- **Recommended correction:** assert central values and assert the stored override exists but is ineffective; or, if strict central-only rejects hybrid writes, assert `400` and remove the stored-override expectation. Do not delete the test.
- **Production vs test:** production behavior intentionally changed; test must change.
- **Risk:** Medium/High — any customer relying on hybrid content loses that customization when the gate is ON.

#### Failure 3 — `409` after the revision variable was not advanced

- **Test:** `scripts/test-review-management.ts:1296-1308`, failing at `:1302`.
- **Expected:** `200` for `{ source:'hybrid', revision: connectorRevision, overrides:{enabled:false} }`.
- **Actual:** `409`.
- **Root cause:** the previous check failed at `:1291` before executing `connectorRevision = 2` at `:1294`. The DB is already at revision 2; this request still sends revision 1. The conflict is correct behavior.
- **Classification:** **A (test cascade)**.
- **Recommended correction:** derive the current revision from the API or DB before each write, or isolate each check with its own fixture. Do not change the conflict logic.
- **Production vs test:** test-only.
- **Risk:** Low.

#### Failure 4 — `409` from the same stale revision

- **Test:** `scripts/test-review-management.ts:1309-1325`, failing at `:1320`.
- **Expected:** `200`.
- **Actual:** `409`.
- **Root cause:** same stale `connectorRevision` as failure 3.
- **Classification:** **A (test cascade)**.
- **Recommended correction:** same revision isolation; then assert unknown keys are preserved under hybrid storage while effective content remains central.
- **Production vs test:** test-only.
- **Risk:** Low.

#### Failure 5 — legacy rollback is rejected under central ON

- **Test:** `scripts/test-review-management.ts:1326-1336`, failing at `:1329`.
- **Expected:** `200` and `reviewSettingsSource === 'legacy'`.
- **Actual:** `400` with “Central Review Management is active for this product. Product-specific review settings cannot be enabled while Central Public Review Integration is on.”
- **Root cause:** explicit guard in `review-product-connection.ts:114-126`.
- **Classification:** **A + C**.
- **Recommended correction:** under central ON, assert `400` and assert no stored changes. Under Gate OFF, keep a separate test that performs the exact legacy rollback and verifies aliases/`reviewAssistant` are unchanged. If the owner needs an operational rollback while central is ON, add a separate admin-only path with explicit confirmation and audit logging; do not silently re-enable legacy.
- **Production vs test:** production behavior intentionally changed; compatibility decision required.
- **Risk:** Medium — old clients that call `source:'legacy'` while central is ON now get `400`.

#### Failure 6 — central write conflicts after the cascade

- **Test:** `scripts/test-review-management.ts:1337-1345`, failing at `:1339`.
- **Expected:** central `200`.
- **Actual:** `409`.
- **Root cause:** `connectorRevision` is still 1; the DB is at revision 2.
- **Classification:** **A (test cascade)**.
- **Recommended correction:** derive the revision from the API.
- **Production vs test:** test-only.
- **Risk:** Low.

#### Failure 7 — stale-revision retry uses a blocked legacy write

- **Test:** `scripts/test-review-management.ts:1442-1448`, failing at `:1446`.
- **Expected:** stale `409`, then retry `200`.
- **Actual:** stale `409` passes; retry `400`.
- **Root cause:** the retry uses `source: 'legacy'` (`:1445`), which is blocked under central ON by `review-product-connection.ts:114-126`.
- **Classification:** **A + C**.
- **Recommended correction:** retry with `source: 'central'`; add a Gate-OFF test for a legacy retry. Keep the stale-revision `409` assertion unchanged.
- **Production vs test:** production change is intentional; compatibility decision for legacy clients.
- **Risk:** Medium.

#### Failure 8 — settings + connection concurrency test hits stale revision

- **Test:** `scripts/test-review-management.ts:1505-1519`, failing at `:1515`.
- **Expected:** connection `200`.
- **Actual:** connection `409`.
- **Root cause:** `connectorRevision` is stale from the earlier failures; the concurrent settings write also increments the settings revision, but the card connection revision is independent. The card is still at version 2 while the test sends 1.
- **Classification:** **A (test cascade)**.
- **Recommended correction:** read the card’s current `reviewSettingsVersion` before the parallel calls; assert the settings write and connection are individually consistent, allowing one conflict only if the test intentionally races the same revision.
- **Production vs test:** test-only.
- **Risk:** Low.

#### Failure 9 — compatibility test hits stale revision

- **Test:** `scripts/test-review-management.ts:1670-1686`, failing at `:1675`.
- **Expected:** central connection `200`.
- **Actual:** `409`.
- **Root cause:** stale `connectorRevision` from the cascade.
- **Classification:** **A (test cascade)**.
- **Recommended correction:** derive the revision; retain the alias/template/rotation/`reviewAssistant` assertions. Add a central-authority assertion for the effective source.
- **Production vs test:** test-only.
- **Risk:** Low.

#### Failure 10 — standee hybrid URL override no longer replaces the slot

- **Test:** `scripts/test-standee-review.ts:876-979`, failing at `:946`.
- **Expected:** preview `googleReviewUrl === 'https://example.test/new-hybrid-url'`.
- **Actual:** the standee’s own slot URL `https://example.test/new-standee-google`.
- **Root cause:** standee resolution treats the Google slot as authoritative. Under central authority, `resolveStandeeEffectiveReviewSettings` forces `input.googleReviewUrl` (`review-standee-settings.ts:201-213`), and `connectReviewProduct` may remove the URL override on first-time slot persistence (`review-product-connection.ts:313-320`).
- **Classification:** **A**.
- **Recommended correction:** expect the slot URL; assert the hybrid override is stored (if hybrid writes remain allowed) but ineffective. Add a Gate-OFF hybrid test if legacy override behavior must remain covered.
- **Production vs test:** production behavior intentionally changed; test must change.
- **Risk:** Medium — customers who used a hybrid URL to override a standee slot lose that override under central authority.

#### Failure 11 — parallel standee test uses stale hard-coded revision

- **Test:** `scripts/test-standee-review.ts:980-1048`, failing at `:998`.
- **Expected:** one `200`, one `409`.
- **Actual:** `409, 409`.
- **Root cause:** failure 10 aborted the test before the `revision: 2` and `revision: 3` writes. The DB is at version 2, but the parallel test sends `revision: 4`.
- **Classification:** **A (test cascade)**.
- **Recommended correction:** read the current version before the parallel requests; assert exactly one winner and the final version.
- **Production vs test:** test-only.
- **Risk:** Low.

#### Failure 12 — unknown standee override keys test uses stale revision

- **Test:** `scripts/test-standee-review.ts:1049-1068`, failing at `:1063`.
- **Expected:** `200`.
- **Actual:** `409`.
- **Root cause:** DB version 2 vs requested revision 5, caused by the earlier aborted writes.
- **Classification:** **A (test cascade)**.
- **Recommended correction:** derive the revision; assert unknown keys are preserved under hybrid storage and effective standee content remains central.
- **Production vs test:** test-only.
- **Risk:** Low.

### 4.3 Required replacement assertions (coverage-preserving)

The corrected suites should include, at minimum:

1. **Central ON + valid central:** legacy source → central content; product destination retained.
2. **Central ON + hybrid stored overrides:** effective content central; destination product-specific; stored data untouched.
3. **Central ON + `source:'legacy'` write:** `400`; no stored change.
4. **Gate OFF + legacy:** exact legacy resolution; legacy rollback works.
5. **Gate OFF + hybrid:** hybrid override still applies (historical contract), or explicitly retired with owner approval.
6. **Stale revisions:** `409` independently for card and standee; retry with an allowed source succeeds.
7. **Parallel connections:** one winner; final version consistent.
8. **Unknown override keys:** preserved if hybrid storage remains allowed; never affect effective central content.
9. **Standee hybrid URL:** slot wins under central; gate-OFF hybrid override behavior covered separately.
10. **Compatibility:** aliases, templates, rotation history, and legacy `reviewAssistant` unchanged.

No test should be skipped or deleted to make the suite pass.

---

## 5. Permanent URL Lifecycle Findings

### 5.1 Lifecycle trace

| Stage | Card | Standee | Verdict |
|---|---|---|---|
| Product assignment | `assignUserProduct` → `provisionCardForAssignment` → `allocateCardRouteSlug` → `ensureCardPublicSlug` | `assignUserProduct` → `allocateStandeeRouteSlug` → `Standee.create` → `ensureStandeePublicSlug` | Mostly correct for the canonical path |
| Instance creation | Card created with `cardUid`, `slug`, `routeSlug`, `uid`; `publicSlug` added after `UserProduct.create` | Standee created with `routeSlug`, `uid`, `panelQr`, `socialQrs`; `publicSlug` added after `UserProduct.create` | Correct |
| Identifier persistence | Conditional update only when field is empty; unique sparse indexes | Same | Correct within each collection |
| Public routing | `getPublicCardByPublicSlug` requires `isActive: true`; `/r` resolves routeSlug/uid then legacy cardUid/slug/urlAlias | `getPublicStandeeByPublicSlug`; `/r` resolves routeSlug/uid | Correct, except legacy `isActive` issue |
| NFC/QR generation | `/r/{routeSlug}`; public QR uses `publicSlug` (`api/my/qr/route.ts`) | `/r/{routeSlug}`; panel QR uses `panelQr.qrId`; slot QR uses `socialQrs[].qrId` | Correct |
| Product update | `findImmutableUrlChange` guards `routeSlug`, `uid`, `publicSlug`, `urlAlias`, `slug` | `findImmutableStandeeChange` guards top-level identifiers plus `panelQr.qrId` and slot QR IDs/platforms | Correct |
| Replacement | `replaceCardForAssignment` changes only `cardUid`; keeps route/alias/public | Not applicable | Correct |

### 5.2 Verified strengths

- All 14 active card assignments and all 8 active standee assignments have a `publicSlug` (read-only query).
- No duplicate existing `publicSlug`, `routeSlug`, or `urlAlias` values.
- No current Card/Standee `publicSlug` collisions.
- All current `publicSlug` first segments match the owner’s `bizSlug`.
- Review settings changes do not touch identifiers.
- Business-name changes do not regenerate `bizSlug` (`ensureUserBizSlug` returns the existing value).
- Product changes do not regenerate `routeSlug`, `uid`, or `publicSlug`.
- Card replacement preserves the permanent route and public identity (`card-replacement.ts:58-71`).
- Update APIs return `403` for changed identifiers and tolerate identical values for legacy/idempotent clients (`url-identity.ts:54-70`; `api/cards/[id]/route.ts:175-188`; `my/products/[id]/config/route.ts:93-104, 231-244`).

### 5.3 Gaps

#### G1 — Admin link path is still best-effort

`src/app/api/admin/users/[id]/products/[userProductId]/card/route.ts:149-153`:

```ts
try {
  await ensureCardPublicSlug(card._id, user._id.toString());
} catch (error) {
  console.error('ensureCardPublicSlug failed:', error);
}
return ok({ ... linked: true });
```

A failed allocation still returns success and leaves the newly linked card without a branded URL. This violates the Phase 2 guarantee for this path.

#### G2 — Admin direct card creation has no publicSlug

`src/app/api/cards/route.ts:125-135` creates a Card with `slug`, `urlAlias`, `routeSlug`, and `uid`, but no `publicSlug`. This is admin-only provisioning, but it is still a “new card” path. If the card is later assigned, `ensureCardPublicSlug` can fill it; until then it has no branded URL.

#### G3 — Cross-collection allocation is not atomic

`publicSlugTaken` (`human-url.ts:166-172`) checks both collections, then writes only one. Two concurrent allocations can both observe no collision and write the same path into different collections. See §6.

#### G4 — Existing `publicSlug` is reused across owners

`ensureCardPublicSlug` returns immediately when `card.publicSlug` exists (`human-url.ts:193`) without checking that the first segment matches the current owner’s `bizSlug`. `unbindAssignedCard` deliberately keeps the public URL (`card-access.ts:218-233`), and `provisionCardForAssignment` claims unbound cards (`card-identity.ts:156-175`). A card re-bound to a different customer can therefore serve the new customer at `old-business/product`.

This is currently latent: no live `publicSlug` first segment mismatches its owner. It is a high-risk edge for resale/reassignment.

#### G5 — Allocation failure can unbind a pre-existing owned card

`user-product-assignment.ts:247-268`:

- If the card was created in this call → delete it (correct).
- Otherwise → reset `assignedUserId`, `userId`, `status`, `isActive`, and `kind: 'profile'`.

The `created` flag only distinguishes “created now” from “found/claimed.” It does not distinguish “already owned by this same customer” from “unbound inventory.” A failure after provisioning a card that the same customer already owned can unbind/deactivate it and reset its kind. The requirement says rollback must never delete or disturb a pre-existing customer-owned instance.

`customer-creation.ts:52-87` uses the same release pattern, but there the user is new, so the risk is lower.

#### G6 — Returned slug may not be the persisted slug

`ensureCardPublicSlug` (`human-url.ts:236-238`) returns `card.publicSlug || publicSlug` when `modifiedCount === 0`. If another request won the race, the local `card.publicSlug` may still be empty while the database has a different value, so the returned slug can differ from the stored one. Callers currently only check `assigned`, but the contract is misleading and could cause future bugs.

#### G7 — Legacy `isActive` blocks public resolution

`withPublicCardVisibility` adds `isActive: true` (`card-access.ts:32`). The Card schema default is `true` (`models/Card.ts:152`), but three active legacy cards lack the field entirely. They return `404` from `/r/{cardUid}`, `/c/{slug}`, and `/profile/{slug}`. This is a direct existing-customer breakage and is not a missing-`publicSlug` problem. See §7.

### 5.4 Public route ownership assessment

- Current `publicSlug` ownership is consistent.
- `urlAlias` is immutable and resolved globally; a card alias always wins over a business slug (`card-access.ts:172-183`). This preserves existing links but means a legacy card alias can shadow a later business slug if its `isActive` is repaired.
- The `taprevia` legacy card (owner `one@gmail.com`) has `slug: "taprevia"` and `isActive` missing. It currently does not shadow `test4@gmail.com`’s `bizSlug: "taprevia"` only because it is excluded by `isActive: true`. If someone “repairs” `isActive` without addressing the slug, `/profile/taprevia` would resolve the legacy card instead of the business. This is a repair-order hazard.

---

## 6. Shared Namespace / Concurrency Risks

### 6.1 Current mechanism

- Card `publicSlug`: unique sparse index (`models/Card.ts:289`).
- Standee `publicSlug`: unique sparse index (`models/Standee.ts:113`).
- Shared check: `publicSlugTaken` queries both collections (`human-url.ts:166-172`).
- Allocation loop: count same-collection occurrences, add `collisionOffset`, check shared, then conditional update.
- Duplicate-key errors advance the offset and retry.

### 6.2 Race analysis

Two simultaneous requests:

1. Card request checks `publicSlugTaken('biz/x')` → false.
2. Standee request checks `publicSlugTaken('biz/x')` → false.
3. Card writes `biz/x` to `cards` (unique index in `cards` passes).
4. Standee writes `biz/x` to `standees` (unique index in `standees` passes).

Both succeed. The application-level check cannot prevent this because there is no shared unique constraint across the two collections.

The same pattern can occur for two different cards in different businesses? No — `bizSlug` is per owner and unique. The risk is specifically Card vs Standee under the same business namespace.

### 6.3 Recommended options (no schema change now)

**Option 1 — Deterministic disjoint namespaces (recommended, no schema change).**  
Card paths use a fixed product segment (`business-card`, `premium-card`, `instagram`, `google-review`, `linkedin`, `facebook`). Standee paths use the reserved `standee` segment; the proposed review URL uses `review-standee`. None of the card product segments equals `standee` or `review-standee`. If this invariant is enforced in code and validated at startup/CI, cross-collection collisions are structurally impossible for new allocations. Keep the shared check as defense-in-depth.

**Option 2 — Post-write verification and rollback (defense-in-depth, no schema change).**  
After writing, re-query both collections for the allocated path. If a duplicate is found, unset the just-written value (conditional on it still equaling the value we wrote) and retry with an incremented offset. This closes the race probabilistically but has a short window where both URLs resolve, and two contenders can both roll back (livelock); add jitter/backoff and a bounded retry.

**Option 3 — Shared reservation registry (requires approval).**  
A new `PublicUrlReservation` collection with a unique index on `slug`, written before the Card/Standee update, would make cross-collection allocation atomic. This is the only fully database-safe solution, but it adds a collection/index and a migration/backfill. Do not implement without explicit approval.

**Recommendation:** implement Option 1 now as a code-only invariant, keep Option 2 as a safety net, and defer Option 3 unless the owner requires a strict shared namespace guarantee.

---

## 7. Missing Identifier Classification and Repair Plan

### 7.1 Revalidated live snapshot (read-only)

| Metric | Value |
|---|---|
| Cards | 24 |
| Standees | 8 |
| Catalog products | 11 |
| Active UserProduct assignments | 23 |
| Cards with `publicSlug` | 14 |
| Cards with `routeSlug` | 20 |
| Cards with `uid` | 14 |
| Cards with `urlAlias` | 20 |
| Cards missing `publicSlug` | 10 |
| Cards missing `uid` | 10 |
| Cards missing `routeSlug` | 4 |
| Duplicate existing `publicSlug` | 0 |
| Duplicate existing `routeSlug` | 0 |
| Duplicate existing `urlAlias` | 0 |
| Cross-collection `publicSlug` collisions | 0 |
| Active card assignments missing `publicSlug` | 0 |
| Active standee assignments missing `publicSlug` | 0 |
| Review-capable standees missing Google slot URL | 6 of 6 |

### 7.2 Affected records

#### Group A — 4 legacy customer cards with no identifiers

| Card ID | Owner | Existing identifiers | Missing | `isActive` | Publicly resolvable | Classification | Recommended action | Risk |
|---|---|---|---|---|---|---|---|---|
| `6a87e9c84ceaba7e811d2fed` | `one@gmail.com` | `cardUid=R05YSIIG`, `slug=taprevia`, `status=active` | alias, route, uid, public | undefined | **No** (`/r/R05YSIIG` → 404) | Active legacy customer product; requires owner confirmation | Do not touch yet. Confirm the physical card and product type. Repair `isActive` only after resolving the `taprevia` slug collision. Allocate `routeSlug`/`uid`; do not overwrite `slug`. | High |
| `6a881ee9e30913cf3fe1f979` | `two@gmail.com` | `cardUid=2BHKLIY2`, `slug="panthi events"`, `status=active` | alias, route, uid, public | undefined | **No** (`/r/2BHKLIY2` → 404) | Active legacy customer product; requires owner confirmation | Confirm physical card/product type. `slug` contains a space and is not a valid public path; do not rewrite it without approval. Allocate route/uid and a new publicSlug after product mapping. | High |
| `6a8878b55f1322f8f0ecb978` | `three@gmail.com` | `cardUid=LWHDAAKZ`, `slug=ui3`, `status=active` | alias, route, uid, public | undefined | **No** (`/r/LWHDAAKZ` → 404) | Active legacy customer product; requires owner confirmation | Confirm product type. Allocate route/uid; add publicSlug only after product mapping. | High |
| `6a9274dcc538bd6293e5a9d6` | `het@gmail.com` | `cardUid=1D:47:97:0B:66:00:00`, `slug=1d-47-97-0b-66-00-00`, `status=active` | alias, route, uid, public | true | **Yes** (`/r/{cardUid}` → `/c/{slug}` → `/profile/{slug}`) | Active legacy customer product (working legacy routes) | Preserve all existing links. Allocate `routeSlug`/`uid`; do not change `slug`. PublicSlug optional; if added, verify no collision. | Medium |

None of these 4 has a `UserProduct` assignment. The existing `backfill-public-slugs.ts` only iterates `UserProduct` rows with `cardId` and skips `!card.isActive` (`scripts/backfill-public-slugs.ts:26-48`), so it would skip all four. They require a separate, manually mapped repair.

#### Group B — 6 review cards owned by the verification account

| Card ID | Owner | Existing identifiers | Missing | `isActive` | Analytics evidence | Classification | Recommended action | Risk |
|---|---|---|---|---|---|---|---|---|
| `6aeaf75a2c28aca802c32077` | `m12-verify@example.com` | `alias=m12verify01`, `route=m12r-m12verify01`, `cardUid=M12-VERIFY-01` | uid, public | true | 5 `analyticslogs` rows (review generation/suggestions) | Test/verification fixture (synthetic UID/naming); still owner-confirm | If retained, set `uid=routeSlug` (safe) and allocate `m12-verify/google-review[-N]`. If test-only, retire only with owner approval. | Low/Medium |
| `6aeaf75a2c28aca802c32078` | same | `alias=m12verify02`, `route=m12r-m12verify02` | uid, public | true | 0 | Test/verification fixture | Same | Low |
| `6aeaf75a2c28aca802c32079` | same | `alias=m12verify03`, `route=m12r-m12verify03` | uid, public | true | 0 | Test/verification fixture | Same | Low |
| `6aeaf75a2c28aca802c3207a` | same | `alias=m12verify04`, `route=m12r-m12verify04` | uid, public | true | 0 | Test/verification fixture | Same | Low |
| `6aeaf75a2c28aca802c3207b` | same | `alias=m12verify05`, `route=m12r-m12verify05` | uid, public | true | 0 | Test/verification fixture | Same | Low |
| `6aeaf75a2c28aca802c3208d` | same | `alias=m14verifybare`, `route=m14r-m14verifybare` | uid, public | true | 0 | Test/verification fixture | Same | Low |

The owner has one active `google-review-card` `UserProduct` assignment with **no `cardId`** (`pendingConfig`). These 6 cards are not linked to that assignment. `ensureCardPublicSlug` would return `assigned:false` because it cannot resolve an active assignment for these card IDs. A repair needs an explicit mapping or assignment repair first.

#### Group C — uninstantiated assignment

`m12-verify@example.com` also has an active `google-review-card` assignment with no instance. It is not in the missing-identifier list, but it is an uninstantiated/orphan-like assignment. Classify as test/verification fixture until the owner confirms.

### 7.3 Proposed repair strategy (dry-run only)

1. **Freeze the current values** in a read-only manifest: card ID, owner, existing identifiers, `isActive`, `status`, assignment IDs, and current public routes.
2. **Classify first, allocate second.** Do not allocate any value for a record with no confirmed product type.
3. **Do not overwrite** `publicSlug`, `routeSlug`, `uid`, `urlAlias`, or `slug`. Only fill empty fields.
4. **`uid`:** use the existing `routeSlug` when present; otherwise allocate a new timestamp `uid`. This does not change current routing.
5. **`routeSlug`:** allocate through `allocateCardRouteSlug()` only for the 4 legacy cards, after owner confirmation. Preserve `cardUid` and `slug` so `/r/{cardUid}` and `/c/{slug}` continue to work.
6. **`urlAlias`:** do not allocate for legacy cards unless the owner explicitly wants `/review/{alias}` or `/profile/{alias}`. `slug` already provides a legacy handle for the working card.
7. **`publicSlug`:**
   - Review cards: `{bizSlug}/google-review[-N]`.
   - Premium/plate/card products: `{bizSlug}/{product-publicSlug}[-N]`.
   - Legacy cards with no product mapping: **do not guess**; require a mapping.
8. **Collision checks:** within `Card`, within `Standee`, and across both; then rely on the same-collection unique index for races. For cross-collection, use the deterministic namespace invariant or post-write verification (§6).
9. **`isActive` repair:** only after owner confirmation; treat it as a separate change. For the `taprevia` legacy card, resolve the slug collision first, or the business profile will be shadowed.
10. **Idempotency:** every write is conditional on the field being empty. Re-running the repair is a no-op.
11. **No publication:** allocating `publicSlug` must not enable central review settings or publish any page.
12. **Dry-run acceptance:** the dry-run output must list every proposed value and collision check; the owner must approve the manifest before `--apply`.

### 7.4 Explicitly not assigned

**No identifier was generated, repaired, or written during this audit.** The values above are candidate patterns, not assignments.

### 7.5 Existing links that must remain functional

- `/r/R05YSIIG`, `/r/2BHKLIY2`, `/r/LWHDAAKZ` — currently 404 because of `isActive`; after approval, they must resolve to the same card.
- `/r/1D:47:97:0B:66:00:00` → `/c/1d-47-97-0b-66-00-00` → `/profile/1d-47-97-0b-66-00-00` — currently working; must not break.
- `/review/m12verify01..05`, `/review/m14verifybare` — currently 200 (verification fixtures); must remain if retained.
- `/r/m12r-*`, `/r/m14r-*` — currently 307; must remain if retained.

---

## 8. AIO 3/4 Branded Review URL Recommendation

### 8.1 Current architecture

- Standee panel: `publicSlug` = `{business}/standee[-N]`.
- Review host: `/standee-review/{routeSlug}`.
- Permanent entry: `/r/{routeSlug}` (and `/r/{routeSlug}/{slot}`).
- The panel `publicSlug` is **not** a review URL and must not be reused as one.

Live review-capable standees:

| Product | Count | Panel publicSlug | Google slot URL | Review host |
|---|---|---|---|---|
| Google Review Standee | 2 | `kaka-pvc/standee-2`, `taprevia/standee` | empty | unavailable (200 “Reviews aren’t available”) |
| All In One Standee – 3 Profile | 2 | `kaka-pvc/standee-4`, `taprevia/standee-3` | empty | unavailable |
| All In One Standee – 4 Profile | 2 | `kaka-pvc/standee-5`, `taprevia/standee-4` | empty | unavailable |

All 6 are discoverable in Review Management with “Needs setup.” That is correct: they need a Google Review slot destination.

### 8.2 Recommended architecture

| Item | Recommendation |
|---|---|
| Field | New immutable `reviewPublicSlug` on `Standee` |
| Format | `{business}/review-standee[-N]` |
| Allocation timing | At product creation for review-capable standees (`GOOGLE_REVIEW_STANDEE`, `ALL_IN_ONE_STANDEE_3`, `ALL_IN_ONE_STANDEE_4`), not at first Google setup |
| Allocation function | New `ensureStandeeReviewPublicSlug()` in `human-url.ts`, using the same monotonic allocator and shared namespace check |
| Route resolution | Add a review branch to `src/app/[business]/[product]/page.tsx` when the second segment matches a standee `reviewPublicSlug` |
| Publication | Render only when `STANDEE_REVIEW_ASSISTANT_ENABLED`, the new branded flag is on, `resolveStandeeReviewHost` returns a host, and effective settings are enabled; otherwise `notFound()` |
| Destination | Existing `google_review` slot only; never central URL by default |
| Legacy compatibility | Keep panel `publicSlug`, `/standee-review/{routeSlug}`, `/r/{routeSlug}`, NFC/QR payloads, and analytics |
| Analytics | Log one `review_page_view` with `standeeId` and metadata `standee-review:{routeSlug}:branded`; pass `trackPageView={false}` if logging manually, or use the Flow’s default once — never both |
| Collision prevention | `review-standee` is not a card product segment; still run the shared Card/Standee check and add a unique sparse index |
| Immutability | Add `reviewPublicSlug` to `STANDEE_IMMUTABLE_URL_FIELDS`; never regenerate |
| Google Review Standee | Same design; its single-purpose panel may continue redirecting to the review host, but its branded review URL is a separate field |
| Feature flag / rollback | New `STANDEE_BRANDED_REVIEW_URL_ENABLED`; when off, the branded route fails closed; panel and `/standee-review` remain |
| Schema impact | New `reviewPublicSlug` field + unique sparse index; migration/backfill for existing review-capable standees; **requires approval** |

### 8.3 Why allocate at creation instead of first setup

- The URL is supposed to be permanent; making it depend on a later optional setup means the identity does not exist for the standee’s whole life.
- Allocation at creation can participate in the existing assignment rollback: if allocation fails, the standee assignment fails cleanly.
- First-setup allocation would mutate identity during a customer action and risk leaving a standee with a panel URL but no review URL.

### 8.4 Existing standee backfill

- Only review-capable standees (6 live) get `reviewPublicSlug`.
- Non-review standees (Business Profile Standee) do not.
- Idempotent, additive, no panel URL change.
- No publication.
- Requires owner approval because it creates new identifiers and a schema field.

### 8.5 Exact files for Stage D (future, not now)

- `src/models/Standee.ts` — add field + index.
- `src/lib/services/human-url.ts` — allocator + resolver.
- `src/lib/services/url-identity.ts` — immutable field list.
- `src/lib/services/user-product-assignment.ts` — allocate at creation for review-capable standees.
- `src/app/[business]/[product]/page.tsx` — branded standee review branch.
- `src/lib/services/review-standee-settings.ts` — expose a resolved branded host.
- `src/lib/services/product-preview.ts` — prefer branded review URL when eligible.
- `src/app/api/my/products/route.ts`, `src/app/api/my/products/[id]/route.ts` — expose `reviewPublicUrl` separately.
- `src/components/dashboard/standee-manager.tsx` — display the branded review URL separately from the panel URL.
- `src/lib/review-feature-flags.ts` — new flag.
- New `scripts/backfill-standee-review-public-slugs.ts` — dry-run first.

---

## 9. Existing 404 and Publication Findings

### 9.1 Rechecked live state

| Item | Value |
|---|---|
| Card ID | `6aeae9d218200f2461c8cdcb` |
| Kind | `review` |
| `isActive` / `status` | `true` / `active` |
| Owner | `test4@gmail.com` (`Taprevia Technologies`) |
| Owner status | `active` |
| `publicSlug` | `taprevia/google-review-2` |
| `urlAlias` | `digital-mw1uek1gzv` |
| `routeSlug` / `uid` | `mw1uek1ij3` |
| Assignment | active `google-review-nfc-plate` (`6aeae9d218200f2461c8cdd2`) |
| `reviewSettingsSource` | `central` |
| Central `schemaVersion` | `1` (valid) |
| Central `general.enabled` | **`false`** |
| Central `general.googleReviewUrl` | empty |
| Legacy `reviewAssistant.enabled` | `true` |
| Legacy Google URL | `https://g.page/r/CV88rZ6GBWuREBM/review` (supported) |
| Central content | category `real-estate` (active), English, friendly/medium, varied modes |
| Entitlement | plate grants `review_ai_suggestions` |
| Effective publication | **disabled** |

### 9.2 Route behavior

| Route | Result | Meaning |
|---|---|---|
| `/taprevia/google-review-2` | `404` | Correct fail-closed for unpublished central review |
| `/review/digital-mw1uek1gzv` | `200` | “Reviews aren’t available right now” state, not the review flow |
| `/r/mw1uek1ij3` | `307` → `/review/digital-mw1uek1gzv` | Permanent route preserved |
| `/taprevia/google-review` (sibling review card) | `404` | Same central disabled state |
| `/taprevia/premium-card` | `200` | Profile card renders; no review link because legacy disabled and central disabled |

### 9.3 Is there any additional gating?

No additional blocker was found:

- Owner is active.
- Card is active.
- Assignment is active and review-capable.
- Central document is schema-valid and has an active category/language.
- Destination fallback is valid.
- The only blocker is central `general.enabled = false`.

**Conclusion:** the 404 is intentional and correct. Do not bypass it.

### 9.4 Required configuration actions (not performed)

To publish `/taprevia/google-review-2`:

1. Open Review Management for `test4@gmail.com` / `taprevia`.
2. Enable “Review availability” (`general.enabled = true`).
3. Confirm the Google Review destination. The card’s own legacy destination is retained by the implemented precedence, so this is only needed if the operator wants to change it.
4. Confirm category/language/templates are valid (they are).
5. Recheck the preview and the branded URL.

Do not enable central settings or change the destination automatically.

### 9.5 Dashboard status defect

The routing is correct, but the dashboard can misrepresent it:

- `src/app/(dashboard)/dashboard/products/page.tsx:312-320`:
  - For a review card, if `product.preview.ok` is false, it falls back to `resolveCustomerPublicPath({ kind:'review', urlAlias })`.
  - `resolveCustomerPublicPath` returns `/review/{alias}` when no publicSlug/preview (`src/lib/services/customer-public-url.ts:44-50`).
  - The UI then labels that legacy path “Public URL” (`products/page.tsx:468-477`).
- `src/app/(dashboard)/dashboard/products/[id]/page.tsx:346-348`:
  - `publicUrlPendingReason` uses `data.instance.reviewAssistant.enabled !== true` (legacy flag), not effective central publication.
  - For the target card, legacy `enabled=true`, so the page treats the URL as live/copyable even though the branded URL is 404.
- `src/components/review-management/review-management-client.tsx:1114` hardcodes “Settings source: Central Review Management” even when the product is effectively legacy or central settings are invalid.

Recommended UI behavior:

- Treat `preview.ok` as the publication authority.
- If `preview.reason === 'disabled'`, show “Unpublished — central review publication is off” and link to Review Management.
- Label `/review/{alias}` as “Internal preview (legacy route)”, never “Public URL”.
- If the branded URL is unpublished, do not offer a copy action for the legacy URL as if it were public.
- Show the actual resolved source from the preview, not a hardcoded label.

---

## 10. All-Product Compatibility Matrix

Live counts are active `UserProduct` assignments. “Review” means the product definition includes `review_ai_suggestions`.

| # | Canonical product | Category / kind | Review | Live assignments | Public URL type | Review Management | Publication gate | Legacy routes | Verdict |
|---|---|---|---|---|---|---|---|---|---|
| 1 | Business NFC Card (`business-nfc-card`) | NFC card / profile | No | 2 (2 cards) | `{biz}/business-card` | Excluded | Profile feature gate | `/r`, `/profile`, `/c` | OK — no review leakage |
| 2 | Premium NFC Card (`premium-nfc-card`) | NFC card / profile | **Yes** | 2 (2 cards) | `{biz}/premium-card` | Included; review entry via `/review/{alias}` | Effective review settings | `/r`, `/profile`, `/c` | OK, with a UI gap for central-enabled/legacy-disabled cards (§11) |
| 3 | Insta Card (`insta-card`) | NFC card / social | No | 2 (2 cards) | `{biz}/instagram` | Excluded | Social redirect | `/r`, `/c` | OK — social redirect preserved |
| 4 | Google Review Card (`google-review-card`) | NFC card / review | Yes | 3 (2 cards + 1 pending) | `{biz}/google-review[-N]` | Included | Central/effective | `/r` → `/review/{alias}`, `/review` | OK; pending assignment is setup-required |
| 5 | LinkedIn Card (`linkedin-card`) | NFC card / social | No | 2 (2 cards) | `{biz}/linkedin` | Excluded | Social redirect | `/r`, `/c` | OK |
| 6 | Facebook Card (`facebook-card`) | NFC card / social | No | 2 (2 cards) | `{biz}/facebook` | Excluded | Social redirect | `/r`, `/c` | OK |
| 7 | Google Review Standee (`google-review-standee`) | Standee | Yes | 2 (2 standees) | Panel `{biz}/standee[-N]` | Included; setup required | `STANDEE_REVIEW_ASSISTANT_ENABLED` + effective | `/r`, `/standee-review` | OK — slot destination missing, “Needs setup” |
| 8 | Business Profile Standee (`business-profile-standee`) | Standee | No | 2 (2 standees) | Panel `{biz}/standee[-N]` | Excluded | Panel | `/r`, `/panel` | OK — no review leakage |
| 9 | All In One Standee – 3 Profile (`all-in-one-standee-3`) | Standee | Yes | 2 (2 standees) | Panel `{biz}/standee[-N]` | Included; setup required | Standee flag + effective | `/r`, `/panel`, `/standee-review` | OK — automatically discoverable |
| 10 | All In One Standee – 4 Profile (`all-in-one-standee-4`) | Standee | Yes | 2 (2 standees) | Panel `{biz}/standee[-N]` | Included; setup required | Standee flag + effective | `/r`, `/panel`, `/standee-review` | OK — automatically discoverable |
| 11 | Google Review NFC Plate (`google-review-nfc-plate`) | NFC plate / review | Yes | 2 (2 cards) | `{biz}/google-review[-N]` | Included | Central/effective | `/r` → `/review/{alias}`, `/review` | OK; target 404 is central-disabled |

### 10.1 Specific entitlement checks

- **Premium NFC Business Card retains included Review Management:** confirmed in `src/config/products.ts:123-140` (`review_ai_suggestions`).
- **Lower-tier products do not gain review:** Business NFC, Insta, LinkedIn, Facebook, Business Profile Standee do not declare `review_ai_suggestions`. `productGrantsReview` checks capabilities, not names (`review-product-eligibility.ts:134-139`).
- **AIO 3/4 remain automatically discoverable:** `projectStandee` sets `eligible = accountReviewEntitled && grants`; a missing Google URL is a setup state, not an exclusion (`review-product-eligibility.ts:261-270`).
- **Social cards retain original redirect behavior:** `dispatchSocialCard` is unchanged; `resolveCardDestination` still sends review cards to `/review/{alias}`.
- **Existing profile and standee panel URLs remain unchanged:** no `publicSlug` regeneration; `resolveStandeePanel` still uses `/r/{routeSlug}/{slot}`.
- **NFC/QR routes:** `/r/{routeSlug}` remains the permanent entry; `/r` → `/review/{alias}` for review cards, `/review`/`/standee-review` for review experiences.

---

## 11. Security and Tenant-Isolation Findings

### 11.1 Verified controls

- Review Management APIs require `review_ai_suggestions` (`requireApiEntitlement` in all `src/app/api/review-management/**` routes).
- Product lookup is owner-scoped: `getReviewProductForUser` filters `{_id, userId, status:'active'}`; card/standee ownership is rechecked (`review-product-eligibility.ts:427-509`).
- Central settings reads/writes use the authenticated user as `businessId`; no client tenant id (`review-management-settings.ts:150-161`).
- Cross-tenant product connection returns `404`; cross-tenant preview returns `403/404`; lower-tier returns `403` (test evidence: `test-review-management.ts:1229-1238, 1396-1441`).
- CSRF/origin checks are enforced in middleware (`src/middleware.ts:32-92`); connection tests expect `403` for missing/invalid origin.
- Destination resolution is scoped to the instance: card destination from the card; standee destination from the standee slot or the same owner’s profile social link (`review-standee-settings.ts:105-121`).
- Public review gating checks entitlement and effective publication (`review-experience.tsx:47-58`; `review-generate.ts:88-94`; public suggestion/copy routes).
- Redirect safety and loop detection are present (`/r` route; `wouldRedirectLoop`).
- Immutable identifiers are guarded at the API and persistence layers (`url-identity.ts`; `card-replacement.ts`).

### 11.2 Security / integrity concerns

| # | Concern | Evidence | Severity | Recommendation |
|---|---|---|---|---|
| S1 | Legacy review content can still be written under central ON | `api/cards/[id]/route.ts:322-329`; `validation/card.ts:211` | Medium | Reject content fields when central is authoritative; allow destination-only updates. |
| S2 | Hybrid override writes remain accepted under central ON | `review-product-connection.ts:322-342`; setup `review-management-client.tsx:643-648` | Medium | Stop writing content overrides; add a destination-only input; preserve storage compatibility if approved. |
| S3 | Retired override dialogs remain in the tree | `product-settings-dialog.tsx:69`; `hybrid-dialog.tsx:230`; no imports | Low/Medium | Remove or clearly mark deprecated in a code-only cleanup. |
| S4 | Card re-bound to a different owner keeps old `publicSlug` | `human-url.ts:193`; `card-access.ts:218-233`; `card-identity.ts:156-175` | High (latent) | Block cross-owner rebinding when `publicSlug` exists, or require explicit admin reassignment approval; never silently serve the old path under a new owner. |
| S5 | Allocation rollback can unbind a pre-owned card | `user-product-assignment.ts:247-268`; `created` flag only | High | Distinguish “created now,” “claimed unbound,” and “already owned”; only roll back the first two. |
| S6 | Admin link path ignores allocation failure | `admin/.../card/route.ts:149-153` | Medium | Make allocation mandatory; roll back or return an error. |
| S7 | Direct admin card create has no publicSlug | `api/cards/route.ts:125-135` | Medium | Allocate or explicitly mark as an unassigned inventory card with no public identity. |
| S8 | Cross-collection race | `human-url.ts:166-172` | Medium | Deterministic namespace invariant + post-write verification; shared registry only with approval. |
| S9 | Legacy card slug can shadow a business slug if `isActive` is repaired | `card-access.ts:172-183`; `taprevia` legacy card | Medium/High | Resolve the slug collision before enabling the card. |
| S10 | Invalid central display source mismatch | `review-product-eligibility.ts:180-198, 285-303` | Low/Medium | Use `resolved.source` for display, not `effectiveSource` alone. |
| S11 | Standee panel public route does not check owner suspension | `[business]/[product]/page.tsx:68-90`; `standee-panel.ts:50-98` | Low/Medium | Add an owner-status check or document the intentional behavior. |
| S12 | Standee review host returns `200` “unavailable” rather than `404` | `standee-review/[slug]/page.tsx:39-42` | Low | Use `notFound()` for consistency with branded card fail-closed behavior, or document the intentional 200 state. |
| S13 | Premium review link hidden when central is enabled but legacy `enabled=false` | `public-card-page.tsx:128-149` | Medium | Use effective review settings for `couldHostReview`, not the legacy flag/source heuristic. |
| S14 | Dashboard can label an unpublished legacy URL as Public/live | `products/page.tsx:312-320`; `products/[id]/page.tsx:346-348` | Medium | Use `preview.ok`/`configurationStatus` as the authority; label legacy routes as internal preview. |

### 11.3 Tenant isolation conclusion

No cross-tenant settings or destination leakage was found on the central/effective path. The main tenant risks are **URL ownership on reassignment** and **legacy alias shadowing**, not central settings reads. Fix those before any mass URL repair.

---

## 12. Missing Regression Coverage

### 12.1 Existing coverage (verified or evidenced)

| Area | Coverage |
|---|---|
| Central authority with valid settings | `test-central-review-authority.ts` OFF → ON → OFF (10/10, 20/20, 8/8 in Phase 2); `test-review-management.ts` resolver/API tests |
| Legacy source/override records | `test-review-management.ts` (gate OFF 58/58) |
| Hybrid records | `test-review-management.ts` gate OFF; gate ON obsolete expectations |
| New card/standee assignment | `test-card-binding.ts` 49/49 |
| Entitlement / lower-tier exclusion | `test-dashboard-entitlement.ts` 130/130; `test-review-management.ts` |
| AIO 3/4 discovery/setup | `test-review-phase2-products.ts` 21/21 |
| Immutable identifiers | `test-ppl02-immutable-urls.ts` 23/23 |
| Public URL display | `test-customer-public-url-display.ts` 29/29 |
| NFC/QR routes | `test-ppl01-customer-qr.ts` 18/18 |
| Redirect safety | `test-ppl07-redirect-safety.ts` 11/11 |
| Security boundaries | `test-security-boundaries.ts` passed |
| VCF | `test-vcf.ts` 69/69 |

### 12.2 Missing coverage (must add in Stage B/C)

1. **Strict central-only fail-closed:** central ON + missing document → review page must not publish.
2. **Strict central-only fail-closed:** central ON + invalid schema → review page must not publish.
3. **Central gate OFF with valid central:** define and test the approved behavior (legacy rollback vs central-only).
4. **Central disabled + legacy enabled:** assert branded URL 404 and no legacy publication.
5. **Legacy API write under central ON:** `/api/cards/[id]` `reviewAssistant` content must be rejected or non-effective; assert no stored change if rejected.
6. **Hybrid product-connection write under central ON:** assert effective content remains central; if storage is allowed, assert it is dormant.
7. **Premium profile card with central enabled and legacy `enabled=false`:** review link must appear.
8. **Unpublished dashboard status:** assert the UI does not label `/review/{alias}` as a live Public URL.
9. **Failed publicSlug allocation:** card assignment and standee assignment must fail cleanly with no orphan.
10. **Failed allocation on a pre-owned card:** must not unbind/deactivate the existing owner.
11. **Admin link allocation failure:** must not return success with a missing publicSlug.
12. **Cross-collection race:** simultaneous Card/Standee allocation must not produce the same slug.
13. **Card re-binding to a different owner:** must not serve the old business path.
14. **Legacy card `isActive` repair:** ensure the `taprevia` slug does not shadow the business profile.
15. **Branded standee review URL:** not implemented; add tests with Stage D.
16. **All 11 products:** a single matrix test that asserts capability, review inclusion/exclusion, public URL type, and legacy route behavior for each canonical product.
17. **Analytics attribution:** branded card review page, legacy `/review`, standee host, and `/r` tap must each record once; no double count.
18. **Tenant isolation for the new branded standee route:** cross-tenant access must 404.

---

## 13. Detailed Implementation Sequence (Do Not Execute)

### Stage A — Central-Only Enforcement

**Goal:** make central `ReviewSettings` the only source of review content/publication for eligible products, while preserving stored legacy data and destination separation.

**Files:**

- `src/lib/services/review-effective-settings.ts`
- `src/lib/services/review-settings-resolver.ts`
- `src/lib/services/review-standee-settings.ts`
- `src/lib/services/review-product-eligibility.ts`
- `src/lib/services/review-product-connection.ts`
- `src/app/api/cards/[id]/route.ts`
- `src/lib/validation/card.ts`
- `src/components/review-management/review-management-client.tsx`
- Remove/retire `src/components/review-management/hybrid-dialog.tsx` and `product-settings-dialog.tsx` (only after approval)

**Modifications:**

1. Add a central-only resolution mode:
   - Central active + valid central → current behavior.
   - Central active + missing/invalid central → `enabled: false`; source `legacy-fallback` or a new `central-unconfigured` marker for UI. Do not publish from legacy.
   - Central OFF → owner-approved behavior. Option A: legacy rollback preserved. Option B: fail closed for review-entitled products.
2. Keep central content/publication authoritative; keep product destination precedence.
3. Reject content writes from `/api/cards/[id]` when central is authoritative; allow only `googleReviewUrl` if the owner approves destination editing through that route. Prefer a dedicated destination endpoint.
4. Reject `source: 'hybrid'` content writes under central ON, or accept only `googleReviewUrl` with all content keys stripped. Stop the setup UI from sending `...product.reviewOverrides`.
5. Set `displaySource` from `resolved.source`, not `effectiveSource` alone, so the UI cannot claim central when it is legacy-fallback.
6. Update the UI copy: remove “Choose a settings source”; replace “Existing products keep using their own settings” with the central-only state.
7. Remove or quarantine the unused dialogs so the retired workflow cannot be re-imported accidentally.

**Database/schema impact:** none.

**Existing customer impact:** kaka-pvc keeps publishing; taprevia stays unpublished; m12-verify stays setup-required. Gate-OFF environments may see a content switch for kaka-pvc; owner approval required.

**Backward compatibility risk:** legacy/hybrid clients that write content under central ON will receive `400` or a no-op; this is intentional but must be documented.

**Security risk:** low; reduces dormant-config bypass.

**Rollback:** revert code; no data migration. Gate OFF remains an operational fallback if Option A is chosen.

**Owner approval:** required for the central-only fail-closed policy and the legacy-write rejection.

**Acceptance:**

- Central ON + missing/invalid → branded review 404; `/review` unavailable; no generation.
- Central ON + valid → central content/publication; product destination retained.
- Gate OFF behavior matches the approved decision.
- Legacy data unchanged in storage.
- No source/override controls or retired dialogs reachable.

---

### Stage B — Regression Corrections

**Goal:** make the suites assert the new contract without losing concurrency/security/backward-compatibility coverage.

**Files:**

- `scripts/test-review-management.ts`
- `scripts/test-standee-review.ts`
- `scripts/test-central-review-authority.ts`
- Add a strict-central-only matrix test (new script or extend the central-authority matrix).

**Modifications:**

1. Replace the 12 obsolete/cascade assertions per §4.
2. Make each check independent: derive the current revision from the API/DB; do not rely on a mutable `connectorRevision` across checks that can fail early.
3. Keep the Gate-OFF legacy suite intact.
4. Add explicit Gate-ON cases for missing/invalid central → fail closed.
5. Add explicit Gate-OFF cases for legacy rollback and hybrid behavior if the owner retains them.
6. Add a case for Premium central-enabled/legacy-disabled review link.
7. Add a case for dashboard publication status.
8. Do not skip or delete tests.

**Database/schema impact:** isolated test databases only.

**Existing customer impact:** none.

**Backward compatibility risk:** none (tests only).

**Security risk:** none.

**Rollback:** revert test changes.

**Owner approval:** required only if a test is retired rather than rewritten.

**Acceptance:** all suites pass in both gate modes; every failure has a replacement assertion; no reduced concurrency/security coverage.

---

### Stage C — URL Reliability

**Goal:** close allocation, rollback, reassignment, and status gaps.

**Files:**

- `src/lib/services/human-url.ts`
- `src/lib/services/user-product-assignment.ts`
- `src/lib/services/customer-creation.ts`
- `src/app/api/admin/users/[id]/products/[userProductId]/card/route.ts`
- `src/app/api/cards/route.ts`
- `src/lib/services/card-identity.ts`
- `src/lib/services/card-access.ts`
- `src/app/(dashboard)/dashboard/products/page.tsx`
- `src/app/(dashboard)/dashboard/products/[id]/page.tsx`
- `src/lib/services/product-preview.ts`
- `src/components/review-management/review-management-client.tsx`

**Modifications:**

1. Make the admin link path require successful `publicSlug` allocation; roll back the link/assignment on failure.
2. Decide whether `POST /api/cards` is a true inventory create (no public URL) or must allocate a slug; document/enforce.
3. Implement the deterministic namespace invariant (card product segments vs `standee` / `review-standee`) and keep the shared check.
4. Add post-write cross-collection verification with conditional rollback/retry.
5. Fix the `ensureCardPublicSlug` return value when `modifiedCount === 0`.
6. Distinguish “created now,” “claimed unbound,” and “already owned” in assignment rollback; never unbind/alter an already-owned card.
7. Block or explicitly approve cross-owner rebinding when a `publicSlug` exists; do not serve the old business path under a new owner.
8. Fix dashboard Public URL/publication status: use `preview.ok` / `configurationStatus`; label `/review/{alias}` as internal preview.
9. Fix the Premium review link to use effective settings.
10. Fix display-source mismatch in Review Management.

**Database/schema impact:** none if the deterministic namespace + post-write verification approach is used. A shared reservation collection/index is **not** approved.

**Existing customer impact:** no identifier changes; assignment failures may become visible instead of silently succeeding (intended). Fixing `isActive` is **not** part of Stage C; that is Stage E with approval.

**Backward compatibility risk:** cross-owner rebinding may need an admin override; document it.

**Security risk:** reduces cross-tenant URL leakage.

**Rollback:** revert code; no data changes.

**Owner approval:** required for the cross-owner rebinding policy and any change to `POST /api/cards`.

**Acceptance:**

- New card/standee assignment without publicSlug fails cleanly.
- Pre-owned card is never unbound by a failed allocation.
- Cross-collection race test passes.
- Unpublished dashboard status is accurate.
- Premium review link appears when central is enabled.

---

### Stage D — Standee Branded Review URLs

**Goal:** give eligible standees a permanent branded review URL distinct from the panel URL.

**Files:** as listed in §8.5.

**Modifications:**

1. Add `reviewPublicSlug` + unique sparse index.
2. Allocate at creation for review-capable standees; roll back on failure.
3. Add the branded route branch; render only when the review host is eligible and effective publication is enabled; otherwise 404.
4. Keep panel `publicSlug`, `/standee-review`, `/r`, NFC/QR, and analytics.
5. Add the feature flag and rollback path.
6. Expose the branded URL separately in dashboard/API.
7. Add a dry-run backfill for the 6 existing review-capable standees.

**Database/schema impact:** new field/index + backfill. **Requires explicit approval.**

**Existing customer impact:** no panel URL changes; existing standees get a new optional branded URL after backfill.

**Backward compatibility risk:** low if the flag defaults off and panel routes are unchanged.

**Security risk:** new public route must enforce tenant/entitlement/publication checks; add cross-tenant tests.

**Rollback:** disable the flag; the branded route fails closed; panel and `/standee-review` continue. Index drop/migration rollback only with approval.

**Owner approval:** **required** before any code or migration.

**Acceptance:**

- Branded standee review URL resolves only for eligible, published standees.
- Panel URL unchanged.
- `/r` and `/standee-review` unchanged.
- Analytics recorded once.
- No cross-product collisions.

---

### Stage E — Existing Record Repair

**Goal:** repair only approved legacy records using an idempotent migration.

**Files:**

- New `scripts/repair-legacy-url-identifiers.ts` (dry-run default; `--apply` explicit).
- Possibly extend `scripts/backfill-public-slugs.ts`, but it currently skips the 10 affected cards (no assignment / `!isActive`).
- A reviewed manifest file (JSON) mapping record → proposed values.

**Modifications:**

1. Load the manifest; validate every record and existing identifier.
2. Recompute collision checks at apply time.
3. Fill only empty fields; never overwrite.
4. Separate `isActive` repair from identifier repair.
5. Do not publish reviews.
6. Log every change and every skip.
7. Run dry-run, review output with the owner, then apply.

**Database/schema impact:** data writes only; no schema change.

**Existing customer impact:** high if misclassified; manual approval required per record.

**Backward compatibility risk:** preserve all existing `slug`/`cardUid`/`routeSlug`/`urlAlias` links.

**Security risk:** the `taprevia` slug collision must be resolved before enabling that legacy card.

**Rollback:** take a backup/snapshot before apply; restore only with approval. Prefer re-running the idempotent script over destructive rollback.

**Owner approval:** **required** for every record and for `isActive`.

**Acceptance:**

- Dry-run manifest matches the approved list.
- No existing identifier changed.
- Re-running is a no-op.
- All legacy links still work.
- No publication state changed.

---

### Stage F — Final Regression

**Files:** none.

**Modifications:** run the complete relevant suite, TypeScript, ESLint, and production build; security review; manual smoke test of the 11 products and the target 404.

**Database/schema impact:** isolated test databases only.

**Existing customer impact:** none if Stage E is not run.

**Backward compatibility risk:** assessed by the suites.

**Security risk:** assessed by the suites and manual checks.

**Rollback:** not applicable; do not deploy.

**Owner approval:** required before deployment.

**Acceptance:**

- Gate-OFF and Gate-ON suites pass.
- Central authority matrix passes.
- PPL-01/02/03-01/04-05/06/07 pass.
- Card binding, dynamic routing, M10, entitlements, security, VCF pass.
- `tsc`, ESLint, build pass.
- No skipped tests; no weakened assertions.
- Manual: `/taprevia/google-review-2` remains 404 until central is enabled; after enabling (owner action), it returns 200.

---

## 14. Risk and Rollback Assessment

| Stage | Risk | Impact | Rollback | Approval |
|---|---|---|---|---|
| A — Central-only | Medium/High | Customer-visible publication/content; legacy writes blocked | Revert code; Gate OFF fallback if retained | Required |
| B — Tests | Low | None | Revert tests | Required only for retirement |
| C — URL reliability | Medium | Assignment failures surface; rebinding policy changes | Revert code; no data change | Required for rebinding policy |
| D — Standee branded URLs | High | New schema/index/route/backfill | Disable flag; panel routes remain; index rollback with approval | Required |
| E — Record repair | High | Customer identifiers/data | Backup/restore; idempotent re-run | Required per record |
| F — Final regression | Low | None | N/A | Before deploy |

### 14.1 Rollback principles

- Preserve all stored legacy data; never delete it for rollback.
- Keep `STANDEE_REVIEW_ASSISTANT_ENABLED` and the new branded flag independent.
- Keep `/review/{alias}`, `/r/{routeSlug}`, panel URLs, and `/standee-review` as permanent fallbacks.
- No destructive migration; additive fields only.
- Use dry-run manifests and backups for any data repair.

---

## 15. Decisions Requiring Approval

1. **Strict central-only semantics:** when central is OFF, should review-entitled products keep legacy rollback or fail closed? Recommended: fail closed for publication, with legacy content available only for setup preview.
2. **Missing/invalid central:** confirm fail closed (no legacy publication).
3. **Legacy/hybrid write policy under central ON:** reject content writes, or accept and ignore? Recommended: reject content writes; allow destination-only.
4. **12 Gate-ON tests:** update or retire? Recommended: update all 12 with replacement assertions; retire none.
5. **Legacy URL repair:** approve the classification and manifest for the 4 legacy cards and 6 verification cards.
6. **`isActive` repair:** approve backfilling `isActive: true` for the 3 active legacy cards; resolve the `taprevia` slug collision first.
7. **Cross-owner rebinding:** block, require admin confirmation, or allow with a new publicSlug?
8. **Shared namespace:** deterministic invariant + post-write verification (no new collection) vs shared reservation registry (requires approval).
9. **Standee branded review URL:** approve the schema field, index, route, flag, and backfill.
10. **Target 404 publication:** enable central `general.enabled` for `test4@gmail.com`? Not performed.
11. **Premium review link:** approve using effective settings instead of the legacy flag.
12. **Dashboard labels:** approve labeling `/review/{alias}` as internal preview, not Public URL.

---

## 16. Safety Confirmation

### 16.1 What was not changed

- No source code was edited in Phase 3. The working tree still contains the pre-existing Phase 2 uncommitted changes listed by `git status`; this audit did not add to or alter them.
- No application UI was changed.
- No API behavior was changed.
- No schema or index was changed.
- No migration was run.
- No identifier was generated, repaired, or overwritten.
- No central `ReviewSettings` was enabled or modified.
- No Google Review destination was changed.
- No customer record content, entitlement, or publication state was intentionally changed.
- No production or preview environment was accessed.
- No commit, push, or deployment was performed.

### 16.2 Disclosed analytics writes from GET probes

The audit used local HTTP GET requests to verify routing. The application’s existing handlers wrote tap analytics:

| Card | Probes | Effect |
|---|---|---|
| `6aeae9d218200f2461c8cdcb` (target) | `/r/mw1uek1ij3` × 2 | 2 `AnalyticsLog` rows; `stats.taps` +2 (now 2) |
| `6a9274dcc538bd6293e5a9d6` | `/c/1d-...` × 2, `/r/1D:...` × 1 | 3 `AnalyticsLog` rows; `stats.taps` +3 (now 3) |
| `6aeaf75a2c28aca802c32077` | `/r/m12r-m12verify01` × 1 | 1 `AnalyticsLog` row; `stats.taps` +1 (now 1) |
| **Total** | 6 probes | **6 `AnalyticsLog` rows**, 6 tap-counter increments |

These are metadata-only writes to the local customer database. No identifiers, settings, URLs, or publication state were changed. No cleanup was performed because deleting analytics would be another customer-data write and was outside the audit scope. This is reported as a process deviation, not hidden.

### 16.3 Read-only evidence limits

- Read-only DB queries reflect the local `nfc-crm` database only.
- The local app’s `.env.local` has `CENTRAL_REVIEW_PUBLIC_INTEGRATION_ENABLED=true`, `CENTRAL_REVIEW_LOCAL_FORCE_ALL=true`, `CENTRAL_REVIEW_TENANT_ROLLOUT_MODE=legacy-global`, and `STANDEE_REVIEW_ASSISTANT_ENABLED=true`. Production configuration is unknown and was not accessed.
- Phase 2 Gate-ON logs were used as failure evidence; no Phase 3 write-based suite was executed.
- `tsc --noEmit` and `npm run lint` passed on the current tree.

### 16.4 Stop point

**STOP — WAIT FOR OWNER APPROVAL.**

Do not begin Stage A, B, C, D, E, or F. Do not modify the 12 tests. Do not allocate or repair URLs. Do not enable central publication. Do not add the standee branded URL field. Do not deploy.

---

## Appendix A — Key Evidence Index

| Topic | File:line |
|---|---|
| Card effective resolver / legacy fallback | `src/lib/services/review-effective-settings.ts:62-130` |
| Resolver invalid-central fallback | `src/lib/services/review-settings-resolver.ts:455-502` |
| Standee host authority / slot destination | `src/lib/services/review-standee-settings.ts:179-214, 290-375` |
| Card/standee product projection | `src/lib/services/review-product-eligibility.ts:147-339, 427-509` |
| Connection legacy block + hybrid writes | `src/lib/services/review-product-connection.ts:114-126, 313-342` |
| Rollout gate OFF → legacy | `src/lib/services/review-rollout.ts:167-177` |
| Card API legacy content writes | `src/app/api/cards/[id]/route.ts:322-329`; `src/lib/validation/card.ts:211` |
| Setup UI hybrid write | `src/components/review-management/review-management-client.tsx:643-648` |
| Hardcoded source label | `src/components/review-management/review-management-client.tsx:1114` |
| Unused dialogs | `src/components/review-management/hybrid-dialog.tsx:230`; `product-settings-dialog.tsx:69` |
| Branded review render | `src/app/[business]/[product]/page.tsx:120-135` |
| Shared review gate | `src/components/review/review-experience.tsx:47-58` |
| Legacy review route | `src/app/review/[alias]/page.tsx:46-93` |
| Public URL display defect | `src/app/(dashboard)/dashboard/products/page.tsx:312-320, 468-477`; `src/app/(dashboard)/dashboard/products/[id]/page.tsx:346-348` |
| Customer public path fallback | `src/lib/services/customer-public-url.ts:44-50` |
| Premium review link gate | `src/components/public/public-card-page.tsx:128-149` |
| Card visibility `isActive` | `src/lib/services/card-access.ts:16-33`; `src/models/Card.ts:152` |
| Admin link best-effort | `src/app/api/admin/users/[id]/products/[userProductId]/card/route.ts:149-153` |
| Admin direct card create | `src/app/api/cards/route.ts:125-135` |
| Public slug allocation | `src/lib/services/human-url.ts:187-314` |
| Shared namespace check | `src/lib/services/human-url.ts:166-172` |
| Assignment rollback | `src/lib/services/user-product-assignment.ts:239-268, 333-349` |
| Customer creation compensation | `src/lib/services/customer-creation.ts:52-87` |
| Card replacement preservation | `src/lib/services/card-replacement.ts:58-71` |
| Immutable fields | `src/lib/services/url-identity.ts:15-27, 77-127` |
| Entitlement rules | `src/lib/services/review-entitlement.ts:60-108` |
| Standee review host 200-unavailable | `src/app/standee-review/[slug]/page.tsx:39-42` |
| Backfill scripts skip affected cards | `scripts/backfill-public-slugs.ts:26-48` |
| Gate-ON failure log | `/tmp/phase2-review-on.log`; `/tmp/phase2-standee-on.log` |

