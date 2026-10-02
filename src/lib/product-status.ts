/**
 * Shared, dependency-free product setup-state helpers.
 *
 * Card setup state is persisted on the physical card instance (setupComplete);
 * standee setup state is NOT persisted — it is derived from the standee's slot
 * destinations (socialQrs[].destinationUrl). A standee is "configured" once at
 * least one of its slots points at a non-empty destination, which is the same
 * rule the standee slot manager uses. Deriving here (instead of adding a field)
 * means the dashboard overview and the My Products list can never disagree with
 * the slot manager, and no database migration is needed.
 *
 * Pure functions only — safe to import from client components.
 */

export interface StandeeSocialQrLike {
  destinationUrl?: string;
}

export interface StandeeInstanceLike {
  socialQrs?: StandeeSocialQrLike[];
}

export interface ProductSetupLike {
  instanceType: 'card' | 'standee' | null;
  instance: { setupComplete?: boolean } | null;
}

/** Count of standee slots currently pointing at a non-empty destination. */
export function standeeConfiguredSlotCount(
  instance: StandeeInstanceLike | null | undefined
): number {
  return (instance?.socialQrs ?? []).filter((qr) => Boolean(qr.destinationUrl?.trim())).length;
}

/** A standee needs setup when none of its slots points at a destination yet. */
export function standeeNeedsSetup(instance: StandeeInstanceLike | null | undefined): boolean {
  return standeeConfiguredSlotCount(instance) === 0;
}

/** A standee is live once any of its slots points at a destination. */
export function standeeConfigured(instance: StandeeInstanceLike | null | undefined): boolean {
  return standeeConfiguredSlotCount(instance) > 0;
}

/** An uninstantiated card assignment (no bound physical card yet) needs setup. */
export function unboundCardNeedsSetup(product: ProductSetupLike): boolean {
  return product.instanceType === 'card' && product.instance === null;
}