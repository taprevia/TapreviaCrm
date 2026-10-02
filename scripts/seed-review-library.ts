/**
 * M12 seed: review template library (categories + templates).
 *
 * Source of truth is the JSON artifact scripts/data/review-library-mobile-repair.json —
 * the same artifact the admin import accepts. Upserts by key only; never touches
 * or deletes any other collection. Idempotent, safe to re-run.
 *
 * Run:  MONGODB_URI=mongodb://localhost:27017/nfc-crm npx tsx scripts/seed-review-library.ts
 */

import mongoose from 'mongoose';
import { readFileSync } from 'fs';
import { join } from 'path';
import ReviewCategory from '../src/models/ReviewCategory';
import ReviewTemplate from '../src/models/ReviewTemplate';
import {
  reviewLibraryImportSchema,
  normalizeTemplatePayload,
  normalizeCategoryPayload,
} from '../src/lib/validation/review-library';

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/nfc-crm';
const ARTIFACT_PATH = join(__dirname, 'data', 'review-library-mobile-repair.json');

async function seed() {
  try {
    await mongoose.connect(MONGODB_URI);

    const raw = JSON.parse(readFileSync(ARTIFACT_PATH, 'utf8')) as unknown;
    const parsed = reviewLibraryImportSchema.safeParse(raw);
    if (!parsed.success) {
      console.error('Seed failed: invalid artifact payload');
      console.error(JSON.stringify(parsed.error.flatten(), null, 2));
      process.exit(1);
    }

    for (const category of parsed.data.categories) {
      await ReviewCategory.findOneAndUpdate(
        { key: category.key },
        { $set: normalizeCategoryPayload(category) },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      );
      console.log(`Seeded review category: ${category.name} (${category.key})`);
    }

    const merged = (await ReviewCategory.find().select('key scenarios').lean().exec()) as unknown as
      Array<{ key: string; scenarios?: Array<{ key: string }> }>;
    const scenarioByCategory = new Map<string, Set<string>>();
    for (const category of merged) {
      scenarioByCategory.set(
        category.key,
        new Set((category.scenarios ?? []).map((s) => s.key))
      );
    }

    let templatesSeeded = 0;
    for (const template of parsed.data.templates) {
      const scenarios = scenarioByCategory.get(template.categoryKey);
      if (!scenarios || !scenarios.has(template.scenario)) {
        console.error(
          `Seeded template skipped: ${template.key} (scenario "${template.scenario}" not in category)`
        );
        process.exit(1);
      }
      await ReviewTemplate.findOneAndUpdate(
        { key: template.key },
        { $set: normalizeTemplatePayload(template) },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      );
      templatesSeeded += 1;
    }
    console.log(`Seeded ${templatesSeeded} review templates`);

    await mongoose.disconnect();
    console.log('Review library seed completed successfully');
    process.exit(0);
  } catch (error) {
    console.error('Review library seed failed:', error);
    try {
      await mongoose.disconnect();
    } catch {
      /* ignore */
    }
    process.exit(1);
  }
}

seed();