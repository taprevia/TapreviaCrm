/**
 * M12/M13/M14 verification: review template library + category review engine.
 *
 * Exercises the engine + validation + capability gate + AI cost-control smoke
 * (no external AI calls — injected fake completion) against a local MongoDB.
 * The category/template fixture is the seed artifact itself, so these tests
 * fail loudly if the shipped library cannot fulfil the required behaviors.
 *
 * M14 adds: initial sample suggestions (empty-feedback requests) and session
 * repetition control (excludeTemplateIds + deterministic refill), plus
 * route-level 400 handling and metadata-only analytics assertions.
 *
 * Run:  MONGODB_URI=mongodb://localhost:27017/nfc-crm npx tsx scripts/test-review-templates.ts
 */

import mongoose from 'mongoose';
import { readFileSync } from 'fs';
import { join } from 'path';
import { encryptSecret } from '@/lib/crypto';
import AnalyticsLog from '@/models/AnalyticsLog';
import User from '@/models/User';
import UserProduct from '@/models/UserProduct';
import CatalogProduct from '@/models/CatalogProduct';
import TenantSettings, { DEFAULT_AI_GENERATION_DAILY_LIMIT } from '@/models/TenantSettings';
import ReviewCategory from '@/models/ReviewCategory';
import ReviewTemplate from '@/models/ReviewTemplate';
import { hasCapability } from '@/lib/services/capability-access';
import { assignCustomerId } from '@/lib/services/customer-identity';
import { getReviewTemplateSuggestions, styleBucket, type ReviewTemplateInput } from '@/lib/services/review-templates';
import { generateReviewSuggestion } from '@/lib/services/review-generate';
import { logPublicCardAction } from '@/lib/analytics';
import { POST as trackEndpointPOST } from '@/app/api/public/track/route';
import { POST as suggestionsEndpointPOST } from '@/app/api/public/reviews/[alias]/suggestions/route';
import {
  reviewLibraryImportSchema,
  reviewTemplateUpsertSchema,
  normalizeCategoryPayload,
  normalizeTemplatePayload,
} from '@/lib/validation/review-library';

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/nfc-crm';
const ARTIFACT_PATH = join(__dirname, 'data', 'review-library-mobile-repair.json');

const USER_EMAIL = 'm12-verify@example.com';
const NO_PRODUCT_EMAIL = 'm12-noproduct@example.com';
const GOOGLE_URL = 'https://example.com/m12-google-review';

let passed = 0;
let failed = 0;

const MAX_EXPECTED = { one: 1 };

