import { NextRequest, NextResponse } from 'next/server';
import { connectDB } from '@/lib/db';
import { requireAdminStrict } from '@/lib/auth';
import { fail } from '@/lib/api';
import User from '@/models/User';
import Profile from '@/models/Profile';
import Card from '@/models/Card';
import { createCustomerSchema } from '@/lib/validation/catalog';
import { createCustomerWithProducts } from '@/lib/services/customer-creation';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
const admin = await requireAdminStrict(request);
    if (admin.kind === 'unauthorized') return fail(401, 'UNAUTHORIZED', 'Unauthorized');
    if (admin.kind === 'forbidden') return fail(403, 'FORBIDDEN', 'Forbidden');

    await connectDB();
    const { search, sort = 'createdAt', order = 'desc' } = Object.fromEntries(
      new URL(request.url).searchParams
    );

    const query: Record<string, unknown> = { role: 'customer' };
    if (search) {
      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } },
      ];
    }

    const sortOptions: Record<string, 1 | -1> = { [sort as string]: order === 'desc' ? -1 : 1 };

    const users = await User.find(query)
      .select('-passwordHash')
      .sort(sortOptions)
      .lean();

    const userIds = users.map((u) => u._id);

    const [profiles, cards] = await Promise.all([
      Profile.find({ userId: { $in: userIds } }).lean(),
      Card.find({ assignedUserId: { $in: userIds } }).lean(),
    ]);

    const profileMap = new Map(profiles.map((p) => [p.userId.toString(), p]));
    const cardGroups = new Map<string, Record<string, unknown>[]>();
    for (const c of cards) {
      const owner = c.assignedUserId?.toString();
      if (!owner) continue;
      const list = cardGroups.get(owner) ?? [];
      list.push(c);
      cardGroups.set(owner, list);
    }

    const enrichedUsers = users.map((u: Record<string, unknown>) => {
      const userCards = cardGroups.get((u._id as { toString(): string }).toString()) ?? [];
      return {
        ...u,
        profile: profileMap.get((u._id as { toString(): string }).toString()) || null,
        cards: userCards,
        card: userCards[0] ?? null,
      };
    });

    return NextResponse.json({ users: enrichedUsers });
  } catch (error) {
    console.error('Admin users error:', error);
    return fail(500, 'INTERNAL_ERROR', 'Internal server error');
  }
}

export async function POST(request: NextRequest) {
  try {
    const admin = await requireAdminStrict(request);
    if (admin.kind === 'unauthorized') return fail(401, 'UNAUTHORIZED', 'Unauthorized');
    if (admin.kind === 'forbidden') return fail(403, 'FORBIDDEN', 'Forbidden');

    await connectDB();

    const body = await request.json().catch(() => null);
    const parsed = createCustomerSchema.safeParse(body);
    if (!parsed.success) {
      return fail(400, 'VALIDATION_ERROR', 'Invalid input', parsed.error.flatten().fieldErrors);
    }

    const result = await createCustomerWithProducts({
      name: parsed.data.name,
      email: parsed.data.email,
      password: parsed.data.password,
      urlSlug: parsed.data.urlSlug,
      products: parsed.data.products,
      assignedBy: admin.user._id,
    });

    if (!result.ok) {
      const code =
        result.status === 404 ? 'NOT_FOUND' : result.status === 409 ? 'CONFLICT' : 'BAD_REQUEST';
      return fail(result.status as 400 | 404 | 409, code, result.error);
    }

    return NextResponse.json(result.data, { status: 201 });
  } catch (error) {
    console.error('Admin create user error:', error);
    return fail(500, 'INTERNAL_ERROR', 'Internal server error');
  }
}
