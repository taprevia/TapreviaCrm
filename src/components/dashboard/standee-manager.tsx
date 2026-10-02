'use client';

/**
 * StandeeManager — reusable multi-profile standee management UI.
 *
 * One architecture for every standee product (All In One Standee 3, All In One
 * Standee 4, Google Review Standee, Business Profile Standee). The only
 * difference between them is product metadata (maxProfiles + fixedProfiles),
 * which drives how many slots are rendered and which platform type each slot
 * maps to.
 *
 * A customer may change each slot's *destination* but never its profile type.
 * The standee's domain-qualified Public URL is the single link customers share.
 */

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  QrCode,
  Link2,
  Copy,
  Check,
  Save,
  Lock,
  Layers,
  ExternalLink,
  Loader2,
  Settings2,
} from 'lucide-react';
import { STANDEE_PLATFORMS } from '@/lib/constants';

interface SocialQrEntry {
  qrId: string;
  platform: string;
  label: string;
  destinationUrl?: string;
}

interface StandeeInstance {
  id: string;
  name: string;
  displayName?: string;
  routeSlug: string;
  productKey?: string;
  maxProfiles?: number;
  fixedProfiles?: string[];
  socialQrs?: SocialQrEntry[];
  panelQr?: { qrId: string; qrColor: string };
}

interface ProductEntry {
  assignmentId: string;
  productTitle?: string;
  catalogProduct: {
    id: string;
    name: string;
    slug: string;
    category: string;
    kind: string;
  } | null;
  instanceType: 'standee' | null;
  publicUrl: string | null;
  instance: StandeeInstance | null;
}

function platformName(id: string): string {
  return STANDEE_PLATFORMS.find((p) => p.id === id)?.name ?? id.replace(/_/g, ' ');
}

function isSafeUrl(v: string): boolean {
  if (!v) return false;
  return /^https?:\/\/.+/i.test(v.trim());
}

