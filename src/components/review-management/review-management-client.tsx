'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  ExternalLink,
  Eye,
  Globe2,
  Info,
  Loader2,
  Lock,
  MessageSquareText,
  Save,
  Settings2,
  Sparkles,
  Star,
} from 'lucide-react';
import { Badge, Button, Card, EmptyState, Input, SegmentedControl, Select, Switch, useToast } from '@/components/ui';
import { isSafeExternalUrl } from '@/lib/safe-url';
import { cn } from '@/lib/utils';
import {
  ReviewCategorySelect,
  ReviewLanguageMultiSelect,
  ReviewTagInput,
} from './fields';
import { HybridDialog } from './hybrid-dialog';
import { ReviewAnalyticsPanel } from './analytics-panel';
import type {
  ReviewApiError,
  ReviewManagementOptions,
  ReviewPreviewResponse,
  ReviewProduct,
  ReviewProductOverrides,
  ReviewSettingsDraft,
  ReviewSettingsResponse,
  ReviewSettingsSource,
} from './types';

const FIELD_CLASS =
  'border-line bg-field text-ink placeholder:text-ink-faint hover:border-line-strong focus:border-accent-500 focus:ring-accent-500/25';
const MAX_URL = 2048;
const MAX_WELCOME = 500;

type TabKey = 'general' | 'content' | 'analytics';

const TABS: { key: TabKey; label: string }[] = [
  { key: 'general', label: 'General Settings' },
  { key: 'content', label: 'Content & Personalization' },
  { key: 'analytics', label: 'Review Analytics' },
];

const SOURCE_LABELS: Record<ReviewSettingsSource | 'legacy-fallback', string> = {
  legacy: 'Using Product Settings',
  central: 'Central Settings',
  hybrid: 'Hybrid Settings',
  'legacy-fallback': 'Legacy fallback',
};

function isValidGoogleUrl(value: string): boolean {
  if (!value) return true;
  if (value.length > MAX_URL) return false;
  try {
    const url = new URL(value);
    return (
      (url.protocol === 'https:' || url.protocol === 'http:') &&
      !url.username &&
      !url.password
    );
  } catch {
    return false;
  }
}

