// ─── Legacy exports (kept for backward compatibility) ────────────────────────

export interface IUser {
  name: string;
  email: string;
  passwordHash: string;
  role: 'admin' | 'customer';
  hasStandy?: boolean;
  createdAt: Date;
}

export interface IProfile {
  userId: string;
  cardId?: string;
  themeConfig: {
    accentColor: string;
    bgColor: string;
    darkMode: boolean;
  };
  personalInfo: {
    fullName: string;
    jobTitle: string;
    bio: string;
    avatarUrl: string;
  };
  companyInfo: {
    companyName: string;
    taxId: string;
    address: string;
    website: string;
    logoUrl: string;
  };
  socialLinks: ISocialLink[];
}

export interface ILead {
  cardOwnerId: string;
  cardId: string;
  name: string;
  email?: string;
  phone?: string;
  company?: string;
  note?: string;
  createdAt: Date;
}

export interface QRGenerateOptions {
  url: string;
  foreground?: string;
  background?: string;
  width?: number;
  margin?: number;
}

/** Alias kept for backward compatibility with older imports. */
export type IQRGenerateOptions = QRGenerateOptions;

// ─── Shared sub-types (formerly vCard-only, now card-level) ──────────────────

export type TemplateKey = 'panthi-event' | 'professional-profile' | 'social' | (string & {});
export type CoverType = 'image' | 'color' | 'video';
export type CoverStyle = 'cover' | 'banner' | 'boxed';
export type DayOfWeek =
  | 'monday'
  | 'tuesday'
  | 'wednesday'
  | 'thursday'
  | 'friday'
  | 'saturday'
  | 'sunday';

export interface IBusinessHour {
  day: DayOfWeek;
  enabled: boolean;
  from: string;
  to: string;
}

/** A card-level service/offering row (used by the "panthevent" template). */
export interface IServiceItem {
  title: string;
  description?: string;
}

export interface ISocialLink {
  platform: string;
  url: string;
  label?: string;
  iconUrl?: string;
  clicks?: number;
}

export interface IVcardBanner {
  title: string;
  url: string;
  description: string;
  ctaLabel: string;
  show: boolean;
}

export interface IVcardConfig {
  displayLocalization: boolean;
  displayDownloadQrIcon: boolean;
  displayQrSection: boolean;
  displayAddToContact: boolean;
  hideStickyBar: boolean;
  displayWhatsAppShare: boolean;
  qrDownloadSize: number;
}

export interface ISectionFlags {
  header: boolean;
  contact: boolean;
  businessHours: boolean;
  map: boolean;
  banner: boolean;
  newsletterPopup: boolean;
}

// ─── Review Assistant (per-card AI review-writing configuration) ────────────

export type ReviewWritingStyle = 'friendly' | 'professional' | 'casual' | 'simple';
export type ReviewPreferredLength = 'short' | 'medium' | 'detailed';

export interface IReviewAssistantConfig {
  enabled: boolean;
  googleReviewUrl: string;
  writingStyle: ReviewWritingStyle;
  preferredLength: ReviewPreferredLength;
  languages: string[];
  feedbackTopics: string[];
  welcomeMessage?: string;
  /** Business personalization for the template-based suggestions mode. */
  category?: string;
  employees?: string[];
  services?: string[];
  keywords?: string[];
}

/** A single scenario offered by a review category (embedded on the category). */
export interface IReviewCategoryScenario {
  key: string;
  name: string;
}

/** Reusable business category for the review template library. */
export interface IReviewCategory {
  _id: string;
  key: string;
  name: string;
  active: boolean;
  languages: string[];
  scenarios: IReviewCategoryScenario[];
  createdAt: Date;
  updatedAt: Date;
}

