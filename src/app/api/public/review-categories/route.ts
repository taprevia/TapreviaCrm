import { connectDB } from '@/lib/db';
import { ok } from '@/lib/api';
import { getActiveReviewCategories } from '@/lib/services/review-templates';

// GET /api/public/review-categories
export async function GET() {
  try {
    await connectDB();
    const categories = await getActiveReviewCategories();
    return ok({ categories });
  } catch (error) {
    console.error('Review categories GET error:', error);
    return ok({ categories: [] });
  }
}