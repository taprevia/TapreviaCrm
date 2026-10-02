'use client';

/**
 * My Products — customer-facing list of owned products, rendered as rich,
 * product-driven cards. Each card surfaces the real product instance (its
 * destination, standee slots, material, and the human-friendly public URL)
 * instead of a generic "configure something" tile. The internal permanent
 * /r/ routing URL is intentionally not shown here.
 */

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import {
  AlertCircle,
  CheckCircle2,
  Copy,
  Check,
  CreditCard,
  ExternalLink,
  Globe,
  Lock,
  Package,
  Pencil,
  QrCode,
  Settings2,
  X,
  Tag,
} from 'lucide-react';
import { getStandeePlatformById } from '@/lib/constants';
import { resolveProductManageHref } from '@/lib/product-route';
import { standeeConfigured, standeeNeedsSetup, unboundCardNeedsSetup } from '@/lib/product-status';

interface SocialQrEntry {
  qrId: string;
  platform: string;
  label: string;
  destinationUrl?: string;
}

interface ProductInstance {
  id: string;
  name: string;
  routeSlug: string;
  setupComplete: boolean;
  isActive: boolean;
  kind?: string;
  urlAlias?: string;
  redirectUrl?: string;
  cardUid?: string;
  instagramConfig?: { username?: string; profileUrl?: string };
  whatsappConfig?: { phoneNumber?: string };
  linkedinConfig?: { profileUrl?: string };
  facebookConfig?: { profileUrl?: string };
  reviewAssistant?: { enabled?: boolean; googleReviewUrl?: string };
  maxProfiles?: number;
  fixedProfiles?: string[];
  socialQrs?: SocialQrEntry[];
  displayName?: string;
}

interface ProductEntry {
  assignmentId: string;
  productTitle: string;
  catalogProduct: {
    id: string;
    name: string;
    slug: string;
    category: string;
    kind: string;
    imageUrl?: string;
  } | null;
  productDef: {
    id: string;
    name: string;
    category: string;
    metadata: Record<string, unknown>;
  } | null;
  instanceType: 'card' | 'standee' | null;
  publicUrl: string | null;
  instance: ProductInstance | null;
  quantity: number;
  material?: string;
  createdAt?: string;
}

const MATERIAL_LABEL: Record<string, string> = {
  pvc: 'PVC',
  metal: 'Metal',
  wooden: 'Wooden',
};

const CATEGORY_META = {
  card: { label: 'NFC Card', icon: CreditCard },
  plate: { label: 'NFC Plate', icon: Tag },
  standee: { label: 'Standee', icon: QrCode },
  other: { label: 'Product', icon: Package },
} as const;

/** Resolve the human-friendly label for what a card currently points to. */
function cardDestination(
  inst: ProductInstance,
  publicUrlFull?: string | null
): { label: string; href: string } | null {
  // Review cards tap into the review link — authoritative even when socials
  // are set. The destination row links to the domain-qualified public URL
  // (the QR/NFC entry point resolves to /review/[alias] → the configured
  // Google Review flow) instead of jumping straight past it to the external URL.
  if (inst.kind === 'review' && inst.reviewAssistant?.googleReviewUrl) {
    return {
      label: 'Google Review',
      href: publicUrlFull ?? inst.reviewAssistant.googleReviewUrl,
    };
  }
  const wa = inst.whatsappConfig;
  if (wa?.phoneNumber) {
    const digits = wa.phoneNumber.replace(/[^\d]/g, '').replace(/^0+/, '');
    return { label: wa.phoneNumber, href: `https://wa.me/${digits}` };
  }
  if (inst.instagramConfig?.profileUrl) {
    return {
      label: inst.instagramConfig.username
        ? `@${inst.instagramConfig.username}`
        : inst.instagramConfig.profileUrl,
      href: inst.instagramConfig.profileUrl,
    };
  }
  if (inst.facebookConfig?.profileUrl) {
    return { label: 'Facebook profile', href: inst.facebookConfig.profileUrl };
  }
  if (inst.linkedinConfig?.profileUrl) {
    return { label: 'LinkedIn profile', href: inst.linkedinConfig.profileUrl };
  }
  if (inst.reviewAssistant?.googleReviewUrl) {
    return { label: 'Google Review', href: inst.reviewAssistant.googleReviewUrl };
  }
  if (inst.redirectUrl) {
    return { label: inst.redirectUrl, href: inst.redirectUrl };
  }
  return null;
}

