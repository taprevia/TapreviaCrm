import { NextRequest } from 'next/server';
import { connectDB } from '@/lib/db';
import Product from '@/models/Product';
import { fail, ok } from '@/lib/api';
import { getPublicCardByAlias, isPublicProfileCard } from '@/lib/services/card-access';

type Params = { params: { alias: string } };

// GET /api/public/cards/[alias]
export async function GET(_request: NextRequest, { params }: Params) {
  try {
    await connectDB();

    const card = await getPublicCardByAlias(params.alias);
    // social/review cards are redirect-only products — never expose their
    // profile/business data through the data API.
    if (!isPublicProfileCard(card)) return fail(404, 'NOT_FOUND', 'Card not found');

    const products = await Product.find({ cardId: card._id, active: true })
      .sort({ sortOrder: 1, createdAt: -1 })
      .select('title description priceMinor currency imageUrl category')
      .lean();

    return ok({
      card: card.toObject(),
      products,
    });
  } catch (error) {
    console.error('Public card GET error:', error);
    return fail(500, 'INTERNAL_ERROR', 'Internal server error');
  }
}
