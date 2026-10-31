import type { ReviewSettingsValues } from '@/lib/review-settings-defaults';

export type ReviewSettingsDraft = ReviewSettingsValues;

export interface ReviewSettingsResponse {
  saved: boolean;
  schemaVersion: number;
  revision: string;
  settings: ReviewSettingsDraft;
  updatedAt?: string;
}

export interface ReviewOptionChoice {
  value: string;
  label: string;
}

export interface ReviewCategoryOption {
  key: string;
  label: string;
  active: boolean;
  languages: string[];
  scenarioCount: number;
}

export interface ReviewScenarioOption {
  key: string;
  label: string;
  categoryKey: string;
  selectable: boolean;
}

export interface ReviewManagementOptions {
  categories: ReviewCategoryOption[];
  selectedCategory: ReviewCategoryOption | null;
  languages: string[];
  scenarios: ReviewScenarioOption[];
  suggestedFeedbackTopics: ReviewScenarioOption[];
  suggestedKeywords: string[];
  suggestedServices: string[];
  suggestedEmployees: string[];
  writingStyles: ReviewOptionChoice[];
  preferredLengths: ReviewOptionChoice[];
  styleModes: ReviewOptionChoice[];
  lengthModes: ReviewOptionChoice[];
}

export type ReviewSettingsSource = 'legacy' | 'central' | 'hybrid';

/** Known product-level overrides returned by the product list API. */
export interface ReviewProductOverrides {
  enabled?: boolean;
  googleReviewUrl?: string;
  welcomeMessage?: string;
  category?: string;
  languages?: string[];
  writingStyle?: 'friendly' | 'professional' | 'casual' | 'simple';
  preferredLength?: 'short' | 'medium' | 'detailed';
  styleMode?: 'fixed' | 'varied';
  lengthMode?: 'fixed' | 'varied';
  feedbackTopics?: string[];
  services?: string[];
  employees?: string[];
  keywords?: string[];
}

export interface ReviewProduct {
  assignmentId: string;
  instanceType: 'card' | 'standee';
  productTitle: string;
  catalogProductSlug: string;
  cardId: string;
  standeeId?: string;
  cardKind: string;
  settingsSource: ReviewSettingsSource;
  settingsRevision: number;
  reviewOverrides: ReviewProductOverrides;
  reviewAssistantEnabled: boolean;
  googleDestinationConfigured: boolean;
  standeeGoogleReviewUrl?: string;
  productGrantsReview: boolean;
  accountReviewEntitled: boolean;
  eligible: boolean;
  previewAvailable: boolean;
  previewUrl: string | null;
  hostingEnabled: boolean;
  futureCentralOptInEligible: boolean;
}

export interface ReviewProductListResponse {
  products: ReviewProduct[];
}

export interface ReviewPreviewSettings {
  enabled: boolean;
  googleReviewUrl: string;
  welcomeMessage: string;
  category: string;
  languages: string[];
  writingStyle: string;
  preferredLength: string;
  styleMode: string;
  lengthMode: string;
  feedbackTopics: string[];
  services: string[];
  employees: string[];
  keywords: string[];
}

export interface ReviewPreviewResponse {
  assignmentId: string;
  instanceType: 'card' | 'standee';
  cardId: string;
  standeeId?: string;
  productTitle: string;
  cardKind: string;
  previewAvailable: boolean;
  previewUrl: string | null;
  hostingEnabled: boolean;
  published: boolean;
  source: ReviewSettingsSource | 'legacy-fallback';
  schemaVersion: number;
  entitlement: {
    accountReviewEntitled: boolean;
    productGrantsReview: boolean;
  };
  settings: ReviewPreviewSettings;
}

export interface ReviewApiError {
  error?: string;
  code?: string;
  details?: unknown;
}
