'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { CreditCard, ExternalLink, Eye, QrCode, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/modal';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import { useToast } from '@/components/ui/toast';
import QRCode from 'qrcode';
import { CARD_TEMPLATE_META } from '@/lib/card-templates';
import { resolveCardDisplayName } from '@/lib/card-display';

interface Vcard {
  _id: string;
  name: string;
  cardLabel?: string | null;
  urlAlias: string;
  publicSlug?: string | null;
  templateKey: string;
  isActive?: boolean;
  profileImageUrl?: string | null;
  stats?: { taps?: number } | null;
  assignedUserId?: string | null;
  status?: string;
  createdAt?: string;
  updatedAt?: string;
}

interface ListMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

function initialOf(name: string): string {
  return name.trim().charAt(0).toUpperCase() || '?';
}

function templateNameOf(key: string, names: Record<string, string>): string {
  return names[key] ?? CARD_TEMPLATE_META.find((t) => t.key === key)?.name ?? key;
}

/** Human-friendly business public URL — the link customers scan/share. Falls
 *  back to the legacy /profile/{alias} route for cards without an allocated
 *  public slug so unbound cards still resolve. */
function resolveCardPublicUrl(vcard: Vcard, origin: string): string {
  const publicSlug = (vcard.publicSlug ?? '').trim();
  if (publicSlug && origin) return `${origin}/${publicSlug}`;
  return `/profile/${vcard.urlAlias}`;
}

