# TAPREVIA — PHASE 4D.10 GATE A PREFLIGHT

**Stage:** Gate A — production preflight preparation (strict read-only)
**Status:** READY FOR AUTHORIZED READ-ONLY PRODUCTION PREFLIGHT
**Production access in Gate A:** NONE
**Deployment / activation / migration:** NOT AUTHORIZED

This document prepares a separately approved read-only production preflight. No
production or preview system was contacted. Nothing here authorizes Gate B,
deployment, index creation, data remediation, feature activation or customer
communication.

---

## 1. Repository status

| Item | Verified value |
|---|---|
| Branch | `Devlopment` |
| HEAD | `8e9a45fdbae9eef24c1f341594c27bfd209090e0` |
| Working tree | 86 modified/untracked entries before this document; 87 after |
| Phase 4D.9 present | Yes — matrix/historical/fixes harnesses + report + concurrency reconciliation |
| Typecheck | PASS (`npm run typecheck`) |
| ESLint | PASS (`npm run lint`) |
| Build flags OFF | PASS |
| Build flags ON | PASS |
| `git diff --check` | clean |
| `.env.local` mtime | `2026-10-04 12:13:12` (unchanged) |
| `.env.preview` mtime | `2026-10-09 23:36:49` (unchanged) |
| Local DB host | `localhost` only |
| Flags | all four OFF |
| Port `3501` | free |

4D.9 evidence remains valid and was not altered in Gate A.

---

## 2. Security and backward compatibility status

| Area | Status |
|---|---|
| Local security boundary suite | PASS |
| Tenant/entitlement isolation | PASS (130/130 entitlement, matrix + 4D.5/4D.6) |
| 16-combination flag matrix | 192/192 |
| Lower-tier restriction | PASS |
| Existing aliases/NFC/QR/Google destinations | preserved in every combination |
| Historical analytics readability | PASS (deleted-host attribution limitation documented) |
| Duplicate UID sequential/case/cross-customer | 409 |
| Concurrent duplicate UID | 201/409 with one active record (4D.9 fix) |
| Unresolved local security blocker | none |
| Unresolved local compatibility blocker | none |

Gate A introduced no code or data changes.

### 2.1 Runbook verification against source

| Document | Verified against | Result |
|---|---|---|
| `DATABASE_INDEX_RUNBOOK.md` | ReviewSettings/ReviewRotationEvent/ReviewRotationState/AnalyticsLog/UserProduct schemas; `autoIndex` policy | Matches; partial-index caveat documented |
| `PRODUCTION_DEPLOYMENT_RUNBOOK.md` | Flag definitions, order, `/r/`/`/qr/` behavior, entitlement paths | Matches; smoke commands are operator-only |
| `ROLLBACK_RUNBOOK.md` | Flag dependency `REVIEW_ROTATION_ACTIVE`, legacy fallbacks, data-safety rules | Matches |
| `RELEASE_APPROVAL_CHECKLIST.md` | Current gate status | Procedures valid; header still says Phase 4D.8 — superseded by 4D.9/Gate A reports |
| `PHASE_4D.9_FINAL_LOCAL_RELEASE_GATE.md` | 4D.9 code and test harnesses | Matches |

No runbook procedure was executed.

---

## 3. Verified index specifications

Verified against the actual Mongoose schemas and by creating the same index
shapes in a disposable local database (`taprevia_4d10_indexcheck`, dropped after
the check).

### 3.1 Review collections (release indexes)

