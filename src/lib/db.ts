import mongoose from 'mongoose';
import '@/models';

const LOG_PREFIX = '[db]';
const LOCAL_FALLBACK_URI = 'mongodb://localhost:27017/nfc-crm';
const BACKUP_DB_NAME = 'taprevia_backup';

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
  const uri = envValue('MONGODB_URI');
  if (uri) return uri;
  if (process.env.NODE_ENV === 'production') {
    throw new Error('MONGODB_URI is required in production');
  }
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

/**
 * Primary database name.
 *   - `MONGODB_DB` wins when explicitly set.
 *   - main/production      -> `test`
 *   - preview/development  -> `taprevia_V2`
 *
 * `VERCEL_ENV` distinguishes production from preview deployments (both run
 * with `NODE_ENV=production` on Vercel); locally we fall back to `NODE_ENV`.
 */
function resolvePrimaryDbName(): string {
  const explicit = envValue('MONGODB_DB');
  if (explicit) return explicit;

  const vercelEnv = envValue('VERCEL_ENV');
  const isPreviewOrDev = vercelEnv
    ? vercelEnv !== 'production'
    : process.env.NODE_ENV !== 'production';

  return isPreviewOrDev ? 'taprevia_V2' : 'test';
}

const MONGODB_URI = resolvePrimaryUri();
const MONGODB_BACKUP_URI = resolveBackupUri();
const PRIMARY_DB_NAME = resolvePrimaryDbName();

const BASE_OPTIONS = {
  bufferCommands: false,
  maxPoolSize: 10,
  serverSelectionTimeoutMS: 5000,
  socketTimeoutMS: 30000,
  connectTimeoutMS: 10000,
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

  if (!cached.promise) {
    // Small pools keep many serverless lambdas (each caching its own
    // connection) well under Atlas M0's connection budget.
    cached.promise = mongoose
      .connect(MONGODB_URI, { ...BASE_OPTIONS, dbName: PRIMARY_DB_NAME })
      .then((mongooseInstance) => {
        logConnection('primary', mongooseInstance.connection, PRIMARY_DB_NAME);
        return mongooseInstance;
      });
  }

  try {
    cached.conn = await cached.promise;
  } catch (e) {
    cached.promise = null;
    console.error(`${LOG_PREFIX} primary connection failed`, {
      expectedDb: PRIMARY_DB_NAME,
      error: e instanceof Error ? e.message : String(e),
    });
    throw e;
  }

  return cached.conn;
}

/**
 * Dedicated connection to the backup database (`taprevia_backup`). Uses its own
 * `mongoose.createConnection` so it never interferes with the primary/default
 * connection, and is cached across serverless invocations.
 */
export async function connectBackupDB(): Promise<mongoose.Connection> {
  if (backupCached.conn) return backupCached.conn;

  if (!backupCached.promise) {
    backupCached.promise = mongoose
      .createConnection(MONGODB_BACKUP_URI, { ...BASE_OPTIONS, dbName: BACKUP_DB_NAME })
      .asPromise()
      .then((connection) => {
        logConnection('backup', connection, BACKUP_DB_NAME);
        return connection;
      });
  }

  try {
    backupCached.conn = await backupCached.promise;
  } catch (e) {
    backupCached.promise = null;
    console.error(`${LOG_PREFIX} backup connection failed`, {
      expectedDb: BACKUP_DB_NAME,
      error: e instanceof Error ? e.message : String(e),
    });
    throw e;
  }

  return backupCached.conn;
}
