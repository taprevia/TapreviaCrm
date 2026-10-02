import { Types } from 'mongoose';
import { NextRequest } from 'next/server';
import { connectDB } from '@/lib/db';
import { requireAnyApiCapability } from '@/lib/auth/capability-guard';
import { ANALYTICS_CAPABILITIES } from '@/config/capabilities';
import AnalyticsLog from '@/models/AnalyticsLog';
import Card from '@/models/Card';
import Standee from '@/models/Standee';
import { objectIdSchema } from '@/lib/validation/common';
import { fail, ok } from '@/lib/api';

export const dynamic = 'force-dynamic';

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const MAX_RANGE_DAYS = 366;
const DEFAULT_WINDOW_DAYS = 30;

interface GroupRow {
  _id: { day: string; action: string };
  count: number;
}

function isValidDate(value: string): boolean {
  return !Number.isNaN(Date.parse(value));
}

function utcMidnight(date: Date): Date {
  const d = new Date(date);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

function toDayKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// GET /api/analytics?cardId=…&from=…&to=…  |  ?standeeId=…&from=…&to=…
export async function GET(request: NextRequest) {
  try {
    const token = request.cookies.get('token')?.value;
    if (!token) return fail(401, 'UNAUTHORIZED', 'Unauthorized');
    const user = await requireAnyApiCapability(request, [...ANALYTICS_CAPABILITIES]);
    if (!user) return fail(403, 'FORBIDDEN', 'Your products do not include Analytics');

    const sp = new URL(request.url).searchParams;

    const cardIdRaw = sp.get('cardId') ?? '';
    const standeeIdRaw = sp.get('standeeId') ?? '';
    if (cardIdRaw && standeeIdRaw) {
      return fail(400, 'VALIDATION_ERROR', 'Provide either cardId or standeeId, not both');
    }
    if (!cardIdRaw && !standeeIdRaw) {
      return fail(400, 'VALIDATION_ERROR', 'cardId or standeeId is required');
    }

    await connectDB();

    // ── Resolve the analytics target + ownership ───────────────────────────
    let matchFilter: Record<string, unknown>;
    if (cardIdRaw) {
      const parsedId = objectIdSchema.safeParse(cardIdRaw);
      if (!parsedId.success) {
        return fail(400, 'VALIDATION_ERROR', 'cardId is required');
      }
      const cardObjectId = new Types.ObjectId(parsedId.data);
      const card = await Card.findById(cardObjectId).select('userId assignedUserId');
      if (!card) return fail(404, 'NOT_FOUND', 'Card not found');
      const owns =
        (card.userId !== null && card.userId.toString() === user._id) ||
        (card.assignedUserId !== null && card.assignedUserId.toString() === user._id);
      if (!owns && user.role !== 'admin') {
        return fail(403, 'FORBIDDEN', 'Not allowed');
      }
      matchFilter = { cardId: cardObjectId };
    } else {
      const parsedId = objectIdSchema.safeParse(standeeIdRaw);
      if (!parsedId.success) {
        return fail(400, 'VALIDATION_ERROR', 'standeeId is required');
      }
      const standeeObjectId = new Types.ObjectId(parsedId.data);
      const standee = await Standee.findById(standeeObjectId).select('userId routeSlug');
      if (!standee) return fail(404, 'NOT_FOUND', 'Standee not found');
      const owns = standee.userId !== null && standee.userId.toString() === user._id;
      if (!owns && user.role !== 'admin') {
        return fail(403, 'FORBIDDEN', 'Not allowed');
      }
      const rowKey = (standee.routeSlug as string | undefined)?.toLowerCase() ?? '';
      if (!rowKey) return fail(400, 'VALIDATION_ERROR', 'Standee has no route configured');
      // Standee taps are recorded on AnalyticsLog with cardId null and
      // metadata "route:{routeSlug}" or "route:{routeSlug}/slot:{n}/platform:{p}"
      // (see /r/[...slug]). No schema change needed — the prefix match covers
      // the panel QR and every zone/slot tap of this standee.
      matchFilter = {
        cardId: null,
        metadata: { $regex: new RegExp(`^route:${escapeRegExp(rowKey)}(?:/|$)`), $options: 'i' },
      };
    }

    const fromRaw = sp.get('from');
    const toRaw = sp.get('to');
    if (fromRaw && !isValidDate(fromRaw)) return fail(400, 'VALIDATION_ERROR', 'Invalid `from` date');
    if (toRaw && !isValidDate(toRaw)) return fail(400, 'VALIDATION_ERROR', 'Invalid `to` date');

    const toRequested = toRaw ? new Date(toRaw as string) : new Date();
    const from = fromRaw
      ? utcMidnight(new Date(fromRaw))
      : utcMidnight(new Date(toRequested.getTime() - (DEFAULT_WINDOW_DAYS - 1) * MS_PER_DAY));
    const to = new Date(utcMidnight(toRequested).getTime() + MS_PER_DAY - 1);

    if (utcMidnight(from).getTime() > utcMidnight(toRequested).getTime()) {
      return fail(400, 'VALIDATION_ERROR', '`from` must not be after `to`');
    }

    const rangeDays = Math.floor((to.getTime() - from.getTime()) / MS_PER_DAY) + 1;
    if (rangeDays > MAX_RANGE_DAYS) {
      return fail(400, 'VALIDATION_ERROR', `Date range too large (max ${MAX_RANGE_DAYS} days)`);
    }

    matchFilter.createdAt = { $gte: from, $lte: to };

    const rows = await AnalyticsLog.aggregate<GroupRow>([
      { $match: matchFilter },
      {
        $group: {
          _id: {
            day: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
            action: '$action',
          },
          count: { $sum: 1 },
        },
      },
    ]);

    const byDay = new Map<string, Map<string, number>>();
    const totals: Record<string, number> = {};
    for (const row of rows) {
      const { day, action } = row._id;
      if (!byDay.has(day)) byDay.set(day, new Map());
      byDay.get(day)!.set(action, row.count);
      totals[action] = (totals[action] ?? 0) + row.count;
    }

    const actions = Object.keys(totals).sort();

    const series: Array<{ date: string; counts: Record<string, number> }> = [];
    const cursor = new Date(from);
    while (cursor.getTime() <= to.getTime()) {
      const key = toDayKey(cursor);
      const dayMap = byDay.get(key);
      const counts: Record<string, number> = {};
      for (const action of actions) {
        counts[action] = dayMap?.get(action) ?? 0;
      }
      series.push({ date: key, counts });
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }

    return ok({ series, totals });
  } catch (error) {
    console.error('Analytics GET error:', error);
    return fail(500, 'INTERNAL_ERROR', 'Internal server error');
  }
}