| Collection | Index name | Keys | Options | Source |
|---|---|---|---|---|
| `reviewsettings` | `businessId_1` | `{ businessId: 1 }` | unique | `src/models/ReviewSettings.ts` |
| `reviewrotationevents` | `businessId_1_categoryKey_1_templateId_1_cycle_1` | `{ businessId: 1, categoryKey: 1, templateId: 1, cycle: 1 }` | unique | `src/models/ReviewRotationEvent.ts` |
| `reviewrotationevents` | `copyId_1` | `{ copyId: 1 }` | unique | same |
| `reviewrotationevents` | `businessId_1_categoryKey_1_copiedAt_-1` | `{ businessId: 1, categoryKey: 1, copiedAt: -1 }` | non-unique | same |
| `reviewrotationevents` | `businessId_1_copiedAt_-1` | `{ businessId: 1, copiedAt: -1 }` | non-unique | same |
| `reviewrotationstates` | `businessId_1_categoryKey_1` | `{ businessId: 1, categoryKey: 1 }` | unique | `src/models/ReviewRotationState.ts` |
| `analyticslogs` | `cardId_1_timestamp_-1` | `{ cardId: 1, timestamp: -1 }` | existing | `src/models/AnalyticsLog.ts` |
| `analyticslogs` | `standeeId_1_timestamp_-1` | `{ standeeId: 1, timestamp: -1 }` | existing | same |
| `analyticslogs` | `cardId_1_action_1_createdAt_-1` | `{ cardId: 1, action: 1, createdAt: -1 }` | non-unique | same |
| `analyticslogs` | `standeeId_1_action_1_createdAt_-1` | `{ standeeId: 1, action: 1, createdAt: -1 }` | non-unique | same |
| `analyticslogs` | `timestamp_1` | `{ timestamp: 1 }` | TTL 15 552 000 s (180 d) | same |

Local duplicate probes confirmed each unique index rejects a true duplicate and
accepts distinct values.

### 3.2 Existing assignment/identity indexes (not release changes)

| Collection | Index / field | Options |
|---|---|---|
| `userproducts` | `userId_1_status_1` | non-unique |
| `userproducts` | `catalogProductId_1` | non-unique |
| `userproducts` | `cardId_1` | non-unique |
| `cards` | `cardUid` (field) | unique |
| `cards` | `slug` (field) | unique, lowercase |
| `cards` | `routeSlug_1` / `uid_1` / `publicSlug_1` | unique + sparse |
| `standees` | `panelQr.qrId_1` | unique |
| `standees` | `socialQrs.qrId_1` | unique + sparse |
| `standees` | `routeSlug_1` / `uid_1` / `publicSlug_1` | unique + sparse |
| `catalogproducts` | `slug` (field) | unique, lowercase |

These must not be rebuilt or dropped as part of this release.

### 3.3 Optional active-assignment index (verified, NOT approved)

Proposed specification:

```js
db.userproducts.createIndex(
  { userId: 1, cardId: 1 },
  {
    unique: true,
    name: 'userId_1_cardId_1_active_unique',
    partialFilterExpression: { status: 'active', cardId: { $type: 'objectId' } }
  }
);
```

Local lifecycle verification:

| Fixture | Result |
|---|---|
| Active + historical `removed` row for same user/card | allowed |
| Different Cards, same user | allowed |
| Standee/other assignments with `cardId: null` | allowed (excluded by partial filter) |
| Duplicate active same `userId` + `cardId` | rejected (`E11000`) |
| Same Card active for a different user | **allowed** |

**Important:** this index enforces per-customer uniqueness only. It does **not**
prove global physical-card ownership — that is enforced by
`provisionCardForAssignment`/`uidConflictForUser`. The audit must separately
check the same Card appearing in active assignments for more than one customer.
The index is optional, is not required for the 4D.9 code fix, and must not be
created without a separate approval and clean preflight.

`autoIndex` is disabled in production (`src/lib/db-target.ts`), so process
startup does not create or alter indexes.

---

## 4. Read-only production inspection commands

**DOCUMENTATION ONLY — DO NOT EXECUTE IN GATE A.**
Every command below is a read (`find`/`aggregate`/`getIndexes`/`countDocuments`).
`$out` and `$merge` must not be used. Run only under a separately approved
read-only session.

Use `mongosh "<PRODUCTION_READ_ONLY_URI>" "<PRODUCTION_DB>" --quiet` and record
the exact database name returned by `db.getName()`.

