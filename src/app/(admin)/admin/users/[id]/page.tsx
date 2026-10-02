'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import {
  ArrowLeft, Mail, MapPin, Building, Calendar, Fingerprint,
  TrendingUp, ShieldCheck, ShieldOff, ExternalLink,
  QrCode, Copy, Download, Plus, Trash2, Check, CheckCircle2,
  Package, ShoppingCart, CreditCard, Tag, Settings, Pencil,
} from 'lucide-react';
import QRCode from 'qrcode';
import { STANDEE_PLATFORMS, getStandeePlatformById } from '@/lib/constants';
import { getFixedStandeeProfiles } from '@/config/products';
import { CARD_TEMPLATE_META } from '@/lib/card-templates';
import { isCardCompatible } from '@/lib/services/product-experience';
import { Modal } from '@/components/ui/modal';

const PRODUCT_KIND_LABEL: Record<string, string> = {
  profile: 'Business Profile',
  social: 'Social Media Links',
  review: 'Google Review',
  standee: 'Standee',
};

const CATEGORY_LABEL: Record<string, string> = {
  card: 'NFC Card',
  standee: 'Standee',
  other: 'Other',
};

interface UserData {
  _id: string;
  name: string;
  email: string;
  customerId?: string;
  role: string;
  status: string;
  createdAt: string;
}

interface ProfileData {
  personalInfo: {
    fullName: string;
    jobTitle: string;
    bio: string;
    avatarUrl: string;
  };
  companyInfo: {
    companyName: string;
    taxId: string;
    address: string;
    website: string;
    logoUrl: string;
  };
  socialLinks: Array<{
    platform: string;
    url: string;
    label: string;
    clicks: number;
  }>;
}

interface CardData {
  _id: string;
  cardUid: string;
  slug: string;
  routeSlug?: string;
  urlAlias?: string;
  templateKey?: string;
  status: string;
  stats?: { taps?: number };
  createdAt: string;
}

interface LeadData {
  _id: string;
  name: string;
  email: string;
  phone: string;
  company: string;
  note: string;
  createdAt: string;
}

interface SocialQrEntry {
  qrId: string;
  platform: string;
  qrColor: string;
  label: string;
}

interface StandeeData {
  _id: string;
  name: string;
  routeSlug?: string;
  // Guarded defensively — legacy/malformed docs may lack these subdocs.
  panelQr?: { qrId: string; qrColor: string };
  socialQrs?: SocialQrEntry[];
  createdAt: string;
}

interface CatalogProductLite {
  _id: string;
  name: string;
  category: 'card' | 'standee' | 'other';
  kind?: string;
  slug?: string;
  priceMinor: number;
  currency: string;
  active: boolean;
}

interface UserProductRecord {
  _id: string;
  catalogProductId: CatalogProductLite;
  productTitle?: string;
  cardId: string | null;
  standeeId: string | null;
  quantity: number;
  unitPriceMinor: number;
  status: 'active' | 'removed';
  notes: string;
  createdAt: string;
}

interface AssignSuccessState {
  productName: string;
  quantity: number;
  kindLabel: string;
  card: { _id: string; cardUid: string; slug: string; kind: string } | null;
  standee: boolean;
  /** True when a card product was assigned without a physical NFC card yet. */
  unbound: boolean;
}

function catalogTypeLabel(item: CatalogProductLite): string {
  return PRODUCT_KIND_LABEL[item.kind ?? ''] ?? CATEGORY_LABEL[item.category] ?? item.category;
}

interface AnalyticsData {
  totalTaps: number;
  tapLogs: number;
  linkClicks: number;
  vcardDownloads: number;
  uniqueVisitors: number;
  recentActivity: Array<{
    action: string;
    metadata: string;
    ip: string;
    timestamp: string;
  }>;
}

