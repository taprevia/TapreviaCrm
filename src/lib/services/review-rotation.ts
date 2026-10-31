import ReviewRotationEvent from '@/models/ReviewRotationEvent';
import ReviewRotationState from '@/models/ReviewRotationState';
import ReviewTemplate from '@/models/ReviewTemplate';
import { isTemplateEdibleForBusiness, type ReviewEdibilityValues } from '@/lib/services/review-templates';

/**
 * Smart Review Rotation engine (Phase 4B).
 *
 * Gate state lives in `review-feature-flags`: rotation is effective only when
 * both the customer copy flow and the rotation flag are enabled. This service
 * keeps the legacy `SMART_REVIEW_ROTATION_ENABLED` re-export for callers that
 * only need the raw flag; routes should use `REVIEW_ROTATION_ACTIVE`.
 */
import {
  REVIEW_ROTATION_ACTIVE,
  SMART_REVIEW_ROTATION_ENABLED,
} from '@/lib/review-feature-flags';

export { REVIEW_ROTATION_ACTIVE, SMART_REVIEW_ROTATION_ENABLED };

export interface RecordCopyInput {
  businessId: unknown;
  categoryKey: string;
  templateId: unknown;
  copyId: string;
  cardId?: unknown;
  /** Additive Phase 4D.6 Standee host metadata. */
  standeeId?: unknown;
  /** Personalization for the shared strict-eligibility pool. */
  values?: ReviewEdibilityValues;
  /** Optional client cycle; used to reject stale copy requests. */
  cycle?: number;
}

export interface RecordCopyResult {
  recorded: boolean;
  duplicate: boolean;
  cycle: number;
  rolledOver: boolean;
  stale?: boolean;
}

/**
 * Business-wide eligible pool for a category.
 *
 * Strict eligibility = active + category + all placeholders satisfiable by the
 * business. Language/length/style are selection/ranking preferences, not pool
 * membership, so overlapping preference pools share one cycle and changing
 * them cannot reset or erase history. Inactive/deleted/ineligible templates
 * never block rollover.
 */
export async function eligibleTemplateIds(
  categoryKey: string,
  values?: ReviewEdibilityValues
): Promise<string[]> {
  const rows = (await ReviewTemplate.find({ categoryKey, active: true })
    .select('_id text compatibleKeywords')
    .lean()
    .exec()) as unknown as Array<{
    _id: unknown;
    text: string;
    compatibleKeywords?: string[];
  }>;
  return rows
    .filter((row) => !values || isTemplateEdibleForBusiness(row, values))
    .map((row) => String(row._id));
}

export async function getOrCreateRotationState(
  businessId: unknown,
  categoryKey: string
): Promise<{ cycle: number; usedTemplateIds: string[] }> {
  const key = categoryKey.trim().toLowerCase();
  const read = (state: { cycle: number; usedTemplateIds: unknown[] } | null) => ({
    cycle: state?.cycle ?? 0,
    usedTemplateIds: (state?.usedTemplateIds ?? []).map(String),
  });

  try {
    const state = await ReviewRotationState.findOneAndUpdate(
      { businessId, categoryKey: key },
      { $setOnInsert: { businessId, categoryKey: key, cycle: 0, usedTemplateIds: [] } },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    ).lean<{
      cycle: number;
      usedTemplateIds: unknown[];
    } | null>();
    return read(state);
  } catch (error) {
    // Concurrent first requests can both attempt the upsert. The unique
    // business/category index makes one lose with E11000; reading the winner's
    // document keeps the first-copy path reliable instead of turning it into a
    // 503.
    if ((error as { code?: number }).code === 11000) {
      const existing = await ReviewRotationState.findOne({ businessId, categoryKey: key })
        .select('cycle usedTemplateIds')
        .lean<{ cycle: number; usedTemplateIds: unknown[] } | null>();
      return read(existing);
    }
    throw error;
  }
}

/**
 * Atomically record a copy and roll the cycle once every active template in
 * the category has been copied. The unique event indexes are the concurrency
 * authority; state updates are idempotent add-to-set operations.
 */
