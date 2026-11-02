/**
 * Unified review analytics (Phase 4D.7).
 *
 * Canonical sources:
 *   - Review Assistant visits: AnalyticsLog.review_page_view
 *   - Total copies: AnalyticsLog.review_copied
 *   - AI/manual classification: metadata.source on new copy events; historical
 *     rows without a source remain in the total but are reported as unclassified
 *   - Rotation activity: ReviewRotationEvent (separate metric, never added to
 *     copy totals to avoid double counting)
 *
 * All host IDs are resolved server-side from the authenticated business's own
 * Cards/Standees. No client businessId is trusted.
 */

import { Types } from 'mongoose';
import Card from '@/models/Card';
import Standee from '@/models/Standee';
import UserProduct from '@/models/UserProduct';
import AnalyticsLog from '@/models/AnalyticsLog';
import ReviewRotationEvent from '@/models/ReviewRotationEvent';
import { getProductCapabilities } from '@/config/products';
import { resolveCanonicalProductId } from '@/lib/services/product-identity';
import { resolveProductTitle } from '@/lib/services/product-title';

const MS_PER_DAY = 24 * 60 * 60 * 1000;
export const MAX_ANALYTICS_DAYS = 366;

const REVIEW_ACTIONS = [
  'review_page_view',
  'review_copied',
  'review_suggestions_shown',
  'review_generated',
  'review_google_clicked',
  'review_started',
  'review_template_used',
] as const;

export type ReviewAnalyticsRange = '7d' | '30d' | '90d';

export interface ReviewAnalyticsCounts {
  visits: number;
  totalCopies: number;
  aiCopies: number;
  manualCopies: number;
  unclassifiedCopies: number;
  rotationCopies: number;
  suggestionsShown: number;
  generated: number;
  googleClicks: number;
}

export interface ReviewAnalyticsProduct extends ReviewAnalyticsCounts {
  hostKey: string;
  hostType: 'card' | 'standee';
  hostId: string;
  title: string;
  productName: string;
  active: boolean;
}

export interface ReviewAnalyticsResult {
  from: string;
  to: string;
  range: ReviewAnalyticsRange;
  totals: ReviewAnalyticsCounts;
  series: Array<{
    date: string;
    visits: number;
    totalCopies: number;
    aiCopies: number;
    manualCopies: number;
  }>;
  products: ReviewAnalyticsProduct[];
}

export type ReviewAnalyticsFailure =
  | { ok: false; code: 'INVALID_HOST' | 'INVALID_RANGE' }
  | { ok: true; data: ReviewAnalyticsResult };

interface HostBase {
  hostKey: string;
  hostType: 'card' | 'standee';
  hostId: string;
  title: string;
  productName: string;
  active: boolean;
  reviewCapable: boolean;
}

interface AssignmentLike {
  cardId?: unknown;
  standeeId?: unknown;
  catalogProductId?: {
    name?: string;
    slug?: string;
    kind?: string;
    category?: string;
  } | null;
}

function emptyCounts(): ReviewAnalyticsCounts {
  return {
    visits: 0,
    totalCopies: 0,
    aiCopies: 0,
    manualCopies: 0,
    unclassifiedCopies: 0,
    rotationCopies: 0,
    suggestionsShown: 0,
    generated: 0,
    googleClicks: 0,
  };
}

function grantsReview(slug: string | undefined): boolean {
  const productId = resolveCanonicalProductId(slug);
  if (!productId) return false;
  return getProductCapabilities(productId).includes('review_ai_suggestions');
}

function parseCopySource(metadata: unknown): 'ai' | 'manual' | 'unknown' {
  if (typeof metadata !== 'string' || !metadata.trim()) return 'unknown';
  try {
    const parsed = JSON.parse(metadata) as { source?: unknown };
    if (parsed?.source === 'ai' || parsed?.source === 'manual') return parsed.source;
  } catch {
    // Historical metadata may be free-form; never infer a classification.
  }
  return 'unknown';
}

