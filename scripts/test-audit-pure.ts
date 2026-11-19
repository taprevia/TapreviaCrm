/**
 * Phase audit pure regression checks for the safe repair set.
 */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { isBcryptHash } from '@/models/User';
import { updateProductConfigSchema } from '@/lib/validation/product-config';
import { getPublicProductSlug, RESERVED_PUBLIC_SEGMENTS } from '@/lib/services/human-url';
import { resolveCanonicalProductId } from '@/lib/services/product-identity';
import {
  CARD_TEMPLATE_META,
  DEFAULT_TEMPLATE_KEY,
  defaultThemeForTemplate,
  isRegisteredTemplate,
  resolveTemplateThemeChange,
  safeTemplateKey,
} from '@/lib/card-templates';

// This runner compiles TSX with the classic JSX runtime, so React must exist
// before the component registry is loaded. Test-only; no app code is affected.
const nodeRequire = createRequire(process.cwd() + '/');
const React = nodeRequire('react') as typeof import('react');
(globalThis as { React?: typeof React }).React = React;
const { CARD_TEMPLATES } = nodeRequire(
  '@/components/public/template-registry',
) as typeof import('@/components/public/template-registry');

const metaKeys = CARD_TEMPLATE_META.map((t) => t.key);
const componentKeys = Object.keys(CARD_TEMPLATES);

let checks = 0;
let failures = 0;
function check(name: string, fn: () => void) {
  checks += 1;
  try { fn(); console.log(`PASS ${name}`); }
  catch (error) { failures += 1; console.log(`FAIL ${name} — ${error instanceof Error ? error.message : String(error)}`); }
}

check('blank WhatsApp is accepted as a clear operation', () => {
  const parsed = updateProductConfigSchema.safeParse({ whatsapp: { phoneNumber: '', defaultMessage: '' } });
  assert.equal(parsed.success, true);
});
check('invalid short WhatsApp is still rejected', () => {
  const parsed = updateProductConfigSchema.safeParse({ whatsapp: { phoneNumber: '123', defaultMessage: '' } });
  assert.equal(parsed.success, false);
});
check('valid WhatsApp is accepted', () => {
  const parsed = updateProductConfigSchema.safeParse({ whatsapp: { phoneNumber: '+919876543210', defaultMessage: 'Hi' } });
  assert.equal(parsed.success, true);
});
check('legacy premium-card slug canonicalizes and allocates public slug', () => {
  assert.equal(resolveCanonicalProductId('premium-card'), 'PREMIUM_NFC_CARD');
  assert.equal(getPublicProductSlug('premium-card'), 'premium-card');
});
check('standee-review is reserved from business slug allocation', () => {
  assert.equal(RESERVED_PUBLIC_SEGMENTS.has('standee-review'), true);
  assert.equal(RESERVED_PUBLIC_SEGMENTS.has('contacts'), true);
});
check('full bcrypt hashes are recognized; prefixes are not', () => {
  assert.equal(isBcryptHash('$2b$12$' + 'a'.repeat(53)), true);
  assert.equal(isBcryptHash('$2b$12$'), false);
  assert.equal(isBcryptHash('$2b$not-a-full-hash'), false);
});
check('template metadata and component registry keys stay in parity', () => {
  assert.deepEqual([...metaKeys].sort(), [...componentKeys].sort());
  assert.ok(componentKeys.every((key) => isRegisteredTemplate(key)));
});
check('default template key is present in both registries', () => {
  assert.ok(metaKeys.includes(DEFAULT_TEMPLATE_KEY));
  assert.ok(componentKeys.includes(DEFAULT_TEMPLATE_KEY));
});
check('safeTemplateKey keeps valid, missing, unknown and legacy fallback behavior', () => {
  assert.equal(safeTemplateKey(metaKeys[0]), metaKeys[0]);
  assert.equal(safeTemplateKey(undefined), DEFAULT_TEMPLATE_KEY);
  assert.equal(safeTemplateKey(null), DEFAULT_TEMPLATE_KEY);
  assert.equal(safeTemplateKey('unknown-template'), DEFAULT_TEMPLATE_KEY);
  assert.equal(safeTemplateKey('modern-professional'), DEFAULT_TEMPLATE_KEY);
  assert.equal(safeTemplateKey('panthevent'), DEFAULT_TEMPLATE_KEY);
});
check('every registered template has a valid default palette', () => {
  for (const template of CARD_TEMPLATE_META) {
    const theme = defaultThemeForTemplate(template.key);
    assert.ok(theme, template.key);
    assert.match(theme.accentColor, /^#[0-9a-fA-F]{6}$/, template.key);
    assert.match(theme.bgColor, /^#[0-9a-fA-F]{6}$/, template.key);
  }
});
check('same-template selection never triggers a colour reset', () => {
  for (const template of CARD_TEMPLATE_META) {
    assert.equal(resolveTemplateThemeChange(template.key, template.key), null);
  }
});
check('explicit Royal Aura / Noir Elite switches apply registered defaults', () => {
  const noir = defaultThemeForTemplate('noir-elite')!;
  const royal = defaultThemeForTemplate('premium-purple')!;
  assert.deepEqual(resolveTemplateThemeChange('premium-purple', 'noir-elite'), {
    templateKey: 'noir-elite',
    themeConfig: noir,
  });
  assert.deepEqual(resolveTemplateThemeChange('noir-elite', 'premium-purple'), {
    templateKey: 'premium-purple',
    themeConfig: royal,
  });
});
check('switching to every registered template changes only key and palette', () => {
  for (const template of CARD_TEMPLATE_META) {
    const current = template.key === 'social' ? 'premium-purple' : 'social';
    const update = resolveTemplateThemeChange(current, template.key);
    assert.ok(update, template.key);
    assert.deepEqual(Object.keys(update).sort(), ['templateKey', 'themeConfig']);
    assert.equal(update.templateKey, template.key);
    assert.deepEqual(update.themeConfig, defaultThemeForTemplate(template.key));
  }
});
check('unknown or incomplete template palette is never guessed', () => {
  assert.equal(defaultThemeForTemplate('not-registered'), null);
  assert.equal(resolveTemplateThemeChange('noir-elite', 'not-registered'), null);
});
check('rapid switch sequence ends with the final registered palette', () => {
  let draft = {
    templateKey: 'premium-purple',
    themeConfig: defaultThemeForTemplate('premium-purple')!,
  };
  for (const key of ['noir-elite', 'panthi-event', 'social', 'premium-purple']) {
    const update = resolveTemplateThemeChange(draft.templateKey, key);
    assert.ok(update, key);
    draft = { templateKey: update.templateKey, themeConfig: update.themeConfig };
  }
  assert.equal(draft.templateKey, 'premium-purple');
  assert.deepEqual(draft.themeConfig, defaultThemeForTemplate('premium-purple'));
});

console.log('\n=== AUDIT PURE SUMMARY ===');
console.log(JSON.stringify({ checks, passed: checks - failures, failed: failures }, null, 2));
process.exit(failures === 0 ? 0 : 1);
