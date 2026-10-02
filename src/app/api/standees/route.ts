import { NextRequest } from 'next/server';
import { connectDB } from '@/lib/db';
import { fail, ok } from '@/lib/api';
import { requireApiCapability } from '@/lib/auth/capability-guard';
import Standee from '@/models/Standee';
import Profile from '@/models/Profile';

export const dynamic = 'force-dynamic';

/** GET /api/standees — the signed-in customer's standees + shared social links. */
export async function GET(request: NextRequest) {
  try {
    // Capability gate: Standees must be included in the customer's products.
    const user = await requireApiCapability(request, 'standee');
    if (!user) {
      return fail(403, 'FORBIDDEN', 'Standees are not included in your current products');
    }

    await connectDB();

    const [standees, profile] = await Promise.all([
      Standee.find({ userId: user._id }).sort({ createdAt: -1 }).lean(),
      Profile.findOne({ userId: user._id }).select('socialLinks').lean(),
    ]);

    return ok({
      standees,
      socialLinks:
        (profile as { socialLinks?: Array<{ platform: string; url: string }> } | null)
          ?.socialLinks ?? [],
    });
  } catch (error) {
    console.error('Standees GET error:', error);
    return fail(500, 'INTERNAL_ERROR', 'Internal server error');
  }
}
