/**
 * vCard RFC 2426 (vCard 3.0) conformance verification.
 *
 * Pure unit test — no database, no network, no dev server. The public
 * `buildVcf()` is the single generator behind the API route, all three public
 * templates, and the marketing contacts page, so asserting on it covers every
 * device-facing .vcf payload the product emits.
 *
 * These are the exact defects that made .vcf downloads fail on iOS and Android:
 * bare-LF line endings, a malformed `N` component, missing 75-octet folding,
 * and a vCard 4.0 header that iOS Contacts does not reliably import.
 *
 * Run:  npx tsx scripts/test-vcf.ts
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import type { ICard } from '@/types';
import { buildVcf, vcfFilename, vcfFilenameStar } from '@/lib/vcf';

let passed = 0;
let failed = 0;

function report(name: string, pass: boolean, detail = ''): void {
  if (pass) {
    passed += 1;
    console.log(`  ok   ${name}`);
  } else {
    failed += 1;
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

function section(title: string): void {
  console.log(`\n${title}`);
}

const encoder = new TextEncoder();
const octets = (value: string): number => encoder.encode(value).length;

const BASE = 'https://crm.example.com';

/**
 * Physical lines, split on CRLF only — a bare LF will not match, which is the
 * point. The trailing CRLF yields a final empty element, which is an artifact
 * of the split rather than a blank content line, so it is dropped.
 */
function logicalLines(vcard: string): string[] {
  const parts = vcard.split('\r\n');
  if (parts.length > 0 && parts[parts.length - 1] === '') parts.pop();
  return parts;
}

/**
 * Undo RFC 2426 folding so assertions can be written against whole logical
 * content lines: a line beginning with a single space continues the previous
 * one, and the space itself is not part of the value.
 */
function unfold(vcard: string): string[] {
  const out: string[] = [];
  for (const line of logicalLines(vcard)) {
    if (line.startsWith(' ') && out.length > 0) out[out.length - 1] += line.slice(1);
    else out.push(line);
  }
  return out;
}

function baseCard(overrides: Partial<ICard> = {}): ICard {
  return {
    _id: '507f1f77bcf86cd799439011',
    cardUid: 'CARD-UID-0001',
    name: 'Ada Lovelace',
    basic: {
      firstName: 'Ada',
      lastName: 'Lovelace',
      email: 'ada@example.com',
      alternateEmail: 'a.lovelace@example.com',
      phone: '+919812345678',
      alternatePhone: '+442071234567',
      company: 'Analytical Engines Ltd',
      jobTitle: 'Countess of Computing',
      defaultLanguage: 'en',
    },
    location: {
      type: 'link',
      address: '12 Baker Street, London NW1 6XE',
      mapsUrl: 'https://maps.example.com/?q=12+Baker+Street',
    },
    socialLinks: [
      { platform: 'website', url: '/ada' },
      { platform: 'linkedin', url: 'https://linkedin.com/in/ada' },
    ],
    urlAlias: 'ada-lovelace',
    profileImageUrl: '/uploads/ada.png',
    occupation: 'Mathematician',
    ...overrides,
  } as ICard;
}

const NOW = new Date('2026-09-27T10:00:00.000Z');

// ─── Line structure ───────────────────────────────────────────────────────────

section('Line endings (RFC 2426 §2.1)');

{
  const vcard = buildVcf(baseCard(), BASE, NOW);

  report(
    'no bare LF (every line break is CRLF)',
    !/(^|[^\r])\n/.test(vcard),
    'found a bare LF — Samsung/Contacts importers reject these',
  );
  report('no bare CR', !/[^\r]\r(?!\n)/.test(vcard), 'found a stray CR');
  report('ends with trailing CRLF', vcard.endsWith('\r\n'), `last bytes: ${JSON.stringify(vcard.slice(-6))}`);

  const lines = logicalLines(vcard);
  report('starts with BEGIN:VCARD', lines[0] === 'BEGIN:VCARD', `got ${JSON.stringify(lines[0])}`);
  const endIndex = lines.findIndex((l) => l === 'END:VCARD');
  report('closes with END:VCARD', endIndex > 0, `index=${endIndex}`);
  report(
    'no blank content lines',
    lines.every((l) => l.length > 0),
  );
  report(
    'no trailing spaces before CRLF',
    !/[ \t]\r\n/.test(vcard),
    'trailing whitespace is not a legal content line',
  );
}

