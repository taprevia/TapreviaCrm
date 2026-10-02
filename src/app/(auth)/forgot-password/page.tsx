'use client';

import { useState } from 'react';
import Link from 'next/link';
import { AlertCircle, ArrowLeft, CheckCircle, CreditCard, Mail, Send } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const res = await fetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || 'Something went wrong. Please try again.');
        return;
      }

      setSent(true);
    } catch {
      setError('An error occurred. Please try again.');
    } finally {
      setLoading(false);
    }
  };

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
          <h2 className="mt-6 text-2xl font-bold text-gray-900 tracking-tight">Reset your password</h2>
          <p className="mt-2 text-sm text-gray-500">
            Enter the email address linked to your account and we&apos;ll send you a reset link.
          </p>
        </div>

        {sent ? (
          <div className="rounded-xl bg-emerald-50 p-4 text-sm text-emerald-700 ring-1 ring-emerald-200 animate-fade-in flex items-start gap-2.5">
            <CheckCircle className="h-4 w-4 shrink-0 mt-0.5" />
            <div>
              If an account exists for that email, a password reset link is on its way. Check your
              inbox in a few minutes.
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            {error && (
              <div className="rounded-xl bg-red-50 p-3.5 text-sm text-red-600 ring-1 ring-red-200 animate-fade-in flex items-center gap-2">
                <AlertCircle className="h-4 w-4 shrink-0" />
                {error}
              </div>
            )}

            <div className="relative">
              <Mail className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
              <Input
                id="email"
                type="email"
                placeholder="Email address"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="pl-10"
                required
              />
            </div>

            <div className="pt-2">
              <Button type="submit" className="w-full" isLoading={loading}>
                Send Reset Link
                <Send className="ml-2 h-4 w-4" />
              </Button>
            </div>
          </form>
        )}

        <div className="mt-8 text-center">
          <Link
            href="/login"
            className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700 transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to login
          </Link>
        </div>
      </div>
    </div>
  );
}