### 4.1 Session inventory

```js
db.getName();
db.getCollectionNames().sort();
[ 'reviewsettings', 'reviewrotationevents', 'reviewrotationstates',
  'analyticslogs', 'userproducts', 'cards', 'standees', 'catalogproducts',
  'users' ].forEach((name) => print(name + ': ' +
    (db.getCollectionNames().includes(name) ? 'present' : 'missing')));
```

### 4.2 Existing indexes

```js
db.reviewsettings.getIndexes();
db.reviewrotationevents.getIndexes();
db.reviewrotationstates.getIndexes();
db.analyticslogs.getIndexes();
db.userproducts.getIndexes();
db.cards.getIndexes();
db.standees.getIndexes();
db.catalogproducts.getIndexes();
```

Record name, key order, `unique`, `sparse`, `partialFilterExpression` and
`expireAfterSeconds`. Compare only — do not create/alter/drop.

### 4.3 Collection cardinalities (connective health, read-only)

```js
[ 'reviewsettings', 'reviewrotationevents', 'reviewrotationstates',
  'analyticslogs', 'userproducts', 'cards', 'standees',
  'catalogproducts', 'users' ].forEach((name) =>
    print(name + ': ' + db.getCollection(name).estimatedDocumentCount()));
```

---

## 5. Duplicate UID and assignment detection procedure

All queries are read-only. Any returned row is a blocker for the related action;
never delete, merge or reassign records automatically.

### 5.1 Duplicate active assignment for the same customer and Card

This is the blocking preflight for the optional partial unique index.

```js
db.userproducts.aggregate([
  { $match: { status: 'active', cardId: { $type: 'objectId' } } },
  { $group: { _id: { userId: '$userId', cardId: '$cardId' }, count: { $sum: 1 } } },
  { $match: { count: { $gt: 1 } } },
  { $lookup: { from: 'cards', localField: '_id.cardId', foreignField: '_id', as: 'card' } },
  { $project: {
      userId: '$_id.userId', cardId: '$_id.cardId', count: 1,
      cardUid: { $arrayElemAt: ['$card.cardUid', 0] },
      urlAlias: { $arrayElemAt: ['$card.urlAlias', 0] }
  } }
]);
```

### 5.2 Same Card active for more than one customer

Not blocked by the per-customer index; still a data-integrity finding.

```js
db.userproducts.aggregate([
  { $match: { status: 'active', cardId: { $type: 'objectId' } } },
  { $group: { _id: '$cardId', users: { $addToSet: '$userId' }, count: { $sum: 1 } } },
  { $match: { users: { $gt: [] }, count: { $gt: 1 } } },
  { $match: { $expr: { $gt: [{ $size: '$users' }, 1] } } },
  { $lookup: { from: 'cards', localField: '_id', foreignField: '_id', as: 'card' } },
  { $project: { cardId: '$_id', users: 1, count: 1,
      cardUid: { $arrayElemAt: ['$card.cardUid', 0] } } }
]);
```

Also run the equivalent count by customer with `users` cardinality, so a single
user with two quantities is not confused with two customers.

### 5.3 Duplicate Card UID documents (existing unique index audit)

```js
db.cards.aggregate([
  { $group: {
      _id: { $toUpper: { $trim: { input: '$cardUid' } } },
      count: { $sum: 1 }, ids: { $push: '$_id' } } },
  { $match: { count: { $gt: 1 } } }
]);
```

### 5.4 Active assignments pointing at a missing Card

```js
db.userproducts.aggregate([
  { $match: { status: 'active', cardId: { $type: 'objectId' } } },
  { $lookup: { from: 'cards', localField: 'cardId', foreignField: '_id', as: 'card' } },
  { $match: { card: { $size: 0 } } },
  { $project: { userId: 1, cardId: 1, catalogProductId: 1 } }
]);
```

### 5.5 Duplicate review indexes

