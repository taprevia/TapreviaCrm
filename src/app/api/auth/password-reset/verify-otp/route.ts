import type { NextRequest } from 'next/server';
import { handleVerifyOtp } from '@/lib/services/password-reset-otp-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  return handleVerifyOtp(request);
}
