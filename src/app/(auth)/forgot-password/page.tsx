'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle,
  CreditCard,
  Eye,
  EyeOff,
  KeyRound,
  Lock,
  Mail,
  Send,
  ShieldCheck,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { isPasswordCompliant, PASSWORD_POLICY_MESSAGE } from '@/lib/auth/password-policy';

type Step = 'email' | 'otp' | 'password' | 'success';

interface ApiResponse {
  error?: string;
  message?: string;
  success?: boolean;
  grant?: string;
  expiresIn?: number;
  resendAfter?: number;
  details?: unknown;
}

function maskEmail(value: string): string {
  const [local, domain] = value.split('@');
  if (!local || !domain) return value;
  const visible = local.slice(0, 1);
  return `${visible}${'*'.repeat(Math.max(2, Math.min(6, local.length - 1)))}@${domain}`;
}

export default function ForgotPasswordPage() {
  const [step, setStep] = useState<Step>('email');
  const [email, setEmail] = useState('');
  const [otp, setOtp] = useState('');
  const [grant, setGrant] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(false);
  const [cooldown, setCooldown] = useState(0);

  const cooldownActive = cooldown > 0;
  const emailRef = useRef<HTMLInputElement>(null);
  const otpRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const successRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    if (!cooldownActive) return;
    const timer = window.setInterval(() => {
      setCooldown((current) => (current <= 1 ? 0 : current - 1));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [cooldownActive]);

  useEffect(() => {
    if (step === 'otp') otpRef.current?.focus();
    if (step === 'password') passwordRef.current?.focus();
    if (step === 'success') successRef.current?.focus();
  }, [step]);

  async function postJson(path: string, body: Record<string, unknown>): Promise<ApiResponse> {
    const res = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = (await res.json().catch(() => null)) as ApiResponse | null;
    if (!res.ok) {
      throw new Error(data?.error || 'Something went wrong. Please try again.');
    }
    return data ?? {};
  }

  async function handleSendOtp(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setStatus('');
    setLoading(true);
    try {
      const data = await postJson('/api/auth/password-reset/request-otp', {
        email: email.trim(),
      });
      setOtp('');
      setStep('otp');
      setCooldown(Number(data.resendAfter ?? 60));
      setStatus(data.message || 'If an account exists for this email, a verification code will be sent.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  async function handleResendOtp() {
    if (cooldown > 0 || loading) return;
    setError('');
    setStatus('');
    setLoading(true);
    try {
      const data = await postJson('/api/auth/password-reset/resend-otp', {
        email: email.trim(),
      });
      setOtp('');
      setCooldown(Number(data.resendAfter ?? 60));
      setStatus('A new verification code has been sent.');
      otpRef.current?.focus();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not resend the code.');
    } finally {
      setLoading(false);
    }
  }

  async function handleVerifyOtp(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setStatus('');
    if (!/^\d{6}$/.test(otp)) {
      setError('Enter the complete 6-digit verification code.');
      return;
    }
    setLoading(true);
    try {
      const data = await postJson('/api/auth/password-reset/verify-otp', {
        email: email.trim(),
        otp,
      });
      if (!data.grant) throw new Error('Verification failed. Request a new code.');
      setGrant(data.grant);
      setStatus('');
      setStep('password');
    } catch (err) {
      setOtp('');
      setError(err instanceof Error ? err.message : 'Invalid or expired verification code.');
      otpRef.current?.focus();
    } finally {
      setLoading(false);
    }
  }

  async function handleComplete(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setStatus('');
    if (newPassword !== confirmPassword) {
      setError('New passwords do not match');
      return;
    }
    if (!isPasswordCompliant(newPassword)) {
      setError(PASSWORD_POLICY_MESSAGE);
      return;
    }
    setLoading(true);
    try {
      await postJson('/api/auth/password-reset/complete', {
        grant,
        newPassword,
      });
      setGrant('');
      setNewPassword('');
      setConfirmPassword('');
      setStep('success');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not reset the password.');
    } finally {
      setLoading(false);
    }
  }

  function changeEmail() {
    setStep('email');
    setOtp('');
    setGrant('');
    setNewPassword('');
    setConfirmPassword('');
    setError('');
    setStatus('');
    setCooldown(0);
    window.setTimeout(() => emailRef.current?.focus(), 0);
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 p-4 sm:p-8">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <Link href="/" className="inline-flex items-center gap-2">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-600 shadow-sm">
              <CreditCard className="h-5 w-5 text-white" />
            </div>
            <span className="text-2xl font-bold tracking-tight text-gray-900">Taprevia</span>
          </Link>
        </div>

        <div aria-live="polite" role="status" className="sr-only">
          {status}
        </div>

        {step === 'email' && (
          <>
            <div className="mb-6 text-center">
              <h1 className="text-2xl font-bold tracking-tight text-gray-900">Forgot Password?</h1>
              <p className="mt-2 text-sm text-gray-500">
                Enter your registered email address to receive a verification code.
              </p>
            </div>

            {error && (
              <div role="alert" className="mb-4 flex items-center gap-2 rounded-xl bg-red-50 p-3.5 text-sm text-red-600 ring-1 ring-red-200">
                <AlertCircle className="h-4 w-4 shrink-0" aria-hidden="true" />
                {error}
              </div>
            )}

            <form onSubmit={handleSendOtp} className="space-y-4">
              <div>
                <label htmlFor="reset-email" className="mb-1.5 block text-sm font-medium text-gray-700">
                  Email Address
                </label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" aria-hidden="true" />
                  <Input
                    ref={emailRef}
                    id="reset-email"
                    type="email"
                    autoComplete="email"
                    placeholder="you@example.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="pl-10"
                    required
                  />
                </div>
              </div>

              <Button type="submit" className="w-full" isLoading={loading}>
                Send OTP
                <Send className="ml-2 h-4 w-4" aria-hidden="true" />
              </Button>
            </form>
          </>
        )}

        {step === 'otp' && (
          <>
            <div className="mb-6 text-center">
              <h1 className="text-2xl font-bold tracking-tight text-gray-900">Verify Your Email</h1>
              <p className="mt-2 text-sm text-gray-500">
                Enter the 6-digit verification code sent to{' '}
                <span className="font-medium text-gray-700">{maskEmail(email)}</span>.
              </p>
            </div>

            {status && (
              <div role="status" className="mb-4 flex items-center gap-2 rounded-xl bg-emerald-50 p-3 text-sm text-emerald-700 ring-1 ring-emerald-200">
                <CheckCircle className="h-4 w-4 shrink-0" aria-hidden="true" />
                {status}
              </div>
            )}
            {error && (
              <div role="alert" className="mb-4 flex items-center gap-2 rounded-xl bg-red-50 p-3.5 text-sm text-red-600 ring-1 ring-red-200">
                <AlertCircle className="h-4 w-4 shrink-0" aria-hidden="true" />
                {error}
              </div>
            )}

            <form onSubmit={handleVerifyOtp} className="space-y-4">
              <div>
                <label htmlFor="reset-otp" className="mb-1.5 block text-sm font-medium text-gray-700">
                  Verification Code
                </label>
                <Input
                  ref={otpRef}
                  id="reset-otp"
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  pattern="[0-9]*"
                  maxLength={6}
                  placeholder="000000"
                  value={otp}
                  onChange={(e) => {
                    setOtp(e.target.value.replace(/\D/g, '').slice(0, 6));
                    setError('');
                  }}
                  className="text-center text-lg tracking-[0.5em]"
                  aria-describedby="otp-hint"
                  required
                />
                <p id="otp-hint" className="mt-1.5 text-xs text-gray-500">
                  The code expires in 10 minutes. Check your spam folder if it has not arrived.
                </p>
              </div>

              <Button type="submit" className="w-full" isLoading={loading} disabled={otp.length !== 6}>
                Verify OTP
              </Button>
            </form>

            <div className="mt-4 flex items-center justify-between gap-3 text-sm">
              <button
                type="button"
                onClick={handleResendOtp}
                disabled={cooldown > 0 || loading}
                className="font-medium text-blue-600 hover:text-blue-700 disabled:cursor-not-allowed disabled:text-gray-400"
              >
                {cooldown > 0 ? `Resend code in ${cooldown}s` : 'Resend Code'}
              </button>
              <button type="button" onClick={changeEmail} className="font-medium text-gray-600 hover:text-gray-900">
                Change Email
              </button>
            </div>
          </>
        )}

        {step === 'password' && (
          <>
            <div className="mb-6 text-center">
              <h1 className="text-2xl font-bold tracking-tight text-gray-900">Create New Password</h1>
              <p className="mt-2 text-sm text-gray-500">Enter a new password for your account.</p>
            </div>

            {error && (
              <div role="alert" className="mb-4 flex items-center gap-2 rounded-xl bg-red-50 p-3.5 text-sm text-red-600 ring-1 ring-red-200">
                <AlertCircle className="h-4 w-4 shrink-0" aria-hidden="true" />
                {error}
              </div>
            )}

            <form onSubmit={handleComplete} className="space-y-4">
              <div>
                <label htmlFor="new-password" className="mb-1.5 block text-sm font-medium text-gray-700">
                  New Password
                </label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" aria-hidden="true" />
                  <Input
                    ref={passwordRef}
                    id="new-password"
                    type={showPassword ? 'text' : 'password'}
                    autoComplete="new-password"
                    placeholder="8+ characters incl. letter and number"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    className="pl-10 pr-11"
                    aria-describedby="password-hint"
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((value) => !value)}
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                    aria-pressed={showPassword}
                    className="absolute right-2 top-1/2 grid h-8 w-8 -translate-y-1/2 place-items-center rounded text-gray-500 hover:text-gray-700"
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" aria-hidden="true" /> : <Eye className="h-4 w-4" aria-hidden="true" />}
                  </button>
                </div>
                <p id="password-hint" className="mt-1.5 text-xs text-gray-500">
                  At least 8 characters, including one letter and one number.
                </p>
              </div>

              <div>
                <label htmlFor="confirm-password" className="mb-1.5 block text-sm font-medium text-gray-700">
                  Confirm New Password
                </label>
                <div className="relative">
                  <KeyRound className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" aria-hidden="true" />
                  <Input
                    id="confirm-password"
                    type={showPassword ? 'text' : 'password'}
                    autoComplete="new-password"
                    placeholder="Confirm new password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    className="pl-10"
                    required
                  />
                </div>
              </div>

              <Button type="submit" className="w-full" isLoading={loading}>
                Reset Password
              </Button>
            </form>
          </>
        )}

        {step === 'success' && (
          <div className="rounded-xl bg-emerald-50 p-5 text-sm text-emerald-700 ring-1 ring-emerald-200">
            <div className="flex items-start gap-2.5">
              <CheckCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <div>
                <h1 ref={successRef} tabIndex={-1} className="font-semibold focus:outline-none">
                  Password Reset Successfully
                </h1>
                <p className="mt-1">Your password has been updated. You can now sign in.</p>
              </div>
            </div>
            <div className="mt-5">
              <Link href="/login">
                <Button type="button" className="w-full">
                  Back to Login
                </Button>
              </Link>
            </div>
          </div>
        )}

        <div className="mt-8 text-center">
          <Link href="/login" className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700">
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            Back to login
          </Link>
        </div>

        <p className="mt-4 flex items-center justify-center gap-1.5 text-xs text-gray-500">
          <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
          Verification codes are single-use and expire in 10 minutes.
        </p>
      </div>
    </div>
  );
}
