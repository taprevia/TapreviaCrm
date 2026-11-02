import { NextRequest, NextResponse } from 'next/server';
import { createHash } from 'crypto';
import { clientIp } from '@/lib/request-ip';
import { check } from '@/lib/rate-limit';
import { fail, ok } from '@/lib/api';
import User from '@/models/User';
import {
  OTP_IP_LIMIT,
  OTP_IP_WINDOW_MS,
  OTP_RESEND_COOLDOWN_MS,
  OTP_SEND_LIMIT,
  OTP_SEND_WINDOW_MS,
  beginOtpChallenge,
  confirmOtpSent,
  discardOtpChallenge,
  latestOtpSentAt,
  normalizeResetEmail,
  completePasswordReset,
  verifyOtp,
} from '@/lib/services/password-reset-otp';
import {
  completePasswordResetSchema,
  requestPasswordResetOtpSchema,
  verifyPasswordResetOtpSchema,
} from '@/lib/validation/password-reset-otp';
import { sendPasswordResetOtpEmail } from '@/lib/mail';

const GENERIC_MESSAGE =
  'If an account exists for this email, a verification code will be sent.';

function noStore(response: NextResponse): NextResponse {
  response.headers.set('Cache-Control', 'no-store');
  return response;
}

function emailKey(email: string): string {
  return createHash('sha256').update(email).digest('hex');
}

/**
 * Shared by request-otp and resend-otp. Always returns the same generic body
 * for known/unknown addresses and for provider failures, so it cannot be used
 * to enumerate accounts. Operational failures are logged by challenge id only.
 */
export async function handleRequestOtp(request: NextRequest): Promise<NextResponse> {
  try {
    const ip = clientIp(request);
    const ipLimit = await check(`pr-otp-ip:${ip}`, OTP_IP_LIMIT, OTP_IP_WINDOW_MS);
    if (!ipLimit.success) {
      return noStore(fail(429, 'RATE_LIMITED', 'Too many requests. Please try again shortly.'));
    }

    const body = await request.json().catch(() => null);
    const parsed = requestPasswordResetOtpSchema.safeParse(body);
    if (!parsed.success) {
      return noStore(fail(400, 'VALIDATION_ERROR', 'Invalid input', parsed.error.flatten().fieldErrors));
    }

    const email = normalizeResetEmail(parsed.data.email);
    const key = emailKey(email);

    // Four issuances per 15 minutes (initial + up to three resends).
    const sendLimit = await check(`pr-otp-send:${key}`, OTP_SEND_LIMIT, OTP_SEND_WINDOW_MS);
    if (!sendLimit.success) {
      return noStore(ok({ success: true, expiresIn: 600, resendAfter: 60, message: GENERIC_MESSAGE }));
    }

    const lastSent = await latestOtpSentAt(email);
    if (lastSent && Date.now() - lastSent.getTime() < OTP_RESEND_COOLDOWN_MS) {
      const resendAfter = Math.max(
        1,
        Math.ceil((OTP_RESEND_COOLDOWN_MS - (Date.now() - lastSent.getTime())) / 1000)
      );
      return noStore(ok({ success: true, expiresIn: 600, resendAfter, message: GENERIC_MESSAGE }));
    }

    // Short issuance lock prevents concurrent requests from creating two
    // simultaneously active challenges and sending two emails.
    const issueLock = await check(`pr-otp-issue:${key}`, 1, 30_000);
    if (!issueLock.success) {
      return noStore(ok({ success: true, expiresIn: 600, resendAfter: 30, message: GENERIC_MESSAGE }));
    }

    const user = await User.findOne({ email })
      .select('_id email status')
      .lean<{ _id: unknown; email: string; status?: string } | null>();

    if (!user || user.status === 'suspended') {
      return noStore(ok({ success: true, expiresIn: 600, resendAfter: 60, message: GENERIC_MESSAGE }));
    }

    const challenge = await beginOtpChallenge(String(user._id), email);
    if (!challenge.ok) {
      return noStore(ok({ success: true, expiresIn: 600, resendAfter: 60, message: GENERIC_MESSAGE }));
    }

    const sent = await sendPasswordResetOtpEmail(user.email, challenge.otp);
    if (!sent.ok) {
      // Keep the previously active OTP usable when the replacement failed.
      await discardOtpChallenge(challenge.challengeId).catch(() => undefined);
      console.error(
        `[password-reset-otp] delivery failed for challenge ${challenge.challengeId}; prior challenge preserved`
      );
      return noStore(ok({ success: true, expiresIn: 600, resendAfter: 60, message: GENERIC_MESSAGE }));
    }

    await confirmOtpSent(challenge.challengeId, email);
    return noStore(ok({ success: true, expiresIn: 600, resendAfter: 60, message: GENERIC_MESSAGE }));
  } catch (error) {
    console.error('[password-reset-otp] request failed:', error instanceof Error ? error.message : String(error));
    return noStore(fail(500, 'INTERNAL_ERROR', 'Internal server error'));
  }
}

export async function handleVerifyOtp(request: NextRequest): Promise<NextResponse> {
  try {
    const ip = clientIp(request);
    const ipLimit = await check(`pr-otp-verify:${ip}`, 30, OTP_IP_WINDOW_MS);
    if (!ipLimit.success) {
      return noStore(fail(429, 'RATE_LIMITED', 'Too many attempts. Please request a new code.'));
    }
    const body = await request.json().catch(() => null);
    const parsed = verifyPasswordResetOtpSchema.safeParse(body);
    if (!parsed.success) {
      return noStore(fail(400, 'VALIDATION_ERROR', 'Invalid input', parsed.error.flatten().fieldErrors));
    }

    const result = await verifyOtp(normalizeResetEmail(parsed.data.email), parsed.data.otp);
    if (!result.ok) {
      // One message for unknown, expired, superseded and exhausted codes.
      return noStore(
        fail(400, 'BAD_REQUEST', 'Invalid or expired verification code. Request a new code.')
      );
    }

    return noStore(
      ok({ success: true, grant: result.grant, expiresIn: Math.round((result.expiresAt.getTime() - Date.now()) / 1000) })
    );
  } catch (error) {
    console.error('[password-reset-otp] verify failed:', error instanceof Error ? error.message : String(error));
    return noStore(fail(500, 'INTERNAL_ERROR', 'Internal server error'));
  }
}

export async function handleCompleteReset(request: NextRequest): Promise<NextResponse> {
  try {
    const body = await request.json().catch(() => null);
    const parsed = completePasswordResetSchema.safeParse(body);
    if (!parsed.success) {
      return noStore(fail(400, 'VALIDATION_ERROR', 'Invalid input', parsed.error.flatten().fieldErrors));
    }

    const result = await completePasswordReset(parsed.data.grant, parsed.data.newPassword);
    if (!result.ok) {
      return noStore(
        fail(400, 'BAD_REQUEST', 'This reset authorization is invalid or has already been used.')
      );
    }

    return noStore(ok({ success: true }));
  } catch (error) {
    console.error('[password-reset-otp] completion failed:', error instanceof Error ? error.message : String(error));
    return noStore(fail(500, 'INTERNAL_ERROR', 'Internal server error'));
  }
}
