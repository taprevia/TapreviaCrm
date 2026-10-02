import { NextRequest } from 'next/server';
import { requireAdminStrict } from '@/lib/auth';
import { fail, ok } from '@/lib/api';
import {
  getTemplateNameOverrides,
  resolveTemplateMeta,
  saveTemplateNameOverrides,
} from '@/lib/services/template-names';

export const dynamic = 'force-dynamic';

// GET /api/admin/card-templates — code-registered TSX template catalog with
// admin-defined display names applied.
export async function GET(_request: NextRequest) {
  try {
    const admin = await requireAdminStrict(_request);
    if (admin.kind === 'unauthorized') return fail(401, 'UNAUTHORIZED', 'Unauthorized');
    if (admin.kind === 'forbidden') return fail(403, 'FORBIDDEN', 'Forbidden');

    const overrides = await getTemplateNameOverrides();
    return ok({ templates: resolveTemplateMeta(overrides) });
  } catch (error) {
    console.error('Admin card templates GET error:', error);
    return fail(500, 'INTERNAL_ERROR', 'Internal server error');
  }
}

// PUT /api/admin/card-templates — save custom display names for templates
//   body: { names: Record<templateKey, string> }
export async function PUT(request: NextRequest) {
  try {
    const admin = await requireAdminStrict(request);
    if (admin.kind === 'unauthorized') return fail(401, 'UNAUTHORIZED', 'Unauthorized');
    if (admin.kind === 'forbidden') return fail(403, 'FORBIDDEN', 'Forbidden');

    const body = await request.json().catch(() => null);
    const names = body?.names;
    if (!names || typeof names !== 'object' || Array.isArray(names)) {
      return fail(400, 'VALIDATION_ERROR', 'names must be an object of templateKey → name');
    }

    const result = await saveTemplateNameOverrides(names as Record<string, string>);
    return ok({ templates: result.templates, stored: result.stored });
  } catch (error) {
    console.error('Admin card templates PUT error:', error);
    if (error instanceof Error && error.message.startsWith('Template name')) {
      return fail(400, 'VALIDATION_ERROR', error.message);
    }
    return fail(500, 'INTERNAL_ERROR', 'Internal server error');
  }
}