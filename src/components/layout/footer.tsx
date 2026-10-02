'use client';

import Link from 'next/link';
import { CreditCard } from 'lucide-react';

interface FooterProps {
  minimal?: boolean;
}

export function Footer({ minimal }: FooterProps) {
  return (
    <footer className={`border-t border-line-subtle bg-bg-raised ${minimal ? 'py-6' : 'py-12'}`}>
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className={`grid gap-8 ${minimal ? 'grid-cols-2' : 'grid-cols-2 md:grid-cols-4'}`}>
          <div>
            <Link href="/" className="flex items-center gap-2">
              <CreditCard className="h-6 w-6 text-accent-400" />
              <span className="text-lg font-bold text-ink">Taprevia</span>
            </Link>
            <p className="mt-2 text-sm text-ink-mute">
              NFC Smart Card Management Platform
            </p>
          </div>

          {!minimal && (
            <>
              <div>
                <h3 className="text-sm font-semibold text-ink">Product</h3>
                <ul className="mt-2 space-y-2">
                  <li><Link href="/#features" className="text-sm text-ink-mute hover:text-ink">Features</Link></li>
                  <li><Link href="/login" className="text-sm text-ink-mute hover:text-ink">Sign In</Link></li>
                  <li><Link href="/register" className="text-sm text-ink-mute hover:text-ink">Get Started</Link></li>
                </ul>
              </div>
              <div>
                <h3 className="text-sm font-semibold text-ink">Company</h3>
                <ul className="mt-2 space-y-2">
                  <li><a href="#" className="text-sm text-ink-mute hover:text-ink">About</a></li>
                  <li><a href="#" className="text-sm text-ink-mute hover:text-ink">Contact</a></li>
                  <li><a href="#" className="text-sm text-ink-mute hover:text-ink">Privacy</a></li>
                </ul>
              </div>
            </>
          )}
        </div>

        <div className={`mt-8 border-t border-line-subtle ${minimal ? 'pt-4' : 'pt-8'}`}>
          <p className="text-center text-sm text-ink-faint">
            © {new Date().getFullYear()} Taprevia. All rights reserved.
          </p>
        </div>
      </div>
    </footer>
  );
}
