import mongoose from 'mongoose';
import '@/models';
import {
  resolveBackupDbName,
  resolvePrimaryDatabaseName,
  indexCreationOptions,
  isDeployedRuntime,
  requireMongoUriValue,
} from '@/lib/db-target';

const LOG_PREFIX = '[db]';
const LOCAL_FALLBACK_URI = 'mongodb://localhost:27017/nfc-crm';

interface MongooseCache {
  conn: typeof mongoose | null;
  promise: Promise<typeof mongoose> | null;
}

interface BackupCache {
  conn: mongoose.Connection | null;
  promise: Promise<mongoose.Connection> | null;
}

declare global {
  // eslint-disable-next-line no-var
  var mongoose: MongooseCache | undefined;
  // eslint-disable-next-line no-var
  var mongooseBackup: BackupCache | undefined;
}

/** Read an env var as a trimmed, non-empty string. */
function envValue(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

/**
 * Primary connection string. `MONGODB_URI` is authoritative; a localhost
 * fallback is only allowed outside production.
 */
function resolvePrimaryUri(): string {
  const resolved = requireMongoUriValue(envValue('MONGODB_URI'), process.env.NODE_ENV);
  if (resolved) return resolved;
  console.warn(`${LOG_PREFIX} MONGODB_URI not set — using local dev URI`);
  return LOCAL_FALLBACK_URI;
}

/**
 * Backup connection string. Falls back to the primary URI when the dedicated
 * override is unset, so a backup DB on the same cluster still works.
 */
function resolveBackupUri(): string {
  const uri = envValue('MONGODB_BACKUP_URI') ?? envValue('MONGODB_URI');
  if (uri) return uri;
  if (process.env.NODE_ENV === 'production') {
    throw new Error('MONGODB_BACKUP_URI/MONGODB_URI is required in production');
  }
  console.warn(`${LOG_PREFIX} MONGODB_BACKUP_URI not set — using local dev URI`);
  return LOCAL_FALLBACK_URI;
}

// `VERCEL_ENV` distinguishes production from preview deployments (both run
// with `NODE_ENV=production` on Vercel); locally we fall back to NODE_ENV.
const VERCEL_ENV = envValue('VERCEL_ENV');

// Preview/other deployed non-production environments require an explicit
// MONGODB_DB; see resolvePrimaryDatabaseName(). Production behavior is unchanged.
function resolvePrimaryDbName(): string {
  return resolvePrimaryDatabaseName({
    explicit: envValue('MONGODB_DB'),
    vercelEnv: VERCEL_ENV,
    nodeEnv: process.env.NODE_ENV,
  });
}
const IS_PRODUCTION_TARGET =
  VERCEL_ENV === 'production' ||
  (!VERCEL_ENV && process.env.NODE_ENV === 'production');
const DEPLOYED_RUNTIME = isDeployedRuntime({
  vercelEnv: VERCEL_ENV,
  nodeEnv: process.env.NODE_ENV,
});
function resolveBackupDbNameValue(primaryDbName: string): string {
  return resolveBackupDbName(primaryDbName, envValue('MONGODB_BACKUP_DB'), IS_PRODUCTION_TARGET);
}

const BASE_OPTIONS = {
  bufferCommands: false,
  maxPoolSize: 10,
  serverSelectionTimeoutMS: 5000,
  socketTimeoutMS: 30000,
  connectTimeoutMS: 10000,
  // Any deployed runtime (Production or Preview) must never create/alter
  // indexes or collections at startup. Apply index changes only through the
  // approved maintenance procedure. Local development/tests keep autoIndex.
  ...indexCreationOptions(DEPLOYED_RUNTIME),
} as const;

const cached: MongooseCache = global.mongoose || { conn: null, promise: null };
if (!global.mongoose) {
  global.mongoose = cached;
}

const backupCached: BackupCache = global.mongooseBackup || { conn: null, promise: null };
if (!global.mongooseBackup) {
  global.mongooseBackup = backupCached;
}

/** Log expected vs actual database name for a freshly established connection. */
function logConnection(label: string, connection: mongoose.Connection, expectedDb: string): void {
  const actualDb = connection?.name || '(unknown)';
  const host = connection?.host || '(unknown)';
  const detail = `${LOG_PREFIX} ${label} connected — host=${host} expectedDb=${expectedDb} actualDb=${actualDb}`;
  if (actualDb !== expectedDb) {
    console.error(`${detail} (MISMATCH)`);
  } else {
    console.info(`${detail} ✓`);
  }
}

export async function connectDB() {
  if (cached.conn) return cached.conn;

  const primaryDbName = resolvePrimaryDbName();
  const mongoUri = resolvePrimaryUri();

  if (!cached.promise) {
    // Small pools keep many serverless lambdas (each caching its own
    // connection) well under Atlas M0's connection budget.
    cached.promise = mongoose
      .connect(mongoUri, { ...BASE_OPTIONS, dbName: primaryDbName })
      .then((mongooseInstance) => {
        logConnection('primary', mongooseInstance.connection, primaryDbName);
        return mongooseInstance;
      });
  }

  try {
    cached.conn = await cached.promise;
  } catch (e) {
    cached.promise = null;
    console.error(`${LOG_PREFIX} primary connection failed`, {
      expectedDb: primaryDbName,
      error: e instanceof Error ? e.message : String(e),
    });
    throw e;
  }

  return cached.conn;
}

/**
 * Dedicated connection to the environment's backup database (production:
 * `taprevia_backup`; development: `<primary>_backup`). Uses its own
 * `mongoose.createConnection` so it never interferes with the primary/default
 * connection, and is cached across serverless invocations.
 */
export async function connectBackupDB(): Promise<mongoose.Connection> {
  if (backupCached.conn) return backupCached.conn;

  const backupDbName = resolveBackupDbNameValue(resolvePrimaryDbName());
  const backupUri = resolveBackupUri();

  if (!backupCached.promise) {
    backupCached.promise = mongoose
      .createConnection(backupUri, { ...BASE_OPTIONS, dbName: backupDbName })
      .asPromise()
      .then((connection) => {
        logConnection('backup', connection, backupDbName);
        return connection;
      });
  }

  try {
    backupCached.conn = await backupCached.promise;
  } catch (e) {
    backupCached.promise = null;
    console.error(`${LOG_PREFIX} backup connection failed`, {
      expectedDb: backupDbName,
      error: e instanceof Error ? e.message : String(e),
    });
    throw e;
  }

  return backupCached.conn;
}
