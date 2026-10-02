import { NextRequest } from 'next/server';
import { requireAdminStrict } from '@/lib/auth';
import { connectDB } from '@/lib/db';
import User from '@/models/User';
import Profile from '@/models/Profile';
import { isRegisteredTemplate } from '@/lib/card-templates';
import { fail, ok } from '@/lib/api';

// PUT /api/admin/users/[id]/templates — grant a customer a set of templates
export async function PUT(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const admin = await requireAdminStrict(request);
    if (admin.kind === 'unauthorized') return fail(401, 'UNAUTHORIZED', 'Unauthorized');
    if (admin.kind === 'forbidden') return fail(403, 'FORBIDDEN', 'Forbidden');

    await connectDB();
    const user = await User.findById(params.id);
    if (!user) return fail(404, 'NOT_FOUND', 'User not found');

    const body = await request.json().catch(() => null);
    const raw = body?.allowedTemplates;
    if (!Array.isArray(raw)) {
      return fail(400, 'VALIDATION_ERROR', 'allowedTemplates must be an array');
    }
    if (raw.some((k) => typeof k !== 'string' || !isRegisteredTemplate(k.trim()))) {
      return fail(400, 'VALIDATION_ERROR', 'Contains a template key that is not registered');
    }

    const keys = Array.from(new Set(raw.map((k) => k.trim())));

    const profile = await Profile.findOneAndUpdate(
      { userId: user._id },
      { $set: { allowedTemplates: keys } },
      { upsert: true, new: true }
    );

    return ok({ allowedTemplates: profile.allowedTemplates });
  } catch (error) {
    console.error('Admin user templates PUT error:', error);
    return fail(500, 'INTERNAL_ERROR', 'Internal server error');
  }
}