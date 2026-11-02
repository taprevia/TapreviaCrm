# TAPREVIA — PHASE 4D.10 GATE P3.7
# BACKUP, RESTORE & ROLLBACK

**Scope:** synthetic local data only. No production database, Vercel account or
customer record was accessed.

## 1. Synthetic backup / restore result

Source: `taprevia_p37_backup` (P3.5 fixture seed).
Tooling: local `mongodump` / `mongorestore` (gzip archive).

| Check | Result |
|---|---|
| Backup archive created | PASS |
| Restore into separate `taprevia_p37_restored` | PASS |
| Collections source/restored | 26 / 26 |
| Per-collection count mismatches | **0** |
| Restored documents | 58, 0 failed |
| Cards byte-identical on identifiers/destinations | **PASS** (9 cards) |
| Standees byte-identical on route/uid/publicSlug/destinations | **PASS** (2) |
| Users / assignments restored | 6 / 9 |
| Product assignment integrity | PASS |
| Legacy route compatibility after restore | PASS (P3.5 harness) |

No restore was performed into an existing live database.

## 2. Production backup strategy (documentation only)

Required owner/DevOps decisions:

- Managed MongoDB backup frequency, retention and PITR window.
- Encryption at rest/in transit and key ownership.
- Access control and audit of restore operations.
- Off-site/region copy and restore drills.
- RPO/RTO targets and incident owner.

Do not claim these are configured; they were not inspected.

## 3. Vercel rollback procedure (documentation only)

1. Identify the last healthy deployment in Vercel (owner/DevOps).
2. Confirm no destructive migration is part of the faulty release.
3. Promote/rollback to the previous deployment.
4. Verify `/api/health` returns 200 and DB is up.
5. Spot-check `/r/...`, `/review/...`, `/panel/...`, login, product save.
6. Monitor errors/logs; confirm customer destinations unchanged.

No rollback was executed.

## 4. Database migration compatibility

P3.7 introduced no migration. Any future schema change must be additive and
backward-compatible; rollback must not require restoring customer data.

## 5. Feature flags

All four review flags retain their OFF defaults. Rollback can disable copy/
rotation/central/standee review without changing customer data.

## 6. Ownership gaps

Backup frequency, retention, RPO/RTO, production restore authority, Vercel
rollback owner and monitoring escalation are **NOT VERIFIED / owner-owned**.

**P3.7 INCOMPLETE — REQUIRED VERIFICATION GAPS REMAIN**