```js
db.reviewsettings.aggregate([
  { $group: { _id: '$businessId', count: { $sum: 1 } } },
  { $match: { count: { $gt: 1 } } }
]);

db.reviewrotationstates.aggregate([
  { $group: { _id: { businessId: '$businessId', categoryKey: '$categoryKey' }, count: { $sum: 1 } } },
  { $match: { count: { $gt: 1 } } }
]);

db.reviewrotationevents.aggregate([
  { $group: { _id: {
      businessId: '$businessId', categoryKey: '$categoryKey',
      templateId: '$templateId', cycle: '$cycle' }, count: { $sum: 1 } } },
  { $match: { count: { $gt: 1 } } }
]);

db.reviewrotationevents.aggregate([
  { $group: { _id: '$copyId', count: { $sum: 1 } } },
  { $match: { count: { $gt: 1 } } }
]);
```

### 5.6 Decision rules

| Finding | Decision |
|---|---|
| Duplicate `ReviewSettings.businessId` | Unique-index creation BLOCKED pending approved remediation |
| Duplicate rotation state business/category | BLOCKED |
| Duplicate rotation composite key or `copyId` | BLOCKED |
| Duplicate active assignment same customer+Card | Optional partial index BLOCKED; existing duplicates preserved |
| Same Card active for multiple customers | Data-integrity escalation; do not auto-repair |
| Card UID duplicates | Escalate; existing unique index should make this impossible |
| Missing Card reference | Escalate; no automatic cleanup |

---

## 6. Product catalog verification procedure

Canonical values are defined in `src/config/products.ts`. Display names are not
entitlement sources.

| Capability ID | Catalog slug | Expected kind/category |
|---|---|---|
| `GOOGLE_REVIEW_CARD` | `google-review-card` | review / card |
| `GOOGLE_REVIEW_NFC_PLATE` | `google-review-nfc-plate` | review / card |
| `PREMIUM_NFC_CARD` | `premium-nfc-card` | profile / card |
| `GOOGLE_REVIEW_STANDEE` | `google-review-standee` | standee / standee |
| `BUSINESS_NFC_CARD` | `business-nfc-card` | profile / card |

Read-only checks:

```js
db.catalogproducts.find(
  { slug: { $in: [
      'google-review-card', 'google-review-nfc-plate', 'premium-nfc-card',
      'google-review-standee', 'business-nfc-card' ] } },
  { slug: 1, name: 1, kind: 1, category: 1, active: 1 }
).sort({ slug: 1 }).toArray();

db.catalogproducts.aggregate([
  { $group: { _id: '$slug', count: { $sum: 1 } } },
  { $match: { count: { $gt: 1 } } }
]);

db.catalogproducts.find(
  { active: true },
  { slug: 1, name: 1, kind: 1, category: 1 }
).sort({ slug: 1 }).toArray();

// Active assignments pointing at a missing catalog product.
db.userproducts.aggregate([
  { $match: { status: 'active' } },
  { $lookup: { from: 'catalogproducts', localField: 'catalogProductId', foreignField: '_id', as: 'p' } },
  { $match: { p: { $size: 0 } } },
  { $project: { userId: 1, cardId: 1, standeeId: 1, catalogProductId: 1 } }
]);
```

Verification rules:

- Every canonical slug must exist exactly once, be `active: true`, and have the
  expected `kind`/`category`.
- A product whose display name is “Premium NFC Card” but whose slug is not
  `premium-nfc-card` must not grant review capability.
- Unknown or renamed slugs do not grant entitlement.
- Any missing/inactive canonical product or duplicate slug is a release blocker
  until separately approved remediation.

---

## 7. Historical zero-assignment entitlement verification

Policy (source: `src/lib/services/review-entitlement.ts`):

1. Cards with any `UserProduct` record are evaluated strictly by active product
   capability; removed/lower-tier assignments deny.
