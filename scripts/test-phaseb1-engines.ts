/**
 * Phase B.1 — DB-backed two-engine and backward-compatibility tests.
 *
 * Runs ONLY against the disposable mongod on 127.0.0.1:27019 and a
 * `taprevia_phaseb1_` database. No real credentials, no real data.
 */

import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { generateReviewSuggestion, type CompletionFn } from '@/lib/services/review-generate';
import { getReviewTemplateSuggestions } from '@/lib/services/review-templates';
import { getCardReviewEntitlement } from '@/lib/services/review-entitlement';
import { resolvePublicCardProfile, isPublicProfileCard } from '@/lib/services/card-access';
import {
  resolveStandeeGoogleReviewUrl,
  resolveStandeeReviewHost,
  resolveStandeeReviewProduct,
} from '@/lib/services/review-standee-settings';
import TenantSettings from '@/models/TenantSettings';
import { encryptSecret } from '@/lib/crypto';
import { ALIASES, IDS, assertIsolatedTarget, seedPhaseb1, snapshotProtectedData } from './phaseb1-fixtures';

assertIsolatedTarget();

const CENTRAL_ON = process.env.CENTRAL_REVIEW_PUBLIC_INTEGRATION_ENABLED === 'true';
const STANDEE_ON = process.env.STANDEE_REVIEW_ASSISTANT_ENABLED === 'true';
const today = () => new Date().toISOString().slice(0, 10);