function utcMidnight(date: Date): Date {
  const d = new Date(date);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}
function dayKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}
function parseRange(range: string | null | undefined): ReviewAnalyticsRange {
  return range === '7d' || range === '90d' ? range : '30d';
}
function rangeDays(range: ReviewAnalyticsRange): number {
  return range === '7d' ? 7 : range === '90d' ? 90 : 30;
}

async function listOwnedHosts(userId: string): Promise<HostBase[]> {
  const [cards, standees, assignments] = await Promise.all([
    Card.find({ $or: [{ userId }, { assignedUserId: userId }] })
      .select('_id name cardLabel kind isActive reviewAssistant')
      .limit(200)
      .lean() as unknown as Promise<Array<{
      _id: unknown;
      name?: string;
      cardLabel?: string;
      kind?: string;
      isActive?: boolean;
      reviewAssistant?: { enabled?: boolean } | null;
    }>>,
    Standee.find({ userId })
      .select('_id name displayName routeSlug productKey')
      .limit(200)
      .lean() as unknown as Promise<Array<{
      _id: unknown;
      name?: string;
      displayName?: string;
      routeSlug?: string;
      productKey?: string;
    }>>,
    UserProduct.find({ userId, status: 'active' })
      .select('cardId standeeId catalogProductId')
      .populate('catalogProductId', 'name slug kind category')
      .sort({ createdAt: -1 })
      .limit(400)
      .lean() as unknown as Promise<AssignmentLike[]>,
  ]);

  const assignmentByHost = new Map<string, AssignmentLike>();
  for (const assignment of assignments) {
    const key = assignment.cardId
      ? `card:${String(assignment.cardId)}`
      : assignment.standeeId
        ? `standee:${String(assignment.standeeId)}`
        : null;
    if (!key) continue;
    const existing = assignmentByHost.get(key);
    if (!existing || (!grantsReview(existing.catalogProductId?.slug) && grantsReview(assignment.catalogProductId?.slug))) {
      assignmentByHost.set(key, assignment);
    }
  }

  const out: HostBase[] = [];
  for (const card of cards) {
    const hostKey = `card:${String(card._id)}`;
    const assignment = assignmentByHost.get(hostKey);
    const reviewCapable =
      grantsReview(assignment?.catalogProductId?.slug) ||
      card.reviewAssistant?.enabled === true ||
      card.kind === 'review';
    const productName =
      assignment?.catalogProductId?.name?.trim() ||
      (card.kind === 'review' ? 'Google Review Card' : 'NFC Card');
    out.push({
      hostKey,
      hostType: 'card',
      hostId: String(card._id),
      title: resolveProductTitle({
        instanceType: 'card',
        hasInstance: true,
        card: { cardLabel: card.cardLabel, name: card.name },
        catalogName: assignment?.catalogProductId?.name,
      }),
      productName,
      active: Boolean(assignment),
      reviewCapable,
    });
  }
  for (const standee of standees) {
    const hostKey = `standee:${String(standee._id)}`;
    const assignment = assignmentByHost.get(hostKey);
    const reviewCapable = grantsReview(assignment?.catalogProductId?.slug);
    out.push({
      hostKey,
      hostType: 'standee',
      hostId: String(standee._id),
      title: resolveProductTitle({
        instanceType: 'standee',
        hasInstance: true,
        standee: { displayName: standee.displayName, name: standee.name },
        catalogName: assignment?.catalogProductId?.name,
      }),
      productName: assignment?.catalogProductId?.name?.trim() || 'Standee',
      active: Boolean(assignment),
      reviewCapable,
    });
  }
  return out;
}

/**
 * @param hostKey Optional "card:<id>" / "standee:<id>" filter. It must be one
 * of the authenticated business's own hosts.
 */
