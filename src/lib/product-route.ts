/**
 * Canonical "Manage Product" routing.
 *
 * Single source of truth for where a customer manages an owned product. It is
 * consumed by the dashboard overview, the My Products page, the Phase 7 header
 * CTA and (server-side) the platform redirect, so every entry point resolves
 * the SAME destination for the SAME product.
 *
 * Pure and client-safe: it only maps an already-resolved product/instance
 * snapshot to a dashboard href. It never queries the database, capabilities or
 * entitlements, and it never guesses an instance.
 *
 * Rules (canonical — mirrors the existing My Products behavior):
 *  1. Instantiated card (valid instance/card id) → /dashboard/vcards/{id}/edit
 *  2. Standee with configured slots              → /dashboard/standees
 *  3. Assignment without an instantiated card    → /dashboard/products/{assignmentId}
 *
 * If no usable assignment id is present the universal My Products list is used
 * rather than emitting a broken link.
 */

export interface ManageTargetInput {
  /** The UserProduct assignment id. */
  assignmentId?: string | null;
  /** Which physical/digital instance the assignment is fulfilled by. */
  instanceType?: 'card' | 'standee' | null;
  /** Resolved instance snapshot (card: id + config; standee: slots). */
  instance?: {
    id?: string | null;
    socialQrs?: readonly unknown[] | null;
  } | null;
}

const MY_PRODUCTS_FALLBACK = '/dashboard/products';

export function resolveProductManageHref(product: ManageTargetInput): string {
  const instance = product.instance;

  // 1. Standee with configured slots → the dedicated slot manager.
  if (product.instanceType === 'standee' && (instance?.socialQrs?.length ?? 0) > 0) {
    return '/dashboard/standees';
  }

  // 2. Instantiated card → the specific card editor (never another card's).
  const instanceId = instance?.id?.trim();
  if (product.instanceType === 'card' && instanceId) {
    return `/dashboard/vcards/${instanceId}/edit`;
  }

  // 3. Assignment without an instantiated card → its configuration page.
  const assignmentId = product.assignmentId?.trim();
  return assignmentId ? `/dashboard/products/${assignmentId}` : MY_PRODUCTS_FALLBACK;
}
