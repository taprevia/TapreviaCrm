/**
 * PPL-02 regression test — one permanent URL + one public URL, both immutable.
 *
 * Pure + isolated-DB coverage:
 *   - routeSlug/uid/publicSlug/urlAlias are allocated at customer creation.
 *   - publicSlug is derived from the explicit business slug and is unique.
 *   - reserved business slugs are disambiguated, never raw-reserved.
 *   - allocation is idempotent (never regenerates identifiers).
 *   - update helpers reject changed identifiers but allow identical values.
 *   - updateCardSchema no longer accepts urlAlias.
 *   - builder UI is read-only and no longer probes/edits the alias.
 *
 * Write tests require an isolated DB name prefixed `ppl02_`.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import mongoose from 'mongoose';
import { connectDB } from '@/lib/db';
import Card from '@/models/Card';
import CatalogProduct from '@/models/CatalogProduct';
import Profile from '@/models/Profile';
import User from '@/models/User';
import UserProduct from '@/models/UserProduct';
import { createCustomerWithProducts } from '@/lib/services/customer-creation';
import { ensureCardPublicSlug } from '@/lib/services/human-url';
import { updateCardSchema } from '@/lib/validation/card';
import {
  CARD_IMMUTABLE_URL_FIELDS,
  findImmutableStandeeChange,
  findImmutableUrlChange,
} from '@/lib/services/url-identity';

let passed = 0;
let failed = 0;
const failures: string[] = [];

function check(name: string, fn: () => void): void {
  try {
    fn();
    passed += 1;
    console.log(`PASS ${name}`);
  } catch (error) {
    failed += 1;
    const message = error instanceof Error ? error.message : String(error);
    failures.push(`${name}: ${message}`);
    console.log(`FAIL ${name} — ${message}`);
  }
}

const root = process.cwd();

/* ── 1. Pure immutability helper ───────────────────────────────────────── */

const stored = {
  routeSlug: 'route-abc',
  uid: 'route-abc',
  publicSlug: 'acme/premium-card',
  urlAlias: 'acme-alias',
  slug: 'acme-alias',
};

check('changed permanent identifier is rejected', () => {
  const change = findImmutableUrlChange(
    { routeSlug: 'route-other' },
    stored,
    CARD_IMMUTABLE_URL_FIELDS
  );
  assert.deepEqual(change, { field: 'routeSlug', current: 'route-abc', incoming: 'route-other' });
});

check('changed public alias is rejected', () => {
  const change = findImmutableUrlChange(
    { urlAlias: 'new-alias' },
    stored,
    CARD_IMMUTABLE_URL_FIELDS
  );
  assert.equal(change?.field, 'urlAlias');
});

check('identical identifier is accepted (idempotent legacy client)', () => {
  assert.equal(
    findImmutableUrlChange(
      { routeSlug: 'route-abc', urlAlias: 'acme-alias', publicSlug: 'acme/premium-card' },
      stored,
      CARD_IMMUTABLE_URL_FIELDS
    ),
    null
  );
});

check('clearing an existing identifier is rejected', () => {
  const change = findImmutableUrlChange(
    { publicSlug: '' },
    stored,
    CARD_IMMUTABLE_URL_FIELDS
  );
  assert.equal(change?.field, 'publicSlug');
});

check('unrelated payload is accepted', () => {
  assert.equal(
    findImmutableUrlChange({ name: 'New name', config: { hideStickyBar: true } }, stored, CARD_IMMUTABLE_URL_FIELDS),
    null
  );
});

check('standee slot qrId/platform changes are rejected but destination changes pass', () => {
  const standee = {
    routeSlug: 'standee-route',
    uid: 'standee-route',
    publicSlug: 'acme/standee',
    panelQr: { qrId: 'panel-1' },
    socialQrs: [{ qrId: 'slot-1', platform: 'instagram', destinationUrl: 'https://a.test' }],
  };
  assert.equal(findImmutableStandeeChange({ routeSlug: 'other' }, standee)?.field, 'routeSlug');
  assert.equal(findImmutableStandeeChange({ panelQr: { qrId: 'panel-2' } }, standee)?.field, 'panelQr.qrId');
  assert.equal(
    findImmutableStandeeChange({ socialQrs: [{ qrId: 'slot-2', platform: 'instagram' }] }, standee)?.field,
    'socialQrs.0.qrId'
  );
  assert.equal(
    findImmutableStandeeChange(
      { socialQrs: [{ qrId: 'slot-1', platform: 'instagram', destinationUrl: 'https://b.test' }] },
      standee
    ),
    null
  );
});

