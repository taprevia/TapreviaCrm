/**
 * URL identity immutability helpers.
 *
 * Taprevia's permanent/public identifiers are assigned once and then frozen:
 *   - Cards:    routeSlug, uid, publicSlug, urlAlias, slug
 *   - Standees: routeSlug, uid, publicSlug, panelQr.qrId,
 *               socialQrs[].qrId / platform
 *
 * Update APIs call these helpers BEFORE writing. A payload may repeat the
 * stored value (legacy clients / autosave), but any different value is a
 * forbidden identifier change. Profile content, destinations and settings
 * remain editable.
 */

export const CARD_IMMUTABLE_URL_FIELDS = [
  'routeSlug',
  'uid',
  'publicSlug',
  'urlAlias',
  'slug',
] as const;

export const STANDEE_IMMUTABLE_URL_FIELDS = [
  'routeSlug',
  'uid',
  'publicSlug',
] as const;

export interface ImmutableFieldChange {
  field: string;
  current: string;
  incoming: string;
}

function hasOwn(value: unknown, key: string): boolean {
  return Boolean(
    value &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      Object.prototype.hasOwnProperty.call(value, key)
  );
}

function normalize(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value.trim().toLowerCase();
  return String(value).trim().toLowerCase();
}

/**
 * Return the first immutable field whose submitted value differs from the
 * stored value, or null when the payload is absent/identical.
 */
export function findImmutableUrlChange(
  body: unknown,
  current: Record<string, unknown> | null | undefined,
  fields: readonly string[]
): ImmutableFieldChange | null {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;

  for (const field of fields) {
    if (!hasOwn(body, field)) continue;
    const incoming = normalize((body as Record<string, unknown>)[field]);
    const existing = normalize((current as Record<string, unknown> | null | undefined)?.[field]);
    if (incoming !== existing) {
      return { field, current: existing, incoming };
    }
  }
  return null;
}

/**
 * Standee-specific guard. Top-level identifiers plus the panel QR id and every
 * social-slot QR id/platform are permanent. Slot destinations/labels remain
 * editable through the supported `slotConfig` payload.
 */
export function findImmutableStandeeChange(
  body: unknown,
  standee: Record<string, unknown> | null | undefined
): ImmutableFieldChange | null {
  const topLevel = findImmutableUrlChange(body, standee, STANDEE_IMMUTABLE_URL_FIELDS);
  if (topLevel) return topLevel;
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;

  const raw = body as Record<string, unknown>;
  const stored = (standee ?? {}) as Record<string, unknown>;

  if (hasOwn(raw, 'panelQr')) {
    const incoming = raw.panelQr as { qrId?: unknown } | null | undefined;
    const current = stored.panelQr as { qrId?: unknown } | null | undefined;
    const incomingId = normalize(incoming?.qrId);
    const currentId = normalize(current?.qrId);
    if (incomingId !== currentId) {
      return { field: 'panelQr.qrId', current: currentId, incoming: incomingId };
    }
  }

  if (hasOwn(raw, 'socialQrs')) {
    const incomingSlots = Array.isArray(raw.socialQrs) ? raw.socialQrs : [];
    const currentSlots = Array.isArray(stored.socialQrs) ? stored.socialQrs : [];
    const length = Math.max(incomingSlots.length, currentSlots.length);
    for (let index = 0; index < length; index += 1) {
      const incoming = (incomingSlots[index] ?? {}) as { qrId?: unknown; platform?: unknown };
      const current = (currentSlots[index] ?? {}) as { qrId?: unknown; platform?: unknown };
      const incomingId = normalize(incoming.qrId);
      const currentId = normalize(current.qrId);
      if (incomingId !== currentId) {
        return {
          field: `socialQrs.${index}.qrId`,
          current: currentId,
          incoming: incomingId,
        };
      }
      const incomingPlatform = normalize(incoming.platform);
      const currentPlatform = normalize(current.platform);
      if (incomingPlatform !== currentPlatform) {
        return {
          field: `socialQrs.${index}.platform`,
          current: currentPlatform,
          incoming: incomingPlatform,
        };
      }
    }
  }

  return null;
}

/** True when a create/update payload attempts to supply an identifier. */
export function hasAnyUrlIdentifier(
  body: unknown,
  fields: readonly string[]
): boolean {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return false;
  return fields.some((field) => hasOwn(body, field));
}
