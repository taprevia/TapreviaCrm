/**
 * Environment-aware database target rules.
 *
 * Production keeps its existing backup database name (`taprevia_backup`) so
 * every deployed backup/restore workflow stays byte-compatible. Non-production
 * environments derive a namespaced backup database from the primary database
 * name (`taprevia_V2` → `taprevia_V2_backup`) so a development backup job can
 * never overwrite production backups when both share an Atlas cluster.
 *
 * Pure helpers only — no mongoose/network imports, so they are safe to unit
 * test without a database connection.
 */

export const PRODUCTION_PRIMARY_DB = 'test';
export const PRODUCTION_BACKUP_DB = 'taprevia_backup';

/** Mongo database names must not contain whitespace, slashes or backslashes. */
const INVALID_DB_NAME = /[\s\\/]/;

function assertDbName(name: string, label: string): void {
  if (!name || name.length > 63 || INVALID_DB_NAME.test(name)) {
    throw new Error(`${label} is not a valid MongoDB database name`);
  }
}

/**
 * Resolve the backup database for a primary database.
 *
 * - Production (`test`): `taprevia_backup` (unchanged).
 * - Development (`taprevia_V2`): `taprevia_V2_backup`.
 * - Explicit `MONGODB_BACKUP_DB` override wins, but is refused when it would
 *   point a non-production environment at the production backup database.
 */
export function resolveBackupDbName(
  primaryDbName: string,
  explicit?: string,
  isProduction: boolean = primaryDbName === PRODUCTION_PRIMARY_DB
): string {
  assertDbName(primaryDbName, 'primary database name');

  const trimmed = explicit?.trim();
  const name = trimmed || (isProduction ? PRODUCTION_BACKUP_DB : `${primaryDbName}_backup`);

  assertDbName(name, 'backup database name');

  if (name === primaryDbName) {
    throw new Error('Backup database must differ from the primary database');
  }

  if (!isProduction && name === PRODUCTION_BACKUP_DB) {
    throw new Error(
      'Refusing to target the production backup database from a non-production ' +
        'environment. Use the derived backup name or MONGODB_BACKUP_DB.'
    );
  }

  return name;
}
