/**
 * Hard-coded platform product catalog.
 *
 * This is the SINGLE source of truth for all product definitions. Products are
 * defined in code, not in the database. Admins CANNOT create, edit, or delete
 * products from the UI — they can only assign predefined products to customers.
 *
 * Material variants (PVC, Metal, Wooden) are stored as metadata on the
 * UserProduct assignment, not as separate product definitions.
 *
 * To add a new product:
 * 1. Add the product ID to ProductId type
 * 2. Add the product definition to PRODUCT_CATALOG
 * 3. Assign capabilities from the capability registry
 * 4. The entitlement system automatically handles access
 */

import type { CapabilityId } from '@/config/capabilities';

// ─── Product ID Types ─────────────────────────────────────────────────────────

/** All available product IDs in the platform. */
export type ProductId =
  // NFC Cards
  | 'BUSINESS_NFC_CARD'
  | 'PREMIUM_NFC_CARD'
  | 'INSTA_CARD'
  | 'GOOGLE_REVIEW_CARD'
  | 'LINKEDIN_CARD'
  | 'FACEBOOK_CARD'
  // Standees
  | 'GOOGLE_REVIEW_STANDEE'
  | 'BUSINESS_PROFILE_STANDEE'
  | 'ALL_IN_ONE_STANDEE_3'
  | 'ALL_IN_ONE_STANDEE_4'
  // Plates
  | 'GOOGLE_REVIEW_NFC_PLATE';

/** All product IDs as an array for iteration. */
export const ALL_PRODUCT_IDS: readonly ProductId[] = [
  // NFC Cards
  'BUSINESS_NFC_CARD',
  'PREMIUM_NFC_CARD',
  'INSTA_CARD',
  'GOOGLE_REVIEW_CARD',
  'LINKEDIN_CARD',
  'FACEBOOK_CARD',
  // Standees
  'GOOGLE_REVIEW_STANDEE',
  'BUSINESS_PROFILE_STANDEE',
  'ALL_IN_ONE_STANDEE_3',
  'ALL_IN_ONE_STANDEE_4',
  // Plates
  'GOOGLE_REVIEW_NFC_PLATE',
] as const;

// ─── Product Categories ───────────────────────────────────────────────────────

export type ProductCategory = 'nfc_card' | 'standee' | 'plate';

// ─── Product Metadata ─────────────────────────────────────────────────────────

/** Physical material options for NFC cards. */
export type CardMaterial = 'pvc' | 'metal' | 'wooden';

/** Product metadata (physical characteristics, NOT digital capabilities). */
export interface ProductMetadata {
  /** Physical material options (for NFC cards). */
  materials?: CardMaterial[];
  /** Maximum number of profiles (for multi-profile standees). */
  maxProfiles?: number;
  /** Number of NFC slots (for multi-profile standees). */
  nfcSlots?: number;
  /** Number of QR slots (for multi-profile standees). */
  qrSlots?: number;
  /** Fixed profile types (for multi-profile standees). */
  fixedProfiles?: string[];
}

// ─── Product Definition ───────────────────────────────────────────────────────

/** A hard-coded product definition. */
export interface ProductDefinition {
  id: ProductId;
  name: string;
  description: string;
  category: ProductCategory;
  capabilities: CapabilityId[];
  metadata: ProductMetadata;
  /**
   * Stable product slug used by the human-readable public URL
   * ("/{business-slug}/{product-slug}"). Only set for Card-backed
   * experiences (NFC cards + plates); standees keep /r/{routeSlug}.
   */
  publicSlug?: string;
}

// ─── Product Catalog ──────────────────────────────────────────────────────────

/**
 * The complete product catalog. Every product in the platform is defined here.
 * This is the SINGLE source of truth.
 */