// ─── Version / required properties ────────────────────────────────────────────

section('Required properties');

{
  const lines = unfold(buildVcf(baseCard(), BASE, NOW));

  report('VERSION:3.0', lines.includes('VERSION:3.0'), 'iOS Contacts does not reliably import 4.0');
  report('PRODID present', lines.some((l) => l.startsWith('PRODID:')));
  report('UID present', lines.some((l) => l.startsWith('UID:')), 'identifies the contact across re-imports');
  report(
    'REV is ISO 8601 basic (date-time, not an ISO string)',
    lines.includes('REV:20260927T100000Z'),
    `got ${JSON.stringify(lines.find((l) => l.startsWith('REV:')))}`,
  );
}

// ─── N / FN structure ─────────────────────────────────────────────────────────

section('N and FN structure');

{
  const lines = unfold(buildVcf(baseCard(), BASE, NOW));

  const n = lines.find((l) => l.startsWith('N;'));
  const fn = lines.find((l) => l.startsWith('FN;'));

  report('N declares UTF-8', !!n?.startsWith('N;CHARSET=UTF-8:'), `got ${n}`);
  report('FN declares UTF-8', !!fn?.startsWith('FN;CHARSET=UTF-8:'), `got ${fn}`);

  // N is a structured value: Family;Given;Middle;Prefix;Suffix — exactly 5 parts.
  const components = n?.slice('N;CHARSET=UTF-8:'.length).split(';') ?? [];
  report('N has exactly 5 components', components.length === 5, `got ${components.length}`);
  report('N family = lastName', components[0] === 'Lovelace', `got ${JSON.stringify(components[0])}`);
  report('N given = firstName', components[1] === 'Ada', `got ${JSON.stringify(components[1])}`);

  // The regression that broke Android/iOS: the whole display name in one slot.
  const badN = unfold(buildVcf(baseCard({ name: 'Grace Hopper' }), BASE, NOW)).find((l) =>
    l.startsWith('N;'),
  );
  report(
    'N does not collapse the full name into a single component',
    badN?.split(':')[1].split(';').length === 5,
    `got ${badN}`,
  );

  report('FN matches the card name', fn === 'FN;CHARSET=UTF-8:Ada Lovelace', `got ${fn}`);
  report(
    'FN falls back to name when basic is empty',
    unfold(buildVcf(baseCard({ name: 'Grace Hopper', basic: {} as ICard['basic'] }), BASE, NOW))
      .includes('FN;CHARSET=UTF-8:Grace Hopper'),
  );
}

// ─── Escaping ─────────────────────────────────────────────────────────────────

section('Value escaping (RFC 2426 §3.4)');

