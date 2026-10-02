import { NextRequest } from 'next/server';
import { connectDB } from '@/lib/db';
import { requireAuth } from '@/lib/auth';
import User from '@/models/User';
import { customerSettingsSchema } from '@/lib/validation/customer-settings';
import { fail, ok } from '@/lib/api';

export const dynamic = 'force-dynamic';

/**
 * PATCH /api/customer/settings — persist the authenticated customer's
 * preferences on the User doc (e.g. `isNewsletterEnabled`). Rejects partial
 * garbage and echoes back the persisted preference so UIs can reconcile.
 */
export async function PATCH(request: NextRequest) {
  try {
    const user = await requireAuth(request);
    if (!user) return fail(401, 'UNAUTHORIZED', 'Unauthorized');

    await connectDB();

    const body = await request.json().catch(() => null);
    const parsed = customerSettingsSchema.safeParse(body);
    if (!parsed.success) {
      return fail(400, 'VALIDATION_ERROR', 'Invalid input', parsed.error.flatten().fieldErrors);
    }

    const doc = await User.findById(user._id);
    if (!doc) return fail(404, 'NOT_FOUND', 'User not found');

    if (parsed.data.isNewsletterEnabled !== undefined) {
      doc.isNewsletterEnabled = parsed.data.isNewsletterEnabled;
    }

    await doc.save();

    return ok({
      settings: {
        isNewsletterEnabled: doc.isNewsletterEnabled,
      },
    });
  } catch (error) {
    console.error('Customer settings PATCH error:', error);
    return fail(500, 'INTERNAL_ERROR', 'Internal server error');
  }
}