export const PRODUCT_CATALOG: Record<ProductId, ProductDefinition> = {
  // ─── NFC Cards ────────────────────────────────────────────────────────────

  BUSINESS_NFC_CARD: {
    id: 'BUSINESS_NFC_CARD',
    name: 'Business NFC Card',
    description: 'Basic business NFC card with QR page and profile.',
    category: 'nfc_card',
    capabilities: [
      'qr', 'nfc', 'public_profile', 'profile_edit', 'contact_save', 'social_links',
      'catalogue', 'portfolio', 'lead_capture', 'dynamic_link', 'multi_language',
      'tap_analytics', 'dynamic_dashboard',
    ],
    metadata: {
      materials: ['pvc', 'metal', 'wooden'],
    },
    publicSlug: 'business-card',
  },

  PREMIUM_NFC_CARD: {
    id: 'PREMIUM_NFC_CARD',
    name: 'Premium NFC Card',
    description: 'Premium business NFC card with enhanced features.',
    category: 'nfc_card',
    capabilities: [
      'qr', 'nfc', 'public_profile', 'profile_edit', 'contact_save', 'social_links',
      'catalogue', 'portfolio', 'lead_capture', 'dynamic_link', 'multi_language',
      'tap_analytics', 'dynamic_dashboard',
    ],
    metadata: {
      materials: ['pvc', 'metal', 'wooden'],
    },
    publicSlug: 'premium-card',
  },

  INSTA_CARD: {
    id: 'INSTA_CARD',
    name: 'Insta Card',
    description: 'Instagram-focused NFC card with 1-tap follow and reel showcase.',
    category: 'nfc_card',
    capabilities: [
      'qr', 'nfc',
      'instagram', 'instagram_follow', 'instagram_reels', 'instagram_posts',
      'instagram_dm', 'instagram_shop', 'instagram_multi_account', 'instagram_qr',
      'instagram_follower_counter',
      'dynamic_link', 'multi_language', 'tap_analytics',
    ],
    metadata: {},
    publicSlug: 'instagram',
  },

  GOOGLE_REVIEW_CARD: {
    id: 'GOOGLE_REVIEW_CARD',
    name: 'Google Review Card',
    description: 'Google Review focused NFC card with AI suggestions.',
    category: 'nfc_card',
    capabilities: [
      'qr', 'nfc',
      'google_review', 'review_gate', 'review_ai_suggestions', 'review_photo_prompt',
      'review_discount', 'review_dynamic_link', 'review_analytics', 'google_seo',
      'review_whatsapp_thank_you', 'multi_location_review',
      'dynamic_link', 'multi_language', 'tap_analytics',
    ],
    metadata: {},
    publicSlug: 'google-review',
  },

  LINKEDIN_CARD: {
    id: 'LINKEDIN_CARD',
    name: 'LinkedIn Card',
    description: 'LinkedIn-focused NFC card with profile and resume features.',
    category: 'nfc_card',
    capabilities: [
      'qr', 'nfc',
      'linkedin', 'linkedin_profile', 'linkedin_resume', 'linkedin_featured_content',
      'linkedin_message', 'linkedin_company', 'linkedin_events', 'linkedin_vcf',
      'dynamic_link', 'multi_language', 'tap_analytics',
    ],
    metadata: {},
    publicSlug: 'linkedin',
  },

  FACEBOOK_CARD: {
    id: 'FACEBOOK_CARD',
    name: 'Facebook Card',
    description: 'Facebook-focused NFC card with profile and messenger features.',
    category: 'nfc_card',
    capabilities: [
      'qr', 'nfc',
      'facebook', 'facebook_profile', 'facebook_follow', 'facebook_messenger',
      'facebook_review', 'facebook_reels', 'facebook_shop', 'facebook_group',
      'facebook_multi_profile',
      'dynamic_link', 'multi_language', 'tap_analytics',
    ],
    metadata: {},
    publicSlug: 'facebook',
  },

  // ─── Standees ─────────────────────────────────────────────────────────────

  GOOGLE_REVIEW_STANDEE: {
    id: 'GOOGLE_REVIEW_STANDEE',
    name: 'Google Review Standee',
    description: 'Counter standee for Google Reviews with AI suggestions.',
    category: 'standee',
    capabilities: [
      'qr', 'nfc', 'standee', 'standee_analytics', 'standee_dynamic_link',
      'google_review', 'review_gate', 'review_ai_suggestions', 'review_photo_prompt',
      'review_discount', 'review_dynamic_link', 'review_analytics', 'google_seo',
      'review_whatsapp_thank_you', 'multi_location_review', 'appointments',
      'dynamic_link', 'multi_language',
    ],
    metadata: {
      maxProfiles: 1,
      nfcSlots: 1,
      qrSlots: 1,
      fixedProfiles: ['google_review'],
    },
  },

  BUSINESS_PROFILE_STANDEE: {
    id: 'BUSINESS_PROFILE_STANDEE',
    name: 'Business Profile Standee',
    description: 'Counter standee for business profile and lead capture.',
    category: 'standee',
    capabilities: [
      'qr', 'nfc', 'standee', 'standee_analytics', 'standee_dynamic_link',
      'public_profile', 'profile_edit', 'contact_save', 'social_links',
      'lead_capture', 'appointments', 'google_maps', 'whatsapp',
      'dynamic_link', 'multi_language',
    ],
    metadata: {
      maxProfiles: 1,
      nfcSlots: 1,
      qrSlots: 1,
      fixedProfiles: ['whatsapp'],
    },
  },

  ALL_IN_ONE_STANDEE_3: {
    id: 'ALL_IN_ONE_STANDEE_3',
    name: 'All In One Standee - 3 Profile',
    description: 'Multi-profile standee with Google Review, Instagram, and Facebook.',
    category: 'standee',
    capabilities: [
      'qr', 'nfc', 'standee', 'standee_multi_profile', 'standee_analytics', 'standee_dynamic_link',
      'google_review', 'review_gate', 'review_ai_suggestions',
      'instagram', 'instagram_follow', 'instagram_reels', 'instagram_posts',
      'instagram_dm', 'instagram_shop', 'instagram_multi_account', 'instagram_qr',
      'facebook', 'facebook_profile', 'facebook_follow', 'facebook_messenger',
      'facebook_review', 'facebook_reels', 'facebook_shop', 'facebook_group',
      'dynamic_link', 'multi_language',
    ],
    metadata: {
      maxProfiles: 3,
      nfcSlots: 3,
      qrSlots: 3,
      fixedProfiles: ['google_review', 'instagram', 'facebook'],
    },
  },

  ALL_IN_ONE_STANDEE_4: {
    id: 'ALL_IN_ONE_STANDEE_4',
    name: 'All In One Standee - 4 Profile',
    description: 'Multi-profile standee with Google Review, Instagram, WhatsApp, and Facebook.',
    category: 'standee',
    capabilities: [
      'qr', 'nfc', 'standee', 'standee_multi_profile', 'standee_analytics', 'standee_dynamic_link',
      'google_review', 'review_gate', 'review_ai_suggestions',
      'instagram', 'instagram_follow', 'instagram_reels', 'instagram_posts',
      'instagram_dm', 'instagram_shop', 'instagram_multi_account', 'instagram_qr',
      'whatsapp',
      'facebook', 'facebook_profile', 'facebook_follow', 'facebook_messenger',
      'facebook_review', 'facebook_reels', 'facebook_shop', 'facebook_group',
      'dynamic_link', 'multi_language',
    ],
    metadata: {
      maxProfiles: 4,
      nfcSlots: 4,
      qrSlots: 4,
      fixedProfiles: ['google_review', 'instagram', 'whatsapp', 'facebook'],
    },
  },

  // ─── Plates ───────────────────────────────────────────────────────────────

  GOOGLE_REVIEW_NFC_PLATE: {
    id: 'GOOGLE_REVIEW_NFC_PLATE',
    name: 'Google Review NFC Plate',
    description: 'NFC plate for Google Reviews with analytics.',
    category: 'plate',
    capabilities: [
      'qr', 'nfc',
      'google_review', 'review_gate', 'review_ai_suggestions', 'review_photo_prompt',
      'review_discount', 'review_dynamic_link', 'review_analytics', 'google_seo',
      'review_whatsapp_thank_you', 'multi_location_review',
      'dynamic_link', 'multi_language', 'tap_analytics',
    ],
    metadata: {},
    publicSlug: 'google-review',
  },
};