{
  const lines = unfold(
    buildVcf(
      baseCard({
        name: 'Smith, John; "Jr"',
        basic: {
          ...baseCard().basic,
          firstName: 'John, Jr.',
          lastName: 'Smith; the \\ younger',
          jobTitle: 'Line one\nLine two',
          email: 'a,b@example.com',
        },
      }),
      BASE,
      NOW,
    ),
  );

  const n = lines.find((l) => l.startsWith('N;')) ?? '';
  const fn = lines.find((l) => l.startsWith('FN;')) ?? '';
  const title = lines.find((l) => l.startsWith('TITLE')) ?? '';
  const email = lines.find((l) => l.startsWith('EMAIL')) ?? '';

  report('commas escaped in FN', fn.includes('\\,'), `got ${fn}`);
  report('semicolons escaped in N', n.includes('\\;'), `got ${n}`);
  report('backslashes escaped', n.includes('\\\\'), `got ${n}`);
  report('literal newlines escaped in TITLE', title.includes('\\n'), `got ${title}`);

  // A raw newline in a value would silently truncate the record: everything
  // after it becomes a new (invalid) content line. Assert the line count is
  // unaffected by embedding a newline in jobTitle.
  const multiline = baseCard({
    basic: { ...baseCard().basic, jobTitle: 'Line one\nLine two' },
  });
  const withNewline = logicalLines(buildVcf(multiline, BASE, NOW));
  const withNewlines = logicalLines(
    buildVcf(
      baseCard({ basic: { ...baseCard().basic, jobTitle: 'Line one' } }),
      BASE,
      NOW,
    ),
  );
  report(
    'an embedded newline does not add a content line',
    withNewline.length === withNewlines.length,
    `${withNewline.length} vs ${withNewlines.length}`,
  );
  report(
    'the embedded newline stays inside the TITLE value',
    withNewline.filter((l) => l.startsWith('TITLE')).length === 1 &&
      withNewline.some((l) => l.includes('\\n')),
  );

  report('commas escaped in EMAIL', email.includes('\\,'), `got ${email}`);

  // Escaping a `;` keeps the N component count at exactly 5 — the core
  // invariant a parser relies on.
  const components = n.slice('N;CHARSET=UTF-8:'.length).split(/(?<!\\);/).length;
  report('escaped semicolons do not create extra N components', components === 5, `got ${components}`);
}

// ─── 75-octet folding ─────────────────────────────────────────────────────────

section('Line folding (RFC 2426 §2.1)');

{
  const card = baseCard({
    socialLinks: [
      {
        platform: 'linkedin',
        url: `https://linkedin.com/in/${'a'.repeat(300)}`,
      },
    ],
  });
  const vcard = buildVcf(card, BASE, NOW);
  const lines = logicalLines(vcard);

  const overlong = lines.filter((l) => octets(l) > 75);
  report(
    'no content line exceeds 75 octets',
    overlong.length === 0,
    `${overlong.length} line(s) too long, first: ${JSON.stringify(overlong[0]?.slice(0, 90))}`,
  );
  report(
    'long lines are folded (a continuation exists)',
    logicalLines(vcard).some((l) => l.startsWith(' ')),
    'expected a CRLF-continuation fold',
  );
  report(
    'no fold point exceeds 75 octets',
    logicalLines(vcard).every((l) => octets(l) <= 75),
  );
  report(
    'folds never split a multi-byte character',
    (() => {
      const multi = buildVcf(
        baseCard({ name: 'प्रिन्सा', basic: { ...baseCard().basic, firstName: 'प्रिन्सा' } }),
        BASE,
        NOW,
      );
      // A split sequence would decode to U+FFFD.
      return !multi.includes('�');
    })(),
  );
  report(
    'UTF-8 name survives folding intact',
    unfold(buildVcf(baseCard({ basic: { ...baseCard().basic, firstName: 'प्रिन्सा' } }), BASE, NOW))
      .some((l) => l.startsWith('FN;') && l.includes('प्रिन्सा')),
  );

  // Refold/unfold must be lossless, or a folded line silently truncates a URL.
  report(
    'unfolding restores the original social URL',
    unfold(vcard).some((l) => l.includes(`https://linkedin.com/in/${'a'.repeat(300)}`)),
  );
  report(
    'the folded line really was split across physical lines',
    logicalLines(vcard).filter((l) => l.startsWith(' ')).length > 1,
  );
  const restored = unfold(vcard).find((l) => l.startsWith('X-SOCIALPROFILE'));
  report(
    'the folded line round-trips to a single logical line',
    !!restored && octets(restored) > 75,
    `got ${restored?.length ?? 0} chars`,
  );
  report(
    'the unfolded line matches the source URL exactly',
    restored === `X-SOCIALPROFILE;TYPE=linkedin:https://linkedin.com/in/${'a'.repeat(300)}`,
  );
}

