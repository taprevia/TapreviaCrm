/**
 * Phase 4D.10 Gate P1.1 — Preview configuration remediation tests.
 *
 * Pure tests only: no database connection, no remote access, no env mutation.
 * Covers fail-closed Preview DB selection, deployed auto-index policy, backup
 * naming, and exact-host Preview QR support.
 */

import assert from 'node:assert/strict';
import {
  resolvePrimaryDatabaseName,
  requireMongoUriValue,
  isDeployedRuntime,
  indexCreationOptions,
  resolveBackupDbName,
} from '../src/lib/db-target';
import { resolveCanonicalPublicBase } from '../src/lib/public-base';

let passed = 0;
const failures: string[] = [];
function check(name: string, fn: () => void) {
  try {
    fn();
    passed += 1;
    console.log(`PASS ${name}`);
  } catch (error) {
    failures.push(`${name}: ${error instanceof Error ? error.message : String(error)}`);
    console.log(`FAIL ${name}: ${error instanceof Error ? error.message : String(error)}`);
  }
}
function throws(fn: () => unknown, pattern?: RegExp) {
  assert.throws(fn, (error: unknown) => {
    if (!(error instanceof Error)) return false;
    return pattern ? pattern.test(error.message) : true;
  });
}

const PREVIEW_DB = 'taprevia-preview';
const PREVIEW_HOST = 'taprevia-crm-git-devlopment-team.vercel.app';
const PROD_ORIGIN = 'https://taprevia.com';

// ── Database selection ──────────────────────────────────────────────────────
check('preview with explicit valid database name selects it', () => {
  assert.equal(
    resolvePrimaryDatabaseName({ explicit: PREVIEW_DB, vercelEnv: 'preview', nodeEnv: 'production' }),
    PREVIEW_DB
  );
});
check('preview missing MONGODB_DB fails closed', () => {
  throws(() => resolvePrimaryDatabaseName({ vercelEnv: 'preview', nodeEnv: 'production' }), /MONGODB_DB is required/);
});
check('preview empty MONGODB_DB fails closed', () => {
  throws(() => resolvePrimaryDatabaseName({ explicit: '   ', vercelEnv: 'preview', nodeEnv: 'production' }), /MONGODB_DB is required/);
});
check('preview cannot select the Production primary database', () => {
  throws(
    () => resolvePrimaryDatabaseName({ explicit: 'test', vercelEnv: 'preview', nodeEnv: 'production' }),
    /Production database name/
  );
});
check('preview cannot select the Production backup database', () => {
  throws(
    () => resolvePrimaryDatabaseName({ explicit: 'taprevia_backup', vercelEnv: 'preview', nodeEnv: 'production' }),
    /Production database name/
  );
});
check('preview invalid database names are rejected', () => {
  throws(() => resolvePrimaryDatabaseName({ explicit: 'bad name', vercelEnv: 'preview', nodeEnv: 'production' }), /not a valid MongoDB database name/);
  throws(() => resolvePrimaryDatabaseName({ explicit: 'a/b', vercelEnv: 'preview', nodeEnv: 'production' }), /not a valid MongoDB database name/);
  throws(() => resolvePrimaryDatabaseName({ explicit: 'x'.repeat(64), vercelEnv: 'preview', nodeEnv: 'production' }), /not a valid MongoDB database name/);
});
check('preview explicit name differs from URI path: explicit wins', () => {
  // The URI path is not an input to name resolution; Mongoose receives dbName.
  assert.equal(
    resolvePrimaryDatabaseName({ explicit: PREVIEW_DB, vercelEnv: 'preview', nodeEnv: 'production' }),
    PREVIEW_DB
  );
});
check('other deployed non-production Vercel env requires explicit DB', () => {
  throws(() => resolvePrimaryDatabaseName({ vercelEnv: 'development', nodeEnv: 'production' }), /MONGODB_DB is required/);
  assert.equal(
    resolvePrimaryDatabaseName({ explicit: PREVIEW_DB, vercelEnv: 'development', nodeEnv: 'production' }),
    PREVIEW_DB
  );
});
check('production selection behavior is unchanged', () => {
  assert.equal(resolvePrimaryDatabaseName({ vercelEnv: 'production', nodeEnv: 'production' }), 'test');
  assert.equal(resolvePrimaryDatabaseName({ nodeEnv: 'production' }), 'test');
  assert.equal(
    resolvePrimaryDatabaseName({ explicit: 'test', vercelEnv: 'production', nodeEnv: 'production' }),
    'test'
  );
  assert.equal(
    resolvePrimaryDatabaseName({ explicit: 'custom-prod', vercelEnv: 'production', nodeEnv: 'production' }),
    'custom-prod'
  );
});
check('local development selection behavior is unchanged', () => {
  assert.equal(resolvePrimaryDatabaseName({ nodeEnv: 'development' }), 'taprevia_V2');
  assert.equal(resolvePrimaryDatabaseName({ explicit: 'nfc-crm', nodeEnv: 'development' }), 'nfc-crm');
});

