/**
 * Shared client-side contracts for the dashboard settings feature.
 * Mirrors the live API:
 * - GET/PATCH /api/settings            (src/app/api/settings/route.ts)
 * - updateTenantSettingsSchema         (src/lib/validation/settings.ts)
 *
 * `openai.apiKeyEnc` is write-only server-side material: clients only ever
 * receive the derived `hasApiKey` flag and never echo key material back.
 */

export interface GeneralSettingsPublic {
  currency?: string;
  timeFormat12h?: boolean;
  newsletterModalDelaySeconds?: number;
}

export interface OpenaiSettingsPublic {
  enabled?: boolean;
  hasApiKey?: boolean;
  model?: string;
  dailyLimit?: number;
  usageToday?: number;
}

export interface TenantSettingsPublic {
  general?: GeneralSettingsPublic;
  openai?: OpenaiSettingsPublic;
}

/** GET /api/settings → `{ settings }`. */
export interface SettingsResponse {
  settings?: TenantSettingsPublic;
}

/** Uniform API error body from `fail()` in `@/lib/api`. */
export interface ApiErrorBody {
  error?: string;
}
