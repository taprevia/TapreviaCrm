/**
 * Shared defaults for the central ReviewSettings document.
 *
 * These are the system defaults used when no central document exists and when
 * a valid central document omits a field. They are deliberately separate from
 * `Card.reviewAssistant`: legacy cards keep their own saved values.
 */

export const REVIEW_SETTINGS_SCHEMA_VERSION = 1;

export type ReviewMode = 'fixed' | 'varied';

export interface ReviewSettingsValues {
  general: {
    enabled: boolean;
    googleReviewUrl: string;
    welcomeMessage: string;
    /** Optional AI/template display name; Card.name remains the legacy fallback. */
    businessName: string;
  };
  content: {
    category: string;
    languages: string[];
    writingStyle: 'friendly' | 'professional' | 'casual' | 'simple';
    preferredLength: 'short' | 'medium' | 'detailed';
    styleMode: ReviewMode;
    lengthMode: ReviewMode;
    feedbackTopics: string[];
    services: string[];
    employees: string[];
    keywords: string[];
  };
}

/** Fresh default object — never share a mutable singleton between requests. */
export function createDefaultReviewSettings(): ReviewSettingsValues {
  return {
    general: {
      enabled: false,
      googleReviewUrl: '',
      welcomeMessage: '',
      businessName: '',
    },
    content: {
      category: '',
      languages: [],
      writingStyle: 'friendly',
      preferredLength: 'medium',
      styleMode: 'fixed',
      lengthMode: 'fixed',
      feedbackTopics: [],
      services: [],
      employees: [],
      keywords: [],
    },
  };
}
