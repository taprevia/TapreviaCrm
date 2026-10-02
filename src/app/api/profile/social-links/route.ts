import { NextRequest } from 'next/server';
import { connectDB } from '@/lib/db';
import { requireAuth } from '@/lib/auth';
import { canUseFeature } from '@/lib/services/feature-access';
import Profile from '@/models/Profile';
import { fail, ok } from '@/lib/api';

const MAX_URL_LENGTH = 2048;

interface IncomingLink {
  platform?: unknown;
  url?: unknown;
}

/**
 * PUT /api/profile/social-links — replace the customer's shared social links.
 * These URLs are the scan-time destinations for every standee social QR.
 */
export async function PUT(request: NextRequest) {
  try {
    const user = await requireAuth(request);
    if (!user) return fail(401, 'UNAUTHORIZED', 'Unauthorized');

    await connectDB();

    // Product feature gate: shared QR links are a Standee feature. The rows
    // are bounded by the standee's own platform list, not the card social-
    // links limit (that cap applies to card social buttons on profile/social
    // experiences).
    const hasStandee = await canUseFeature(user._id, 'standee');
    if (!hasStandee) {
      return fail(403, 'FORBIDDEN', 'Standee social links are not included in your current products');
    }

    const body = await request.json().catch(() => null);
    const incoming: IncomingLink[] | undefined = body?.socialLinks;
    if (!Array.isArray(incoming)) {
      return fail(400, 'VALIDATION_ERROR', 'socialLinks array is required');
    }

    // Keep only complete rows; drop duplicates per platform.
    const seen = new Set<string>();
    const socialLinks: Array<{ platform: string; url: string }> = [];
    for (const link of incoming) {
      const platform = typeof link?.platform === 'string' ? link.platform.trim() : '';
      const url = typeof link?.url === 'string' ? link.url.trim() : '';
      if (!platform || !url || url.length > MAX_URL_LENGTH) continue;
      if (!/^https?:\/\//i.test(url)) continue;
      if (seen.has(platform)) continue;
      seen.add(platform);
      socialLinks.push({ platform, url });
    }

    const profile = await Profile.findOneAndUpdate(
      { userId: user._id },
      { $set: { socialLinks } },
      { new: true, upsert: true }
    ).select('socialLinks');

    return ok({
      socialLinks:
        (profile as { socialLinks?: Array<{ platform: string; url: string }> })
          ?.socialLinks ?? [],
    });
  } catch (error) {
    console.error('Social links PUT error:', error);
    return fail(500, 'INTERNAL_ERROR', 'Internal server error');
  }
}
