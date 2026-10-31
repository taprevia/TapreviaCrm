/**
 * Deterministic variation selection for varied style/length modes.
 *
 * Variation belongs in the generation layer, never in the pure settings
 * resolver. A UTC day seed keeps behavior stable and testable while still
 * rotating naturally over time. Explicit customer choices always win.
 */

import type { ReviewPreferredLength, ReviewWritingStyle } from '@/types';
import type { ReviewMode } from '@/lib/review-settings-defaults';

const STYLES: readonly ReviewWritingStyle[] = [
  'friendly',
  'professional',
  'casual',
  'simple',
];
const LENGTHS: readonly ReviewPreferredLength[] = ['short', 'medium', 'detailed'];

function daySeed(now?: Date): number {
  return Math.floor((now ?? new Date()).getTime() / 86_400_000);
}

export function selectVariedStyle(
  preferred: ReviewWritingStyle | undefined,
  mode: ReviewMode | undefined,
  now?: Date
): ReviewWritingStyle {
  const base = preferred ?? 'friendly';
  if (mode !== 'varied') return base;
  return STYLES[daySeed(now) % STYLES.length] ?? base;
}

export function selectVariedLength(
  preferred: ReviewPreferredLength | undefined,
  mode: ReviewMode | undefined,
  now?: Date,
  explicit = false
): ReviewPreferredLength {
  const base = preferred ?? 'medium';
  if (mode !== 'varied' || explicit) return base;
  return LENGTHS[(daySeed(now) + 1) % LENGTHS.length] ?? base;
}
