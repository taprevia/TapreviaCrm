'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { CreditCard, Lock } from 'lucide-react';

export default function RegisterPage() {
  const router = useRouter();

  useEffect(() => {
    router.replace('/login');
  }, [router]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50">
      <div className="w-full max-w-md text-center p-8">
        <CreditCard className="mx-auto h-12 w-12 text-blue-600" />
        <h1 className="mt-4 text-2xl font-bold text-gray-900">Registration Closed</h1>
        <p className="mt-2 text-gray-600">
          Self-registration is not available. Contact your administrator to create an account.
        </p>
        <Link
          href="/login"
          className="mt-6 inline-flex items-center gap-2 rounded-lg bg-blue-600 px-6 py-3 text-white font-medium hover:bg-blue-700 transition-colors"
        >
          <Lock className="h-4 w-4" />
          Go to Login
        </Link>
      </div>
    </div>
  );
}
