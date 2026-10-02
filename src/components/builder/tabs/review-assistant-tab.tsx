'use client';

/**
 * Review Assistant tab — per-card AI review-writing configuration.
 *
 * Writes draft.reviewAssistant.*. The QR block encodes the public
 * /review/[alias] page so the business can print/scan access directly.
 */

import { useEffect, useState } from 'react';
import type { ChangeEvent, KeyboardEvent } from 'react';
import { ExternalLink, Loader2, Lock, Plus, Sparkles, X } from 'lucide-react';
import { Button, Input, Select, SegmentedControl, Switch } from '@/components/ui';
import { generateQRDataURL } from '@/utils/qr';
import { useBuilder } from '../context';
import { cn } from '@/lib/utils';
import type { IReviewAssistantConfig, ReviewWritingStyle } from '@/types';

interface CategoryOption {
  key: string;
  name: string;
}

const darkInput =
  'border-line bg-field text-ink placeholder:text-ink-faint focus:border-accent-500 focus:ring-accent-500/25 hover:border-line-strong';

const WRITING_STYLE_OPTIONS: { value: ReviewWritingStyle; label: string }[] = [
  { value: 'friendly', label: 'Friendly' },
  { value: 'professional', label: 'Professional' },
  { value: 'casual', label: 'Casual' },
  { value: 'simple', label: 'Simple' },
];

const MAX_TAGS = 12;

interface TagInputProps {
  id: string;
  label: string;
  hint?: string;
  tags: string[];
  placeholder?: string;
  onChange: (tags: string[]) => void;
}

