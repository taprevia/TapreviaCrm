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

/** Production database names a Vercel Preview deployment must never select. */
const PRODUCTION_DB_NAMES: readonly string[] = [
  PRODUCTION_PRIMARY_DB,
  PRODUCTION_BACKUP_DB,
];

/**
 * Resolve the primary database name.
 *
 * - Explicit `MONGODB_DB` always wins (and overrides the URI path).
 * - Vercel Preview (and any other deployed non-production Vercel environment)
 *   MUST provide an explicit name. Missing/blank configuration fails closed so a
 *   Preview deployment can never silently inherit a default database.
 * - A deployed non-production environment may not select a known Production
 *   database name.
 * - Production behavior is unchanged: explicit name wins, otherwise `test`.
 * - Local development behavior is unchanged: otherwise `taprevia_V2`.
 */
export function resolvePrimaryDatabaseName(input: {
  explicit?: string;
  vercelEnv?: string;
  nodeEnv?: string;
}): string {
  const explicit = input.explicit?.trim();
  const vercelEnv = input.vercelEnv?.trim();
  const deployedNonProduction = Boolean(vercelEnv) && vercelEnv !== 'production';

  if (explicit) {
    assertDbName(explicit, 'MONGODB_DB');
    if (deployedNonProduction && PRODUCTION_DB_NAMES.includes(explicit)) {
      throw new Error(
        `Refusing MONGODB_DB="${explicit}" for a Vercel ${vercelEnv} deployment: ` +
          'this is a Production database name. Set MONGODB_DB to the Preview database.'
      );
    }
    return explicit;
  }

  if (deployedNonProduction) {
    throw new Error(
      `MONGODB_DB is required for Vercel ${vercelEnv} deployments. ` +
        'Set it explicitly to the intended Preview database name.'
    );
  }

  if (vercelEnv === 'production' || input.nodeEnv === 'production') {
    return PRODUCTION_PRIMARY_DB;
  }
  return 'taprevia_V2';
}

/**
 * True for any deployed runtime where schema auto-indexing must stay off.
 * Vercel sets `VERCEL_ENV` in every deployment (production/preview/development);
 * local `npm start` also runs with NODE_ENV=production.
 */
export function isDeployedRuntime(input: {
  vercelEnv?: string;
  nodeEnv?: string;
}): boolean {
  return Boolean(input.vercelEnv?.trim()) || input.nodeEnv === 'production';
}

/**
 * Trimmed connection URI, or null when absent outside production.
 * Production never falls back to a local database.
 */
export function requireMongoUriValue(
  uri: string | undefined,
  nodeEnv: string | undefined
): string | null {
  const value = uri?.trim();
  if (value) return value;
  if (nodeEnv === 'production') {
    throw new Error('MONGODB_URI is required in production');
  }
  return null;
}

/**
 * Index lifecycle policy. Production must never create/alter indexes during
 * process startup; index changes are applied only by an approved maintenance
 * procedure (see docs/DEPLOYMENT.md). Development keeps automatic index
 * creation so local schemas stay usable.
 */
export function indexCreationOptions(isProduction: boolean): {
  autoIndex: boolean;
  autoCreate: boolean;
} {
  return { autoIndex: !isProduction, autoCreate: !isProduction };
}

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
