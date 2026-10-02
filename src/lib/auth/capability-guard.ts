/**
 * Server-side capability authorization helpers.
 *
 * These functions verify that a user has the required capability before
 * allowing access to protected pages or APIs. They should be used in:
 * - Page components (server-side rendering)
 * - API route handlers
 * - Middleware
 *
 * SECURITY: Never trust client-provided capability information.
 * Always verify capabilities server-side using these helpers.
 *
 * Platform operators (role === 'admin') bypass capability checks — consistent
 * with the existing admin-bypass convention in ownership helpers. Customer
 * accounts are strictly entitlement-driven.
 */

import { cookies } from 'next/headers';
import { redirect, notFound } from 'next/navigation';
import type { NextRequest } from 'next/server';
import type { CapabilityId } from '@/config/capabilities';
import { verifyToken, type AuthUser } from '@/lib/auth';
import { connectDB } from '@/lib/db';
import User from '@/models/User';
import { hasCapability, hasAllCapabilities, hasAnyCapability } from '@/lib/services/capability-access';

// ─── Page-Level Authorization ─────────────────────────────────────────────────

/**
 * Require a specific capability for a page.
 * Returns the authenticated user if authorized, or throws/redirects.
 *
 * Usage in server components:
 * ```tsx
 * export default async function ReviewsPage() {
 *   const user = await requirePageCapability('google_review');
 *   // Render page
 * }
 * ```
 */
export async function requirePageCapability(
  capability: CapabilityId,
  options?: {
    redirectTo?: string;
    showNotFound?: boolean;
  }
): Promise<AuthUser> {
  const user = await getAuthUser();

  if (!user) {
    redirect(options?.redirectTo ?? '/login');
  }

  if (user.role === 'admin') {
    return user;
  }

  const allowed = await hasCapability(user._id, capability);

  if (!allowed) {
    if (options?.showNotFound) {
      notFound();
    }
    redirect(options?.redirectTo ?? '/dashboard');
  }

  return user;
}

/**
 * Require ANY of the specified capabilities for a page.
 */
export async function requireAnyPageCapability(
  capabilities: CapabilityId[],
  options?: {
    redirectTo?: string;
    showNotFound?: boolean;
  }
): Promise<AuthUser> {
  const user = await getAuthUser();

  if (!user) {
    redirect(options?.redirectTo ?? '/login');
  }

  if (user.role === 'admin') {
    return user;
  }

  const allowed = await hasAnyCapability(user._id, capabilities);

  if (!allowed) {
    if (options?.showNotFound) {
      notFound();
    }
    redirect(options?.redirectTo ?? '/dashboard');
  }

  return user;
}

/**
 * Require ALL of the specified capabilities for a page.
 */
export async function requireAllPageCapabilities(
  capabilities: CapabilityId[],
  options?: {
    redirectTo?: string;
    showNotFound?: boolean;
  }
): Promise<AuthUser> {
  const user = await getAuthUser();

  if (!user) {
    redirect(options?.redirectTo ?? '/login');
  }

  if (user.role === 'admin') {
    return user;
  }

  const allowed = await hasAllCapabilities(user._id, capabilities);

  if (!allowed) {
    if (options?.showNotFound) {
      notFound();
    }
    redirect(options?.redirectTo ?? '/dashboard');
  }

  return user;
}

// ─── API-Level Authorization ──────────────────────────────────────────────────

/**
 * Require a specific capability for an API route.
 * Returns the authenticated user if authorized, or null if unauthorized.
 *
 * Usage in API routes:
 * ```ts
 * export async function GET(request: NextRequest) {
 *   const user = await requireApiCapability(request, 'google_review');
 *   if (!user) return fail(403, 'FORBIDDEN', 'Capability required');
 *   // Process request
 * }
 * ```
 */
export async function requireApiCapability(
  request: NextRequest,
  capability: CapabilityId
): Promise<AuthUser | null> {
  const user = await verifyTokenFromRequest(request);

  if (!user) {
    return null;
  }

  if (user.role === 'admin') {
    return user;
  }

  const allowed = await hasCapability(user._id, capability);

  return allowed ? user : null;
}