// ─── Helper Functions ─────────────────────────────────────────────────────────

/** Check if a value is a valid ProductId. */
export function isProductId(value: string): value is ProductId {
  return (ALL_PRODUCT_IDS as readonly string[]).includes(value);
}

/** Get product definition by ID. */
export function getProductDef(id: ProductId): ProductDefinition {
  return PRODUCT_CATALOG[id];
}

/** Get all products for a category. */
export function getProductsByCategory(category: ProductCategory): ProductDefinition[] {
  return ALL_PRODUCT_IDS
    .map(id => PRODUCT_CATALOG[id])
    .filter(product => product.category === category);
}

/** Get all capabilities for a product. */
export function getProductCapabilities(productId: ProductId): CapabilityId[] {
  return [...PRODUCT_CATALOG[productId].capabilities];
}

/** Get material options for a product (returns empty array for non-card products). */
export function getProductMaterials(productId: ProductId): CardMaterial[] {
  const product = PRODUCT_CATALOG[productId];
  return product.metadata.materials ?? [];
}

/** Get standee profile configuration (returns null for non-standee products). */
export function getStandeeProfileConfig(productId: ProductId): {
  maxProfiles: number;
  nfcSlots: number;
  qrSlots: number;
  fixedProfiles: string[];
} | null {
  const product = PRODUCT_CATALOG[productId];
  if (product.category !== 'standee' || !product.metadata.maxProfiles) {
    return null;
  }
  return {
    maxProfiles: product.metadata.maxProfiles,
    nfcSlots: product.metadata.nfcSlots ?? product.metadata.maxProfiles,
    qrSlots: product.metadata.qrSlots ?? product.metadata.maxProfiles,
    fixedProfiles: product.metadata.fixedProfiles ?? [],
  };
}

/**
 * Resolve a catalog product's FIXED standee slot configuration from its slug.
 *
 * Single-QR standees (Google Review, Business Profile, …) declare exactly one
 * fixed profile, so the admin cannot pick platforms at assignment time.
 * All-in-one 3/4 declare their 3/4 fixed profiles. Products with no fixed
 * configuration (generic counter standee) return null and fall back to the
 * admin's free platform selection.
 */
export function getFixedStandeeProfiles(productSlug: string): {
  maxProfiles: number;
  profiles: string[];
} | null {
  const productId = productSlug.toUpperCase().replace(/-/g, '_');
  if (!isProductId(productId)) return null;
  const config = getStandeeProfileConfig(productId);
  if (!config || config.maxProfiles < 1 || config.fixedProfiles.length === 0) {
    return null;
  }
  return { maxProfiles: config.maxProfiles, profiles: config.fixedProfiles };
}
