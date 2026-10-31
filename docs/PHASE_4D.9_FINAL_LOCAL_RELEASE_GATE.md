# TAPREVIA — PHASE 4D.9 FINAL LOCAL RELEASE GATE REPORT

**Final status:** LOCAL RELEASE GATE PASSED — PRODUCTION VERIFICATION AND OWNER APPROVAL PENDING

This report is local evidence only. No production or preview access, deployment,
index creation, flag activation, environment change, commit or push occurred.

## 1. Executive summary

Phase 4D.9 re-ran the complete 16-combination feature-flag matrix against the
current code (16 × 12 = 192 checks, executed twice: before and after the final
concurrency fix, 192/192 both times), audited deleted-host analytics, revalidated
both Phase 4D.8 fixes, added one narrow concurrency hardening, and re-ran the full
regression battery.

Findings:

1. **Concurrent duplicate assignment was reproducible.** Two simultaneous
   requests for the same unassigned UID both returned 201 and created two active
   `UserProduct` rows. Fixed additively in
   `src/lib/services/user-product-assignment.ts` with a post-insert
   reconciliation that keeps the oldest active row and deletes only the record
   the losing request just created. Re-tested: 201/409, exactly one active row.
   No existing record is modified; no index is required for the fix.
2. **Deleted-host analytics cannot be safely attributed.** `AnalyticsLog` rows
   carry no `businessId`; attribution requires a live `Card`/`Standee` join.
   Deleted-host events remain stored but are excluded from business totals.
   Rotation events do persist `businessId`, so business-level rotation totals
   still include deleted hosts, while product rows cannot represent them. No
   migration, backfill, inference or deletion was performed.
3. Both Phase 4D.8 fixes hold: the builder has zero page overflow at
   320/375/390/430/768/1024/1440 in dark and light, and sequential,
   case-insensitive and cross-customer duplicate UIDs are rejected with 409.
4. The builder tablist uses Tab-order button navigation; the ARIA roving
   arrow-key pattern is not implemented. This is pre-existing, documented as a
   limitation, and not a regression.
5. The admin UID contract accepts any non-empty trimmed value up to 64 chars
   (trim + uppercase); overlong values return 400 and an omitted UID mints an
   approved `DIGITAL-` card. Punctuation is accepted literally. This is the
   existing admin-only contract; no normalisation semantics were changed.

No unresolved local security or backward-compatibility blocker remains. All
outstanding items are production verification, external QA or documented
limitations.

## 2. Branch, HEAD and Git safety

- Branch: `Devlopment`
- HEAD: `8e9a45fdbae9eef24c1f341594c27bfd209090e0`
- No commit, push, pull, merge, rebase, reset, stash or clean.
- No branch switch.
- All prior modified and untracked Phase 4D.5–4D.8 work preserved.

## 3. Working-tree status

- Initial: 82 modified/untracked entries.
- Final: 86 entries (three Phase 4D.9 test scripts and this report added;
  `package.json` gained three additive test scripts; existing runbooks gained
  4D.9 addenda).
- `git diff --check`: clean.

## 4. Environment isolation

- MongoDB host: `localhost` only.
- Disposable databases: `taprevia_4d9_matrix`, `taprevia_4d9_historical`,
  `taprevia_4d9_cards`, `taprevia_4d9_dynamic`, `taprevia_4d9_standee`,
  `taprevia_4d5_readiness`, `taprevia_4d6_readiness`,
  `taprevia_4d7_readiness8`.
- Every test harness refuses a database outside its approved prefix and a
  non-local `TEST_BASE`.
- No production or preview connection, API call or environment edit.
- `.env.local` and `.env.preview` mtimes unchanged.

## 5. Feature-flag defaults

All four remain OFF by default in the environment:

| Flag | Default |
|---|---|
| `NEW_REVIEW_COPY_FLOW_ENABLED` | OFF |
| `SMART_REVIEW_ROTATION_ENABLED` | OFF |
| `CENTRAL_REVIEW_PUBLIC_INTEGRATION_ENABLED` | OFF |
| `STANDEE_REVIEW_ASSISTANT_ENABLED` | OFF |

## 6. Complete 16-combination matrix

Harness: `scripts/test-phase4d9-matrix.ts` (12 real checks per combination).
Each combination runs in a fresh server process against reseeded synthetic data.

