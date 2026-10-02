/**
 * Central capability registry for the Taprevia CRM platform.
 *
 * Capabilities are the atomic units of feature access. Every product maps to
 * a set of capabilities, and customer access is resolved by merging the
 * capabilities from all owned products.
 *
 * This file is the SINGLE source of truth for all capability definitions.
 * Future developers should add new capabilities here, not scattered throughout
 * the codebase.
 */

// ─── Capability ID Types ──────────────────────────────────────────────────────

/** All available capability IDs in the platform. */
export type CapabilityId =
  // Common capabilities
  | 'qr'
  | 'nfc'
  | 'public_profile'
  | 'profile_edit'
  | 'contact_save'
  | 'social_links'
  | 'catalogue'
  | 'portfolio'
  | 'lead_capture'
  | 'appointments'
  | 'analytics'
  | 'dynamic_link'
  | 'multi_language'
  | 'whatsapp'
  | 'google_maps'
  | 'tap_analytics'
  | 'dynamic_dashboard'
  // Instagram capabilities
  | 'instagram'
  | 'instagram_follow'
  | 'instagram_reels'
  | 'instagram_posts'
  | 'instagram_dm'
  | 'instagram_shop'
  | 'instagram_multi_account'
  | 'instagram_qr'
  | 'instagram_follower_counter'
  // Google Review capabilities
  | 'google_review'
  | 'review_gate'
  | 'review_ai_suggestions'
  | 'review_photo_prompt'
  | 'review_discount'
  | 'review_dynamic_link'
  | 'review_analytics'
  | 'google_seo'
  | 'review_whatsapp_thank_you'
  | 'multi_location_review'
  // LinkedIn capabilities
  | 'linkedin'
  | 'linkedin_profile'
  | 'linkedin_resume'
  | 'linkedin_featured_content'
  | 'linkedin_message'
  | 'linkedin_company'
  | 'linkedin_events'
  | 'linkedin_vcf'
  // Facebook capabilities
  | 'facebook'
  | 'facebook_profile'
  | 'facebook_follow'
  | 'facebook_messenger'
  | 'facebook_review'
  | 'facebook_reels'
  | 'facebook_shop'
  | 'facebook_group'
  | 'facebook_multi_profile'
  // Standee capabilities
  | 'standee'
  | 'standee_multi_profile'
  | 'standee_analytics'
  | 'standee_dynamic_link';

/** All capability IDs as an array for iteration. */
export const ALL_CAPABILITIES: readonly CapabilityId[] = [
  // Common
  'qr', 'nfc', 'public_profile', 'profile_edit', 'contact_save', 'social_links',
  'catalogue', 'portfolio', 'lead_capture', 'appointments', 'analytics',
  'dynamic_link', 'multi_language', 'whatsapp', 'google_maps', 'tap_analytics',
  'dynamic_dashboard',
  // Instagram
  'instagram', 'instagram_follow', 'instagram_reels', 'instagram_posts',
  'instagram_dm', 'instagram_shop', 'instagram_multi_account', 'instagram_qr',
  'instagram_follower_counter',
  // Google Review
  'google_review', 'review_gate', 'review_ai_suggestions', 'review_photo_prompt',
  'review_discount', 'review_dynamic_link', 'review_analytics', 'google_seo',
  'review_whatsapp_thank_you', 'multi_location_review',
  // LinkedIn
  'linkedin', 'linkedin_profile', 'linkedin_resume', 'linkedin_featured_content',
  'linkedin_message', 'linkedin_company', 'linkedin_events', 'linkedin_vcf',
  // Facebook
  'facebook', 'facebook_profile', 'facebook_follow', 'facebook_messenger',
  'facebook_review', 'facebook_reels', 'facebook_shop', 'facebook_group',
  'facebook_multi_profile',
  // Standee
  'standee', 'standee_multi_profile', 'standee_analytics', 'standee_dynamic_link',
] as const;

// ─── Capability Definitions ───────────────────────────────────────────────────

export interface CapabilityDef {
  id: CapabilityId;
  label: string;
  description: string;
  category: 'common' | 'instagram' | 'google_review' | 'linkedin' | 'facebook' | 'standee';
}

