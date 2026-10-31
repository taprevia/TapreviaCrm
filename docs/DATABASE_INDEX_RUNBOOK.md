# Database Index Runbook — Review Management / Analytics

**Status:** documentation only. No production index was created in Phase 4D.8.
**Scope:** ReviewSettings, ReviewRotationEvent, ReviewRotationState, AnalyticsLog.
**Verified locally:** index key shapes were created with `syncIndexes()` in a
disposable local database. Production uses `autoIndex: false`; startup must not
create or alter indexes.

## 1. Verified index inventory

### reviewsettings

| Index | Keys | Options | Source | Serves |
|---|---|---|---|---|
| `businessId_1` | `{ businessId: 1 }` | unique | `src/models/ReviewSettings.ts` | One central settings document per business; settings lookup |

### reviewrotationevents

| Index | Keys | Options | Source | Serves |
|---|---|---|---|---|
| `businessId_1_categoryKey_1_templateId_1_cycle_1` | `{ businessId: 1, categoryKey: 1, templateId: 1, cycle: 1 }` | unique | `src/models/ReviewRotationEvent.ts` | Copy-event idempotency per business/category/template/cycle |
| `copyId_1` | `{ copyId: 1 }` | unique | same | Client idempotency key; duplicate copy suppression |
| `businessId_1_categoryKey_1_copiedAt_-1` | `{ businessId: 1, categoryKey: 1, copiedAt: -1 }` | non-unique | same | Category-scoped rotation activity |
| `businessId_1_copiedAt_-1` | `{ businessId: 1, copiedAt: -1 }` | non-unique | same | Business-wide unified analytics (4D.7) |

### reviewrotationstates

| Index | Keys | Options | Source | Serves |
|---|---|---|---|---|
| `businessId_1_categoryKey_1` | `{ businessId: 1, categoryKey: 1 }` | unique | `src/models/ReviewRotationState.ts` | One cycle cursor per business/category |

### analyticslogs

| Index | Keys | Options | Source | Serves |
|---|---|---|---|---|
| `cardId_1_timestamp_-1` | `{ cardId: 1, timestamp: -1 }` | non-unique | `src/models/AnalyticsLog.ts` | Existing Card analytics |
| `standeeId_1_timestamp_-1` | `{ standeeId: 1, timestamp: -1 }` | non-unique | same | Existing Standee analytics |
| `cardId_1_action_1_createdAt_-1` | `{ cardId: 1, action: 1, createdAt: -1 }` | non-unique | same | Unified review analytics (Card) |
| `standeeId_1_action_1_createdAt_-1` | `{ standeeId: 1, action: 1, createdAt: -1 }` | non-unique | same | Unified review analytics (Standee) |
| `timestamp_1` | `{ timestamp: 1 }` | TTL 180 days | same | Existing analytics retention |

`AnalyticsLog.createdAt` (Mongoose timestamps) is the field queried by the
analytics APIs; `timestamp` remains the TTL/compatibility field. Do not
substitute one for the other.

Existing Card/Standee unique public-identity indexes are not part of this
release’s new index requirements. Do not rebuild or drop them as part of this
rollout.

## 2. Read-only production inspection (authorized operator only)

```js
db.reviewsettings.getIndexes();
db.reviewrotationevents.getIndexes();
db.reviewrotationstates.getIndexes();
db.analyticslogs.getIndexes();
```

Confirm names, key order, `unique`, `sparse`, and TTL options against the
inventory above. Do not modify indexes during inspection.

## 3. Duplicate preflight for unique indexes

Run these **read-only** queries before creating any unique index. Any returned
row is a blocker requiring separate approval/remediation; never delete or merge
customer data automatically.

### ReviewSettings

```js
db.reviewsettings.aggregate([
  { $group: { _id: '$businessId', count: { $sum: 1 } } },
  { $match: { count: { $gt: 1 } } },
]);
```

### ReviewRotationState

```js
db.reviewrotationstates.aggregate([
  { $group: { _id: { businessId: '$businessId', categoryKey: '$categoryKey' }, count: { $sum: 1 } } },
  { $match: { count: { $gt: 1 } } },
]);
```

### ReviewRotationEvent — composite idempotency key

```js
db.reviewrotationevents.aggregate([
  { $group: { _id: {
      businessId: '$businessId', categoryKey: '$categoryKey',
      templateId: '$templateId', cycle: '$cycle' }, count: { $sum: 1 } } },
  { $match: { count: { $gt: 1 } } },
]);
```

### ReviewRotationEvent — copyId

