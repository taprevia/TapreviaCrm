'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  ArrowLeft,
  ChevronRight,
  Download,
  Eye,
  Search,
  Trash2,
  UserRound,
  Users,
} from 'lucide-react';
import QRCodeLib from 'qrcode';
import { downloadQrPdf } from '@/lib/qr-pdf';
import { canonicalPublicBase } from '@/lib/public-base';

interface SocialQrEntry {
  qrId: string;
  platform: string;
  qrColor: string;
  label: string;
}

interface StandeeEntry {
  _id: string;
  name: string;
  displayName?: string;
  routeSlug?: string;
  publicSlug?: string;
  userId: string | null;
  userName: string;
  userEmail: string;
  userPhone?: string;
  panelQr: { qrId: string; qrColor: string };
  socialQrs: SocialQrEntry[];
  createdAt: string;
}

interface UserGroup {
  userId: string;
  name: string;
  email: string;
  phone: string;
  standees: StandeeEntry[];
}

const PUBLIC_BASE_URL = canonicalPublicBase();

export default function AdminStandeeQrPage() {
  const [standees, setStandees] = useState<StandeeEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [qrDataUrls, setQrDataUrls] = useState<Record<string, string>>({});
  const [generating, setGenerating] = useState<string | null>(null);
  const generatingRef = useRef(false);

  useEffect(() => {
    void fetchStandees();
  }, []);

  const fetchStandees = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/admin/standee-qr');
      if (!res.ok) {
        setError('Failed to load standee records.');
        return;
      }
      const data = await res.json();
      setStandees(Array.isArray(data.standees) ? data.standees : []);
    } catch (err) {
      console.error('Failed to fetch standees:', err);
      setError('Failed to load standee records.');
    } finally {
      setLoading(false);
    }
  };

  const groups = useMemo<UserGroup[]>(() => {
    const map = new Map<string, UserGroup>();
    for (const standee of standees) {
      if (!standee.userId) continue;
      const existing = map.get(standee.userId);
      if (existing) {
        existing.standees.push(standee);
      } else {
        map.set(standee.userId, {
          userId: standee.userId,
          name: standee.userName || 'Unnamed customer',
          email: standee.userEmail || '',
          phone: standee.userPhone || '',
          standees: [standee],
        });
      }
    }
    return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [standees]);

  const unassignedGroup = useMemo<UserGroup | null>(() => {
    const unassigned = standees.filter((standee) => !standee.userId);
    return unassigned.length
      ? {
          userId: '__unassigned__',
          name: 'Unassigned Standees',
          email: '',
          phone: '',
          standees: unassigned,
        }
      : null;
  }, [standees]);

  const selectedUser = selectedUserId
    ? [...groups, ...(unassignedGroup ? [unassignedGroup] : [])].find(
        (group) => group.userId === selectedUserId
      ) ?? null
    : null;

  const filteredGroups = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return groups;
    return groups.filter(
      (group) =>
        group.name.toLowerCase().includes(q) ||
        group.email.toLowerCase().includes(q) ||
        group.phone.toLowerCase().includes(q)
    );
  }, [groups, search]);

  const standeeQrUrl = (s: StandeeEntry, kind: 'panel' | 'social', index = 0) => {
    if (!PUBLIC_BASE_URL) return '';
    if (s.routeSlug) {
      return kind === 'panel'
        ? `${PUBLIC_BASE_URL}/r/${s.routeSlug}`
        : `${PUBLIC_BASE_URL}/r/${s.routeSlug}/${index + 1}`;
    }
    return kind === 'panel'
      ? `${PUBLIC_BASE_URL}/qr/${s.panelQr.qrId}`
      : `${PUBLIC_BASE_URL}/qr/${s.socialQrs[index].qrId}`;
  };

  // QR images are generated only for the selected user's standees.
  useEffect(() => {
    if (!selectedUserId) {
      setQrDataUrls({});
      return;
    }
    const selected =
      selectedUserId === '__unassigned__'
        ? standees.filter((s) => !s.userId)
        : standees.filter((s) => s.userId === selectedUserId);
    if (selected.length === 0 || !PUBLIC_BASE_URL) {
      setQrDataUrls({});
      return;
    }
    let cancelled = false;
    const entries: Array<Promise<readonly [string, string]>> = [];
    for (const standee of selected) {
      const panelUrl = standeeQrUrl(standee, 'panel');
      if (panelUrl) {
        entries.push(
          QRCodeLib.toDataURL(panelUrl, { width: 192, margin: 1 }).then(
            (url) => [`${standee._id}:panel`, url] as const
          )
        );
      }
      standee.socialQrs.forEach((_qr, index) => {
        const url = standeeQrUrl(standee, 'social', index);
        if (url) {
          entries.push(
            QRCodeLib.toDataURL(url, { width: 128, margin: 1 }).then(
              (dataUrl) => [`${standee._id}:slot:${index}`, dataUrl] as const
            )
          );
        }
      });
    }
    void Promise.all(entries).then((result) => {
      if (!cancelled) setQrDataUrls(Object.fromEntries(result));
    });
    return () => {
      cancelled = true;
    };
    // QR map depends on the selected user and the loaded records only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedUserId, standees]);

  const handleDownload = async (s: StandeeEntry, kind: 'panel' | 'social', index = 0) => {
    const url = standeeQrUrl(s, kind, index);
    if (!url || generatingRef.current) return;
    generatingRef.current = true;
    const key = kind === 'panel' ? s.panelQr.qrId : s.socialQrs[index].qrId;
    const label = kind === 'panel' ? 'panel' : s.socialQrs[index].platform;
    const standeeName = s.displayName || s.name || 'Counter Standee';
    setGenerating(key);
    try {
      await downloadQrPdf(
        [{ title: `${standeeName} - ${label}`, url }],
        `standee-${label}-${key}.pdf`
      );
    } catch (err) {
      console.error('QR PDF generation failed:', err);
      setError('Could not generate QR PDF.');
    } finally {
      generatingRef.current = false;
      setGenerating(null);
    }
  };

  const handleDownloadAll = async (standee: StandeeEntry) => {
    if (generatingRef.current) return;
    generatingRef.current = true;
    const standeeName = standee.displayName || standee.name || 'Counter Standee';
    const items = [{ title: `${standeeName} - panel`, url: standeeQrUrl(standee, 'panel') }];
    standee.socialQrs.forEach((qr, index) => {
      items.push({
        title: `${standeeName} - ${qr.label || qr.platform}`,
        url: standeeQrUrl(standee, 'social', index),
      });
    });
    const valid = items.filter((item) => item.url);
    if (!valid.length) return;
    setGenerating(`all:${standee._id}`);
    try {
      await downloadQrPdf(valid, `standee-${standee.routeSlug || standee.panelQr.qrId}-all.pdf`);
    } catch (err) {
      console.error('QR PDF bulk generation failed:', err);
      setError('Could not generate QR PDF.');
    } finally {
      generatingRef.current = false;
      setGenerating(null);
    }
  };

  const handleDelete = async (standee: StandeeEntry) => {
    if (!confirm(`Delete ${standee.userName}'s standee? Its printed QR codes will stop resolving.`)) return;
    try {
      const res = await fetch('/api/admin/standee-qr', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ standeeId: standee._id }),
      });
      if (res.ok) await fetchStandees();
      else setError('Failed to delete standee.');
    } catch (err) {
      console.error('Failed to delete standee:', err);
      setError('Failed to delete standee.');
    }
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold text-ink tracking-tight">Standee QR Codes</h1>
        <p className="text-ink-mute text-sm mt-0.5">
          {selectedUser
            ? 'Panel and slot QR codes for this customer'
            : 'Customers with assigned standees — select a customer to view QR codes'}
        </p>
      </div>

      {!PUBLIC_BASE_URL && (
        <p className="rounded-lg bg-bad/10 px-3 py-2 text-xs text-bad ring-1 ring-bad/20">
          Public base URL is not configured. Standee QR generation is disabled.
        </p>
      )}

          {error && (
            <div className="flex items-center justify-between gap-3 rounded-lg bg-bad/10 p-3 text-sm text-bad ring-1 ring-bad/20">
              <span>{error}</span>
              <Button variant="outline" size="sm" onClick={() => void fetchStandees()}>
                Retry
              </Button>
            </div>
          )}

      {selectedUser ? (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setSelectedUserId(null)}
                className="border-line-strong bg-transparent hover:bg-white/5 hover:border-line-strong focus:ring-accent-500"
              >
                <ArrowLeft className="mr-1.5 h-4 w-4" />
                Back to Users
              </Button>
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-ink">{selectedUser.name}</p>
                <p className="truncate text-xs text-ink-mute">
                  {[selectedUser.email, selectedUser.phone].filter(Boolean).join(' · ') || 'No contact details'}
                </p>
              </div>
            </div>
            <Badge variant="default" className="bg-field text-ink-mute ring-line-subtle">
              {selectedUser.standees.length} standee{selectedUser.standees.length === 1 ? '' : 's'}
            </Badge>
          </div>

          {selectedUser.standees.length === 0 ? (
            <Card className="p-10 bg-surface border-transparent ring-1 ring-line-subtle text-center">
              <QrIcon />
              <p className="mt-3 text-sm font-medium text-ink">No standees remain for this customer</p>
              <p className="mt-1 text-xs text-ink-mute">Assignments may have changed. Go back to refresh the list.</p>
            </Card>
          ) : (
            <div className="grid gap-4 md:grid-cols-2">
              {selectedUser.standees.map((standee) => (
                <Card key={standee._id} className="p-4 bg-surface border-transparent ring-1 ring-line-subtle">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-ink">
                        {standee.displayName || standee.name || 'Counter Standee'}
                      </p>
                      <p className="mt-0.5 truncate font-mono text-[11px] text-ink-faint">
                        {standee.publicSlug || standee.routeSlug || standee.panelQr.qrId}
                      </p>
                    </div>
                    <Badge
                      variant="default"
                      className="shrink-0 bg-field text-ink-mute ring-line-subtle"
                    >
                      {standee.routeSlug ? 'Permanent /r' : 'Legacy QR'}
                    </Badge>
                  </div>

                  <div className="mt-4 flex gap-4">
                    <div className="shrink-0 text-center">
                      {qrDataUrls[`${standee._id}:panel`] ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={qrDataUrls[`${standee._id}:panel`]}
                          alt="Panel QR code"
                          className="h-24 w-24 rounded-lg bg-white p-1"
                        />
                      ) : (
                        <div className="flex h-24 w-24 items-center justify-center rounded-lg border border-dashed border-line-subtle">
                          <QrCodeIcon className="h-5 w-5 text-ink-faint" />
                        </div>
                      )}
                      <p className="mt-1 text-[10px] uppercase tracking-wide text-ink-faint">Panel</p>
                    </div>

                    <div className="min-w-0 flex-1 space-y-1.5">
                      <p className="break-all text-[11px] text-ink-mute">
                        {standeeQrUrl(standee, 'panel') || 'QR unavailable'}
                      </p>
                      <p className="font-mono text-[10px] text-ink-faint">{standee.panelQr.qrId}</p>
                      {standee.socialQrs.length > 0 && (
                        <div className="flex flex-wrap gap-1.5 pt-1">
                          {standee.socialQrs.map((qr, index) => {
                            const slotQr = qrDataUrls[`${standee._id}:slot:${index}`];
                            return (
                              <div
                                key={qr.qrId}
                                className="inline-flex items-center gap-1.5 rounded-lg border border-line-subtle p-1 pr-2"
                              >
                                {slotQr ? (
                                  // eslint-disable-next-line @next/next/no-img-element
                                  <img src={slotQr} alt={`${qr.label || qr.platform} QR`} className="h-8 w-8 rounded bg-white" />
                                ) : (
                                  <span className="grid h-8 w-8 place-items-center text-ink-faint">
                                    <QrCodeIcon className="h-3.5 w-3.5" />
                                  </span>
                                )}
                                <span className="max-w-[90px] truncate text-[11px] text-ink-mute">
                                  {qr.label || qr.platform}
                                </span>
                                <button
                                  type="button"
                                  title={`Download ${qr.label || qr.platform} PDF`}
                                  disabled={Boolean(generating)}
                                  onClick={() => handleDownload(standee, 'social', index)}
                                  className="text-ink-faint transition-colors hover:text-ink"
                                >
                                  <Download className="h-3 w-3" />
                                </button>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="mt-4 flex flex-wrap gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleDownload(standee, 'panel')}
                      disabled={!standeeQrUrl(standee, 'panel') || Boolean(generating)}
                      className="border-line-strong bg-transparent hover:bg-white/5 hover:border-line-strong focus:ring-accent-500"
                    >
                      <Download className="mr-1.5 h-3.5 w-3.5" />
                      {generating === standee.panelQr.qrId ? 'Generating…' : 'Panel PDF'}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleDownloadAll(standee)}
                      disabled={!PUBLIC_BASE_URL || Boolean(generating)}
                      className="border-line-strong bg-transparent hover:bg-white/5 hover:border-line-strong focus:ring-accent-500"
                    >
                      <Download className="mr-1.5 h-3.5 w-3.5" />
                      {generating === `all:${standee._id}` ? 'Generating…' : 'Download All (PDF)'}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => standee.userId && window.open(`/admin/users/${standee.userId}`, '_self')}
                      title="Open customer"
                      disabled={!standee.userId}
                      className="border-line-strong bg-transparent hover:bg-white/5 hover:border-line-strong focus:ring-accent-500"
                    >
                      <Eye className="h-3.5 w-3.5 text-accent-400" />
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleDelete(standee)}
                      title="Delete standee"
                      className="border-line-strong bg-transparent hover:bg-bad/10 hover:border-bad/40 focus:ring-accent-500"
                    >
                      <Trash2 className="h-3.5 w-3.5 text-bad" />
                    </Button>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </>
      ) : (
        <>
          <Card className="p-4 bg-surface border-transparent ring-1 ring-line-subtle">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-faint" />
              <input
                type="text"
                placeholder="Search customers by name, email or phone..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full rounded-lg border border-line bg-field pl-10 pr-3 py-2.5 text-sm text-ink placeholder:text-ink-faint focus:border-accent-500 focus:outline-none focus:ring-2 focus:ring-accent-500/25 hover:border-line-strong"
              />
            </div>
          </Card>


          <Card className="bg-surface border-transparent ring-1 ring-line-subtle">
            {loading ? (
              <div className="space-y-3 p-5">
                {Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} className="skeleton h-16 rounded-xl" />
                ))}
              </div>
            ) : filteredGroups.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-center">
                <div className="mb-4 rounded-full bg-field p-4">
                  <Users className="h-7 w-7 text-ink-faint" />
                </div>
                <p className="text-sm font-medium text-ink">
                  {groups.length === 0 ? 'No customers with standees' : 'No matching customers'}
                </p>
                <p className="mt-1 max-w-sm text-sm text-ink-mute">
                  {groups.length === 0
                    ? 'Standees are created when a customer is assigned a standee product.'
                    : 'Try a different name, email or phone number.'}
                </p>
              </div>
            ) : (
              <div className="divide-y divide-line-subtle">
                {filteredGroups.map((group) => (
                  <button
                    key={group.userId}
                    type="button"
                    onClick={() => setSelectedUserId(group.userId)}
                    className="flex w-full items-center gap-4 p-4 text-left transition-colors hover:bg-white/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent-400"
                  >
                    <div className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-accent-600/15 text-accent-400 ring-1 ring-accent-500/25">
                      <UserRound className="h-4 w-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-ink">{group.name}</p>
                      <p className="truncate text-xs text-ink-mute">
                        {[group.email, group.phone].filter(Boolean).join(' · ') || 'No contact details'}
                      </p>
                    </div>
                    <Badge variant="default" className="shrink-0 bg-field text-ink-mute ring-line-subtle">
                      {group.standees.length} standee{group.standees.length === 1 ? '' : 's'}
                    </Badge>
                    <ChevronRight className="h-4 w-4 shrink-0 text-ink-faint" />
                  </button>
                ))}
              </div>
            )}
          </Card>

          {unassignedGroup && (
            <Card className="bg-surface border-transparent ring-1 ring-line-subtle">
              <div className="flex items-center justify-between gap-3 border-b border-line-subtle p-4">
                <div>
                  <p className="text-sm font-semibold text-ink">Unassigned Standees</p>
                  <p className="mt-0.5 text-xs text-ink-mute">
                    Standees without an owner record — admin-only. No customer is assigned.
                  </p>
                </div>
                <Badge variant="default" className="bg-warn/15 text-warn ring-line-subtle">
                  {unassignedGroup.standees.length}
                </Badge>
              </div>
              <div className="divide-y divide-line-subtle">
                {unassignedGroup.standees.map((standee) => (
                  <button
                    key={standee._id}
                    type="button"
                    onClick={() => setSelectedUserId('__unassigned__')}
                    className="flex w-full items-center gap-4 p-4 text-left transition-colors hover:bg-white/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent-400"
                  >
                    <div className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-warn/15 text-warn ring-1 ring-line-subtle">
                      <QrCodeIcon className="h-4 w-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-ink">
                        {standee.displayName || standee.name || 'Counter Standee'}
                      </p>
                      <p className="truncate font-mono text-[11px] text-ink-faint">
                        {standee.routeSlug || standee.panelQr.qrId}
                      </p>
                    </div>
                    <ChevronRight className="h-4 w-4 shrink-0 text-ink-faint" />
                  </button>
                ))}
              </div>
            </Card>
          )}
        </>
      )}
    </div>
  );
}

function QrCodeIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className={className} aria-hidden="true">
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <path d="M14 14h3v3h-3zM20 14h1M14 20h1M18 18h3v3h-3z" />
    </svg>
  );
}

function QrIcon() {
  return (
    <div className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-field">
      <QrCodeIcon className="h-6 w-6 text-ink-faint" />
    </div>
  );
}
