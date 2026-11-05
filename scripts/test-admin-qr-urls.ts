/**
 * Admin QR/URL safety regression (pure; no database, no network).
 *
 * Verifies the local `next start` base URL allowance is limited to a local
 * browser, production/preview safety is preserved, and permanent QR payloads
 * always use `/r/{routeSlug|uid}` without falling back to a Public URL.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import QRCode from 'qrcode';
import { resolveCanonicalPublicBase } from '@/lib/public-base';
import {
  strictPermanentCardPath,
  strictPermanentCardUrl,
  legacyCardUrl,
  cardPublicQrPath,
} from '@/lib/admin-card-view';

const results: Array<{ name: string; pass: boolean; detail: string }> = [];
async function check(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    results.push({ name, pass: true, detail: 'ok' });
    console.log(`PASS ${name}`);
  } catch (error) {
    results.push({ name, pass: false, detail: error instanceof Error ? error.message : String(error) });
    console.log(`FAIL ${name} — ${results[results.length - 1].detail}`);
  }
}

async function main() {
  await check('local next start allows configured localhost in a local browser', () => {
    assert.equal(
      resolveCanonicalPublicBase({
        configured: 'http://localhost:3000',
        nodeEnv: 'production',
        browserHost: 'localhost',
      }),
      'http://localhost:3000'
    );
  });

  await check('production browser never accepts localhost base', () => {
    assert.equal(
      resolveCanonicalPublicBase({
        configured: 'http://localhost:3000',
        nodeEnv: 'production',
        browserHost: 'www.taprevia.com',
      }),
      ''
    );
  });

  await check('Vercel production never accepts localhost base even from localhost browser', () => {
    assert.equal(
      resolveCanonicalPublicBase({
        configured: 'http://localhost:3000',
        nodeEnv: 'production',
        vercelEnv: 'production',
        browserHost: 'localhost',
      }),
      ''
    );
  });

  await check('Preview still rejects localhost and HTTP', () => {
    assert.equal(
      resolveCanonicalPublicBase({
        configured: 'http://localhost:3000',
        nodeEnv: 'production',
        vercelEnv: 'preview',
        approvedPreviewHost: 'preview.taprevia.com',
        browserHost: 'localhost',
      }),
      ''
    );
  });

  await check('unsafe schemes and injected components are rejected', () => {
    for (const configured of [
      'javascript:alert(1)',
      'data:text/html,<script>alert(1)</script>',
      'http://user:pass@localhost:3000',
      'http://localhost:3000/path',
      'http://localhost:3000?x=1',
      'http://localhost:3000#x',
    ]) {
      assert.equal(
        resolveCanonicalPublicBase({
          configured,
          nodeEnv: 'production',
          browserHost: 'localhost',
        }),
        '',
        configured
      );
    }
  });

  await check('normal production custom domain remains accepted', () => {
    assert.equal(
      resolveCanonicalPublicBase({
        configured: 'https://www.taprevia.com/',
        nodeEnv: 'production',
        vercelEnv: 'production',
      }),
      'https://www.taprevia.com'
    );
  });

  await check('permanent QR payload always uses /r and never publicSlug', () => {
    assert.equal(strictPermanentCardPath({ routeSlug: 'abc123' }), '/r/abc123');
    assert.equal(
      strictPermanentCardUrl(
        { routeSlug: 'abc123', publicSlug: 'business/product' },
        'http://localhost:3000'
      ),
      'http://localhost:3000/r/abc123'
    );
    assert.equal(
      strictPermanentCardPath({ publicSlug: 'business/product', urlAlias: 'alias' }),
      null
    );
    assert.equal(
      strictPermanentCardUrl({ publicSlug: 'business/product' }, 'http://localhost:3000'),
      null
    );
  });

  await check('legacy fallback remains explicitly non-permanent', () => {
    assert.equal(
      legacyCardUrl(
        { publicSlug: 'business/product', urlAlias: 'alias', slug: 'legacy-slug' },
        'http://localhost:3000'
      ),
      'http://localhost:3000/c/legacy-slug'
    );
    assert.equal(
      cardPublicQrPath({ routeSlug: 'route', publicSlug: 'business/product' }),
      '/r/route'
    );
  });

  await check('admin page wires clickable permanent/public links and QR images', () => {
    const page = readFileSync('src/app/(admin)/admin/users/[id]/page.tsx', 'utf8');
    assert.match(page, /target="_blank" rel="noopener noreferrer"/);
    assert.match(page, /cardQrPayload\(c, publicBaseUrl\)/);
    assert.match(page, /standeeQrUrl\(standee, 'panel'\)/);
    assert.match(page, /standeeQrUrl\(standee, 'social', index\)/);
    assert.match(page, /standeeQrDataUrls\[`panel:\$\{standee\._id\}`\]/);
    assert.match(page, /standeeQrDataUrls\[`social:\$\{standee\._id\}:\$\{index\}`\]/);
    assert.match(page, /permanentEntryUrl/);
    assert.match(page, /canonicalPublicUrl/);
    assert.match(page, /rel="noopener noreferrer"/);
  });

  await check('QR generation succeeds for permanent card and standee payloads', async () => {
    const cardQr = await QRCode.toDataURL('http://localhost:3000/r/card-route', { width: 128 });
    const standeeQr = await QRCode.toDataURL('http://localhost:3000/r/standee-route/1', { width: 128 });
    assert.ok(cardQr.startsWith('data:image/png'));
    assert.ok(standeeQr.startsWith('data:image/png'));
  });

  const passed = results.filter((r) => r.pass).length;
  console.log(`\n=== ADMIN QR/URL SAFETY ===`);
  console.log(JSON.stringify({ checks: results.length, passed, failed: results.length - passed, failures: results.filter((r) => !r.pass) }, null, 2));
  process.exit(passed === results.length ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
