/**
 * Runtime configuration readiness — Node and Edge safe.
 *
 * Only checks the variables that are genuinely required for the application
 * to serve authenticated, database-backed traffic. It never returns values.
 *
 * APP_KEY is intentionally not treated as a startup-critical variable: the app
 * can serve public/customer traffic without it, but AI-secret writes require
 * it. That path returns a controlled 503 instead of a generic 500.
 */

export type RuntimeConfigIssue = {
  name: 'MONGODB_URI' | 'JWT_SECRET' | 'MONGODB_DB';
  reason: 'missing' | 'invalid';
};

export type RuntimeConfigResult = {
  ok: boolean;
  issues: RuntimeConfigIssue[];
  /** Non-fatal operator guidance; never contains secret values. */
  warnings: string[];
};

const MIN_JWT_SECRET = 24;
const MAX_JWT_SECRET = 512;
const MONGO_SCHEMES = ['mongodb://', 'mongodb+srv://'];

function isMongoUri(value: string): boolean {
  return MONGO_SCHEMES.some((scheme) => value.startsWith(scheme));
}

export function checkRuntimeConfig(
  env: Record<string, string | undefined> = process.env
): RuntimeConfigResult {
  const issues: RuntimeConfigIssue[] = [];
  const warnings: string[] = [];
  const mongo = env.MONGODB_URI?.trim();
  const jwt = env.JWT_SECRET?.trim();
  const explicitDb = env.MONGODB_DB?.trim();
  const vercelEnv = env.VERCEL_ENV?.trim();
  const preview = vercelEnv === 'preview';
  const production =
    vercelEnv === 'production' || (!vercelEnv && env.NODE_ENV === 'production');

  if (!mongo) issues.push({ name: 'MONGODB_URI', reason: 'missing' });
  else if (!isMongoUri(mongo)) issues.push({ name: 'MONGODB_URI', reason: 'invalid' });

  if (!jwt) issues.push({ name: 'JWT_SECRET', reason: 'missing' });
  else if (jwt.length < MIN_JWT_SECRET || jwt.length > MAX_JWT_SECRET) {
    issues.push({ name: 'JWT_SECRET', reason: 'invalid' });
  }

  // Deployed Preview must name its database explicitly; there is no safe
  // default that can distinguish Preview from another environment.
  if (preview && !explicitDb) {
    issues.push({ name: 'MONGODB_DB', reason: 'missing' });
  }

  // Production keeps its existing default for compatibility, but the operator
  // should be told that the database name is implicit.
  if (production && !explicitDb) {
    warnings.push(
      'MONGODB_DB is not explicitly set; the deployed production default database name will be used.'
    );
  }
  if (production && !env.APP_KEY?.trim()) {
    warnings.push(
      'APP_KEY is not set; AI provider-key writes will be unavailable until it is configured.'
    );
  }

  // Preview QR/NFC generation needs an explicitly approved host. Missing it
  // disables generation safely rather than emitting an untrusted origin.
  if (preview) {
    const approvedHost =
      env.PREVIEW_APPROVED_HOST?.trim() || env.NEXT_PUBLIC_PREVIEW_APPROVED_HOST?.trim();
    if (!approvedHost) {
      warnings.push(
        'PREVIEW_APPROVED_HOST / NEXT_PUBLIC_PREVIEW_APPROVED_HOST is not set; QR/NFC generation is disabled in Preview.'
      );
    }
  }

  return { ok: issues.length === 0, issues, warnings };
}

/** Developer-facing summary — names/reasons only, never values. */
export function describeRuntimeConfigIssues(result: RuntimeConfigResult): string {
  if (result.ok) return 'Runtime configuration is complete';
  return result.issues.map((issue) => `${issue.name} (${issue.reason})`).join(', ');
}

/** Names-only warning summary for logs/health; never includes values. */
export function describeRuntimeConfigWarnings(result: RuntimeConfigResult): string {
  return result.warnings.join(' ');
}

/**
 * Fail fast at the Node server-start boundary. Callers must guard against
 * `NEXT_PHASE=phase-production-build` so a Vercel build without runtime-only
 * variables is never broken.
 */
export function assertRuntimeConfig(env: Record<string, string | undefined> = process.env): void {
  const result = checkRuntimeConfig(env);
  if (!result.ok) {
    throw new Error(
      `Missing or invalid required configuration: ${describeRuntimeConfigIssues(result)}. ` +
        'Set the variable in the deployment environment; values are never logged.'
    );
  }
}