// ── Connection URI fail-closed behavior ─────────────────────────────────────
check('production missing MONGODB_URI throws', () => {
  throws(() => requireMongoUriValue(undefined, 'production'), /MONGODB_URI is required in production/);
  throws(() => requireMongoUriValue('   ', 'production'), /MONGODB_URI is required in production/);
});
check('production URI is returned trimmed', () => {
  assert.equal(requireMongoUriValue(' mongodb://example/test ', 'production'), 'mongodb://example/test');
});
check('local development missing URI returns null (dev fallback preserved)', () => {
  assert.equal(requireMongoUriValue(undefined, 'development'), null);
  assert.equal(requireMongoUriValue('', 'test'), null);
});
check('database-selection errors contain no connection string or credentials', () => {
  for (const fn of [
    () => resolvePrimaryDatabaseName({ vercelEnv: 'preview', nodeEnv: 'production' }),
    () => resolvePrimaryDatabaseName({ explicit: 'test', vercelEnv: 'preview', nodeEnv: 'production' }),
    () => requireMongoUriValue(undefined, 'production'),
  ]) {
    try {
      fn();
      assert.fail('expected throw');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      assert.ok(!message.includes('mongodb://'), 'error leaked a URI');
      assert.ok(!message.includes('mongodb+srv://'), 'error leaked a URI');
      assert.ok(!message.includes('@'), 'error leaked credentials');
    }
  }
});

// ── Auto-index policy ───────────────────────────────────────────────────────
check('production disables autoIndex/autoCreate', () => {
  const policy = indexCreationOptions(isDeployedRuntime({ vercelEnv: 'production', nodeEnv: 'production' }));
  assert.equal(policy.autoIndex, false);
  assert.equal(policy.autoCreate, false);
});
check('preview disables autoIndex/autoCreate', () => {
  assert.equal(isDeployedRuntime({ vercelEnv: 'preview', nodeEnv: 'production' }), true);
  const policy = indexCreationOptions(true);
  assert.equal(policy.autoIndex, false);
  assert.equal(policy.autoCreate, false);
});
check('isolated local development keeps intentional auto-indexing', () => {
  assert.equal(isDeployedRuntime({ nodeEnv: 'development' }), false);
  const policy = indexCreationOptions(false);
  assert.equal(policy.autoIndex, true);
  assert.equal(policy.autoCreate, true);
});
check('local production start remains non-index-creating', () => {
  assert.equal(isDeployedRuntime({ nodeEnv: 'production' }), true);
});

// ── Backup naming ───────────────────────────────────────────────────────────
check('preview backup name is derived from the preview database', () => {
  assert.equal(resolveBackupDbName(PREVIEW_DB, undefined, false), `${PREVIEW_DB}_backup`);
});
check('preview cannot target the Production backup database', () => {
  throws(() => resolveBackupDbName(PREVIEW_DB, 'taprevia_backup', false), /Refusing to target the production backup/);
});
check('production backup naming is unchanged', () => {
  assert.equal(resolveBackupDbName('test', undefined, true), 'taprevia_backup');
  assert.equal(resolveBackupDbName('test', 'taprevia_backup', true), 'taprevia_backup');
});

// ── Preview QR hostname policy ──────────────────────────────────────────────
const preview = (over: Partial<Parameters<typeof resolveCanonicalPublicBase>[0]> = {}) =>
  resolveCanonicalPublicBase({
    configured: `https://${PREVIEW_HOST}`,
    nodeEnv: 'production',
    vercelEnv: 'preview',
    approvedPreviewHost: PREVIEW_HOST,
    publicApprovedPreviewHost: PREVIEW_HOST,
    ...over,
  });

