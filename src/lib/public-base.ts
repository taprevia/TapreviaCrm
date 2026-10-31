/**
 * Canonical public origin for generated QR/NFC URLs.
 *
 * Production must never emit localhost or Vercel Preview hostnames. The
 * configured NEXT_PUBLIC_BASE_URL wins; the browser origin is only a fallback.
 * In production an unsafe value resolves to '' so callers disable QR
 * generation rather than print a broken payload.
 *
 * Preview (Gate P1.1): a Vercel Preview deployment has no custom domain and
 * runs with NODE_ENV=production. It may use exactly one explicitly approved
 * hostname, configured in both PREVIEW_APPROVED_HOST (server) and
 * NEXT_PUBLIC_PREVIEW_APPROVED_HOST (client bundle). The configured base URL
 * must be HTTPS and its hostname must match that value exactly. There is no
 * wildcard or suffix trust, and the browser fallback is never consulted in
 * Preview, so an attacker-controlled Host header cannot become a QR origin.
 */

const UNSAFE_ORIGIN = /(^|\/\/)(localhost|127\.0\.0\.1|\[::1\])(:|\/|$)|\.vercel\.app$/i;
const APPROVED_HOSTNAME =
  /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

export interface CanonicalPublicBaseInput {
  configured?: string;
  fallback?: string;
  nodeEnv?: string;
  vercelEnv?: string;
  /** Server-only exact approved Preview hostname. */
  approvedPreviewHost?: string;
  /** Public copy of the same hostname for client components. */
  publicApprovedPreviewHost?: string;
}

function trimOrigin(value: string | undefined): string {
  return (value ?? '').trim().replace(/\/+$/, '');
}

/** Exact hostname only: no scheme, path, wildcard, port or credentials. */
function normalizeApprovedHost(value: string | undefined): string | null {
  const host = (value ?? '').trim().toLowerCase();
  if (!host || host.length > 253) return null;
  if (
    host.includes('*') ||
    host.includes('://') ||
    host.includes('/') ||
    host.includes('@') ||
    host.includes(':')
  ) {
    return null;
  }
  return APPROVED_HOSTNAME.test(host) ? host : null;
}

function isPreviewMode(input: CanonicalPublicBaseInput): boolean {
  const vercelEnv = (input.vercelEnv ?? '').trim();
  if (vercelEnv === 'preview') return true;
  // Client components do not receive server-only VERCEL_ENV. The public
  // approved-host variable is configured only in Preview; presence is the
  // client-side Preview signal. Production server rendering still passes
  // vercelEnv='production' and never enters this branch.
  return (
    !vercelEnv &&
    input.nodeEnv === 'production' &&
    Boolean(normalizeApprovedHost(input.publicApprovedPreviewHost))
  );
}

export function resolveCanonicalPublicBase(
  input: CanonicalPublicBaseInput
): string {
  const configured = trimOrigin(input.configured);
  const fallback = trimOrigin(input.fallback);
  const vercelEnv = (input.vercelEnv ?? '').trim();
  const nodeEnv = (input.nodeEnv ?? '').trim();

  if (isPreviewMode(input)) {
    // Preview must use the explicitly configured origin, never window.location
    // or a request Host header, and the approved host must be exact.
    if (!configured) return '';
    const approved = normalizeApprovedHost(
      input.approvedPreviewHost || input.publicApprovedPreviewHost
    );
    if (!approved) return '';

    let url: URL;
    try {
      url = new URL(configured);
    } catch {
      return '';
    }
    if (url.protocol !== 'https:') return '';
    if (url.username || url.password) return '';
    if (url.port) return '';
    if (url.search || url.hash) return '';
    if (url.pathname !== '/' && url.pathname !== '') return '';
    if (url.hostname.toLowerCase() !== approved) return '';
    return url.origin;
  }

  // Any other deployed Vercel environment is unknown to this policy: fail safe.
  if (vercelEnv && vercelEnv !== 'production') return '';

  const candidate = configured || fallback;
  if (!candidate) return '';
  if ((nodeEnv === 'production' || vercelEnv === 'production') && UNSAFE_ORIGIN.test(candidate)) {
    return '';
  }
  return candidate;
}

export function canonicalPublicBase(): string {
  return resolveCanonicalPublicBase({
    configured: process.env.NEXT_PUBLIC_BASE_URL,
    fallback: typeof window !== 'undefined' ? window.location.origin : '',
    nodeEnv: process.env.NODE_ENV,
    vercelEnv: process.env.VERCEL_ENV,
    approvedPreviewHost: process.env.PREVIEW_APPROVED_HOST,
    publicApprovedPreviewHost: process.env.NEXT_PUBLIC_PREVIEW_APPROVED_HOST,
  });
}