/** Human-readable metadata for each capability. */
export const CAPABILITY_DEFS: Record<CapabilityId, CapabilityDef> = {
  // Common
  qr: { id: 'qr', label: 'QR Code', description: 'QR code generation and scanning', category: 'common' },
  nfc: { id: 'nfc', label: 'NFC', description: 'NFC tap functionality', category: 'common' },
  public_profile: { id: 'public_profile', label: 'Public Profile', description: 'Public-facing profile page', category: 'common' },
  profile_edit: { id: 'profile_edit', label: 'Profile Editing', description: 'Ability to edit profile from dashboard', category: 'common' },
  contact_save: { id: 'contact_save', label: 'Contact Save', description: 'vCard download and contact save', category: 'common' },
  social_links: { id: 'social_links', label: 'Social Links', description: 'Social media link buttons', category: 'common' },
  catalogue: { id: 'catalogue', label: 'Digital Catalogue', description: 'Product catalogue display', category: 'common' },
  portfolio: { id: 'portfolio', label: 'Portfolio', description: 'Portfolio/gallery display', category: 'common' },
  lead_capture: { id: 'lead_capture', label: 'Lead Capture', description: 'Contact form and lead generation', category: 'common' },
  appointments: { id: 'appointments', label: 'Appointments', description: 'Appointment booking system', category: 'common' },
  analytics: { id: 'analytics', label: 'Analytics', description: 'Usage analytics and insights', category: 'common' },
  dynamic_link: { id: 'dynamic_link', label: 'Dynamic Link', description: 'Dynamic URL routing', category: 'common' },
  multi_language: { id: 'multi_language', label: 'Multi-Language', description: 'Multiple language support', category: 'common' },
  whatsapp: { id: 'whatsapp', label: 'WhatsApp', description: 'WhatsApp integration', category: 'common' },
  google_maps: { id: 'google_maps', label: 'Google Maps', description: 'Location and maps integration', category: 'common' },
  tap_analytics: { id: 'tap_analytics', label: 'Tap Analytics', description: 'NFC tap tracking and analytics', category: 'common' },
  dynamic_dashboard: { id: 'dynamic_dashboard', label: 'Dynamic Dashboard', description: 'Dynamic dashboard control', category: 'common' },

  // Instagram
  instagram: { id: 'instagram', label: 'Instagram', description: 'Instagram integration', category: 'instagram' },
  instagram_follow: { id: 'instagram_follow', label: 'Instagram Follow', description: '1-tap Instagram follow', category: 'instagram' },
  instagram_reels: { id: 'instagram_reels', label: 'Instagram Reels', description: 'Reel showcase', category: 'instagram' },
  instagram_posts: { id: 'instagram_posts', label: 'Instagram Posts', description: 'Post showcase', category: 'instagram' },
  instagram_dm: { id: 'instagram_dm', label: 'Instagram DM', description: 'Direct message link', category: 'instagram' },
  instagram_shop: { id: 'instagram_shop', label: 'Instagram Shop', description: 'Instagram store/shop access', category: 'instagram' },
  instagram_multi_account: { id: 'instagram_multi_account', label: 'Multi-Account', description: 'Multiple Instagram account switcher', category: 'instagram' },
  instagram_qr: { id: 'instagram_qr', label: 'Instagram QR', description: 'Custom Instagram QR code', category: 'instagram' },
  instagram_follower_counter: { id: 'instagram_follower_counter', label: 'Follower Counter', description: 'Real-time follower counter', category: 'instagram' },

  // Google Review
  google_review: { id: 'google_review', label: 'Google Review', description: 'Google review integration', category: 'google_review' },
  review_gate: { id: 'review_gate', label: 'Review Gate', description: 'Negative feedback filter/smart gatekeeping', category: 'google_review' },
  review_ai_suggestions: { id: 'review_ai_suggestions', label: 'AI Review Suggestions', description: 'AI-powered review draft suggestions', category: 'google_review' },
  review_photo_prompt: { id: 'review_photo_prompt', label: 'Photo Prompt', description: 'Automatic photo-upload prompt', category: 'google_review' },
  review_discount: { id: 'review_discount', label: 'Review Discount', description: 'Review-to-discount automation', category: 'google_review' },
  review_dynamic_link: { id: 'review_dynamic_link', label: 'Dynamic Review Link', description: 'Dynamic review link control', category: 'google_review' },
  review_analytics: { id: 'review_analytics', label: 'Review Analytics', description: 'Review tracking and analytics', category: 'google_review' },
  google_seo: { id: 'google_seo', label: 'Google SEO', description: 'Google Business Profile SEO features', category: 'google_review' },
  review_whatsapp_thank_you: { id: 'review_whatsapp_thank_you', label: 'WhatsApp Thank You', description: 'Automatic WhatsApp thank-you message', category: 'google_review' },
  multi_location_review: { id: 'multi_location_review', label: 'Multi-Location', description: 'Multi-location review redirection', category: 'google_review' },

  // LinkedIn
  linkedin: { id: 'linkedin', label: 'LinkedIn', description: 'LinkedIn integration', category: 'linkedin' },
  linkedin_profile: { id: 'linkedin_profile', label: 'LinkedIn Profile', description: '1-tap LinkedIn profile connection', category: 'linkedin' },
  linkedin_resume: { id: 'linkedin_resume', label: 'Resume/CV', description: 'Digital resume/CV viewer', category: 'linkedin' },
  linkedin_featured_content: { id: 'linkedin_featured_content', label: 'Featured Content', description: 'Featured posts/articles showcase', category: 'linkedin' },
  linkedin_message: { id: 'linkedin_message', label: 'InMail/Message', description: 'Direct InMail/message button', category: 'linkedin' },
  linkedin_company: { id: 'linkedin_company', label: 'Company Page', description: 'Company page integration', category: 'linkedin' },
  linkedin_events: { id: 'linkedin_events', label: 'Events', description: 'Event/webinar registration', category: 'linkedin' },
  linkedin_vcf: { id: 'linkedin_vcf', label: 'Contact Save', description: 'Auto-save to phone contacts (.vcf)', category: 'linkedin' },

  // Facebook
  facebook: { id: 'facebook', label: 'Facebook', description: 'Facebook integration', category: 'facebook' },
  facebook_profile: { id: 'facebook_profile', label: 'Facebook Profile', description: '1-tap Facebook profile/page open', category: 'facebook' },
  facebook_follow: { id: 'facebook_follow', label: 'Facebook Follow', description: 'Friend request/follow action', category: 'facebook' },
  facebook_messenger: { id: 'facebook_messenger', label: 'Messenger', description: 'Facebook Messenger launch', category: 'facebook' },
  facebook_review: { id: 'facebook_review', label: 'Page Review', description: 'Page review/rating access', category: 'facebook' },
  facebook_reels: { id: 'facebook_reels', label: 'Facebook Reels', description: 'Facebook Reels/video showcase', category: 'facebook' },
  facebook_shop: { id: 'facebook_shop', label: 'Facebook Shop', description: 'Facebook Shop/product catalog access', category: 'facebook' },
  facebook_group: { id: 'facebook_group', label: 'Facebook Group', description: 'Facebook Group shortcut', category: 'facebook' },
  facebook_multi_profile: { id: 'facebook_multi_profile', label: 'Multi-Profile', description: 'Multi-profile landing page', category: 'facebook' },

  // Standee
  standee: { id: 'standee', label: 'Standee', description: 'Counter standee QR codes', category: 'standee' },
  standee_multi_profile: { id: 'standee_multi_profile', label: 'Multi-Profile Standee', description: 'Multi-profile standee with fixed slots', category: 'standee' },
  standee_analytics: { id: 'standee_analytics', label: 'Standee Analytics', description: 'Standee usage analytics', category: 'standee' },
  standee_dynamic_link: { id: 'standee_dynamic_link', label: 'Dynamic Standee Link', description: 'Dynamic standee link control', category: 'standee' },
};

