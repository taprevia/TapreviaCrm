'use client';

/**
 * Product page — customer-facing configuration for a single product assignment.
 *
 * The form shown is driven by the product's catalog `kind` (the core software
 * experience): 'profile' (LinkedIn/Facebook/WhatsApp destinations),
 * 'social' (free destination URL), or 'review' (Google Review). Standees link
 * to the dedicated standee manager for slot configuration.
 *
 * The product's human-friendly public URL is shown and copied here; the
 * internal permanent /r/ routing URL is intentionally not surfaced.
 */

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Check,
  Copy,
  CheckCircle2,
  AlertCircle,
  ArrowLeft,
  Save,
  Globe,
  Info,
  QrCode,
  Settings2,
  Pencil,
} from 'lucide-react';
import { getStandeePlatformById } from '@/lib/constants';
import { isSafeExternalUrl } from '@/lib/safe-url';

interface ProductInstanceData {
  id: string;
  name: string;
  routeSlug: string;
  setupComplete: boolean;
  isActive: boolean;
  kind?: string;
  cardLabel?: string;
  urlAlias?: string;
  redirectUrl?: string;
  cardUid?: string;
  instagramConfig?: {
    username: string;
    profileUrl: string;
    reelsUrl?: string;
    postsUrl?: string;
    dmUrl?: string;
    shopUrl?: string;
  };
  whatsappConfig?: {
    phoneNumber: string;
    defaultMessage?: string;
  };
  linkedinConfig?: {
    profileUrl: string;
    resumeUrl?: string;
  };
  facebookConfig?: {
    profileUrl: string;
    pageUrl?: string;
    messengerUrl?: string;
  };
  reviewAssistant?: {
    enabled: boolean;
    googleReviewUrl: string;
    [key: string]: unknown;
  };
  socialQrs?: Array<{ qrId: string; platform: string; label: string; destinationUrl?: string }>;
  panelQr?: { qrId: string; qrColor: string };
}

interface ProductDetailResponse {
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
  instance: ProductInstanceData | null;
  publicUrl?: string | null;
}

function platformName(id: string): string {
  return getStandeePlatformById(id)?.name ?? id.replace(/_/g, ' ');
}

