import QRCode from 'qrcode';

export interface ServerQRGenerateOptions {
  url: string;
  foreground?: string;
  background?: string;
  width?: number;
  margin?: number;
}

/**
 * Server-side QR code generator for permanent Taprevia routes.
 *
 * Physical QR/NFC codes ALWAYS encode a permanent Taprevia route
 * (e.g. https://taprev.in/r/abc123), never an external destination. This is the
 * core of the dynamic-destination architecture: reprinting/reshipping is never
 * required when a customer changes a destination.
 *
 * Returns a PNG data URL so it can be embedded in HTML/images without a
 * browser canvas.
 */
export async function generateQRDataURL({
  url,
  foreground = '#000000',
  background = '#FFFFFF',
  width = 256,
  margin = 2,
}: ServerQRGenerateOptions): Promise<string> {
  return QRCode.toDataURL(url, {
    width,
    margin,
    color: {
      dark: foreground,
      light: background,
    },
  });
}

/**
 * Build a permanent Taprevia route URL from a route slug.
 * Uses NEXT_PUBLIC_BASE_URL if available, else falls back to a relative path.
 *
 * For multi-profile standees, pass the 1-indexed slot: /r/{slug}/{slot}.
 */
export function permanentRouteUrl(
  routeSlug: string,
  slot?: number,
  base?: string
): string {
  const baseUrl =
    base?.replace(/\/+$/, '') ??
    process.env.NEXT_PUBLIC_BASE_URL?.replace(/\/+$/, '') ??
    '';
  const path = slot ? `/r/${routeSlug}/${slot}` : `/r/${routeSlug}`;
  return `${baseUrl}${path}`;
}