| # | Copy | Rotation | Central | Standee | Result |
|---|---|---|---|---|---|
| 1 | off | off | off | off | 12/12 |
| 2 | off | off | off | on | 12/12 |
| 3 | off | off | on | off | 12/12 |
| 4 | off | off | on | on | 12/12 |
| 5 | off | on | off | off | 12/12 |
| 6 | off | on | off | on | 12/12 |
| 7 | off | on | on | off | 12/12 |
| 8 | off | on | on | on | 12/12 |
| 9 | on | off | off | off | 12/12 |
| 10 | on | off | off | on | 12/12 |
| 11 | on | off | on | off | 12/12 |
| 12 | on | off | on | on | 12/12 |
| 13 | on | on | off | off | 12/12 |
| 14 | on | on | off | on | 12/12 |
| 15 | on | on | on | off | 12/12 |
| 16 | on | on | on | on | 12/12 |

**192/192 checks passed, 0 failed.** The matrix was executed once before the
concurrency fix and once after it; both full runs were 192/192.

The 12 checks per combination were:

1. Card public review host and suggestions.
2. Standee public host gated by `STANDEE_REVIEW_ASSISTANT_ENABLED`.
3. Google destination resolution (legacy/central).
4. Four-product entitlement.
5. Lower-tier/ineligible host restriction.
6. Legacy/central/hybrid resolution (Card and Standee content).
7. Copy-flow flag propagation to the public UI.
8. Rotation dependency (`rotation active === copy && rotation`), token
   requirement, and legacy no-token copy when inactive.
9. Analytics attribution, ranges and legacy `/api/analytics`.
10. Cross-tenant isolation and filter validation.
11. NFC/QR routing for `/r/` and `/qr/`.
12. Rollback invariants: flags never rewrite aliases, routes or destinations.

Key invariants confirmed in every combination:

- Copy OFF + rotation ON leaves rotation inert.
- Standee OFF preserves the legacy Google destination for `/r/` and `/qr/`.
- Standee ON activates only eligible, actively assigned Standee hosts.
- Central OFF preserves legacy public settings; Central ON resolves
  central/hybrid content for eligible hosts.
- Lower-tier Cards remain restricted.
- Existing aliases and destinations are unchanged.
- Analytics remains tenant-scoped.

## 7. Historical analytics findings

Harness: `scripts/test-phase4d9-historical.ts` — **9/9 checks passed**.

- `AnalyticsLog` has `cardId`/`standeeId`, `action`, `metadata`, `createdAt`
  and `timestamp`, but **no `businessId`** (verified: 0 rows).
- Business totals are computed by joining events to the business's live
  Cards/Standees. Active, inactive (`isActive: false`) and removed-assignment
  hosts whose documents still exist remain attributable.
- Deleted Card/Standee documents leave their events in `analyticslogs`
  (verified: 5 deleted-Card rows and 2 deleted-Standee rows preserved), but
  those events are excluded from business totals and product rows.
- Orphan events with no host identifier are ignored — never guessed.
- Malformed historical metadata remains `unclassified`, never AI/manual.
- `ReviewRotationEvent` persists `businessId`, so business-level
  `rotationCopies` includes deleted-host rotation activity while product rows
  cannot represent the deleted host.
- A copied review is never recorded as a posted Google review.

## 8. Deleted-host attribution decision

**Case B — safe attribution is impossible with the current persisted data.**

Reasons:

- Ownership is only derivable from a live Card/Standee document; no immutable
  owner/business identifier is stored on `AnalyticsLog`.
- Free-form `metadata` (route strings, copy source) is not trustworthy
  ownership proof and route slugs are not immutable ownership keys.
- Inferring an owner from client input, route reuse or arbitrary matches would
  violate tenant isolation.
- A backfill would rewrite historical records and requires a separately
  approved plan.

Affected data: all `AnalyticsLog` review events whose Card/Standee document was
deleted. Raw events remain stored; business totals exclude them, so historical
totals can understate deleted-host activity. Rotation totals remain
business-trustworthy via `ReviewRotationEvent.businessId`.

Safe future option (not implemented): add server-resolved `businessId` to new
analytics events (additive, no backfill) and, separately, an approved audited
backfill for historical rows. This needs schema/index review, tenant-isolation
tests and explicit approval.

## 9. Mobile Card Builder regression

Revalidated `src/components/builder/builder-shell.tsx` with the real editor and
synthetic Premium data:

- 7 widths (320/375/390/430/768/1024/1440) × 2 themes (dark/light) = **14/14
  rows** with `scrollWidth === visual viewport width` (max overflow 0).
- 11 tabs rendered; every tab reachable at 320 and 1440; no overflow after
  switching tabs.
- Desktop preview panel present at 1024 and 1440.
- Every tab is a focusable button with a `focus-visible` ring.
- Tab-order keyboard navigation works; the ARIA arrow-key roving pattern is
  not implemented (documented limitation, unchanged by this phase).
