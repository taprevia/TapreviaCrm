import { connectDB } from '@/lib/db';
import { ok } from '@/lib/api';
import ReviewTemplate from '@/models/ReviewTemplate';

export const dynamic = 'force-dynamic';

/**
 * GET /api/public/review-languages
 *
 * Distinct languages actually served by ACTIVE review templates across the
 * whole library — the authoritative option set for the builder's language
 * multi-select. Falls back to ['English'] when the library is empty or the
 * store is unreachable so the selector is never empty.
 */
export async function GET() {
  try {
    await connectDB();
    const rows = (await ReviewTemplate.distinct('language', {
      active: true,
    }).exec()) as unknown[];

    const languages = Array.from(
      new Set(
        rows
          .map((value) => String(value).trim())
          .filter((value) => value.length > 0)
      )
    ).sort((a, b) => a.localeCompare(b));

    return ok({ languages: languages.length > 0 ? languages : ['English'] });
  } catch (error) {
    console.error('Review languages GET error:', error);
    return ok({ languages: ['English'] });
  }
}
