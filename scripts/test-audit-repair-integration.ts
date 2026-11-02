/**
 * Focused synthetic integration tests for audit repair set.
 * Refuses any non-isolated target; drops only the disposable audit DB.
 */
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import User, { isBcryptHash } from '@/models/User';
import CatalogProduct from '@/models/CatalogProduct';
import Card from '@/models/Card';
import Profile from '@/models/Profile';
import UserProduct from '@/models/UserProduct';
import ReviewCategory from '@/models/ReviewCategory';
import ReviewTemplate from '@/models/ReviewTemplate';
import { assignUserProduct } from '@/lib/services/user-product-assignment';
import { getReviewTemplateSuggestions } from '@/lib/services/review-templates';
import { ensureCardPublicSlug } from '@/lib/services/human-url';

const URI = process.env.MONGODB_URI ?? '';
const DB = process.env.MONGODB_DB ?? '';
if (!URI.includes('127.0.0.1:27019') || !DB.startsWith('taprevia_audit_')) {
  throw new Error(`Refusing non-isolated audit target: ${URI} / ${DB}`);
}

const results: Array<{ name: string; pass: boolean; detail: string }> = [];
function check(name: string, pass: boolean, detail: string) {
  results.push({ name, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'} ${name} — ${detail}`);
}

async function main() {
  await mongoose.connect(URI);
  await mongoose.connection.dropDatabase();

  const user = await User.create({
    name: 'Audit User',
    email: 'audit-user@phase-audit.invalid',
    passwordHash: 'audit-pass-123',
    role: 'customer',
    status: 'active',
  });
  const productA = await CatalogProduct.create({
    name: 'Audit Profile Card',
    slug: 'audit-profile-card',
    category: 'card',
    kind: 'profile',
    active: true,
  });
  const productB = await CatalogProduct.create({
    name: 'Audit Review Card',
    slug: 'audit-review-card',
    category: 'card',
    kind: 'review',
    active: true,
  });

  const first = await assignUserProduct({
    user,
    catalogItem: productA,
    quantity: 1,
    cardUid: 'AUDITUID001',
    assignedBy: user._id,
  });
  check('first card assignment succeeds', first.ok, first.ok ? 'ok' : first.error);
  const card = await Card.findOne({ cardUid: 'AUDITUID001' });
  assert.ok(card);
  const kindBefore = card.kind;

  const duplicate = await assignUserProduct({
    user,
    catalogItem: productB,
    quantity: 1,
    cardUid: 'AUDITUID001',
    assignedBy: user._id,
  });
  check('duplicate card assignment rejected with 409', !duplicate.ok && duplicate.status === 409, duplicate.ok ? 'unexpected success' : String(duplicate.status));
  const cardAfter = await Card.findOne({ cardUid: 'AUDITUID001' });
  check('rejected duplicate did not mutate Card.kind', cardAfter?.kind === kindBefore, `${kindBefore} -> ${cardAfter?.kind}`);

  const prefixed = await User.create({
    name: 'Audit Prefix User',
    email: 'audit-prefix@phase-audit.invalid',
    passwordHash: '$2b$not-a-complete-hash',
    role: 'customer',
    status: 'active',
  });
  const prefixedOk = isBcryptHash(prefixed.passwordHash) && (await prefixed.comparePassword('$2b$not-a-complete-hash'));
  check('bcrypt hook hashes a prefix-like plaintext password', prefixedOk, `hashPrefix=${prefixed.passwordHash.slice(0, 7)}`);

  await ReviewCategory.create({
    key: 'audit-cafe',
    name: 'Audit Cafe',
    active: true,
    languages: ['English'],
    scenarios: [{ key: 'service', name: 'Service' }],
  });
  await ReviewTemplate.create({
    key: 'audit-cafe-service',
    categoryKey: 'audit-cafe',
    scenario: 'service',
    language: 'English',
    text: 'Great service at {businessName}.',
    length: 'medium',
    style: 'friendly',
    variables: ['businessName'],
    active: true,
  });
  const suggestions = await getReviewTemplateSuggestions({
    card: {
      name: 'Audit Business',
      reviewAssistant: {
        enabled: true,
        category: 'Audit-Cafe',
        languages: ['English'],
        preferredLength: 'medium',
        writingStyle: 'friendly',
      },
    },
    language: 'English',
  });
  check('mixed-case review category resolves templates', suggestions.length > 0 && suggestions[0].text.includes('Audit Business'), `${suggestions.length} suggestion(s)`);

  // B7: public slug allocation must use the ACTIVE assignment, not a removed one.
  const b7User = await User.create({
    name: 'Audit Slug User',
    email: 'audit-slug@phase-audit.invalid',
    passwordHash: 'audit-pass-456',
    role: 'customer',
    status: 'active',
    bizSlug: 'audit-b7-business',
  });
  await Profile.create({ userId: b7User._id, companyInfo: { companyName: 'Audit B7 Business' } });
  const oldProduct = await CatalogProduct.create({
    name: 'Audit Old Review', slug: 'google-review-card', category: 'card', kind: 'review', active: true,
  });
  const newProduct = await CatalogProduct.create({
    name: 'Audit New Profile', slug: 'business-nfc-card', category: 'card', kind: 'profile', active: true,
  });
  const b7Card = await Card.create({
    cardUid: 'AUDITB7001', slug: 'audit-b7-card', routeSlug: 'audit-b7-route', uid: 'audit-b7-uid',
    kind: 'profile', status: 'active', isActive: true, userId: b7User._id, assignedUserId: b7User._id,
  });
  await UserProduct.create({ userId: b7User._id, catalogProductId: oldProduct._id, cardId: b7Card._id, quantity: 1, status: 'removed' });
  await UserProduct.create({ userId: b7User._id, catalogProductId: newProduct._id, cardId: b7Card._id, quantity: 1, status: 'active' });
  const slugResult = await ensureCardPublicSlug(b7Card._id, b7User._id);
  const b7After = await Card.findById(b7Card._id).lean<{ publicSlug?: string } | null>();
  check('public slug uses active assignment, not removed assignment', slugResult.assigned && (b7After?.publicSlug ?? '').includes('business-card'), b7After?.publicSlug ?? 'missing');

  const failures = results.filter((r) => !r.pass);
  console.log('\n=== AUDIT INTEGRATION SUMMARY ===');
  console.log(JSON.stringify({ checks: results.length, passed: results.length - failures.length, failed: failures.length, failures }, null, 2));
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
  process.exit(failures.length === 0 ? 0 : 1);
}

main().catch(async (error) => {
  console.error(error);
  await mongoose.connection.dropDatabase().catch(() => undefined);
  await mongoose.disconnect().catch(() => undefined);
  process.exit(1);
});
