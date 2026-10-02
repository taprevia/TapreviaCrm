/**
 * seed-panthevent-sparse.ts — one-off seed for the EMPTY/PARTIAL data state:
 * a panthevent card with NO phone, NO products, NO services, NO gallery, NO
 * socials and no rich bio. Proves the production-grade graceful degradation
 * renders (no broken/empty sections, no dead WhatsApp funnel).
 */
import mongoose from 'mongoose';
import Card from '../src/models/Card';
import User from '../src/models/User';

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/nfc-crm';
const SPARSE_ALIAS = 'panthi-sparse';

async function seed() {
  await mongoose.connect(MONGODB_URI);
  const owner = await User.findOne({ email: 'demo.panthi@taprevia.com' });
  if (!owner) {
    console.error('demo owner missing; run seed-panthevent-demo.ts first');
    process.exit(1);
  }
  await Card.findOneAndUpdate(
    { cardUid: 'DEMO-PANTHI-SPARSE' },
    {
      $set: {
        cardUid: 'DEMO-PANTHI-SPARSE',
        slug: SPARSE_ALIAS,
        routeSlug: SPARSE_ALIAS,
        urlAlias: SPARSE_ALIAS,
        status: 'active',
        setupComplete: true,
        isActive: true,
        kind: 'profile',
        templateKey: 'panthevent',
        name: 'Sparse Profile',
        descriptionHtml: '',
        coverType: 'color',
        coverValue: '',
        profileImageUrl: '',
        galleryImages: [],
        services: [],
        socialLinks: [],
        basic: {
          firstName: 'Sparse',
          lastName: 'Profile',
          email: '',
          alternateEmail: '',
          phone: '',
          alternatePhone: '',
          company: '',
          jobTitle: '',
          defaultLanguage: 'en',
        },
        assignedUserId: owner._id,
        userId: owner._id,
        reviewAssistant: { enabled: false },
      },
    },
    { upsert: true, new: true }
  );
  console.log(`Sparse card seeded -> /profile/${SPARSE_ALIAS}`);
  process.exit(0);
}

seed();