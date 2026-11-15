'use client';

/**
 * Client-side vCard download plumbing.
 *
 * Everything platform-specific about *delivering* a .vcf lives here so the
 * templates stay declarative. Two mobile-specific problems are handled:
 *
 *  1. iOS Safari aborts a blob download when `revokeObjectURL` runs in the same
 *     tick as `click()`. The URL must outlive the click by a wide margin.
 *  2. Some Android/iOS WebViews do not expose a usable blob download. When the
 *     blob path is unavailable or throws, the same attachment endpoint is used
 *     as a direct download fallback so the platform downloader can take over.
 *
 * Downloads are routed through the API endpoint rather than built in the
 * browser, so every platform gets one identical payload from `buildVcf()` and
 * the endpoint's gate + analytics logging cannot be bypassed.
 */

import { buildVcf, vcfFilename } from './vcf';

export type VcfDownloadResult =
  | { status: 'downloaded'; filename: string }
  | { status: 'gateRequired' }
  | { status: 'error'; message: string };

export function vcfEndpoint(alias: string): string {
  return `/api/public/cards/${encodeURIComponent(alias || '')}/vcf`;
}

/**
 * Trigger a .vcf download from an in-memory payload.
 * The anchor must be in the document for iOS, and the object URL must survive
 * the click — see the module comment.
 */
export function downloadVcfBlob(body: string, filename: string): boolean {
  if (typeof document === 'undefined' || typeof URL.createObjectURL !== 'function') {
    return false;
  }

  let url: string;
  try {
    const blob = new Blob([body], { type: 'text/vcard;charset=utf-8' });
    url = URL.createObjectURL(blob);

    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename || 'contact.vcf';
    anchor.rel = 'noopener';
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
  } catch {
    return false;
  }

  // 10s is comfortably past the click handler on a slow device, and short
  // enough not to pin the blob in memory.
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return true;
}

/**
 * Direct-endpoint fallback for environments where blob downloads are not
 * supported (some Android/iOS WebViews). The endpoint still serves the
 * canonical vCard with attachment headers; callers must only use this after a
 * successful gate check, which requestVcfDownload() performs.
 */
export function downloadVcfEndpoint(
  alias: string,
  query: string,
  filename: string
): void {
  if (typeof document === 'undefined') return;
  const anchor = document.createElement('a');
  anchor.href = `${vcfEndpoint(alias)}${query}`;
  anchor.download = filename || 'contact.vcf';
  anchor.rel = 'noopener';
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
}

/** Pull the server's suggested filename out of Content-Disposition. */
function filenameFromDisposition(header: string | null, fallback: string): string {
  if (!header) return fallback;
  const star = /filename\*\s*=\s*UTF-8''([^;]+)/i.exec(header);
  if (star?.[1]) {
    try {
      return decodeURIComponent(star[1].trim());
    } catch {
      /* malformed encoding — fall through to the ASCII form */
    }
  }
  const plain = /filename\s*=\s*"?([^";]+)"?/i.exec(header);
  return plain?.[1]?.trim() || fallback;
}

export interface VcfContact {
  name: string;
  email: string;
  phone?: string;
}

/**
 * Fetch and download a card's .vcf.
 *
 * Resolves `gateRequired` when the tenant requires contact details before
 * download (the endpoint answers 428). Callers should collect a name + email
 * and call again with `contact` to satisfy the gate.
 */
export async function requestVcfDownload(
  alias: string,
  contact?: VcfContact,
): Promise<VcfDownloadResult> {
  const query = contact
    ? `?n=${encodeURIComponent(contact.name)}&e=${encodeURIComponent(contact.email)}` +
      (contact.phone ? `&p=${encodeURIComponent(contact.phone)}` : '')
    : '';

  let response: Response;
  try {
    response = await fetch(`${vcfEndpoint(alias)}${query}`, {
      headers: { Accept: 'text/vcard' },
      cache: 'no-store',
    });
  } catch {
    return { status: 'error', message: 'Network error' };
  }

  if (response.status === 428) return { status: 'gateRequired' };
  if (!response.ok) return { status: 'error', message: `HTTP ${response.status}` };

  const body = await response.text();
  const filename = filenameFromDisposition(
    response.headers.get('Content-Disposition'),
    `${alias || 'contact'}.vcf`,
  );

  if (!downloadVcfBlob(body, filename)) {
    // Blob downloads are unavailable in this browser/WebView. Fall back to the
    // attachment endpoint itself, preserving the already-satisfied gate query.
    downloadVcfEndpoint(alias, query, filename);
  }
  return { status: 'downloaded', filename };
}

/**
 * Save a card, preferring the API endpoint so the canonical payload, the
 * contact-details gate and the download analytics all apply.
 *
 * Falls back to building the same payload in the browser only when the
 * endpoint has no card to serve (404) — which is the case inside the builder
 * preview, where a draft exists solely in component state. A `gateRequired`
 * response never falls back, so the gate cannot be bypassed.
 */
export async function downloadVcfForCard(card: {
  urlAlias?: string | null;
} & Parameters<typeof buildVcf>[0]): Promise<VcfDownloadResult> {
  const result = await requestVcfDownload(card.urlAlias || '');
  if (result.status !== 'error') return result;

  if (result.message === 'HTTP 404') {
    const base =
      typeof window === 'undefined' ? '' : window.location.origin;
    const filename = vcfFilename(card);
    downloadVcfBlob(buildVcf(card, base), filename);
    return { status: 'downloaded', filename };
  }

  return result;
}