/** Category-scoped review snippet served in template mode. */
export interface IReviewTemplate {
  _id: string;
  key: string;
  categoryKey: string;
  scenario: string;
  language: string;
  text: string;
  variables: string[];
  length: ReviewPreferredLength;
  style?: ReviewWritingStyle;
  compatibleKeywords?: string[];
  active: boolean;
  usageCount: number;
  lastShownAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

// ─── Product kind / card experience (multi-product foundation) ──────────────

/** CardKind = the card's primary digital experience (default "profile" = legacy). */
export type CardKind = 'profile' | 'social' | 'review';

/**
 * CatalogProductKind = the core software experience a product unlocks.
 * Independent of the physical-asset `category`. Backward compatible: legacy
 * stored values (`card`, `multi-standee`) are mapped in
 * src/lib/feature-keys.ts:resolveExperience().
 */
export type CatalogProductKind = 'profile' | 'social' | 'review' | 'standee';

// ─── Card (primary entity — absorbs former IVcard + physical card data) ──────

export interface ICard {
  _id: string;

  // Physical card identity
  cardUid: string;
  slug: string;
  routeSlug: string;
  publicSlug?: string | null;
  assignedUserId?: string;
  status: 'unassigned' | 'active' | 'suspended';
  setupComplete: boolean;
  totalTaps: number;

  // Digital profile (absorbed from former IVcard)
  userId: string;
  urlAlias: string;
  name: string;
  cardLabel: string;
  occupation: string;
  descriptionHtml: string;
  templateKey: TemplateKey;
  kind: CardKind;
  redirectUrl: string;
  isActive: boolean;
  coverType: CoverType;
  coverStyle: CoverStyle;
  coverValue: string;
  profileImageUrl: string;
  galleryImages?: Array<{ imageUrl: string; caption?: string }>;
  services?: IServiceItem[];
  themeConfig: { accentColor: string; bgColor: string };
  basic: {
    firstName: string;
    lastName: string;
    email: string;
    alternateEmail: string;
    phone: string;
    alternatePhone: string;
    dateOfBirth?: string;
    company: string;
    jobTitle: string;
    defaultLanguage: string;
  };
  location: {
    type: 'link' | 'embedded_map' | 'latlng';
    address: string;
    mapsUrl: string;
    lat?: number;
    lng?: number;
  };
  businessHours: IBusinessHour[];
  socialLinks: ISocialLink[];
  banner: IVcardBanner;
  privacyPolicyHtml: string;
  termsHtml: string;
  config: IVcardConfig;
  sections: ISectionFlags;
  stats: { taps: number };
  reviewAssistant?: IReviewAssistantConfig;

  // Product destination configuration (dynamic, mutable)
  instagramConfig?: {
    username: string;
    profileUrl: string;
    reelsUrl?: string;
    postsUrl?: string;
    dmUrl?: string;
    shopUrl?: string;
  };
  whatsappConfig?: {
    phoneNumber: string;
    defaultMessage?: string;
  };
  linkedinConfig?: {
    profileUrl: string;
    resumeUrl?: string;
  };
  facebookConfig?: {
    profileUrl: string;
    pageUrl?: string;
    messengerUrl?: string;
  };

