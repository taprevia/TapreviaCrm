'use client';

import { ReactNode } from 'react';
import { Navbar } from './navbar';
import type { CapabilityId } from '@/config/capabilities';

export interface ShellUser {
  id: string;
  name: string;
  email: string;
  role: string;
  customerId?: string;
  bizSlug?: string | null;
}

interface DashboardLayoutProps {
  children: ReactNode;
  /** Resolved by the server dashboard layout — single source for the shell. */
  user: ShellUser | null;
  /** Server-resolved entitlement; empty when null means "load from API". */
  capabilities: CapabilityId[] | null;
  /**
   * Resolved landing target per platform nav row (P7-3). Lets the Navbar drop
   * platform rows that would just re-open a management row already in the nav.
   */
  platformDestinations?: Record<string, string>;
}

export function DashboardLayout({
  children,
  user,
  capabilities,
  platformDestinations,
}: DashboardLayoutProps) {
  return (
    <div className="min-h-screen bg-bg">
      <Navbar user={user} capabilities={capabilities} platformDestinations={platformDestinations} />
      <main className="lg:pl-64">
        <div className="p-4 md:p-6 lg:p-8">{children}</div>
      </main>
    </div>
  );
}