/**
 * Local, dependency-free alert-rule evaluation for AI Review operations.
 *
 * This is a pure specification/evaluator. It does not deliver alerts and does
 * not claim that production alerting exists. A future approved metrics backend
 * can feed these counters. Thresholds are intentionally conservative.
 */

export interface ReviewAlertSnapshot {
  windowMinutes: number;
  healthFailures: number;
  providerTimeouts: number;
  providerUnavailable: number;
  provider4xx: number;
  provider5xx: number;
  emptyResponses: number;
  dailyLimitHits: number;
  aliasLimitHits: number;
  rolloutDenied: number;
  tenantBoundaryDenials: number;
  publicEndpointFailures: number;
  resolver404: number;
  resolver5xx: number;
  generationVolume: number;
}

export interface ReviewAlertThresholds {
  healthFailures: number;
  providerTimeouts: number;
  providerUnavailable: number;
  provider4xx: number;
  provider5xx: number;
  emptyResponses: number;
  limitHits: number;
  tenantBoundaryDenials: number;
  publicEndpointFailures: number;
  resolverErrors: number;
  generationVolume: number;
}

export interface ReviewAlert {
  code: string;
  severity: 'warning' | 'critical';
  message: string;
  value: number;
  threshold: number;
  windowMinutes: number;
}

export const DEFAULT_REVIEW_ALERT_THRESHOLDS: ReviewAlertThresholds = {
  healthFailures: 1,
  providerTimeouts: 5,
  providerUnavailable: 5,
  provider4xx: 10,
  provider5xx: 5,
  emptyResponses: 5,
  limitHits: 20,
  tenantBoundaryDenials: 3,
  publicEndpointFailures: 5,
  resolverErrors: 10,
  generationVolume: 500,
};

export function evaluateReviewAlerts(
  snapshot: ReviewAlertSnapshot,
  thresholds: ReviewAlertThresholds = DEFAULT_REVIEW_ALERT_THRESHOLDS
): ReviewAlert[] {
  const alerts: ReviewAlert[] = [];
  const add = (
    code: string,
    severity: ReviewAlert['severity'],
    message: string,
    value: number,
    threshold: number
  ) => {
    if (value >= threshold) {
      alerts.push({
        code,
        severity,
        message,
        value,
        threshold,
        windowMinutes: snapshot.windowMinutes,
      });
    }
  };

  add(
    'review_health_failure',
    'critical',
    'Review health checks are failing.',
    snapshot.healthFailures,
    thresholds.healthFailures
  );
  add(
    'review_provider_timeout_spike',
    'warning',
    'Provider timeouts are above the configured threshold.',
    snapshot.providerTimeouts,
    thresholds.providerTimeouts
  );
  add(
    'review_provider_unavailable_spike',
    'critical',
    'Provider unavailable failures are above the configured threshold.',
    snapshot.providerUnavailable,
    thresholds.providerUnavailable
  );
  add(
    'review_provider_4xx_spike',
    'warning',
    'Provider 4xx failures are above the configured threshold.',
    snapshot.provider4xx,
    thresholds.provider4xx
  );
  add(
    'review_provider_5xx_spike',
    'critical',
    'Provider 5xx failures are above the configured threshold.',
    snapshot.provider5xx,
    thresholds.provider5xx
  );
  add(
    'review_empty_response_spike',
    'warning',
    'Empty provider responses are above the configured threshold.',
    snapshot.emptyResponses,
    thresholds.emptyResponses
  );
  add(
    'review_limit_spike',
    'warning',
    'Daily or per-alias review limits are being hit frequently.',
    snapshot.dailyLimitHits + snapshot.aliasLimitHits,
    thresholds.limitHits
  );
  add(
    'review_tenant_boundary_anomaly',
    'critical',
    'Tenant-boundary denials are above the configured threshold.',
    snapshot.tenantBoundaryDenials,
    thresholds.tenantBoundaryDenials
  );
  add(
    'review_public_endpoint_failure',
    'critical',
    'Public review endpoint failures are above the configured threshold.',
    snapshot.publicEndpointFailures,
    thresholds.publicEndpointFailures
  );
  add(
    'review_resolver_error_spike',
    'warning',
    'NFC/QR resolver errors are above the configured threshold.',
    snapshot.resolver404 + snapshot.resolver5xx,
    thresholds.resolverErrors
  );
  add(
    'review_generation_volume_anomaly',
    'warning',
    'Review generation volume is above the configured threshold.',
    snapshot.generationVolume,
    thresholds.generationVolume
  );

  return alerts;
}
