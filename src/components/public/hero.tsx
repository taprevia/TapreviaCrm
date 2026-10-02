import type { IVcard } from './types';

/* ------------------------------------------------------------------ */
/* Identity helpers                                                    */
/* ------------------------------------------------------------------ */

/** Best-effort display name: top-level name, else "First Last" from basic info. */
export function vcardDisplayName(vcard: IVcard): string {
  const top = vcard.name?.trim();
  if (top) return top;
  const first = vcard.basic?.firstName?.trim() ?? '';
  const last = vcard.basic?.lastName?.trim() ?? '';
  return `${first} ${last}`.trim() || 'Profile';
}

export function getInitials(vcard: IVcard): string {
  const source = vcardDisplayName(vcard);
  const words = source.split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  if (words.length === 1) return words[0]!.slice(0, 2).toUpperCase();
  const first = words[0]?.charAt(0) ?? '';
  const last = words[words.length - 1]?.charAt(0) ?? '';
  return `${first}${last}`.toUpperCase();
}

/** "Job Title · Company" subtitle parts, honouring both occupation and basic.jobTitle. */
function identitySubtitle(vcard: IVcard): string {
  const job =
    vcard.basic?.jobTitle?.trim() || vcard.occupation?.trim() || '';
  const company = vcard.basic?.company?.trim() || '';
  return [job, company].filter(Boolean).join(' · ');
}

/* ------------------------------------------------------------------ */
/* Avatar                                                              */
/* ------------------------------------------------------------------ */

/**
 * Circular avatar with initials fallback on --v-accent.
 * Purely presentational & server-safe. Sizing via `sizeClass` (default h-14 w-14).
 */
export function VcardAvatar({
  vcard,
  sizeClass = 'h-14 w-14',
  initialsClass = 'text-base',
}: {
  vcard: IVcard;
  sizeClass?: string;
  initialsClass?: string;
}) {
  const name = vcardDisplayName(vcard);
  const url = vcard.profileImageUrl?.trim();

  return (
    <span
      className={`relative inline-flex shrink-0 select-none items-center justify-center overflow-hidden rounded-full bg-[var(--v-accent)] align-middle ${sizeClass}`}
    >
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element -- plain img per public-portal spec (no next/image config coupling)
        <img
          src={url}
          alt={name}
          loading="eager"
          decoding="async"
          className="absolute inset-0 h-full w-full object-cover"
        />
      ) : (
        <span
          role="img"
          aria-label={name}
          className={`font-bold leading-none text-[var(--v-on-accent)] ${initialsClass}`}
        >
          {getInitials(vcard)}
        </span>
      )}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Cover media                                                         */
/* ------------------------------------------------------------------ */

/* Exported for template variants (e.g. corporate) that render covers themselves. */
export function CoverMedia({ vcard }: { vcard: IVcard }) {
  const value = vcard.coverValue?.trim();

  if (vcard.coverType === 'color') {
    return (
      <div
        aria-hidden="true"
        className="absolute inset-0"
        style={{ backgroundColor: value || 'var(--v-accent)' }}
      />
    );
  }

  if (vcard.coverType === 'video' && value) {
    return (
      <video
        src={value}
        autoPlay
        muted
        loop
        playsInline
        preload="metadata"
        className="absolute inset-0 h-full w-full object-cover"
      />
    );
  }

  if (!value) {
    return <div aria-hidden="true" className="absolute inset-0 bg-[var(--v-surface)]" />;
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element -- plain img per public-portal spec
    <img
      src={value}
      alt=""
      loading="lazy"
      decoding="async"
      className="absolute inset-0 h-full w-full object-cover"
    />
  );
}

/* ------------------------------------------------------------------ */
/* Identity block (non-overlay variants use this)                      */
/* ------------------------------------------------------------------ */

function IdentityBlock({ vcard, centered }: { vcard: IVcard; centered?: boolean }) {
  const subtitle = identitySubtitle(vcard);
  return (
    <div className={`flex flex-col gap-0.5 ${centered ? 'items-center text-center' : ''}`}>
      <h1 className="text-xl font-bold leading-tight text-[var(--v-text)]">
        {vcardDisplayName(vcard)}
      </h1>
      {subtitle && <p className="text-sm text-[var(--v-muted)]">{subtitle}</p>}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Hero — three cover variants                                         */
/* ------------------------------------------------------------------ */

export function Hero({ vcard }: { vcard: IVcard }) {
  // Section flag off → minimal identity-only header, no cover media.
  if (vcard.sections?.header === false) {
    return (
      <header className="flex items-center gap-3 px-4 pt-6">
        <VcardAvatar vcard={vcard} />
        <div className="min-w-0">
          <IdentityBlock vcard={vcard} />
        </div>
      </header>
    );
  }

  switch (vcard.coverStyle) {
    /* ---------------- banner: short strip + overlapping centered avatar -------- */
    case 'banner':
      return (
        <header>
          <div className="relative aspect-[16/5] w-full overflow-hidden bg-[var(--v-surface)]">
            <CoverMedia vcard={vcard} />
          </div>
          <div className="-mt-12 flex justify-center">
            <span className="block overflow-hidden rounded-full shadow-md ring-4 ring-white">
              <VcardAvatar
                vcard={vcard}
                sizeClass="h-24 w-24"
                initialsClass="text-2xl"
              />
            </span>
          </div>
          <div className="mt-3 px-4">
            <IdentityBlock vcard={vcard} centered />
          </div>
        </header>
      );

    /* ---------------- boxed: inset card + avatar overlapping bottom-left ------- */
    case 'boxed':
      return (
        <header>
          <div className="mx-4 mt-4">
            <div className="relative aspect-[16/8] overflow-hidden rounded-2xl bg-[var(--v-surface)]">
              <CoverMedia vcard={vcard} />
            </div>
          </div>
          {/* avatar 88px, half-overlapping the box's bottom edge */}
          <div className="ml-6 -mt-11 w-fit">
            <span className="block overflow-hidden rounded-full shadow-md ring-4 ring-white">
              <VcardAvatar
                vcard={vcard}
                sizeClass="h-[88px] w-[88px]"
                initialsClass="text-2xl"
              />
            </span>
          </div>
          <div className="px-6 pt-3">
            <IdentityBlock vcard={vcard} />
          </div>
        </header>
      );

    /* ---------------- cover (default): full-bleed with scrim + overlaid identity */
    case 'cover':
    default:
      return (
        <header className="relative aspect-[16/10] w-full overflow-hidden bg-[var(--v-surface)]">
          <CoverMedia vcard={vcard} />
          {/* bottom gradient scrim */}
          <div
            aria-hidden="true"
            className="absolute inset-x-0 bottom-0 h-2/3 bg-gradient-to-t from-black/45 to-transparent"
          />
          <div className="absolute inset-x-0 bottom-0 flex flex-col gap-0.5 p-4">
            <h1 className="text-xl font-bold leading-tight text-white">
              {vcardDisplayName(vcard)}
            </h1>
            {identitySubtitle(vcard) && (
              <p className="text-sm text-white/85">{identitySubtitle(vcard)}</p>
            )}
          </div>
        </header>
      );
  }
}