export default function VcardsPage() {
  const { toast } = useToast();

  const [vcards, setVcards] = useState<Vcard[]>([]);
  const [meta, setMeta] = useState<ListMeta | null>(null);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Admin-defined display names for templates (fall back to code defaults).
  const [templateNames, setTemplateNames] = useState<Record<string, string>>({});
  useEffect(() => {
    let cancelled = false;
    fetch('/api/card-templates')
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { templates?: Array<{ key: string; name: string }> } | null) => {
        if (!cancelled && data?.templates) {
          setTemplateNames(
            Object.fromEntries(data.templates.map((tpl) => [tpl.key, tpl.name]))
          );
        }
      })
      .catch(() => {
        /* keep code defaults */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Delete modal state
  const [deleteTarget, setDeleteTarget] = useState<Vcard | null>(null);
  const [deleting, setDeleting] = useState(false);

  // QR modal state
  const [qrTarget, setQrTarget] = useState<Vcard | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState('');

  // Origin is unavailable on the server; resolve it after mount so the
  // initial render is identical during SSR and hydration.
  const [origin, setOrigin] = useState('');
  useEffect(() => {
    setOrigin(window.location.origin);
  }, []);

  const openQr = async (vcard: Vcard) => {
    setQrTarget(vcard);
    setQrDataUrl('');
    try {
      const url = resolveCardPublicUrl(vcard, window.location.origin);
      const dataUrl = await QRCode.toDataURL(url, { width: 256, margin: 2 });
      setQrDataUrl(dataUrl);
    } catch (error) {
      console.error('QR generation failed:', error);
    }
  };

  const downloadQr = () => {
    if (!qrTarget || !qrDataUrl) return;
    const a = document.createElement('a');
    a.href = qrDataUrl;
    a.download = `${qrTarget.urlAlias}-qr.png`;
    a.click();
  };

  const fetchVcards = useCallback(
    async (targetPage: number) => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/cards?page=${targetPage}`);
        const data = await res.json().catch(() => null);
        if (!res.ok) {
          throw new Error(data?.error || 'Failed to load cards');
        }
        setVcards(data.cards ?? []);
        setMeta(data.meta ?? null);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load vCards');
      } finally {
        setLoading(false);
      }
    },
    []
  );

  useEffect(() => {
    fetchVcards(page);
  }, [fetchVcards, page]);

  const handleDelete = async () => {
    if (!deleteTarget || deleting) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/cards/${deleteTarget._id}`, { method: 'DELETE' });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        toast({
          title: 'Could not delete card',
          description: data?.error || 'Something went wrong. Please try again.',
          variant: 'error',
        });
        return;
      }
      setVcards((prev) => prev.filter((v) => v._id !== deleteTarget._id));
      setMeta((prev) =>
        prev
          ? {
              ...prev,
              total: Math.max(0, prev.total - 1),
            }
          : prev
      );
      toast({ title: 'vCard deleted', description: `“${resolveCardDisplayName(deleteTarget)}” has been removed.`, variant: 'success' });
      setDeleteTarget(null);
    } catch {
      toast({
        title: 'Could not delete vCard',
        description: 'Network error. Please check your connection and try again.',
        variant: 'error',
      });
    } finally {
      setDeleting(false);
    }
  };

  const totalPages = meta?.totalPages ?? 1;

  return (
    <div>
      {/* Page header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-ink">vCards</h1>
          <p className="mt-1 text-sm text-ink-mute">Manage your digital business cards</p>
        </div>
      </div>

      {/* Error banner */}
      {!loading && error && (
        <div className="mt-6 flex items-center justify-between gap-4 rounded-xl bg-bad/10 p-4 ring-1 ring-bad/25">
          <p className="text-sm text-red-400">{error}</p>
          <Button variant="outline" size="sm" onClick={() => fetchVcards(page)}>
            Retry
          </Button>
        </div>
      )}

      {/* Loading skeletons */}
      {loading && (
        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="overflow-hidden rounded-xl ring-1 ring-line-subtle bg-surface shadow-e2">
              <div className="h-20 animate-pulse bg-field" />
              <div className="space-y-2.5 p-5">
                <div className="h-4 w-2/3 animate-pulse rounded-md bg-field" />
                <div className="h-3 w-1/2 animate-pulse rounded-md bg-field" />
                <div className="flex gap-4 pt-2">
                  <div className="h-3 w-12 animate-pulse rounded-md bg-field" />
                  <div className="h-3 w-16 animate-pulse rounded-md bg-field" />
                </div>
              </div>
              <div className="flex gap-2 p-4 pt-0">
                <div className="h-8 w-20 animate-pulse rounded-md bg-field" />
                <div className="h-8 w-8 animate-pulse rounded-md bg-field" />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Empty state */}
      {!loading && !error && vcards.length === 0 && (
        <EmptyState
          icon={CreditCard}
          title="No vCards yet"
          description="Cards are provided by your business. As soon as a card is assigned to you it will appear here."
        />
      )}

      {/* Cards grid */}
      {!loading && !error && vcards.length > 0 && (
        <>
          <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {vcards.map((vcard) => (
              <article
                key={vcard._id}
                className="overflow-hidden rounded-xl ring-1 ring-line-subtle bg-surface shadow-e2 transition-shadow hover:shadow-e3"
              >
                {/* Header strip: profile image or initials fallback */}
                <div className="relative h-20 bg-field">
                  {vcard.profileImageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={vcard.profileImageUrl} alt="" className="object-cover w-full h-full" />
                  ) : (
                    <div className="flex h-full items-center justify-center">
                      <span className="grid h-11 w-11 place-items-center rounded-full bg-accent-600 text-white font-semibold">
                        {initialOf(resolveCardDisplayName(vcard))}
                      </span>
                    </div>
                  )}
                </div>

                {/* Body */}
                <div className="p-5 space-y-1">
                  <h2 className="truncate text-base font-semibold text-ink">{resolveCardDisplayName(vcard)}</h2>
                  <a
                    href={
                      vcard.publicSlug && origin
                        ? `${origin}/${vcard.publicSlug}`
                        : `/profile/${vcard.urlAlias}`
                    }
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex max-w-full items-center gap-1.5 text-xs text-ink-mute font-mono hover:text-accent-400 transition-colors"
                  >
                    <span className="truncate">
                      {vcard.publicSlug && origin
                        ? `${origin}/${vcard.publicSlug}`
                        : `/profile/${vcard.urlAlias}`}
                    </span>
                    <ExternalLink className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  </a>
                  <div className="flex items-center gap-4 pt-2">
                    <span className="flex items-center gap-1.5 text-xs tabular-nums text-ink-mute">
                      <Eye className="h-3.5 w-3.5" aria-hidden="true" />
                      {vcard.stats?.taps ?? 0}
                    </span>
                    {vcard.assignedUserId && (
                      <Badge variant="default" className="bg-accent/10 text-accent-400 ring-accent/25 uppercase">
                        NFC
                      </Badge>
                    )}
                    <Badge variant="default" className="bg-field text-ink-faint ring-line-subtle uppercase">
                      {templateNameOf(vcard.templateKey, templateNames)}
                    </Badge>
                  </div>
                </div>

                {/* Footer actions */}
                <div className="flex gap-2 p-4 pt-0">
                  <Link href={`/dashboard/vcards/${vcard._id}/edit`} className="shrink-0">
                    <Button variant="outline" size="sm">
                      Edit
                    </Button>
                  </Link>
                  <Button variant="outline" size="sm" onClick={() => openQr(vcard)}>
                    <QrCode className="mr-1.5 h-3.5 w-3.5" />
                    QR
                  </Button>
                  {!vcard.assignedUserId && (
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label={`Delete ${resolveCardDisplayName(vcard)}`}
                      className="text-red-400 hover:bg-bad/10 ml-auto"
                      onClick={() => setDeleteTarget(vcard)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              </article>
            ))}
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <nav className="mt-6 flex items-center justify-end gap-3" aria-label="Pagination">
              <button
                type="button"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1}
                className="rounded-lg px-3 py-1.5 text-sm font-medium text-ink-mute hover:bg-white/5 hover:text-ink transition-colors disabled:pointer-events-none disabled:opacity-40"
              >
                Prev
              </button>
              <span className="text-xs text-ink-mute">
                Page {meta?.page ?? page} of {totalPages}
              </span>
              <button
                type="button"
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages}
                className="rounded-lg px-3 py-1.5 text-sm font-medium text-ink-mute hover:bg-white/5 hover:text-ink transition-colors disabled:pointer-events-none disabled:opacity-40"
              >
                Next
              </button>
            </nav>
          )}
        </>
      )}

      {/* Delete confirmation modal */}
      <Modal isOpen={deleteTarget !== null} onClose={() => setDeleteTarget(null)} title="Delete vCard">
        <p className="text-sm text-ink-mute">
          Delete this vCard? This removes its products, inquiries &amp; bookings.
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={() => setDeleteTarget(null)} disabled={deleting}>
            Cancel
          </Button>
          <Button variant="danger" isLoading={deleting} onClick={handleDelete}>
            Delete
          </Button>
        </div>
      </Modal>

      {/* QR code modal */}
      <Modal
        isOpen={qrTarget !== null}
        onClose={() => setQrTarget(null)}
        title={`QR code · ${qrTarget ? resolveCardDisplayName(qrTarget) : ''}`}
      >
        {qrDataUrl ? (
          <div className="flex flex-col items-center gap-4">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={qrDataUrl} alt={`QR code for ${qrTarget ? resolveCardDisplayName(qrTarget) : ''}`} className="rounded-lg ring-1 ring-line-subtle" />
            <p className="font-mono text-xs text-ink-mute break-all text-center">
              {qrTarget ? resolveCardPublicUrl(qrTarget, window.location.origin) : ''}
            </p>
            <p className="text-sm text-ink-mute text-center">
              Scan to visit this card&apos;s public page — it always reflects the latest content and template.
            </p>
          </div>
        ) : (
          <div className="flex justify-center py-8">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-accent-500 border-t-transparent" />
          </div>
        )}
        <div className="mt-5 flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={() => setQrTarget(null)}>
            Close
          </Button>
          <Button onClick={downloadQr} disabled={!qrDataUrl}>
            Download PNG
          </Button>
        </div>
      </Modal>
    </div>
  );
}