// ─── Structured properties ────────────────────────────────────────────────────

section('Structured properties');

{
  const lines = unfold(buildVcf(baseCard(), BASE, NOW));

  const tel = lines.filter((l) => l.startsWith('TEL;'));
  report('phone uses discrete 3.0 TYPE params', tel.every((l) => l.includes('TYPE=CELL,') || l.includes('TYPE=WORK,')), `got ${tel}`);
  report('no lowercase 4.0-only type list', !lines.some((l) => l.includes('TYPE=cell,voice')));

  const adr = lines.find((l) => l.startsWith('ADR;'));
  const adrParts = (adr?.split(':')[1] ?? '').split(';');
  // ADR: po-box;extended;street;locality;region;postal;country
  report('ADR has 7 components', adrParts.length === 7, `got ${adr}`);
  report('street lands in the 3rd ADR component', adrParts[2]?.startsWith('12 Baker') === true, `got ${adr}`);

  report('URL;TYPE=profile present', lines.some((l) => l.startsWith('URL;TYPE=profile:')));
  report('relative media absolutized against base', lines.some((l) => l.includes(`${BASE}/uploads/ada.png`)));
  report('social links use X- extension', lines.some((l) => l.startsWith('X-SOCIALPROFILE;TYPE=linkedin:')));
  report('website excluded from X- socials', !lines.some((l) => l.startsWith('X-SOCIALPROFILE;TYPE=website:')));
}

// ─── Degenerate input ─────────────────────────────────────────────────────────

section('Degenerate input');

{
  const empty = unfold(
    buildVcf(
      baseCard({
        name: '',
        basic: {} as ICard['basic'],
        location: { type: 'link', address: '', mapsUrl: '' },
        socialLinks: [],
        profileImageUrl: '',
        occupation: '',
      }),
      BASE,
      NOW,
    ),
  );
  report('empty card still emits a valid envelope', empty[0] === 'BEGIN:VCARD' && empty.includes('END:VCARD'));
  report('empty card has a non-empty FN', (empty.find((l) => l.startsWith('FN;')) ?? '').length > 'FN;CHARSET=UTF-8:'.length);
  report('empty card N has 5 components', (empty.find((l) => l.startsWith('N;')) ?? '').split(':')[1].split(';').length === 5);

  const noAlias = buildVcf(baseCard({ urlAlias: '' }), BASE, NOW);
  report('cardUid wins the UID chain', noAlias.includes('UID:CARD-UID-0001'));
  report(
    'missing cardUid + alias falls back to card _id',
    buildVcf(baseCard({ urlAlias: '', cardUid: '' }), BASE, NOW).includes(
      'UID:507f1f77bcf86cd799439011',
    ),
  );
}

// ─── Filenames ────────────────────────────────────────────────────────────────

section('Download filenames');

{
  report('uses the validated alias', vcfFilename(baseCard()) === 'ada-lovelace.vcf');
  report(
    'slugifies a non-alias name',
    vcfFilename(baseCard({ urlAlias: '', name: 'Grace Hopper' })) === 'grace-hopper.vcf',
    `got ${vcfFilename(baseCard({ urlAlias: '', name: 'Grace Hopper' }))}`,
  );
  report(
    'strips a non-Latin name to a safe fallback',
    vcfFilename(baseCard({ urlAlias: '', name: 'Grace -hopper; x' })) === 'grace-hopper-x.vcf',
  );
  report(
    'falls back to contact.vcf for a non-Latin name with no alias',
    vcfFilename(baseCard({ urlAlias: '', name: 'प्रिन्सा' })) === 'contact.vcf',
  );
  report('no filename* for an ASCII-safe alias', vcfFilenameStar(baseCard()) === null);
  report(
    'filename* emitted for a non-ASCII name',
    vcfFilenameStar(baseCard({ urlAlias: '', name: 'प्रिन्सा' })) === `UTF-8''${encodeURIComponent('प्रिन्सा')}.vcf`,
  );
  report(
    'filename is header-safe (no quotes, CR/LF, or semicolons)',
    /^[\x20-\x7e]+$/.test(vcfFilename(baseCard({ urlAlias: '' }))),
  );
}

