# Release Approval Checklist — Phase 4D.8

**Release status:** LOCAL READINESS COMPLETE — PRODUCTION VERIFICATION PENDING.
This checklist does not authorize deployment or activation.

## A. Scope and revision

- [ ] Owner approves the release scope (Review Management, Card/Plate/Premium/Standee, rotation/copy flow, analytics).
- [ ] Approved revision/deployment identified.
- [ ] Branch/HEAD/working-tree reviewed.
- [ ] No unrelated changes included.
- [ ] Rollback plan reviewed.

## B. Backups and data safety

- [ ] Production backup complete.
- [ ] Restore readiness verified.
- [ ] No destructive migration required.
- [ ] No customer record rewrite required.
- [ ] No NFC/QR alias, routeSlug, publicSlug or Google destination rewrite.
- [ ] Historical analytics/copy/rotation retention approved.

## C. Database indexes

- [ ] Index inventory approved (`DATABASE_INDEX_RUNBOOK.md`).
- [ ] Read-only production index inspection completed.
- [ ] Unique-index duplicate preflight completed.
- [ ] No unresolved duplicates.
- [ ] Maintenance window approved.
- [ ] Index creation/verification owner approved.
- [ ] Rollback/index-retention plan approved.

## D. Catalog and entitlement

- [ ] Production catalog read-only verification:
  - [ ] `premium-nfc-card`
  - [ ] `google-review-card`
  - [ ] `google-review-nfc-plate`
  - [ ] `google-review-standee`
  - [ ] `business-nfc-card`
- [ ] Display-name spoofing cannot grant entitlement.
- [ ] Lower-tier Cards remain restricted.
- [ ] Existing Google Review Card/Plate access preserved.
- [ ] Existing/new Premium access preserved.
- [ ] Existing/new Standee access preserved.
- [ ] Zero-assignment legacy Card audit completed/approved.
- [ ] No unauthorized entitlement revocation.

## E. External verification

- [ ] Live AI provider verification completed or explicitly approved as blocked.
- [ ] External Google navigation verified or explicitly approved as blocked.
- [ ] Physical Android/iPhone QA completed or explicitly approved as blocked.
- [ ] TalkBack/VoiceOver QA completed or explicitly approved as blocked.
- [ ] Product editor visual workflow verified.
- [ ] Admin activation/assignment workflow verified.
- [ ] Customer checkout/payment status documented (no payment checkout exists in this codebase).

## F. Release gates

- [ ] Typecheck/lint pass.
- [ ] Builds with flags OFF/ON pass.
- [ ] 4D.5/4D.6/analytics regressions pass.
- [ ] Security/tenant/entitlement checks pass.
- [ ] Feature-flag matrix approved.
- [ ] Browser/mobile/accessibility checks reviewed.
- [ ] Monitoring prepared.
- [ ] Rollback runbook approved.
- [ ] Explicit owner approval for deployment.
- [ ] Explicit owner approval for each feature flag.

## G. Activation approvals (one at a time)

- [ ] Copy flow.
- [ ] Rotation (after copy flow).
- [ ] Central public integration.
- [ ] Standee public host.

Do not check an activation item without the corresponding separate approval and
post-activation smoke evidence.

## H. Phase 4D.9 local gate evidence

- [ ] 16-combination × 12-check matrix reviewed (192/192).
- [ ] Deleted-host analytics limitation accepted as documented.
- [ ] Concurrency reconciliation reviewed; optional partial unique index
      decision recorded (approved or deferred).
- [ ] 4D.8 builder overflow and sequential duplicate UID fixes verified.
- [ ] Historical analytics and tenant isolation evidence reviewed.
- [ ] 4D.9 regression battery reviewed.
- [ ] No unresolved local security or backward-compatibility blocker.

## I. External evidence before release

- [ ] Authorized non-production AI provider test completed or explicitly waived.
- [ ] Google navigation verified without posting a review, or explicitly waived.
- [ ] Physical Android/iPhone checklist completed or explicitly waived.
- [ ] TalkBack/VoiceOver checklist completed or explicitly waived.
- [ ] Production read-only catalog, index and zero-assignment audits completed.
- [ ] Backup/restore readiness confirmed.
- [ ] Owner approves deployment revision and each flag separately.

The 4D.9 status is **LOCAL RELEASE GATE PASSED — PRODUCTION VERIFICATION AND
OWNER APPROVAL PENDING**; it is not deployment authorization.
