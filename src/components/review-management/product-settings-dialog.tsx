'use client';

/**
 * Individual Card review settings editor used by Review Management.
 *
 * This writes the Card's existing legacy `reviewAssistant` fields through the
 * established owner-scoped `/api/cards/[id]` contract. It is only offered when
 * the product's settings source is `legacy`; central/hybrid products use the
 * central settings or the hybrid override dialog instead.
 */

import { useState } from 'react';
import { AlertCircle, Loader2 } from 'lucide-react';
import { Button, Input, Modal, Select, Switch } from '@/components/ui';
import { cn } from '@/lib/utils';
import {
  ReviewCategorySelect,
  ReviewLanguageMultiSelect,
  ReviewTagInput,
} from './fields';
import type {
  ReviewManagementOptions,
  ReviewProduct,
  ReviewProductOverrides,
} from './types';

const FIELD_CLASS =
  'border-line bg-field text-ink placeholder:text-ink-faint hover:border-line-strong focus:border-accent-500 focus:ring-accent-500/25';
const MAX_URL = 2048;
const MAX_WELCOME = 500;

type Draft = Required<Pick<ReviewProductOverrides,
  'enabled' | 'googleReviewUrl' | 'welcomeMessage' | 'category' | 'languages'
  | 'writingStyle' | 'preferredLength' | 'feedbackTopics' | 'services'
  | 'employees' | 'keywords'>>;

function initialDraft(product: ReviewProduct): Draft {
  const legacy = product.legacySettings ?? {};
  return {
    enabled: legacy.enabled ?? product.reviewAssistantEnabled,
    googleReviewUrl: legacy.googleReviewUrl ?? '',
    welcomeMessage: legacy.welcomeMessage ?? '',
    category: legacy.category ?? '',
    languages: legacy.languages ?? [],
    writingStyle: legacy.writingStyle ?? 'friendly',
    preferredLength: legacy.preferredLength ?? 'medium',
    feedbackTopics: legacy.feedbackTopics ?? [],
    services: legacy.services ?? [],
    employees: legacy.employees ?? [],
    keywords: legacy.keywords ?? [],
  };
}

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

