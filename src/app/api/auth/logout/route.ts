import { NextResponse } from 'next/server';
import { clearAuthCookie } from '@/lib/auth';
import { fail } from '@/lib/api';

export async function POST() {
  try {
    const response = NextResponse.json({ message: 'Logged out successfully' });
    return clearAuthCookie(response);
  } catch (error) {
    console.error('Logout error:', error);
    return fail(500, 'INTERNAL_ERROR', 'Internal server error');
  }
}