  createdAt: Date;
  updatedAt: Date;
}

/** @deprecated Use ICard instead. Kept for migration compatibility. */
export type IVcard = ICard;

// ─── Analytics ───────────────────────────────────────────────────────────────

export interface IAnalyticsLog {
  cardId?: string;
  action:
    | 'tap'
    | 'vcard_download'
    | 'link_click'
    | 'form_submit'
    | 'exchange'
    | 'product_enquiry'
    | 'share'
    | 'social_redirect'
    | 'review_page_view'
    | 'review_started'
    | 'review_generated'
    | 'review_copied'
    | 'review_google_clicked'
    | 'review_suggestions_shown'
    | 'review_template_used';
  metadata?: string;
  ip?: string;
  userAgent?: string;
  timestamp: Date;
}

// ─── Product contracts ───────────────────────────────────────────────────────

export interface IProduct {
  _id: string;
  cardId: string;
  userId: string;
  title: string;
  description: string;
  priceMinor: number;
  currency: string;
  imageUrl: string;
  category: string;
  active: boolean;
  sortOrder: number;
}

export type CatalogCategory = 'card' | 'standee' | 'other';

/** Feature introduced by a purchased product (see src/lib/feature-keys.ts). */
export type FeatureKey = 'profile' | 'social' | 'review' | 'standee';

/** A single feature entitlement: enabled + optional count limit. */
export interface IFeatureConfig {
  enabled: boolean;
  max?: number;
}

export interface ICatalogProduct {
  _id: string;
  name: string;
  slug: string;
  description: string;
  category: CatalogCategory;
  kind: CatalogProductKind;
  /**
   * Product-level override for the fixed experience rules. Only
   * `social.max` (1–4, the social-links limit) is honoured by
   * resolveFeatureAccess(); other keys are ignored.
   */
  features?: Partial<Record<FeatureKey, Partial<IFeatureConfig>>>;
  priceMinor: number;
  currency: string;
  imageUrl: string;
  active: boolean;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface IUserProduct {
  _id: string;
  userId: string;
  catalogProductId: string;
  cardId: string | null;
  standeeId: string | null;
  quantity: number;
  unitPriceMinor: number;
  status: 'active' | 'removed';
  notes: string;
  assignedBy: string | null;
  material: 'pvc' | 'metal' | 'wooden';
  createdAt: Date;
  updatedAt: Date;
}

// ─── Inquiry / Appointment contracts ─────────────────────────────────────────

export interface IInquiryNote {
  text: string;
  at: Date;
}

export interface IInquiry {
  _id: string;
  cardId: string;
  userId: string;
  name: string;
  email: string;
  phone: string;
  message: string;
  attachmentUrl: string;
  source: 'contact_form' | 'exchange_modal' | 'vcf_gate';
  status: 'new' | 'contacted' | 'won' | 'lost';
  notes: IInquiryNote[];
  createdAt: Date;
  updatedAt: Date;
}

export interface IAppointment {
  _id: string;
  cardId: string;
  userId: string;
  visitorName: string;
  visitorEmail: string;
  visitorPhone: string;
  date: Date;
  slot: string;
  service: string;
  note: string;
  status: 'pending' | 'confirmed' | 'cancelled' | 'completed';
  createdAt: Date;
  updatedAt: Date;
}

// ─── Media / misc contracts ──────────────────────────────────────────────────

export type MediaCategory =
  | 'avatar'
  | 'cover'
  | 'gallery'
  | 'product'
  | 'socialIcon'
  | 'virtualBackground'
  | 'other';

export interface IMediaAsset {
  _id: string;
  userId: string;
  cardId: string | null;
  category: MediaCategory;
  key: string;
  url: string;
  mime: string;
  bytes: number;
  width: number;
  height: number;
  originalName: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface ITenantSettingsGeneral {
  currency: string;
  timeFormat12h: boolean;
  newsletterModalDelaySeconds: number;
  inquiryAttachmentsEnabled: boolean;
  askDetailsBeforeDownload: boolean;
  enablePWA: boolean;
}

export interface ITenantSettingsOpenai {
  enabled: boolean;
  apiKeyEnc: string;
  model: string;
  dailyLimit: number;
  usage?: Record<string, number>;
}

export interface ITenantSettings {
  _id: string;
  userId: string;
  general: ITenantSettingsGeneral;
  openai: ITenantSettingsOpenai;
  paymentGateways: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

export interface INewsletterSubscriber {
  _id: string;
  cardId: string;
  email: string;
  token: string;
  unsubscribedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface IStandySocialQr {
  qrId: string;
  platform: string;
  qrColor: string;
  label: string;
}

/**
 * Optional physical zones for multi-profile standees (3–4 zones per asset).
 * Each zone targets one card's public page; zones are inert (not routed) yet.
 */
export interface IStandeeZone {
  zoneId: string;
  label: string;
  cardId: string | null;
  qrColor: string;
}

export interface IStandee {
  _id: string;
  userId: string;
  name: string;
  routeSlug: string;
  panelQr: { qrId: string; qrColor: string };
  socialQrs: IStandySocialQr[];
  zones: IStandeeZone[];
  createdAt: Date;
  updatedAt: Date;
}

/** @deprecated Legacy embedded standee QR on Profile. Use IStandee instead. */
export interface IStandeeQr {
  _id: string;
  qrId: string;
  platform: string;
  destinationUrl: string;
  qrColor: string;
  userId: string | null;
  cardId: string | null;
  createdAt: Date;
  updatedAt: Date;
}