check('exact approved Preview hostname is accepted', () => {
  assert.equal(preview(), `https://${PREVIEW_HOST}`);
});
check('trailing slash is normalized', () => {
  assert.equal(preview({ configured: `https://${PREVIEW_HOST}/` }), `https://${PREVIEW_HOST}`);
});
check('uppercase approved hostname is normalized', () => {
  assert.equal(
    resolveCanonicalPublicBase({
      configured: `https://${PREVIEW_HOST}`,
      nodeEnv: 'production',
      vercelEnv: 'preview',
      approvedPreviewHost: PREVIEW_HOST.toUpperCase(),
    }),
    `https://${PREVIEW_HOST}`
  );
});
check('another vercel.app hostname is rejected', () => {
  assert.equal(preview({ configured: 'https://taprevia-evil.vercel.app' }), '');
});
check('production rejects a Preview-only vercel.app hostname', () => {
  assert.equal(
    resolveCanonicalPublicBase({
      configured: `https://${PREVIEW_HOST}`,
      nodeEnv: 'production',
      vercelEnv: 'production',
      publicApprovedPreviewHost: PREVIEW_HOST,
    }),
    ''
  );
});
check('production rejects localhost', () => {
  assert.equal(
    resolveCanonicalPublicBase({ configured: 'http://localhost:3000', nodeEnv: 'production', vercelEnv: 'production' }),
    ''
  );
});
check('production still accepts an existing custom domain', () => {
  assert.equal(
    resolveCanonicalPublicBase({ configured: PROD_ORIGIN, nodeEnv: 'production', vercelEnv: 'production' }),
    PROD_ORIGIN
  );
});
check('local development behavior is preserved', () => {
  assert.equal(
    resolveCanonicalPublicBase({ configured: 'http://localhost:3000', nodeEnv: 'development' }),
    'http://localhost:3000'
  );
});
check('Preview missing configured base URL fails safe', () => {
  assert.equal(preview({ configured: '' }), '');
});
check('Preview ignores a spoofed browser fallback', () => {
  assert.equal(preview({ configured: '', fallback: 'https://attacker.example' }), '');
});
check('Preview HTTP is rejected', () => {
  assert.equal(preview({ configured: `http://${PREVIEW_HOST}` }), '');
});
check('Preview malformed URL is rejected', () => {
  assert.equal(preview({ configured: 'not a url' }), '');
});
check('Preview wildcard approval is rejected', () => {
  assert.equal(preview({ approvedPreviewHost: '*.vercel.app' }), '');
  assert.equal(preview({ approvedPreviewHost: 'vercel.app' }), '');
});
check('Preview approval with scheme, path, port or credentials is rejected', () => {
  assert.equal(preview({ approvedPreviewHost: `https://${PREVIEW_HOST}` }), '');
  assert.equal(preview({ approvedPreviewHost: `${PREVIEW_HOST}/path` }), '');
  assert.equal(preview({ approvedPreviewHost: `${PREVIEW_HOST}:443` }), '');
  assert.equal(preview({ approvedPreviewHost: `user@${PREVIEW_HOST}` }), '');
});
check('Preview credential-bearing base URL is rejected', () => {
  assert.equal(preview({ configured: `https://user:pass@${PREVIEW_HOST}` }), '');
});
check('Preview base URL with path or query is rejected', () => {
  assert.equal(preview({ configured: `https://${PREVIEW_HOST}/qr` }), '');
  assert.equal(preview({ configured: `https://${PREVIEW_HOST}?x=1` }), '');
});
check('Preview missing approved hostname fails safe', () => {
  assert.equal(preview({ approvedPreviewHost: '', publicApprovedPreviewHost: '' }), '');
});
check('client-side Preview (public host, no VERCEL_ENV) is consistent', () => {
  assert.equal(
    resolveCanonicalPublicBase({
      configured: `https://${PREVIEW_HOST}`,
      nodeEnv: 'production',
      publicApprovedPreviewHost: PREVIEW_HOST,
    }),
    `https://${PREVIEW_HOST}`
  );
});
check('unknown deployed Vercel environment fails safe', () => {
  assert.equal(
    resolveCanonicalPublicBase({
      configured: PROD_ORIGIN,
      nodeEnv: 'production',
      vercelEnv: 'staging',
    }),
    ''
  );
});
check('Preview exact-host policy does not accept a suffix match', () => {
  assert.equal(preview({ configured: `https://evil-${PREVIEW_HOST}` }), '');
});

console.log(`\n${passed}/${passed + failures.length} checks passed`);
if (failures.length) {
  for (const failure of failures) console.log(`- ${failure}`);
  process.exit(1);
}
