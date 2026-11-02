import { z } from 'zod';

/**
 * Centralized environment validation.
 *
 * Edge-safe (no Node-only imports — usable from middleware), validated with
 * zod at module load. In production a missing/invalid APP_JWT config throws
 * fast; in development the app keeps working with explicit, loudly-warned
 * fallbacks (dev-only secrets, never for production).
 */

const isProd = process.env.NODE_ENV === 'production';

const envSchema = z.object({
  MONGODB_URI: z.string().min(1, 'MONGODB_URI is required'),
  JWT_SECRET: z
    .string()
    .min(24, 'JWT_SECRET must be at least 24 characters')
    .max(512),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  APP_KEY: z.string().optional(),
  MEDIA_DRIVER: z.enum(['local', 's3']).optional(),
  UPLOAD_DIR: z.string().min(1).optional(),
});

export type AppEnv = z.infer<typeof envSchema>;

let cachedEnv: AppEnv | null | undefined;

export function getEnv(): AppEnv | null {
  if (cachedEnv !== undefined) return cachedEnv;

  const parsed = envSchema.safeParse({
    MONGODB_URI: process.env.MONGODB_URI,
    JWT_SECRET: process.env.JWT_SECRET,
    NODE_ENV: process.env.NODE_ENV,
    APP_KEY: process.env.APP_KEY,
    MEDIA_DRIVER: process.env.MEDIA_DRIVER,
    UPLOAD_DIR: process.env.UPLOAD_DIR,
  });

  if (!parsed.success) {
    const issues = parsed.error.flatten().fieldErrors;
    if (isProd) {
      throw new Error(
        `Invalid environment configuration: ${JSON.stringify(issues)}`
      );
    }
    console.warn('[env] Missing/invalid env vars — dev fallbacks active:', issues);
    cachedEnv = null;
    return null;
  }

  cachedEnv = parsed.data;
  return cachedEnv;
}

/**
 * JWT secret with a dev-only fallback. Never returns a meaningful secret in
 * production without JWT_SECRET set — it throws instead.
 */
export function requireJwtSecret(): string {
  // JWT validation is deliberately independent of database configuration:
  // middleware needs only the signing secret, and must not fail with a 500
  // just because MONGODB_URI is absent. Missing/invalid critical runtime
  // configuration is handled at the server-start boundary and /api/health.
  const value = process.env.JWT_SECRET?.trim();
  if (value && value.length >= 24 && value.length <= 512) return value;
  if (isProd) {
    throw new Error(
      value
        ? 'JWT_SECRET must be 24–512 characters in production'
        : 'JWT_SECRET is required in production'
    );
  }
  const dev = 'dev-only-insecure-jwt-secret-change-me';
  console.warn('[env] JWT_SECRET not set — using insecure dev placeholder');
  return dev;
}