# Production Deployment Runbook — Review Management / Standee / Analytics

**Status:** DOCUMENTATION ONLY. Nothing in this runbook was executed in Phase
4D.8. Production deployment and activation require explicit owner approval.

## 0. Release scope

Four supported review products:

- Google Review Card
- Google Review NFC Plate
- Premium NFC Card
- Google Review Standee

Feature flags, all default OFF:

- `NEW_REVIEW_COPY_FLOW_ENABLED`
- `SMART_REVIEW_ROTATION_ENABLED`
- `CENTRAL_REVIEW_PUBLIC_INTEGRATION_ENABLED`
- `STANDEE_REVIEW_ASSISTANT_ENABLED`

## 1. Approval gates

1. Owner approves release scope and revision.
2. Owner approves production index maintenance.
3. Owner approves each feature activation separately.
4. Owner approves the rollback plan.
5. Security/compatibility sign-off is recorded.
6. Production catalog and legacy-entitlement read-only checks are complete.

## 2. Pre-deployment checklist

- [ ] Release commit/revision identified and reviewed.
- [ ] `Devlopment` working tree content matches the approved release scope.
- [ ] Production backup completed and restore readiness verified.
- [ ] Production catalog identity verified read-only:
  - `premium-nfc-card`
  - `google-review-card`
  - `google-review-nfc-plate`
  - `google-review-standee`
  - `business-nfc-card`
  - Confirm display names are not used for entitlement.
- [ ] Legacy zero-assignment Card audit completed/approved.
- [ ] Index inventory inspected read-only (see `DATABASE_INDEX_RUNBOOK.md`).
- [ ] Unique duplicate preflight completed; no unresolved duplicates.
- [ ] Production environment remains unchanged until approval.
- [ ] Monitoring dashboards/alerts prepared.
- [ ] Rollback flags/previous deployment identified.

## 3. Database readiness

1. Enter the approved maintenance window.
2. Create only approved indexes from `DATABASE_INDEX_RUNBOOK.md`.
3. Verify each index by name/key/options.
4. Verify database health/latency.
5. Confirm no duplicate-key or dimension errors.
6. Record index build outcome.
7. If any unique preflight fails: STOP; do not deploy/activate; request
   separately approved remediation.

## 4. Application release (flags OFF)

Deploy the approved revision with all four flags OFF.

Verify:

- [ ] Existing customer login works.
- [ ] Existing Card public URLs resolve.
- [ ] Existing Standee `/r/` and `/qr/` links resolve to their original
      destinations.
- [ ] Existing NFC/QR redirects unchanged.
- [ ] Existing Google destinations unchanged.
- [ ] Historical analytics readable.
- [ ] Review Management loads, saves and previews.
- [ ] Product entitlements unchanged.
- [ ] Lower-tier Cards remain restricted.
- [ ] VCF/contact sharing and QR PDF generation work.

Smoke examples (use real authorized aliases only in production):

```bash
curl -s -o /dev/null -w '%{http_code}\n' https://<host>/login
curl -s -o /dev/null -w '%{http_code}\n' https://<host>/dashboard/review-management
curl -s -o /dev/null -w '%{http_code}\n' https://<host>/review/<known-card-alias>
curl -s -o /dev/null -w '%{http_code}\n' https://<host>/standee-review/<known-standee-route>
curl -s -o /dev/null -w '%{http_code}\n' https://<host>/r/<known-standee-route>
```

Do not call production APIs from Phase 4D.8. These commands are for the
authorized release operator only.

## 5. Controlled feature activation

Recommended dependency-aware order:

1. **Copy flow** — `NEW_REVIEW_COPY_FLOW_ENABLED=true` (optional; changes UI).
2. **Rotation** — `SMART_REVIEW_ROTATION_ENABLED=true` only after copy flow is
   enabled and observed healthy. Rotation is inert without copy flow.
3. **Central public integration** — `CENTRAL_REVIEW_PUBLIC_INTEGRATION_ENABLED=true`
   after central settings, resolver and product connections are verified.
4. **Standee host** — `STANDEE_REVIEW_ASSISTANT_ENABLED=true` after Central
   content (if desired) and Standee destinations are verified. With central
   gate OFF, the Standee host uses Standee product settings and its own URL.

Activate one flag at a time. Run the smoke checks after each flag; wait for a
stable observation window before the next.

### Per-flag verification

| Flag | Verify |
|---|---|
| Copy flow | Two-button/legacy copy behavior; clipboard; no automatic posting |
| Rotation | Token issuance, 409 stale/expired, idempotent copies; rotation dashboard |
| Central | Central/hybrid Card pages; legacy fallback; lower-tier isolation |
| Standee | `/r/` and `/qr/` route to host; original Google URL preserved; ineligible Standees unchanged |

## 6. Post-release verification

- [ ] Google Review Card flow.
- [ ] Google Review NFC Plate flow.
- [ ] Premium NFC Card flow.
- [ ] Google Review Standee flow.
- [ ] Legacy lower-tier Card restriction.
- [ ] Existing aliases/NFC/QR URLs.
- [ ] Existing Google destinations.
- [ ] Historical analytics/copy/rotation records.
- [ ] Review Management and Review Analytics.
- [ ] Monitoring signals healthy.
- [ ] Rollback remains available.

## 7. Monitoring / rollback triggers

See the final Phase 4D.8 report and `ROLLBACK_RUNBOOK.md`. Provisional alert
thresholds must be approved; no production baseline is assumed by this
document.

## 8. Explicit non-authorization

This runbook does not authorize deployment, index creation, flag activation,
production database access, or customer communication. Those require separate
owner approval.

## 9. Phase 4D.9 addendum — verified expectations

- Local matrix evidence: 16 combinations × 12 checks = **192/192** on the final
  code (`scripts/test-phase4d9-matrix.ts`).
- Deploy with all four flags OFF. Expected OFF behavior: Card hosts unchanged,
  Standee `/r/`/`/qr/` preserve their Google/profile destinations, central reads
  stay legacy, rotation stays inert even if its flag is accidentally set.
- The Phase 4D.9 assignment concurrency reconciliation is application-only; it
  does not require an index. The optional partial unique index is a separate
  approval item (`DATABASE_INDEX_RUNBOOK.md` §8.1).
- Deleted-host analytics are a documented limitation: do not promise restored
  historical attribution and do not run an unapproved backfill.

### 9.1 Authorized non-production AI check

Use an approved non-production OpenAI account/key and synthetic review text:

1. Configure the key only in an isolated non-production environment.
2. Submit short feedback through the public generate endpoint.
3. Verify a returned draft is editable and no review is posted.
4. Simulate timeout/invalid key and verify `UNAVAILABLE` with no fabricated
   draft.
5. Never log or expose the key; never use customer data.

### 9.2 Authorized Google navigation check

1. Use a synthetic Google review destination.
2. Verify the draft copies before the external link opens.
3. Verify popup-blocked handling shows a usable fallback link.
4. Stop at the Google page; do **not** submit a review.
5. Confirm no automatic posting and no duplicate copy event.

### 9.3 Physical-device handoff

Use `MANUAL_DEVICE_QA_CHECKLIST.md`. Browser emulation is not a substitute for
physical Android/iPhone, TalkBack or VoiceOver verification.