export async function getUnifiedReviewAnalytics(input: {
  userId: string;
  range?: string | null;
  hostKey?: string | null;
  from?: Date;
  to?: Date;
}): Promise<ReviewAnalyticsFailure> {
  const range = parseRange(input.range);
  const hosts = await listOwnedHosts(input.userId);
  const hostByKey = new Map(hosts.map((host) => [host.hostKey, host]));

  let selectedHost: HostBase | null = null;
  if (input.hostKey && input.hostKey !== 'all') {
    selectedHost = hostByKey.get(input.hostKey) ?? null;
    if (!selectedHost) return { ok: false, code: 'INVALID_HOST' };
  }

  const toRequested = input.to ? new Date(input.to) : new Date();
  const from = input.from
    ? utcMidnight(new Date(input.from))
    : utcMidnight(new Date(toRequested.getTime() - (rangeDays(range) - 1) * MS_PER_DAY));
  const to = new Date(utcMidnight(toRequested).getTime() + MS_PER_DAY - 1);
  if (from.getTime() > to.getTime()) return { ok: false, code: 'INVALID_RANGE' };
  if (Math.floor((to.getTime() - from.getTime()) / MS_PER_DAY) + 1 > MAX_ANALYTICS_DAYS) {
    return { ok: false, code: 'INVALID_RANGE' };
  }

  const cardIds = hosts
    .filter((host) => host.hostType === 'card')
    .map((host) => new Types.ObjectId(host.hostId));
  const standeeIds = hosts
    .filter((host) => host.hostType === 'standee')
    .map((host) => new Types.ObjectId(host.hostId));

  const hostConditions: Record<string, unknown>[] = [];
  if (cardIds.length) hostConditions.push({ cardId: { $in: cardIds } });
  if (standeeIds.length) hostConditions.push({ standeeId: { $in: standeeIds } });

  const hostCounts = new Map<string, ReviewAnalyticsCounts>();
  for (const host of hosts) hostCounts.set(host.hostKey, emptyCounts());
  const dayCounts = new Map<
    string,
    { visits: number; totalCopies: number; aiCopies: number; manualCopies: number }
  >();
  const hostDayCounts = new Map<
    string,
    Map<string, { visits: number; totalCopies: number; aiCopies: number; manualCopies: number }>
  >();
  const totals = emptyCounts();

  if (hostConditions.length > 0) {
    const rows = (await AnalyticsLog.aggregate([
      {
        $match: {
          $or: hostConditions,
          action: { $in: [...REVIEW_ACTIONS] },
          createdAt: { $gte: from, $lte: to },
        },
      },
      {
        $group: {
          _id: {
            day: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
            action: '$action',
            cardId: '$cardId',
            standeeId: '$standeeId',
            metadata: '$metadata',
          },
          count: { $sum: 1 },
        },
      },
    ])) as Array<{
      _id: {
        day: string;
        action: string;
        cardId?: unknown;
        standeeId?: unknown;
        metadata?: unknown;
      };
      count: number;
    }>;

    for (const row of rows) {
      const key = row._id.cardId
        ? `card:${String(row._id.cardId)}`
        : row._id.standeeId
          ? `standee:${String(row._id.standeeId)}`
          : null;
      if (!key) continue;
      const counts = hostCounts.get(key);
      if (!counts) continue;

      const day = row._id.day;
      if (!dayCounts.has(day)) {
        dayCounts.set(day, { visits: 0, totalCopies: 0, aiCopies: 0, manualCopies: 0 });
      }
      const dayRow = dayCounts.get(day)!;
      if (!hostDayCounts.has(key)) hostDayCounts.set(key, new Map());
      const hostDays = hostDayCounts.get(key)!;
      if (!hostDays.has(day)) {
        hostDays.set(day, { visits: 0, totalCopies: 0, aiCopies: 0, manualCopies: 0 });
      }
      const hostDay = hostDays.get(day)!;

      const add = (field: keyof ReviewAnalyticsCounts, value: number) => {
        counts[field] += value;
        totals[field] += value;
      };

      if (row._id.action === 'review_page_view') {
        add('visits', row.count);
        dayRow.visits += row.count;
        hostDay.visits += row.count;
      } else if (row._id.action === 'review_copied') {
        add('totalCopies', row.count);
        dayRow.totalCopies += row.count;
        hostDay.totalCopies += row.count;
        const source = parseCopySource(row._id.metadata);
        if (source === 'ai') {
          add('aiCopies', row.count);
          dayRow.aiCopies += row.count;
          hostDay.aiCopies += row.count;
        } else if (source === 'manual') {
          add('manualCopies', row.count);
          dayRow.manualCopies += row.count;
          hostDay.manualCopies += row.count;
        } else {
          add('unclassifiedCopies', row.count);
        }
      } else if (row._id.action === 'review_suggestions_shown') {
        add('suggestionsShown', row.count);
      } else if (row._id.action === 'review_generated') {
        add('generated', row.count);
      } else if (row._id.action === 'review_google_clicked') {
        add('googleClicks', row.count);
      }
    }
  }

  const rotationRows = (await ReviewRotationEvent.aggregate([
    {
      $match: {
        businessId: new Types.ObjectId(input.userId),
        copiedAt: { $gte: from, $lte: to },
      },
    },
    {
      $group: {
        _id: { cardId: '$cardId', standeeId: '$standeeId' },
        count: { $sum: 1 },
      },
    },
  ])) as Array<{
    _id: { cardId?: unknown; standeeId?: unknown };
    count: number;
  }>;

  for (const row of rotationRows) {
    const key = row._id.cardId
      ? `card:${String(row._id.cardId)}`
      : row._id.standeeId
        ? `standee:${String(row._id.standeeId)}`
        : null;
    if (!key) continue;
    const counts = hostCounts.get(key);
    if (counts) counts.rotationCopies += row.count;
    if (!selectedHost || selectedHost.hostKey === key) totals.rotationCopies += row.count;
  }

  const selectedHostCounts = selectedHost ? hostCounts.get(selectedHost.hostKey) : undefined;
  const finalTotals = selectedHostCounts ?? totals;

  const series: ReviewAnalyticsResult['series'] = [];
  const cursor = new Date(from);
  while (cursor.getTime() <= to.getTime()) {
    const key = dayKey(cursor);
    const base = selectedHost
      ? hostDayCounts.get(selectedHost.hostKey)?.get(key)
      : dayCounts.get(key);
    series.push({
      date: key,
      visits: base?.visits ?? 0,
      totalCopies: base?.totalCopies ?? 0,
      aiCopies: base?.aiCopies ?? 0,
      manualCopies: base?.manualCopies ?? 0,
    });
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  // Product options remain stable across filters: all review-capable hosts plus
  // any host with actual review activity (historical/inactive included).
  const products: ReviewAnalyticsProduct[] = hosts
    .filter((host) => {
      const counts = hostCounts.get(host.hostKey);
      const hasActivity = Boolean(
        counts &&
          (counts.visits ||
            counts.totalCopies ||
            counts.rotationCopies ||
            counts.suggestionsShown ||
            counts.generated ||
            counts.googleClicks)
      );
      return host.reviewCapable || hasActivity;
    })
    .map((host) => ({
      ...host,
      ...(hostCounts.get(host.hostKey) ?? emptyCounts()),
    }))
    .sort((a, b) => a.title.localeCompare(b.title));

  if (selectedHost && !products.some((product) => product.hostKey === selectedHost.hostKey)) {
    return { ok: false, code: 'INVALID_HOST' };
  }

  return {
    ok: true,
    data: {
      from: from.toISOString(),
      to: to.toISOString(),
      range,
      totals: finalTotals,
      series,
      products,
    },
  };
}
