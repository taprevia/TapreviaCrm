import { NextRequest } from 'next/server';
import { requireAdminStrict } from '@/lib/auth';
import { fail, ok } from '@/lib/api';
import { CARD_TEMPLATE_META } from '@/lib/card-templates';
import {
  getTemplateNameOverrides,
  saveTemplateNameOverrides,
} from '@/lib/services/template-names';

export const dynamic = 'force-dynamic';

/**
 * PATCH /api/admin/templates/:key — rename one template's display name.
 *
 * Templates are TSX layouts registered in code; their "record" in MongoDB is
 * the display-name entry inside `SystemSettings.cardTemplateNames`. `:key` is
 * the code key (e.g. `panthi-event`), matching the catalog's stable identity
 * the same way `Template.findByIdAndUpdate` would target a single record.
 *
 * body: { name: string }  — trimmed, required, ≤ 40 chars.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const admin = await requireAdminStrict(request);
    if (admin.kind === 'unauthorized') return fail(401, 'UNAUTHORIZED', 'Unauthorized');
    if (admin.kind === 'forbidden') return fail(403, 'FORBIDDEN', 'Forbidden');

    const key = params.id;
    if (!CARD_TEMPLATE_META.some((meta) => meta.key === key)) {
      return fail(404, 'NOT_FOUND', 'Template not found');
    }

    const body = await request.json().catch(() => null);
    const name = typeof body?.name === 'string' ? body.name.trim() : '';
    if (!name) {
      return fail(400, 'VALIDATION_ERROR', 'Template name is required');
    }
    if (name.length > 40) {
      return fail(400, 'VALIDATION_ERROR', 'Template name must be 40 characters or fewer');
    }

    // Preserve any other existing overrides (the save service replaces the map,
    // so merge the current overrides with just this key changed).
    const overrides = await getTemplateNameOverrides();
    const { templates } = await saveTemplateNameOverrides({
      ...overrides,
      [key]: name,
    });

    return ok({ template: templates.find((tpl) => tpl.key === key) });
  } catch (error) {
    console.error('Admin template rename error:', error);
    return fail(500, 'INTERNAL_ERROR', 'Internal server error');
  }
}