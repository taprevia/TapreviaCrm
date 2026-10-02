import type { ICard } from '@/types';

/**
 * Canonical vCard builder — the single source of truth for every .vcf payload
 * in the product (API route, all public templates, the marketing contacts page).
 *
 * Targets vCard 3.0 (RFC 2426) rather than 4.0 (RFC 6350) on purpose:
 *   - iOS Contacts imports 4.0 unreliably, frequently producing a blank card.
 *   - Android's ContactsContract / Samsung importer is stricter about the 3.0
 *     details (CRLF endings, 75-octet folding) that 4.0 parsers often ignore.
 *   - 4.0 requires a mandatory UID and a `date-time` basic REV; 3.0 tolerates
 *     their absence, so a partially-4.0 file gets the worst of both worlds.
 * Unknown `X-` properties are ignored per RFC 2426 §3.3 but still read by
 * several Android builds, so social links ship as extensions.
 */

const CRLF = '\r\n';

/** Maximum octet length of a content line, excluding CRLF (RFC 2426 §2.1). */
const LINE_OCTETS = 75;

/** RFC 2426 §3.4 text escaping: backslash, newline, comma, semicolon. */
function esc(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/\r\n|\r|\n/g, '\\n')
    .replace(/,/g, '\\,')
    .replace(/;/g, '\\;');
}

const encoder = new TextEncoder();

/**
 * Fold a content line to 75 octets using CRLF + single space.
 *
 * Iterates by code point (not code unit, not byte) so multi-byte UTF-8 names
 * and long URLs are never split mid-character — a split sequence makes the
 * whole line undecodable and the importer drops the record.
 */
function fold(line: string): string {
  if (encoder.encode(line).length <= LINE_OCTETS) return line;

  const parts: string[] = [];
  let current = '';
  let currentOctets = 0;

  for (const char of line) {
    // Continuation lines carry a leading space, so their budget is one smaller.
    const budget = parts.length === 0 ? LINE_OCTETS : LINE_OCTETS - 1;
    const width = encoder.encode(char).length;
    if (currentOctets + width > budget) {
      parts.push(current);
      current = '';
      currentOctets = 0;
    }
    current += char;
    currentOctets += width;
  }
  if (current) parts.push(current);

  return parts.join(`${CRLF} `);
}

function joinNonEmpty(parts: Array<string | undefined>, sep = ' '): string {
  return parts.filter((p): p is string => Boolean(p && p.trim())).join(sep);
}

function absoluteUrl(url: string, base: string): string {
  if (!url) return '';
  try {
    return new URL(url, base).toString();
  } catch {
    return url;
  }
}

/** RFC 2426 `REV` — ISO 8601 basic form (20260927T100000Z), not an ISO 8601 string. */
function revStamp(date: Date): string {
  return `${date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')}`;
}

/**
 * Build an RFC 2426 (vCard 3.0) payload for a card document.
 * `base` is used to absolutize relative media paths (PHOTO/URL/SOCIALPROFILE).
 */
export function buildVcf(card: ICard, base: string, now: Date = new Date()): string {
  const b = card.basic;
  const fullName =
    card.name ||
    joinNonEmpty([b.firstName, b.lastName]) ||
    'Contact';
  const displayName = joinNonEmpty([b.firstName, b.lastName]) || fullName;

  const lines: string[] = [
    'BEGIN:VCARD',
    'VERSION:3.0',
    'PRODID:-//Taprevia//CRM//vCard 3.0//EN',
    `UID:${esc(card.cardUid || card.urlAlias || card._id)}`,
    `N;CHARSET=UTF-8:${esc(b.lastName || '')};${esc(b.firstName || '')};;;`,
    `FN;CHARSET=UTF-8:${esc(displayName)}`,
  ];

  if (b.jobTitle) lines.push(`TITLE;CHARSET=UTF-8:${esc(b.jobTitle)}`);
  if (b.company) lines.push(`ORG;CHARSET=UTF-8:${esc(b.company)}`);
  if (card.occupation) lines.push(`ROLE;CHARSET=UTF-8:${esc(card.occupation)}`);

  if (b.phone) lines.push(`TEL;TYPE=CELL,VOICE:${esc(b.phone)}`);
  if (b.alternatePhone) lines.push(`TEL;TYPE=WORK,VOICE:${esc(b.alternatePhone)}`);
  if (b.email) lines.push(`EMAIL;TYPE=INTERNET:${esc(b.email)}`);
  if (b.alternateEmail) lines.push(`EMAIL;TYPE=WORK:${esc(b.alternateEmail)}`);

  if (card.location.address) {
    lines.push(
      `ADR;TYPE=WORK;CHARSET=UTF-8:;;${esc(card.location.address)};;;;`,
    );
  }

  const website = card.socialLinks.find((l) => l.platform === 'website')?.url;
  if (website) lines.push(`URL:${esc(absoluteUrl(website, base))}`);

  const publicUrl = absoluteUrl(`/profile/${card.urlAlias}`, base);
  lines.push(`URL;TYPE=profile:${esc(publicUrl)}`);

  if (card.profileImageUrl) {
    lines.push(`PHOTO;VALUE=URI:${esc(absoluteUrl(card.profileImageUrl, base))}`);
  }

  for (const link of card.socialLinks) {
    if (link.platform === 'website' || !link.url) continue;
    lines.push(
      `X-SOCIALPROFILE;TYPE=${esc(link.platform)}:${esc(absoluteUrl(link.url, base))}`,
    );
  }

  if (card.location.mapsUrl) {
    lines.push(`X-MAPS-URL:${esc(card.location.mapsUrl)}`);
  }

  lines.push(`REV:${revStamp(now)}`);
  lines.push('END:VCARD');

  // Trailing CRLF: spec-conformant payloads end with a line break, and some
  // Android importers refuse to finalise a record without it.
  return `${lines.map(fold).join(CRLF)}${CRLF}`;
}

function slugify(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'contact'
  );
}

/**
 * Filename for the download. `urlAlias` is already constrained to
 * `[a-z0-9-]` by aliasSchema, so it is the safe path; free-form names are
 * slugged and fall back to `contact` when they carry no ASCII (e.g. a
 * Devanagari or Tamil display name), because a header containing raw
 * non-ASCII corrupts Content-Disposition on iOS.
 */
export function vcfFilename(card: ICard): string {
  const alias = (card.urlAlias || '').trim();
  return `${alias || slugify(card.name || '') || 'contact'}.vcf`;
}

/** RFC 5987 `filename*` companion, for headers carrying non-ASCII names. */
export function vcfFilenameStar(card: ICard): string | null {
  const alias = (card.urlAlias || '').trim();
  if (alias) return null;
  const name = (card.name || '').trim();
  return /[^\x20-\x7e]/.test(name) ? `UTF-8''${encodeURIComponent(name)}.vcf` : null;
}