export function ProductSettingsDialog({
  product,
  options,
  onClose,
  onSaved,
}: {
  product: ReviewProduct;
  options: ReviewManagementOptions | null;
  onClose: () => void;
  onSaved: () => Promise<void> | void;
}) {
  const [draft, setDraft] = useState<Draft>(() => initialDraft(product));
  const [snapshot] = useState<Draft>(() => initialDraft(product));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dirty = JSON.stringify(draft) !== JSON.stringify(snapshot);

  function update(patch: Partial<Draft>) {
    setDraft((prev) => ({ ...prev, ...patch }));
    setError(null);
  }

  function requestClose() {
    if (saving) return;
    if (dirty && !window.confirm('Discard unsaved review settings changes?')) return;
    onClose();
  }

  async function save() {
    if (saving) return;
    if (!isValidGoogleUrl(draft.googleReviewUrl.trim())) {
      setError('Enter an empty or valid http(s) Google Review URL without credentials.');
      return;
    }
    if (draft.enabled && draft.languages.length === 0) {
      setError('Add at least one language before enabling reviews.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/cards/${encodeURIComponent(product.cardId)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          reviewAssistant: {
            enabled: draft.enabled,
            googleReviewUrl: draft.googleReviewUrl.trim(),
            welcomeMessage: draft.welcomeMessage,
            category: draft.category,
            languages: draft.languages,
            writingStyle: draft.writingStyle,
            preferredLength: draft.preferredLength,
            feedbackTopics: draft.feedbackTopics,
            services: draft.services,
            employees: draft.employees,
            keywords: draft.keywords,
          },
        }),
      });
      const data = (await res.json().catch(() => null)) as { error?: string } | null;
      if (!res.ok) {
        if (res.status === 401) throw new Error('Your session has expired. Please sign in again.');
        if (res.status === 403) throw new Error('Reviews are not included for this product.');
        if (res.status === 409) throw new Error('This card changed elsewhere. Reload and try again.');
        throw new Error(data?.error || 'Could not save these review settings.');
      }
      await onSaved();
      onClose();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Could not save these review settings.');
    } finally {
      setSaving(false);
    }
  }

  const categories = options?.categories ?? [];
  const languages = options?.languages ?? [];

  return (
    <Modal isOpen onClose={requestClose} title={`Review settings — ${product.productTitle}`}>
      <div className="space-y-5">
        <p className="text-sm leading-relaxed text-ink-mute">
          These settings apply only to this Card. Other Cards and Central Settings are not changed.
        </p>

        <div className="flex items-center justify-between gap-4 rounded-lg bg-field/50 px-3 py-2.5 ring-1 ring-line-subtle">
          <div>
            <p className="text-sm font-medium text-ink">Enable reviews</p>
            <p className="text-xs text-ink-mute">Publish the review page for this Card.</p>
          </div>
          <Switch
            checked={draft.enabled}
            onChange={(enabled) => update({ enabled })}
            aria-label="Enable reviews for this Card"
          />
        </div>

        <Input
          id="product-review-google-url"
          label="Google Review URL"
          type="url"
          inputMode="url"
          autoComplete="off"
          spellCheck={false}
          maxLength={MAX_URL}
          placeholder="https://g.page/r/…/review"
          value={draft.googleReviewUrl}
          onChange={(event) => update({ googleReviewUrl: event.target.value })}
          error={!isValidGoogleUrl(draft.googleReviewUrl.trim()) ? 'Enter a valid http(s) URL without credentials.' : undefined}
          className={FIELD_CLASS}
        />

        <div>
          <label htmlFor="product-review-welcome" className="mb-1.5 block text-sm font-medium text-ink-mute">
            Welcome message
          </label>
          <textarea
            id="product-review-welcome"
            rows={3}
            maxLength={MAX_WELCOME}
            value={draft.welcomeMessage}
            onChange={(event) => update({ welcomeMessage: event.target.value })}
            className={cn('w-full resize-y rounded-lg border px-3 py-2.5 text-sm transition-colors focus:outline-none focus:ring-2 focus:ring-accent-500/25', FIELD_CLASS)}
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <ReviewCategorySelect
            id="product-review-category"
            value={draft.category}
            categories={categories}
            onChange={(category) => update({ category })}
          />
          <Select
            id="product-review-style"
            label="Writing style"
            value={draft.writingStyle}
            onChange={(value) => update({ writingStyle: value as Draft['writingStyle'] })}
            options={[
              { value: 'friendly', label: 'Friendly' },
              { value: 'professional', label: 'Professional' },
              { value: 'casual', label: 'Casual' },
              { value: 'simple', label: 'Simple' },
            ]}
          />
          <Select
            id="product-review-length"
            label="Review length"
            value={draft.preferredLength}
            onChange={(value) => update({ preferredLength: value as Draft['preferredLength'] })}
            options={[
              { value: 'short', label: 'Short' },
              { value: 'medium', label: 'Medium' },
              { value: 'detailed', label: 'Detailed' },
            ]}
          />
          <div className="sm:col-span-2">
            <ReviewLanguageMultiSelect
              id="product-review-languages"
              value={draft.languages}
              options={languages}
              onChange={(values) => update({ languages: values })}
            />
          </div>
        </div>

        <ReviewTagInput
          id="product-review-topics"
          label="Feedback topics"
          value={draft.feedbackTopics}
          onChange={(feedbackTopics) => update({ feedbackTopics })}
          suggestions={options?.suggestedFeedbackTopics.map((topic) => topic.label) ?? []}
          placeholder="e.g. service, quality…"
        />

        <div className="grid gap-4 sm:grid-cols-3">
          <ReviewTagInput id="product-review-services" label="Services" value={draft.services} onChange={(services) => update({ services })} suggestions={options?.suggestedServices ?? []} />
          <ReviewTagInput id="product-review-employees" label="Employees" value={draft.employees} onChange={(employees) => update({ employees })} suggestions={options?.suggestedEmployees ?? []} />
          <ReviewTagInput id="product-review-keywords" label="Keywords" value={draft.keywords} onChange={(keywords) => update({ keywords })} suggestions={options?.suggestedKeywords ?? []} />
        </div>

        {error && (
          <div className="flex items-start gap-2 rounded-lg bg-bad/10 p-3 text-sm text-red-300 ring-1 ring-bad/25" role="alert">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            {error}
          </div>
        )}

        <div className="flex justify-end gap-2 border-t border-line-subtle pt-4">
          <Button type="button" variant="outline" onClick={requestClose} disabled={saving}>
            Cancel
          </Button>
          <Button type="button" onClick={() => void save()} disabled={!dirty || saving} isLoading={saving}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
            Save Changes
          </Button>
        </div>
      </div>
    </Modal>
  );
}
