'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { AlertCircle, CheckCircle, CreditCard, KeyRound, Lock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { isPasswordCompliant, PASSWORD_POLICY_MESSAGE } from '@/lib/auth/password-policy';

export default function ResetPasswordPage() {
  const [token, setToken] = useState<string | null>(null);
  const [tokenReady, setTokenReady] = useState(false);
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const t = params.get('token');
    setToken(t && t.length > 0 ? t : null);
    setTokenReady(true);
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

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
      const res = await fetch('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, newPassword }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || 'This reset link could not be used.');
        return;
      }

      setSuccess(true);
    } catch {
      setError('An error occurred. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  if (!tokenReady) {
    return <div className="flex min-h-screen items-center justify-center bg-gray-50" />;
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 p-8">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <Link href="/" className="inline-flex items-center gap-2">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-600 shadow-sm">
              <CreditCard className="h-5 w-5 text-white" />
            </div>
            <span className="text-2xl font-bold text-gray-900 tracking-tight">Taprevia</span>
          </Link>
        </div>

        {success ? (
          <div className="rounded-xl bg-emerald-50 p-5 text-sm text-emerald-700 ring-1 ring-emerald-200 animate-fade-in">
            <div className="flex items-start gap-2.5">
              <CheckCircle className="h-4 w-4 shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold">Password updated</p>
                <p className="mt-1">Your password has been reset. Sign in with your new password.</p>
              </div>
            </div>
            <div className="mt-5">
              <Link href="/login">
                <Button type="button" className="w-full">
                  Back to login
                </Button>
              </Link>
            </div>
          </div>
        ) : !token ? (
          <div className="rounded-xl bg-red-50 p-5 text-sm text-red-600 ring-1 ring-red-200 animate-fade-in">
            <div className="flex items-start gap-2.5">
              <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold">Invalid reset link</p>
                <p className="mt-1">
                  This link is missing or malformed. Request a new one to continue.
                </p>
              </div>
            </div>
            <div className="mt-5">
              <Link href="/forgot-password">
                <Button type="button" variant="outline" className="w-full">
                  Request a new link
                </Button>
              </Link>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="text-center">
              <h2 className="text-2xl font-bold text-gray-900 tracking-tight">Choose a new password</h2>
              <p className="mt-2 text-sm text-gray-500">
                Enter a new password for your account.
              </p>
            </div>

            {error && (
              <div className="rounded-xl bg-red-50 p-3.5 text-sm text-red-600 ring-1 ring-red-200 animate-fade-in flex items-center gap-2">
                <AlertCircle className="h-4 w-4 shrink-0" />
                {error}
              </div>
            )}

            <div className="relative">
              <Lock className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
              <Input
                id="new-password"
                type="password"
                placeholder="8+ characters incl. letter and number"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                className="pl-10"
                required
              />
            </div>

            <div className="relative">
              <KeyRound className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
              <Input
                id="confirm-password"
                type="password"
                placeholder="Confirm new password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="pl-10"
                required
              />
            </div>

            <div className="pt-2">
              <Button type="submit" className="w-full" isLoading={loading}>
                Update Password
              </Button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}