2. Cards with **no** assignment:
   - `kind === 'review'` keeps the account capability (`legacy-review-host`).
   - Non-review Cards already `reviewAssistant.enabled === true` are preserved
     (`legacy-preserved`) to avoid silent revocation.
   - Non-review disabled Cards are denied.
3. This is intentionally preserved pending a production audit; no automatic
   revocation.

Read-only inventory:

```js
db.cards.aggregate([
  { $lookup: { from: 'userproducts', localField: '_id', foreignField: 'cardId', as: 'assignments' } },
  { $match: { assignments: { $size: 0 } } },
  { $lookup: { from: 'users', localField: 'userId', foreignField: '_id', as: 'owner' } },
  { $project: {
      cardId: '$_id', urlAlias: 1, kind: 1, isActive: 1,
      reviewEnabled: { $eq: ['$reviewAssistant.enabled', true] },
      ownerId: '$userId',
      ownerStatus: { $arrayElemAt: ['$owner.status', 0] },
      ownerRole: { $arrayElemAt: ['$owner.role', 0] }
  } },
  { $group: {
      _id: { kind: '$kind', reviewEnabled: '$reviewEnabled', ownerStatus: '$ownerStatus' },
      count: { $sum: 1 }
  } },
  { $sort: { '_id.kind': 1, '_id.reviewEnabled': 1 } }
]);
```

Owner capability inventory (review-capable active product slugs only):

```js
db.userproducts.aggregate([
  { $match: { status: 'active' } },
  { $lookup: { from: 'catalogproducts', localField: 'catalogProductId', foreignField: '_id', as: 'p' } },
  { $match: { 'p.slug': { $in: [
      'google-review-card', 'google-review-nfc-plate',
      'premium-nfc-card', 'google-review-standee' ] } } },
  { $group: { _id: '$userId' } }
]);
```

Approved operator procedure:

1. Export the zero-assignment Card inventory (IDs, kind, enabled, owner status).
2. Export the set of owners with an active review-capable product.
3. Classify each Card:
   - `legacy-review-host` — kind `review`, owner capable; expected entitled.
   - `legacy-preserved` — non-review, enabled, owner capable; must not be
     revoked without approval.
   - `denied` — non-review disabled or owner not capable.
4. Compare counts against application behavior on a read-only basis.
5. Report any Card whose behavior would unexpectedly change. Do not modify.

Suspended owners are denied by the public guard regardless of classification.

---

## 8. Backup verification checklist

No backup or restore is initiated in Gate A. Source defaults:
`src/lib/db-target.ts` defines production primary `test` and backup
`taprevia_backup`; confirm against the deployed environment rather than assuming.

- [ ] Production Atlas project and cluster identified.
- [ ] Continuous backup / snapshot policy confirmed enabled.
- [ ] Latest successful snapshot timestamp recorded and within the approved RPO.
- [ ] Snapshot covers the production primary database (`test` per source).
- [ ] Restore procedure documented and previously rehearsed in an isolated
      project (never into production).
- [ ] Restore-time objective and retention window recorded.
- [ ] Operator roles confirmed: read-only DB role for preflight; backup/restore
      roles held only by authorized operators.
- [ ] No shared cluster risk: non-production must not target
      `taprevia_backup` (`resolveBackupDbName` guard verified in source).
- [ ] Monitoring/alerting for backup failure and restore readiness confirmed.
- [ ] Restore rehearsal evidence attached to the release record.
- [ ] Owner signs off backup/restore readiness before any index or deploy work.

---

## 9. External QA checklist

### Completed automated (Gate A evidence)

- [x] 16-combination flag matrix — 192/192.
- [x] 4D.5 Review Management — 112/112.
- [x] 4D.6 Standee — 80/80.
- [x] Unified analytics — 9/9.
- [x] Historical/deleted-host audit — 9/9.
- [x] Security boundaries — PASS.
- [x] Entitlement — 130/130.
- [x] Review Library 48/48; import 13/13; card binding 49/49; dynamic 29/29;
      Standee lifecycle 24/24; VCF 69/69; QR PDF PASS.
