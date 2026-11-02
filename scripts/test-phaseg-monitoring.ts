/**
 * Phase G — privacy-safe event and local alert-rule tests.
 */

import assert from 'node:assert/strict';
import {
  classifyProviderError,
  emitReviewEvent,
  tenantCorrelation,
} from '@/lib/services/review-observability';
import {
  DEFAULT_REVIEW_ALERT_THRESHOLDS,
  evaluateReviewAlerts,
  type ReviewAlertSnapshot,
} from '@/lib/services/review-alert-rules';

process.env.JWT_SECRET =
  process.env.JWT_SECRET || 'phaseg-monitoring-test-secret-not-real';

const A = '0000000000000000000b1001';
const B = '0000000000000000000b1002';

let checks = 0;
let failures = 0;
function check(name: string, fn: () => void) {
  checks += 1;
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    failures += 1;
    console.log(`FAIL ${name} — ${error instanceof Error ? error.message : String(error)}`);
  }
}

const captured: string[] = [];
const original = { info: console.info, warn: console.warn, error: console.error };
console.info = (...args: unknown[]) => { captured.push(args.map(String).join(' ')); };
console.warn = (...args: unknown[]) => { captured.push(args.map(String).join(' ')); };
console.error = (...args: unknown[]) => { captured.push(args.map(String).join(' ')); };

try {
  check('tenant correlation is stable, non-raw and tenant-distinct', () => {
    const one = tenantCorrelation(A);
    const again = tenantCorrelation(A);
    const other = tenantCorrelation(B);
    assert.equal(one, again);
    assert.notEqual(one, other);
    assert.equal(one.includes(A), false);
    assert.ok(/^[a-f0-9]{12}$|^unavailable$/.test(one));
  });
  check('success event emits sanitized JSON with engine/outcome/correlation', () => {
    captured.length = 0;
    emitReviewEvent({
      event: 'review.generation.success',
      engine: 'library',
      hostType: 'card',
      outcome: 'success',
      tenantId: A,
      durationMs: 12,
    });
    assert.equal(captured.length, 1);
    const payload = JSON.parse(captured[0]);
    assert.equal(payload.event, 'review.generation.success');
    assert.equal(payload.engine, 'library');
    assert.equal(payload.outcome, 'success');
    assert.equal(payload.hostType, 'card');
    assert.equal(payload.durationMs, 12);
    assert.ok(payload.tenantCorrelation);
    assert.equal(captured[0].includes(A), false);
  });
  check('event helper ignores extra sensitive runtime fields', () => {
    captured.length = 0;
    emitReviewEvent({
      event: 'review.generation.failure',
      hostType: 'card',
      outcome: 'failure',
      errorCategory: 'provider_5xx',
      tenantId: A,
      // Deliberately injected at runtime; must never be serialized.
      feedback: 'private customer feedback',
      review: 'private generated review',
      apiKey: 'sk-private-key',
    } as never);
    const line = captured[0];
    assert.equal(line.includes('private customer feedback'), false);
    assert.equal(line.includes('private generated review'), false);
    assert.equal(line.includes('sk-private-key'), false);
    assert.equal(line.includes('/sk-/'), false);
  });
  check('provider error classification separates timeout/4xx/5xx/unavailable', () => {
    assert.equal(classifyProviderError(new Error('request timeout')), 'provider_timeout');
    assert.equal(classifyProviderError(new Error('OpenAI request failed (401)')), 'provider_4xx');
    assert.equal(classifyProviderError(new Error('OpenAI request failed (503)')), 'provider_5xx');
    assert.equal(classifyProviderError(new Error('network reset')), 'provider_unavailable');
  });

  const zero: ReviewAlertSnapshot = {
    windowMinutes: 5,
    healthFailures: 0,
    providerTimeouts: 0,
    providerUnavailable: 0,
    provider4xx: 0,
    provider5xx: 0,
    emptyResponses: 0,
    dailyLimitHits: 0,
    aliasLimitHits: 0,
    rolloutDenied: 0,
    tenantBoundaryDenials: 0,
    publicEndpointFailures: 0,
    resolver404: 0,
    resolver5xx: 0,
    generationVolume: 0,
  };
  check('zero snapshot produces no alerts', () => {
    assert.equal(evaluateReviewAlerts(zero).length, 0);
  });
  check('health failure is critical', () => {
    const alerts = evaluateReviewAlerts({ ...zero, healthFailures: 1 });
    assert.equal(alerts[0]?.code, 'review_health_failure');
    assert.equal(alerts[0]?.severity, 'critical');
  });
  check('provider timeout threshold is warning', () => {
    const alerts = evaluateReviewAlerts({ ...zero, providerTimeouts: DEFAULT_REVIEW_ALERT_THRESHOLDS.providerTimeouts });
    assert.ok(alerts.some((a) => a.code === 'review_provider_timeout_spike' && a.severity === 'warning'));
  });
  check('provider 5xx threshold is critical', () => {
    const alerts = evaluateReviewAlerts({ ...zero, provider5xx: DEFAULT_REVIEW_ALERT_THRESHOLDS.provider5xx });
    assert.ok(alerts.some((a) => a.code === 'review_provider_5xx_spike' && a.severity === 'critical'));
  });
  check('combined limit threshold is warning', () => {
    const alerts = evaluateReviewAlerts({ ...zero, dailyLimitHits: 10, aliasLimitHits: 10 });
    assert.ok(alerts.some((a) => a.code === 'review_limit_spike'));
  });
  check('tenant boundary anomalies are critical', () => {
    const alerts = evaluateReviewAlerts({ ...zero, tenantBoundaryDenials: 3 });
    assert.ok(alerts.some((a) => a.code === 'review_tenant_boundary_anomaly' && a.severity === 'critical'));
  });
  check('resolver 404/5xx errors combine into one warning', () => {
    const alerts = evaluateReviewAlerts({ ...zero, resolver404: 5, resolver5xx: 6 });
    assert.ok(alerts.some((a) => a.code === 'review_resolver_error_spike'));
  });
  check('generation volume anomaly is warning', () => {
    const alerts = evaluateReviewAlerts({ ...zero, generationVolume: 501 });
    assert.ok(alerts.some((a) => a.code === 'review_generation_volume_anomaly'));
  });
} finally {
  console.info = original.info;
  console.warn = original.warn;
  console.error = original.error;
}

console.log('\n=== PHASE G MONITORING SUMMARY ===');
console.log(JSON.stringify({ checks, passed: checks - failures, failed: failures }, null, 2));
process.exit(failures === 0 ? 0 : 1);
