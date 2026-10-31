/**
 * Smart Review Rotation feature gate.
 *
 * Kept as a compatibility module: every existing import path continues to
 * resolve. The flags themselves live in `review-feature-flags.ts`, which also
 * contains the independent customer copy-flow flag and the effective rotation
 * value (rotation is inert unless the copy flow is enabled).
 */
export {
  COPY_FLOW_ACTIVE,
  NEW_REVIEW_COPY_FLOW_ENABLED,
  REVIEW_ROTATION_ACTIVE,
  SMART_REVIEW_ROTATION_ENABLED,
} from '@/lib/review-feature-flags';
