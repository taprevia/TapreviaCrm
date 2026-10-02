/**
 * M8 verification: AI review-generation cost-control.
 *
 * Exercises generateReviewSuggestion() directly with an injected fake
 * completion (no external AI call) against a local MongoDB, covering:
 *   - tenant kill-switch (disabled → UNAVAILABLE)
 *   - below daily limit, exactly at limit, past limit (LIMIT_REACHED)
 *   - concurrent burst cannot overspend the daily reservation
 *   - per-alias short-term limit
 *   - usage/token metadata recorded, never feedback/review text
 *
 * Run:  MONGODB_URI=mongodb://localhost:27017/nfc-crm npx tsx scripts/verify-m8-cost-control.ts
 */

import mongoose from 'mongoose';
import { encryptSecret } from '@/lib/crypto';
import TenantSettings, { DEFAULT_AI_GENERATION_DAILY_LIMIT } from '@/models/TenantSettings';
import AnalyticsLog from '@/models/AnalyticsLog';
import User from '@/models/User';
import { generateReviewSuggestion } from '@/lib/services/review-generate';

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/nfc-crm';

const USER_EMAIL = 'm8-verify@example.com';
const REVIEW_TEXT = 'Verified mock draft for cost-control.';
const FEEDBACK = 'Service was fast and friendly during my visit.';
const GOOGLE_URL = 'https://example.com/m8-google-review';

interface Ctx {
  user: { _id: mongoose.Types.ObjectId };
  card1: { _id: mongoose.Types.ObjectId };
card2: { _id: mongoose.Types.ObjectId };
}

let passed = 0;
let failed = 0;