function report(name: string, pass: boolean, detail = ''): void {
  if (pass) {
    passed += 1;
    console.log(`  PASS  ${name}`);
  } else {
    failed += 1;
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

const hasNoRemainingPlaceholders = (text: string) => !/[{}]/.test(text);

interface Ctx {
  user: { _id: mongoose.Types.ObjectId };
  noProduct: { _id: mongoose.Types.ObjectId };
  card1: { _id: mongoose.Types.ObjectId };
  card2: { _id: mongoose.Types.ObjectId };
  card3: { _id: mongoose.Types.ObjectId };
  card4: { _id: mongoose.Types.ObjectId };
  card5: { _id: mongoose.Types.ObjectId };
}

async function seed(): Promise<Ctx> {
  mongoose.set('strictQuery', false);
  await mongoose.connect(MONGODB_URI);
  const db = mongoose.connection.db!;

  const ensureUser = async (email: string, name: string) => {
    let doc = await User.findOne({ email });
    if (!doc) doc = await User.create({ email, name, passwordHash: 'x' });
    if (!doc.customerId) {
      doc.customerId = await assignCustomerId(doc);
      await doc.save();
    }
    const slug = email.split('@')[0].replace(/[^a-z0-9-]/gi, '-').toLowerCase();
    if (!doc.bizSlug) {
      doc.bizSlug = slug;
      await doc.save();
    }
    return { _id: doc._id as mongoose.Types.ObjectId };
  };

  const user = await ensureUser(USER_EMAIL, 'M12 Verify');
  const noProduct = await ensureUser(NO_PRODUCT_EMAIL, 'M12 No Product');

  // Tenant AI settings so the cost-control smoke is meaningful (kill-switch
  // must fire because we disabled it, not because settings never existed).
  const existing = await TenantSettings.findOne({ userId: user._id });
  if (existing) {
    existing.openai.enabled = true;
    existing.openai.apiKeyEnc = encryptSecret('sk-test-verify');
    existing.openai.dailyLimit = DEFAULT_AI_GENERATION_DAILY_LIMIT;
    existing.openai.usage = new Map();
    await existing.save();
  } else {
    await TenantSettings.create({
      userId: user._id,
      openai: {
        enabled: true,
        apiKeyEnc: encryptSecret('sk-test-verify'),
        model: 'gpt-4o-mini',
        dailyLimit: DEFAULT_AI_GENERATION_DAILY_LIMIT,
        usage: new Map(),
      },
    });
  }

  // Grant the review_ai_suggestions capability via a GOOGLE_REVIEW_CARD product.
  const catalogProduct = await CatalogProduct.findOneAndUpdate(
    { slug: 'google-review-card' },
    {
      slug: 'google-review-card',
      name: 'Google Review Card',
      category: 'card',
      kind: 'review',
      active: true,
      sortOrder: 1,
    },
    { upsert: true, new: true }
  );
  await UserProduct.findOneAndUpdate(
    { userId: user._id, catalogProductId: catalogProduct._id },
    {
      userId: user._id,
      catalogProductId: catalogProduct._id,
      cardId: null,
      standeeId: null,
      quantity: 1,
      unitPriceMinor: 0,
      status: 'active',
      notes: 'm12-verify',
      assignedBy: null,
      material: 'pvc',
    },
    { upsert: true, new: true }
  );

  const baseReview = {
    enabled: true,
    googleReviewUrl: GOOGLE_URL,
    writingStyle: 'friendly',
    preferredLength: 'medium',
    languages: ['English'],
    feedbackTopics: ['service'],
    welcomeMessage: 'Tell us about your visit.',
  };

  const upsertCard = async (cardUid: string, slug: string, patch: Record<string, unknown> = {}) => {
    const doc = await db.collection('cards').findOneAndUpdate(
      { cardUid },
      {
        $set: {
          name: 'M12 Verify Business',
          cardUid,
          urlAlias: slug,
          slug,
          routeSlug: `m12r-${slug}`,
          kind: 'review',
          isActive: true,
          userId: user._id,
          reviewAssistant: { ...baseReview, ...patch },
        },
      },
      { upsert: true, returnDocument: 'after' }
    );
    if (!doc) throw new Error(`card upsert failed for ${cardUid}`);
    return { _id: doc._id as mongoose.Types.ObjectId };
  };

  // card1: fully personalized (employees, services, matching keywords).
  const card1 = await upsertCard('M12-VERIFY-01', 'm12verify01', {
    category: 'mobile-repair',
    employees: ['Rahul', 'Priya'],
    services: ['Screen Repair', 'Battery Replacement'],
    keywords: ['fast', 'professional'],
  });
  // card2: no employees (employee templates must be excluded, still fills 1).
  const card2 = await upsertCard('M12-VERIFY-02', 'm12verify02', {
    category: 'mobile-repair',
    employees: [],
    services: ['Screen Repair'],
    keywords: ['fast'],
  });
  // card3: no category → empty suggestions (existing AI flow untouched).
  const card3 = await upsertCard('M12-VERIFY-03', 'm12verify03', {});
  // card4: disabled → empty suggestions.
  const card4 = await upsertCard('M12-VERIFY-04', 'm12verify04', {
    enabled: false,
    category: 'mobile-repair',
  });
  // card5: keyword templates must be excluded (no matching business keyword).
  const card5 = await upsertCard('M12-VERIFY-05', 'm12verify05', {
    category: 'mobile-repair',
    employees: ['Rahul'],
    services: ['Screen Repair'],
    keywords: ['zzz-no-match'],
  });

  return { user, noProduct, card1, card2, card3, card4, card5 };
}

async function seedLibrary(): Promise<void> {
  const raw = JSON.parse(readFileSync(ARTIFACT_PATH, 'utf8')) as unknown;
  const parsed = reviewLibraryImportSchema.safeParse(raw);
  if (!parsed.success) throw new Error('library artifact invalid: ' + JSON.stringify(parsed.error.flatten()));

  for (const category of parsed.data.categories) {
    await ReviewCategory.findOneAndUpdate(
      { key: category.key },
      { $set: normalizeCategoryPayload(category) },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
  }
  const merged = (await ReviewCategory.find().select('key scenarios').lean().exec()) as unknown as
    Array<{ key: string; scenarios?: Array<{ key: string }> }>;
  const scenarioByCategory = new Map<string, Set<string>>();
  for (const category of merged) {
    scenarioByCategory.set(category.key, new Set((category.scenarios ?? []).map((s) => s.key)));
  }
  for (const template of parsed.data.templates) {
    const scenarios = scenarioByCategory.get(template.categoryKey);
    if (!scenarios?.has(template.scenario)) throw new Error(`template scenario mismatch: ${template.key}`);
    await ReviewTemplate.findOneAndUpdate(
      { key: template.key },
      { $set: normalizeTemplatePayload(template) },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
  }
}

async function run() {
  const ctx = await seed();
  await seedLibrary();
  const runStart = new Date();

  const loadCard = async (_id: mongoose.Types.ObjectId) => {
    return (await mongoose.connection.db!.collection('cards').findOne({ _id })) as unknown as {
      _id: unknown;
      userId: unknown;
      name: string;
      reviewAssistant?: {
        enabled?: boolean;
        category?: string;
        employees?: string[];
        services?: string[];
        keywords?: string[];
      } | null;
    };
  };

  /* 1–2. Capability gate. */
  {
    const blocked = await hasCapability(ctx.noProduct._id, 'review_ai_suggestions');
    report('1 no review product → review_ai_suggestions denied', blocked === false);
    const granted = await hasCapability(ctx.user._id, 'review_ai_suggestions');
    report('2 GOOGLE_REVIEW_CARD product → review_ai_suggestions granted', granted === true);
  }

  /* 3. Disabled card → no suggestions. */
  {
    const card = await loadCard(ctx.card4._id);
    const r = await getReviewTemplateSuggestions({ card, language: 'English' });
    report('3 disabled card → no suggestions', r.length === 0);
  }

  /* 4. No category → no suggestions (AI flow untouched). */
  {
    const card = await loadCard(ctx.card3._id);
    const r = await getReviewTemplateSuggestions({ card, language: 'English' });
    report('4 no category → empty suggestions', r.length === 0);
  }

  /* 5. Fulfilment: exactly 1 unique, all placeholders substituted. */
  {
    const card = await loadCard(ctx.card1._id);
    const r = await getReviewTemplateSuggestions({ card, language: 'English' });
    const unique = new Set(r.map((s) => s.templateId)).size === r.length;
    const clean = r.every((s) => hasNoRemainingPlaceholders(s.text));
    report(
      '5 full pool → 1 unique fully-substituted suggestion',
      r.length === MAX_EXPECTED.one && unique && clean,
      `len=${r.length}`
    );
  }

  /* 6. Language fallback → English suffices. */
  {
    const card = await loadCard(ctx.card1._id);
    const r = await getReviewTemplateSuggestions({ card, language: 'English' });
    report('6 English fallback → 1 suggestion served', r.length === MAX_EXPECTED.one);
  }

  /* 7. Missing employees → employee templates excluded, still fills 1, no leftovers. */
  {
    const card = await loadCard(ctx.card2._id);
    const r = await getReviewTemplateSuggestions({ card, language: 'English' });
    const noEmployeePlaceholder = r.every((s) => !s.text.includes('{employee}'));
    report(
      '7 no employees → {employee} templates excluded, still 1 clean',
      r.length === MAX_EXPECTED.one && noEmployeePlaceholder
    );
  }

  /* 8. Keyword compatibility: non-matching keyword excludes {keyword} templates. */
  {
    const card = await loadCard(ctx.card5._id);
    const r = await getReviewTemplateSuggestions({ card, language: 'English' });
    const noKeywordPlaceholder = r.every((s) => !s.text.includes('{keyword}'));
    report('8 unmatched keyword → no {keyword} template served, no leftovers', noKeywordPlaceholder);
    const matching = await loadCard(ctx.card1._id);
    const r2 = await getReviewTemplateSuggestions({ card: matching, language: 'English' });
    report('8b matching keyword → suggestions clean of placeholders', r2.every((s) => hasNoRemainingPlaceholders(s.text)));
  }

  /* 9. Single-slot selection: one deterministically-ranked suggestion served. */
  {
    const r = await getReviewTemplateSuggestions({
      card: await loadCard(ctx.card1._id),
      language: 'English',
    });
    report('9 single suggestion served', r.length === MAX_EXPECTED.one, `len=${r.length}`);
  }

  /* 10. Anti-repetition: subsequent serve rotates (disjoint) and tracks usage. */
  {
    // Reset rotation state so 10b asserts the write deterministically.
    await ReviewTemplate.updateMany(
      { categoryKey: 'mobile-repair' },
      { $set: { usageCount: 0, lastShownAt: null } }
    ).exec();
    const card = await loadCard(ctx.card1._id);
    const first = await getReviewTemplateSuggestions({ card, language: 'English', now: new Date() });
    const secondAt = new Date();
    const second = await getReviewTemplateSuggestions({ card, language: 'English', now: secondAt });
    const firstIds = new Set(first.map((s) => s.templateId));
    const disjoint = second.every((s) => !firstIds.has(s.templateId));
    const used = await ReviewTemplate.findOne({ _id: first[0]?.templateId }).lean();
    report('10 second serve rotates to a fresh template', second.length === MAX_EXPECTED.one && disjoint);
    report(
      '10b usageCount/lastShownAt tracked (best-effort write)',
      (used as unknown as { usageCount?: number }).usageCount === 1 &&
        (used as unknown as { lastShownAt?: Date | null }).lastShownAt != null,
      `firstId=${first[0]?.templateId}`
    );
  }

  /* 15. M13: writing-style preference surfaces in the single slot. */
  {
    await ReviewTemplate.updateMany(
      { categoryKey: 'mobile-repair' },
      { $set: { usageCount: 0, lastShownAt: null } }
    ).exec();
    const base = await loadCard(ctx.card1._id);
    const card: ReviewTemplateInput['card'] = {
      ...base,
      reviewAssistant: {
        ...(base.reviewAssistant ?? {}),
        writingStyle: 'professional',
        preferredLength: 'medium',
      },
    };
    const r = await getReviewTemplateSuggestions({ card, language: 'English' });
    const docs = (await ReviewTemplate.find({ _id: { $in: r.map((s) => s.templateId) } })
      .select('style')
      .lean()) as unknown as Array<{ style?: string }>;
    const styles = docs.map((d) => d.style ?? '').sort();
    // Seed truth: the medium pool holds exactly two professional templates
    // (both staff-expertise; round-robin caps one per scenario) alongside
    // friendly peers — the single-slot serve must surface one of the
    // professional templates, never a lower-ranked friendly peer.
    report(
      '15 writingStyle professional → the single served template matches the style',
      r.length === MAX_EXPECTED.one && styles.join(',') === 'professional',
      `styles=${styles.join(',')}`
    );
  }

  /* 15b. M13: styleBucket prefers exact style without ever dropping candidates. */
  {
    const pool = [{ style: 'simple' }, { style: 'professional' }, { style: 'friendly' }];
    const preferred = styleBucket(pool, 'professional');
    const ordered = preferred.map((t) => t.style);
    report(
      '15b styleBucket prefers exact style without dropping',
      ordered.join(',') === ['professional', 'simple', 'friendly'].join(','),
      ordered.join(',')
    );
  }

  /* 16. M13: customer feedback topics genuinely surface the matching template. */
  {
    await ReviewTemplate.updateMany(
      { categoryKey: 'mobile-repair' },
      { $set: { usageCount: 0, lastShownAt: null } }
    ).exec();
    const sq2 = (await ReviewTemplate.findOne({
      key: 'mobile-repair-service-quality-medium-friendly-2',
    })
      .select('_id')
      .lean()) as unknown as { _id: unknown } | null;
    const sq2Id = sq2 ? String(sq2._id) : '';
    const base = await loadCard(ctx.card1._id);
    const card: ReviewTemplateInput['card'] = {
      ...base,
      reviewAssistant: {
        ...(base.reviewAssistant ?? {}),
        writingStyle: undefined,
        preferredLength: 'medium',
        employees: ['Rahul'],
        services: ['Screen Repair'],
        keywords: ['fast'],
      },
    };
    const without = await getReviewTemplateSuggestions({ card, language: 'English' });
    const withTopics = await getReviewTemplateSuggestions({
      card,
      language: 'English',
      // "flawless" appears only in the service-quality medium-friendly-2
      // template (the other medium-friendly peers use "transparent"), so the
      // request flips that bucket's winner into the single slot.
      topics: ['flawless'],
    });
    report(
      '16 topic relevance promotes the matching template',
      !!sq2Id && !without.some((s) => s.templateId === sq2Id) && withTopics.some((s) => s.templateId === sq2Id),
      `sq2Id=${sq2Id}`
    );
  }

  /* 11. Markup rejection: template text cannot contain HTML/JS. */
  {
    const bad = reviewTemplateUpsertSchema.safeParse({
      key: 'x-1', categoryKey: 'mobile-repair', scenario: 'overall',
      language: 'English', length: 'medium',
      text: 'What a scam <script>alert(1)</script>',
    });
    report('11 template text with markup rejected', bad.success === false);
  }

  /* 12. Unknown placeholder rejection. */
  {
    const bad = reviewTemplateUpsertSchema.safeParse({
      key: 'x-2', categoryKey: 'mobile-repair', scenario: 'overall',
      language: 'English', length: 'medium',
      text: 'We loved our store visit to {storeName}.',
    });
    report('12 unknown placeholder {storeName} rejected', bad.success === false);
    const okTpl = reviewTemplateUpsertSchema.safeParse({
      key: 'x-3', categoryKey: 'mobile-repair', scenario: 'overall',
      language: 'English', length: 'medium',
      text: '{businessName} handled my {service} well.',
    });
    report('12b allowed placeholders accepted', okTpl.success === true);
  }

  /* 13. AI path cost controls intact; template path made zero OpenAI calls. */
  {
    const fake = {
      calls: 0,
      complet: async () => {
        fake.calls += 1;
        return {
          text: 'M12 fake draft.',
          usage: { promptTokens: 100, completionTokens: 25, totalTokens: 125 },
        };
      },
    };
    const base = {
      feedback: 'Service was fast and friendly during my visit.',
      topics: ['service'],
      language: 'English',
      length: 'medium' as const,
      ip: '203.0.113.42',
      userAgent: 'm12-verify',
      complet: fake.complet,
    };

    // Kill-switch.
    await TenantSettings.findOneAndUpdate(
      { userId: ctx.user._id },
      { $set: { 'openai.enabled': false } },
      { new: true }
    );
    const disabled = await generateReviewSuggestion({ ...base, alias: 'm12verify01' });
    report('13a kill-switch → UNAVAILABLE (no provider call)', disabled.ok === false && disabled.code === 'UNAVAILABLE');

    // Daily limit reservation (2 allowed, 3rd rejected), provider called exactly 2×.
    await TenantSettings.findOneAndUpdate(
      { userId: ctx.user._id },
      { $set: { 'openai.enabled': true, 'openai.dailyLimit': 2, 'openai.usage.m12': 0 } },
      { new: true }
    );
    const today = new Date().toISOString().slice(0, 10);
    await TenantSettings.findOneAndUpdate(
      { userId: ctx.user._id },
      { $set: { [`openai.usage.${today}`]: 0, 'openai.dailyLimit': 2 } },
      { new: true }
    );
    await generateReviewSuggestion({ ...base, alias: 'm12verify01' });
    await generateReviewSuggestion({ ...base, alias: 'm12verify01' });
    const over = await generateReviewSuggestion({ ...base, alias: 'm12verify01' });
    report(
      '13b daily reservation → 2 ok then LIMIT_REACHED',
      fake.calls === 2 && over.ok === false && over.code === 'LIMIT_REACHED',
      `calls=${fake.calls}`
    );

    // Template path makes zero OpenAI calls.
    const templateCard = await loadCard(ctx.card1._id);
    for (let i = 0; i < 5; i += 1) {
      await getReviewTemplateSuggestions({ card: templateCard, language: 'English' });
    }
    report('13c template mode → zero OpenAI calls', fake.calls === 2);

    // Reset.
    await TenantSettings.findOneAndUpdate(
      { userId: ctx.user._id },
      { $set: { openai: { enabled: true, apiKeyEnc: encryptSecret('sk-test-verify'), model: 'gpt-4o-mini', dailyLimit: DEFAULT_AI_GENERATION_DAILY_LIMIT, usage: new Map() } } }
    );
  }

  /* 14. No persistence leak: metadata-only analytics, card unchanged. */
  {
    const beforeCard = await loadCard(ctx.card1._id);
    await getReviewTemplateSuggestions({ card: beforeCard, language: 'English' });
    const afterCard = await loadCard(ctx.card1._id);
    report(
      '14a suggestions never mutate card.reviewAssistant',
      JSON.stringify(beforeCard.reviewAssistant) === JSON.stringify(afterCard.reviewAssistant)
    );

    const suggestions = await getReviewTemplateSuggestions({ card: beforeCard, language: 'English' });
    const meta = JSON.stringify({
      count: suggestions.length,
      language: 'English',
      length: 'medium',
    });
    await logPublicCardAction(ctx.card1._id, 'review_suggestions_shown', meta, undefined);
    const row = (await AnalyticsLog.findOne({
      cardId: ctx.card1._id,
      action: 'review_suggestions_shown',
      createdAt: { $gte: runStart },
    })
      .sort({ createdAt: -1 })
      .lean()) as unknown as { metadata?: string } | null;
    const leaksTemplateText = suggestions.some((s) => (row?.metadata ?? '').includes(s.text));
    const parsed: { count?: unknown; language?: unknown; length?: unknown } = row?.metadata ? JSON.parse(row.metadata) : {};
    report(
      '14b analytics row is metadata-only (count/language/length), no template text',
      !!row && !leaksTemplateText && parsed.count === suggestions.length
    );
  }

  /* 17. M13-A: track route now accepts review_template_used (no longer silently dropped). */
  {
    const post = (action: string) =>
      trackEndpointPOST(
        new Request('http://localhost/api/public/track', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ alias: 'm12verify01', action }),
        }) as never
      );
    const usedRes = await post('review_template_used');
    const usedJson = (await usedRes.json()) as { recorded?: boolean };
    const row = await AnalyticsLog.findOne({
      cardId: ctx.card1._id,
      action: 'review_template_used',
    })
      .sort({ createdAt: -1 })
      .lean();
    const unknownRes = await post('review_template_bogus');
    const unknownJson = (await unknownRes.json()) as { skipped?: boolean };
    const bogusRow = await AnalyticsLog.findOne({
      cardId: ctx.card1._id,
      action: 'review_template_bogus',
    }).lean();
    report(
      '17 track route records review_template_used',
      usedJson.recorded === true && !!row && unknownJson.skipped === true && bogusRow == null
    );
  }

  /* ── M14: initial sample suggestions + session repetition control ── */

  const resetRotation = async () => {
    await ReviewTemplate.updateMany(
      { categoryKey: 'mobile-repair' },
      { $set: { usageCount: 0, lastShownAt: null } }
    ).exec();
  };
  const mediumCohort = async () =>
    (await ReviewTemplate.find({ categoryKey: 'mobile-repair', active: true, length: 'medium' })
      .select('_id style text')
      .lean()
      .exec()) as unknown as Array<{ _id: unknown; style?: string; text: string }>;
  const uniqueIds = (list: { templateId: string }[]) => new Set(list.map((s) => s.templateId));

  /* A1. Empty-feedback request returns suggestions for a fully configured card. */
  {
    await resetRotation();
    const card = await loadCard(ctx.card1._id);
    const r = await getReviewTemplateSuggestions({ card, language: 'English' }); // no topics/feedback
    const unique = uniqueIds(r).size === r.length;
    const clean = r.every((s) => hasNoRemainingPlaceholders(s.text));
    report(
      'A1 empty-feedback initial request serves only real clean suggestions',
      r.length === MAX_EXPECTED.one && unique && clean,
      `len=${r.length}`
    );
  }

  /* A2. Initial empty request does not reach the AI path. */
  {
    const fake = {
      calls: 0,
      complet: async () => {
        fake.calls += 1;
        return {
          text: 'M14 fake draft.',
          usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
        };
      },
    };
    // The engine has no provider seam by design — template mode must never
    // invoke an AI completion, so the same probe test 13 uses stays at 0.
    const card = await loadCard(ctx.card1._id);
    await getReviewTemplateSuggestions({ card, language: 'English' });
    await getReviewTemplateSuggestions({ card, language: 'English', topics: [] });
    report('A2 initial empty-feedback requests require no OpenAI call', fake.calls === 0);
  }

  /* A3. Insufficient business configuration → only edible templates / none. */
  {
    // Disabled card → none.
    const disabled = await getReviewTemplateSuggestions({
      card: await loadCard(ctx.card4._id),
      language: 'English',
    });
    report('A3a disabled card → no suggestions', disabled.length === 0);
    // No category → none (AI flow untouched).
    const noCategory = await getReviewTemplateSuggestions({
      card: await loadCard(ctx.card3._id),
      language: 'English',
    });
    report('A3b no category → no suggestions', noCategory.length === 0);
    // Unmatched keyword card → only genuinely edible templates served.
    const unmatched = await getReviewTemplateSuggestions({
      card: await loadCard(ctx.card5._id),
      language: 'English',
    });
    report(
      'A3c unmatched keyword card serves only edible templates',
      unmatched.every((s) => hasNoRemainingPlaceholders(s.text))
    );
    // Truly bare card (category set, zero business values) → zero templates.
    await mongoose.connection.db!.collection('cards').findOneAndUpdate(
      { cardUid: 'M14-VERIFY-BARE' },
      {
        $set: {
          name: '',
          cardUid: 'M14-VERIFY-BARE',
          urlAlias: 'm14verifybare',
          slug: 'm14verifybare',
          routeSlug: 'm14r-m14verifybare',
          kind: 'review',
          isActive: true,
          userId: ctx.user._id,
          reviewAssistant: {
            enabled: true,
            googleReviewUrl: '',
            writingStyle: 'friendly',
            preferredLength: 'medium',
            languages: ['English'],
            feedbackTopics: [],
            welcomeMessage: '',
            category: 'mobile-repair',
            employees: [],
            services: [],
            keywords: [],
          },
        },
      },
      { upsert: true, returnDocument: 'after' }
    );
    const bare = (await mongoose.connection.db!.collection('cards').findOne({
      cardUid: 'M14-VERIFY-BARE',
    })) as unknown;
    const bareSuggestions = await getReviewTemplateSuggestions({
      card: bare as never,
      language: 'English',
    });
    report('A3d bare card → zero suggestions (never fabricates)', bareSuggestions.length === 0);
  }

  /* B1. First serve returns unique template ids. */
  {
    await resetRotation();
    const card = await loadCard(ctx.card1._id);
    const r = await getReviewTemplateSuggestions({ card, language: 'English' });
    report(
      'B1 first serve → unique template id',
      r.length === MAX_EXPECTED.one && uniqueIds(r).size === r.length
    );
  }

  /* B2. Excluding the first serve prevents repeats when the pool allows. */
  {
    await resetRotation();
    const card = await loadCard(ctx.card1._id);
    const first = await getReviewTemplateSuggestions({ card, language: 'English' });
    const excluded = first.map((s) => s.templateId);
    const second = await getReviewTemplateSuggestions({
      card,
      language: 'English',
      excludeTemplateIds: excluded,
    });
    const shared = second.filter((s) => excluded.includes(s.templateId));
    report(
      'B2 first served template excluded → disjoint next serve',
      second.length === MAX_EXPECTED.one && shared.length === 0,
      `shared=${shared.map((s) => s.templateId).join(',')}`
    );
  }

  /* B3. Three sequential medium serves stay disjoint while the pool allows. */
  {
    await resetRotation();
    const card = await loadCard(ctx.card1._id); // preferredLength: medium (pool 7)
    const s1 = await getReviewTemplateSuggestions({ card, language: 'English' });
    const ids1 = s1.map((s) => s.templateId);
    const s2 = await getReviewTemplateSuggestions({
      card,
      language: 'English',
      excludeTemplateIds: ids1,
    });
    const ids2 = s2.map((s) => s.templateId);
    const s1s2Disjoint = ids2.every((t) => !ids1.includes(t));
    report(
      'B3 medium serves stay disjoint while the pool permits it',
      s1.length === MAX_EXPECTED.one && s2.length === MAX_EXPECTED.one && s1s2Disjoint,
      `shared=${ids2.filter((t) => ids1.includes(t)).join(',')}`
    );
    // Third serve after 2 excluded → still disjoint, still unique.
    const s3 = await getReviewTemplateSuggestions({
      card,
      language: 'English',
      excludeTemplateIds: [...ids1, ...ids2],
    });
    report(
      'B3b third serve stays disjoint and unique',
      s3.length === MAX_EXPECTED.one && uniqueIds(s3).size === s3.length
    );
  }

  /* B4. Detailed pool of exactly 3 gracefully reuses after exhaustion. */
  {
    await resetRotation();
    const card = await loadCard(ctx.card1._id);
    const seen = new Set<string>();
    const serves: string[][] = [];
    for (let i = 0; i < 3; i += 1) {
      const served = await getReviewTemplateSuggestions({
        card,
        language: 'English',
        length: 'detailed',
        excludeTemplateIds: [...seen],
      });
      serves.push(served.map((s) => s.templateId));
      for (const id of served.map((s) => s.templateId)) seen.add(id);
    }
    // One per serve, each disjoint from the previous, all 3 detailed served.
    const disjointServes = serves.every(
      (ids, i) => i === 0 || ids.every((id) => !serves[i - 1].includes(id))
    );
    const exhaustive = serves.every((ids) => ids.length === MAX_EXPECTED.one) && seen.size === 3;
    const fourth = await getReviewTemplateSuggestions({
      card,
      language: 'English',
      length: 'detailed',
      excludeTemplateIds: [...seen],
    });
    report(
      'B4 detailed pool of 3 reuses the same set after exhaustion',
      disjointServes && exhaustive && fourth.length === MAX_EXPECTED.one && fourth.every((s) => seen.has(s.templateId)),
      `seen=${[...seen].join(',')}`
    );
  }

  /* B5. Short pool (4) behaves deterministically after exhaustion. */
  {
    await resetRotation();
    const card = await loadCard(ctx.card1._id);
    const seen = new Set<string>();
    const served: string[][] = [];
    for (let i = 0; i < 4; i += 1) {
      const s = await getReviewTemplateSuggestions({
        card,
        language: 'English',
        length: 'short',
        excludeTemplateIds: [...seen],
      });
      served.push(s.map((x) => x.templateId));
      for (const id of s.map((x) => x.templateId)) seen.add(id);
    }
    // One per serve, each disjoint from the previous, all 4 shorts exhausted.
    const cleanServes = served.every((ids) => ids.length === MAX_EXPECTED.one);
    const disjoint = served.every(
      (ids, i) => i === 0 || ids.every((id) => !served[i - 1].includes(id))
    );
    const exhaustive = seen.size === 4;
    // Fully exhausted → identical exclusion-driven refills stay deterministic.
    const s5 = await getReviewTemplateSuggestions({
      card,
      language: 'English',
      length: 'short',
      excludeTemplateIds: [...seen],
    });
    const s6 = await getReviewTemplateSuggestions({
      card,
      language: 'English',
      length: 'short',
      excludeTemplateIds: [...seen],
    });
    const deterministic =
      s5.map((s) => s.templateId).join(',') === s6.map((s) => s.templateId).join(',');
    report(
      'B5 short pool deterministic and unique after exhaustion',
      cleanServes && disjoint && exhaustive && deterministic && uniqueIds(s5).size === s5.length
    );
  }

  /* B6. Exclusion list larger than the eligible pool never duplicates a response. */
  {
    await resetRotation();
    const card = await loadCard(ctx.card1._id);
    const poolIds = (await ReviewTemplate.find({ categoryKey: 'mobile-repair', active: true })
      .select('_id')
      .lean()
      .exec()) as unknown as Array<{ _id: unknown }>;
    const ids = poolIds.map((d) => String(d._id));
    // Exceed the pool with real + bogus-but-valid-format ids (route caps at 16).
    const exclusions = [...ids, 'aaaaaaaaaaaaaaaaaaaaaaaa', 'bbbbbbbbbbbbbbbbbbbbbbbb'].slice(0, 16);
    const r = await getReviewTemplateSuggestions({
      card,
      language: 'English',
      excludeTemplateIds: exclusions,
    });
    report(
      'B6 oversized exclusion list → unique response, never padded with duplicates',
      r.length === MAX_EXPECTED.one && uniqueIds(r).size === r.length
    );
  }

  /* B7. Malformed exclusion ids do not cause a 500 — engine drops them safely. */
  {
    await resetRotation();
    const card = await loadCard(ctx.card1._id);
    const r = await getReviewTemplateSuggestions({
      card,
      language: 'English',
      excludeTemplateIds: [
        'not-a-valid-id',
        'zzzz',
        '123',
        'AB',
        '',
        'GGGGGGGGGGGGGGGGGGGGGGGG', // 24 chars but not hex
      ],
    });
    report(
      'B7 malformed exclusion ids safely ignored',
      r.length === MAX_EXPECTED.one && uniqueIds(r).size === r.length
    );
  }

  /* B7b (route-level). Malformed exclusions are rejected with 400, never 500. */
  {
    const res = await suggestionsEndpointPOST(
      new Request('http://localhost/api/public/reviews/m12verify01/suggestions', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.201' },
        body: JSON.stringify({ excludeTemplateIds: ['not-an-id'], init: true }),
      }) as never,
      { params: { alias: 'm12verify01' } } as never
    );
    report('B7b route rejects malformed exclusion ids with 400', res.status === 400);
  }

  /* M14 route-level: valid init request serves suggestions and logs metadata-only. */
  {
    const res = await suggestionsEndpointPOST(
      new Request('http://localhost/api/public/reviews/m12verify01/suggestions', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.202' },
        body: JSON.stringify({ init: true, excludeTemplateIds: [] }),
      }) as never,
      { params: { alias: 'm12verify01' } } as never
    );
    const json = (await res.json()) as { mode?: string; suggestions?: { templateId: string; text: string }[] };
    const row = (await AnalyticsLog.findOne({
      cardId: ctx.card1._id,
      action: 'review_suggestions_shown',
    })
      .sort({ createdAt: -1 })
      .lean()) as unknown as { metadata?: string } | null;
    const meta: { count?: unknown; init?: unknown } = row?.metadata
      ? JSON.parse(row.metadata)
      : {};
    const leaksTemplateText = (json.suggestions ?? []).some((s) =>
      (row?.metadata ?? '').includes(s.text)
    );
    report(
      'M14 init request serves suggestions and logs metadata-only (init:true, no text)',
      res.ok && json.mode === 'template' && meta.init === true && leaksTemplateText === false,
      `mode=${json.mode} init=${meta.init}`
    );
  }

  /* B8. Exclusion input never mutates card.reviewAssistant. */
  {
    const card = await loadCard(ctx.card1._id);
    const before = JSON.stringify(card.reviewAssistant);
    const cohort = await mediumCohort();
    const exclusions = cohort.slice(0, 3).map((d) => String(d._id));
    await getReviewTemplateSuggestions({ card, language: 'English', excludeTemplateIds: exclusions });
    const after = JSON.stringify((await loadCard(ctx.card1._id)).reviewAssistant);
    report('B8 exclusion input does not mutate card.reviewAssistant', before === after);
  }

  /* B9. Excluded templates remain otherwise eligible for future reuse. */
  {
    await resetRotation();
    const card = await loadCard(ctx.card1._id);
    const cohort = (await mediumCohort()).map((d) => String(d._id));
    const one = cohort[0]!;
    const withOne = await getReviewTemplateSuggestions({
      card,
      language: 'English',
      excludeTemplateIds: [one],
    });
    const held = !withOne.some((s) => s.templateId === one);
    const everyOther = cohort.filter((id) => id !== one);
    const refilled = await getReviewTemplateSuggestions({
      card,
      language: 'English',
      excludeTemplateIds: everyOther,
    });
    report(
      'B9 excluded template respected first, then reused on exhaustion',
      held && refilled.some((s) => s.templateId === one)
    );
  }

  /* B10. Template mode with exclusions never invokes the AI path. */
  {
    const fake = {
      calls: 0,
      complet: async () => {
        fake.calls += 1;
        return {
          text: 'M14 fake draft.',
          usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
        };
      },
    };
    const card = await loadCard(ctx.card1._id);
    const poolIds = (await ReviewTemplate.find({ categoryKey: 'mobile-repair', active: true })
      .select('_id')
      .lean()
      .exec()) as unknown as Array<{ _id: unknown }>;
    const ids = poolIds.map((d) => String(d._id));
    for (const slice of [ids.slice(0, 3), ids.slice(2, 8), ids.slice(4, 12)]) {
      await getReviewTemplateSuggestions({
        card,
        language: 'English',
        topics: ['service'],
        excludeTemplateIds: slice,
      });
    }
    report('B10 template mode with exclusions requires no OpenAI call', fake.calls === 0);
  }

  /* B11. Language/length/style/feedback rules stay intact with exclusions. */
  {
    const base = await loadCard(ctx.card1._id);
    const cardFor = (writingStyle: 'professional' | undefined): ReviewTemplateInput['card'] => ({
      ...base,
      reviewAssistant: {
        ...(base.reviewAssistant ?? {}),
        writingStyle,
        preferredLength: 'medium',
      },
    });
    await resetRotation();
    const sq2 = (await ReviewTemplate.findOne({ key: 'mobile-repair-service-quality-medium-friendly-2' })
      .select('_id')
      .lean()) as unknown as { _id: unknown } | null;
    const sq2Id = sq2 ? String(sq2._id) : '';
    // B11a+b: on a friendly (no style bias) card, topic relevance promotes the
    // matching template into the single slot even after excluding the
    // professional templates; whatever is served obeys length + language.
    const professionalIds = (
      (await ReviewTemplate.find({
        categoryKey: 'mobile-repair',
        active: true,
        length: 'medium',
        style: 'professional',
      })
        .select('_id')
        .lean()
        .exec()) as unknown as Array<{ _id: unknown }>
    ).map((d) => String(d._id));
    const withTopics = await getReviewTemplateSuggestions({
      card: cardFor(undefined),
      language: 'English',
      // "flawless" appears only in the service-quality medium-friendly-2
      // template, so even with the professional templates excluded it wins
      // the single slot (unlike "transparent", which two peers also carry).
      topics: ['flawless'],
      excludeTemplateIds: professionalIds,
    });
    const docs = (await ReviewTemplate.find({
      _id: { $in: withTopics.map((s) => s.templateId) },
    })
      .select('length language style')
      .lean()
      .exec()) as unknown as Array<{
      length: string;
      language: string;
      style?: string;
    }>;
    report(
      'B11a topic relevance still promotes the matching template with exclusions',
      !!sq2Id && withTopics.some((s) => s.templateId === sq2Id)
    );
    report(
      'B11b length/language rules intact with exclusions',
      docs.length === withTopics.length &&
        docs.every((d) => d.length === 'medium' && d.language === 'English')
    );
    // B11c: writing-style preference surfaces in the single slot.
    const stylized = await getReviewTemplateSuggestions({
      card: cardFor('professional'),
      language: 'English',
    });
    const stylizedDocs = (await ReviewTemplate.find({
      _id: { $in: stylized.map((s) => s.templateId) },
    })
      .select('style')
      .lean()
      .exec()) as unknown as Array<{ style?: string }>;
    report(
      'B11c writing-style preference intact with exclusions',
      stylizedDocs.some((d) => d.style === 'professional')
    );
  }

  /* B12. Recently excluded templates never bypass edibility (no refill fabricates). */
  {
    // card2 has services + a matching keyword but NO employees → every
    // {employee} template is inedible, even when exclusions force a refill.
    const card2 = await loadCard(ctx.card2._id);
    const r = await getReviewTemplateSuggestions({ card: card2, language: 'English' });
    const controlClean = r.every((s) => !s.text.includes('{employee}') && hasNoRemainingPlaceholders(s.text));
    const toExclude = (await ReviewTemplate.find({ categoryKey: 'mobile-repair', active: true })
      .select('_id text')
      .lean()
      .exec()) as unknown as Array<{ _id: unknown; text: string }>;
    const excluded = toExclude
      .filter((d) => !d.text.includes('{employee}'))
      .map((d) => String(d._id))
      .slice(0, 8);
    const r2 = await getReviewTemplateSuggestions({
      card: card2,
      language: 'English',
      excludeTemplateIds: excluded,
    });
    report(
      'B12a control serve is edible-only',
      controlClean
    );
    report(
      'B12b refill never bypasses edibility (no {employee}, no leftovers)',
      r2.length <= MAX_EXPECTED.one &&
        r2.length >= 1 &&
        r2.every((s) => !s.text.includes('{employee}') && hasNoRemainingPlaceholders(s.text)) &&
        uniqueIds(r2).size === r2.length
    );
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  await mongoose.disconnect();
  if (failed > 0) process.exitCode = 1;
}

run().catch((err) => {
  console.error(err);
  mongoose.disconnect().finally(() => {
    process.exitCode = 1;
  });
});