'use client';

import { useEffect, useState } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { QrCode, Download, Trash2, Search, Eye } from 'lucide-react';
import QRCodeLib from 'qrcode';

interface SocialQrEntry {
  qrId: string;
  platform: string;
  qrColor: string;
  label: string;
}

interface StandeeEntry {
  _id: string;
  name: string;
  routeSlug?: string;
  userId: string | null;
  userName: string;
  userEmail: string;
  panelQr: { qrId: string; qrColor: string };
  socialQrs: SocialQrEntry[];
  createdAt: string;
}

export default function AdminStandeeQrPage() {
  const [standees, setStandees] = useState<StandeeEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  useEffect(() => {
    fetchStandees();
  }, []);

  const fetchStandees = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/standee-qr');
      if (res.ok) {
        const data = await res.json();
        setStandees(data.standees);
      }
    } catch (error) {
      console.error('Failed to fetch standees:', error);
    } finally {
      setLoading(false);
    }
  };

  // Canonical standees have a routeSlug → permanent /r/ panel + slot routes.
  // Legacy standees (no routeSlug) stay on /qr/{qrId}.
  const standeeQrUrl = (s: StandeeEntry, kind: 'panel' | 'social', index = 0) => {
    if (s.routeSlug) {
      return kind === 'panel'
        ? `${window.location.origin}/r/${s.routeSlug}`
        : `${window.location.origin}/r/${s.routeSlug}/${index + 1}`;
    }
    return kind === 'panel'
      ? `${window.location.origin}/qr/${s.panelQr.qrId}`
      : `${window.location.origin}/qr/${s.socialQrs[index].qrId}`;
  };

  const handleDownload = async (s: StandeeEntry, kind: 'panel' | 'social', index = 0) => {
    try {
      const key = kind === 'panel' ? s.panelQr.qrId : s.socialQrs[index].qrId;
      const label = kind === 'panel' ? 'panel' : s.socialQrs[index].platform;
      const canvas = document.createElement('canvas');
      await QRCodeLib.toCanvas(canvas, standeeQrUrl(s, kind, index), { width: 512, margin: 2 });
      const link = document.createElement('a');
      link.href = canvas.toDataURL('image/png');
      link.download = `standee-${label}-${key}.png`;
      link.click();
    } catch (error) {
      console.error('QR download failed:', error);
    }
  };

  const handleDownloadAll = async (standee: StandeeEntry) => {
    await handleDownload(standee, 'panel');
    for (let index = 0; index < standee.socialQrs.length; index += 1) {
      await handleDownload(standee, 'social', index);
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
      if (res.ok) fetchStandees();
    } catch (error) {
      console.error('Failed to delete standee:', error);
    }
  };

  const filteredList = standees.filter((s) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      s.userName.toLowerCase().includes(q) ||
      s.userEmail.toLowerCase().includes(q) ||
      s.panelQr.qrId.toLowerCase().includes(q) ||
      s.socialQrs.some((qr) => qr.platform.toLowerCase().includes(q) || qr.qrId.toLowerCase().includes(q))
    );
  });

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold text-ink tracking-tight">Standee QR Codes</h1>
        <p className="text-ink-mute text-sm mt-0.5">
          Dynamic QRs generated per customer standee — destinations update when customers edit their social links
        </p>
      </div>

      <Card className="p-4 bg-surface border-transparent ring-1 ring-line-subtle">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-faint" />
          <input
            type="text"
            placeholder="Search by customer or QR ID..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-lg border border-line bg-field pl-10 pr-3 py-2.5 text-sm text-ink placeholder:text-ink-faint focus:border-accent-500 focus:outline-none focus:ring-2 focus:ring-accent-500/25 hover:border-line-strong"
          />
        </div>
      </Card>

      <Card className="bg-surface border-transparent ring-1 ring-line-subtle">
        {loading ? (
          <div className="p-6 space-y-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="skeleton h-16 rounded-xl" />
            ))}
          </div>
        ) : filteredList.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <div className="rounded-full bg-field p-4 mb-4">
              <QrCode className="h-8 w-8 text-ink-faint" />
            </div>
            <p className="text-sm font-medium text-ink">No standees yet</p>
            <p className="text-sm text-ink-mute mt-1">
              Standees are generated when a customer is created with a standee purchase, or via &quot;Add Standee&quot; on their detail page
            </p>
          </div>
        ) : (
          <div className="divide-y divide-line-subtle">
            {filteredList.map((standee) => (
              <div key={standee._id} className="flex flex-wrap items-start justify-between gap-4 p-5 hover:bg-white/5 transition-colors">
                <div className="min-w-0 flex-1 space-y-2.5">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-sm font-semibold text-ink">{standee.userName}</p>
                    <span className="text-xs text-ink-mute">{standee.userEmail}</span>
                    <Badge variant="default" className="ring-line-subtle bg-field text-ink-mute">
                      {standee.name || 'Counter Standee'}
                    </Badge>
                  </div>

                  <div className="flex items-center gap-2">
                    <span className="text-xs font-medium text-ink-mute uppercase tracking-wide">Panel</span>
                    <span className="font-mono text-xs text-accent-400">{standee.panelQr.qrId}</span>
                    <button
                      type="button"
                      title="Download PNG"
                      onClick={() => handleDownload(standee, 'panel')}
                      className="text-ink-mute hover:text-ink transition-colors"
                    >
                      <Download className="h-3.5 w-3.5" />
                    </button>
                  </div>

                  {standee.socialQrs.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {standee.socialQrs.map((qr, index) => (
                        <span key={qr.qrId} className="inline-flex items-center gap-1.5 rounded-full border border-line-subtle px-2.5 py-1 text-xs text-ink-mute">
                          {qr.label || qr.platform}
                          <span className="font-mono text-[10px] text-ink-faint">{qr.qrId}</span>
                          <button
                            type="button"
                            title="Download PNG"
                            onClick={() => handleDownload(standee, 'social', index)}
                            className="text-ink-faint hover:text-ink transition-colors"
                          >
                            <Download className="h-3 w-3" />
                          </button>
                        </span>
                      ))}
                    </div>
                  )}
                </div>

                <div className="flex items-center gap-1.5">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleDownloadAll(standee)}
                    title="Download all QR PNGs for printing"
                    className="border-line-strong bg-transparent hover:bg-white/5 hover:border-line-strong focus:ring-accent-500"
                  >
                    <Download className="mr-1.5 h-3.5 w-3.5" />
                    Download All
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
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
