import { NextRequest } from 'next/server';
import { connectDB } from '@/lib/db';
import { requireAuth } from '@/lib/auth';
import TenantSettings, { DEFAULT_AI_GENERATION_DAILY_LIMIT } from '@/models/TenantSettings';
import { updateTenantSettingsSchema } from '@/lib/validation/settings';
import { encryptSecret } from '@/lib/crypto';
import { fail, ok } from '@/lib/api';

type SettingsDoc = ReturnType<typeof TenantSettings.hydrate>;

/** UTC date key used by the review-generation consumption ledger. */
function utcDayKey(date = new Date()): string {
  return date.toISOString().slice(0, 10);
}

/**
 * Response sanitizer: the AES payload in `openai.apiKeyEnc` is secret material
 * and never leaves the server. Clients get a presence flag instead, plus the
 * daily generation budget/usage so admins can see capacity at a glance.
 */
function toPublicSettings(doc: SettingsDoc) {
  const plain = doc.toObject() as Record<string, unknown>;
  const openai = plain.openai as Record<string, unknown> | undefined;
  if (openai && typeof openai === 'object') {
    const { apiKeyEnc, usage, ...rest } = openai;
    void apiKeyEnc;
    const usageLedger = usage as Map<string, number> | undefined;
    const today = utcDayKey();
    const usedToday = typeof usageLedger?.get === 'function' ? Number(usageLedger.get(today) ?? 0) : 0;
    plain.openai = {
      ...rest,
      hasApiKey: typeof apiKeyEnc === 'string' && apiKeyEnc.length > 0,
      dailyLimit: Number(rest.dailyLimit ?? DEFAULT_AI_GENERATION_DAILY_LIMIT),
      usageToday: usedToday,
    };
  }
  return plain;
}

/** Fetch-or-create the tenant settings doc for a user (schema defaults apply). */
async function findOrCreateSettings(userId: string): Promise<SettingsDoc> {
  const existing = await TenantSettings.findOne({ userId });
  if (existing) return existing;
  try {
    return await TenantSettings.create({ userId });
  } catch (err) {
    // Unique-index race on concurrent first requests — re-read instead.
    if ((err as { code?: number }).code !== 11000) throw err;
    const raced = await TenantSettings.findOne({ userId });
    if (!raced) throw err;
    return raced;
  }
}

// GET /api/settings — current tenant settings (upsert-default on first read)
export async function GET(request: NextRequest) {
  try {
    const user = await requireAuth(request);
    if (!user) return fail(401, 'UNAUTHORIZED', 'Unauthorized');

    await connectDB();
    const settings = await findOrCreateSettings(user._id);

    return ok({ settings: toPublicSettings(settings) });
  } catch (error) {
    console.error('Settings GET error:', error);
    return fail(500, 'INTERNAL_ERROR', 'Internal server error');
  }
}

// PATCH /api/settings — merge one level per section (vcards PATCH pattern)
export async function PATCH(request: NextRequest) {
  try {
    const user = await requireAuth(request);
    if (!user) return fail(401, 'UNAUTHORIZED', 'Unauthorized');

    await connectDB();
    const settings = await findOrCreateSettings(user._id);

    const body = await request.json().catch(() => null);
    const parsed = updateTenantSettingsSchema.safeParse(body);
    if (!parsed.success) {
      return fail(400, 'VALIDATION_ERROR', 'Invalid input', parsed.error.flatten().fieldErrors);
    }
    const data = parsed.data;

    // Merge nested partials onto existing subdocuments.
    if (data.general) {
      for (const [key, value] of Object.entries(data.general)) {
        if (value !== undefined) {
          (settings.general as unknown as Record<string, unknown>)[key] = value;
        }
      }
    }

    let apiKey: string | undefined;
    if (data.openai) {
      const { apiKey: key, ...openaiRest } = data.openai;
      apiKey = key;
      for (const [key, value] of Object.entries(openaiRest)) {
        if (value !== undefined) {
          (settings.openai as unknown as Record<string, unknown>)[key] = value;
        }
      }
    }

    // Plaintext apiKey arrives over TLS only — persist encrypted or clear.
    if (apiKey !== undefined) {
      settings.openai.apiKeyEnc =
        apiKey.length > 0
          ? encryptSecret(apiKey)
          : '';
    }

    await settings.save();

    return ok({ settings: toPublicSettings(settings) });
  } catch (error) {
    console.error('Settings PATCH error:', error);
    return fail(500, 'INTERNAL_ERROR', 'Internal server error');
  }
}