- [x] Builder responsive 14/14 rows; duplicate UID/concurrency harness.

### Pending manual / external (NOT TESTED)

- [ ] Authorized non-production live AI provider: success, timeout, empty,
      auth failure, rate limit, network failure, invalid response, fallback.
      Use synthetic text and a non-production key; never log the key.
- [ ] External Google navigation with a synthetic destination: copy first,
      popup-blocked fallback, no automatic posting. Stop before submitting.
- [ ] Android physical device: QR scan, NFC tap where supported, draft,
      clipboard success/failure, Google continuation, Chrome keyboard.
- [ ] iPhone physical device: QR scan, NFC where supported, Safari clipboard,
      Google continuation.
- [ ] TalkBack: headings, labels, draft textarea, buttons, errors, focus order.
- [ ] VoiceOver: same coverage on Safari.
- [ ] Real device viewports 320–430; native keyboard; touch targets.

Browser emulation is not physical-device or screen-reader evidence.

---

## 10. Risks and blockers

| Item | Classification | Notes |
|---|---|---|
| Production indexes not yet inspected | PRODUCTION VERIFICATION PENDING | Read-only preflight required |
| Duplicate review keys unknown in production | PRODUCTION VERIFICATION PENDING | Blocking for unique index creation if present |
| Duplicate active assignments unknown in production | PRODUCTION VERIFICATION PENDING | Blocking for optional partial index; existing code fix does not repair history |
| Same Card active for multiple customers unknown | PRODUCTION VERIFICATION PENDING | Data-integrity escalation; index does not prevent it |
| Canonical catalog identifiers unverified in production | PRODUCTION VERIFICATION PENDING | Blocking if missing/renamed |
| Zero-assignment legacy Cards unaudited in production | PRODUCTION VERIFICATION PENDING | Do not revoke without approval |
| Backup/restore readiness unverified | PRODUCTION VERIFICATION PENDING | Required before index/deploy |
| Multi-instance concurrency residual risk | DOCUMENTED LIMITATION | Local reconciliation covers tested path; DB-level index is the robust control |
| Deleted-host analytics attribution | DOCUMENTED LIMITATION | No persisted `businessId`; no backfill approved |
| No customer payment checkout | DOCUMENTED LIMITATION | Activation is admin-only |
| Arrow-key roving tablist | DOCUMENTED LIMITATION | Tab-order navigation works |
| Live AI / Google navigation / devices / screen readers | EXTERNAL QA PENDING | Not tested |
| Approval checklist header still shows 4D.8 status | DOCUMENTATION NOTE | Read with 4D.9/Gate A reports; not an authorization |
| Production/preview credentials not available in Gate A | BLOCKER FOR GATE B ONLY | Gate A preparation is complete |

No unresolved local code, security or backward-compatibility blocker was found.

---

## 11. Required access permissions

For a separately approved read-only preflight:

| Permission | Scope | Purpose |
|---|---|---|
| MongoDB read | Production primary database only | `find`, `aggregate`, `getIndexes`, `countDocuments`, `estimatedDocumentCount`, `getCollectionNames` |
| MongoDB `listDatabases`/metadata (if required) | Cluster metadata | Confirm database name only; avoid broad access otherwise |
| Atlas backup read | Production project | Snapshot status, retention, restore evidence |
| Monitoring read | Production project | Error/latency/backup dashboards |
| Vercel read (optional) | Deployment/log metadata | Revision and log confirmation; no deploy |
| Repository read | Local checkout | Source/spec comparison |

Explicitly **not** required and must not be granted for Gate A execution:
write/DDL, index creation, `dbAdmin`, `userAdmin`, deployment rights, environment
variable access, customer-record access beyond aggregate read-only queries,
payment/provider credentials.

---

## 12. Exact commands proposed for separately approved read-only execution

