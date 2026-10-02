import { NextRequest } from 'next/server';
import { connectDB } from '@/lib/db';
import { requireApiEntitlement } from '@/lib/auth/capability-guard';
import NewsletterSubscriber from '@/models/NewsletterSubscriber';
import Card from '@/models/Card';
import { objectIdSchema } from '@/lib/validation/common';
import { fail, ok, parsePagination } from '@/lib/api';

export const dynamic = 'force-dynamic';

interface PopulatedCard {
  urlAlias?: string;
  name?: string;
}

interface SubscriberRow {
  _id: unknown;
  cardId: PopulatedCard | null;
  email: string;
  createdAt: Date;
  updatedAt: Date;
}

function toCardRef(populated: unknown): { urlAlias: string; name: string } {
  const c = populated as PopulatedCard | null | undefined;
  return { urlAlias: c?.urlAlias ?? '', name: c?.name ?? '' };
}

function toListItem(row: SubscriberRow) {
  const { cardId, email, _id, createdAt } = row;
  return { _id, email, createdAt, card: toCardRef(cardId) };
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function ownedCardIds(userId: unknown): Promise<string[]> {
  const cards = await Card.find({ userId }).select('_id').lean<{ _id: unknown }[]>([]);
  return cards.map((c) => String(c._id));
}

async function buildFilter(request: NextRequest, userId: unknown) {
  const sp = new URL(request.url).searchParams;

  const owned = await ownedCardIds(userId);
  const filter: Record<string, unknown> = {
    cardId: { $in: owned },
    unsubscribedAt: null,
  };

  const search = sp.get('search')?.trim();
  if (search) {
    filter.email = { $regex: new RegExp(escapeRegex(search), 'i') };
  }

  const cardIdRaw = sp.get('cardId');
  if (cardIdRaw) {
    const v = objectIdSchema.safeParse(cardIdRaw);
    if (!v.success) return { error: fail(400, 'VALIDATION_ERROR', 'Invalid cardId filter') };
    filter.cardId = { $in: owned, $eq: v.data };
  }

  return { filter };
}

// GET /api/newsletter-subscribers
export async function GET(request: NextRequest) {
  try {
    const { status: authStatus, user } = await requireApiEntitlement(request, 'lead_capture');
    if (authStatus === 401) return fail(401, 'UNAUTHORIZED', 'Unauthorized');
    if (authStatus === 403) return fail(403, 'FORBIDDEN', 'Your products do not include Subscribers');

    await connectDB();
    const { page, limit, skip } = parsePagination(new URL(request.url).searchParams);
    const built = await buildFilter(request, user._id);
    if ('error' in built) return built.error;
    const { filter } = built;

    const [docs, total] = await Promise.all([
      NewsletterSubscriber.find(filter)
        .populate('cardId', 'urlAlias name')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      NewsletterSubscriber.countDocuments(filter),
    ]);

    const items = (docs as unknown as SubscriberRow[]).map(toListItem);

    return ok({
      items,
      meta: { page, limit, total, totalPages: Math.ceil(total / limit) || 1 },
    });
  } catch (error) {
    console.error('Newsletter subscribers GET error:', error);
    return fail(500, 'INTERNAL_ERROR', 'Internal server error');
  }
}
