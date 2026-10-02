import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser } from '@/lib/auth';
import { fail } from '@/lib/api';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const user = await getAuthUser(request);
    if (!user) {
      return fail(401, 'UNAUTHORIZED', 'Not authenticated');
    }
    return NextResponse.json({ user });
  } catch (error) {
    console.error('Get me error:', error);
    return fail(500, 'INTERNAL_ERROR', 'Internal server error');
  }
}
