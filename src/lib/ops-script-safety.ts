/**
 * Safety helpers for owner-operated database scripts.
 *
 * These functions are intentionally pure (no database connection, no
 * filesystem access) so they can be unit-tested without touching a database.
 *
 * Rules enforced here:
 *  - A database name is always explicit and validated.
 *  - A URI path and MONGODB_DB may not silently disagree.
 *  - Remote/Atlas clusters are refused unless explicitly allowed AND
 *    separately confirmed.
 *  - Writes require an explicit confirmation.
 *  - Migration source/target arguments never have destructive defaults.
 */

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);
const VALID_DB_NAME = /^[A-Za-z0-9][A-Za-z0-9_-]{0,62}$/;
const RESERVED_DB_NAMES = new Set(['admin', 'local', 'config']);

export class OpsScriptSafetyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OpsScriptSafetyError';
  }
}

export interface MongoScriptTarget {
  uri: string;
  host: string;
  uriDb: string | null;
  dbName: string;
  isRemote: boolean;
}

export interface ScriptWriteGuard {
  allowRemote: boolean;
  remoteConfirmed: boolean;
  writeConfirmed: boolean;
}

export interface MigrationArgs {
  source: string;
  targets: string[];
  write: boolean;
  dryRun: boolean;
  allowRemote: boolean;
  confirmRemote: boolean;
}

export const MIGRATION_USAGE =
  'Usage: MONGODB_URI=... npx tsx scripts/migrate-db.ts ' +
  '--source-db=<name> --target-db=<name>[,<name>] [--dry-run] ' +
  '[--write --confirm-write] [--allow-remote --confirm-remote]';

export function assertValidDbName(name: string): void {
  if (!VALID_DB_NAME.test(name)) {
    throw new OpsScriptSafetyError(
      `Invalid MongoDB database name "${name}". Use 1-63 characters: letters, digits, "_" or "-".`
    );
  }
  if (RESERVED_DB_NAMES.has(name.toLowerCase())) {
    throw new OpsScriptSafetyError(`Refusing reserved MongoDB system database "${name}".`);
  }
}

/** True for the exact local hostnames used by local development. */
export function isLocalMongoHost(host: string): boolean {
  return LOCAL_HOSTS.has(host.trim().toLowerCase());
}

/**
 * Parse a MongoDB URI and resolve the effective database name.
 * Throws when the URI is malformed, has no database, or disagrees with an
 * explicit `MONGODB_DB` value.
 */
export function parseMongoTarget(uri: string, explicitDb?: string): MongoScriptTarget {
  const trimmedUri = (uri ?? '').trim();
  if (!trimmedUri) throw new OpsScriptSafetyError('MONGODB_URI is required.');

  let parsed: URL;
  try {
    parsed = new URL(trimmedUri);
  } catch {
    throw new OpsScriptSafetyError('MONGODB_URI is not a valid MongoDB URI.');
  }
  if (parsed.protocol !== 'mongodb:' && parsed.protocol !== 'mongodb+srv:') {
    throw new OpsScriptSafetyError('MONGODB_URI must use mongodb:// or mongodb+srv://.');
  }

  const host = parsed.hostname.toLowerCase();
  const uriDb = parsed.pathname.replace(/^\/+/, '').split('/')[0] || null;
  const explicit = (explicitDb ?? '').trim() || null;

  if (explicit && uriDb && explicit !== uriDb) {
    throw new OpsScriptSafetyError(
      `MONGODB_DB="${explicit}" disagrees with the URI database path "${uriDb}". ` +
        'Refusing to guess which database is intended.'
    );
  }

  const dbName = explicit ?? uriDb;
  if (!dbName) {
    throw new OpsScriptSafetyError(
      'An explicit database name is required (set MONGODB_DB or include it in the URI path).'
    );
  }
  assertValidDbName(dbName);

  return { uri: trimmedUri, host, uriDb, dbName, isRemote: !isLocalMongoHost(host) };
}

/** Sanitized summary — never includes credentials, query strings or tokens. */
export function formatTargetSummary(target: MongoScriptTarget): string {
  return `host=${target.host} db=${target.dbName} scope=${target.isRemote ? 'remote' : 'local'}`;
}

