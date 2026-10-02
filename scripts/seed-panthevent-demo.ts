/**
 * seed-panthevent-demo.ts — idempotent seed for a fully-populated
 * "panthevent" template demo card used for sales-demo / render-proving the
 * production-grade plumbing (empty-data gating exercised in reverse: every
 * section fully populated, WhatsApp funnel active).
 *
 * Usage:
 *   npx tsx scripts/seed-panthevent-demo.ts
 */
import mongoose from 'mongoose';
import Card from '../src/models/Card';
import Product from '../src/models/Product';
import User from '../src/models/User';

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/nfc-crm';

const DEMO_ALIAS = 'panthievent-demo';
const DEMO_USER_EMAIL = 'demo.panthi@taprevia.com';

const IMG = {
  hero: 'https://picsum.photos/seed/panthihero/896/352',
  avatar: 'https://picsum.photos/seed/panthiavatar/224/224',
};

const DEMO_PRODUCTS: Array<{ title: string; description: string; imageUrl: string }> = [
  {
    title: 'Wedding Photography',
    description: 'Cinematic wedding coverage with same-day preview reels.',
    imageUrl: 'https://picsum.photos/seed/weddingp1/600/450',
  },
  {
    title: 'Destination Wedding',
    description: 'End-to-end destination planning across India.',
    imageUrl: 'https://picsum.photos/seed/weddingp2/600/450',
  },
  {
    title: 'Corporate Events',
    description: 'Conferences, launches and annual days that impress.',
    imageUrl: 'https://picsum.photos/seed/corp3/600/450',
  },
  {
    title: 'Birthday Parties',
    description: 'Themed birthday celebrations for every age.',
    imageUrl: 'https://picsum.photos/seed/bday4/600/450',
  },
];

const DEMO_SERVICES = [
  'Event Planning',
  'Wedding Event',
  'Corporate Event',
  'Pre-Post Event',
  'Brand activities',
  'Birthday Party',
  'Anniversary',
];

const DEMO_GALLERY = [
  'https://picsum.photos/seed/g1/400/400',
  'https://picsum.photos/seed/g2/400/400',
  'https://picsum.photos/seed/g3/400/400',
  'https://picsum.photos/seed/g4/400/400',
  'https://picsum.photos/seed/g5/400/400',
  'https://picsum.photos/seed/g6/400/400',
];

async function seed() {
  try {
    await mongoose.connect(MONGODB_URI);
    console.log(`Connected to ${MONGODB_URI}`);

    // ── Owner ─────────────────────────────────────────────────────────────
    let owner = await User.findOne({ email: DEMO_USER_EMAIL });
    if (!owner) {
      owner = await User.create({
        name: 'Panthi Event',
        email: DEMO_USER_EMAIL,
        passwordHash: 'x',
        role: 'customer',
        status: 'active',
      });
      console.log(`Created demo owner ${DEMO_USER_EMAIL}`);
    }

    // ── Card ──────────────────────────────────────────────────────────────
    const card = await Card.findOneAndUpdate(
      { cardUid: 'DEMO-PANTHI-01' },
      {
        $set: {
          cardUid: 'DEMO-PANTHI-01',
          slug: DEMO_ALIAS,
          routeSlug: DEMO_ALIAS,
          urlAlias: DEMO_ALIAS,
          status: 'active',
          setupComplete: true,
          isActive: true,
          kind: 'profile',
          templateKey: 'panthevent',
          name: 'Panthi Event',
          occupation: 'Event Planner',
          descriptionHtml:
            '<p>We craft <strong>unforgettable celebrations</strong> — from intimate birthdays to grand destination weddings. One team, one vision, flawless execution.</p><ul><li>360° planning under one roof</li><li>Top-tier décor &amp; catering partners</li><li>Serving 500+ events since 2012</li></ul>',
          coverType: 'image',
          coverValue: IMG.hero,
          profileImageUrl: IMG.avatar,
          galleryImages: DEMO_GALLERY.map((imageUrl) => ({ imageUrl, caption: '' })),
          services: DEMO_SERVICES.map((title) => ({ title, description: '' })),
          socialLinks: [
            { platform: 'instagram', url: 'https://instagram.com/panthievent', label: '' },
            { platform: 'facebook', url: 'https://facebook.com/panthievent', label: '' },
            { platform: 'youtube', url: 'https://youtube.com/@panthievent', label: '' },
            { platform: 'website', url: 'https://panthevents.in', label: '' },
          ],
          basic: {
            firstName: 'Panthi',
            lastName: 'Event',
            email: 'hello@panthievents.in',
            alternateEmail: '',
            phone: '+91 98765 43210',
            alternatePhone: '',
            company: 'Panthi Event',
            jobTitle: 'Founder & Lead Planner',
            defaultLanguage: 'en',
          },
          assignedUserId: owner._id,
          userId: owner._id,
          reviewAssistant: {
            enabled: true,
            googleReviewUrl: 'https://maps.google.com/?cid=panthievent',
            writingStyle: 'friendly',
            preferredLength: 'medium',
            languages: ['English'],
            feedbackTopics: ['weddings', 'corporate'],
            welcomeMessage: 'Tell us about your event!',
          },
        },
      },
      { upsert: true, new: true }
    );

    // ── Products ──────────────────────────────────────────────────────────
    await Product.deleteMany({ cardId: card._id });
    const docs = DEMO_PRODUCTS.map((p, i) => ({
      cardId: card._id,
      userId: owner._id,
      title: p.title,
      description: p.description,
      imageUrl: p.imageUrl,
      priceMinor: 0,
      currency: 'INR',
      category: 'package',
      active: true,
      sortOrder: i + 1,
    }));
    await Product.insertMany(docs);
    console.log(`Seeded ${docs.length} products for ${DEMO_ALIAS}`);

    console.log(`\nDemo URL: /profile/${DEMO_ALIAS}`);
    console.log(`Owner: ${DEMO_USER_EMAIL}`);
    console.log('Seed completed successfully');
    process.exit(0);
  } catch (error) {
    console.error('Seed failed:', error);
    process.exit(1);
  }
}

seed();