export default function StandeeManager() {
  const [products, setProducts] = useState<ProductEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [accessDenied, setAccessDenied] = useState(false);
  // Slot destination values: key = `${assignmentId}:${slotIndex}`
  const [values, setValues] = useState<Record<string, string>>({});
  // Public display names: key = assignmentId
  const [displayNames, setDisplayNames] = useState<Record<string, string>>({});
  const [savingSlot, setSavingSlot] = useState<string | null>(null);
  const [savingName, setSavingName] = useState<string | null>(null);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [copied, setCopied] = useState<{ id: string } | null>(null);

  // Origin is unavailable on the server; resolve it after mount so the
  // initial render is identical during SSR and hydration.
  const [origin, setOrigin] = useState('');
  useEffect(() => {
    setOrigin(window.location.origin);
  }, []);

  useEffect(() => {
    fetchStandees();
  }, []);

  const fetchStandees = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/my/products');
      if (res.status === 403) {
        setAccessDenied(true);
        return;
      }
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        setError(data?.error ?? 'Failed to load products');
        return;
      }
      const data = await res.json();
      const standees = (data.products ?? []).filter(
        (p: ProductEntry) => p.instanceType === 'standee' && p.instance
      ) as ProductEntry[];

      setProducts(standees);

      // Pre-populate slot values with current destinations.
      const next: Record<string, string> = {};
      const nextNames: Record<string, string> = {};
      for (const p of standees) {
        nextNames[p.assignmentId] = p.instance?.displayName ?? '';
        (p.instance?.socialQrs ?? []).forEach((qr, idx) => {
          next[`${p.assignmentId}:${idx}`] = qr.destinationUrl ?? '';
        });
      }
      setValues(next);
      setDisplayNames(nextNames);
    } catch {
      setError('An error occurred while loading standees');
    } finally {
      setLoading(false);
    }
  };

  const copy = async (text: string, id: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied({ id });
      setTimeout(() => setCopied(null), 1500);
    } catch {
      // ignore
    }
  };

  const slotKey = (row: ProductEntry, idx: number) => `${row.assignmentId}:${idx}`;

  const handleSaveSlot = async (row: ProductEntry, idx: number) => {
    const key = slotKey(row, idx);
    const url = (values[key] ?? '').trim();
    setMessage(null);

    if (!url) {
      setMessage({ type: 'error', text: 'Enter a destination URL before saving' });
      return;
    }
    if (!isSafeUrl(url)) {
      setMessage({ type: 'error', text: 'Destination must start with https:// (or http://)' });
      return;
    }

    setSavingSlot(key);
    try {
      const res = await fetch(`/api/my/products/${row.assignmentId}/config`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          slotConfig: { slot: idx + 1, destinationUrl: url },
        }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        setMessage({ type: 'error', text: json?.error ?? 'Failed to save slot' });
        return;
      }
      setMessage({
        type: 'success',
        text: `Slot ${idx + 1} saved — its QR now points to the new destination.`,
      });
      await fetchStandees();
    } catch {
      setMessage({ type: 'error', text: 'An error occurred while saving' });
    } finally {
      setSavingSlot(null);
    }
  };

  const handleSaveDisplayName = async (row: ProductEntry) => {
    const name = (displayNames[row.assignmentId] ?? '').trim();
    setMessage(null);
    if (!name) {
      setMessage({ type: 'error', text: 'Enter a display name before saving' });
      return;
    }
    setSavingName(row.assignmentId);
    try {
      const res = await fetch(`/api/my/products/${row.assignmentId}/config`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ displayName: name }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        setMessage({ type: 'error', text: json?.error ?? 'Failed to save display name' });
        return;
      }
      setMessage({
        type: 'success',
        text: 'Display name saved — it now shows on the panel picker page.',
      });
      await fetchStandees();
    } catch {
      setMessage({ type: 'error', text: 'An error occurred while saving' });
    } finally {
      setSavingName(null);
    }
  };

  return (
    <div className="space-y-6 animate-fade-in">
      {message && (
        <div
          className={`rounded-lg p-3 text-sm ring-1 animate-fade-in ${
            message.type === 'success' ? 'bg-ok/10 text-ok ring-ok/25' : 'bg-bad/10 text-bad ring-bad/25'
          }`}
        >
          {message.text}
        </div>
      )}

      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 2 }).map((_, i) => (
            <div key={i} className="skeleton h-40 rounded-xl" />
          ))}
        </div>
      ) : error ? (
        <Card className="bg-surface border-transparent ring-1 ring-line-subtle p-10">
          <div className="flex flex-col items-center text-center">
            <p className="text-sm text-ink">{error}</p>
          </div>
        </Card>
      ) : accessDenied || products.length === 0 ? (
        <Card className="bg-surface border-transparent ring-1 ring-line-subtle p-10">
          <div className="flex flex-col items-center text-center">
            <div className="rounded-full bg-field p-4 mb-4">
              <Lock className="h-8 w-8 text-ink-faint" />
            </div>
            <p className="text-sm font-medium text-ink">No standees yet</p>
            <p className="text-sm text-ink-mute mt-1">
              When you purchase a Taprevia standee product, its slots appear here for configuration.
            </p>
          </div>
        </Card>
      ) : (
        products.map((row, ri) => {
          const inst = row.instance!;
          const fixed = inst.fixedProfiles ?? [];
          const slots = inst.socialQrs ?? [];
          const maxProfiles = inst.maxProfiles || slots.length;
          // Slot count is always derived from the actual standee data — the QRs
          // that exist on the instance — never hard-coded to a variant size.
          const slotCount = slots.length > 0 ? slots.length : maxProfiles;
          // Setup status is derived from data: how many slots already carry a
          // pending destination.
          const configuredCount = slots.filter((s) => Boolean(s?.destinationUrl?.trim())).length;
          const allConfigured = slotCount > 0 && configuredCount >= slotCount;
          // Domain-qualified Public URL — the single link customers share. The
          // internal /r/ routing URL is never surfaced here.
          const publicPanelUrl = row.publicUrl && origin ? `${origin}${row.publicUrl}` : null;

          return (
            <Card key={row.assignmentId} className="bg-surface border-transparent ring-1 ring-line-subtle p-5 space-y-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="text-base font-semibold text-ink flex items-center gap-2">
                    <QrCode className="h-4 w-4 text-accent-400" />
                    {row.productTitle ?? row.catalogProduct?.name ?? inst.name ?? 'Standee'}
                    {products.length > 1 && <span className="text-ink-faint">#{ri + 1}</span>}
                  </h2>
                  <p className="text-xs text-ink-mute mt-0.5">
                    {String(slotCount)} QR slot{slotCount === 1 ? '' : 's'} ·{' '}
                    {allConfigured
                      ? 'active'
                      : configuredCount > 0
                        ? `${configuredCount} of ${slotCount} configured`
                        : 'Setup Required'}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge
                    variant={allConfigured ? 'success' : configuredCount > 0 ? 'warning' : 'default'}
                    className="ring-line-subtle uppercase"
                  >
                    <Layers className="mr-1 h-3 w-3" />
                    {slotCount} QR
                  </Badge>
                  <Link
                    href={`/dashboard/products/${row.assignmentId}`}
                    className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-field px-3 text-xs font-medium text-ink-mute transition-colors hover:bg-white/5 hover:text-ink"
                  >
                    <Settings2 className="h-3.5 w-3.5" />
                    Manage
                  </Link>
                  {publicPanelUrl && (
                    <a
                      href={publicPanelUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-field px-3 text-xs font-medium text-accent-400 transition-colors hover:bg-white/5"
                    >
                      <ExternalLink className="h-3.5 w-3.5" />
                      Preview
                    </a>
                  )}
                </div>
              </div>

              {/* Panel QR — opens the customer's profile */}
              <div className="rounded-xl border border-line-subtle p-3.5 space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-medium text-ink-mute uppercase tracking-wider">
                    Panel
                  </p>
                  <span className="text-xs text-ink-faint">
                    Opens your platform picker page
                  </span>
                </div>

                <div className="flex items-end gap-2">
                  <div className="flex-1">
                    <Input
                      placeholder="Display name shown on the picker (e.g. Currys Electronics)"
                      className="border-line bg-field text-ink placeholder:text-ink-faint flex-1"
                      value={displayNames[row.assignmentId] ?? ''}
                      onChange={(e) =>
                        setDisplayNames((prev) => ({
                          ...prev,
                          [row.assignmentId]: e.target.value,
                        }))
                      }
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          handleSaveDisplayName(row);
                        }
                      }}
                    />
                    <p className="mt-1.5 text-xs text-ink-faint">
                      {displayNames[row.assignmentId]?.trim()
                        ? `Shown as “${displayNames[row.assignmentId].trim()}” on your standee’s public page`
                        : 'Defaults to your business name from your profile.'}
                    </p>
                  </div>
                  <Button
                    variant="secondary"
                    size="sm"
                    isLoading={savingName === row.assignmentId}
                    onClick={() => handleSaveDisplayName(row)}
                  >
                    <Save className="mr-1.5 h-3.5 w-3.5" />
                    Save
                  </Button>
                </div>

                {publicPanelUrl && (
                  <button
                    type="button"
onClick={() => copy(publicPanelUrl, inst.id)}
                  className="inline-flex items-center gap-2 rounded-lg bg-field px-3 py-2 font-mono text-sm text-accent-400 hover:bg-white/5 transition-colors"
                >
                  <Link2 className="h-4 w-4 shrink-0" />
                  {publicPanelUrl}
                  {copied?.id === inst.id ? (
                      <Check className="h-4 w-4 text-ok" />
                    ) : (
                      <Copy className="h-4 w-4 text-ink-mute" />
                    )}
                  </button>
                )}
              </div>

              {/* Fixed slots */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-medium text-ink-mute uppercase tracking-wider">
                    Profile Slots
                  </p>
                  <span className="text-xs text-ink-faint">
                    {configuredCount} of {slotCount} destinations set
                  </span>
                </div>
                {Array.from({ length: slotCount }).map((_, idx) => {
                  const slot = slots[idx];
                  const platform = fixed[idx] ?? slot?.platform ?? '';
                  const key = slotKey(row, idx);
                  return (
                    <div key={key} className="rounded-xl border border-line-subtle p-3.5 space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-field text-xs font-semibold text-ink">
                            {idx + 1}
                          </span>
                          <span className="text-sm font-medium text-ink">
                            {platformName(platform)}
                          </span>
                          <Badge variant="default" className="ring-line-subtle bg-field text-ink-faint">
                            Fixed slot
                          </Badge>
                        </div>
                      </div>{/* No per-slot external URL exists: the panel's Public URL is the
                         single link customers share, so there is nothing to copy here. */}

                      <div className="flex items-end gap-2">
                        <Input
                          placeholder={
                            platform === 'google_review'
                              ? 'https://g.page/r/YOUR-ID/review'
                              : platform === 'whatsapp'
                              ? 'https://wa.me/91XXXXXXXXXX'
                              : `https://${platform}.com/yourpage`
                          }
                          className="border-line bg-field text-ink placeholder:text-ink-faint flex-1"
                          value={values[key] ?? ''}
                          onChange={(e) =>
                            setValues((prev) => ({ ...prev, [key]: e.target.value }))
                          }
                        />
                        <Button
                          variant="secondary"
                          size="sm"
                          isLoading={savingSlot === key}
                          onClick={() => handleSaveSlot(row, idx)}
                        >
                          <Save className="mr-1.5 h-3.5 w-3.5" />
                          Save
                        </Button>
                      </div>

                      {slot?.destinationUrl && (
                        <a
                          href={slot.destinationUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1.5 text-xs text-accent-400 hover:text-accent-300"
                        >
                          <ExternalLink className="h-3.5 w-3.5" />
                          {slot.destinationUrl}
                        </a>
                      )}
                    </div>
                  );
                })}
              </div>

              {savingSlot && (
                <div className="flex items-center gap-2 text-xs text-ink-mute">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Saving…
                </div>
              )}
            </Card>
          );
        })
      )}
    </div>
  );
}