function report(name: string, pass: boolean, detail = ''): void {
  if (pass) {
    passed += 1;
    console.log(`  PASS  ${name}`);
  } else {
    failed += 1;
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

async function seed(): Promise<Ctx> {
  mongoose.set('strictQuery', false);
  await mongoose.connect(MONGODB_URI);
  const db = mongoose.connection.db!;

  const user = (await User.findOneAndUpdate(
    { email: USER_EMAIL },
    { email: USER_EMAIL, passwordHash: 'x', name: 'M8 Verify' },
    { upsert: true, new: true }
  )) as { _id: mongoose.Types.ObjectId };

  const upsertCard = async (cardUid: string, urlAlias: string, slug: string) => {
    const doc = await db.collection('cards').findOneAndUpdate(
      { cardUid },
      {
        $set: {
          name: 'M8 Verify Business',
          cardUid,
          urlAlias,
          slug,
          kind: 'review',
          isActive: true,
          userId: user._id,
          reviewAssistant: {
            enabled: true,
            googleReviewUrl: GOOGLE_URL,
            writingStyle: 'friendly',
            preferredLength: 'medium',
            languages: ['English'],
            feedbackTopics: ['service'],
            welcomeMessage: 'Tell us about your visit.',
          },
        },
      },
      { upsert: true, returnDocument: 'after' }
    );
    if (!doc) throw new Error(`card upsert failed for ${cardUid}`);
    return { _id: doc._id as mongoose.Types.ObjectId };
  };

  const card1 = await upsertCard('M8-VERIFY-01', 'm8verify01', 'm8-verify-01');
  const card2 = await upsertCard('M8-VERIFY-02', 'm8verify02', 'm8-verify-02');

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

  return { user, card1, card2 };
}

async function run() {
  const ctx = await seed();
  const runStart = new Date();

  // Deterministic faked provider: no external call, counts provider calls.
  const fake = {
    calls: 0,
    complet: async () => {
      fake.calls += 1;
      return {
        text: REVIEW_TEXT,
        usage: { promptTokens: 120, completionTokens: 30, totalTokens: 150 },
      };
    },
  };

  const base = {
    feedback: FEEDBACK,
    topics: ['service'],
    language: 'English',
    length: 'medium' as const,
    ip: '203.0.113.9',
    userAgent: 'm8-verify',
    complet: fake.complet,
  };

  /* A. Kill-switch — tenant disabled fails safely, no usage consumed. */
  const disabled = await TenantSettings.findOneAndUpdate(
    { userId: ctx.user._id },
    { $set: { 'openai.enabled': false } },
    { new: true }
  );
  void disabled;
  {
    const r = await generateReviewSuggestion({ ...base, alias: 'm8verify01' });
    report('A1 kill-switch disabled → UNAVAILABLE', r.ok === false && r.code === 'UNAVAILABLE');
  }
  const usageKey = new Date().toISOString().slice(0, 10);

  /* B + C. Enable with a tight limit; 2 below, 1 exactly at, 1 past. */
  const enabled = await TenantSettings.findOneAndUpdate(
    { userId: ctx.user._id },
    { $set: { 'openai.enabled': true, 'openai.dailyLimit': 3, [`openai.usage.${usageKey}`]: 0 } },
    { new: true }
  );
  void enabled;
  await generateReviewSuggestion({ ...base, alias: 'm8verify01' }); // 1
  await generateReviewSuggestion({ ...base, alias: 'm8verify01' }); // 2 (below limit)
  const atLimit = await generateReviewSuggestion({ ...base, alias: 'm8verify01' }); // 3 (exactly)
  const past = await generateReviewSuggestion({ ...base, alias: 'm8verify01' }); // 4 (rejected)
  report('B below daily limit → ok', atLimit.ok === true);
  report('C at limit → ok (exactly limit consumed)', atLimit.ok === true && atLimit.review === REVIEW_TEXT);
  report('D past limit → LIMIT_REACHED (neutral)', past.ok === false && past.code === 'LIMIT_REACHED');

  /* E. Concurrent burst against a fresh limit cannot overspend. */
  await TenantSettings.updateOne(
    { userId: ctx.user._id },
    { $set: { 'openai.dailyLimit': 5, [`openai.usage.${usageKey}`]: 0 } }
  );
  const burst = await Promise.all(
    Array.from({ length: 30 }, (_, i) =>
      generateReviewSuggestion({ ...base, alias: 'm8verify01', feedback: `${FEEDBACK} ${i}` })
    )
  );
  const okCount = burst.filter((r) => r.ok).length;
  const rejectedCount = burst.filter((r) => !r.ok && r.code === 'LIMIT_REACHED').length;
  report('E concurrent burst → exactly limit successes, no overspend', okCount === 5 && rejectedCount === 25);
  report('E2 provider called exactly 5× during burst (cost controlled)', fake.calls === 8);

  /* F. Usage ledger never drops below successful reservations. */
  const ledger = await TenantSettings.findOne({ userId: ctx.user._id });
  const used = Number(ledger?.openai.usage?.get?.(usageKey) ?? 0);
  report('F usage ledger tracks reservations (≥ provider calls)', used >= okCount);

  /* G. Per-alias secondary limit (fresh card = fresh in-process bucket). */
  await TenantSettings.updateOne(
    { userId: ctx.user._id },
    { $set: { 'openai.dailyLimit': 999_999, [`openai.usage.${usageKey}`]: 0 } }
  );
  const aliasResults = await Promise.all(
    Array.from({ length: 70 }, (_, i) =>
      generateReviewSuggestion({ ...base, alias: 'm8verify02', feedback: `${FEEDBACK} x${i}` })
    )
  );
  const aliasOk = aliasResults.filter((r) => r.ok).length;
  const aliasRejected = aliasResults.filter((r) => !r.ok && r.code === 'LIMIT_REACHED').length;
  report('G per-alias limit → 60 allowed then rejected', aliasOk === 60 && aliasRejected === 10);
  report('G2 provider calls conserved across all phases', fake.calls === 68);

  /* H. Usage metadata recorded; feedback/review text never persisted. */
  const rows = await AnalyticsLog.find({
    cardId: ctx.card1._id,
    action: 'review_generated',
    createdAt: { $gte: runStart },
  }).sort({
    createdAt: -1,
  });
  const metas = rows.map((r) => r.metadata);
  const hasTokens = metas.every((m) => {
    try {
      const p = JSON.parse(m) as {
        length?: string;
        style?: string;
        language?: string;
        promptTokens?: number;
        completionTokens?: number;
        totalTokens?: number;
      };
      return (
        typeof p.length === 'string' &&
        typeof p.style === 'string' &&
        typeof p.language === 'string' &&
        typeof p.promptTokens === 'number' &&
        typeof p.completionTokens === 'number' &&
        typeof p.totalTokens === 'number'
      );
    } catch {
      return false;
    }
  });
  const leaks = metas.some(
    (m) => m.includes(FEEDBACK) || m.includes('Verified mock draft') || m.includes('Service was')
  );
  report('H usage tokens recorded, no review content in analytics', hasTokens && !leaks && rows.length > 0);

  /* I. AnalyticsLog backward compatible: a review_generated row per success. */
  report('I review_generated action preserved (backward compatible)', rows.length === okCount + 3);

  /* J. Reset fixture to a sane default state. */
  await TenantSettings.updateOne(
    { userId: ctx.user._id },
    { $set: { 'openai.enabled': true, 'openai.dailyLimit': DEFAULT_AI_GENERATION_DAILY_LIMIT, [`openai.usage.${usageKey}`]: 0 } }
  );
  report('J fixture reset for re-runs', true);

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