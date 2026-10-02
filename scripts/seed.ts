import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import CatalogProduct from '../src/models/CatalogProduct';
import User from '../src/models/User';
import { ALL_PRODUCT_IDS, PRODUCT_CATALOG, type ProductId } from '../src/config/products';

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/nfc-crm';

/**
 * Map each product to its software experience kind (the value stored on
 * CatalogProduct and used to derive the allocated Card.kind):
 *  - profile → a full business profile page
 *  - social  → a single dynamic redirect to a configured platform
 *  - review  → the AI Google-review flow
 *  - standee → a counter standee (not a Card)
 */
const KIND_BY_PRODUCT: Record<ProductId, string> = {
  BUSINESS_NFC_CARD: 'profile',
  PREMIUM_NFC_CARD: 'profile',
  INSTA_CARD: 'social',
  GOOGLE_REVIEW_CARD: 'review',
  LINKEDIN_CARD: 'social',
  FACEBOOK_CARD: 'social',
  GOOGLE_REVIEW_STANDEE: 'standee',
  BUSINESS_PROFILE_STANDEE: 'standee',
  ALL_IN_ONE_STANDEE_3: 'standee',
  ALL_IN_ONE_STANDEE_4: 'standee',
  GOOGLE_REVIEW_NFC_PLATE: 'review',
};

/**
 * Build CatalogProduct seed entries from the hard-coded product catalog
 * (src/config/products.ts). The code-level definitions are the single source
 * of truth for capabilities, limits and profile mappings; the CatalogProduct
 * records persist a stable slug, name, category and kind for assignment.
 */
function buildDefaultCatalogItems(): Array<Record<string, unknown>> {
  const toSlug = (id: string) => id.toLowerCase().replace(/_/g, '-');

  const priceFor = (id: string): number => {
    const priceTable: Record<string, number> = {
      BUSINESS_NFC_CARD: 99900,
      PREMIUM_NFC_CARD: 199900,
      INSTA_CARD: 149900,
      GOOGLE_REVIEW_CARD: 149900,
      LINKEDIN_CARD: 149900,
      FACEBOOK_CARD: 149900,
      GOOGLE_REVIEW_STANDEE: 249900,
      BUSINESS_PROFILE_STANDEE: 249900,
      ALL_IN_ONE_STANDEE_3: 399900,
      ALL_IN_ONE_STANDEE_4: 499900,
      GOOGLE_REVIEW_NFC_PLATE: 299900,
    };
    return priceTable[id] ?? 99900;
  };

  // Map product category -> CatalogProduct.category
  const categoryMap: Record<string, string> = {
    nfc_card: 'card',
    standee: 'standee',
    plate: 'card',
  };

  return ALL_PRODUCT_IDS.map((id, index) => {
    const def = PRODUCT_CATALOG[id];
    return {
      slug: toSlug(id),
      name: def.name,
      category: categoryMap[def.category] ?? 'card',
      kind: KIND_BY_PRODUCT[id] ?? 'profile',
      priceMinor: priceFor(id),
      active: true,
      sortOrder: index + 1,
      description: def.description,
    };
  });
}

async function seed() {
  try {
    await mongoose.connect(MONGODB_URI);
    console.log('Connected to MongoDB');

    const defaultCatalogItems = buildDefaultCatalogItems();

    for (const item of defaultCatalogItems) {
      await CatalogProduct.findOneAndUpdate(
        { slug: item.slug },
        item,
        { upsert: true, new: true }
      );
      console.log(`Seeded catalog item: ${String(item.name)} (${String(item.slug)})`);
    }

    // Idempotent-safe: skip when any admin exists, or when the email is taken
    // by another account (unique index would otherwise make re-seeding crash).
    const adminExists = await User.findOne({
      $or: [{ role: 'admin' }, { email: 'admin@taprevia.com' }],
    });
    if (!adminExists) {
      const salt = await bcrypt.genSalt(12);
      await User.create({
        name: 'Admin',
        email: 'admin@taprevia.com',
        passwordHash: await bcrypt.hash('admin123', salt),
        role: 'admin',
        status: 'active',
      });
      console.log('Created default admin: admin@taprevia.com / admin123');
    }

    console.log('Seed completed successfully');
    process.exit(0);
  } catch (error) {
    console.error('Seed failed:', error);
    process.exit(1);
  }
}

seed();