- No global CSS change and no editor redesign.

## 10. Duplicate UID activation regression

Harness: `scripts/test-phase4d9-fixes.ts`, synthetic admin/customer accounts.

| Scenario | Observed |
|---|---|
| First valid assignment | 201 |
| Duplicate same UID, same customer | 409 |
| Duplicate same UID, different casing | 409 |
| Same UID, different customer | 409 |
| Different UID, same customer | 201 |
| Removed assignment re-added | 201 |
| Standee assignment | 201 |
| Lower-tier Business Card assignment | 201, review entitlement `false` |
| Overlong UID (65 chars) | 400 |
| Omitted UID | 201 with `DIGITAL-…` card |
| Sequential duplicate active records | exactly 1 |
| Concurrent same-UID requests | 201 + 409, exactly 1 active record |

The assignment guard returns: `This card is already assigned to this customer`.

## 11. Concurrency findings

The original 4D.8 pre-insert guard is a read-then-write check and was racy: two
simultaneous requests both passed and created two active assignments (reproduced
locally: 2 active rows).

Narrow additive fix in `assignUserProduct`: after inserting the assignment,
re-query active rows for the same customer/Card and keep only the oldest. The
losing request deletes only the row it just created and returns 409. Existing
historical rows are never touched. Re-test: 201/409 and 1 active row.

Residual risk: if a process crashes between insert and reconciliation, or if a
future writer bypasses this service, duplicates remain possible. A partial
unique index on `UserProduct` (`userId` + `cardId` where `status: 'active'`) is
the robust database-level control; it is documented as a separately approved
production index and was **not** created.

## 12. Security results

- Security boundary suite: PASS.
- Auth/tenant/product isolation, suspended owners and removed assignments:
  PASS (entitlement suite 130/130; matrix + 4D.5/4D.6).
- Signed rotation tokens: valid, expired, tampered, cross-host, cross-business,
  replay, duplicate `copyId` and concurrent copies: PASS.
- Input/API protections: invalid JSON, oversized payload, prototype pollution,
  unsafe URLs, invalid filters/dates, CSRF/origin, rate limiting: PASS.
- The new concurrency reconciliation adds no data exposure and does not weaken
  any control.

## 13. Entitlement results

- Premium NFC Card: review-capable.
- Google Review Card and NFC Plate: review-capable.
- Google Review Standee: host resolves only with an active, eligible product.
- Lower-tier Business Card: denied, including inside mixed accounts.
- Removed assignments and suspended owners: denied.
- Display-name spoofing and unknown slugs: denied.
- No entitlement expansion or revocation.

## 14. Four-product compatibility results

| Product | Public host | Copy/analytics | Entitlement | Status |
|---|---|---|---|---|
| Google Review Card | `/review/{alias}` | PASS | PASS | PASS |
| Google Review NFC Plate | `/review/{alias}` | PASS | PASS | PASS |
| Premium NFC Card | `/review/{alias}` | PASS | PASS | PASS |
| Google Review Standee | `/standee-review/{route}` | PASS | PASS | PASS |

Lower-tier Cards remain restricted. Existing public aliases remain valid.

## 15. NFC/QR routing results

For every flag combination:

- `/r/{cardRoute}` reaches `/review/{alias}` (307).
- `/r/{standeeRoute}` reaches `/standee-review/{route}` only when the Standee
  gate is ON and the host is eligible; otherwise it preserves the seeded Google
  destination.
- `/qr/{googleSlotQrId}` follows the same gate-aware behavior.
- Ineligible/unassigned Standee `/r/` still resolves to its legacy destination.
- No stored alias, route slug, NFC/QR URL or Google URL was rewritten.

## 16. Historical data compatibility

- All seeded historical analytics rows remained readable and unchanged.
- Existing `/api/analytics` Card/Standee contracts still work.
- Copy classification remains: recorded `ai`, recorded `manual`, otherwise
  `unclassified`.
- Rotation activity and `AnalyticsLog.review_copied` remain separate metrics.
- No deletion, reset, backfill or destructive migration.

## 17. Full regression results