const results: Array<{ name: string; pass: boolean; detail: string }> = [];
function check(name: string, pass: boolean, detail: string) {
  results.push({ name, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'} ${name} — ${detail}`);
}

async function configureAi(
  userId: unknown,
  options: {
    enabled?: boolean;
    key?: string;
    dailyLimit?: number;
    usage?: Record<string, number>;
    model?: string;
  }
): Promise<void> {
  const set: Record<string, unknown> = {};
  if (options.enabled !== undefined) set['openai.enabled'] = options.enabled;
  if (options.key !== undefined) set['openai.apiKeyEnc'] = options.key ? encryptSecret(options.key) : '';
  if (options.dailyLimit !== undefined) set['openai.dailyLimit'] = options.dailyLimit;
  if (options.usage !== undefined) set['openai.usage'] = options.usage;
  if (options.model !== undefined) set['openai.model'] = options.model;
  await TenantSettings.findOneAndUpdate(
    { userId },
    { $set: set, $setOnInsert: { userId } },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  ).exec();
}

async function clearAi(userId: unknown): Promise<void> {
  await TenantSettings.deleteMany({ userId }).exec();
}

const mock =
  (captured?: { input?: Parameters<CompletionFn>[0]; calls: number }, text = 'Mock OpenAI draft based on the customer words.'): CompletionFn =>
  async (input) => {
    if (captured) {
      captured.calls += 1;
      captured.input = input;
    }
    return {
      text,
      usage: { promptTokens: 11, completionTokens: 9, totalTokens: 20 },
    };
  };

async function main() {
  const before = await (async () => {
    await seedPhaseb1();
    return snapshotProtectedData();
  })();

  // ── Engine A: stored Review Library ──────────────────────────────────────
  const legacy = await generateReviewSuggestion({
    alias: ALIASES.legacy,
    feedback: 'The coffee and service were excellent.',
    topics: ['service'],
    ip: '127.0.0.1',
    userAgent: 'phaseb1',
  });
  check(
    'Legacy Card without source, no OpenAI → library + Card.name fallback',
    legacy.ok && legacy.engine === 'library' && legacy.review.includes('Legacy Business'),
    legacy.ok ? legacy.review.slice(0, 100) : legacy.code
  );

  const personal = await generateReviewSuggestion({
    alias: ALIASES.personal,
    feedback: 'The cosy coffee was great and the service was lovely.',
    topics: ['service'],
    ip: '127.0.0.1',
    userAgent: 'phaseb1',
  });
  check(
    'Library resolves employees, services, keywords and substitutes placeholders',
    personal.ok &&
      personal.engine === 'library' &&
      personal.review.includes('Asha') &&
      personal.review.includes('Coffee') &&
      personal.review.includes('cosy') &&
      personal.review.includes('Personal Business'),
    personal.ok ? personal.review : personal.code
  );

  const german = await generateReviewSuggestion({
    alias: ALIASES.lang,
    feedback: 'Der Kaffee war großartig.',
    language: 'German',
    ip: '127.0.0.1',
    userAgent: 'phaseb1',
  });
  check(
    'Library language matching selects the German template',
    german.ok && german.engine === 'library' && german.review.startsWith('Toller Service'),
    german.ok ? german.review : german.code
  );

  const rotationA = await generateReviewSuggestion({
    alias: ALIASES.rotation,
    feedback: 'A great visit.',
    ip: '127.0.0.1',
    userAgent: 'phaseb1',
  });
  const rotationB = await generateReviewSuggestion({
    alias: ALIASES.rotation,
    feedback: 'A great visit.',
    ip: '127.0.0.1',
    userAgent: 'phaseb1',
  });
  check(
    'Library rotation serves a different eligible template on the next request',
    rotationA.ok &&
      rotationB.ok &&
      rotationA.review !== rotationB.review,
    rotationA.ok && rotationB.ok ? `${rotationA.review} | ${rotationB.review}` : 'generation failed'
  );

  const noCategory = await generateReviewSuggestion({
    alias: ALIASES.noCategory,
    feedback: 'The coffee was excellent.',
    topics: ['service'],
    ip: '127.0.0.1',
    userAgent: 'phaseb1',
  });
  check(
    'Missing category → NO_MATCHING_REVIEW_TEMPLATE (not AI_NOT_CONFIGURED)',
    !noCategory.ok && noCategory.code === 'NO_MATCHING_REVIEW_TEMPLATE',
    noCategory.ok ? 'unexpected success' : noCategory.code
  );

  const disabled = await generateReviewSuggestion({
    alias: ALIASES.disabled,
    feedback: 'The coffee was excellent.',
    ip: '127.0.0.1',
    userAgent: 'phaseb1',
  });
  check(
    'AI Review disabled → NOT_FOUND with no generation',
    !disabled.ok && disabled.code === 'NOT_FOUND',
    disabled.ok ? 'unexpected success' : disabled.code
  );

  if (CENTRAL_ON) {
    const central = await generateReviewSuggestion({
      alias: ALIASES.central,
      feedback: 'The coffee and service were excellent.',
      topics: ['service'],
      ip: '127.0.0.1',
      userAgent: 'phaseb1',
    });
    check(
      'Central Card, no OpenAI → library with central businessName',
      central.ok && central.engine === 'library' && central.review.includes('Central Business'),
      central.ok ? central.review : central.code
    );

    const hybrid = await generateReviewSuggestion({
      alias: ALIASES.hybrid,
      feedback: 'The coffee and service were excellent.',
      topics: ['service'],
      ip: '127.0.0.1',
      userAgent: 'phaseb1',
    });
    check(
      'Hybrid Card → central settings with validated category override',
      hybrid.ok && hybrid.engine === 'library' && hybrid.review.includes('Central Business'),
      hybrid.ok ? hybrid.review : hybrid.code
    );

    // Empty central business name must fall back to the historical Card.name.
    const db = mongoose.connection.db!;
    await db.collection('reviewsettings').updateOne({ businessId: IDS.owner }, { $set: { 'general.businessName': '' } });
    const emptyName = await generateReviewSuggestion({
      alias: ALIASES.central,
      feedback: 'The coffee and service were excellent.',
      topics: ['service'],
      ip: '127.0.0.1',
      userAgent: 'phaseb1',
    });
    await db.collection('reviewsettings').updateOne({ businessId: IDS.owner }, { $set: { 'general.businessName': 'Central Business' } });
    check(
      'Empty central businessName falls back to Card.name',
      emptyName.ok && emptyName.engine === 'library' && emptyName.review.includes('Central Card'),
      emptyName.ok ? emptyName.review : emptyName.code
    );

    const otherLibrary = await generateReviewSuggestion({
      alias: ALIASES.other,
      feedback: 'The coffee and service were excellent.',
      topics: ['service'],
      ip: '127.0.0.1',
      userAgent: 'phaseb1',
    });
    check(
      'Cross-tenant central isolation uses the other tenant businessName',
      otherLibrary.ok && otherLibrary.engine === 'library' && otherLibrary.review.includes('Other Business') && !otherLibrary.review.includes('Central Business'),
      otherLibrary.ok ? otherLibrary.review : otherLibrary.code
    );
  } else {
    const centralOff = await generateReviewSuggestion({
      alias: ALIASES.central,
      feedback: 'The coffee and service were excellent.',
      ip: '127.0.0.1',
      userAgent: 'phaseb1',
    });
    check(
      'Central flag OFF → central Card resolves historical legacy (disabled) settings',
      !centralOff.ok && centralOff.code === 'NOT_FOUND',
      centralOff.ok ? 'unexpected central generation' : centralOff.code
    );

    const hybridOff = await generateReviewSuggestion({
      alias: ALIASES.hybrid,
      feedback: 'The coffee and service were excellent.',
      ip: '127.0.0.1',
      userAgent: 'phaseb1',
    });
    check(
      'Central flag OFF → hybrid overrides are ignored (legacy category)',
      !hybridOff.ok && hybridOff.code === 'NO_MATCHING_REVIEW_TEMPLATE',
      hybridOff.ok ? 'unexpected central generation' : hybridOff.code
    );

    const otherLegacy = await generateReviewSuggestion({
      alias: ALIASES.other,
      feedback: 'The coffee and service were excellent.',
      topics: ['service'],
      ip: '127.0.0.1',
      userAgent: 'phaseb1',
    });
    check(
      'Central flag OFF → other tenant legacy Card.name fallback',
      otherLegacy.ok && otherLegacy.engine === 'library' && otherLegacy.review.includes('Other Card'),
      otherLegacy.ok ? otherLegacy.review : otherLegacy.code
    );
  }

  // ── Engine B: customer OpenAI ────────────────────────────────────────────
  await configureAi(IDS.owner, { enabled: true, key: 'sk-phaseb1-owner', dailyLimit: 0, model: 'gpt-4o-mini' });
  const captured: { input?: Parameters<CompletionFn>[0]; calls: number } = { calls: 0 };
  const aiSuccess = await generateReviewSuggestion({
    alias: ALIASES.legacy,
    feedback: 'The coffee and service were excellent.',
    topics: ['service'],
    ip: '127.0.0.1',
    userAgent: 'phaseb1',
    complet: mock(captured, 'Editable OpenAI draft for the customer.'),
  });
  check(
    'Configured enabled OpenAI → provider draft, engine=openai',
    aiSuccess.ok && aiSuccess.engine === 'openai' && aiSuccess.review === 'Editable OpenAI draft for the customer.',
    aiSuccess.ok ? aiSuccess.review : aiSuccess.code
  );
  check(
    'OpenAI prompt receives decrypted tenant key and Card.name fallback',
    captured.input?.apiKey === 'sk-phaseb1-owner' &&
      captured.input?.user.includes('Legacy Business') &&
      captured.input?.user.includes('The coffee and service were excellent.') &&
      captured.input?.system.includes('friendly and warm') &&
      captured.input?.system.includes('medium (4-6 sentences)'),
    captured.input ? `key=${captured.input.apiKey.slice(0, 6)}… userHasName=${captured.input.user.includes('Legacy Business')}` : 'provider not called'
  );

  await configureAi(IDS.owner, { enabled: false, key: 'sk-phaseb1-owner', dailyLimit: 0 });
  const disabledProvider = await generateReviewSuggestion({
    alias: ALIASES.legacy,
    feedback: 'The coffee and service were excellent.',
    topics: [],
    ip: '127.0.0.1',
    userAgent: 'phaseb1',
  });
  check(
    'Customer OpenAI disabled → stored library',
    disabledProvider.ok && disabledProvider.engine === 'library',
    disabledProvider.ok ? disabledProvider.engine : disabledProvider.code
  );

  await configureAi(IDS.owner, { enabled: true, key: '', dailyLimit: 0 });
  const missingKey = await generateReviewSuggestion({
    alias: ALIASES.legacy,
    feedback: 'The coffee and service were excellent.',
    topics: [],
    ip: '127.0.0.1',
    userAgent: 'phaseb1',
  });
  check(
    'OpenAI enabled but key absent → stored library',
    missingKey.ok && missingKey.engine === 'library',
    missingKey.ok ? missingKey.engine : missingKey.code
  );

  await configureAi(IDS.owner, { enabled: true, key: 'sk-phaseb1-owner', dailyLimit: 0 });
  await TenantSettings.updateOne({ userId: IDS.owner }, { $set: { 'openai.apiKeyEnc': 'v1:not-a-payload' } }).exec();
  const invalidKey = await generateReviewSuggestion({
    alias: ALIASES.legacy,
    feedback: 'The coffee and service were excellent.',
    topics: [],
    ip: '127.0.0.1',
    userAgent: 'phaseb1',
    complet: mock(),
  });
  check(
    'Invalid/undecryptable key → UNAVAILABLE, no library fallback',
    !invalidKey.ok && invalidKey.code === 'UNAVAILABLE',
    invalidKey.ok ? `unexpected ${invalidKey.engine}` : invalidKey.code
  );

  await configureAi(IDS.owner, { enabled: true, key: 'sk-phaseb1-owner', dailyLimit: 0 });
  for (const [label, complet] of [
    [
      'Provider timeout',
      (async () => {
        throw new Error('synthetic timeout');
      }) as CompletionFn,
    ],
    [
      'Empty provider response',
      mock(undefined, '   '),
    ],
    [
      'Provider unavailable (503)',
      (async () => {
        throw new Error('OpenAI request failed (503)');
      }) as CompletionFn,
    ],
  ] as const) {
    const failed = await generateReviewSuggestion({
      alias: ALIASES.legacy,
      feedback: 'The coffee and service were excellent.',
      topics: [],
      ip: '127.0.0.1',
      userAgent: 'phaseb1',
      complet,
    });
    check(
      `${label} → UNAVAILABLE, no silent library fallback`,
      !failed.ok && failed.code === 'UNAVAILABLE',
      failed.ok ? `unexpected ${failed.engine}` : failed.code
    );
  }

  await configureAi(IDS.owner, {
    enabled: true,
    key: 'sk-phaseb1-owner',
    dailyLimit: 1,
    usage: { [today()]: 1 },
  });
  const dailyLimited = await generateReviewSuggestion({
    alias: ALIASES.legacy,
    feedback: 'The coffee and service were excellent.',
    topics: [],
    ip: '127.0.0.1',
    userAgent: 'phaseb1',
    complet: mock(),
  });
  check(
    'Daily usage limit → LIMIT_REACHED, no provider draft',
    !dailyLimited.ok && dailyLimited.code === 'LIMIT_REACHED',
    dailyLimited.ok ? 'unexpected success' : dailyLimited.code
  );

  // Per-alias burst limit is host-scoped; use an unused Card and clear the
  // synthetic counter first so the assertion is deterministic.
  const db = mongoose.connection.db!;
  await db.collection('ratecounters').deleteMany({});
  await configureAi(IDS.owner, { enabled: true, key: 'sk-phaseb1-owner', dailyLimit: 0 });
  let allowed = 0;
  let limitedResult: Awaited<ReturnType<typeof generateReviewSuggestion>> | null = null;
  for (let i = 0; i < 61; i += 1) {
    const result = await generateReviewSuggestion({
      alias: ALIASES.reviewCard,
      feedback: 'The coffee and service were excellent.',
      topics: [],
      ip: '127.0.0.1',
      userAgent: 'phaseb1',
      complet: mock(),
    });
    if (result.ok) allowed += 1;
    else {
      limitedResult = result;
      break;
    }
  }
  check(
    'Per-alias burst limit blocks the 61st provider request',
    allowed === 60 && limitedResult !== null && !limitedResult.ok && limitedResult.code === 'LIMIT_REACHED',
    `allowed=${allowed} result=${limitedResult && !limitedResult.ok ? limitedResult.code : 'none'}`
  );

  // ── Tenant isolation for the provider key ────────────────────────────────
  await configureAi(IDS.owner, { enabled: false, key: '', dailyLimit: 0 });
  await configureAi(IDS.other, { enabled: true, key: 'sk-phaseb1-other', dailyLimit: 0 });
  const otherCaptured: { input?: Parameters<CompletionFn>[0]; calls: number } = { calls: 0 };
  const otherAi = await generateReviewSuggestion({
    alias: ALIASES.other,
    feedback: 'The coffee and service were excellent.',
    topics: [],
    ip: '127.0.0.1',
    userAgent: 'phaseb1',
    complet: mock(otherCaptured, 'Other tenant draft.'),
  });
  check(
    'OpenAI credentials are tenant-isolated (other tenant uses its own key)',
    otherAi.ok && otherAi.engine === 'openai' && otherCaptured.input?.apiKey === 'sk-phaseb1-other',
    otherAi.ok ? `key=${otherCaptured.input?.apiKey}` : otherAi.code
  );
  await clearAi(IDS.other);

  // ── Backward compatibility: products, aliases, standee slots ─────────────
  const entitlementCases = [
    ['Premium NFC Card', IDS.premiumCard],
    ['Google Review Card', IDS.reviewCard],
    ['Google Review NFC Plate', IDS.plateCard],
  ] as const;
  for (const [label, cardId] of entitlementCases) {
    const entitlement = await getCardReviewEntitlement({
      _id: cardId,
      userId: IDS.owner,
      kind: label === 'Premium NFC Card' ? 'profile' : 'review',
      reviewAssistant: { enabled: true },
    });
    check(`Entitlement preserved for ${label}`, entitlement.entitled, `${entitlement.source}:${entitlement.productId ?? 'none'}`);
  }

  for (const [label, productId] of [
    ['Google Review Standee', IDS.standeeProduct],
    ['All In One Standee 3', IDS.aio3Product],
    ['All In One Standee 4', IDS.aio4Product],
  ] as const) {
    const entitlement = await getCardReviewEntitlement({
      _id: new mongoose.Types.ObjectId(),
      userId: IDS.owner,
      kind: 'profile',
      reviewAssistant: { enabled: false },
    });
    // Standees are resolved by the standee service, not card entitlement.
    const standee = (await db.collection('standees').findOne({
      _id: label === 'Google Review Standee' ? IDS.standee : label === 'All In One Standee 3' ? IDS.aio3 : IDS.aio4,
    })) as unknown as {
      _id: unknown;
      userId: unknown;
      name?: string;
      displayName?: string;
      socialQrs?: Array<{ platform?: string; destinationUrl?: string }>;
    } | null;
    const product = standee ? await resolveStandeeReviewProduct(standee) : null;
    check(
      `Standee review capability preserved for ${label}`,
      product !== null && product.catalogProductSlug === (productId === IDS.standeeProduct ? 'google-review-standee' : productId === IDS.aio3Product ? 'all-in-one-standee-3' : 'all-in-one-standee-4'),
      product ? `${product.catalogProductSlug} → ${product.googleReviewUrl}` : 'not resolved'
    );
    check(
      `${label} slot destination is unchanged`,
      product?.googleReviewUrl ===
        (label === 'Google Review Standee'
          ? 'https://g.page/r/standee/review'
          : label === 'All In One Standee 3'
            ? 'https://g.page/r/aio3/review'
            : 'https://g.page/r/aio4/review'),
      product ? product.googleReviewUrl : 'missing'
    );
    void entitlement;
  }

  for (const [label, alias] of [
    ['Legacy', ALIASES.legacy],
    ['Central', ALIASES.central],
    ['Premium', ALIASES.premium],
    ['Review Card', ALIASES.reviewCard],
    ['Plate', ALIASES.plate],
  ] as const) {
    const resolved = await resolvePublicCardProfile(alias);
    check(
      `Public alias/QR resolution preserved for ${label}`,
      Boolean(resolved) && (resolved?.urlAlias ?? resolved?.slug) === alias,
      resolved ? `alias=${resolved.urlAlias ?? resolved.slug}` : 'not resolved'
    );
  }
  const premiumProfile = await resolvePublicCardProfile(ALIASES.premium);
  check(
    'Premium NFC Card still resolves as a digital profile',
    isPublicProfileCard(premiumProfile),
    premiumProfile ? `kind=${premiumProfile.kind}` : 'not resolved'
  );

  if (STANDEE_ON) {
    for (const [label, slug, expectedUrl] of [
      ['Google Review Standee', ALIASES.standee, 'https://g.page/r/standee/review'],
      ['All In One Standee 3', ALIASES.aio3, 'https://g.page/r/aio3/review'],
      ['All In One Standee 4', ALIASES.aio4, 'https://g.page/r/aio4/review'],
    ] as const) {
      const host = await resolveStandeeReviewHost(slug);
      check(
        `${label} public host resolves with its original Google URL`,
        host !== null && host.googleReviewUrl === expectedUrl,
        host ? host.googleReviewUrl : 'not resolved'
      );
      const standee = (await db.collection('standees').findOne({ routeSlug: slug })) as unknown as {
        userId: unknown;
        socialQrs?: Array<{ platform?: string; destinationUrl?: string }>;
      } | null;
      const slotUrl = standee ? await resolveStandeeGoogleReviewUrl(standee) : null;
      check(`${label} Google Review slot fallback is unchanged`, slotUrl === expectedUrl, slotUrl ?? 'missing');
    }
  }

  // ── Data integrity ───────────────────────────────────────────────────────
  const after = await snapshotProtectedData();
  check(
    'Protected synthetic records are byte-identical (aliases, destinations, sources, library content)',
    JSON.stringify(before) === JSON.stringify(after),
    JSON.stringify(before) === JSON.stringify(after) ? 'no drift' : 'DRIFT DETECTED'
  );

  void assert;

  const failures = results.filter((r) => !r.pass);
  console.log('\n=== PHASE B.1 ENGINE SUMMARY ===');
  console.log(JSON.stringify({
    centralFlag: CENTRAL_ON ? 'ON' : 'OFF',
    standeeFlag: STANDEE_ON ? 'ON' : 'OFF',
    checks: results.length,
    passed: results.length - failures.length,
    failed: failures.length,
    failures,
  }, null, 2));
  await mongoose.disconnect();
  process.exit(failures.length === 0 ? 0 : 1);
}

main().catch(async (error) => {
  console.error(error);
  await mongoose.disconnect().catch(() => undefined);
  process.exit(1);
});