export async function recordReviewCopy(input: RecordCopyInput): Promise<RecordCopyResult> {
  const { businessId, categoryKey, templateId, copyId, cardId, standeeId, values } = input;
  const state = await getOrCreateRotationState(businessId, categoryKey);

  if (typeof input.cycle === 'number' && input.cycle !== state.cycle) {
    return { recorded: false, duplicate: false, cycle: state.cycle, rolledOver: false, stale: true };
  }

  const existingByCopy = await ReviewRotationEvent.findOne({ copyId })
    .select('cycle')
    .lean<{ cycle: number } | null>();
  if (existingByCopy) {
    return { recorded: true, duplicate: true, cycle: existingByCopy.cycle, rolledOver: false };
  }

  try {
    await ReviewRotationEvent.create({
      businessId,
      categoryKey,
      templateId,
      cycle: state.cycle,
      copyId,
      cardId: cardId ?? null,
      ...(standeeId ? { standeeId } : {}),
    });
  } catch (error) {
    if ((error as { code?: number }).code === 11000) {
      const duplicate = await ReviewRotationEvent.findOne({
        $or: [
          { copyId },
          { businessId, categoryKey, templateId, cycle: state.cycle },
        ],
      })
        .select('cycle')
        .lean<{ cycle: number } | null>();
      return {
        recorded: true,
        duplicate: true,
        cycle: duplicate?.cycle ?? state.cycle,
        rolledOver: false,
      };
    }
    throw error;
  }

  // Scope the add-to-set to the cycle the event was recorded in. If a rollover
  // completed while this copy was in flight, the new cycle's cleared used set
  // must not be polluted by an old-cycle copy.
  await ReviewRotationState.updateOne(
    { businessId, categoryKey, cycle: state.cycle },
    { $addToSet: { usedTemplateIds: templateId } }
  );

  const [activeIds, latest] = await Promise.all([
    eligibleTemplateIds(categoryKey, values),
    ReviewRotationState.findOne({ businessId, categoryKey })
      .select('_id cycle usedTemplateIds')
      .lean<{ _id: unknown; cycle: number; usedTemplateIds: unknown[] } | null>(),
  ]);

  if (latest && activeIds.length > 0) {
    const used = new Set((latest.usedTemplateIds ?? []).map(String));
    const complete = activeIds.every((id) => used.has(id));
    if (complete) {
      const rolled = await ReviewRotationState.findOneAndUpdate(
        { _id: (latest as unknown as { _id?: unknown })._id, cycle: latest.cycle },
        { $inc: { cycle: 1 }, $set: { usedTemplateIds: [] } },
        { new: true }
      ).lean<{ cycle: number } | null>();
      if (rolled?.cycle !== undefined) {
        return {
          recorded: true,
          duplicate: false,
          cycle: rolled.cycle,
          rolledOver: true,
        };
      }
    }
  }

  return { recorded: true, duplicate: false, cycle: state.cycle, rolledOver: false };
}

/**
 * Admin reset foundation. Increments the cycle, clears the current used set and
 * preserves all events. The caller must supply an authorized admin actor; no
 * route/UI is exposed in Phase 4B.
 */
export async function resetReviewRotation(input: {
  businessId: unknown;
  categoryKeys: string[];
  actorId: unknown;
  reason: string;
}): Promise<{ updated: number }> {
  const categoryKeys = Array.from(
    new Set(input.categoryKeys.map((key) => key.trim().toLowerCase()).filter(Boolean))
  );
  if (categoryKeys.length === 0) return { updated: 0 };

  const result = await ReviewRotationState.bulkWrite(
    categoryKeys.map((categoryKey) => ({
      updateOne: {
        filter: { businessId: input.businessId, categoryKey },
        update: {
          $inc: { cycle: 1 },
          $set: {
            usedTemplateIds: [],
            lastResetBy: input.actorId,
            lastResetReason: input.reason.slice(0, 500),
            lastResetAt: new Date(),
          },
          $setOnInsert: { businessId: input.businessId, categoryKey },
        },
        upsert: true,
      },
    })) as never,
    { ordered: false }
  );
  return { updated: result.modifiedCount + result.upsertedCount };
}