**DOCUMENTATION ONLY — DO NOT EXECUTE IN GATE A.**
All commands are reads. Do not use `$out`, `$merge`, `createIndex`, `dropIndex`,
`update*`, `delete*`, `insert*` or `replace*`.

### 12.1 Index inventory

```bash
mongosh "<PRODUCTION_READ_ONLY_URI>" "<PRODUCTION_DB>" --quiet --eval '
  printjson({
    database: db.getName(),
    reviewsettings: db.reviewsettings.getIndexes(),
    reviewrotationevents: db.reviewrotationevents.getIndexes(),
    reviewrotationstates: db.reviewrotationstates.getIndexes(),
    analyticslogs: db.analyticslogs.getIndexes(),
    userproducts: db.userproducts.getIndexes()
  });
'
```

### 12.2 Duplicate review keys

```bash
mongosh "<PRODUCTION_READ_ONLY_URI>" "<PRODUCTION_DB>" --quiet --eval '
  printjson({
    duplicateReviewSettings: db.reviewsettings.aggregate([
      { $group: { _id: "$businessId", count: { $sum: 1 } } },
      { $match: { count: { $gt: 1 } } }
    ]).toArray(),
    duplicateRotationStates: db.reviewrotationstates.aggregate([
      { $group: { _id: { businessId: "$businessId", categoryKey: "$categoryKey" }, count: { $sum: 1 } } },
      { $match: { count: { $gt: 1 } } }
    ]).toArray(),
    duplicateRotationComposite: db.reviewrotationevents.aggregate([
      { $group: { _id: {
          businessId: "$businessId", categoryKey: "$categoryKey",
          templateId: "$templateId", cycle: "$cycle" }, count: { $sum: 1 } } },
      { $match: { count: { $gt: 1 } } }
    ]).toArray(),
    duplicateRotationCopyId: db.reviewrotationevents.aggregate([
      { $group: { _id: "$copyId", count: { $sum: 1 } } },
      { $match: { count: { $gt: 1 } } }
    ]).toArray()
  });
'
```

### 12.3 Duplicate active assignments and UID integrity

```bash
mongosh "<PRODUCTION_READ_ONLY_URI>" "<PRODUCTION_DB>" --quiet --eval '
  printjson({
    duplicateCustomerCard: db.userproducts.aggregate([
      { $match: { status: "active", cardId: { $type: "objectId" } } },
      { $group: { _id: { userId: "$userId", cardId: "$cardId" }, count: { $sum: 1 } } },
      { $match: { count: { $gt: 1 } } },
      { $lookup: { from: "cards", localField: "_id.cardId", foreignField: "_id", as: "card" } },
      { $project: { userId: "$_id.userId", cardId: "$_id.cardId", count: 1,
          cardUid: { $arrayElemAt: ["$card.cardUid", 0] } } }
    ]).toArray(),
    sameCardMultipleCustomers: db.userproducts.aggregate([
      { $match: { status: "active", cardId: { $type: "objectId" } } },
      { $group: { _id: "$cardId", users: { $addToSet: "$userId" }, count: { $sum: 1 } } },
      { $match: { $expr: { $gt: [{ $size: "$users" }, 1] } } },
      { $lookup: { from: "cards", localField: "_id", foreignField: "_id", as: "card" } },
      { $project: { cardId: "$_id", users: 1, count: 1,
          cardUid: { $arrayElemAt: ["$card.cardUid", 0] } } }
    ]).toArray(),
    duplicateCardUid: db.cards.aggregate([
      { $group: { _id: { $toUpper: { $trim: { input: "$cardUid" } } },
          count: { $sum: 1 }, ids: { $push: "$_id" } } },
      { $match: { count: { $gt: 1 } } }
    ]).toArray(),
    activeAssignmentMissingCard: db.userproducts.aggregate([
      { $match: { status: "active", cardId: { $type: "objectId" } } },
      { $lookup: { from: "cards", localField: "cardId", foreignField: "_id", as: "card" } },
      { $match: { card: { $size: 0 } } },
      { $project: { userId: 1, cardId: 1, catalogProductId: 1 } }
    ]).toArray()
  });
'
```