| Suite | Command | Result |
|---|---|---|
| Typecheck | `npm run typecheck` | PASS |
| ESLint | `npm run lint` | PASS |
| Build, flags OFF | `npm run build` | PASS |
| Build, flags ON | `npm run build` | PASS |
| Feature matrix | `npx tsx scripts/test-phase4d9-matrix.ts` | 192/192 |
| 4D.5 Review Management | `scripts/test-review-management.ts` | 56/56 OFF · 56/56 ON |
| 4D.6 Standee | `scripts/test-standee-review.ts` | 20/20 × 4 configs = 80/80 |
| Unified analytics | `scripts/test-review-analytics.ts` | 9/9 |
| Historical/deleted-host | `scripts/test-phase4d9-historical.ts` | 9/9 |
| 4D.8 fixes (editor + activation) | `scripts/test-phase4d9-fixes.ts` | 0 failures |
| Security | `npm run test:security` | PASS |
| Entitlement | `npm run test:entitlement` | 130/130 |
| Review Library | `npm run test:review` | 48/48 |
| Review import | `npm run test:review-import` | 13/13 |
| Card binding | `npm run test:cards` | 49/49 |
| Dynamic QR/NFC | `npm run test:dynamic` | 29/29 |
| Standee lifecycle | `npm run test:standee` | 24/24 |
| VCF | `npm run test:vcf` | 69/69 |
| QR PDF | `npm run test:qr-pdf` | PASS |
| Git diff | `git diff --check` | clean |

No assertion was weakened and no failing test was skipped.

## 18. Files created/modified

Created:

- `scripts/test-phase4d9-matrix.ts`
- `scripts/test-phase4d9-historical.ts`
- `scripts/test-phase4d9-fixes.ts`
- `docs/PHASE_4D.9_FINAL_LOCAL_RELEASE_GATE.md`

Modified:

- `src/lib/services/user-product-assignment.ts` — post-insert concurrency
  reconciliation.
- `package.json` — three additive 4D.9 test scripts.

Documentation updated (append-only addenda):

- `docs/REVIEW_MANAGEMENT.md`
- `docs/DATABASE_INDEX_RUNBOOK.md`
- `docs/PRODUCTION_DEPLOYMENT_RUNBOOK.md`
- `docs/ROLLBACK_RUNBOOK.md`
- `docs/MANUAL_DEVICE_QA_CHECKLIST.md`
- `docs/RELEASE_APPROVAL_CHECKLIST.md`

## 19. Documentation updated

The handoff documents now include: the 4D.9 matrix evidence, the deleted-host
analytics limitation and future option, the concurrency mitigation and residual
risk, the future approved partial unique index, physical-vs-emulation QA
distinctions, and 4D.9 approval items.

## 20. Local code blockers

None unresolved.

## 21. Security blockers

None unresolved.

## 22. Backward compatibility blockers

None unresolved. No customer data, alias, route, NFC/QR destination, Google
destination, analytics event or entitlement was changed.

## 23. Production verification pending

1. Read-only production index inspection and unique-duplicate preflight.
2. Approved creation/verification of the Review indexes.
3. Optional approved partial unique index for active Card assignments
   (concurrency hardening), with preflight.
4. Production catalog read-only verification for all canonical slugs.
5. Production zero-assignment legacy Card audit.
6. Backups/restore readiness and deployment approval.

## 24. External QA pending

1. Live AI provider verification with authorized non-production credentials.
2. External Google navigation without posting a review.
3. Physical Android/iPhone QR/NFC/clipboard testing.
4. TalkBack/VoiceOver screen-reader testing.

Browser emulation is not claimed as physical-device or screen-reader evidence.

## 25. Documented limitations

1. Deleted-host `AnalyticsLog` events cannot be attributed; raw events remain,
   business totals exclude them, rotation totals retain business attribution.
2. No customer checkout/payment provider exists; activation is admin-only.
3. Builder tablist uses Tab-order navigation, not ARIA arrow-key roving.
4. Admin UID input accepts any non-empty value up to 64 chars (trim +
   uppercase); overlong values are rejected, omitted values mint a digital card.
5. Multi-instance concurrency remains theoretically racy without the approved
   partial unique index; the local reconciliation covers the tested path.
6. Live AI, external Google navigation, physical devices and screen readers are
   NOT TESTED.

## 26. Production untouched — confirmed

No production or preview database/API access, deployment, migration, index
creation, feature activation, customer-record change, environment edit, commit
or push occurred. All writes used disposable local synthetic databases.

## 27. Final release recommendation

Local release-gate evidence is complete: the 16-combination matrix passes,
security and entitlement checks pass, both 4D.8 fixes hold, the concurrency race
is closed on the tested path, historical analytics behavior is documented, and
the full regression battery passes.

Production release still requires the read-only production verifications,
external QA and explicit owner approvals listed above.

**LOCAL RELEASE GATE PASSED — PRODUCTION VERIFICATION AND OWNER APPROVAL PENDING**
