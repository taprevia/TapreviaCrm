/**
 * Phase G — DB-backed tenant rollout integration.
 *
 * Run once per PHASEG_CASE with the corresponding rollout environment.
 * Refuses non-isolated databases.
 */

import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import Card from '@/models/Card';
import { generateReviewSuggestion } from '@/lib/services/review-generate';
import { resolveEffectiveReviewSettings } from '@/lib/services/review-effective-settings';
import { resolveStandeeReviewHost } from '@/lib/services/review-standee-settings';
import { getCentralIntegrationRollout } from '@/lib/services/review-rollout';
import {
  ALIASES,
  IDS,
  assertIsolatedTarget,
  seedPhaseb1,
} from './phaseb1-fixtures';

const CASE = process.env.PHASEG_CASE ?? '';
if (!['allow-a', 'allow-none', 'legacy-global', 'disabled', 'global-off'].includes(CASE)) {
  throw new Error(`Unknown PHASEG_CASE: ${CASE}`);
}

const results: Array<{ name: string; pass: boolean; detail: string }> = [];
function check(name: string, pass: boolean, detail: string) {
  results.push({ name, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'} ${name} — ${detail}`);
}

async function main() {
  assertIsolatedTarget();
  await seedPhaseb1();
  const aCard = (await Card.findById(IDS.centralCard).lean()) as unknown as
    | Parameters<typeof resolveEffectiveReviewSettings>[0]
    | null;
  const bCard = (await Card.findById(IDS.otherCard).lean()) as unknown as
    | Parameters<typeof resolveEffectiveReviewSettings>[0]
    | null;
  assert.ok(aCard && bCard, 'fixture cards missing');

  const [aEffective, bEffective] = await Promise.all([
    resolveEffectiveReviewSettings(aCard),
    resolveEffectiveReviewSettings(bCard),
  ]);
  const standeeHost = await resolveStandeeReviewHost(ALIASES.standee);
  assert.ok(standeeHost, 'standee host missing (STANDEE_REVIEW_ASSISTANT_ENABLED must be true)');

  const aRollout = getCentralIntegrationRollout(IDS.owner);
  const bRollout = getCentralIntegrationRollout(IDS.other);

  const aGen = await generateReviewSuggestion({
    alias: ALIASES.central,
    feedback: 'The coffee and service were excellent.',
    topics: ['service'],
    ip: '127.0.0.1',
    userAgent: 'phaseg',
  });
  const bGen = await generateReviewSuggestion({
    alias: ALIASES.other,
    feedback: 'The coffee and service were excellent.',
    topics: ['service'],
    ip: '127.0.0.1',
    userAgent: 'phaseg',
  });

  if (CASE === 'allow-a') {
    check('A allowlisted rollout effective', aRollout.effective, aRollout.reason);
    check('B not allowlisted rollout denied', !bRollout.effective, bRollout.reason);
    check('A central Card resolves central settings', aEffective.source === 'central' && aEffective.businessName === 'Central Business', `${aEffective.source}/${aEffective.businessName}`);
    check('B central Card falls back to legacy', bEffective.source === 'legacy', bEffective.source);
    check('A standee resolves central settings', standeeHost.config.source === 'central' && standeeHost.config.businessName === 'Central Business', `${standeeHost.config.source}/${standeeHost.config.businessName}`);
    check('A public library uses central business name', aGen.ok && aGen.engine === 'library' && aGen.review.includes('Central Business'), aGen.ok ? aGen.review.slice(0, 90) : aGen.code);
    check('B public library uses legacy fallback', bGen.ok && bGen.engine === 'library' && bGen.review.includes('Other Card'), bGen.ok ? bGen.review.slice(0, 90) : bGen.code);
  } else if (CASE === 'allow-none') {
    check('A not allowlisted rollout denied', !aRollout.effective, aRollout.reason);
    check('B not allowlisted rollout denied', !bRollout.effective, bRollout.reason);
    check('A central Card falls back to legacy (disabled review)', aEffective.source === 'legacy' && !aEffective.enabled, `${aEffective.source}/enabled=${aEffective.enabled}`);
    check('B central Card falls back to legacy', bEffective.source === 'legacy', bEffective.source);
    check('A standee falls back to legacy', standeeHost.config.source === 'legacy', standeeHost.config.source);
    check('A public central Card is unavailable', !aGen.ok && aGen.code === 'NOT_FOUND', aGen.ok ? 'unexpected success' : aGen.code);
    check('B public library uses legacy fallback', bGen.ok && bGen.engine === 'library' && bGen.review.includes('Other Card'), bGen.ok ? bGen.review.slice(0, 90) : bGen.code);
  } else if (CASE === 'legacy-global') {
    check('historical legacy-global keeps A effective', aRollout.effective, aRollout.reason);
    check('historical legacy-global keeps B effective', bRollout.effective, bRollout.reason);
    check('A central Card resolves central settings', aEffective.source === 'central' && aEffective.businessName === 'Central Business', `${aEffective.source}/${aEffective.businessName}`);
    check('B central Card resolves central settings', bEffective.source === 'central' && bEffective.businessName === 'Other Business', `${bEffective.source}/${bEffective.businessName}`);
    check('A standee resolves central settings', standeeHost.config.source === 'central', standeeHost.config.source);
    check('A public library uses central business name', aGen.ok && aGen.review.includes('Central Business'), aGen.ok ? aGen.review.slice(0, 90) : aGen.code);
    check('B public library uses central business name', bGen.ok && bGen.review.includes('Other Business'), bGen.ok ? bGen.review.slice(0, 90) : bGen.code);
  } else if (CASE === 'disabled' || CASE === 'global-off') {
    check('rollout denied for A', !aRollout.effective, aRollout.reason);
    check('rollout denied for B', !bRollout.effective, bRollout.reason);
    check('A central Card falls back to legacy (disabled review)', aEffective.source === 'legacy' && !aEffective.enabled, `${aEffective.source}/enabled=${aEffective.enabled}`);
    check('B central Card falls back to legacy', bEffective.source === 'legacy', bEffective.source);
    check('A standee falls back to legacy', standeeHost.config.source === 'legacy', standeeHost.config.source);
    check('A public central Card is unavailable', !aGen.ok && aGen.code === 'NOT_FOUND', aGen.ok ? 'unexpected success' : aGen.code);
    check('B public library uses legacy fallback', bGen.ok && bGen.review.includes('Other Card'), bGen.ok ? bGen.review.slice(0, 90) : bGen.code);
  }

  const failures = results.filter((r) => !r.pass);
  console.log('\n=== PHASE G ROLLOUT INTEGRATION SUMMARY ===');
  console.log(JSON.stringify({ case: CASE, checks: results.length, passed: results.length - failures.length, failed: failures.length, failures }, null, 2));
  await mongoose.disconnect();
  process.exit(failures.length === 0 ? 0 : 1);
}

main().catch(async (error) => {
  console.error(error);
  await mongoose.disconnect().catch(() => undefined);
  process.exit(1);
});
