/**
 * Core product experiences — the single client-safe source of truth for what
 * a purchased product unlocks.
 *
 * There are exactly four software experiences. Every catalog product belongs
 * to exactly one of them via `CatalogProduct.kind`; physical/material variants
 * (PVC, metal, size, …) never affect software access.
 *
 *   profile → Business Profile + its on-card social buttons
 *   social  → Social Media Links (redirect cards) with an allowed link limit
 *   review  → Google Review Assistant
 *   standee → Standee QR codes + shared links
 *
 * Features are referenced by KEY everywhere (never by product name/slug), so
 * products stay decoupled from specific business names. Access is FIXED per
 * experience — the only product-level variable is the social-links limit
 * (`CatalogProduct.features.social.max`, 1–4, see feature-access.ts).
 *
 * This module is shared between server (src/lib/services/feature-access.ts)
 * and client components, so it must not import server-only modules.
 */

import type { FeatureKey } from '@/types';

export type { FeatureKey, IFeatureConfig } from '@/types';

export const FEATURE_KEYS: readonly FeatureKey[] = ['profile', 'social', 'review', 'standee'];

/**
 * The four core software experiences. `CatalogProduct.kind` holds exactly
 * one of these values (legacy values `card`/`multi-standee` are mapped during
 * resolution for backward compatibility).
 */
export type Experience = FeatureKey;

export const EXPERIENCES: readonly Experience[] = FEATURE_KEYS;

/**
 * Business rule: a social product allows between 1 and 4 links. This is both
 * the default cap for every experience that grants the `social` feature and
 * the maximum a product's own `features.social.max` may raise it to.
 */
export const DEFAULT_SOCIAL_LINKS_MAX = 4;

export interface FeatureDef {
  key: FeatureKey;
  label: string;
  description: string;
  /** Whether this feature carries a configurable count limit. */
  hasMax: boolean;
}

export const FEATURE_DEFS: Record<FeatureKey, FeatureDef> = {
  profile: {
    key: 'profile',
    label: 'Profile vCards',
    description: 'Build, publish and share digital profile cards.',
    hasMax: false,
  },
  social: {
    key: 'social',
    label: 'Social links',
    description: 'Social-media buttons on your cards and shareable QR links.',
    hasMax: true,
  },
  review: {
    key: 'review',
    label: 'AI Review Assistant',
    description: 'AI-assisted Google review drafts.',
    hasMax: false,
  },
  standee: {
    key: 'standee',
    label: 'Standees & QRs',
    description: 'Counter standee QR codes and their shared links.',
    hasMax: false,
  },
};

export const FEATURE_DEF_LIST: FeatureDef[] = Object.values(FEATURE_DEFS);

/** Fixed per-experience access rules. Keyed by experience = CatalogProduct.kind. */
export interface ExperienceRules {
  label: string;
  description: string;
  features: Partial<Record<FeatureKey, { enabled: true; max?: number }>>;
}

export const EXPERIENCE_RULES: Record<Experience, ExperienceRules> = {
  profile: {
    label: 'Business Profile',
    description: 'Trade card with a digital profile page (and its social buttons).',
    features: {
      profile: { enabled: true },
      social: { enabled: true, max: DEFAULT_SOCIAL_LINKS_MAX },
    },
  },
  social: {
    label: 'Social Media Links',
    description: 'Redirect card that routes visitors straight to your socials.',
    features: {
      social: { enabled: true, max: DEFAULT_SOCIAL_LINKS_MAX },
    },
  },
  review: {
    label: 'Google Review',
    description: 'AI Review Assistant for Google reviews.',
    features: {
      review: { enabled: true },
    },
  },
  standee: {
    label: 'Standee',
    description: 'Counter standee QR codes and their shared links.',
    features: {
      standee: { enabled: true },
    },
  },
};

export const EXPERIENCE_LIST: ExperienceRules[] = Object.values(EXPERIENCE_RULES);

/** Legacy kind values → experience, so older data keeps working. */
export const LEGACY_KIND_TO_EXPERIENCE: Readonly<Record<string, Experience>> = {
  card: 'profile',
  'multi-standee': 'standee',
};

/** Map a stored CatalogProduct.kind (incl. legacy values) to one of the four experiences. */
export function resolveExperience(kind?: string): Experience | undefined {
  if (!kind) return undefined;
  if ((EXPERIENCES as readonly string[]).includes(kind)) return kind as Experience;
  return LEGACY_KIND_TO_EXPERIENCE[kind];
}