// ─── Capability Sets (for convenience) ────────────────────────────────────────

/** Common capabilities shared by most products. */
export const COMMON_CAPABILITIES: CapabilityId[] = [
  'qr', 'nfc', 'public_profile', 'profile_edit', 'contact_save', 'social_links',
];

/** Instagram-specific capability set. */
export const INSTAGRAM_CAPABILITIES: CapabilityId[] = [
  'instagram', 'instagram_follow', 'instagram_reels', 'instagram_posts',
  'instagram_dm', 'instagram_shop', 'instagram_multi_account', 'instagram_qr',
  'instagram_follower_counter',
];

/** Google Review capability set. */
export const GOOGLE_REVIEW_CAPABILITIES: CapabilityId[] = [
  'google_review', 'review_gate', 'review_ai_suggestions', 'review_photo_prompt',
  'review_discount', 'review_dynamic_link', 'review_analytics', 'google_seo',
  'review_whatsapp_thank_you', 'multi_location_review',
];

/** LinkedIn capability set. */
export const LINKEDIN_CAPABILITIES: CapabilityId[] = [
  'linkedin', 'linkedin_profile', 'linkedin_resume', 'linkedin_featured_content',
  'linkedin_message', 'linkedin_company', 'linkedin_events', 'linkedin_vcf',
];

/** Facebook capability set. */
export const FACEBOOK_CAPABILITIES: CapabilityId[] = [
  'facebook', 'facebook_profile', 'facebook_follow', 'facebook_messenger',
  'facebook_review', 'facebook_reels', 'facebook_shop', 'facebook_group',
  'facebook_multi_profile',
];

/** Standee capability set. */
export const STANDEE_CAPABILITIES: CapabilityId[] = [
  'standee', 'standee_analytics', 'standee_dynamic_link',
];

/**
 * Capabilities that unlock the customer analytics surface. Cards grant
 * `tap_analytics`, standees grant `standee_analytics`, and the premium
 * card tiers grant `dynamic_dashboard` — any one of them entitles a customer
 * to THEIR OWN existing analytics, and none alone should hide them.
 */
export const ANALYTICS_CAPABILITIES: readonly CapabilityId[] = [
  'dynamic_dashboard', 'tap_analytics', 'standee_analytics',
];

// ─── Helper Functions ─────────────────────────────────────────────────────────

/** Check if a value is a valid CapabilityId. */
export function isCapabilityId(value: string): value is CapabilityId {
  return (ALL_CAPABILITIES as readonly string[]).includes(value);
}

/** Get capability definition by ID. */
export function getCapabilityDef(id: CapabilityId): CapabilityDef {
  return CAPABILITY_DEFS[id];
}

/** Get all capabilities for a category. */
export function getCapabilitiesByCategory(category: CapabilityDef['category']): CapabilityId[] {
  return ALL_CAPABILITIES.filter(cap => CAPABILITY_DEFS[cap].category === category);
}
