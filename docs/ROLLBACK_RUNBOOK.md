# Rollback Runbook — Review Management / Standee / Analytics

**Status:** DOCUMENTATION ONLY. No production rollback was executed in Phase
4D.8. No customer data, aliases, destinations, analytics or rotation state may
be deleted or reset during rollback.

## 1. Immediate feature rollback (preferred)

Set flags OFF in the reverse dependency order of activation:

1. `STANDEE_REVIEW_ASSISTANT_ENABLED=false` — existing Standee `/r/` and `/qr/`
   URLs immediately return to their prior Google/profile/panel destinations.
2. `CENTRAL_REVIEW_PUBLIC_INTEGRATION_ENABLED=false` — public Card/Standee reads
   return to legacy/product settings; central documents and connections remain.
3. `SMART_REVIEW_ROTATION_ENABLED=false` — rotation gating becomes inert; copy
   events and cycle state remain stored.
4. `NEW_REVIEW_COPY_FLOW_ENABLED=false` — customers return to the legacy copy UI.

Rotation is dependent on copy flow; never leave rotation ON with copy flow OFF
and expect rotation to operate.

## 2. Application rollback

- Identify the approved previous deployment revision.
- Confirm additive database fields/indexes are compatible with the previous
  code (they are additive optional fields; no schema rewrite required).
- Deploy the approved previous revision through the normal authorized process.
- Run smoke tests:
  - login;
  - Card `/review/...` and profile URLs;
  - Standee `/r/...` and `/qr/...` destinations;
  - Google destinations;
  - Review Management/settings;
  - historical analytics;
  - VCF and QR PDF.

## 3. Database safety

During rollback:

- Do not delete customer records.
- Do not drop indexes automatically.
- Do not reset rotation states or cycles.
- Do not delete copy events or historical analytics.
- Do not rewrite Card aliases, Standee routeSlugs, NFC/QR URLs or Google URLs.
- Do not rewrite `Card.reviewAssistant`, central `ReviewSettings`, or Standee
  review fields.
- Leave additive indexes in place unless a separately approved index-removal
  plan exists.

## 4. Recovery verification

- [ ] Existing customer login.
- [ ] Existing public profiles.
- [ ] Existing Card aliases/NFC/QR URLs.
- [ ] Existing Standee route/panel/slot URLs.
- [ ] Existing Google destinations.
- [ ] Existing product entitlements and lower-tier restrictions.
- [ ] Existing Review Management/central/hybrid settings.
- [ ] Historical analytics/copy/rotation records readable.
- [ ] VCF/contact sharing and QR PDF generation.
- [ ] No increase in 5xx, redirect errors or duplicate-copy anomalies.

## 5. Rollback of this phase’s local fixes

The Phase 4D.8 local changes are additive:

- Builder tab-rail containment for mobile width.
- Same-UID duplicate active-assignment guard in `assignUserProduct`.

If either must be reverted, use a separately approved code rollback; do not
delete existing duplicate assignment records or alter customer data.

## 6. Customer communication

If a feature was activated and requires rollback, communicate:

- what changed temporarily;
- that existing links and Google destinations remain valid;
- that no customer data was deleted;
- the expected restoration time.

Do not send customer communication without owner approval.

## 7. Phase 4D.9 addendum

- The 4D.9 concurrency reconciliation in `assignUserProduct` deletes only a
  duplicate record created by the same losing request. It never modifies
  historical assignments. A code rollback of this change does not require data
  repair, but concurrent duplicate creation becomes possible again.
- If an approved partial unique index is ever added, do not drop it during an
  application rollback; assess active writes and duplicates first.
- Deleted-host `AnalyticsLog` rows must not be deleted, re-attributed or
  backfilled during rollback. Their exclusion from business totals is existing
  behavior.
- Rollback smoke tests additionally verify: duplicate UID still returns 409,
  an existing duplicate data set is preserved (not auto-cleaned), and Card
  aliases/Standee destinations remain unchanged.
- The new 4D.9 test scripts are read-only against disposable local databases and
  are safe to keep during rollback verification.