/**
 * API entitlement guard with distinct outcomes, so routes can return
 * 401 (unauthenticated) vs 403 (missing capability) precisely.
 *
 * Discriminated union — checking `status` narrows `user` to non-null.
 */
export async function requireApiEntitlement(
  request: NextRequest,
  capability: CapabilityId
): Promise<
  | { status: 200; user: AuthUser }
  | { status: 401; user: null }
  | { status: 403; user: null }
> {
  const token = request.cookies.get('token')?.value;

  if (!token) {
    return { status: 401, user: null };
  }

  const user = await requireApiCapability(request, capability);

  if (!user) {
    return { status: 403, user: null };
  }

  return { status: 200, user };
}

/**
 * Require ANY of the specified capabilities for an API route.
 */
export async function requireAnyApiCapability(
  request: NextRequest,
  capabilities: CapabilityId[]
): Promise<AuthUser | null> {
  const user = await verifyTokenFromRequest(request);

  if (!user) {
    return null;
  }

  if (user.role === 'admin') {
    return user;
  }

  const allowed = await hasAnyCapability(user._id, capabilities);

  return allowed ? user : null;
}

/**
 * Require ALL of the specified capabilities for an API route.
 */
export async function requireAllApiCapabilities(
  request: NextRequest,
  capabilities: CapabilityId[]
): Promise<AuthUser | null> {
  const user = await verifyTokenFromRequest(request);

  if (!user) {
    return null;
  }

  if (user.role === 'admin') {
    return user;
  }

  const allowed = await hasAllCapabilities(user._id, capabilities);

  return allowed ? user : null;
}

// ─── Internal Helpers ─────────────────────────────────────────────────────────

/**
 * Get the authenticated user from the request cookies.
 * Exported for server layouts/shells that need the resolved session user
 * (e.g. the dashboard shell for server-side navigation filtering).
 */
export async function getAuthUserForPage(): Promise<AuthUser | null> {
  return getAuthUser();
}

/**
 * Get the authenticated user from the request cookies.
 */
async function getAuthUser(): Promise<AuthUser | null> {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get('token')?.value;

    if (!token) {
      return null;
    }

    await connectDB();

    // Verify JWT token
    const verified = verifyToken(token);
    if (!verified) {
      return null;
    }

    // Fetch full user data
    const user = await User.findById(verified.userId).select('-passwordHash');
    if (!user) {
      return null;
    }
    if (user.status === 'suspended') return null;

    return {
      _id: user._id.toString(),
      name: user.name,
      email: user.email,
      role: user.role,
      status: user.status,
      customerId: user.customerId,
      bizSlug: user.bizSlug,
      phone: user.phone,
      isNewsletterEnabled: user.isNewsletterEnabled,
    };
  } catch (error) {
    console.error('Auth verification failed:', error);
    return null;
  }
}

/**
 * Verify token from NextRequest (for API routes).
 */
async function verifyTokenFromRequest(request: NextRequest): Promise<AuthUser | null> {
  try {
    const token = request.cookies.get('token')?.value;

    if (!token) {
      return null;
    }

    await connectDB();

    // Verify JWT token
    const verified = verifyToken(token);
    if (!verified) {
      return null;
    }

    // Fetch full user data
    const user = await User.findById(verified.userId).select('-passwordHash');
    if (!user) {
      return null;
    }
    if (user.status === 'suspended') return null;

    return {
      _id: user._id.toString(),
      name: user.name,
      email: user.email,
      role: user.role,
      status: user.status,
      customerId: user.customerId,
      bizSlug: user.bizSlug,
      phone: user.phone,
      isNewsletterEnabled: user.isNewsletterEnabled,
    };
  } catch (error) {
    console.error('Token verification failed:', error);
    return null;
  }
}

// ─── Exported Helper for Manual Checks ────────────────────────────────────────

/**
 * Check if a user has a capability (for use in existing code).
 */
export async function checkCapability(
  userId: string,
  capability: CapabilityId
): Promise<boolean> {
  return hasCapability(userId, capability);
}

/**
 * Get all capabilities for a user (for use in existing code).
 */
export async function getUserCapabilities(
  userId: string
): Promise<CapabilityId[]> {
  const { getUserCapabilities: getCapabilities } = await import('@/lib/services/capability-access');
  return getCapabilities(userId);
}