export default function AdminUserDetailPage() {
  const params = useParams();
  const router = useRouter();
  const userId = params.id as string;

  const [user, setUser] = useState<UserData | null>(null);
  const [profile, setProfile] = useState<ProfileData | null>(null);
  const [cards, setCards] = useState<CardData[]>([]);
  const [templateNames, setTemplateNames] = useState<Record<string, string>>({});
  const [leads, setLeads] = useState<LeadData[]>([]);
  const [standees, setStandees] = useState<StandeeData[]>([]);
  const [analytics, setAnalytics] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [qrDataUrls, setQrDataUrls] = useState<Record<string, string>>({});
  const [copiedQrId, setCopiedQrId] = useState('');
  const [showAddStandy, setShowAddStandy] = useState(false);
  const [addStandyPlatforms, setAddStandyPlatforms] = useState<string[]>(
    STANDEE_PLATFORMS.map((p) => p.id as string)
  );
  const [addingStandy, setAddingStandy] = useState(false);

  const [purchasedProducts, setPurchasedProducts] = useState<UserProductRecord[]>([]);
  const [showAssignModal, setShowAssignModal] = useState(false);
  const [catalogItems, setCatalogItems] = useState<CatalogProductLite[]>([]);
  const [assignForm, setAssignForm] = useState({
    catalogProductId: '',
    quantity: '1',
    cardUid: '',
    notes: '',
  });
  const [assignWithoutCard, setAssignWithoutCard] = useState(false);
  const [assignPlatforms, setAssignPlatforms] = useState<string[]>(
    STANDEE_PLATFORMS.map((p) => p.id as string)
  );
  const [assignError, setAssignError] = useState('');
  const [assigning, setAssigning] = useState(false);
  const [assignResult, setAssignResult] = useState<AssignSuccessState | null>(null);

  const [replaceTarget, setReplaceTarget] = useState<{ userProductId: string; currentUid: string; slug: string; routeSlug?: string } | null>(null);
  const [replaceUid, setReplaceUid] = useState('');
  const [replaceError, setReplaceError] = useState('');
  const [replacing, setReplacing] = useState(false);

  const fetchUserDetail = useCallback(async () => {
    try {
      const [res, tplRes] = await Promise.all([
        fetch(`/api/admin/users/${userId}`),
        fetch('/api/admin/card-templates').then((r) => r.json().catch(() => null)),
      ]);
      if (!res.ok) {
        router.push('/admin/users');
        return;
      }
      const data = await res.json();
      const tplData: { templates?: Array<{ key: string; name: string }> } | null =
        tplRes as { templates?: Array<{ key: string; name: string }> } | null;
      setTemplateNames(
        Object.fromEntries((tplData?.templates ?? []).map((tpl) => [tpl.key, tpl.name]))
      );
      setUser(data.user);
      setProfile(data.profile);
      setCards(
        data.cards && data.cards.length ? data.cards : data.card ? [data.card] : []
      );
      setLeads(data.leads || []);
      setStandees(data.standees || []);
      setAnalytics(data.analytics);
    } catch (error) {
      console.error('Failed to fetch user detail:', error);
    } finally {
      setLoading(false);
    }
  }, [userId, router]);

  useEffect(() => {
    fetchUserDetail();
  }, [fetchUserDetail]);

  useEffect(() => {
    if (!cards.length) {
      setQrDataUrls({});
      return;
    }
    let cancelled = false;
    Promise.all(
      cards.map(async (c) => {
        const dataUrl = await QRCode.toDataURL(cardQrUrl(c), {
          width: 128,
          margin: 1,
          color: { dark: '#1a1a2e', light: '#ffffff' },
        });
        return [c._id, dataUrl] as const;
      })
    ).then((entries) => {
      if (!cancelled) setQrDataUrls(Object.fromEntries(entries));
    });
    return () => {
      cancelled = true;
    };
  }, [cards]);

  const handleStatusToggle = async () => {
    if (!user) return;
    const newStatus = user.status === 'active' ? 'suspended' : 'active';
    if (!confirm(`Are you sure you want to ${newStatus === 'suspended' ? 'suspend' : 'activate'} ${user.name}?`)) return;

    try {
      const res = await fetch(`/api/admin/users/${user._id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'updateStatus', status: newStatus }),
      });
      if (res.ok) fetchUserDetail();
    } catch (error) {
      console.error('Status update failed:', error);
    }
  };

  // Permanent card QR URL: prefer the /r/ route when a routeSlug exists,
  // otherwise fall back to the legacy /c/ compatibility URL.
  const cardQrUrl = (c: { routeSlug?: string; slug: string }) =>
    c.routeSlug ? `${window.location.origin}/r/${c.routeSlug}` : `${window.location.origin}/c/${c.slug}`;

  // Standee QR URL: canonical standees have a routeSlug (panel + slot routes);
  // legacy standees fall back to /qr/{qrId}.
  const standeeQrUrl = (s: StandeeData, kind: 'panel' | 'social', index = 0) => {
    if (s.routeSlug) {
      return kind === 'panel'
        ? `${window.location.origin}/r/${s.routeSlug}`
        : `${window.location.origin}/r/${s.routeSlug}/${index + 1}`;
    }
    return kind === 'panel'
      ? `${window.location.origin}/qr/${s.panelQr?.qrId ?? ''}`
      : `${window.location.origin}/qr/${s.socialQrs?.[index]?.qrId ?? ''}`;
  };

  const handleCopyQr = async (url: string, key: string) => {
    try {
      await navigator.clipboard.writeText(url);
      setCopiedQrId(key);
      setTimeout(() => setCopiedQrId(''), 1500);
    } catch (error) {
      console.error('Copy failed:', error);
    }
  };

  const handleDownloadQr = async (url: string, label: string, key: string) => {
    try {
      const canvas = document.createElement('canvas');
      await QRCode.toCanvas(canvas, url, { width: 512, margin: 2 });
      const link = document.createElement('a');
      link.href = canvas.toDataURL('image/png');
      link.download = `standee-${label}-${key}.png`;
      link.click();
    } catch (error) {
      console.error('QR download failed:', error);
    }
  };

  const handleDownloadCardQr = async (c: { routeSlug?: string; slug: string }) => {
    try {
      const canvas = document.createElement('canvas');
      await QRCode.toCanvas(canvas, cardQrUrl(c), { width: 512, margin: 2 });
      const link = document.createElement('a');
      link.href = canvas.toDataURL('image/png');
      link.download = `card-${c.slug}.png`;
      link.click();
    } catch (error) {
      console.error('Card QR download failed:', error);
    }
  };

  const toggleAddStandyPlatform = (id: string) => {
    setAddStandyPlatforms((prev) =>
      prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id]
    );
  };

  const handleAddStandee = async () => {
    if (!user || addStandyPlatforms.length === 0) return;
    setAddingStandy(true);
    try {
      const res = await fetch(`/api/admin/users/${user._id}/standy`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ platforms: addStandyPlatforms }),
      });
      if (res.ok) {
        setShowAddStandy(false);
        fetchUserDetail();
      } else {
        const data = await res.json().catch(() => null);
        alert(data?.error || 'Failed to add standee');
      }
    } catch (error) {
      console.error('Add standee failed:', error);
    } finally {
      setAddingStandy(false);
    }
  };

  const handleDeleteStandee = async (standeeId: string) => {
    if (!user || !confirm('Delete this standee? Its printed QR codes will stop resolving.')) return;
    try {
      const res = await fetch(`/api/admin/users/${user._id}/standy`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ standeeId }),
      });
      if (res.ok) {
        fetchUserDetail();
      } else {
        alert('Failed to delete standee');
      }
    } catch (error) {
      console.error('Standee delete failed:', error);
    }
  };

  const fetchPurchasedProducts = useCallback(async () => {
    try {
      const res = await fetch(`/api/admin/users/${userId}/products`);
      if (res.ok) {
        const data = await res.json();
        setPurchasedProducts(data.products || []);
      }
    } catch (error) {
      console.error('Failed to fetch purchased products:', error);
    }
  }, [userId]);

  useEffect(() => {
    fetchPurchasedProducts();
  }, [fetchPurchasedProducts]);

  const selectedCatalogItem = catalogItems.find((item) => item._id === assignForm.catalogProductId) || null;
  const selectedKind = selectedCatalogItem?.kind ?? 'card';

  // Single-QR standees (Google Review, Business Profile, …) and all-in-one
  // standees declare fixed slot profiles — the admin cannot pick platforms.
  const standeePreset =
    selectedCatalogItem?.category === 'standee' && selectedCatalogItem.slug
      ? getFixedStandeeProfiles(selectedCatalogItem.slug)
      : null;

  const openAssignModal = async () => {
    setAssignForm({ catalogProductId: '', quantity: '1', cardUid: '', notes: '' });
    setAssignWithoutCard(false);
    setAssignPlatforms(STANDEE_PLATFORMS.map((p) => p.id as string));
    setAssignError('');
    setAssignResult(null);
    setShowAssignModal(true);
    try {
      const catalogRes = await fetch('/api/admin/catalog');
      if (catalogRes.ok) {
        const data = await catalogRes.json();
        setCatalogItems((data.catalog || []).filter((item: CatalogProductLite & { active: boolean }) => item.active));
      }
    } catch (error) {
      console.error('Failed to load assign modal data:', error);
    }
  };

  const toggleAssignPlatform = (id: string) => {
    setAssignPlatforms((prev) =>
      prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id]
    );
  };

  const handleAssignProduct = async () => {
    if (!user || !selectedCatalogItem) return;
    setAssignError('');

    if (selectedCatalogItem.category === 'card' && !isCardCompatible(selectedKind)) {
      setAssignError(`Product kind '${selectedKind}' cannot be assigned to a card`);
      return;
    }
    if (selectedCatalogItem.category === 'card' && !assignWithoutCard && !assignForm.cardUid.trim()) {
      setAssignError('Enter the NFC Card UID to bind');
      return;
    }
    if (selectedCatalogItem.category === 'standee' && assignPlatforms.length === 0) {
      setAssignError('Select at least one platform for the standee QR codes');
      return;
    }

    setAssigning(true);
    try {
      const res = await fetch(`/api/admin/users/${user._id}/products`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          catalogProductId: selectedCatalogItem._id,
          quantity: Math.max(1, Number.parseInt(assignForm.quantity, 10) || 1),
          ...(selectedCatalogItem.category === 'card' && !assignWithoutCard ? { cardUid: assignForm.cardUid } : {}),
          ...(selectedCatalogItem.category === 'standee' ? { platforms: assignPlatforms } : {}),
          notes: assignForm.notes,
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setAssignError(data?.error || 'Failed to assign product');
        return;
      }
      setAssignResult({
        productName: selectedCatalogItem.name,
        quantity: Math.max(1, Number.parseInt(assignForm.quantity, 10) || 1),
        kindLabel:
          PRODUCT_KIND_LABEL[selectedKind] ??
          CATEGORY_LABEL[selectedCatalogItem.category] ??
          selectedCatalogItem.category,
        card: data?.card
          ? {
              _id: data.card._id,
              cardUid: data.card.cardUid,
              slug: data.card.slug,
              kind: data.card.kind ?? selectedKind,
            }
          : null,
        standee: Boolean(data?.standee),
        unbound: Boolean(data?.userProduct && !data?.card && selectedCatalogItem.category === 'card'),
      });
      setAssignError('');
      fetchPurchasedProducts();
      fetchUserDetail();
    } catch (error) {
      console.error('Assign product failed:', error);
      setAssignError('An error occurred');
    } finally {
      setAssigning(false);
    }
  };

  const handleRemoveProduct = async (record: UserProductRecord) => {
    if (!user || !confirm('Remove this product record? Hardware bindings are not changed.')) return;
    try {
      const res = await fetch(`/api/admin/users/${user._id}/products`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userProductId: record._id }),
      });
      if (res.ok) {
        fetchPurchasedProducts();
      } else {
        alert('Failed to remove product record');
      }
    } catch (error) {
      console.error('Remove product failed:', error);
    }
  };

  const userProductForCard = (cardId: string) =>
    purchasedProducts.find((p) => p.cardId === cardId);

  const openReplaceCard = (record: UserProductRecord) => {
    if (!user) return;
    const card = cards.find((c) => c._id === record.cardId);
    if (!card) return;
    setReplaceTarget({
      userProductId: record._id,
      currentUid: card.cardUid,
      slug: card.slug,
      routeSlug: card.routeSlug,
    });
    setReplaceUid('');
    setReplaceError('');
  };

  const handleReplaceCard = async () => {
    if (!user || !replaceTarget) return;
    const uid = replaceUid.trim();
    if (!uid) {
      setReplaceError('Enter the new Card UID');
      return;
    }
    setReplacing(true);
    setReplaceError('');
    try {
      const res = await fetch(`/api/admin/users/${user._id}/products/${replaceTarget.userProductId}/card`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cardUid: uid }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setReplaceError(data?.error || 'Failed to replace card');
        return;
      }
      setReplaceTarget(null);
      setReplaceUid('');
      fetchUserDetail();
      fetchPurchasedProducts();
    } catch (error) {
      console.error('Replace card failed:', error);
      setReplaceError('An error occurred');
    } finally {
      setReplacing(false);
    }
  };

  if (loading) {
    return (
      <div className="space-y-6 animate-fade-in">
        <div className="flex items-center gap-4">
          <div className="skeleton h-10 w-10 rounded-lg" />
          <div className="skeleton h-8 w-48" />
        </div>
        <div className="grid gap-6 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Card key={i} className="p-6 bg-surface border-transparent ring-1 ring-line-subtle"><div className="skeleton h-40" /></Card>
          ))}
        </div>
      </div>
    );
  }

  if (!user) return null;

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex items-center gap-4">
          <Button variant="outline" size="sm" onClick={() => router.push('/admin/users')} className="border-line-strong bg-transparent hover:bg-white/5 hover:border-line-strong focus:ring-accent-500">
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="text-2xl font-bold text-ink tracking-tight">{user.name}</h1>
            <p className="text-ink-mute text-sm mt-0.5">Customer detail view</p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={handleStatusToggle} className="border-line-strong bg-transparent hover:bg-white/5 hover:border-line-strong focus:ring-accent-500">
            {user.status === 'active' ? (
              <>
                <ShieldOff className="mr-2 h-4 w-4 text-warn" />
                Suspend
              </>
            ) : (
              <>
                <ShieldCheck className="mr-2 h-4 w-4 text-ok" />
                Activate
              </>
            )}
          </Button>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="p-6 bg-surface border-transparent ring-1 ring-line-subtle">
          <h3 className="text-sm font-semibold text-ink-faint uppercase tracking-wider mb-4">Profile</h3>
          <div className="flex items-center gap-4 mb-4">
            {profile?.personalInfo?.avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={profile.personalInfo.avatarUrl} alt={user.name} className="h-16 w-16 rounded-full object-cover" />
            ) : (
              <div className="flex h-16 w-16 items-center justify-center rounded-full bg-accent-600/15 text-xl font-bold text-accent-400">
                {user.name.charAt(0).toUpperCase()}
              </div>
            )}
            <div>
              <p className="font-semibold text-ink">{profile?.personalInfo?.fullName || user.name}</p>
              <p className="text-sm text-ink-mute">{profile?.personalInfo?.jobTitle || 'No job title'}</p>
            </div>
          </div>
          <div className="space-y-3 text-sm">
            <div className="flex items-center gap-2 text-ink-mute">
              <Mail className="h-4 w-4 text-ink-faint" />
              {user.email}
            </div>
            {user.customerId && (
              <div className="flex items-center gap-2 text-ink-mute">
                <Fingerprint className="h-4 w-4 text-ink-faint" />
                <code className="font-mono text-accent-400">{user.customerId}</code>
              </div>
            )}
            {profile?.companyInfo?.companyName && (
              <div className="flex items-center gap-2 text-ink-mute">
                <Building className="h-4 w-4 text-ink-faint" />
                {profile.companyInfo.companyName}
              </div>
            )}
            {profile?.companyInfo?.address && (
              <div className="flex items-center gap-2 text-ink-mute">
                <MapPin className="h-4 w-4 text-ink-faint" />
                {profile.companyInfo.address}
              </div>
            )}
            <div className="flex items-center gap-2 text-ink-mute">
              <Calendar className="h-4 w-4 text-ink-faint" />
              Joined {new Date(user.createdAt).toLocaleDateString()}
            </div>
          </div>
          <div className="mt-4 pt-4 border-t border-line-subtle">
            <Badge
              variant={user.status === 'active' ? 'success' : 'danger'}
              className={user.status === 'active'
                ? 'bg-ok/15 text-ok ring-line-subtle'
                : 'bg-bad/15 text-bad ring-line-subtle'}
            >
              {user.status}
            </Badge>
          </div>
        </Card>

        <Card className="p-6 bg-surface border-transparent ring-1 ring-line-subtle">
          <h3 className="text-sm font-semibold text-ink-faint uppercase tracking-wider mb-4">
            {cards.length > 1 ? `NFC Cards (${cards.length})` : 'NFC Card'}
          </h3>
          {cards.length ? (
            <div className="space-y-6">
              {cards.map((c, idx) => {
                const templateName =
                  (c.templateKey ? templateNames[c.templateKey] : undefined) ??
                  CARD_TEMPLATE_META.find((t) => t.key === c.templateKey)?.name ??
                  c.templateKey;
                return (
                  <div key={c._id} className={idx > 0 ? 'pt-5 border-t border-line-subtle' : ''}>
                    {cards.length > 1 && (
                      <p className="text-xs font-semibold text-ink-mute uppercase tracking-wider mb-3">
                        Card {idx + 1}
                      </p>
                    )}
                    <div className="space-y-4">
                      {qrDataUrls[c._id] && (
                        <div className="flex items-center justify-center gap-2">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={qrDataUrls[c._id]} alt={`QR code for card ${c.slug}`} className="rounded-lg" />
                          <button
                            type="button"
                            title="Download PNG"
                            onClick={() => handleDownloadCardQr(c)}
                            className="text-ink-mute hover:text-ink transition-colors"
                          >
                            <Download className="h-4 w-4" />
                          </button>
                        </div>
                      )}
                      <div className="space-y-2 text-sm">
                        <div className="flex justify-between">
                          <span className="text-ink-mute">Slug</span>
                          <span className="font-mono text-accent-400">/c/{c.slug}</span>
                        </div>
                        {c.routeSlug && (
                          <div className="flex justify-between">
                            <span className="text-ink-mute">Permanent Route</span>
                            <span className="font-mono text-accent-400">/r/{c.routeSlug}</span>
                          </div>
                        )}
                        <div className="flex justify-between">
                          <span className="text-ink-mute">UID</span>
                          <span className="font-mono text-ink">{c.cardUid}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-ink-mute">Template</span>
                          <span className="font-medium text-ink capitalize">{templateName}</span>
                        </div>
                        <div className="flex justify-between items-center">
                          <span className="text-ink-mute">Status</span>
                          <Badge
                            variant={c.status === 'active' ? 'success' : c.status === 'suspended' ? 'danger' : 'default'}
                            className={
                              c.status === 'active'
                                ? 'bg-ok/15 text-ok ring-line-subtle'
                                : c.status === 'suspended'
                                ? 'bg-bad/15 text-bad ring-line-subtle'
                                : 'bg-field text-ink-faint ring-line-subtle'
                            }
                          >
                            {c.status}
                          </Badge>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-ink-mute">Total Taps</span>
                          <span className="font-semibold text-ink">{c.stats?.taps ?? 0}</span>
                        </div>
                      </div>
                      <a
                        href={c.routeSlug ? `/r/${c.routeSlug}` : `/c/${c.slug}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="block"
                      >
                        <Button variant="outline" className="w-full border-line-strong bg-transparent hover:bg-white/5 hover:border-line-strong focus:ring-accent-500" size="sm">
                          <ExternalLink className="mr-2 h-4 w-4" />
                          View Public Profile
                        </Button>
                      </a>
                      {(() => {
                        const record = userProductForCard(c._id);
                        return record ? (
                          <Button
                            variant="outline"
                            size="sm"
                            className="w-full border-line-strong bg-transparent hover:bg-white/5 hover:border-line-strong focus:ring-accent-500"
                            onClick={() => openReplaceCard(record)}
                          >
                            <CreditCard className="mr-2 h-4 w-4" />
                            Replace Physical Card
                          </Button>
                        ) : null;
                      })()}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="text-center py-8 text-ink-faint">
              <p className="text-sm">No card assigned</p>
            </div>
          )}
        </Card>

        <Card className="p-6 bg-surface border-transparent ring-1 ring-line-subtle">
          <h3 className="text-sm font-semibold text-ink-faint uppercase tracking-wider mb-4">
            <TrendingUp className="inline h-4 w-4 mr-1" />
            Analytics
          </h3>
          {analytics ? (
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-lg bg-accent-600/15 p-3 text-center">
                <p className="text-2xl font-bold text-accent-400">{analytics.totalTaps}</p>
                <p className="text-xs text-ink-mute">Total Taps</p>
              </div>
              <div className="rounded-lg bg-ok/15 p-3 text-center">
                <p className="text-2xl font-bold text-ok">{analytics.uniqueVisitors}</p>
                <p className="text-xs text-ink-mute">Unique Visitors</p>
              </div>
              <div className="rounded-lg bg-warn/15 p-3 text-center">
                <p className="text-2xl font-bold text-warn">{analytics.linkClicks}</p>
                <p className="text-xs text-ink-mute">Link Clicks</p>
              </div>
              <div className="rounded-lg bg-bad/15 p-3 text-center">
                <p className="text-2xl font-bold text-bad">{analytics.vcardDownloads}</p>
                <p className="text-xs text-ink-mute">Downloads</p>
              </div>
            </div>
          ) : (
            <div className="text-center py-8 text-ink-faint">
              <p className="text-sm">No analytics data</p>
            </div>
          )}
        </Card>
      </div>

      <Card className="p-6 bg-surface border-transparent ring-1 ring-line-subtle">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-ink-faint uppercase tracking-wider">
            <QrCode className="inline h-4 w-4 mr-1" />
            Standee QR Codes ({standees.length})
          </h3>
          <Button
            variant="outline"
            size="sm"
            onClick={() => { setAddStandyPlatforms(STANDEE_PLATFORMS.map((p) => p.id as string)); setShowAddStandy(true); }}
            className="border-line-strong bg-transparent hover:bg-white/5 hover:border-line-strong focus:ring-accent-500"
          >
            <Plus className="mr-1.5 h-3.5 w-3.5 text-accent-400" />
            Add Standee
          </Button>
        </div>

        {standees.length === 0 ? (
          <div className="text-center py-8 text-ink-faint">
            <p className="text-sm">No standees yet — customer purchased a card only.</p>
            <p className="text-xs mt-1">Use &quot;Add Standee&quot; if they buy one later; QR codes generate instantly.</p>
          </div>
        ) : (
          <div className="space-y-5">
            {standees.map((standee, idx) => (
              <div key={standee._id} className="rounded-xl border border-line-subtle p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-semibold text-ink">
                    {standee.name || 'Counter Standee'} {standees.length > 1 && `#${idx + 1}`}
                  </p>
                  <button
                    type="button"
                    title="Delete standee"
                    onClick={() => handleDeleteStandee(standee._id)}
                    className="grid h-7 w-7 place-items-center rounded-md text-red-400/80 transition-colors hover:bg-red-500/10 hover:text-red-400"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>

                {standee.panelQr ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs font-medium text-ink-mute uppercase tracking-wide mr-1">Panel</span>
                    <div className="inline-flex items-center gap-2 rounded-lg bg-field px-3 py-1.5">
                      <span className="font-mono text-xs text-accent-400">{standee.panelQr.qrId}</span>
                      <button type="button" title="Copy link" onClick={() => handleCopyQr(standeeQrUrl(standee, 'panel'), standee.panelQr!.qrId)} className="text-ink-mute hover:text-ink transition-colors">
                        {copiedQrId === standee.panelQr!.qrId ? <Check className="h-3.5 w-3.5 text-ok" /> : <Copy className="h-3.5 w-3.5" />}
                      </button>
                      <button type="button" title="Download PNG" onClick={() => handleDownloadQr(standeeQrUrl(standee, 'panel'), 'panel', standee.panelQr!.qrId)} className="text-ink-mute hover:text-ink transition-colors">
                        <Download className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                ) : (
                  <p className="text-xs text-ink-faint">Panel QR not generated.</p>
                )}

                {standee.socialQrs && standee.socialQrs.length > 0 && (
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs font-medium text-ink-mute uppercase tracking-wide mr-1">Social</span>
                    {standee.socialQrs.map((qr, index) => (
                      <div key={qr.qrId} className="inline-flex items-center gap-2 rounded-lg bg-field px-3 py-1.5">
                        <span className="text-xs font-medium text-ink">{qr.label || qr.platform}</span>
                        <span className="font-mono text-xs text-ink-faint">{qr.qrId}</span>
                        <button type="button" title="Copy link" onClick={() => handleCopyQr(standeeQrUrl(standee, 'social', index), qr.qrId)} className="text-ink-mute hover:text-ink transition-colors">
                          {copiedQrId === qr.qrId ? <Check className="h-3.5 w-3.5 text-ok" /> : <Copy className="h-3.5 w-3.5" />}
                        </button>
                        <button type="button" title="Download PNG" onClick={() => handleDownloadQr(standeeQrUrl(standee, 'social', index), qr.platform, qr.qrId)} className="text-ink-mute hover:text-ink transition-colors">
                          <Download className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card className="p-6 bg-surface border-transparent ring-1 ring-line-subtle">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-ink-faint uppercase tracking-wider">
            <Package className="inline h-4 w-4 mr-1" />
            Products Purchased ({purchasedProducts.filter((p) => p.status === 'active').length})
          </h3>
          <Button
            variant="outline"
            size="sm"
            onClick={openAssignModal}
            className="border-line-strong bg-transparent hover:bg-white/5 hover:border-line-strong focus:ring-accent-500"
          >
            <ShoppingCart className="mr-1.5 h-3.5 w-3.5 text-accent-400" />
            Assign Product
          </Button>
        </div>

        {purchasedProducts.length === 0 ? (
          <div className="text-center py-8 text-ink-faint">
            <p className="text-sm">No products recorded yet.</p>
            <p className="text-xs mt-1">Use &quot;Assign Product&quot; to record a purchase at any time — card bindings and QR generation happen automatically.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {purchasedProducts.map((record) => {
              const item = record.catalogProductId;
              const typeLabel = item ? catalogTypeLabel(item) : 'Other';
              const categoryClass = item?.category === 'card'
                ? 'bg-accent-600/15 text-accent-400 ring-accent-500/25'
                : item?.category === 'standee'
                ? 'bg-warn/15 text-warn ring-line-subtle'
                : 'bg-field text-ink-faint ring-line-subtle';
              return (
                <div key={record._id} className={`rounded-xl border border-line-subtle p-4 ${record.status === 'removed' ? 'opacity-50' : ''}`}>
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent-600/15 ring-1 ring-accent-500/25">
                        <Package className="h-4 w-4 text-accent-400" />
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-ink truncate">{(record.productTitle ?? item?.name) || 'Unknown product'}</p>
                        <p className="text-xs text-ink-mute">
                          {record.quantity} × ₹{(record.unitPriceMinor / 100).toLocaleString('en-IN')}
                          {record.cardId && ' · card bound'}
                          {record.standeeId && ' · QR codes generated'}
                          {' · '}{new Date(record.createdAt).toLocaleDateString()}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <Badge variant="default" className={categoryClass}>{typeLabel}</Badge>
                      <Badge
                        variant={record.status === 'active' ? 'success' : 'default'}
                        className={record.status === 'active'
                          ? 'bg-ok/15 text-ok ring-line-subtle'
                          : 'bg-field text-ink-faint ring-line-subtle'}
                      >
                        {record.status === 'active' ? 'Assigned' : 'Removed'}
                      </Badge>
                      {record.cardId && (
                        <button
                          type="button"
                          title="Replace physical card"
                          onClick={() => openReplaceCard(record)}
                          className="grid h-7 w-7 place-items-center rounded-md text-accent-400/80 transition-colors hover:bg-accent-600/15 hover:text-accent-400"
                        >
                          <CreditCard className="h-4 w-4" />
                        </button>
                      )}
                      {record.status === 'active' && (
                        <button
                          type="button"
                          title="Remove record"
                          onClick={() => handleRemoveProduct(record)}
                          className="grid h-7 w-7 place-items-center rounded-md text-red-400/80 transition-colors hover:bg-red-500/10 hover:text-red-400"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      )}
                    </div>
                  </div>
                  {record.notes && (
                    <p className="mt-2 text-xs text-ink-mute pl-12">{record.notes}</p>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </Card>

      {profile?.socialLinks && profile.socialLinks.length > 0 && (
        <Card className="p-6 bg-surface border-transparent ring-1 ring-line-subtle">
          <h3 className="text-sm font-semibold text-ink-faint uppercase tracking-wider mb-4">Social Links</h3>
          <div className="flex flex-wrap gap-2">
            {profile.socialLinks.map((link, i) => (
              <a
                key={i}
                href={link.url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 rounded-full border border-line-subtle px-3 py-1.5 text-sm text-ink-mute hover:bg-white/5 hover:text-ink transition-colors"
              >
                {link.label || link.platform}
                <span className="text-xs text-ink-faint">({link.clicks})</span>
                <ExternalLink className="h-3 w-3" />
              </a>
            ))}
          </div>
        </Card>
      )}

      <Card className="p-6 bg-surface border-transparent ring-1 ring-line-subtle">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-ink-faint uppercase tracking-wider">Inquiries ({leads.length})</h3>
        </div>
        {leads.length === 0 ? (
          <div className="text-center py-8 text-ink-faint">
            <p className="text-sm">No inquiries captured yet</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-line-subtle">
                  <th className="px-4 py-2 text-left text-xs font-semibold text-ink-faint uppercase">Name</th>
                  <th className="px-4 py-2 text-left text-xs font-semibold text-ink-faint uppercase">Email</th>
                  <th className="px-4 py-2 text-left text-xs font-semibold text-ink-faint uppercase">Phone</th>
                  <th className="px-4 py-2 text-left text-xs font-semibold text-ink-faint uppercase">Company</th>
                  <th className="px-4 py-2 text-left text-xs font-semibold text-ink-faint uppercase">Note</th>
                  <th className="px-4 py-2 text-left text-xs font-semibold text-ink-faint uppercase">Date</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line-subtle">
                {leads.map((lead) => (
                  <tr key={lead._id} className="hover:bg-white/5">
                    <td className="px-4 py-3 text-sm font-medium text-ink">{lead.name}</td>
                    <td className="px-4 py-3 text-sm text-ink-mute">{lead.email || '-'}</td>
                    <td className="px-4 py-3 text-sm text-ink-mute">{lead.phone || '-'}</td>
                    <td className="px-4 py-3 text-sm text-ink-mute">{lead.company || '-'}</td>
                    <td className="px-4 py-3 text-sm text-ink-mute max-w-xs truncate">{lead.note || '-'}</td>
                    <td className="px-4 py-3 text-sm text-ink-mute">{new Date(lead.createdAt).toLocaleDateString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {analytics?.recentActivity && analytics.recentActivity.length > 0 && (
        <Card className="p-6 bg-surface border-transparent ring-1 ring-line-subtle">
          <h3 className="text-sm font-semibold text-ink-faint uppercase tracking-wider mb-4">Recent Activity</h3>
          <div className="space-y-2">
            {analytics.recentActivity.slice(0, 10).map((activity, i) => (
              <div key={i} className="flex items-center justify-between rounded-lg bg-field px-4 py-2.5 text-sm">
                <div className="flex items-center gap-3">
                  <Badge
                    variant={activity.action === 'tap' ? 'default' : activity.action === 'link_click' ? 'success' : 'default'}
                    className={activity.action === 'tap'
                      ? 'bg-field text-ink-faint ring-line-subtle'
                      : activity.action === 'link_click'
                      ? 'bg-ok/15 text-ok ring-line-subtle'
                      : 'bg-field text-ink-faint ring-line-subtle'}
                  >
                    {activity.action}
                  </Badge>
                  {activity.metadata && <span className="text-ink-mute">{activity.metadata}</span>}
                </div>
                <span className="text-xs text-ink-faint">{new Date(activity.timestamp).toLocaleString()}</span>
              </div>
            ))}
          </div>
        </Card>
      )}

      {showAddStandy && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="flex max-h-[85vh] w-full max-w-md flex-col rounded-2xl bg-bg-raised text-ink ring-1 ring-line-subtle shadow-pop mx-4 animate-fade-in">
            <div className="flex-1 overflow-y-auto p-6">
            <h3 className="text-lg font-semibold text-ink mb-1">Add Standee</h3>
            <p className="text-sm text-ink-mute mb-4">
              Generates a panel QR plus one dynamic QR per selected platform.
            </p>
            <div className="grid grid-cols-2 gap-2 mb-4">
              {STANDEE_PLATFORMS.map((platform) => (
                <label
                  key={platform.id}
                  className="flex items-center gap-2 rounded-lg border border-line-subtle px-3 py-2.5 text-sm text-ink cursor-pointer hover:bg-white/5 transition-colors"
                >
                  <input
                    type="checkbox"
                    checked={addStandyPlatforms.includes(platform.id)}
                    onChange={() => toggleAddStandyPlatform(platform.id)}
                    className="h-4 w-4 rounded border-line-strong text-accent-600 focus:ring-accent-500"
                  />
                  {platform.name}
                </label>
              ))}
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => setShowAddStandy(false)} className="border-line-strong bg-transparent hover:bg-white/5 hover:border-line-strong">
                Cancel
              </Button>
              <Button size="sm" disabled={addStandyPlatforms.length === 0} isLoading={addingStandy} onClick={handleAddStandee}>
                <QrCode className="mr-2 h-4 w-4" />
                Generate QR Codes
              </Button>
            </div>
            </div>
          </div>
        </div>
      )}

      <Modal
        isOpen={showAssignModal}
        onClose={() => setShowAssignModal(false)}
        title="Assign Product"
        className="bg-bg-raised text-ink ring-1 ring-line-subtle shadow-pop [&>div]:border-line-subtle [&_h2]:text-ink [&_button]:text-ink-faint hover:[&_button]:text-ink hover:[&_button]:bg-white/5"
      >
        {assignResult ? (
          <div className="space-y-4">
            <div className="flex items-start gap-3 rounded-lg bg-ok/10 p-4 ring-1 ring-ok/30">
              <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-ok" />
              <div>
                <p className="text-sm font-semibold text-ink">Product assigned successfully</p>
                <p className="text-sm text-ink-mute mt-0.5">
                  {assignResult.productName} · {assignResult.kindLabel} × {assignResult.quantity}
                </p>
                {assignResult.card && (
                  <p className="mt-1 font-mono text-xs text-ink-mute">
                    NFC card {assignResult.card.cardUid} (/c/{assignResult.card.slug}) · experience: {assignResult.card.kind}
                  </p>
                )}
                {assignResult.standee && (
                  <p className="mt-1 text-xs text-ink-mute">Panel + social QR codes generated below.</p>
                )}
                {assignResult.unbound && (
                  <p className="mt-1 text-xs text-ink-mute">
                    No NFC card bound yet — the customer can configure this product now; a physical card can be
                    linked later.
                  </p>
                )}
              </div>
            </div>

            {assignResult.card?.kind === 'social' && (
              <a href={`/dashboard/vcards/${assignResult.card._id}/edit`} className="block">
                <Button className="w-full">
                  <Settings className="mr-2 h-4 w-4" />
                  Set the redirect destination URL
                </Button>
              </a>
            )}
            {assignResult.card?.kind === 'review' && (
              <a href={`/dashboard/vcards/${assignResult.card._id}/edit`} className="block">
                <Button className="w-full">
                  <Settings className="mr-2 h-4 w-4" />
                  Configure review settings
                </Button>
              </a>
            )}
            {assignResult.card?.kind === 'profile' && (
              <div className="grid grid-cols-2 gap-2">
                <a href={`/dashboard/vcards/${assignResult.card._id}/edit`} className="block">
                  <Button variant="outline" className="w-full border-line-strong bg-transparent hover:bg-white/5 hover:border-line-strong">
                    <Pencil className="mr-2 h-4 w-4" />
                    Edit card
                  </Button>
                </a>
                <a href={`/c/${assignResult.card.slug}`} target="_blank" rel="noopener noreferrer" className="block">
                  <Button variant="outline" className="w-full border-line-strong bg-transparent hover:bg-white/5 hover:border-line-strong">
                    <ExternalLink className="mr-2 h-4 w-4" />
                    View card
                  </Button>
                </a>
              </div>
            )}
            {assignResult.standee && (
              <p className="text-xs text-ink-mute">No configuration needed — printed QR codes resolve immediately.</p>
            )}

            <div className="flex justify-end pt-2">
              <Button variant="outline" onClick={() => { setAssignResult(null); setShowAssignModal(false); }}>
                Done
              </Button>
            </div>
          </div>
        ) : (
        <div className="space-y-4">
          {assignError && (
            <div className="rounded-lg bg-red-50 p-3 text-sm text-red-600 ring-1 ring-red-200">{assignError}</div>
          )}

          <div>
            <label htmlFor="assign-catalog" className="block text-sm font-medium text-gray-700 mb-1.5">Product</label>
            {catalogItems.length > 0 ? (
              <select
                id="assign-catalog"
                value={assignForm.catalogProductId}
                onChange={(e) => {
                  const id = e.target.value;
                  const item = catalogItems.find((c) => c._id === id);
                  const preset =
                    item?.category === 'standee' && item.slug
                      ? getFixedStandeeProfiles(item.slug)
                      : null;
                  setAssignForm({ ...assignForm, catalogProductId: id, cardUid: '' });
                  // Fixed-profile standees lock the platform list; everything
                  // else defaults the free platform selection to all options.
                  setAssignPlatforms(
                    preset
                      ? preset.profiles
                      : STANDEE_PLATFORMS.map((p) => p.id as string)
                  );
                }}
                className="w-full rounded-lg border border-line bg-field px-3 py-2.5 text-sm text-ink hover:border-line-strong focus:border-accent-500 focus:outline-none focus:ring-2 focus:ring-accent-500/25 transition-all duration-200"
              >
                <option value="">Select a product</option>
                {catalogItems.map((item) => (
                  <option key={item._id} value={item._id}>
                    {item.name} — ₹{(item.priceMinor / 100).toLocaleString('en-IN')} ({catalogTypeLabel(item)})
                  </option>
                ))}
              </select>
            ) : (
              <div className="flex items-center gap-3 rounded-lg border border-line-subtle bg-field p-3.5 text-sm text-ink-mute">
                <Package className="h-4 w-4 text-ink-faint" />
                No active products in the catalog. Add products from the Products page first.
              </div>
            )}
          </div>

          {selectedCatalogItem?.category === 'card' && isCardCompatible(selectedKind) && (
            <div>
              <label className="flex cursor-pointer items-center gap-2 text-sm text-ink">
                <input
                  type="checkbox"
                  checked={assignWithoutCard}
                  onChange={(e) => setAssignWithoutCard(e.target.checked)}
                  className="h-4 w-4 rounded border-line-strong text-accent-600 focus:ring-accent-500"
                />
                Assign without a physical card (link later)
              </label>
              {!assignWithoutCard ? (
                <div className="mt-2 space-y-1">
                  <label htmlFor="assign-card" className="block text-sm font-medium text-gray-700">
                    Bind NFC Card (UID)
                  </label>
                  <Input
                    id="assign-card"
                    value={assignForm.cardUid}
                    onChange={(e) => setAssignForm({ ...assignForm, cardUid: e.target.value })}
                    placeholder="Enter NFC Card UID (e.g. 04A1B2C3D4E5)"
                    className="font-mono bg-field border-line text-ink placeholder:text-ink-faint hover:border-line-strong focus:border-accent-500 focus:ring-accent-500/25"
                  />
                  <p className="text-xs text-ink-mute">
                    The physical card is bound directly by its UID — no pre-registration needed. Its experience
                    will be set to &quot;{catalogTypeLabel(selectedCatalogItem)}&quot; automatically.
                  </p>
                </div>
              ) : (
                <p className="mt-1 text-xs text-ink-mute">
                  The product is created without a physical card. The customer can configure it now; a card can be
                  linked later.
                </p>
              )}
            </div>
          )}

          {selectedCatalogItem?.category === 'card' && !isCardCompatible(selectedKind) && (
            <div className="flex items-center gap-3 rounded-lg border border-line-subtle bg-field p-3.5 text-sm text-ink-mute">
              <Package className="h-4 w-4 text-ink-faint" />
              Product kind &quot;{selectedKind}&quot; is not compatible with a card and cannot be allocated to this customer yet.
            </div>
          )}

          {selectedCatalogItem?.category === 'standee' && (
            <div className="rounded-lg border border-line-subtle bg-field p-3.5">
              {standeePreset ? (
                <div>
                  <p className="text-sm font-medium text-ink-mute mb-1.5">
                    Standee QR Platform
                  </p>
                  <div className="flex items-center gap-2">
                    <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-accent-600/15 text-xs font-semibold text-accent-400">
                      {standeePreset.maxProfiles}
                    </span>
                    <span className="text-sm text-ink">
                      {standeePreset.profiles
                        .map((p) => getStandeePlatformById(p)?.name ?? p)
                        .join(', ')}
                    </span>
                  </div>
                  <p className="mt-1.5 text-xs text-ink-faint">
                    {standeePreset.maxProfiles === 1
                      ? 'This standee has 1 fixed QR code — the platform is set by the product.'
                      : 'This standee has fixed QR slots — the platforms are set by the product.'}
                  </p>
                </div>
              ) : (
                <>
                  <p className="text-sm font-medium text-ink-mute mb-2">Standee QR Platforms</p>
                  <div className="grid grid-cols-2 gap-2">
                    {STANDEE_PLATFORMS.map((platform) => (
                      <label
                        key={platform.id}
                        className="flex items-center gap-2 rounded-md px-2.5 py-2 text-sm text-ink cursor-pointer hover:bg-white/5 transition-colors"
                      >
                        <input
                          type="checkbox"
                          checked={assignPlatforms.includes(platform.id)}
                          onChange={() => toggleAssignPlatform(platform.id)}
                          className="h-4 w-4 rounded border-line-strong text-accent-600 focus:ring-accent-500"
                        />
                        {platform.name}
                      </label>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}

          {selectedCatalogItem && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="assign-qty" className="block text-sm font-medium text-gray-700 mb-1.5">Quantity</label>
                <Input
                  id="assign-qty"
                  type="number"
                  min="1"
                  max="99"
                  value={assignForm.quantity}
                  onChange={(e) => setAssignForm({ ...assignForm, quantity: e.target.value })}
                  className="bg-field border-line text-ink placeholder:text-ink-faint hover:border-line-strong focus:border-accent-500 focus:ring-accent-500/25"
                />
              </div>
              <div className="flex items-end pb-1">
                <Input
                  id="assign-notes"
                  placeholder="Notes (optional)"
                  value={assignForm.notes}
                  onChange={(e) => setAssignForm({ ...assignForm, notes: e.target.value })}
                  className="bg-field border-line text-ink placeholder:text-ink-faint hover:border-line-strong focus:border-accent-500 focus:ring-accent-500/25"
                />
              </div>
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setShowAssignModal(false)}>Cancel</Button>
            <Button
              onClick={handleAssignProduct}
              isLoading={assigning}
              disabled={
                !selectedCatalogItem ||
                (selectedCatalogItem.category === 'card' &&
                  (!isCardCompatible(selectedKind) || (!assignWithoutCard && !assignForm.cardUid)))
              }
            >
              <Tag className="mr-2 h-4 w-4" />
              Assign
            </Button>
          </div>
        </div>
        )}
      </Modal>

      <Modal
        isOpen={Boolean(replaceTarget)}
        onClose={() => setReplaceTarget(null)}
        title="Replace Physical Card"
        className="bg-bg-raised text-ink ring-1 ring-line-subtle shadow-pop [&>div]:border-line-subtle [&_h2]:text-ink [&_button]:text-ink-faint hover:[&_button]:text-ink hover:[&_button]:bg-white/5"
      >
        <div className="space-y-4">
          {replaceError && (
            <div className="rounded-lg bg-red-50 p-3 text-sm text-red-600 ring-1 ring-red-200">{replaceError}</div>
          )}

          {replaceTarget && (
            <div className="rounded-lg border border-line-subtle bg-field p-3 text-sm">
              <p className="text-ink-mute">
                Swapping the physical card behind the product record. The digital profile, product configuration
                and permanent URL are preserved — only the printed NFC UID changes.
              </p>
              <div className="mt-2 space-y-1 font-mono text-xs">
                <div className="flex justify-between">
                  <span className="text-ink-faint">Current UID</span>
                  <span className="text-ink">{replaceTarget.currentUid}</span>
                </div>
                {replaceTarget.routeSlug && (
                  <div className="flex justify-between">
                    <span className="text-ink-faint">Permanent route</span>
                    <span className="text-accent-400">/r/{replaceTarget.routeSlug}</span>
                  </div>
                )}
              </div>
            </div>
          )}

          <div>
            <label htmlFor="replace-card" className="block text-sm font-medium text-gray-700 mb-1.5">New NFC Card UID</label>
            <Input
              id="replace-card"
              value={replaceUid}
              onChange={(e) => setReplaceUid(e.target.value)}
              placeholder="Enter new NFC Card UID (e.g. 04A1B2C3D4E5)"
              className="font-mono bg-field border-line text-ink placeholder:text-ink-faint hover:border-line-strong focus:border-accent-500 focus:ring-accent-500/25"
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setReplaceTarget(null)}>Cancel</Button>
            <Button
              onClick={handleReplaceCard}
              isLoading={replacing}
              disabled={!replaceTarget || !replaceUid.trim()}
            >
              <CreditCard className="mr-2 h-4 w-4" />
              Replace Card
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