export default function ProductConfigPage({ params }: { params: { id: string } }) {
  const [data, setData] = useState<ProductDetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [copied, setCopied] = useState(false);

  // Product title (rename) state
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState('');
  const [titleSaving, setTitleSaving] = useState(false);
  const [titleError, setTitleError] = useState<string | null>(null);

  // Form state
  const [destinationUrl, setDestinationUrl] = useState('');
  const [instagram, setInstagram] = useState({ username: '', profileUrl: '' });
  const [googleReview, setGoogleReview] = useState({ googleReviewUrl: '', businessName: '' });
  const [whatsapp, setWhatsapp] = useState({ phoneNumber: '', defaultMessage: '' });
  const [linkedin, setLinkedin] = useState({ profileUrl: '' });
  const [facebook, setFacebook] = useState({ profileUrl: '' });

  useEffect(() => {
    fetchProduct();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.id]);

  const fetchProduct = async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/my/products/${params.id}`);
      if (res.status === 404) {
        setNotFound(true);
        return;
      }
      if (!res.ok) {
        setMessage({ type: 'error', text: 'Failed to load product' });
        return;
      }
      const json = await res.json();
      const detail = json.product as ProductDetailResponse;
      setData(detail);

      // Populate form state from existing config
      const inst = detail.instance;
      setDestinationUrl(inst?.redirectUrl ?? '');
      setInstagram({
        username: inst?.instagramConfig?.username ?? '',
        profileUrl: inst?.instagramConfig?.profileUrl ?? '',
      });
      setGoogleReview({
        googleReviewUrl: inst?.reviewAssistant?.googleReviewUrl ?? '',
        businessName: '',
      });
      setWhatsapp({
        phoneNumber: inst?.whatsappConfig?.phoneNumber ?? '',
        defaultMessage: inst?.whatsappConfig?.defaultMessage ?? '',
      });
      setLinkedin({ profileUrl: inst?.linkedinConfig?.profileUrl ?? '' });
      setFacebook({ profileUrl: inst?.facebookConfig?.profileUrl ?? '' });
    } catch {
      setMessage({ type: 'error', text: 'An error occurred while loading' });
    } finally {
      setLoading(false);
    }
  };

  const isValidUrl = (url: string) => {
    if (!url) return true;
    return /^https?:\/\/.+/i.test(url.trim());
  };

  const handleSave = async () => {
    setMessage(null);

    // Basic validation on URLs that are present
    const urls = [destinationUrl, instagram.profileUrl, googleReview.googleReviewUrl, linkedin.profileUrl, facebook.profileUrl];
    for (const url of urls) {
      if (!isValidUrl(url)) {
        setMessage({ type: 'error', text: 'Links must start with https:// (or http://)' });
        return;
      }
    }

    setSaving(true);
    try {
      const body: Record<string, unknown> = {};

      // Build payload based on product kind.
      if (kind === 'social') {
        body.destinationUrl = destinationUrl.trim();
      }
      if (kind === 'review') {
        body.googleReview = {
          googleReviewUrl: googleReview.googleReviewUrl.trim(),
          businessName: googleReview.businessName.trim() || undefined,
        };
      }
      if (kind === 'profile') {
        body.whatsapp = {
          phoneNumber: whatsapp.phoneNumber.trim(),
          defaultMessage: whatsapp.defaultMessage.trim(),
        };
        body.linkedin = { profileUrl: linkedin.profileUrl.trim() };
        body.facebook = { profileUrl: facebook.profileUrl.trim() };
      } else if (whatsapp.phoneNumber.trim()) {
        // Non-profile cards can still carry a WhatsApp config.
        body.whatsapp = {
          phoneNumber: whatsapp.phoneNumber.trim(),
          defaultMessage: whatsapp.defaultMessage.trim(),
        };
      }
      if (instagram.username.trim() || instagram.profileUrl.trim()) {
        body.instagram = {
          username: instagram.username.trim(),
          profileUrl: instagram.profileUrl.trim(),
        };
      }

      const res = await fetch(`/api/my/products/${params.id}/config`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        setMessage({ type: 'error', text: json?.error || 'Failed to save configuration' });
        return;
      }
      // The PATCH returns { card } once a physical card is bound (the
      // linked QR/NFC destination now serves the new URL) vs
      // { assignment: { pending: true } } for an unbound card (no public route
      // yet; the settings are applied when the physical card is linked).
      const savedAsPending = Boolean(json?.assignment?.pending);
      setMessage({
        type: 'success',
        text: savedAsPending
          ? 'Configuration saved. Your settings will be applied when a physical card is linked.'
          : 'Configuration saved. Your linked QR/NFC code now opens your new destination.',
      });
      await fetchProduct();
    } catch {
      setMessage({ type: 'error', text: 'An error occurred while saving' });
    } finally {
      setSaving(false);
    }
  };

  // Save a new product title via PATCH; empty input resets to the template name.
  const saveTitle = async () => {
    setTitleError(null);
    setTitleSaving(true);
    try {
      const res = await fetch(`/api/my/products/${params.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: titleDraft.trim() }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        setTitleError(json?.error || 'Failed to rename product');
        return;
      }
      setEditingTitle(false);
      await fetchProduct();
    } catch {
      setTitleError('An error occurred while renaming');
    } finally {
      setTitleSaving(false);
    }
  };

  const copyPublicUrl = async () => {
    if (!publicUrlFull) return;
    try {
      await navigator.clipboard.writeText(publicUrlFull);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // ignore
    }
  };

  // Origin is unavailable on the server; resolve it after mount so the
  // initial render is identical during SSR and hydration.
  const [origin, setOrigin] = useState('');
  useEffect(() => {
    setOrigin(window.location.origin);
  }, []);

  // Domain-qualified public link for the customer's product — the payload used
  // when a card/QR is encoded or shared.
  const publicUrlFull = data?.publicUrl && origin
    ? `${origin}${data.publicUrl}`
    : null;

  const kind = data?.catalogProduct?.kind ?? '';
  const isProfile = kind === 'profile';
  const isSocial = kind === 'social';
  const isReview = kind === 'review';
  const isStandee = data?.instanceType === 'standee';
  const hasWhatsapp =
    data?.instanceType === 'card' &&
    (isProfile || Boolean(data.instance?.whatsappConfig?.phoneNumber || whatsapp.phoneNumber));

  // A card's public URL is only live once its destination is actually
  // configured: review cards need the Review Assistant enabled, social cards
  // need a valid external destination URL. Profile cards and standees always
  // render, so they remain live. Null = live; otherwise the neutral message
  // replacing the copyable link until the destination goes live.
  const publicUrlPendingReason =
    isReview && data?.instance?.reviewAssistant?.enabled !== true
      ? 'This URL goes live once you enable Review Assistant.'
      : isSocial && !isSafeExternalUrl(data?.instance?.redirectUrl ?? '')
        ? 'This URL goes live once you set a destination link.'
        : null;

  // Instagram/Insta Card identity comes from the ASSIGNED PRODUCT (slug), never
  // from whether an instagramConfig already exists. Seeded slug is "insta-card"
  // (first segment "insta"); "instagram" is supported for catalog variants.
  const slugSegment = (data?.catalogProduct?.slug ?? '').split('-')[0];
  const isInstagramProduct = ['insta', 'instagram'].includes(slugSegment);

  // Google Review NFC Plate is an NFC plate, not an NFC card. The catalog
  // definition (code-level category) is authoritative even though the legacy
  // DB category was seeded as 'card'.
  const isPlate = data?.productDef?.category === 'plate';

  // Product-specific destination wording for free-destination (social) cards.
  const SOCIAL_DESTINATION_LABELS: Record<string, string> = {
    insta: 'Instagram destination',
    instagram: 'Instagram destination',
    linkedin: 'LinkedIn destination',
    facebook: 'Facebook destination',
  };

  // Brand-aware destination placeholder for social (free destination) cards,
  // so an Instagram sample URL is never shown on a LinkedIn/Facebook card.
  const SOCIAL_PLACEHOLDERS: Record<string, string> = {
    insta: 'https://instagram.com/yourpage',
    instagram: 'https://instagram.com/yourpage',
    linkedin: 'https://linkedin.com/in/yourname',
    facebook: 'https://facebook.com/yourpage',
  };
  const socialPlaceholder =
    SOCIAL_PLACEHOLDERS[(data?.catalogProduct?.slug ?? '').split('-')[0]] ?? 'https://yourlink.com/destination';

  if (loading) {
    return (
      <div className="space-y-3 max-w-2xl">
        <div className="skeleton h-52 rounded-xl" />
      </div>
    );
  }

  if (notFound || !data) {
    return (
      <Card className="bg-surface border-transparent ring-1 ring-line-subtle p-10 max-w-2xl">
        <div className="flex flex-col items-center text-center">
          <div className="rounded-full bg-field p-4 mb-4">
            <AlertCircle className="h-8 w-8 text-bad" />
          </div>
          <p className="text-sm font-medium text-ink">Product not found</p>
          <p className="text-sm text-ink-mute mt-1 mb-4">
            This product may have been removed or is not assigned to your account.
          </p>
          <Link
            href="/dashboard/products"
            className="inline-flex h-8 items-center justify-center gap-1.5 rounded-md border border-gray-300 bg-white px-3 text-xs font-medium text-gray-700 transition-all duration-200 hover:border-gray-400 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 active:scale-[0.98]"
          >
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to My Products
          </Link>
        </div>
      </Card>
    );
  }

  return (
    <div className="space-y-6 max-w-2xl animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <Link href="/dashboard/products" className="inline-flex items-center gap-1 text-sm text-accent-400 hover:text-accent-300 mb-2">
            <ArrowLeft className="h-4 w-4" />
            Back to My Products
          </Link>
          {editingTitle ? (
            <div className="flex items-center gap-2 flex-wrap">
              <Input
                autoFocus
                maxLength={120}
                className="h-9 w-72 border-line bg-field text-ink placeholder:text-ink-faint"
                value={titleDraft}
                onChange={(e) => setTitleDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') saveTitle();
                  if (e.key === 'Escape') setEditingTitle(false);
                }}
              />
              <Button size="sm" onClick={saveTitle} disabled={titleSaving} aria-label="Save name">
                <Check className="h-3.5 w-3.5" />
                Save
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setEditingTitle(false)}>
                Cancel
              </Button>
              {titleError && (
                <p className="w-full text-xs text-bad">{titleError}</p>
              )}
            </div>
          ) : (
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-2xl font-bold text-ink tracking-tight">
                {data.productTitle}
              </h1>
              <button
                type="button"
                onClick={() => {
                  setTitleDraft(data.productTitle);
                  setTitleError(null);
                  setEditingTitle(true);
                }}
                aria-label="Edit product name"
                className="inline-flex h-7 w-7 items-center justify-center rounded-md text-ink-faint transition-colors hover:bg-white/5 hover:text-ink"
              >
                <Pencil className="h-4 w-4" />
              </button>
            </div>
          )}
          <p className="text-ink-mute text-sm mt-0.5">
            {isStandee
              ? 'Standee with fixed profile slots'
              : `${isPlate ? 'NFC plate' : 'NFC card'} · ${
                  isSocial
                    ? (SOCIAL_DESTINATION_LABELS[slugSegment] ?? 'free destination link')
                    : isReview
                      ? 'Google Review destination'
                      : isProfile
                        ? 'profile & social destinations'
                        : 'product'
                }`}
          </p>
        </div>
        {data.instance?.setupComplete ? (
          <Badge variant="success">
            <CheckCircle2 className="mr-1 h-3 w-3" />
            Active
          </Badge>
        ) : (
          <Badge variant="warning">
            <AlertCircle className="mr-1 h-3 w-3" />
            Setup Required
          </Badge>
        )}
      </div>

      {/* Public URL display */}
      {publicUrlFull && (
        <Card className="bg-surface border-transparent ring-1 ring-line-subtle p-5 space-y-3">
          <div>
            <h2 className="text-base font-semibold text-ink flex items-center gap-2">
              <Globe className="h-4 w-4 text-accent-400" />
              Public URL
            </h2>
            <p className="text-sm text-ink-mute mt-0.5">
              This is the link customers scan or share to reach your product if a QR/NFC code is linked. It always reflects your latest settings.
            </p>
          </div>
          <div className="flex items-center justify-between gap-3 rounded-lg bg-field px-3.5 py-2.5">
            <code className="flex-1 font-mono text-sm text-accent-400 break-all">{publicUrlFull}</code>
            {publicUrlPendingReason ? (
              <Info className="h-4 w-4 shrink-0 text-ink-faint" aria-hidden />
            ) : (
              <Button variant="ghost" size="sm" onClick={copyPublicUrl}>
                {copied ? (
                  <>
                    <Check className="mr-1.5 h-3.5 w-3.5 text-ok" />
                    Copied
                  </>
                ) : (
                  <>
                    <Copy className="mr-1.5 h-3.5 w-3.5" />
                    Copy
                  </>
                )}
              </Button>
            )}
          </div>
          {publicUrlPendingReason && (
            <p className="flex items-center gap-1.5 text-xs text-ink-mute">
              <Info className="h-3.5 w-3.5 shrink-0 text-ink-faint" aria-hidden />
              {publicUrlPendingReason}
            </p>
          )}
        </Card>
      )}

      {isStandee ? (
        /* ── Standee: slots + link to the standee manager ────────────────── */
        <Card className="bg-surface border-transparent ring-1 ring-line-subtle p-5 space-y-4">
          <div>
            <h2 className="text-base font-semibold text-ink flex items-center gap-2">
              <QrCode className="h-4 w-4 text-accent-400" />
              Profile Slots
            </h2>
            <p className="text-sm text-ink-mute mt-0.5">
              Each slot resolves dynamically to the destination you set. Change a slot&apos;s destination anytime — no reprint needed.
            </p>
          </div>

          {(data.instance?.socialQrs ?? []).length > 0 ? (
            <div className="space-y-2">
              {(data.instance!.socialQrs ?? []).map((qr, idx) => (
                <div key={qr.qrId} className="flex items-center justify-between rounded-lg border border-line-subtle px-3.5 py-2.5">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-accent-600/10 text-[10px] font-semibold text-accent-400">
                      {idx + 1}
                    </span>
                    <span className="text-sm font-medium text-ink">{platformName(qr.platform)}</span>
                    {qr.destinationUrl && (
                      <span className="hidden sm:block truncate text-xs text-ink-faint max-w-[160px]">
                        {qr.destinationUrl}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-ink-mute">
              No slots are configured yet. Set each slot&apos;s destination from the standee manager.
            </p>
          )}

          <div className="pt-1">
            <Link
              href="/dashboard/standees"
              className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-gray-100 px-4 text-sm font-medium text-gray-900 transition-all duration-200 hover:bg-gray-200/80 focus:outline-none focus:ring-2 focus:ring-gray-400 focus:ring-offset-2 active:scale-[0.98]"
            >
              <Settings2 className="mr-2 h-4 w-4" />
              Manage slots
            </Link>
          </div>
        </Card>
      ) : (
        /* ── Card: destination editor ────────────────────────────────────── */
        <Card className="bg-surface border-transparent ring-1 ring-line-subtle p-5 space-y-4">
          <div>
            <h2 className="text-base font-semibold text-ink">Destination Configuration</h2>
            <p className="text-sm text-ink-mute mt-0.5">
              Update any time without replacing the physical card.
            </p>
          </div>

          {message && (
            <div
              className={`rounded-lg p-3 text-sm ring-1 animate-fade-in ${
                message.type === 'success'
                  ? 'bg-ok/10 text-ok ring-ok/25'
                  : 'bg-bad/10 text-bad ring-bad/25'
              }`}
            >
              {message.text}
            </div>
          )}

          <div className="space-y-4">
            {isSocial && (
              <Input
                label="Destination URL"
                type="url"
                placeholder={socialPlaceholder}
                className="border-line bg-field text-ink placeholder:text-ink-faint"
                value={destinationUrl}
                onChange={(e) => setDestinationUrl(e.target.value)}
              />
            )}

            {isReview && (
              <>
                <Input
                  label="Google Review URL"
                  type="url"
                  placeholder="https://g.page/r/YOUR-ID/review"
                  className="border-line bg-field text-ink placeholder:text-ink-faint"
                  value={googleReview.googleReviewUrl}
                  onChange={(e) => setGoogleReview((prev) => ({ ...prev, googleReviewUrl: e.target.value }))}
                />
                <Input
                  label="Business Name (optional)"
                  type="text"
                  placeholder="Your Business Name"
                  className="border-line bg-field text-ink placeholder:text-ink-faint"
                  value={googleReview.businessName}
                  onChange={(e) => setGoogleReview((prev) => ({ ...prev, businessName: e.target.value }))}
                />
              </>
            )}

            {hasWhatsapp && (
              <>
                <div className="pt-1">
                  <p className="text-xs font-medium text-ink-mute uppercase tracking-wider">WhatsApp</p>
                </div>
                <Input
                  label="WhatsApp Number"
                  type="tel"
                  placeholder="+919876543210"
                  className="border-line bg-field text-ink placeholder:text-ink-faint"
                  value={whatsapp.phoneNumber}
                  onChange={(e) => setWhatsapp((prev) => ({ ...prev, phoneNumber: e.target.value }))}
                />
                <Input
                  label="Default Message (optional)"
                  type="text"
                  placeholder="Hi! I found you through Taprevia."
                  className="border-line bg-field text-ink placeholder:text-ink-faint"
                  value={whatsapp.defaultMessage}
                  onChange={(e) => setWhatsapp((prev) => ({ ...prev, defaultMessage: e.target.value }))}
                />
              </>
            )}

            {isProfile && (
              <>
                <Input
                  label="LinkedIn Profile URL"
                  type="url"
                  placeholder="https://linkedin.com/in/yourprofile"
                  className="border-line bg-field text-ink placeholder:text-ink-faint"
                  value={linkedin.profileUrl}
                  onChange={(e) => setLinkedin({ profileUrl: e.target.value })}
                />
                <Input
                  label="Facebook Profile URL"
                  type="url"
                  placeholder="https://facebook.com/yourpage"
                  className="border-line bg-field text-ink placeholder:text-ink-faint"
                  value={facebook.profileUrl}
                  onChange={(e) => setFacebook({ profileUrl: e.target.value })}
                />
              </>
            )}

            {isInstagramProduct && (
              <>
                <div className="pt-1">
                  <p className="text-xs font-medium text-ink-mute uppercase tracking-wider">Instagram</p>
                </div>
                <Input
                  label="Instagram Username"
                  type="text"
                  placeholder="@yourusername"
                  className="border-line bg-field text-ink placeholder:text-ink-faint"
                  value={instagram.username}
                  onChange={(e) => setInstagram((prev) => ({ ...prev, username: e.target.value }))}
                />
                <Input
                  label="Instagram Profile URL"
                  type="url"
                  placeholder="https://instagram.com/yourusername"
                  className="border-line bg-field text-ink placeholder:text-ink-faint"
                  value={instagram.profileUrl}
                  onChange={(e) => setInstagram((prev) => ({ ...prev, profileUrl: e.target.value }))}
                />
              </>
            )}

            {!isSocial && !isReview && !isProfile && !hasWhatsapp && (
              <p className="text-sm text-ink-mute">
                Configure this product&apos;s destination. Your public link will reflect the update automatically.
              </p>
            )}
          </div>

          <div className="pt-1">
            <Button onClick={handleSave} isLoading={saving}>
              <Save className="mr-2 h-4 w-4" />
              Save Configuration
            </Button>
          </div>
        </Card>
      )}
    </div>
  );
}