/** Comma/Enter-separated chip input — small, local-state only. */
function TagInput({ id, label, hint, tags, placeholder, onChange }: TagInputProps) {
  const [input, setInput] = useState('');

  const add = () => {
    const value = input.trim().slice(0, 60);
    if (!value) return;
    if (!tags.includes(value) && tags.length < MAX_TAGS) {
      onChange([...tags, value]);
    }
    setInput('');
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      add();
    } else if (e.key === 'Backspace' && input === '' && tags.length > 0) {
      onChange(tags.slice(0, -1));
    }
  };

  const remove = (tag: string) => {
    onChange(tags.filter((t) => t !== tag));
  };

  return (
    <div className="min-w-0">
      <div className="mb-1.5 flex items-baseline justify-between gap-3">
        <label htmlFor={id} className="block text-sm font-medium text-ink-mute">
          {label}
        </label>
        {hint && <span className="text-xs text-ink-faint">{hint}</span>}
      </div>
      <div className="flex items-center gap-2">
        <Input
          id={id}
          className={darkInput}
          placeholder={placeholder}
          value={input}
          maxLength={60}
          onChange={(event: ChangeEvent<HTMLInputElement>) => setInput(event.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={add}
        />
        <Button type="button" size="sm" variant="outline" onClick={add} disabled={!input.trim()}>
          <Plus className="h-4 w-4" aria-hidden="true" />
          Add
        </Button>
      </div>
      {tags.length > 0 && (
        <ul className="mt-2 flex flex-wrap items-center gap-1.5" role="list" aria-label={`${label} chips`}>
          {tags.map((tag) => (
            <li
              key={tag}
              className="inline-flex items-center gap-1 rounded-full bg-line px-2.5 py-1 text-xs font-medium text-ink"
            >
              {tag}
              <button
                type="button"
                aria-label={`Remove ${tag}`}
                onClick={() => remove(tag)}
                className="rounded-full text-ink-faint transition-colors hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500"
              >
                <X className="h-3 w-3" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function ReviewAssistantTab() {
  const { draft, setField } = useBuilder();
  const config: IReviewAssistantConfig = draft.reviewAssistant ?? {
    enabled: false,
    googleReviewUrl: '',
    writingStyle: 'friendly',
    preferredLength: 'medium',
    languages: ['English'],
    feedbackTopics: [],
    welcomeMessage: '',
  };
  const alias = draft.urlAlias;

  const enabled = config.enabled === true;
  const googleReviewUrl = config.googleReviewUrl ?? '';
  const writingStyle = config.writingStyle ?? 'friendly';
  const preferredLength = config.preferredLength ?? 'medium';
  const languages = config.languages ?? [];
  const feedbackTopics = config.feedbackTopics ?? [];
  const welcomeMessage = config.welcomeMessage ?? '';
  const category = config.category ?? '';
  const employees = config.employees ?? [];
  const services = config.services ?? [];
  const keywords = config.keywords ?? [];

  const [categoryOptions, setCategoryOptions] = useState<CategoryOption[]>([]);
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/public/review-categories');
        if (res.ok) {
          const data = await res.json();
          setCategoryOptions(Array.isArray(data?.categories) ? data.categories : []);
        }
      } catch (error) {
        console.error('Failed to fetch review categories:', error);
      }
    })();
  }, []);

  /* ── QR access for /review/[alias] ── */
  const [qrDataUrl, setQrDataUrl] = useState('');
  // Product feature gate: AI Review Assistant must be included in products.
  const [reviewAllowed, setReviewAllowed] = useState<boolean | null>(null);
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/my/features');
        if (res.ok) {
          const data = await res.json();
          setReviewAllowed(data?.features?.review?.enabled === true);
          return;
        }
      } catch (error) {
        console.error('Failed to fetch review feature:', error);
      }
      setReviewAllowed(true);
    })();
  }, []);

  useEffect(() => {
    if (!enabled || !alias) {
      setQrDataUrl('');
      return;
    }
    let cancelled = false;
    const url = `${window.location.origin}/review/${alias}`;
    generateQRDataURL({ url, foreground: '#000000', background: '#FFFFFF', width: 512, margin: 2 })
      .then((generated) => {
        if (!cancelled) setQrDataUrl(generated);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [enabled, alias]);

  const reviewUrl = enabled && alias ? `/review/${alias}` : null;

  if (reviewAllowed === false) {
    return (
      <div className="rounded-lg bg-surface px-4 py-8 text-center ring-1 ring-line-subtle">
        <Lock className="mx-auto mb-3 h-6 w-6 text-ink-faint" aria-hidden="true" />
        <p className="text-sm font-medium text-ink">AI Review Assistant not included</p>
        <p className="mt-1 text-sm text-ink-faint">
          Your current products don&apos;t include the AI Review Assistant. Contact Taprevia to
          upgrade.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <p className="flex items-start gap-2 rounded-lg bg-accent-600/10 px-3 py-2.5 text-xs leading-relaxed text-accent-400 ring-1 ring-accent-600/20">
        <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        Customers visit a private review page, describe their experience, and get an editable
        draft they can post to Google Reviews. Requires AI enabled in Settings → OpenAI.
      </p>

      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-ink">Enable Review Assistant</p>
          <p className="text-xs text-ink-mute">Publish the review page for this card.</p>
        </div>
        <Switch
          checked={enabled}
          onChange={(checked) => setField('reviewAssistant.enabled', checked)}
          aria-label="Enable Review Assistant"
        />
      </div>

      <div className="grid gap-5">{/* keep spacing consistent */}
        <div className="min-w-0">
          <label htmlFor="ra-google-url" className="mb-1.5 block text-sm font-medium text-ink-mute">
            Google review URL
          </label>
          <Input
            id="ra-google-url"
            className={darkInput}
            placeholder="https://g.page/r/…/review"
            inputMode="url"
            autoComplete="off"
            spellCheck={false}
            value={googleReviewUrl}
            onChange={(event) => setField('reviewAssistant.googleReviewUrl', event.target.value)}
          />
          <p className="mt-1.5 text-xs text-ink-faint">
            Where “Continue to Google Reviews” sends customers (must start with http(s)://).
          </p>
        </div>

        <Select
          id="ra-style"
          label="Writing style"
          options={WRITING_STYLE_OPTIONS}
          value={writingStyle}
          onChange={(value: string) => setField('reviewAssistant.writingStyle', value)}
        />

        <div className="min-w-0">
          <p className="mb-1.5 text-sm font-medium text-ink-mute">Preferred length</p>
          <SegmentedControl
            aria-label="Preferred review length"
            value={preferredLength}
            onChange={(value) => setField('reviewAssistant.preferredLength', value)}
            options={[
              { value: 'short', label: 'Short' },
              { value: 'medium', label: 'Medium' },
              { value: 'detailed', label: 'Detailed' },
            ]}
          />
        </div>

        <TagInput
          id="ra-languages"
          label="Languages"
          hint="Customers can choose one"
          tags={languages}
          placeholder="e.g. English, Spanish…"
          onChange={(value) => setField('reviewAssistant.languages', value)}
        />

        <TagInput
          id="ra-topics"
          label="Feedback topics"
          hint="Optional context"
          tags={feedbackTopics}
          placeholder="e.g. service, food, wait time…"
          onChange={(value) => setField('reviewAssistant.feedbackTopics', value)}
        />

        <div className="min-w-0">
          <label htmlFor="ra-welcome" className="mb-1.5 block text-sm font-medium text-ink-mute">
            Welcome message
          </label>
          <textarea
            id="ra-welcome"
            rows={3}
            maxLength={500}
            placeholder="We’d love to hear about your experience…"
            value={welcomeMessage}
            onChange={(event) => setField('reviewAssistant.welcomeMessage', event.target.value)}
            className={cn(darkInput, 'h-auto resize-y py-2.5')}
          />
        </div>

        <Select
          id="ra-category"
          label="Business category"
          value={category}
          onChange={(value) => setField('reviewAssistant.category', value)}
          options={[
            { value: '', label: 'No category' },
            ...categoryOptions.map((c) => ({ value: c.key, label: c.name })),
          ]}
        />
        <p className="-mt-3 text-xs text-ink-faint">
          Select a category to offer reusable review templates (no AI needed). Leave unset to use
          AI drafts only.
        </p>

        <TagInput
          id="ra-employees"
          label="Employees"
          hint="Used in template {employee}"
          tags={employees}
          placeholder="e.g. Rahul, Priya…"
          onChange={(value) => setField('reviewAssistant.employees', value)}
        />

        <TagInput
          id="ra-services"
          label="Services"
          hint="Used in template {service}"
          tags={services}
          placeholder="e.g. Screen repair, Battery replacement…"
          onChange={(value) => setField('reviewAssistant.services', value)}
        />

        <TagInput
          id="ra-keywords"
          label="Keywords"
          hint="Used in template {keyword}"
          tags={keywords}
          placeholder="e.g. fast, professional, affordable…"
          onChange={(value) => setField('reviewAssistant.keywords', value)}
        />
      </div>

      {/* ── QR access ── */}
      <div className="rounded-xl border border-line-subtle bg-bg p-4">
        <p className="mb-3 text-sm font-medium text-ink-mute">Customer access</p>
        {reviewUrl ? (
          <div className="flex flex-wrap items-center gap-4">
            <div className="flex h-32 w-32 shrink-0 items-center justify-center rounded-lg bg-white p-2">
              {qrDataUrl && (
                // eslint-disable-next-line @next/next/no-img-element -- plain QR image
                <img
                  src={qrDataUrl}
                  alt={`QR code linking to ${reviewUrl}`}
                  width={112}
                  height={112}
                  decoding="async"
                  className="h-28 w-28"
                />
              )}
            </div>
            <div className="min-w-0 space-y-2">
              <a
                href={reviewUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 rounded-lg bg-accent-600/10 px-3 py-1.5 text-xs font-semibold text-accent-400 ring-1 ring-accent-600/20 transition-colors hover:bg-accent-600/20"
              >
                <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                Open review page ({reviewUrl})
              </a>
              <p className="text-xs leading-relaxed text-ink-faint">
                Scan or share this QR to open the review assistant directly. It only goes live once
                Review Assistant is enabled.
              </p>
            </div>
          </div>
        ) : (
          <p className="flex items-center gap-2 text-xs text-ink-faint">
            {enabled ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                Set a profile URL to generate your review page link.
              </>
            ) : (
              'Enable the Review Assistant to preview the QR and public link.'
            )}
          </p>
        )}
      </div>
    </div>
  );
}