/* ── 2. Update schema / source wiring ──────────────────────────────────── */

check('updateCardSchema no longer accepts urlAlias', () => {
  const parsed = updateCardSchema.parse({ name: 'N', urlAlias: 'changed-alias' });
  assert.equal('urlAlias' in parsed, false);
});

const cardPatch = readFileSync(path.join(root, 'src/app/api/cards/[id]/route.ts'), 'utf8');
check('card PATCH guards immutable identifiers', () => {
  assert.match(cardPatch, /findImmutableUrlChange/);
  assert.match(cardPatch, /CARD_IMMUTABLE_URL_FIELDS/);
  assert.doesNotMatch(cardPatch, /card\.urlAlias\s*=/);
});

const configRoute = readFileSync(
  path.join(root, 'src/app/api/my/products/[id]/config/route.ts'),
  'utf8'
);
check('product config guards card and standee identifiers', () => {
  assert.match(configRoute, /findImmutableUrlChange\(/);
  assert.match(configRoute, /findImmutableStandeeChange\(/);
});

const replaceRoute = readFileSync(
  path.join(root, 'src/app/api/admin/users/[id]/products/[userProductId]/card/route.ts'),
  'utf8'
);
check('admin card replacement rejects URL identifier fields', () => {
  assert.match(replaceRoute, /CARD_IMMUTABLE_URL_FIELDS/);
  assert.match(replaceRoute, /cannot be changed by card replacement/);
});

const basicTab = readFileSync(
  path.join(root, 'src/components/builder/tabs/basic-tab.tsx'),
  'utf8'
);
check('builder Profile URL is read-only', () => {
  assert.match(basicTab, /id="basic-urlAlias"[\s\S]{0,400}readOnly/);
  assert.doesNotMatch(basicTab, /check-alias/);
  assert.doesNotMatch(basicTab, /setField\('urlAlias'/);
});

/* ── 3. Isolated DB: creation allocates both identities ────────────────── */

const STAMP = Date.now().toString(36);
const createdUserIds: string[] = [];
const createdCardIds: string[] = [];

async function cleanup(): Promise<void> {
  for (const id of createdCardIds) await Card.deleteOne({ _id: id }).catch(() => undefined);
  for (const id of createdUserIds) {
    await UserProduct.deleteMany({ userId: id }).catch(() => undefined);
    await Profile.deleteMany({ userId: id }).catch(() => undefined);
    await User.deleteOne({ _id: id }).catch(() => undefined);
  }
}

async function main(): Promise<void> {
  const dbName = process.env.MONGODB_DB ?? '';
  if (!dbName.startsWith('ppl02_')) {
    console.error(`Refusing to run: MONGODB_DB must start with ppl02_ (got "${dbName}")`);
    process.exit(2);
  }

  await connectDB();

  const catalog = await CatalogProduct.create({
    name: 'PPL-02 Premium NFC Card',
    // Canonical catalog slug so publicSlug resolution uses premium-card.
    slug: 'premium-nfc-card',
    category: 'card',
    kind: 'profile',
    active: true,
  });

  try {
    const base = `ppl02biz${STAMP}`;
    const first = await createCustomerWithProducts({
      name: 'PPL02 First',
      email: `ppl02-first-${STAMP}@test.local`,
      password: 'secret-password',
      urlSlug: base,
      products: [{ catalogProductId: catalog._id.toString() }],
      assignedBy: new mongoose.Types.ObjectId().toString(),
    });
    assert.equal(first.ok, true, first.ok ? '' : first.error);
    if (!first.ok) return;

    const user = first.data.user as { _id: string; bizSlug?: string };
    createdUserIds.push(user._id);
    const card = await Card.findOne({ userId: user._id });
    assert.ok(card, 'card not created');
    createdCardIds.push(card!._id.toString());

    check('customer creation allocates routeSlug', () => {
      assert.ok(card!.routeSlug && card!.routeSlug.length > 0);
    });
    check('route uid mirrors routeSlug', () => {
      assert.equal(card!.uid, card!.routeSlug);
    });
    check('customer creation allocates immutable publicSlug from explicit base', () => {
      assert.equal(card!.publicSlug, `${base}/premium-card`);
    });
    check('customer creation allocates urlAlias', () => {
      assert.ok(card!.urlAlias && card!.urlAlias.length > 0);
      assert.equal(card!.urlAlias, card!.slug);
    });
    check('two identifiers are distinct concepts', () => {
      assert.notEqual(card!.routeSlug, card!.publicSlug);
      assert.notEqual(card!.publicSlug, card!.urlAlias);
    });

    const before = {
      routeSlug: card!.routeSlug,
      uid: card!.uid,
      publicSlug: card!.publicSlug,
      urlAlias: card!.urlAlias,
      slug: card!.slug,
    };
    const again = await ensureCardPublicSlug(card!._id, user._id);
    check('publicSlug allocation is idempotent (never regenerated)', () => {
      assert.equal(again.assigned, true);
      assert.equal(again.publicSlug, before.publicSlug);
    });
    const after = await Card.findById(card!._id).lean<Record<string, unknown> | null>();
    check('all permanent/public identifiers survive re-allocation', () => {
      assert.deepEqual(
        {
          routeSlug: after?.routeSlug,
          uid: after?.uid,
          publicSlug: after?.publicSlug,
          urlAlias: after?.urlAlias,
          slug: after?.slug,
        },
        before
      );
    });

    const reserved = await createCustomerWithProducts({
      name: 'PPL02 Reserved',
      email: `ppl02-reserved-${STAMP}@test.local`,
      password: 'secret-password',
      urlSlug: 'admin',
      products: [{ catalogProductId: catalog._id.toString() }],
      assignedBy: new mongoose.Types.ObjectId().toString(),
    });
    assert.equal(reserved.ok, true, reserved.ok ? '' : reserved.error);
    if (reserved.ok) {
      const reservedUser = reserved.data.user as { _id: string; bizSlug?: string };
      createdUserIds.push(reservedUser._id);
      const reservedCard = await Card.findOne({ userId: reservedUser._id });
      if (reservedCard) createdCardIds.push(reservedCard._id.toString());
      check('reserved business slug is disambiguated, never raw-reserved', () => {
        assert.ok(reservedUser.bizSlug && reservedUser.bizSlug.startsWith('admin-'));
        assert.notEqual(reservedUser.bizSlug, 'admin');
      });
      check('reserved slug still yields an immutable public URL', () => {
        assert.ok(reservedCard?.publicSlug?.startsWith(`${reservedUser.bizSlug}/`));
      });
    }

    const duplicateBase = await createCustomerWithProducts({
      name: 'PPL02 Duplicate',
      email: `ppl02-dup-${STAMP}@test.local`,
      password: 'secret-password',
      urlSlug: base,
      products: [{ catalogProductId: catalog._id.toString() }],
      assignedBy: new mongoose.Types.ObjectId().toString(),
    });
    assert.equal(duplicateBase.ok, true, duplicateBase.ok ? '' : duplicateBase.error);
    if (duplicateBase.ok) {
      const dupUser = duplicateBase.data.user as { _id: string; bizSlug?: string };
      createdUserIds.push(dupUser._id);
      const dupCard = await Card.findOne({ userId: dupUser._id });
      if (dupCard) createdCardIds.push(dupCard._id.toString());
      check('duplicate business slug is allocated a distinct suffix', () => {
        assert.equal(dupUser.bizSlug, `${base}-2`);
      });
      check('duplicate base receives a different publicSlug', () => {
        assert.notEqual(dupCard?.publicSlug, card!.publicSlug);
      });
    }

    check('stored identifiers match the immutable guard snapshot', () => {
      assert.equal(
        findImmutableUrlChange(
          {
            routeSlug: card!.routeSlug,
            uid: card!.uid,
            publicSlug: card!.publicSlug,
            urlAlias: card!.urlAlias,
            slug: card!.slug,
          },
          card as unknown as Record<string, unknown>,
          CARD_IMMUTABLE_URL_FIELDS
        ),
        null
      );
    });
  } finally {
    await cleanup();
    await CatalogProduct.deleteOne({ _id: catalog._id }).catch(() => undefined);
    await mongoose.disconnect().catch(() => undefined);
  }

  console.log(`\nPPL-02 immutable URL test: ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    console.log('Failures:');
    for (const failure of failures) console.log(`  - ${failure}`);
    process.exit(1);
  }
}

main().catch(async (error) => {
  console.error(error);
  await cleanup();
  await mongoose.disconnect().catch(() => undefined);
  process.exit(1);
});
