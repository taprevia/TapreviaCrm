import type { FC, ReactNode, SVGProps } from 'react';

/* ─────────────────────────────────────────────────────────────────────
 * URL → brand-icon mapper for profile links.
 *
 * Derives a brand glyph from the link's hostname (`new URL(url).hostname`)
 * so the rendered icon is ALWAYS in sync with where the link actually
 * points — a custom "website" entry pointing at instagram.com correctly
 * shows the Instagram glyph, and unknown hosts fall back to a Globe.
 *
 * Brand glyphs are inline SVGs (currentColor) matching the smart-card
 * templates' existing glyph set; lucide-react 1.x no longer ships brand
 * icons and react-icons is not a dependency.
 * ───────────────────────────────────────────────────────────────────── */

export type LinkBrandKey =
  | 'instagram'
  | 'linkedin'
  | 'twitter'
  | 'facebook'
  | 'youtube'
  | 'github'
  | 'whatsapp'
  | 'pinterest'
  | 'website';

interface HostRule {
  hosts: string[];
  brand: LinkBrandKey;
  label: string;
}

const HOST_RULES: HostRule[] = [
  { hosts: ['instagram.com', 'instagr.am'], brand: 'instagram', label: 'Instagram' },
  { hosts: ['linkedin.com', 'lnkd.in'], brand: 'linkedin', label: 'LinkedIn' },
  { hosts: ['twitter.com', 'x.com'], brand: 'twitter', label: 'Twitter' },
  { hosts: ['facebook.com', 'fb.com', 'fb.me'], brand: 'facebook', label: 'Facebook' },
  { hosts: ['youtube.com', 'youtu.be', 'youtube-nocookie.com'], brand: 'youtube', label: 'YouTube' },
  { hosts: ['github.com', 'github.io'], brand: 'github', label: 'GitHub' },
  { hosts: ['whatsapp.com', 'wa.me'], brand: 'whatsapp', label: 'WhatsApp' },
  { hosts: ['pinterest.com'], brand: 'pinterest', label: 'Pinterest' },
];

/** Full hostname or a subdomain of it (e.g. `www.` / `m.`) matches the rule. */
function hostMatches(host: string, ruleHost: string): boolean {
  return host === ruleHost || host.endsWith(`.${ruleHost}`);
}

/**
 * Parse any URL-ish string and return the canonical brand key.
 * Never throws — malformed/unknown input resolves to `website` (Globe).
 */
