/**
 * Node server-start configuration gate.
 *
 * Skipped during `next build` so Vercel can compile without runtime-only
 * variables (which are injected into the runtime environment by Vercel).
 * When the Node server actually starts, missing MONGODB_URI/JWT_SECRET fails
 * fast with a clear developer-facing message — never a secret value.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  if (process.env.NEXT_PHASE === 'phase-production-build') return;

  const { assertRuntimeConfig } = await import('./lib/runtime-config');
  try {
    assertRuntimeConfig();
  } catch (error) {
    console.error(
      `[startup-config] ${error instanceof Error ? error.message : String(error)}`
    );
    // In a deployed production runtime a half-started server must not serve
    // traffic. Exit so the platform marks the deployment unhealthy and keeps
    // the previous healthy revision. Local development keeps the thrown error
    // for a readable stack.
    if (process.env.NODE_ENV === 'production') {
      process.exit(1);
    }
    throw error;
  }

  // Safe boolean rollout visibility only; never logs allowlist IDs or secrets.
  const { logReviewRolloutStartup } = await import('./lib/services/review-rollout');
  logReviewRolloutStartup();
}
