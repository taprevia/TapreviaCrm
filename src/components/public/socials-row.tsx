import type { ReactNode } from 'react';
import { Globe } from 'lucide-react';
import type { ISocialLink } from './types';

/* ------------------------------------------------------------------ */
/* Brand glyphs — inline SVG, currentColor only                        */
/* ------------------------------------------------------------------ */

function StrokeShell({ children }: { children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

function FillShell({ children }: { children: ReactNode }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      {children}
    </svg>
  );
}

/** Normalises platform ids like "Instagram", "you-tube", "my_website" → "instagram"... */
function normalizePlatform(platform: string): string {
  return platform.toLowerCase().replace(/[^a-z]/g, '');
}

/**
 * Small internal switch of simple recognizable brand glyphs.
 * Unknown / custom platforms fall back to the caller-provided fallback node
 * (Globe icon by default).
 */
export function BrandIcon({
  platform,
  size = 18,
}: {
  platform: string;
  size?: number;
}) {
  const key = normalizePlatform(platform);
  const px = { width: size, height: size };

  switch (key) {
    case 'instagram':
      return (
        <span style={px} className="inline-block">
          <StrokeShell>
            <rect x="2.5" y="2.5" width="19" height="19" rx="5" />
            <circle cx="12" cy="12" r="4" />
            <circle cx="17.25" cy="6.75" r="0.5" fill="currentColor" />
          </StrokeShell>
        </span>
      );
    case 'facebook':
    case 'meta':
      return (
        <span style={px} className="inline-block">
          <StrokeShell>
            <path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z" />
          </StrokeShell>
        </span>
      );
    case 'x':
    case 'twitter':
      return (
        <span style={px} className="inline-block">
          <FillShell>
            <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231 5.451-6.231Zm-1.161 17.52h1.833L7.084 4.126H5.117l11.966 15.644Z" />
          </FillShell>
        </span>
      );
    case 'youtube':
      return (
        <span style={px} className="inline-block">
          <StrokeShell>
            <path d="M2.5 17a24.12 24.12 0 0 1 0-10 2 2 0 0 1 1.4-1.4 49.56 49.56 0 0 1 16.2 0A2 2 0 0 1 21.5 7a24.12 24.12 0 0 1 0 10 2 2 0 0 1-1.4 1.4 49.55 49.55 0 0 1-16.2 0A2 2 0 0 1 2.5 17" />
            <path d="m10 15 5-3-5-3z" />
          </StrokeShell>
        </span>
      );
    case 'linkedin':
      return (
        <span style={px} className="inline-block">
          <StrokeShell>
            <path d="M16 8a6 6 0 0 1 6 6v7h-4v-7a2 2 0 0 0-2-2 2 2 0 0 0-2 2v7h-4v-7a6 6 0 0 1 6-6z" />
            <rect width="4" height="12" x="2" y="9" />
            <circle cx="4" cy="4" r="2" />
          </StrokeShell>
        </span>
      );
    case 'whatsapp': {
      // Fixed-brand WhatsApp glyph (fill), colour still follows currentColor.
      return (
        <span style={px} className="inline-block">
          <FillShell>
            <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.263.489 1.694.625.712.227 1.36.195 1.872.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413Z" />
          </FillShell>
        </span>
      );
    }
    case 'pinterest':
      return (
        <span style={px} className="inline-block">
          <FillShell>
            <path d="M12 0C5.373 0 0 5.372 0 12c0 5.084 3.163 9.426 7.627 11.174-.105-.949-.2-2.405.042-3.441.218-.937 1.407-5.965 1.407-5.965s-.359-.719-.359-1.782c0-1.668.967-2.914 2.171-2.914 1.023 0 1.518.769 1.518 1.69 0 1.03-.655 2.569-.994 3.995-.283 1.195.599 2.169 1.777 2.169 2.133 0 3.772-2.249 3.772-5.495 0-2.873-2.064-4.882-5.012-4.882-3.414 0-5.418 2.561-5.418 5.208 0 1.031.397 2.137.893 2.738.098.119.112.224.083.345l-.333 1.36c-.053.22-.174.267-.402.161-1.499-.698-2.436-2.889-2.436-4.649 0-3.785 2.75-7.262 7.929-7.262 4.163 0 7.398 2.967 7.398 6.931 0 4.136-2.607 7.464-6.227 7.464-1.216 0-2.359-.631-2.75-1.378l-.748 2.853c-.271 1.043-1.002 2.35-1.492 3.146C9.57 23.812 10.763 24 12 24c6.627 0 12-5.373 12-12 0-6.628-5.373-12-12-12z" />
          </FillShell>
        </span>
      );
    case 'reddit':
      // Simplified Snoo: head + eyes + antenna
      return (
        <span style={px} className="inline-block">
          <StrokeShell>
            <ellipse cx="12" cy="14.5" rx="8.5" ry="5.5" />
            <circle cx="9.25" cy="13.75" r="0.6" fill="currentColor" />
            <circle cx="14.75" cy="13.75" r="0.6" fill="currentColor" />
            <path d="M12 9V6.5L15.5 5.5" />
            <circle cx="16.25" cy="5.25" r="1.25" />
            <path d="M6.5 17.5c1.6 1.1 3.5 1.6 5.5 1.6s3.9-.5 5.5-1.6" />
          </StrokeShell>
        </span>
      );
    case 'tumblr':
      return (
        <span style={px} className="inline-block">
          <FillShell>
            <path d="M14.608 23.965c-3.931 0-6.858-2.011-6.858-6.843V10.16H4.5V6.42C7.533 5.63 8.79 3.207 8.957.5h3.62v5.333h4.215v4.327h-4.215v6.106c0 1.83.924 2.464 2.396 2.464.67 0 1.44-.21 1.932-.44l1.116 3.71c-.512.752-1.888 1.965-5.413 1.965Z" />
          </FillShell>
        </span>
      );
    case 'tiktok':
      return (
        <span style={px} className="inline-block">
          <FillShell>
            <path d="M12.525.02c1.31-.02 2.61-.01 3.91-.02.08 1.53.63 3.09 1.75 4.17 1.12 1.11 2.7 1.62 4.24 1.79v4.03c-1.44-.05-2.89-.35-4.2-.97-.57-.26-1.1-.59-1.62-.93-.01 2.92.01 5.84-.02 8.75-.08 1.4-.54 2.79-1.35 3.94-1.31 1.92-3.58 3.17-5.91 3.21-1.43.08-2.86-.31-4.08-1.03-2.02-1.19-3.44-3.37-3.65-5.71-.02-.5-.03-1-.01-1.49.18-1.9 1.12-3.72 2.58-4.96 1.66-1.44 3.98-2.13 6.15-1.72.02 1.48-.04 2.96-.04 4.44-.99-.32-2.15-.23-3.02.37-.63.41-1.11 1.04-1.36 1.75-.21.51-.15 1.07-.14 1.61.24 1.64 1.82 3.02 3.5 2.87 1.12-.01 2.19-.66 2.77-1.61.19-.37.29-.76.32-1.18V.02Z" />
          </FillShell>
        </span>
      );
    case 'snapchat':
      // Simplified ghost outline
      return (
        <span style={px} className="inline-block">
          <StrokeShell>
            <path d="M12 3c2.9 0 4.6 2 4.6 4.7 0 1.2-.1 2.3-.1 2.3s1.1-.6 1.9 0c.8.6.3 1.6-.7 2.1-.7.4-1.4.6-1.4.6s.5 1.7 2 2.6c1.2.7 2.4.8 2.4.8s-.6 1.5-3 1.8c-.2 0-.4.4-.5.9-.1.5-.9.7-2 .5-1-.2-1.9.6-3.2.6s-2.2-.8-3.2-.6c-1.1.2-1.9 0-2-.5-.1-.5-.3-.9-.5-.9-2.4-.3-3-1.8-3-1.8s1.2-.1 2.4-.8c1.5-.9 2-2.6 2-2.6s-.7-.2-1.4-.6c-1-.5-1.5-1.5-.7-2.1.8-.6 1.9 0 1.9 0s-.1-1.1-.1-2.3C7.4 5 9.1 3 12 3Z" />
          </StrokeShell>
        </span>
      );
    case 'website':
    case 'site':
    case 'web':
    case 'blog':
    case 'portfolio':
      return (
        <span style={px} className="inline-block">
          <StrokeShell>
            <circle cx="12" cy="12" r="10" />
            <path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20" />
            <path d="M2 12h20" />
          </StrokeShell>
        </span>
      );
    default:
      return <Globe size={size} aria-hidden="true" />;
  }
}

/* ------------------------------------------------------------------ */
/* SocialsRow                                                          */
/* ------------------------------------------------------------------ */

function SocialLinkItem({ link }: { link: ISocialLink }) {
  const label = link.label?.trim() || link.platform;
  return (
    <a
      href={link.url}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={label}
      title={label}
      className="grid h-10 w-10 place-items-center rounded-full border border-[var(--v-border)] bg-[var(--v-surface)] text-[var(--v-text)] transition-transform duration-150 hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--v-accent)] focus-visible:ring-offset-2"
    >
      <BrandIcon platform={link.platform} />
    </a>
  );
}

export function SocialsRow({ links }: { links: ISocialLink[] }) {
  if (!links || links.length === 0) return null;
  return (
    <nav aria-label="Social links" className="flex flex-wrap justify-center gap-3 px-4">
      {links.map((link, i) => (
        <SocialLinkItem key={`${link.url}-${i}`} link={link} />
      ))}
    </nav>
  );
}