export function hasFlag(argv: readonly string[], flag: string): boolean {
  return argv.includes(flag);
}

/** Resolve an explicit `--flag=value` argument, or null when absent. */
export function readFlagValue(argv: readonly string[], flag: string): string | null {
  const prefix = `${flag}=`;
  const value = argv.find((arg) => arg.startsWith(prefix));
  return value ? value.slice(prefix.length) : null;
}

/**
 * Enforce local-by-default, confirmed-write execution.
 *
 * Remote access needs two independent signals: allowing it (`--allow-remote`
 * or ALLOW_REMOTE_DB_SCRIPT=true) and confirming the exact target database
 * (`--confirm-remote`, CONFIRM_REMOTE_DB=<db>, or a matching argv value).
 */
export function assertScriptWriteGuard(
  target: MongoScriptTarget,
  guard: ScriptWriteGuard
): void {
  if (target.isRemote && !guard.allowRemote) {
    throw new OpsScriptSafetyError(
      'Refusing a remote MongoDB target. Re-run with --allow-remote only after owner approval.'
    );
  }
  if (target.isRemote && !guard.remoteConfirmed) {
    throw new OpsScriptSafetyError(
      `Remote access to "${target.dbName}" is not confirmed. ` +
        `Set CONFIRM_REMOTE_DB=${target.dbName} or pass --confirm-remote.`
    );
  }
  if (!guard.writeConfirmed) {
    throw new OpsScriptSafetyError(
      `Write confirmation is required for "${target.dbName}". ` +
        `Pass --yes or set CONFIRM_DB_WRITE=${target.dbName}.`
    );
  }
}

/**
 * Parse migration arguments without destructive defaults.
 *
 * Unknown arguments are rejected rather than ignored. `--dry-run` is accepted
 * for clarity but is the default when `--write` is absent.
 */
export function parseMigrationArgs(argv: readonly string[]): MigrationArgs {
  const args: MigrationArgs = {
    source: '',
    targets: [],
    write: false,
    dryRun: false,
    allowRemote: false,
    confirmRemote: false,
  };

  const knownFlags = new Set([
    '--write',
    '--dry-run',
    '--allow-remote',
    '--confirm-remote',
    '--confirm-write',
  ]);

  for (const arg of argv) {
    if (knownFlags.has(arg)) {
      if (arg === '--write' || arg === '--confirm-write') args.write = true;
      if (arg === '--dry-run') args.dryRun = true;
      if (arg === '--allow-remote') args.allowRemote = true;
      if (arg === '--confirm-remote') args.confirmRemote = true;
      continue;
    }
    if (arg.startsWith('--source-db=') || arg.startsWith('--source=')) {
      if (args.source) throw new OpsScriptSafetyError('Duplicate --source-db argument.');
      args.source = arg.slice(arg.indexOf('=') + 1).trim();
      continue;
    }
    if (arg.startsWith('--target-db=') || arg.startsWith('--target=')) {
      const raw = arg.slice(arg.indexOf('=') + 1);
      const names = raw.split(',').map((value) => value.trim()).filter(Boolean);
      if (names.length === 0) throw new OpsScriptSafetyError('--target-db requires at least one name.');
      args.targets.push(...names);
      continue;
    }
    throw new OpsScriptSafetyError(`Unknown argument "${arg}". ${MIGRATION_USAGE}`);
  }

  if (!args.source) throw new OpsScriptSafetyError(`--source-db is required. ${MIGRATION_USAGE}`);
  if (args.targets.length === 0) throw new OpsScriptSafetyError(`--target-db is required. ${MIGRATION_USAGE}`);

  if (args.dryRun && args.write) {
    throw new OpsScriptSafetyError('Conflicting arguments: --dry-run cannot be combined with --write.');
  }

  assertValidDbName(args.source);
  const seen = new Set<string>();
  for (const target of args.targets) {
    assertValidDbName(target);
    if (target === args.source) {
      throw new OpsScriptSafetyError(`Source "${args.source}" cannot also be a target.`);
    }
    if (seen.has(target)) throw new OpsScriptSafetyError(`Duplicate target "${target}".`);
    seen.add(target);
  }

  return args;
}
