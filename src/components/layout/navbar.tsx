'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import {
  CreditCard,
  Globe,
  LogOut,
  Menu,
  X,
  ChevronLeft,
  ShieldCheck,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { CapabilityId } from '@/config/capabilities';
import { CUSTOMER_NAV_ITEMS, ADMIN_NAV_ITEMS, filterNavByCapabilities, dedupeNavByDestination } from '@/config/dashboard-navigation';
import type { ShellUser } from './sidebar';

interface NavbarProps {
  /** Server-resolved session user (from the dashboard server layout). */
  user: ShellUser | null;
  /** Server-resolved entitlement capabilities. null = admin/legacy context. */
  capabilities: CapabilityId[] | null;
  /** Resolved landing target per platform nav row (P7-3 de-duplication). */
  platformDestinations?: Record<string, string>;
}

export function Navbar({ user, capabilities, platformDestinations }: NavbarProps) {
  const pathname = usePathname();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const handleLogout = async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
      // Full-page navigation: clears Next's client router cache so a
      // subsequent login (even as another account) never reuses a stale
      // cached dashboard payload from the previous session.
      window.location.assign('/login');
    } catch (error) {
      console.error('Logout failed:', error);
    }
  };

  const isAdmin = user?.role === 'admin';
  const isInAdminSection = pathname.startsWith('/admin');

  // Admins see the full customer navigation (platform operator preview).
  // Platform row de-duplication only applies to real customers; admins see every
  // row to confirm the full customer view.
  const customerNavLinks = isAdmin
    ? CUSTOMER_NAV_ITEMS
    : dedupeNavByDestination(
        filterNavByCapabilities(CUSTOMER_NAV_ITEMS, capabilities ?? []),
        platformDestinations ?? {}
      );
  const links = isInAdminSection ? ADMIN_NAV_ITEMS : customerNavLinks;

  return (
    <>
      <nav className="sticky top-0 z-40 flex h-16 items-center gap-4 border-b border-line-subtle bg-bg/80 backdrop-blur px-4 md:px-6">
        <button
          onClick={() => setSidebarOpen(!sidebarOpen)}
          className="rounded-lg p-2 text-ink-mute hover:bg-surface hover:text-ink transition-colors lg:hidden"
        >
          {sidebarOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>

        <Link href={isInAdminSection ? '/admin' : '/dashboard'} className="flex items-center gap-2.5 group">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent-600 shadow-e1 group-hover:shadow-e2 transition-shadow">
            <CreditCard className="h-4 w-4 text-white" />
          </div>
          <span className="text-lg font-bold text-ink tracking-tight">Taprevia</span>
        </Link>

        <div className="flex-1" />

        {user && (
          <div className="flex items-center gap-3">
            <Link
              href="/"
              className="hidden md:flex items-center gap-1.5 rounded-lg px-2.5 py-2 text-xs font-medium text-ink-mute hover:bg-surface hover:text-ink transition-colors"
              title="View website"
            >
              <Globe className="h-4 w-4" />
              Website
            </Link>
            <div className="hidden md:block h-6 w-px bg-line-subtle" />
            <div className="hidden md:block text-right">
              <p className="text-sm font-medium text-ink flex items-center gap-1.5 justify-end">
                {user.name}
                {isAdmin && (
                  <span className="px-1.5 py-0.2 bg-warn/10 text-warn border border-warn/25 rounded text-[10px] uppercase font-bold">
                    Admin
                  </span>
                )}
              </p>
              <p className="text-xs text-ink-mute">{user.email}</p>
              {user.customerId && (
                <p className="font-mono text-[10px] text-ink-faint text-right">
                  {user.customerId}
                </p>
              )}
            </div>
            <div className="hidden md:block h-6 w-px bg-line-subtle" />
            <button
              onClick={handleLogout}
              className="rounded-lg p-2 text-ink-mute hover:bg-surface hover:text-ink transition-colors"
              title="Logout"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        )}
      </nav>

      {sidebarOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/60 backdrop-blur-sm lg:hidden transition-opacity"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      <aside
        className={cn(
          'fixed left-0 top-16 z-30 h-[calc(100vh-4rem)] w-64 border-r border-line-subtle bg-bg-raised transition-transform duration-300 ease-out lg:translate-x-0',
          sidebarOpen ? 'translate-x-0' : '-translate-x-full'
        )}
      >
        <div className="flex h-full flex-col">
          <button
            onClick={() => setSidebarOpen(false)}
            className="absolute right-2 top-2 rounded-lg p-1 text-ink-faint hover:bg-surface hover:text-ink lg:hidden transition-colors"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>

          <nav className="flex-1 space-y-1 p-3 mt-1 overflow-y-auto">
            {links.map((link, index) => {
              // Active-state follows the row's RESOLVED DESTINATION when the row
              // is a platform row (P1-3): platform rows carry a static href
              // (/dashboard/instagram, …) but their real landing target is the
              // customer's management surface (vCard editor, standee manager).
              // Highlighting only against the static href made the vCards row
              // light up when a platform row resolved to it — that row is now
              // active when either its own page OR its destination page matches.
              const destHref = platformDestinations?.[link.href] ?? link.href;
              const isActive =
                pathname === destHref ||
                (link.href !== '/admin' && link.href !== '/dashboard' && pathname.startsWith(destHref));
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  onClick={() => setSidebarOpen(false)}
                  className={cn(
                    'relative flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors animate-slide-in',
                    isActive ? 'bg-accent-600/10 text-accent-400' : 'text-ink-mute hover:bg-white/5 hover:text-ink'
                  )}
                  style={{ animationDelay: `${index * 30}ms` }}
                >
                  {isActive && (
                    <span className="absolute left-0 top-1/2 -translate-y-1/2 h-4 w-[2px] rounded-full bg-accent-500" />
                  )}
                  <link.icon className="h-5 w-5" />
                  {link.label}
                </Link>
              );
            })}
          </nav>

          <div className="border-t border-line-subtle p-3 space-y-1">
            {!isInAdminSection && (
              <>
                <Link
                  href="/dashboard/account"
                  onClick={() => setSidebarOpen(false)}
                  className="flex items-center gap-2 rounded-lg px-3 py-2 text-xs text-ink-mute hover:text-accent-400 transition-colors"
                >
                  <ShieldCheck className="h-4 w-4" />
                  Account &amp; security
                </Link>
              </>
            )}

            {isInAdminSection && (
              <div className="rounded-xl bg-warn/10 ring-1 ring-warn/25 p-2.5">
                <div className="flex items-center gap-2 mb-0.5">
                  <div className="h-2 w-2 rounded-full bg-warn animate-pulse" />
                  <p className="text-xs font-semibold text-warn">Admin Mode</p>
                </div>
                <p className="text-[11px] text-ink-mute">Managing platform-wide data</p>
              </div>
            )}
          </div>
        </div>
      </aside>
    </>
  );
}
