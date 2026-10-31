/**
 * Review feature gates (server-only).
 *
 * Two independent switches let the customer copy-flow UI be tested without
 * enabling Smart Review Rotation:
 *   - NEW_REVIEW_COPY_FLOW_ENABLED: the two-button customer copy experience.
 *   - SMART_REVIEW_ROTATION_ENABLED: rotation exclusions/tokens/recording.
 *   - CENTRAL_REVIEW_PUBLIC_INTEGRATION_ENABLED: public reads may use central
 *     ReviewSettings. Independent of copy/rotation; default OFF.
 *   - STANDEE_REVIEW_ASSISTANT_ENABLED: Google Review Standee public review
 *     host. Independent of copy/rotation/central flags; default OFF.
 *
 * Rotation is only effective when the copy flow is also enabled, because the
 * new customer actions are the only path that records rotation copies. If the
 * rotation flag is set alone, it is intentionally inert and a safe warning is
 * emitted once at startup.
 *
 * Both flags default to false and require the exact string "true".
 * This module must only be imported by server code (pages, route handlers,
 * server services). It is not a client module.
 */

function envTrue(name: string): boolean {
  return process.env[name] === 'true';
}

export const NEW_REVIEW_COPY_FLOW_ENABLED = envTrue('NEW_REVIEW_COPY_FLOW_ENABLED');
export const SMART_REVIEW_ROTATION_ENABLED = envTrue('SMART_REVIEW_ROTATION_ENABLED');
export const CENTRAL_REVIEW_PUBLIC_INTEGRATION_ENABLED = envTrue('CENTRAL_REVIEW_PUBLIC_INTEGRATION_ENABLED');
export const STANDEE_REVIEW_ASSISTANT_ENABLED = envTrue('STANDEE_REVIEW_ASSISTANT_ENABLED');

/** The customer two-button copy experience. */
export const COPY_FLOW_ACTIVE = NEW_REVIEW_COPY_FLOW_ENABLED;

/** Rotation is only active when the copy flow that records copies is active. */
export const REVIEW_ROTATION_ACTIVE =
  NEW_REVIEW_COPY_FLOW_ENABLED && SMART_REVIEW_ROTATION_ENABLED;

if (SMART_REVIEW_ROTATION_ENABLED && !NEW_REVIEW_COPY_FLOW_ENABLED) {
  console.warn(
    '[review-flags] SMART_REVIEW_ROTATION_ENABLED is set but NEW_REVIEW_COPY_FLOW_ENABLED is not; rotation remains inactive because no active copy path would record it.'
  );
}