### 12.4 Catalog identifiers and references

```bash
mongosh "<PRODUCTION_READ_ONLY_URI>" "<PRODUCTION_DB>" --quiet --eval '
  printjson({
    canonical: db.catalogproducts.find(
      { slug: { $in: [
          "google-review-card", "google-review-nfc-plate", "premium-nfc-card",
          "google-review-standee", "business-nfc-card" ] } },
      { slug: 1, name: 1, kind: 1, category: 1, active: 1 }
    ).sort({ slug: 1 }).toArray(),
    duplicateSlug: db.catalogproducts.aggregate([
      { $group: { _id: "$slug", count: { $sum: 1 } } },
      { $match: { count: { $gt: 1 } } }
    ]).toArray(),
    activeMissingCatalog: db.userproducts.aggregate([
      { $match: { status: "active" } },
      { $lookup: { from: "catalogproducts", localField: "catalogProductId", foreignField: "_id", as: "p" } },
      { $match: { p: { $size: 0 } } },
      { $project: { userId: 1, cardId: 1, standeeId: 1, catalogProductId: 1 } }
    ]).toArray()
  });
'
```

### 12.5 Zero-assignment Card inventory

```bash
mongosh "<PRODUCTION_READ_ONLY_URI>" "<PRODUCTION_DB>" --quiet --eval '
  printjson(db.cards.aggregate([
    { $lookup: { from: "userproducts", localField: "_id", foreignField: "cardId", as: "assignments" } },
    { $match: { assignments: { $size: 0 } } },
    { $lookup: { from: "users", localField: "userId", foreignField: "_id", as: "owner" } },
    { $project: {
        cardId: "$_id", urlAlias: 1, kind: 1, isActive: 1,
        reviewEnabled: { $eq: ["$reviewAssistant.enabled", true] },
        ownerId: "$userId",
        ownerStatus: { $arrayElemAt: ["$owner.status", 0] }
    } },
    { $group: {
        _id: { kind: "$kind", reviewEnabled: "$reviewEnabled", ownerStatus: "$ownerStatus" },
        count: { $sum: 1 }
    } },
    { $sort: { "_id.kind": 1, "_id.reviewEnabled": 1 } }
  ]).toArray());
'
```

Capability cross-reference (review-capable owners) is run separately, read-only,
and joined in the operator’s report; never infer capability from display names.

### 12.6 Backup and monitoring evidence (no DB writes)

Collect and attach: latest snapshot ID/time, retention policy, last restore
rehearsal, backup alert status, monitoring dashboard links, and the deployed
revision. These are read-only console operations.

---

## 13. Actions requiring explicit owner approval

| Action | Approval required |
|---|---|
| Connect to production with a read-only role (Gate B) | Yes — explicit, scoped |
| Run the read-only queries above | Yes — same approval |
| Create any production index | Yes — separate, after clean preflight |
| Create the optional partial unique assignment index | Yes — separate decision; not included in Review index approval |
| Remediate duplicate data | Yes — separate, non-destructive plan; never automatic |
| Change catalog identifiers or entitlements | Yes — separate |
| Revoke zero-assignment legacy access | Yes — separate; default is preservation |
| Backup/restore rehearsal in a non-production project | Yes |
| Deploy any revision | Yes — Gate C, not authorized |
| Activate any feature flag | Yes — one flag at a time |
| Run live AI or external Google tests | Yes — non-production/synthetic only |
| Send customer communication | Yes |
| Proceed to Gate B | Yes — this document does not authorize it |

---

## Gate A conclusion

Gate A preparation is complete and verified against the source. The package is
safe to hand to an authorized read-only operator. No production system was
contacted, no index was created, no data was changed, and no feature was
activated.

**READY FOR AUTHORIZED READ-ONLY PRODUCTION PREFLIGHT**

Wait for explicit owner approval before any Gate B action.