// ─── Platform-specific regressions ────────────────────────────────────────────

section('Mobile regression guards');

{
  // The exact social.tsx payload that failed on iPhone: a single-component N
  // plus bare-LF line endings, and no CHARSET declaration.
  const broken = `BEGIN:VCARD\nVERSION:3.0\nN:${'Ada Lovelace'}\nFN:${'Ada Lovelace'}\nEND:VCARD`;
  report('legacy social.tsx payload is detected as non-conformant', /(^|[^\r])\n/.test(broken));
  report('legacy single-component N is detected as non-conformant', 'N:Ada Lovelace'.split(':')[1].split(';').length !== 5);

  const ours = buildVcf(baseCard(), BASE, NOW);
  report('current builder emits a 5-component N', (ours.match(/^N;CHARSET=UTF-8:.*$/m)?.[0].split(':')[1].split(';').length) === 5);
  report('current builder declares charset on both name fields', /N;CHARSET=UTF-8:/.test(ours) && /FN;CHARSET=UTF-8:/.test(ours));
  report('current builder is CRLF-only', !/(^|[^\r])\n/.test(ours));
  report('current builder has no 4.0-only properties', !/^VERSION:4\.0$/m.test(ours));
}

// ─── Download client ──────────────────────────────────────────────────────────

section('Download client (gate + fallback routing)');

{
  const DOWNLOAD_SRC = readFileSync(
    join(__dirname, '..', 'src', 'lib', 'vcf-download.ts'),
    'utf8',
  );

  // The gate must never be bypassed: a 428 has to surface as gateRequired so
  // the caller collects details and retries, rather than silently downloading.
  report(
    'a 428 is surfaced as gateRequired',
    DOWNLOAD_SRC.includes('response.status === 428') &&
      DOWNLOAD_SRC.includes("return { status: 'gateRequired' }"),
  );
  report(
    'the 404 fallback cannot swallow a gate response',
    /if \(result\.status !== 'error'\) return result;/.test(DOWNLOAD_SRC) &&
      /result\.message === 'HTTP 404'/.test(DOWNLOAD_SRC),
    'the early return on non-error statuses must precede the fallback',
  );
  report(
    'the object URL is not revoked in the click tick (iOS)',
    // Name-agnostic: no revoke may sit in the statement(s) right after click().
    !/\.click\(\);\s*[\w.]*revokeObjectURL\s*\(/.test(DOWNLOAD_SRC) &&
      // …and the revoke must be deferred by a timer rather than dropped entirely.
      /\.click\(\);[\s\S]{0,240}?setTimeout\([\s\S]{0,240}?revokeObjectURL\s*\(/.test(
        DOWNLOAD_SRC,
      ),
    'revoking in the same tick aborts the download on iOS Safari',
  );
  report(
    'the anchor is appended to the document (iOS)',
    /document\.body\.appendChild\(anchor\)/.test(DOWNLOAD_SRC),
  );
  report('the blob declares the charset', DOWNLOAD_SRC.includes("type: 'text/vcard;charset=utf-8'"));
  report('the gate query carries name and email', /n=\$\{encodeURIComponent\(contact\.name\)\}/.test(DOWNLOAD_SRC) && /e=\$\{encodeURIComponent\(contact\.email\)\}/.test(DOWNLOAD_SRC));
}

// ─── Summary ──────────────────────────────────────────────────────────────────

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
