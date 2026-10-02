'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Card } from '@/components/ui/card';
import { Fingerprint, Copy, Check } from 'lucide-react';

interface AccountDetailsProps {
  name: string;
  email: string;
  customerId?: string;
  bizSlug?: string | null;
}

export function AccountDetails({ name, email, customerId, bizSlug }: AccountDetailsProps) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    if (!customerId) return;
    try {
      await navigator.clipboard.writeText(customerId);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard may be blocked; ignore.
    }
  };

  return (
    <Card className="p-6 max-w-md">
      <h2 className="text-base font-semibold text-gray-900 mb-5 flex items-center gap-2">
        <div className="rounded-lg bg-gray-100 p-2">
          <Fingerprint className="h-4 w-4 text-gray-600" />
        </div>
        Account Details
      </h2>

      <dl className="space-y-4 text-sm">
        <div>
          <dt className="text-gray-500 text-xs uppercase tracking-wide">Name</dt>
          <dd className="mt-0.5 text-gray-900 font-medium">{name}</dd>
        </div>
        <div>
          <dt className="text-gray-500 text-xs uppercase tracking-wide">Email</dt>
          <dd className="mt-0.5 text-gray-900">{email}</dd>
        </div>
        {customerId && (
          <div>
            <dt className="text-gray-500 text-xs uppercase tracking-wide">Customer ID</dt>
            <dd className="mt-0.5 flex items-center gap-2">
              <code className="rounded-md bg-gray-100 px-2 py-0.5 font-mono text-gray-900">
                {customerId}
              </code>
              <button
                type="button"
                onClick={copy}
                className="rounded-md p-1 text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
                title={copied ? 'Copied' : 'Copy customer ID'}
              >
                {copied ? (
                  <Check className="h-3.5 w-3.5 text-emerald-600" />
                ) : (
                  <Copy className="h-3.5 w-3.5" />
                )}
              </button>
            </dd>
          </div>
        )}
        {bizSlug && (
          <div>
            <dt className="text-gray-500 text-xs uppercase tracking-wide">Public Profile</dt>
            <dd className="mt-0.5">
              <Link
                href={`/profile/${bizSlug}`}
                target="_blank"
                rel="noopener noreferrer"
                className="font-mono text-accent-600 hover:underline"
              >
                /profile/{bizSlug}
              </Link>
            </dd>
          </div>
        )}
      </dl>
    </Card>
  );
}