```js
db.reviewrotationevents.aggregate([
  { $group: { _id: '$copyId', count: { $sum: 1 } } },
  { $match: { count: { $gt: 1 } } },
]);
```

If duplicates exist, mark index creation and feature activation **BLOCKED**
pending an approved data-remediation plan.

## 4. Creation commands (documentation only)

Run only in an approved maintenance window, with backups verified.

```js
db.reviewsettings.createIndex(
  { businessId: 1 },
  { unique: true, name: 'businessId_1' }
);

db.reviewrotationevents.createIndex(
  { businessId: 1, categoryKey: 1, templateId: 1, cycle: 1 },
  { unique: true, name: 'businessId_1_categoryKey_1_templateId_1_cycle_1' }
);
db.reviewrotationevents.createIndex(
  { copyId: 1 },
  { unique: true, name: 'copyId_1' }
);
db.reviewrotationevents.createIndex(
  { businessId: 1, categoryKey: 1, copiedAt: -1 },
  { name: 'businessId_1_categoryKey_1_copiedAt_-1' }
);
db.reviewrotationevents.createIndex(
  { businessId: 1, copiedAt: -1 },
  { name: 'businessId_1_copiedAt_-1' }
);

db.reviewrotationstates.createIndex(
  { businessId: 1, categoryKey: 1 },
  { unique: true, name: 'businessId_1_categoryKey_1' }
);

db.analyticslogs.createIndex(
  { cardId: 1, action: 1, createdAt: -1 },
  { name: 'cardId_1_action_1_createdAt_-1' }
);
db.analyticslogs.createIndex(
  { standeeId: 1, action: 1, createdAt: -1 },
  { name: 'standeeId_1_action_1_createdAt_-1' }
);
```

Do not set `background: true` blindly; follow the database provider’s current
index-build guidance and maintenance policy.

## 5. Verification

```js
db.reviewsettings.getIndexes();
db.reviewrotationevents.getIndexes();
db.reviewrotationstates.getIndexes();
db.analyticslogs.getIndexes();

// Connectivity/smoke
db.reviewsettings.countDocuments({});
db.reviewrotationevents.countDocuments({});
db.analyticslogs.countDocuments({});
```

Check application logs for index errors, duplicate-key errors, latency changes,
and analytics API errors after creation.

## 6. Operational considerations

- Unique builds fail if preflight duplicates exist; resolve only through an
  approved, non-destructive plan.
- Index creation adds write latency and I/O; schedule in a controlled window.
- `AnalyticsLog` is the fastest-growing collection; the TTL index remains.
- `ReviewRotationEvent` unique indexes enforce copy idempotency; removing them
  can permit duplicate events.
- `ReviewRotationState` unique index prevents duplicate cursors.
- `ReviewSettings` unique index is required for central settings integrity.

## 7. Rollback considerations

- Prefer feature-flag rollback over index rollback.
- Do not drop indexes automatically during an application rollback.
- New non-unique analytics indexes can generally be dropped only after
  confirming no active query depends on them and with approval.
- Do not drop unique indexes while the corresponding writes are active; assess
  data integrity and idempotency impact first.
- No customer data is changed by index creation or a feature flag rollback.

## 8. Phase 4D.9 addendum

### 8.1 Optional active-assignment uniqueness (future approval)

The Phase 4D.9 local reconciliation prevents the tested concurrent duplicate
path in the assignment service. A database-level guarantee would be a **partial
unique index** on `userproducts`:

```js
db.userproducts.createIndex(
  { userId: 1, cardId: 1 },
  { unique: true, partialFilterExpression: { status: 'active', cardId: { $type: 'objectId' } },
    name: 'userId_1_cardId_1_active_unique' }
);
```

**DOCUMENTATION ONLY — DO NOT EXECUTE.** Before any creation:

```js
// Read-only duplicate preflight; any row is a blocker.
db.userproducts.aggregate([
  { $match: { status: 'active', cardId: { $ne: null } } },
  { $group: { _id: { userId: '$userId', cardId: '$cardId' }, count: { $sum: 1 } } },
  { $match: { count: { $gt: 1 } } },
]);
```

Duplicates require a separately approved remediation plan; never delete or merge
automatically. Creating this index is **not** required for the 4D.9 code fix and
must not be bundled into the Review-index window without explicit approval.

### 8.2 Historical analytics

No index change can restore deleted-host attribution: `AnalyticsLog` has no
persisted `businessId`. Do not add/backfill ownership or infer it from route
metadata. Rotation events already persist `businessId`.

### 8.3 4D.9 verification evidence

The 4D.9 matrix and historical harnesses use disposable `taprevia_4d9_*`
databases only. No production index was inspected, created or dropped.
