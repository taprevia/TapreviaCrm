import { NextRequest } from 'next/server';
import { requireApiEntitlement } from '@/lib/auth/capability-guard';
import { connectDB } from '@/lib/db';
import { availableTemplatesForUser } from '@/lib/services/template-access';
import { getOwnedCard } from '@/lib/services/card-access';
import { fail, ok } from '@/lib/api';
import { CARD_TEMPLATE_META } from '@/lib/card-templates';
import { getTemplateNameOverrides, resolveTemplateName } from '@/lib/services/template-names';

export const dynamic = 'force-dynamic';

// GET /api/card-templates?cardId= — templates the card's owner may select.
export async function GET(request: NextRequest) {
  try {
    const { status: authStatus, user } = await requireApiEntitlement(request, 'profile_edit');
    if (authStatus === 401) return fail(401, 'UNAUTHORIZED', 'Unauthorized');
    if (authStatus === 403) return fail(403, 'FORBIDDEN', 'Your products do not include vCards');

    await connectDB();
    let ownerId = user._id;
    const cardId = new URL(request.url).searchParams.get('cardId');

    if (cardId) {
      const result = await getOwnedCard(cardId, user);
      if (result.status === 'not_found') return fail(404, 'NOT_FOUND', 'Card not found');
      if (result.status === 'forbidden') return fail(403, 'FORBIDDEN', 'Not allowed');
      ownerId = result.card.userId ?? result.card.assignedUserId ?? user._id;
    }

    const allowed = await availableTemplatesForUser(ownerId);
    const overrides = await getTemplateNameOverrides();
    const templates = CARD_TEMPLATE_META.filter((t) => allowed.includes(t.key)).map((t) => ({
      ...t,
      name: resolveTemplateName(t.key, overrides),
    }));
    return ok({ templates });
  } catch (error) {
    console.error('Card templates GET error:', error);
    return fail(500, 'INTERNAL_ERROR', 'Internal server error');
  }
}