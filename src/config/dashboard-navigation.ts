/**
 * Centralized dashboard navigation configuration.
 *
 * Each navigation item declares its required capability. The dashboard shell
 * filters items based on the customer's resolved capabilities (resolved
 * server-side from their active product assignments).
 *
 * Every entitlement-relevant item MUST declare a capability; only platform
 * universals (Dashboard home, My Products, Settings, Account) stay un-gated.
 *
 * To add a new navigation item:
 * 1. Add the item to NAV_ITEMS with its required capability
 * 2. Add a matching requirePageCapability server guard on the page
 * 3. (API endpoints) enforce requireApiCapability for the same capability
 * 4. The entitlement system automatically handles visibility
 */

import { ANALYTICS_CAPABILITIES, type CapabilityId } from '@/config/capabilities';
import type { LucideIcon } from 'lucide-react';
import {
  LayoutDashboard,
  CreditCard,
  QrCode,
  Mail,
  BarChart3,
  Image as ImageIcon,
  Settings,
  Package,
  Briefcase,
  Camera,
  Star,
  Users,
  MessageCircle,
  Library,
} from 'lucide-react';

// ─── Navigation Item Types ────────────────────────────────────────────────────

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Required capability to see this item. null = always visible. */
  requiredCapability: CapabilityId | null;
  /** Optional: require ANY of these capabilities (alternative to single capability). */
  anyCapability?: CapabilityId[];
}

// ─── Navigation Configuration ─────────────────────────────────────────────────

/**
 * Dashboard navigation items for customers.
 * Items are filtered by the customer's resolved capabilities.
 */
export const CUSTOMER_NAV_ITEMS: NavItem[] = [
  // Platform universals (always visible for any authenticated customer)
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard, requiredCapability: null },
  { href: '/dashboard/products', label: 'My Products', icon: Package, requiredCapability: null },

  // Product-specific rows (visibility follows PRODUCT → CAPABILITY → NAV).
  // One row per platform experience, gated by its base capability — never by
  // product ID. A customer owning any product that grants the capability (an
  // NFC card, a standee slot, …) sees its platform row exactly once.
  // requiredCapability is the functional gate (filterNavByCapabilities only
  // honors anyCapability after a non-null requiredCapability; rows with a null
  // requiredCapability are treated as platform universals). anyCapability is
  // declared to match the platform-row spec and to allow future multi-cap rows.
  { href: '/dashboard/linkedin', label: 'LinkedIn', icon: Briefcase, requiredCapability: 'linkedin', anyCapability: ['linkedin'] },
  { href: '/dashboard/instagram', label: 'Instagram', icon: Camera, requiredCapability: 'instagram', anyCapability: ['instagram'] },
  { href: '/dashboard/reviews', label: 'Google Reviews', icon: Star, requiredCapability: 'google_review', anyCapability: ['google_review'] },
  { href: '/dashboard/facebook', label: 'Facebook', icon: Users, requiredCapability: 'facebook', anyCapability: ['facebook'] },
  { href: '/dashboard/whatsapp', label: 'WhatsApp', icon: MessageCircle, requiredCapability: 'whatsapp', anyCapability: ['whatsapp'] },

  { href: '/dashboard/settings', label: 'Settings', icon: Settings, requiredCapability: null },

  // Entitlement-gated items (visibility follows PRODUCT → CAPABILITY → NAV)
  { href: '/dashboard/vcards', label: 'vCards', icon: CreditCard, requiredCapability: 'profile_edit' },
  { href: '/dashboard/standees', label: 'Standees', icon: QrCode, requiredCapability: 'standee' },
  { href: '/dashboard/subscribers', label: 'Subscribers', icon: Mail, requiredCapability: 'lead_capture' },
  { href: '/dashboard/analytics', label: 'Analytics', icon: BarChart3, requiredCapability: 'dynamic_dashboard', anyCapability: [...ANALYTICS_CAPABILITIES] },
];

/**
 * Admin navigation items (not capability-gated).
 */
export const ADMIN_NAV_ITEMS: NavItem[] = [
  { href: '/admin', label: 'Overview', icon: LayoutDashboard, requiredCapability: null },
  { href: '/admin/users', label: 'Users', icon: Settings, requiredCapability: null },
  { href: '/admin/products', label: 'Products', icon: CreditCard, requiredCapability: null },
  { href: '/admin/templates', label: 'Templates', icon: ImageIcon, requiredCapability: null },
  { href: '/admin/review-library', label: 'Review Library', icon: Library, requiredCapability: null },
  { href: '/admin/standee-qr', label: 'Standee QRs', icon: QrCode, requiredCapability: null },
];

// ─── Helper Functions ─────────────────────────────────────────────────────────

import type { CapabilityId as CapId } from '@/config/capabilities';

/**
 * Filter navigation items by user capabilities.
 */
export function filterNavByCapabilities(
  items: NavItem[],
  userCapabilities: Set<CapId> | CapId[]
): NavItem[] {
  const capSet = userCapabilities instanceof Set ? userCapabilities : new Set(userCapabilities);

  return items.filter((item) => {
    // No capability required = always visible
    if (item.requiredCapability === null) {
      return true;
    }

    // Check single capability
    if (capSet.has(item.requiredCapability)) {
      return true;
    }

    // Check any of multiple capabilities
    if (item.anyCapability) {
      return item.anyCapability.some((cap) => capSet.has(cap));
    }

    return false;
  });
}

/**
 * Drop platform nav rows that would merely re-open another management surface
 * already present in the nav.
 *
 * Platform rows (one per platform capability — LinkedIn, Instagram, …) resolve
 * to the customer's real management target (standee slot manager, vCard
 * editor, or the My Products hub). When several platform rows resolve to the
 * SAME visible, capability-gated management row (for example every row of a
 * standee-only customer resolving to the Standees manager), they are redundant
 * duplicates and are dropped — the management row itself stays reachable.
 *
 * Only capability-gated rows count as management targets. Platform universals
 * such as My Products (/dashboard/products) are never treated as a management
 * target, so platform rows that land there (e.g. an unbound card with no card
 * editor yet) are preserved.
 */
export function dedupeNavByDestination(
  items: NavItem[],
  destinationsByHref: Record<string, string>
): NavItem[] {
  const managementHrefs = new Set(
    items.filter((item) => item.requiredCapability !== null).map((item) => item.href)
  );

  return items.filter((item) => {
    const target = destinationsByHref[item.href];
    return !(target && managementHrefs.has(target));
  });
}