export function brandKeyFromUrl(url: string | null | undefined): LinkBrandKey {
  const raw = (url ?? '').trim();
  if (!raw) return 'website';

  let host = '';
  try {
    host = new URL(raw).hostname.toLowerCase();
  } catch {
    // No scheme (e.g. "instagram.com/p/xyz") → assume https.
    const bare = raw.split(/[/?#]/)[0].toLowerCase();
    try {
      host = new URL(`https://${bare}`).hostname;
    } catch {
      return 'website';
    }
  }

  const hit = HOST_RULES.find((rule) => rule.hosts.some((h) => hostMatches(host, h)));
  return hit?.brand ?? 'website';
}

/** Human-readable label for the brand inferred from a URL (for aria-labels). */
export function brandLabelFromUrl(url: string | null | undefined): string {
  const key = brandKeyFromUrl(url);
  const rule = HOST_RULES.find((r) => r.brand === key);
  return rule?.label ?? 'Website';
}

/* ─────────────────────────────────────────────────────────────────────
 * Glyph definitions (verbatim path data from the template/reference icons)
 * ───────────────────────────────────────────────────────────────────── */

type GlyphProps = { size?: number } & Pick<SVGProps<SVGSVGElement>, 'className'>;

function StrokeGlyph({ size = 18, className, children }: GlyphProps & { children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={className}
    >
      {children}
    </svg>
  );
}

function FillGlyph({ size = 18, className, children }: GlyphProps & { children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="currentColor"
      aria-hidden="true"
      focusable="false"
      className={className}
    >
      {children}
    </svg>
  );
}

/** Render a brand glyph from a resolved brand key. */
function Glyph({ brand, size, className }: GlyphProps & { brand: LinkBrandKey }) {
  switch (brand) {
    case 'instagram':
      return (
        <StrokeGlyph size={size} className={className}>
          <rect x="2" y="2" width="20" height="20" rx="5" ry="5" />
          <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z" />
          <line x1="17.5" y1="6.5" x2="17.51" y2="6.5" />
        </StrokeGlyph>
      );
    case 'facebook':
      return (
        <FillGlyph size={size} className={className}>
          <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />
        </FillGlyph>
      );
    case 'linkedin':
      return (
        <FillGlyph size={size} className={className}>
          <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" />
        </FillGlyph>
      );
    case 'twitter':
      return (
        <FillGlyph size={size} className={className}>
          <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
        </FillGlyph>
      );
    case 'youtube':
      return (
        <FillGlyph size={size} className={className}>
          <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z" />
        </FillGlyph>
      );
    case 'github':
      return (
        <FillGlyph size={size} className={className}>
          <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" />
        </FillGlyph>
      );
    case 'whatsapp':
      return (
        <FillGlyph size={size} className={className}>
          <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.263.489 1.694.625.712.227 1.36.195 1.872.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413Z" />
        </FillGlyph>
      );
    case 'pinterest':
      return (
        <FillGlyph size={size} className={className}>
          <path d="M12.017 0C5.396 0 .029 5.367.029 11.987c0 5.079 3.158 9.417 7.618 11.162-.105-.949-.199-2.403.041-3.439.219-.937 1.406-5.957 1.406-5.957s-.359-.72-.359-1.781c0-1.663.967-2.911 2.168-2.911 1.024 0 1.518.769 1.518 1.688 0 1.029-.653 2.567-.992 3.992-.285 1.193.6 2.165 1.775 2.165 2.128 0 3.768-2.245 3.768-5.487 0-2.861-2.063-4.869-5.008-4.869-3.41 0-5.409 2.562-5.409 5.199 0 1.033.394 2.143.889 2.741.099.12.112.225.085.345-.09.375-.293 1.199-.334 1.363-.053.225-.172.271-.401.165-1.495-.69-2.433-2.878-2.433-4.646 0-3.776 2.748-7.252 7.92-7.252 4.158 0 7.392 2.967 7.392 6.923 0 4.135-2.607 7.462-6.233 7.462-1.214 0-2.354-.629-2.758-1.379l-.749 2.848c-.269 1.045-1.004 2.352-1.498 3.146 1.123.345 2.306.535 3.55.535 6.607 0 11.985-5.365 11.985-11.987C23.97 5.39 18.592.026 11.985.026L12.017 0z" />
        </FillGlyph>
      );
    case 'website':
    default:
      return (
        <StrokeGlyph size={size} className={className}>
          <circle cx="12" cy="12" r="10" />
          <path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20" />
          <path d="M2 12h20" />
        </StrokeGlyph>
      );
  }
}

/** Render the brand icon inferred from a link URL (Globe fallback). */
export function DynamicIcon({
  url,
  size,
  className,
}: {
  url?: string | null;
} & GlyphProps): ReactNode {
  return <Glyph brand={brandKeyFromUrl(url)} size={size} className={className} />;
}

/**
 * Resolve a URL to its brand icon component. Use directly when you need the
 * component (e.g. inside a map) rather than the render shortcut:
 *
 *   const Icon = getLinkIcon(link.url);
 *   return <Icon size={20} />;
 */
export function getLinkIcon(url: string | null | undefined): FC<GlyphProps> {
  const brand = brandKeyFromUrl(url);
  return function LinkBrandIcon(props: GlyphProps) {
    return <Glyph brand={brand} {...props} />;
  };
}