function platformName(id: string): string {
  return getStandeePlatformById(id)?.name ?? id.replace(/_/g, ' ');
}

export default function MyProductsPage() {
  const [products, setProducts] = useState<ProductEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftTitle, setDraftTitle] = useState('');
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameError, setRenameError] = useState<{ id: string; text: string } | null>(null);

  // Origin is unavailable on the server; resolve it after mount so the
  // initial render is identical during SSR and hydration.
  const [origin, setOrigin] = useState('');
  useEffect(() => {
    setOrigin(window.location.origin);
  }, []);

  useEffect(() => {
    fetchProducts();
  }, []);

  const fetchProducts = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/my/products');
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        setError(data?.error ?? 'Failed to load products');
        return;
      }
      const data = await res.json();
      setProducts(data.products ?? []);
    } catch {
      setError('An error occurred while loading products');
    } finally {
      setLoading(false);
    }
  };

  const copy = async (text: string, id: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(id);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      // Clipboard may be blocked; ignore.
    }
  };

  // Rename a product via PATCH and refresh only that row's title locally. An
// empty input resets the product back to its catalog template name (the
// server treats blank titles as a reset).
  const applyRename = async (assignmentId: string, previousTitle: string) => {
    const title = draftTitle.trim();
    setRenameError(null);
    if (title === previousTitle) {
      setEditingId(null);
      return;
    }
    setRenamingId(assignmentId);
    try {
      const res = await fetch(`/api/my/products/${assignmentId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        setRenameError({ id: assignmentId, text: json?.error || 'Failed to rename product' });
        return;
      }
      const updated = (json?.product as ProductEntry | undefined) ?? null;
      setProducts((prev) =>
        prev.map((p) =>
          p.assignmentId === assignmentId && updated
            ? { ...p, productTitle: updated.productTitle }
            : p
        )
      );
      setEditingId(null);
    } catch {
      setRenameError({ id: assignmentId, text: 'An error occurred while renaming' });
    } finally {
      setRenamingId(null);
    }
  };

  const cm = (category?: string) => {
    const key =
      category === 'card' || category === 'plate' || category === 'standee' || category === 'other'
        ? category
        : null;
    return key ? CATEGORY_META[key] : { label: 'Product', icon: Package };
  };

  return (
    <div className="space-y-6 animate-fade-in max-w-4xl">
      <div>
        <h1 className="text-2xl font-bold text-ink tracking-tight">My Products</h1>
        <p className="text-ink-mute text-sm mt-0.5">
          Every Taprevia product you own and where it currently points
        </p>
      </div>

      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="skeleton h-44 rounded-xl" />
          ))}
        </div>
      ) : error ? (
        <Card className="bg-surface border-transparent ring-1 ring-line-subtle p-10">
          <div className="flex flex-col items-center text-center">
            <div className="rounded-full bg-field p-4 mb-4">
              <AlertCircle className="h-8 w-8 text-bad" />
            </div>
            <p className="text-sm font-medium text-ink">{error}</p>
          </div>
        </Card>
      ) : products.length === 0 ? (
        <Card className="bg-surface border-transparent ring-1 ring-line-subtle p-10">
          <div className="flex flex-col items-center text-center">
            <div className="rounded-full bg-field p-4 mb-4">
              <Package className="h-8 w-8 text-ink-faint" />
            </div>
            <p className="text-sm font-medium text-ink">No products yet</p>
            <p className="text-sm text-ink-mute mt-1">
              When your Taprevia admin assigns a product after purchase, it appears here.
            </p>
          </div>
        </Card>
      ) : (
        <div className="space-y-4">
          {products.map((product) => {
            const inst = product.instance;
            const meta = cm(product.productDef?.category ?? product.catalogProduct?.category);
            const Icon = meta.icon;
            const needSetup = Boolean(inst && inst.setupComplete === false);
            // Standee readiness is derived from slot destinations (no persisted
            // setupComplete). A standee is active once any slot is pointed.
            const active =
              product.instanceType === 'standee'
                ? standeeConfigured(inst)
                : Boolean(inst && inst.setupComplete === true);
            const needsConfig =
              needSetup || unboundCardNeedsSetup(product) || (product.instanceType === 'standee' && standeeNeedsSetup(inst));

            const fixedProfiles = product.productDef?.metadata?.fixedProfiles as string[] | undefined;
            const maxProfiles =
              (product.productDef?.metadata?.maxProfiles as number | undefined) ??
              inst?.maxProfiles ??
              inst?.socialQrs?.length;
            const material = MATERIAL_LABEL[product.material ?? ''] ?? null;
            // Domain-qualified human-friendly public URL — what customers
            // scan/share. Always resolved to a full origin, never the internal
            // /r/ routing URL.
            const publicUrlFull =
              product.publicUrl && origin ? `${origin}${product.publicUrl}` : null;
            const destination = inst ? cardDestination(inst, publicUrlFull) : null;
            const manageHref = resolveProductManageHref(product);

            return (
              <Card
                key={product.assignmentId}
                className="bg-surface border-transparent ring-1 ring-line-subtle p-5"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-start gap-3 min-w-0">
                    <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-field ring-1 ring-line-subtle">
                      <Icon className="h-5 w-5 text-accent-400" />
                    </div>
                    <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          {editingId === product.assignmentId ? (
                            <>
                              <Input
                                autoFocus
                                maxLength={120}
                                className="h-8 w-56 border-line bg-field text-sm text-ink placeholder:text-ink-faint"
                                value={draftTitle}
                                onChange={(e) => setDraftTitle(e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') applyRename(product.assignmentId, product.productTitle);
                                  if (e.key === 'Escape') setEditingId(null);
                                }}
                              />
                              <Button
                                size="sm"
                                onClick={() => applyRename(product.assignmentId, product.productTitle)}
                                disabled={renamingId !== null}
                                aria-label="Save name"
                              >
                                <Check className="h-3.5 w-3.5" />
                              </Button>
                              <Button size="sm" variant="ghost" onClick={() => setEditingId(null)} aria-label="Cancel rename">
                                <X className="h-3.5 w-3.5" />
                              </Button>
                            </>
                          ) : (
                            <>
                              <h2 className="text-base font-semibold text-ink">
                                {product.productTitle}
                              </h2>
                              <button
                                type="button"
                                onClick={() => {
                                  setEditingId(product.assignmentId);
                                  setDraftTitle(product.productTitle);
                                  setRenameError(null);
                                }}
                                aria-label={`Rename ${product.productTitle}`}
                                className="inline-flex h-6 w-6 items-center justify-center rounded-md text-ink-faint transition-colors hover:bg-white/5 hover:text-ink"
                              >
                                <Pencil className="h-3.5 w-3.5" />
                              </button>
                              <span className="rounded-full bg-field px-2 py-0.5 text-xs font-medium text-ink-faint ring-1 ring-line-subtle">
                                {meta.label}
                              </span>
                            </>
                          )}
                        </div>
                        {renameError && renameError.id === product.assignmentId && (
                          <p className="mt-1.5 text-xs text-bad">{renameError.text}</p>
                        )}
                      {product.instanceType === 'standee' && maxProfiles ? (
                        <p className="text-sm text-ink-mute mt-0.5">
                          {maxProfiles} fixed {(maxProfiles === 1 ? 'slot' : 'slots')}
                          {fixedProfiles?.length
                            ? ` — ${fixedProfiles.map((p) => platformName(p)).join(' · ')}`
                            : ''}
                        </p>
                      ) : (
                        <p className="text-sm text-ink-mute mt-0.5">
                          {inst?.name || `Physical ${meta.label.toLowerCase()}`}
                        </p>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    {needsConfig && !active && (
                      <Badge variant="warning">
                        <AlertCircle className="mr-1 h-3 w-3" />
                        Setup Required
                      </Badge>
                    )}
                    {active && (
                      <Badge variant="success">
                        <CheckCircle2 className="mr-1 h-3 w-3" />
                        Active
                      </Badge>
                    )}
                  </div>
                </div>

                {/* Destination summary */}
                {product.instanceType === 'card' && destination && (
                  <a
                    href={destination.href}
                    target="_blank"
                    rel="noreferrer"
                    className="group mt-4 flex items-center gap-2 rounded-lg border border-line-subtle px-3.5 py-2.5 hover:border-accent-600/40 transition-colors"
                  >
                    <ExternalLink className="h-4 w-4 shrink-0 text-accent-400" aria-hidden="true" />
                    <span className="min-w-0 flex-1 truncate text-sm text-ink group-hover:text-accent-400 transition-colors">
                      {destination.label}
                    </span>
                    <span className="text-xs text-ink-faint shrink-0">Destination</span>
                  </a>
                )}

                {/* Standee chips */}
                {product.instanceType === 'standee' &&
                  (inst?.socialQrs ?? []).length > 0 && (
                    <div className="mt-4 flex flex-wrap items-center gap-1.5">
                      {inst!.socialQrs!.map((qr, idx) => (
                        <span
                          key={qr.qrId}
                          className="inline-flex items-center gap-1.5 rounded-full bg-field px-2.5 py-1 text-xs font-medium text-ink-mute ring-1 ring-line-subtle"
                        >
                          <span className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-accent-600/10 text-[10px] font-semibold text-accent-400">
                            {idx + 1}
                          </span>
                          {platformName(qr.platform)}
                        </span>
                      ))}
                    </div>
                  )}

                {/* Meta row */}
                {(product.quantity > 1 || material) && (
                  <p className="mt-4 text-xs text-ink-faint">
                    {product.quantity > 1 && `${product.quantity} × `}
                    {material ? `${material} ${meta.label.toLowerCase()}` : meta.label.toLowerCase()}
                  </p>
                )}

                {/* Human-friendly public URL — what customers share/display */}
                {publicUrlFull && (
                  <div className="mt-4 flex items-center justify-between gap-3 rounded-lg bg-field px-3.5 py-2.5 ring-1 ring-accent-600/20">
                    <div className="flex min-w-0 items-center gap-2">
                      <Globe className="h-4 w-4 shrink-0 text-accent-400" aria-hidden="true" />
                      <span className="truncate font-mono text-sm text-accent-400">
                        {publicUrlFull}
                      </span>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <span className="text-xs text-ink-faint">Public URL</span>
                      <button
                        type="button"
                        onClick={() => copy(publicUrlFull, `${product.assignmentId}:public`)}
                        className="inline-flex shrink-0 items-center gap-1.5 rounded-lg px-2 py-1 text-xs font-medium text-ink-mute transition-colors hover:bg-white/5 hover:text-ink"
                      >
                        {copied === `${product.assignmentId}:public` ? (
                          <>
                            <Check className="h-3.5 w-3.5 text-ok" />
                            Copied
                          </>
                        ) : (
                          <>
                            <Copy className="h-3.5 w-3.5" />
                            Copy
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                )}

                {/* Actions */}
                <div className="mt-4 flex items-center gap-2">
                  <Link
                    href={manageHref}
                    className="inline-flex h-8 items-center justify-center gap-1.5 rounded-md bg-gray-100 px-3 text-xs font-medium text-gray-900 transition-all duration-200 hover:bg-gray-200/80 focus:outline-none focus:ring-2 focus:ring-gray-400 focus:ring-offset-2 active:scale-[0.98]"
                  >
                    <Settings2 className="mr-1.5 h-3.5 w-3.5" />
                    {needsConfig ? 'Set Up' : 'Manage'}
                  </Link>
                  {/* Preview the custom public URL when one is allocated. */}
                  {publicUrlFull && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => window.open(publicUrlFull, '_blank')}
                    >
                      <ExternalLink className="mr-1.5 h-3.5 w-3.5" />
                      Preview
                    </Button>
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {/* Ownership note */}
      {products.length > 0 && (
        <p className="flex items-center gap-1.5 text-xs text-ink-faint">
          <Lock className="h-3.5 w-3.5" aria-hidden="true" />
          Products shown here are the ones your Taprevia admin assigned to this account after purchase.
        </p>
      )}
    </div>
  );
}