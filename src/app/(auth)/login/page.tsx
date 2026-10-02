'use client';

import { useState } from 'react';
import Link from 'next/link';
import { CreditCard, Mail, Lock, ArrowRight, Eye, EyeOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || 'Login failed');
        return;
      }

      if (data.user.role === 'admin') {
        // Full-page navigation (not router.push): busts Next's client router
        // cache so the dashboard is re-fetched under the freshly-minted
        // session cookie. Otherwise a cached RSC payload from a previous
        // session (different account) can be replayed for the same URL.
        window.location.assign('/admin');
      } else {
        window.location.assign('/dashboard');
      }
    } catch {
      setError('An error occurred. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen">
      <div className="hidden w-1/2 bg-gradient-to-br from-blue-600 via-blue-700 to-indigo-800 lg:flex lg:items-center lg:justify-center relative overflow-hidden">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_20%,rgba(255,255,255,0.1),transparent_50%)]" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_70%_80%,rgba(255,255,255,0.05),transparent_50%)]" />
        <div className="relative max-w-md px-8 text-center">
          <div className="mx-auto mb-8 flex h-20 w-20 items-center justify-center rounded-2xl bg-white/10 backdrop-blur-sm ring-1 ring-white/20 shadow-xl">
            <CreditCard className="h-10 w-10 text-white" />
          </div>
          <h1 className="text-3xl font-bold text-white tracking-tight">Welcome back to Taprevia</h1>
          <p className="mt-4 text-lg text-blue-100/90 leading-relaxed">
            Sign in to manage your NFC cards, leads, and digital profile.
          </p>
          <div className="mt-8 flex items-center justify-center gap-6 text-sm text-blue-200/70">
            <div className="flex items-center gap-2">
              <div className="h-1.5 w-1.5 rounded-full bg-blue-300" />
              <span>NFC Cards</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="h-1.5 w-1.5 rounded-full bg-blue-300" />
              <span>Lead Capture</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="h-1.5 w-1.5 rounded-full bg-blue-300" />
              <span>Analytics</span>
            </div>
          </div>
        </div>
      </div>

      <div className="flex flex-1 items-center justify-center p-8">
        <div className="w-full max-w-md">
          <div className="mb-8 text-center lg:text-left">
            <Link href="/" className="inline-flex items-center gap-2 lg:hidden mb-6">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-600 shadow-sm">
                <CreditCard className="h-5 w-5 text-white" />
              </div>
              <span className="text-2xl font-bold text-gray-900 tracking-tight">Taprevia</span>
            </Link>
            <h2 className="text-2xl font-bold text-gray-900 tracking-tight">Sign in to your account</h2>
            <p className="mt-2 text-sm text-gray-500">
              Contact your administrator if you need an account.
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            {error && (
              <div className="rounded-xl bg-red-50 p-3.5 text-sm text-red-600 ring-1 ring-red-200 animate-fade-in">{error}</div>
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

            <div className="relative">
              <Lock className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
              <Input
                id="password"
                type={showPassword ? 'text' : 'password'}
                placeholder="Password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="pl-10 pr-10"
                required
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors"
              >
                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>

            <div className="flex items-center justify-end">
              <Link href="/forgot-password" className="text-sm text-blue-600 hover:text-blue-700 font-medium">
                Forgot password?
              </Link>
            </div>

            <div className="pt-2">
              <Button type="submit" className="w-full" isLoading={loading}>
                Sign In
                <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
