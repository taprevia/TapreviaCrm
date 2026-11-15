/**
 * Phone storage / link / VCF regression tests.
 *
 * Pure unit tests — no database, no network, no dev server, no writes.
 * Covers the country-selector contract (Approach A), legacy read-time
 * interpretation, unrelated-edit preservation, and every public consumer that
 * now shares `src/lib/phone.ts`.
 *
 * Run:  npx tsx scripts/test-phone.ts
 */

import {
  combinePhone,
  phoneDigits,
  resolvePhoneFieldUpdate,
  splitE164,
  telHref,
  toE164,
  vcfPhone,
  whatsappHref,
} from '@/lib/phone';
import { buildVcf } from '@/lib/vcf';
import { buildWhatsAppEnquiryUrl } from '@/lib/services/whatsapp';

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

function equal(name: string, actual: unknown, expected: unknown): void {
  report(name, actual === expected, `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

function telLines(vcf: string): string[] {
  return vcf.split('\r\n').filter((line) => line.startsWith('TEL;'));
}

/* ── Read-time interpretation of stored legacy values ───────────────────── */

section('Stored value interpretation (read time)');
equal('bare 10-digit Indian mobile → +91', toE164('9878822213'), '+919878822213');
equal('+91 compact preserved', toE164('+919878822213'), '+919878822213');
equal('+91 with spaces normalised', toE164('+91 98788 22213'), '+919878822213');
equal('91 without plus → +91', toE164('919878822213'), '+919878822213');
equal('0091 prefix → +91', toE164('0091 9878822213'), '+919878822213');
equal('leading trunk zero → +91', toE164('09878822213'), '+919878822213');
equal('+91 with trunk zero → +91', toE164('+91 (0) 98788 22213'), '+919878822213');
equal('US number preserved', toE164('+12025550123'), '+12025550123');
equal('UK number preserved', toE164('+447700900123'), '+447700900123');
equal('empty stays empty', toE164(''), null);
equal('whitespace stays empty', toE164('   '), null);
equal('letters are not fabricated', toE164('n/a'), null);
equal('extensions are not absorbed', toE164('+91 9878822213 ext 12'), null);
equal('short numbers are rejected', toE164('12345'), null);

section('Selector combination');
equal('India + local', JSON.stringify(combinePhone('IN', '9878822213')), JSON.stringify({ ok: true, e164: '+919878822213' }));
equal('US + local', JSON.stringify(combinePhone('US', '2025550123')), JSON.stringify({ ok: true, e164: '+12025550123' }));
equal('UK + local', JSON.stringify(combinePhone('GB', '7700900123')), JSON.stringify({ ok: true, e164: '+447700900123' }));
equal(
  'Italy keeps its international leading zero',
  JSON.stringify(combinePhone('IT', '0212345678')),
  JSON.stringify({ ok: true, e164: '+390212345678' })
);
equal(
  'Indian landline accepted when India is explicit',
  JSON.stringify(combinePhone('IN', '02255501234')),
  JSON.stringify({ ok: true, e164: '+912255501234' })
);
equal(
  'explicit international wins over selector',
  JSON.stringify(combinePhone('IN', '+12025550123')),
  JSON.stringify({ ok: true, e164: '+12025550123' })
);
equal(
  'pasted +91 is not duplicated',
  JSON.stringify(combinePhone('IN', '919878822213')),
  JSON.stringify({ ok: true, e164: '+919878822213' })
);
equal(
  '10-digit Indian mobile starting with 91 is not mistaken for a prefix',
  JSON.stringify(combinePhone('IN', '9198788222')),
  JSON.stringify({ ok: true, e164: '+919198788222' })
);
equal(
  'pasted +1 is not duplicated',
  JSON.stringify(combinePhone('US', '12025550123')),
  JSON.stringify({ ok: true, e164: '+12025550123' })
);
equal('empty clears', JSON.stringify(combinePhone('IN', '')), JSON.stringify({ ok: true, e164: '' }));
report('invalid Indian length rejected', combinePhone('IN', '587882221').ok === false);
report('too-short number rejected', combinePhone('US', '20255').ok === false);
report('letters rejected', combinePhone('IN', 'abc').ok === false);

section('Display split');
equal('India split', JSON.stringify(splitE164('+919878822213')), JSON.stringify({ iso2: 'IN', national: '9878822213' }));
equal('US split', JSON.stringify(splitE164('+12025550123')), JSON.stringify({ iso2: 'US', national: '2025550123' }));
equal('UK split', JSON.stringify(splitE164('+447700900123')), JSON.stringify({ iso2: 'GB', national: '7700900123' }));
equal('legacy bare split as India', JSON.stringify(splitE164('9878822213')), JSON.stringify({ iso2: 'IN', national: '9878822213' }));
equal('unresolvable value not guessed', splitE164('call me'), null);

/* ── Public links ───────────────────────────────────────────────────────── */

section('Call links');
equal('legacy bare 10-digit call link', telHref('9878822213'), 'tel:+919878822213');
equal('+91 call link', telHref('+919878822213'), 'tel:+919878822213');
equal('international call link', telHref('+12025550123'), 'tel:+12025550123');
equal('empty has no link', telHref(''), null);
equal('invalid has no link', telHref('n/a'), null);

section('WhatsApp links');
equal('legacy bare 10-digit WhatsApp', whatsappHref('9878822213'), 'https://wa.me/919878822213');
equal('+91 WhatsApp', whatsappHref('+919878822213'), 'https://wa.me/919878822213');
equal('international WhatsApp', whatsappHref('+12025550123'), 'https://wa.me/12025550123');
equal('WhatsApp digits exclude plus', phoneDigits('+447700900123'), '447700900123');
equal('empty has no WhatsApp', whatsappHref(''), null);

/* ── Unrelated-edit preservation ────────────────────────────────────────── */

section('Unrelated edit preservation');
{
  const unchanged = resolvePhoneFieldUpdate('9878822213', '9878822213');
  equal('unchanged legacy value returned verbatim', JSON.stringify(unchanged), JSON.stringify({ ok: true, value: '9878822213' }));
}
{
  const formatted = resolvePhoneFieldUpdate('+91 9878822213', '+91 9878822213');
  equal(
    'unchanged formatted value not normalised',
    JSON.stringify(formatted),
    JSON.stringify({ ok: true, value: '+91 9878822213' })
  );
}
{
  const trimmed = resolvePhoneFieldUpdate('9878822213', '9878822213 ');
  equal(
    'builder trim does not rewrite stored whitespace',
    JSON.stringify(trimmed),
    JSON.stringify({ ok: true, value: '9878822213 ' })
  );
}
{
  const changed = resolvePhoneFieldUpdate('9878822214', '9878822213');
  equal(
    'intentional change stored as E.164',
    JSON.stringify(changed),
    JSON.stringify({ ok: true, value: '+919878822214' })
  );
}
{
  const cleared = resolvePhoneFieldUpdate('', '9878822213');
  equal('intentional clear', JSON.stringify(cleared), JSON.stringify({ ok: true, value: '' }));
}
{
  const invalid = resolvePhoneFieldUpdate('abc', '9878822213');
  equal('invalid change rejected', JSON.stringify(invalid), JSON.stringify({ ok: false }));
}

section('Primary / alternate independence');
{
  const primary = resolvePhoneFieldUpdate('+919878822214', '9878822213');
  const alternate = resolvePhoneFieldUpdate('+919878822213', '+919878822213');
  report('primary change does not touch alternate', primary.ok && alternate.ok && alternate.value === '+919878822213');
}
{
  const alternate = resolvePhoneFieldUpdate('', '+919878822213');
  const primary = resolvePhoneFieldUpdate('+919878822213', '+919878822213');
  report('clearing alternate keeps primary', alternate.ok && alternate.value === '' && primary.ok && primary.value === '+919878822213');
}

/* ── VCF ────────────────────────────────────────────────────────────────── */

section('VCF export');
const baseCard = {
  _id: 'card-1',
  urlAlias: 'card-1',
  name: 'Test Card',
  basic: { firstName: 'Test', lastName: 'Card' },
};
{
  const vcf = buildVcf({ ...baseCard, basic: { ...baseCard.basic, phone: '9878822213' } }, 'https://example.com');
  equal('legacy bare 10-digit exported with +91', telLines(vcf)[0], 'TEL;TYPE=CELL,VOICE:+919878822213');
}
{
  const vcf = buildVcf({ ...baseCard, basic: { ...baseCard.basic, phone: '+919878822213' } }, 'https://example.com');
  report('stored +91 not duplicated in VCF', telLines(vcf)[0] === 'TEL;TYPE=CELL,VOICE:+919878822213');
}
{
  const vcf = buildVcf({ ...baseCard, basic: { ...baseCard.basic, phone: '+12025550123' } }, 'https://example.com');
  equal('international VCF preserved', telLines(vcf)[0], 'TEL;TYPE=CELL,VOICE:+12025550123');
}
{
  const vcf = buildVcf(
    { ...baseCard, basic: { ...baseCard.basic, phone: '9878822213', alternatePhone: '+447700900123' } },
    'https://example.com'
  );
  const lines = telLines(vcf);
  report(
    'primary and alternate export independently',
    lines.length === 2 &&
      lines[0] === 'TEL;TYPE=CELL,VOICE:+919878822213' &&
      lines[1] === 'TEL;TYPE=CELL,VOICE:+447700900123'
  );
}
{
  const vcf = buildVcf({ ...baseCard, basic: { ...baseCard.basic, phone: '9878822213', alternatePhone: '' } }, 'https://example.com');
  report('empty alternate omitted', telLines(vcf).length === 1);
}
{
  const vcf = buildVcf({ ...baseCard, basic: { ...baseCard.basic, phone: '+91 99 74 99 2213' } }, 'https://example.com');
  equal('marketing-style formatted value normalised', telLines(vcf)[0], 'TEL;TYPE=CELL,VOICE:+919974992213');
}
{
  const vcf = buildVcf({ ...baseCard, basic: { ...baseCard.basic, phone: 'n/a' } }, 'https://example.com');
  equal('unparseable value exported verbatim (no fabrication)', telLines(vcf)[0], 'TEL;TYPE=CELL,VOICE:n/a');
}
{
  const vcf = buildVcf({ ...baseCard, basic: { ...baseCard.basic, phone: '' } }, 'https://example.com');
  report('empty primary omitted', telLines(vcf).length === 0);
}
equal('vcfPhone canonical', vcfPhone('9878822213'), '+919878822213');

/* ── Product enquiry WhatsApp ───────────────────────────────────────────── */

section('Product enquiry WhatsApp');
{
  const url = buildWhatsAppEnquiryUrl('9878822213', { productName: 'Service', alias: 'card-1' });
  report('legacy bare 10-digit enquiry has +91', Boolean(url && url.startsWith('https://wa.me/919878822213?')));
}
{
  const url = buildWhatsAppEnquiryUrl('+12025550123', { productName: 'Service', alias: 'card-1' });
  report('international enquiry preserved', Boolean(url && url.startsWith('https://wa.me/12025550123?')));
}
equal('empty phone has no enquiry link', buildWhatsAppEnquiryUrl('', { productName: 'Service', alias: 'card-1' }), null);
equal('invalid phone has no enquiry link', buildWhatsAppEnquiryUrl('n/a', { productName: 'Service', alias: 'card-1' }), null);

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