function sameValue(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

type CleanSettings = ReviewSettingsDraft;

function buildPatch(draft: CleanSettings, snapshot: CleanSettings) {
  const general: Partial<CleanSettings['general']> = {};
  if (draft.general.enabled !== snapshot.general.enabled) general.enabled = draft.general.enabled;
  if (draft.general.googleReviewUrl !== snapshot.general.googleReviewUrl) {
    general.googleReviewUrl = draft.general.googleReviewUrl;
  }
  if (draft.general.welcomeMessage !== snapshot.general.welcomeMessage) {
    general.welcomeMessage = draft.general.welcomeMessage;
  }

  const content: Partial<CleanSettings['content']> = {};
  if (draft.content.category !== snapshot.content.category) content.category = draft.content.category;
  if (!sameValue(draft.content.languages, snapshot.content.languages)) {
    content.languages = draft.content.languages;
  }
  if (draft.content.writingStyle !== snapshot.content.writingStyle) {
    content.writingStyle = draft.content.writingStyle;
  }
  if (draft.content.preferredLength !== snapshot.content.preferredLength) {
    content.preferredLength = draft.content.preferredLength;
  }
  if (draft.content.styleMode !== snapshot.content.styleMode) {
    content.styleMode = draft.content.styleMode;
  }
  if (draft.content.lengthMode !== snapshot.content.lengthMode) {
    content.lengthMode = draft.content.lengthMode;
  }
  for (const key of ['feedbackTopics', 'services', 'employees', 'keywords'] as const) {
    if (!sameValue(draft.content[key], snapshot.content[key])) {
      content[key] = draft.content[key];
    }
  }

  return {
    ...(Object.keys(general).length > 0 ? { general } : {}),
    ...(Object.keys(content).length > 0 ? { content } : {}),
  };
}

function sourceLabel(
  source: ReviewProduct['settingsSource'] | ReviewPreviewResponse['source'],
  instanceType?: 'card' | 'standee'
): string {
  if (instanceType === 'standee' && source === 'legacy') return 'Using Standee Settings';
  return SOURCE_LABELS[source] ?? source;
}

function productTypeLabel(product: ReviewProduct): string {
  if (product.instanceType === 'standee' || product.cardKind === 'standee') return 'Standee';
  if (product.cardKind === 'review') return 'Review card';
  if (product.cardKind === 'profile') return 'Profile card';
  if (product.cardKind === 'social') return 'Social card';
  return product.cardKind || 'Card product';
}

function productEntitlementLabel(product: ReviewProduct): string {
  if (product.productGrantsReview) return 'Included in product';
  if (product.accountReviewEntitled) return 'Included via account';
  return 'Not entitled';
}

function formatUpdatedAt(value?: string): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

function errorMessage(data: ReviewApiError | null, fallback: string): string {
  return data?.error || fallback;
}

export function ReviewManagementClient() {
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState<TabKey>('general');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const [draft, setDraft] = useState<CleanSettings | null>(null);
  const [snapshot, setSnapshot] = useState<CleanSettings | null>(null);
  const [saved, setSaved] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<string | undefined>();
  const [revision, setRevision] = useState('0');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);

  const [options, setOptions] = useState<ReviewManagementOptions | null>(null);
  const [optionsLoading, setOptionsLoading] = useState(true);
  const [optionsError, setOptionsError] = useState<string | null>(null);
  const [categoryUnavailable, setCategoryUnavailable] = useState(false);

  const [products, setProducts] = useState<ReviewProduct[]>([]);
  const [productsLoading, setProductsLoading] = useState(true);
  const [productsError, setProductsError] = useState<string | null>(null);

  const [preview, setPreview] = useState<ReviewPreviewResponse | null>(null);
  const [previewProductId, setPreviewProductId] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const previewRef = useRef<HTMLDivElement>(null);

  const [connectionBusyId, setConnectionBusyId] = useState<string | null>(null);
  const [hybridTarget, setHybridTarget] = useState<ReviewProduct | null>(null);

  const dirty = Boolean(draft && snapshot && !sameValue(draft, snapshot));
  const googleUrlError =
    draft && !isValidGoogleUrl(draft.general.googleReviewUrl.trim())
      ? 'Enter an empty or valid http(s) URL without credentials.'
      : null;
  const languageError =
    draft?.general.enabled && draft.content.languages.length === 0
      ? 'Add at least one language before enabling Review Assistant.'
      : null;

  async function requestOptions(category: string): Promise<{
    options: ReviewManagementOptions;
    categoryUnavailable: boolean;
  }> {
    const base = '/api/review-management/options';
    const url = category
      ? `${base}?category=${encodeURIComponent(category)}`
      : base;
    let res = await fetch(url);
    let unavailable = false;

    if (res.status === 400 && category) {
      // A saved inactive category must not erase the option catalog. Fall back
      // to the all-category option set and mark the saved value as unavailable.
      res = await fetch(base);
      unavailable = true;
    }

    const data = (await res.json().catch(() => null)) as ReviewManagementOptions | ReviewApiError | null;
    if (!res.ok || !data || !Array.isArray((data as ReviewManagementOptions).categories)) {
      throw new Error(errorMessage(data as ReviewApiError | null, 'Could not load Review Library options.'));
    }
    return { options: data as ReviewManagementOptions, categoryUnavailable: unavailable };
  }

  async function loadPreview(assignmentId: string) {
    setPreviewProductId(assignmentId);
    setPreview(null);
    setPreviewError(null);
    setPreviewLoading(true);
    try {
      const res = await fetch(
        `/api/review-management/preview?assignmentId=${encodeURIComponent(assignmentId)}`
      );
      const data = (await res.json().catch(() => null)) as ReviewPreviewResponse | ReviewApiError | null;
      if (!res.ok || !data || !('settings' in data)) {
        throw new Error(errorMessage(data as ReviewApiError | null, 'Preview is not available for this product.'));
      }
      setPreview(data as ReviewPreviewResponse);
    } catch (error) {
      setPreviewError(error instanceof Error ? error.message : 'Preview is not available for this product.');
    } finally {
      setPreviewLoading(false);
    }
  }

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setLoadError(null);
      setProductsLoading(true);
      setProductsError(null);
      setOptionsLoading(true);
      setOptionsError(null);
      setCategoryUnavailable(false);

      try {
        const settingsRes = await fetch('/api/review-management');
        const settingsData = (await settingsRes.json().catch(() => null)) as
          | ReviewSettingsResponse
          | ReviewApiError
          | null;
        if (!settingsRes.ok || !settingsData || !('settings' in settingsData)) {
          throw new Error(
            errorMessage(settingsData as ReviewApiError | null, 'Could not load Review Management settings.')
          );
        }
        if (cancelled) return;

        const settings = (settingsData as ReviewSettingsResponse).settings;
        setDraft(settings);
        setSnapshot(settings);
        setSaved((settingsData as ReviewSettingsResponse).saved);
        setUpdatedAt((settingsData as ReviewSettingsResponse).updatedAt);
        setRevision((settingsData as ReviewSettingsResponse).revision ?? '0');

        const productsPromise = fetch('/api/review-management/products')
          .then(async (res) => {
            const data = (await res.json().catch(() => null)) as
              | { products?: ReviewProduct[] }
              | ReviewApiError
              | null;
            if (!res.ok || !data || !Array.isArray((data as { products?: ReviewProduct[] }).products)) {
              throw new Error(errorMessage(data as ReviewApiError | null, 'Could not load connected products.'));
            }
            return (data as { products: ReviewProduct[] }).products;
          })
          .then((rows) => {
            if (!cancelled) {
              setProducts(rows);
              setProductsLoading(false);
            }
          })
          .catch((error: unknown) => {
            if (!cancelled) {
              setProductsError(error instanceof Error ? error.message : 'Could not load connected products.');
              setProductsLoading(false);
            }
          });
        void productsPromise;

        try {
          const optionResult = await requestOptions(settings.content.category);
          if (!cancelled) {
            setOptions(optionResult.options);
            setCategoryUnavailable(optionResult.categoryUnavailable);
          }
        } catch (error) {
          if (!cancelled) {
            setOptionsError(error instanceof Error ? error.message : 'Could not load Review Library options.');
          }
        } finally {
          if (!cancelled) setOptionsLoading(false);
        }

      } catch (error) {
        if (!cancelled) {
          setLoadError(error instanceof Error ? error.message : 'Could not load Review Management.');
          setProductsLoading(false);
          setOptionsLoading(false);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  useEffect(() => {
    if (!dirty) return;
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);

  function updateGeneral(patch: Partial<CleanSettings['general']>) {
    setDraft((prev) => (prev ? { ...prev, general: { ...prev.general, ...patch } } : prev));
    setSaveError(null);
  }

  function updateContent(patch: Partial<CleanSettings['content']>) {
    setDraft((prev) => (prev ? { ...prev, content: { ...prev.content, ...patch } } : prev));
    setSaveError(null);
  }

  async function changeCategory(category: string) {
    updateContent({ category });
    setOptionsLoading(true);
    setOptionsError(null);
    try {
      const result = await requestOptions(category);
      setOptions(result.options);
      setCategoryUnavailable(result.categoryUnavailable);
    } catch (error) {
      setOptionsError(error instanceof Error ? error.message : 'Could not load category options.');
    } finally {
      setOptionsLoading(false);
    }
  }

  async function saveChanges() {
    if (!draft || !snapshot || saving || !dirty) return;
    if (googleUrlError || languageError) {
      setSaveError(googleUrlError ?? languageError);
      return;
    }
    const patch = buildPatch(draft, snapshot);
    if (!patch.general && !patch.content) return;

    setSaving(true);
    setSaveError(null);
    try {
      const res = await fetch('/api/review-management', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...patch, revision }),
      });
      const data = (await res.json().catch(() => null)) as ReviewSettingsResponse | ReviewApiError | null;
      if (!res.ok || !data || !('settings' in data)) {
        if (res.status === 401) throw new Error('Your session has expired. Please sign in again.');
        if (res.status === 403) throw new Error('Review Management is not included in your current products.');
        if (res.status === 409) {
          setConflict(true);
          throw new Error(errorMessage(data as ReviewApiError | null, 'Review settings changed elsewhere. Reload to review the latest values.'));
        }
        throw new Error(errorMessage(data as ReviewApiError | null, 'Could not save Review Management settings.'));
      }
      const next = (data as ReviewSettingsResponse).settings;
      setDraft(next);
      setSnapshot(next);
      setSaved(true);
      setUpdatedAt((data as ReviewSettingsResponse).updatedAt);
      setRevision((data as ReviewSettingsResponse).revision ?? revision);
      setConflict(false);
      toast({ title: 'Settings saved', description: 'Your review preferences have been updated.', variant: 'success' });
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : 'Could not save Review Management settings.');
    } finally {
      setSaving(false);
    }
  }

  async function reloadSettings() {
    if (dirty && !window.confirm('Reload the latest saved settings? Unsaved changes will be discarded.')) {
      return;
    }
    try {
      const res = await fetch('/api/review-management');
      const data = (await res.json().catch(() => null)) as ReviewSettingsResponse | ReviewApiError | null;
      if (!res.ok || !data || !('settings' in data)) {
        throw new Error(errorMessage(data as ReviewApiError | null, 'Could not reload Review Management settings.'));
      }
      setDraft(data.settings);
      setSnapshot(data.settings);
      setSaved(data.saved);
      setUpdatedAt(data.updatedAt);
      setRevision(data.revision ?? '0');
      setConflict(false);
      setSaveError(null);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : 'Could not reload Review Management settings.');
    }
  }

  async function refreshProducts() {
    setProductsLoading(true);
    setProductsError(null);
    try {
      const res = await fetch('/api/review-management/products');
      const data = (await res.json().catch(() => null)) as
        | { products?: ReviewProduct[] }
        | ReviewApiError
        | null;
      if (!res.ok || !data || !Array.isArray((data as { products?: ReviewProduct[] }).products)) {
        throw new Error(errorMessage(data as ReviewApiError | null, 'Could not load connected products.'));
      }
      const nextProducts = (data as { products: ReviewProduct[] }).products;
      setProducts(nextProducts);
      setHybridTarget((current) =>
        current
          ? nextProducts.find((product) => product.assignmentId === current.assignmentId) ?? current
          : current
      );
    } catch (error) {
      setProductsError(error instanceof Error ? error.message : 'Could not load connected products.');
    } finally {
      setProductsLoading(false);
    }
  }

  async function connectProduct(
    product: ReviewProduct,
    source: ReviewSettingsSource,
    overrides?: ReviewProductOverrides
  ): Promise<{ ok: boolean; message?: string }> {
    setConnectionBusyId(product.assignmentId);
    try {
      const res = await fetch(
        `/api/review-management/products/${encodeURIComponent(product.assignmentId)}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            source,
            ...(overrides ? { overrides } : {}),
            revision: product.settingsRevision,
          }),
        }
      );
      const data = (await res.json().catch(() => null)) as
        | { success?: boolean; source?: string; revision?: number }
        | ReviewApiError
        | null;
      if (!res.ok) {
        if (res.status === 409) {
          await refreshProducts();
        }
        throw new Error(errorMessage(data as ReviewApiError | null, 'Could not update the product settings source.'));
      }
      await refreshProducts();
      if (previewProductId === product.assignmentId) {
        void loadPreview(product.assignmentId);
      }
      toast({
        title: 'Product connection updated',
        description:
          source === 'legacy'
            ? 'This product now uses its own product settings again.'
            : source === 'central'
              ? 'This product now uses Central Settings.'
              : 'This product now uses Central Settings with product overrides.',
        variant: 'success',
      });
      return { ok: true };
    } catch (error) {
      return {
        ok: false,
        message:
          error instanceof Error
            ? error.message
            : 'Could not update the product settings source.',
      };
    } finally {
      setConnectionBusyId(null);
    }
  }

  function requestSourceChange(product: ReviewProduct, source: ReviewSettingsSource) {
    if (source === product.settingsSource || connectionBusyId === product.assignmentId) return;
    if (source !== 'legacy' && !saved) {
      toast({
        title: 'Save central settings first',
        description: 'Add and save your Review Management settings before connecting a product to them.',
        variant: 'warning',
      });
      return;
    }
    if (source === 'hybrid') {
      setHybridTarget(product);
      return;
    }
    const message =
      source === 'legacy'
        ? `Return ${product.productTitle} to its own product settings? Central settings and the product's legacy settings remain preserved.`
        : `Use Central Settings for ${product.productTitle}? The product's existing legacy settings remain preserved for rollback, and nothing is published automatically.`;
    if (!window.confirm(message)) return;
    void connectProduct(product, source).then((result) => {
      if (!result.ok) {
        toast({
          title: 'Connection failed',
          description: result.message ?? 'Could not update the product settings source.',
          variant: 'error',
        });
      }
    });
  }

  function loadHybridOptions(category: string): Promise<ReviewManagementOptions> {
    return requestOptions(category).then((result) => result.options);
  }

  function previewSettings() {
    setActiveTab('general');
    const candidate = products.find((product) => product.previewAvailable);
    if (!candidate) {
      toast({
        title: 'No eligible product to preview',
        description: 'Connect a review-enabled product after product connections are available.',
        variant: 'info',
      });
      previewRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }
    if (previewProductId !== candidate.assignmentId || !preview) {
      void loadPreview(candidate.assignmentId).then(() => {
        previewRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    } else {
      previewRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  if (loading) {
    return (
      <div className="mx-auto max-w-5xl space-y-6" aria-busy="true" aria-label="Loading Review Management">
        <div className="h-20 animate-pulse rounded-xl bg-surface" />
        <div className="h-14 animate-pulse rounded-xl bg-surface" />
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="h-72 animate-pulse rounded-xl bg-surface" />
          <div className="h-72 animate-pulse rounded-xl bg-surface" />
        </div>
      </div>
    );
  }

  if (loadError || !draft || !snapshot) {
    return (
      <div className="mx-auto max-w-3xl">
        <Card className="border-line-subtle bg-surface p-8 shadow-e1">
          <EmptyState
            icon={AlertCircle}
            title="Couldn’t load Review Management"
            description={loadError ?? 'Review settings are temporarily unavailable.'}
            action={{ label: 'Try again', onClick: () => setReloadKey((value) => value + 1) }}
            variant="danger"
          />
        </Card>
      </div>
    );
  }

  const activeCategories = options?.categories ?? [];
  const savedCategory = snapshot.content.category;
  const savedCategoryIsInactive = Boolean(savedCategory) && !activeCategories.some((c) => c.key === savedCategory);
  const selectedLanguages = draft.content.languages;
  const supportedLanguages = options?.languages ?? [];
  const unsupportedSelected = selectedLanguages.filter((language) => !supportedLanguages.includes(language));
  const suggestedTopics = options?.suggestedFeedbackTopics.map((topic) => topic.label) ?? [];
  const selectedTopicLabels = draft.content.feedbackTopics;
  const categoryChanged =
    draft.content.category !== snapshot.content.category;
  const languagesIncompatible = Boolean(
    categoryChanged && unsupportedSelected.length > 0
  );
  const updatedLabel = formatUpdatedAt(updatedAt);

  return (
    <div className="mx-auto max-w-5xl space-y-6 animate-fade-in">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-accent-600/10 text-accent-400 ring-1 ring-accent-600/20">
              <MessageSquareText className="h-4 w-4" aria-hidden="true" />
            </span>
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-ink">Review Management</h1>
              <p className="mt-0.5 max-w-2xl text-sm text-ink-mute">
                Manage your review preferences, personalize suggestions, and view connected review-enabled products.
              </p>
            </div>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-ink-faint">
            <Badge variant={saved ? 'success' : 'info'}>
              {saved ? 'Saved' : 'Using system defaults'}
            </Badge>
            {updatedLabel && <span>Last saved {updatedLabel}</span>}
            {dirty && (
              <span className="inline-flex items-center gap-1.5 font-medium text-warn" role="status" aria-live="polite">
                <span className="h-1.5 w-1.5 rounded-full bg-warn" aria-hidden="true" />
                Unsaved changes
              </span>
            )}
          </div>
        </div>

        <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center">
          <Button
            type="button"
            variant="outline"
            onClick={previewSettings}
            className="w-full sm:w-auto"
          >
            <Eye className="h-4 w-4" aria-hidden="true" />
            Preview Settings
          </Button>
          <Button
            type="button"
            onClick={() => void saveChanges()}
            disabled={!dirty || saving || Boolean(googleUrlError) || Boolean(languageError)}
            isLoading={saving}
            className="w-full sm:w-auto"
          >
            <Save className="h-4 w-4" aria-hidden="true" />
            Save Changes
          </Button>
        </div>
      </div>

      {saveError && (
        <div className="flex flex-col gap-2 rounded-xl bg-bad/10 px-3.5 py-3 text-sm text-red-300 ring-1 ring-bad/25" role="alert">
          <div className="flex items-start gap-2">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <p className="leading-relaxed">{saveError}</p>
          </div>
          {conflict && (
            <div className="pl-6">
              <Button type="button" variant="outline" size="sm" onClick={() => void reloadSettings()}>
                Reload latest values
              </Button>
            </div>
          )}
        </div>
      )}

      <div role="tablist" aria-label="Review Management sections" className="flex gap-1 border-b border-line-subtle">
        {TABS.map((tab) => {
          const active = activeTab === tab.key;
          return (
            <button
              key={tab.key}
              type="button"
              role="tab"
              id={`review-tab-${tab.key}`}
              aria-selected={active}
              aria-controls={`review-panel-${tab.key}`}
              onClick={() => setActiveTab(tab.key)}
              className={cn(
                '-mb-px flex-1 border-b-2 px-2 py-3 text-center text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 sm:flex-none sm:px-4 sm:text-sm',
                active
                  ? 'border-accent-500 text-ink'
                  : 'border-transparent text-ink-mute hover:text-ink'
              )}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      {activeTab === 'general' ? (
        <div id="review-panel-general" role="tabpanel" aria-labelledby="review-tab-general" className="space-y-5">
          <Card className="border-line-subtle bg-surface p-5 shadow-e1 sm:p-6">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h2 className="flex items-center gap-2 text-base font-semibold text-ink">
                  <Sparkles className="h-4 w-4 text-accent-400" aria-hidden="true" />
                  Review Assistant status
                </h2>
                <p className="mt-1 max-w-2xl text-sm leading-relaxed text-ink-mute">
                  These settings will apply to products you explicitly connect to centralized Review Management.
                </p>
                {!saved && (
                  <p className="mt-2 flex items-start gap-1.5 text-xs leading-relaxed text-ink-faint">
                    <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                    No centralized settings have been saved yet. Existing products keep using their own settings.
                  </p>
                )}
              </div>
              <div className="flex shrink-0 items-center gap-3 sm:pt-1">
                <span className="text-sm font-medium text-ink">
                  {draft.general.enabled ? 'Enabled' : 'Disabled'}
                </span>
                <Switch
                  checked={draft.general.enabled}
                  onChange={(enabled) => updateGeneral({ enabled })}
                  aria-label="Enable Review Assistant for centralized settings"
                />
              </div>
            </div>
            {languageError && (
              <p className="mt-3 flex items-start gap-1.5 text-xs text-warn" role="alert">
                <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                {languageError}
              </p>
            )}
          </Card>

          <div className="grid gap-5 lg:grid-cols-2">
            <Card className="border-line-subtle bg-surface p-5 shadow-e1 sm:p-6">
              <h3 className="flex items-center gap-2 text-base font-semibold text-ink">
                <Globe2 className="h-4 w-4 text-accent-400" aria-hidden="true" />
                Google Review destination
              </h3>
              <p className="mt-1 text-sm leading-relaxed text-ink-mute">
                Where customers should continue after copying a review. Existing product destinations are not changed.
              </p>
              <div className="mt-4">
                <Input
                  id="review-google-url"
                  label="Google Review URL"
                  type="url"
                  inputMode="url"
                  autoComplete="off"
                  spellCheck={false}
                  maxLength={MAX_URL}
                  placeholder="https://g.page/r/…/review"
                  value={draft.general.googleReviewUrl}
                  onChange={(event) => updateGeneral({ googleReviewUrl: event.target.value })}
                  error={googleUrlError ?? undefined}
                  className={FIELD_CLASS}
                />
                <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-ink-faint">
                  <span>Leave empty if you have not configured a destination yet.</span>
                  {!googleUrlError && isSafeExternalUrl(draft.general.googleReviewUrl.trim()) && (
                    <a
                      href={draft.general.googleReviewUrl.trim()}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 font-medium text-accent-400 hover:text-accent-300"
                    >
                      Open destination
                      <ExternalLink className="h-3 w-3" aria-hidden="true" />
                    </a>
                  )}
                </div>
              </div>
            </Card>

            <Card className="border-line-subtle bg-surface p-5 shadow-e1 sm:p-6">
              <h3 className="flex items-center gap-2 text-base font-semibold text-ink">
                <MessageSquareText className="h-4 w-4 text-accent-400" aria-hidden="true" />
                Welcome message
              </h3>
              <p className="mt-1 text-sm leading-relaxed text-ink-mute">
                A short, warm introduction shown above the review experience.
              </p>
              <div className="mt-4">
                <textarea
                  id="review-welcome-message"
                  rows={4}
                  maxLength={MAX_WELCOME}
                  value={draft.general.welcomeMessage}
                  onChange={(event) => updateGeneral({ welcomeMessage: event.target.value })}
                  placeholder="Thank you for choosing our business. We’d love to hear about your experience."
                  className={cn(
                    'w-full resize-y rounded-lg border px-3 py-2.5 text-sm transition-colors focus:outline-none focus:ring-2 focus:ring-accent-500/25',
                    FIELD_CLASS
                  )}
                />
                <div className="mt-1 flex items-center justify-between text-xs text-ink-faint">
                  <span>Optional.</span>
                  <span>{draft.general.welcomeMessage.length}/{MAX_WELCOME}</span>
                </div>
              </div>
            </Card>
          </div>

          <Card className="border-line-subtle bg-surface p-5 shadow-e1 sm:p-6">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h3 className="flex items-center gap-2 text-base font-semibold text-ink">
                  <Star className="h-4 w-4 text-accent-400" aria-hidden="true" />
                  Connected review products
                </h3>
                <p className="mt-1 text-sm leading-relaxed text-ink-mute">
                  Products currently eligible to use review management. Choose a settings source for each product. Nothing is published or activated automatically.
                </p>
                {!saved && (
                  <p className="mt-1 text-xs leading-relaxed text-ink-faint">
                    Save your central settings first to enable Central or Hybrid connections.
                  </p>
                )}
              </div>
              {!productsLoading && !productsError && (
                <Badge variant="info">{products.length} eligible</Badge>
              )}
            </div>

            <div className="mt-4">
              {productsLoading ? (
                <div className="space-y-2" role="status" aria-label="Loading connected products">
                  <div className="h-20 animate-pulse rounded-xl bg-field" />
                  <div className="h-20 animate-pulse rounded-xl bg-field" />
                </div>
              ) : productsError ? (
                <div className="flex items-start gap-2 rounded-lg bg-bad/10 p-3 text-sm text-red-300 ring-1 ring-bad/25" role="alert">
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                  {productsError}
                </div>
              ) : products.length === 0 ? (
                <div className="rounded-xl border border-dashed border-line-subtle bg-field/40 p-5 text-center">
                  <p className="text-sm font-medium text-ink">No eligible review products yet</p>
                  <p className="mx-auto mt-1 max-w-md text-xs leading-relaxed text-ink-faint">
                    A review-enabled card must be assigned to your business before it can appear here. Your existing product settings are unchanged.
                  </p>
                </div>
              ) : (
                <ul className="space-y-2.5" role="list">
                  {products.map((product) => (
                    <li
                      key={product.assignmentId}
                      className="rounded-xl border border-line-subtle bg-field/30 p-3.5 transition-colors hover:border-line-strong sm:p-4"
                    >
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="truncate text-sm font-semibold text-ink">{product.productTitle}</p>
                            <Badge variant="default">{productTypeLabel(product)}</Badge>
                            <Badge variant={product.settingsSource === 'legacy' ? 'default' : 'info'}>
                              {sourceLabel(product.settingsSource, product.instanceType)}
                            </Badge>
                          </div>
                          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-ink-faint">
                            <span className="inline-flex items-center gap-1">
                              <span className={cn('h-1.5 w-1.5 rounded-full', product.reviewAssistantEnabled ? 'bg-ok' : 'bg-ink-faint')} aria-hidden="true" />
                              {product.reviewAssistantEnabled ? 'Review Assistant enabled' : 'Review Assistant disabled'}
                            </span>
                            <span className="inline-flex items-center gap-1">
                              <span className={cn('h-1.5 w-1.5 rounded-full', product.googleDestinationConfigured ? 'bg-ok' : 'bg-warn')} aria-hidden="true" />
                              {product.googleDestinationConfigured ? 'Google destination configured' : 'Google destination missing'}
                            </span>
                            <span className="inline-flex items-center gap-1">
                              <Lock className="h-3 w-3" aria-hidden="true" />
                              {productEntitlementLabel(product)}
                            </span>
                          </div>
                          <p className="mt-2 text-[11px] leading-relaxed text-ink-faint">
                            {product.previewAvailable
                              ? 'Preview is available for this product.'
                              : 'Preview is not available for this product yet.'}
                          </p>
                          {product.instanceType === 'standee' && (
                            <p className="mt-1 text-[11px] leading-relaxed text-ink-faint">
                              {product.hostingEnabled
                                ? 'Uses the Standee’s own Google destination. Central content never replaces it unless you explicitly override the URL.'
                                : 'Standee public review hosting is disabled by its feature gate. Settings can still be prepared here.'}
                            </p>
                          )}
                        </div>
                        <div className="flex w-full shrink-0 flex-col gap-2 sm:w-56">
                          <Select
                            id={`review-source-${product.assignmentId}`}
                            label="Settings source"
                            aria-label={`Settings source for ${product.productTitle}`}
                            value={product.settingsSource}
                            disabled={connectionBusyId === product.assignmentId}
                            onChange={(value) => requestSourceChange(product, value as ReviewSettingsSource)}
                            options={[
                              {
                                value: 'legacy',
                                label:
                                  product.instanceType === 'standee'
                                    ? 'Use Standee Settings'
                                    : 'Use Product Settings',
                              },
                              { value: 'central', label: 'Use Central Settings' },
                              { value: 'hybrid', label: 'Use Central + Product Overrides' },
                            ]}
                          />
                          {product.settingsSource === 'hybrid' && product.previewAvailable && (
                            <Button
                              type="button"
                              variant="outline"
                              className="w-full"
                              disabled={connectionBusyId === product.assignmentId}
                              onClick={() => setHybridTarget(product)}
                            >
                              <Settings2 className="h-3.5 w-3.5" aria-hidden="true" />
                              Edit overrides
                            </Button>
                          )}
                          {product.previewAvailable ? (
                            <Button
                              type="button"
                              variant="outline"
                              className="w-full"
                              onClick={() => void loadPreview(product.assignmentId)}
                            >
                              <Eye className="h-3.5 w-3.5" aria-hidden="true" />
                              Preview
                            </Button>
                          ) : (
                            <span className="text-xs text-ink-faint">Preview unavailable</span>
                          )}
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </Card>

          <div ref={previewRef}>
            <Card className="border-line-subtle bg-surface p-5 shadow-e1 sm:p-6">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <h3 className="flex items-center gap-2 text-base font-semibold text-ink">
                    <Eye className="h-4 w-4 text-accent-400" aria-hidden="true" />
                    Current Product Settings Preview
                  </h3>
                  <p className="mt-1 text-sm leading-relaxed text-ink-mute">
                    This shows a product’s currently active settings, not unsaved central changes.
                  </p>
                </div>
                {preview?.previewUrl &&
                  preview.previewAvailable &&
                  preview.hostingEnabled && (
                  <Link
                    href={preview.previewUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-xs font-medium text-accent-400 hover:text-accent-300"
                  >
                    Open review page
                    <ExternalLink className="h-3 w-3" aria-hidden="true" />
                  </Link>
                )}
              </div>

              <div className="mt-4">
                {previewLoading ? (
                  <div className="flex items-center gap-2 rounded-xl border border-line-subtle bg-field/40 p-4 text-sm text-ink-mute" role="status">
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                    Loading current product settings…
                  </div>
                ) : previewError ? (
                  <div className="flex items-start gap-2 rounded-lg bg-bad/10 p-3 text-sm text-red-300 ring-1 ring-bad/25" role="alert">
                    <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                    {previewError}
                  </div>
                ) : preview ? (
                  <div className="space-y-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-semibold text-ink">{preview.productTitle}</p>
                      <Badge variant={preview.source === 'legacy' ? 'default' : 'info'}>{sourceLabel(preview.source, preview.instanceType)}</Badge>
                      <Badge variant={preview.published ? 'success' : 'warning'}>
                        {preview.published ? 'Review Assistant enabled' : 'Review Assistant disabled'}
                      </Badge>
                      <Badge variant={preview.settings.googleReviewUrl ? 'success' : 'warning'}>
                        {preview.settings.googleReviewUrl ? 'Google destination configured' : 'Google destination missing'}
                      </Badge>
                    </div>
                    <dl className="grid gap-3 sm:grid-cols-2">
                      <PreviewRow label="Product type" value={preview.instanceType === 'standee' ? 'Standee' : preview.cardKind === 'review' ? 'Review card' : preview.cardKind === 'profile' ? 'Profile card' : preview.cardKind || 'Card product'} />
                      <PreviewRow label="Category" value={preview.settings.category || 'Not set'} />
                      <PreviewRow label="Languages" value={preview.settings.languages.length > 0 ? preview.settings.languages.join(', ') : 'None'} />
                      <PreviewRow label="Writing style" value={preview.settings.writingStyle} />
                      <PreviewRow label="Review length" value={preview.settings.preferredLength} />
                      <PreviewRow label="Variation" value={`Style: ${preview.settings.styleMode}; length: ${preview.settings.lengthMode}`} />
                      <PreviewRow
                        label="Public hosting"
                        value={
                          preview.instanceType === 'standee'
                            ? preview.hostingEnabled
                              ? 'Standee host active'
                              : 'Standee host disabled by gate'
                            : 'Card review page'
                        }
                      />
                    </dl>
                    <div>
                      <p className="text-xs font-medium uppercase tracking-wide text-ink-faint">Welcome message</p>
                      <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-ink-mute">
                        {preview.settings.welcomeMessage || 'No welcome message configured.'}
                      </p>
                    </div>
                  </div>
                ) : (
                  <div className="rounded-xl border border-dashed border-line-subtle bg-field/40 p-5 text-center">
                    <p className="text-sm font-medium text-ink">Choose an eligible product to preview</p>
                    <p className="mx-auto mt-1 max-w-md text-xs leading-relaxed text-ink-faint">
                      Preview shows the settings currently active for that product. It does not generate a review or change any product.
                    </p>
                  </div>
                )}
              </div>
            </Card>
          </div>
        </div>
      ) : activeTab === 'content' ? (
        <div id="review-panel-content" role="tabpanel" aria-labelledby="review-tab-content" className="space-y-5">
          <Card className="border-line-subtle bg-surface p-5 shadow-e1 sm:p-6">
            <h2 className="flex items-center gap-2 text-base font-semibold text-ink">
              <Sparkles className="h-4 w-4 text-accent-400" aria-hidden="true" />
              Category and language
            </h2>
            <p className="mt-1 max-w-2xl text-sm leading-relaxed text-ink-mute">
              Choose the category and languages that best match your business. The first language is the default.
            </p>

            <div className="mt-4 grid gap-5 lg:grid-cols-2">
              <div>
                <ReviewCategorySelect
                  id="review-category"
                  value={draft.content.category}
                  categories={activeCategories}
                  savedInactiveLabel={
                    savedCategoryIsInactive ? 'Saved category (unavailable)' : undefined
                  }
                  loading={optionsLoading}
                  onChange={(category) => void changeCategory(category)}
                />
                {categoryUnavailable && savedCategory && (
                  <p className="mt-1.5 text-xs leading-relaxed text-warn">
                    The saved category “{savedCategory}” is not active in the Review Library. It is kept until you choose another category.
                  </p>
                )}
                {!optionsLoading && !optionsError && activeCategories.length === 0 && (
                  <p className="mt-2 text-xs leading-relaxed text-ink-faint">
                    No active categories are available. Ask a platform administrator to add one to the Review Library.
                  </p>
                )}
              </div>

              <div>
                <ReviewLanguageMultiSelect
                  id="review-languages"
                  value={selectedLanguages}
                  options={supportedLanguages}
                  loading={optionsLoading}
                  onChange={(languages) => updateContent({ languages })}
                />
                {!optionsLoading && supportedLanguages.length === 0 && (
                  <p className="mt-1.5 text-xs leading-relaxed text-ink-faint">
                    No supported languages are available for this category yet.
                  </p>
                )}
                {languagesIncompatible && (
                  <p className="mt-1.5 text-xs leading-relaxed text-warn" role="alert">
                    The category change makes some saved languages unsupported. Remove them explicitly before saving, or choose a category that supports them.
                  </p>
                )}
              </div>
            </div>

            {optionsError && (
              <div className="mt-4 flex items-start gap-2 rounded-lg bg-bad/10 p-3 text-sm text-red-300 ring-1 ring-bad/25" role="alert">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                {optionsError}
              </div>
            )}
          </Card>

          <div className="grid gap-5 lg:grid-cols-2">
            <Card className="border-line-subtle bg-surface p-5 shadow-e1 sm:p-6">
              <h2 className="flex items-center gap-2 text-base font-semibold text-ink">
                <Sparkles className="h-4 w-4 text-accent-400" aria-hidden="true" />
                Writing style
              </h2>
              <p className="mt-1 text-sm leading-relaxed text-ink-mute">
                Choose the tone used when a review is drafted from the customer’s own words.
              </p>
              <div className="mt-4 space-y-4">
                <Select
                  id="review-writing-style"
                  label="Style"
                  value={draft.content.writingStyle}
                  onChange={(value) => updateContent({ writingStyle: value as CleanSettings['content']['writingStyle'] })}
                  options={[
                    { value: 'friendly', label: 'Friendly' },
                    { value: 'professional', label: 'Professional' },
                    { value: 'casual', label: 'Casual' },
                    { value: 'simple', label: 'Simple' },
                  ]}
                />
                <div>
                  <p className="dark-label">Style mode</p>
                  <SegmentedControl
                    aria-label="Writing style mode"
                    value={draft.content.styleMode}
                    onChange={(value) => updateContent({ styleMode: value as CleanSettings['content']['styleMode'] })}
                    options={[
                      { value: 'fixed', label: 'Fixed' },
                      { value: 'varied', label: 'Varied' },
                    ]}
                  />
                  <p className="mt-1.5 text-xs leading-relaxed text-ink-faint">
                    Varied mode allows different writing styles when supported by the review experience.
                  </p>
                </div>
              </div>
            </Card>

            <Card className="border-line-subtle bg-surface p-5 shadow-e1 sm:p-6">
              <h2 className="flex items-center gap-2 text-base font-semibold text-ink">
                <Star className="h-4 w-4 text-accent-400" aria-hidden="true" />
                Review length
              </h2>
              <p className="mt-1 text-sm leading-relaxed text-ink-mute">
                Choose the preferred length of a drafted review.
              </p>
              <div className="mt-4 space-y-4">
                <Select
                  id="review-length"
                  label="Length"
                  value={draft.content.preferredLength}
                  onChange={(value) => updateContent({ preferredLength: value as CleanSettings['content']['preferredLength'] })}
                  options={[
                    { value: 'short', label: 'Short' },
                    { value: 'medium', label: 'Medium' },
                    { value: 'detailed', label: 'Detailed' },
                  ]}
                />
                <div>
                  <p className="dark-label">Length mode</p>
                  <SegmentedControl
                    aria-label="Review length mode"
                    value={draft.content.lengthMode}
                    onChange={(value) => updateContent({ lengthMode: value as CleanSettings['content']['lengthMode'] })}
                    options={[
                      { value: 'fixed', label: 'Fixed' },
                      { value: 'varied', label: 'Varied' },
                    ]}
                  />
                  <p className="mt-1.5 text-xs leading-relaxed text-ink-faint">
                    Varied mode allows different review lengths when supported by the review experience.
                  </p>
                </div>
              </div>
            </Card>
          </div>

          <Card className="border-line-subtle bg-surface p-5 shadow-e1 sm:p-6">
            <h2 className="flex items-center gap-2 text-base font-semibold text-ink">
              <MessageSquareText className="h-4 w-4 text-accent-400" aria-hidden="true" />
              Feedback topics
            </h2>
            <p className="mt-1 max-w-2xl text-sm leading-relaxed text-ink-mute">
              Suggested topics come from your selected category. You can also add your own. Topic labels are saved as written.
            </p>
            <div className="mt-4">
              <ReviewTagInput
                id="review-topics"
                label="Topics"
                value={selectedTopicLabels}
                onChange={(feedbackTopics) => updateContent({ feedbackTopics })}
                suggestions={suggestedTopics}
                placeholder="e.g. service, wait time, quality…"
                hint="Up to 12 topics. Suggestions update when the category changes."
              />
              {selectedTopicLabels.length > 0 && suggestedTopics.length > 0 && (
                <p className="mt-2 text-[11px] leading-relaxed text-ink-faint">
                  Custom or previously saved topics are kept even if they are not in the current category suggestions.
                </p>
              )}
            </div>
          </Card>

          <div className="grid gap-5 lg:grid-cols-3">
            <Card className="border-line-subtle bg-surface p-5 shadow-e1 sm:p-6">
              <ReviewTagInput
                id="review-services"
                label="Business services"
                value={draft.content.services}
                onChange={(services) => updateContent({ services })}
                suggestions={options?.suggestedServices ?? []}
                placeholder="e.g. Screen repair"
                hint="Add the services your business actually offers."
              />
            </Card>
            <Card className="border-line-subtle bg-surface p-5 shadow-e1 sm:p-6">
              <ReviewTagInput
                id="review-employees"
                label="Employees"
                value={draft.content.employees}
                onChange={(employees) => updateContent({ employees })}
                suggestions={options?.suggestedEmployees ?? []}
                placeholder="e.g. Rahul"
                hint="Only add genuine employee names."
              />
            </Card>
            <Card className="border-line-subtle bg-surface p-5 shadow-e1 sm:p-6">
              <ReviewTagInput
                id="review-keywords"
                label="Keywords"
                value={draft.content.keywords}
                onChange={(keywords) => updateContent({ keywords })}
                suggestions={options?.suggestedKeywords ?? []}
                placeholder="e.g. friendly, reliable"
                hint="Keywords help describe your business but will not be forced into every review."
              />
            </Card>
          </div>
        </div>
      ) : (
        <ReviewAnalyticsPanel />
      )}

      <p className="pb-4 text-center text-[11px] leading-relaxed text-ink-faint">
        Customer feedback always remains editable and under the customer’s control. Review Management personalizes suggestions; it does not publish reviews.
      </p>

      {hybridTarget && (
        <HybridDialog
          key={hybridTarget.assignmentId}
          product={hybridTarget}
          central={snapshot}
          busy={connectionBusyId === hybridTarget.assignmentId}
          onClose={() => setHybridTarget(null)}
          onConnect={async (product, overrides) => {
            const result = await connectProduct(product, 'hybrid', overrides);
            if (result.ok) setHybridTarget(null);
            return result;
          }}
          loadOptions={loadHybridOptions}
        />
      )}
    </div>
  );
}

function PreviewRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-field/50 px-3 py-2.5 ring-1 ring-line-subtle">
      <dt className="text-[10px] font-semibold uppercase tracking-wider text-ink-faint">{label}</dt>
      <dd className="mt-0.5 truncate text-sm text-ink">{value}</dd>
    </div>
  );
}
