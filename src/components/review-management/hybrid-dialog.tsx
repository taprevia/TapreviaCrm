'use client';

import { useEffect, useRef, useState } from 'react';
import { AlertCircle, ChevronDown, Loader2 } from 'lucide-react';
import { Button, Input, Modal } from '@/components/ui';
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
  ReviewSettingsDraft,
} from './types';

type ReviewMode = 'fixed' | 'varied';
type WritingStyle = 'friendly' | 'professional' | 'casual' | 'simple';
type PreferredLength = 'short' | 'medium' | 'detailed';

interface HybridForm {
  enabled: 'inherit' | 'true' | 'false';
  overrideUrl: boolean;
  googleReviewUrl: string;
  overrideWelcome: boolean;
  welcomeMessage: string;
  overrideCategory: boolean;
  category: string;
  overrideLanguages: boolean;
  languages: string[];
  overrideWritingStyle: boolean;
  writingStyle: '' | WritingStyle;
  overrideStyleMode: boolean;
  styleMode: '' | ReviewMode;
  overridePreferredLength: boolean;
  preferredLength: '' | PreferredLength;
  overrideLengthMode: boolean;
  lengthMode: '' | ReviewMode;
  overrideFeedbackTopics: boolean;
  feedbackTopics: string[];
  overrideServices: boolean;
  services: string[];
  overrideEmployees: boolean;
  employees: string[];
  overrideKeywords: boolean;
  keywords: string[];
}

const STYLE_OPTIONS = [
  { value: '', label: 'Choose a style…' },
  { value: 'friendly', label: 'Friendly' },
  { value: 'professional', label: 'Professional' },
  { value: 'casual', label: 'Casual' },
  { value: 'simple', label: 'Simple' },
];
const STYLE_MODE_OPTIONS = [
  { value: '', label: 'Choose a style mode…' },
  { value: 'fixed', label: 'Fixed style' },
  { value: 'varied', label: 'Varied style' },
];
const LENGTH_OPTIONS = [
  { value: '', label: 'Choose a length…' },
  { value: 'short', label: 'Short' },
  { value: 'medium', label: 'Medium' },
  { value: 'detailed', label: 'Detailed' },
];
const LENGTH_MODE_OPTIONS = [
  { value: '', label: 'Choose a length mode…' },
  { value: 'fixed', label: 'Fixed length' },
  { value: 'varied', label: 'Varied length' },
];

function hasOwn(value: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function initialForm(overrides: ReviewProductOverrides): HybridForm {
  return {
    enabled:
      overrides.enabled === undefined ? 'inherit' : overrides.enabled ? 'true' : 'false',
    overrideUrl: hasOwn(overrides, 'googleReviewUrl'),
    googleReviewUrl: overrides.googleReviewUrl ?? '',
    overrideWelcome: hasOwn(overrides, 'welcomeMessage'),
    welcomeMessage: overrides.welcomeMessage ?? '',
    overrideCategory: hasOwn(overrides, 'category'),
    category: overrides.category ?? '',
    overrideLanguages: hasOwn(overrides, 'languages'),
    languages: overrides.languages ?? [],
    overrideWritingStyle: hasOwn(overrides, 'writingStyle'),
    writingStyle: overrides.writingStyle ?? '',
    overrideStyleMode: hasOwn(overrides, 'styleMode'),
    styleMode: overrides.styleMode ?? '',
    overridePreferredLength: hasOwn(overrides, 'preferredLength'),
    preferredLength: overrides.preferredLength ?? '',
    overrideLengthMode: hasOwn(overrides, 'lengthMode'),
    lengthMode: overrides.lengthMode ?? '',
    overrideFeedbackTopics: hasOwn(overrides, 'feedbackTopics'),
    feedbackTopics: overrides.feedbackTopics ?? [],
    overrideServices: hasOwn(overrides, 'services'),
    services: overrides.services ?? [],
    overrideEmployees: hasOwn(overrides, 'employees'),
    employees: overrides.employees ?? [],
    overrideKeywords: hasOwn(overrides, 'keywords'),
    keywords: overrides.keywords ?? [],
  };
}

function isValidGoogleUrl(value: string): boolean {
  if (!value) return true;
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

function styleLabel(value: string): string {
  return STYLE_OPTIONS.find((option) => option.value === value)?.label ?? value;
}
function modeLabel(value: string): string {
  return STYLE_MODE_OPTIONS.find((option) => option.value === value)?.label ?? value;
}
function lengthLabel(value: string): string {
  return LENGTH_OPTIONS.find((option) => option.value === value)?.label ?? value;
}

function LightSelect({
  id,
  label,
  value,
  onChange,
  options,
  disabled,
  error,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
  disabled?: boolean;
  error?: string;
}) {
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-sm font-medium text-gray-700">
        {label}
      </label>
      <div className="relative">
        <select
          id={id}
          value={value}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
          className={cn(
            'h-11 w-full appearance-none rounded-lg border border-gray-300 bg-white px-3 pr-8 text-sm text-gray-900 transition-colors focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 disabled:cursor-not-allowed disabled:opacity-50',
            error && 'border-red-400 focus:border-red-500 focus:ring-red-500/20'
          )}
        >
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <ChevronDown
          className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400"
          aria-hidden="true"
        />
      </div>
      {error && <p className="mt-1.5 text-xs text-red-600">{error}</p>}
    </div>
  );
}

function OverrideSection({
  id,
  title,
  inherited,
  overridden,
  onToggle,
  children,
  hint,
}: {
  id: string;
  title: string;
  inherited: string;
  overridden: boolean;
  onToggle: () => void;
  children: React.ReactNode;
  hint?: string;
}) {
  return (
    <section className="rounded-xl border border-gray-200 p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium text-gray-900">{title}</p>
          <p className="mt-0.5 break-words text-xs leading-relaxed text-gray-500">
            {overridden ? 'Overrides the central setting for this product.' : `Inherited: ${inherited}`}
          </p>
          {hint && <p className="mt-1 text-xs leading-relaxed text-gray-500">{hint}</p>}
        </div>
        <label
          htmlFor={`${id}-toggle`}
          className="flex shrink-0 items-center gap-1.5 text-xs font-medium text-gray-600"
        >
          <input
            id={`${id}-toggle`}
            type="checkbox"
            aria-label={`Override ${title}`}
            className="h-4 w-4 rounded border-gray-300 bg-white text-blue-600 focus:ring-blue-500"
            checked={overridden}
            onChange={onToggle}
          />
          Override
        </label>
      </div>
      {overridden && <div className="mt-3">{children}</div>}
    </section>
  );
}

export function HybridDialog({
  product,
  central,
  busy,
  onClose,
  onConnect,
  loadOptions,
}: {
  product: ReviewProduct;
  central: ReviewSettingsDraft;
  busy: boolean;
  onClose: () => void;
  onConnect: (
    product: ReviewProduct,
    overrides: ReviewProductOverrides
  ) => Promise<{ ok: boolean; message?: string }>;
  loadOptions: (category: string) => Promise<ReviewManagementOptions>;
}) {
  const [form, setForm] = useState<HybridForm>(() => initialForm(product.reviewOverrides));
  const [initial] = useState<HybridForm>(() => initialForm(product.reviewOverrides));
  const [options, setOptions] = useState<ReviewManagementOptions | null>(null);
  const [optionsLoading, setOptionsLoading] = useState(true);
  const [optionsError, setOptionsError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const loadOptionsRef = useRef(loadOptions);
  loadOptionsRef.current = loadOptions;

  const dirty = JSON.stringify(form) !== JSON.stringify(initial);
  const effectiveCategory = form.overrideCategory ? form.category : central.content.category;
  const effectiveLanguages = form.overrideLanguages
    ? form.languages
    : central.content.languages;
  const effectiveEnabled =
    form.enabled === 'inherit' ? central.general.enabled : form.enabled === 'true';
  const inheritedGoogleUrl =
    product.instanceType === 'standee'
      ? product.standeeGoogleReviewUrl ?? ''
      : central.general.googleReviewUrl;

  useEffect(() => {
    let cancelled = false;
    setOptionsLoading(true);
    setOptionsError(null);
    void loadOptionsRef
      .current(effectiveCategory)
      .then((next) => {
        if (!cancelled) setOptions(next);
      })
      .catch((loadError: unknown) => {
        if (!cancelled) {
          setOptionsError(
            loadError instanceof Error ? loadError.message : 'Could not load Review Library options.'
          );
        }
      })
      .finally(() => {
        if (!cancelled) setOptionsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [effectiveCategory]);

  function update<K extends keyof HybridForm>(key: K, value: HybridForm[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
    setError(null);
  }

  function toggle(key: keyof HybridForm) {
    setForm((prev) => {
      const next = { ...prev, [key]: !prev[key] };
      return next;
    });
    setError(null);
  }

  const categories = options?.categories ?? [];
  const languages = options?.languages ?? [];
  const categoryIsActive =
    !form.category || categories.some((category) => category.key === form.category);
  const categoryChanged = form.category !== initial.category;
  const initialLanguages = new Set(initial.languages);
  const unsupportedLanguages = form.overrideLanguages
    ? form.languages.filter(
        (language) =>
          !languages.includes(language) &&
          (categoryChanged || !initialLanguages.has(language))
      )
    : [];
  const urlError =
    form.overrideUrl && !isValidGoogleUrl(form.googleReviewUrl.trim())
      ? 'Enter an empty or valid http(s) URL without credentials.'
      : null;
  const styleError =
    form.overrideWritingStyle && !form.writingStyle ? 'Choose a writing style.' : null;
  const styleModeError =
    form.overrideStyleMode && !form.styleMode ? 'Choose a style mode.' : null;
  const lengthError =
    form.overridePreferredLength && !form.preferredLength ? 'Choose a review length.' : null;
  const lengthModeError =
    form.overrideLengthMode && !form.lengthMode ? 'Choose a length mode.' : null;
  const languageError =
    effectiveEnabled && effectiveLanguages.length === 0
      ? 'Add at least one language before enabling Review Assistant.'
      : null;
  const validationError =
    urlError ??
    styleError ??
    styleModeError ??
    lengthError ??
    lengthModeError ??
    languageError ??
    (form.overrideCategory && !categoryIsActive && categoryChanged
      ? 'Choose an active business category.'
      : null) ??
    (unsupportedLanguages.length > 0
      ? 'Some selected languages are not supported by the effective category.'
      : null);
  const disabled = busy || optionsLoading || Boolean(optionsError);

  function requestClose() {
    if (busy) return;
    if (dirty && !window.confirm('Discard unsaved product override changes?')) return;
    onClose();
  }

  function buildOverrides(): ReviewProductOverrides {
    const overrides: ReviewProductOverrides = {};
    if (form.enabled !== 'inherit') overrides.enabled = form.enabled === 'true';
    if (form.overrideUrl) overrides.googleReviewUrl = form.googleReviewUrl.trim();
    if (form.overrideWelcome) overrides.welcomeMessage = form.welcomeMessage.trim();
    if (form.overrideCategory) overrides.category = form.category.trim().toLowerCase();
    if (form.overrideLanguages) overrides.languages = form.languages;
    if (form.overrideWritingStyle && form.writingStyle) overrides.writingStyle = form.writingStyle;
    if (form.overrideStyleMode && form.styleMode) overrides.styleMode = form.styleMode;
    if (form.overridePreferredLength && form.preferredLength) {
      overrides.preferredLength = form.preferredLength;
    }
    if (form.overrideLengthMode && form.lengthMode) overrides.lengthMode = form.lengthMode;
    if (form.overrideFeedbackTopics) overrides.feedbackTopics = form.feedbackTopics;
    if (form.overrideServices) overrides.services = form.services;
    if (form.overrideEmployees) overrides.employees = form.employees;
    if (form.overrideKeywords) overrides.keywords = form.keywords;
    return overrides;
  }

  async function save() {
    if (disabled) return;
    if (validationError) {
      setError(validationError);
      return;
    }
    setError(null);
    const result = await onConnect(product, buildOverrides());
    if (!result.ok) {
      setError(result.message ?? 'Could not update the product settings source.');
    }
  }

  const effectiveCategoryLabel = form.overrideCategory
    ? categories.find((category) => category.key === form.category)?.label ??
      (form.category || 'All categories')
    : categories.find((category) => category.key === central.content.category)?.label ??
      (central.content.category || 'All categories');

  const previewRows = [
    ['Status', effectiveEnabled ? 'Enabled' : 'Disabled'],
    ['Destination', form.overrideUrl ? form.googleReviewUrl.trim() || 'No destination set' : inheritedGoogleUrl || 'No destination set'],
    ['Welcome message', form.overrideWelcome ? form.welcomeMessage.trim() || 'No welcome message' : central.general.welcomeMessage || 'No welcome message'],
    ['Category', effectiveCategoryLabel],
    ['Languages', effectiveLanguages.join(', ') || 'None'],
    ['Writing style', form.overrideWritingStyle ? styleLabel(form.writingStyle) : styleLabel(central.content.writingStyle)],
    ['Style mode', form.overrideStyleMode ? modeLabel(form.styleMode) : modeLabel(central.content.styleMode)],
    ['Length', form.overridePreferredLength ? lengthLabel(form.preferredLength) : lengthLabel(central.content.preferredLength)],
    ['Length mode', form.overrideLengthMode ? modeLabel(form.lengthMode) : modeLabel(central.content.lengthMode)],
    ['Topics', (form.overrideFeedbackTopics ? form.feedbackTopics : central.content.feedbackTopics).join(', ') || 'None'],
    ['Services', (form.overrideServices ? form.services : central.content.services).join(', ') || 'None'],
    ['Employees', (form.overrideEmployees ? form.employees : central.content.employees).join(', ') || 'None'],
    ['Keywords', (form.overrideKeywords ? form.keywords : central.content.keywords).join(', ') || 'None'],
  ] as const;

  return (
    <Modal isOpen onClose={requestClose} title="Use Central + Product Overrides">
      <div className="space-y-4">
        <p className="text-sm leading-relaxed text-gray-600">
          Central settings provide the base. Only the fields you override here take precedence
          for this product. Everything else continues to inherit central settings, and the
          product&apos;s legacy settings remain preserved for rollback.
        </p>

        <div className="rounded-xl border border-gray-200 bg-gray-50 px-3 py-2.5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-medium text-gray-900">Review Assistant status</p>
              <p className="mt-0.5 text-xs text-gray-500">
                {form.enabled === 'inherit'
                  ? `Inherited: ${central.general.enabled ? 'Enabled' : 'Disabled'}`
                  : 'Overrides the central status for this product.'}
              </p>
            </div>
          </div>
          <div className="mt-2">
            <LightSelect
              id="hybrid-enabled"
              label="Status"
              value={form.enabled}
              onChange={(value) => update('enabled', value as HybridForm['enabled'])}
              options={[
                {
                  value: 'inherit',
                  label: `Inherit central status (${central.general.enabled ? 'Enabled' : 'Disabled'})`,
                },
                { value: 'true', label: 'Enabled for this product' },
                { value: 'false', label: 'Disabled for this product' },
              ]}
              disabled={disabled}
            />
          </div>
        </div>

        {product.instanceType === 'standee' && (
          <p className="rounded-lg border border-blue-100 bg-blue-50 px-3 py-2 text-xs leading-relaxed text-blue-800">
            This Standee keeps its own Google destination. Central settings never replace it unless you explicitly
            override the URL below.
          </p>
        )}

        <OverrideSection
          id="hybrid-url"
          title="Google Review destination"
          inherited={inheritedGoogleUrl || 'No destination set'}
          overridden={form.overrideUrl}
          onToggle={() => toggle('overrideUrl')}
        >
          <Input
            id="hybrid-google-url"
            type="url"
            inputMode="url"
            placeholder="https://g.page/r/…/review"
            value={form.googleReviewUrl}
            onChange={(event) => update('googleReviewUrl', event.target.value)}
            error={urlError ?? undefined}
            disabled={disabled}
          />
        </OverrideSection>

        <OverrideSection
          id="hybrid-welcome"
          title="Welcome message"
          inherited={central.general.welcomeMessage || 'No welcome message'}
          overridden={form.overrideWelcome}
          onToggle={() => toggle('overrideWelcome')}
        >
          <label htmlFor="hybrid-welcome-message" className="mb-1.5 block text-sm font-medium text-gray-700">
            Welcome message for this product
          </label>
          <textarea
            id="hybrid-welcome-message"
            rows={3}
            maxLength={500}
            value={form.welcomeMessage}
            disabled={disabled}
            onChange={(event) => update('welcomeMessage', event.target.value)}
            className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-900 placeholder:text-gray-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 disabled:cursor-not-allowed disabled:opacity-50"
            placeholder="A short welcome for customers"
          />
          <p className="mt-1 text-xs text-gray-500">{form.welcomeMessage.length}/500</p>
        </OverrideSection>

        <OverrideSection
          id="hybrid-category"
          title="Business category"
          inherited={
            categories.find((category) => category.key === central.content.category)?.label ??
            (central.content.category || 'All categories')
          }
          overridden={form.overrideCategory}
          onToggle={() => toggle('overrideCategory')}
        >
          <ReviewCategorySelect
            id="hybrid-category-select"
            value={form.category}
            categories={categories}
            savedInactiveLabel={form.category || undefined}
            loading={optionsLoading}
            disabled={disabled}
            onChange={(value) => update('category', value)}
            theme="light"
          />
        </OverrideSection>

        <OverrideSection
          id="hybrid-languages"
          title="Languages"
          inherited={central.content.languages.join(', ') || 'None'}
          overridden={form.overrideLanguages}
          onToggle={() => toggle('overrideLanguages')}
          hint="Only languages supported by the effective category can be added."
        >
          <ReviewLanguageMultiSelect
            id="hybrid-languages-select"
            value={form.languages}
            options={languages}
            loading={optionsLoading}
            disabled={disabled}
            onChange={(value) => update('languages', value)}
            theme="light"
          />
          {unsupportedLanguages.length > 0 && (
            <p className="mt-2 text-xs leading-relaxed text-amber-600" role="alert">
              {unsupportedLanguages.length === 1
                ? 'One selected language is not supported by the effective category.'
                : `${unsupportedLanguages.length} selected languages are not supported by the effective category.`}
            </p>
          )}
        </OverrideSection>

        <OverrideSection
          id="hybrid-style"
          title="Writing style"
          inherited={styleLabel(central.content.writingStyle)}
          overridden={form.overrideWritingStyle}
          onToggle={() => toggle('overrideWritingStyle')}
        >
          <LightSelect
            id="hybrid-style-select"
            label="Writing style for this product"
            value={form.writingStyle}
            onChange={(value) => update('writingStyle', value as HybridForm['writingStyle'])}
            options={STYLE_OPTIONS}
            disabled={disabled}
            error={styleError ?? undefined}
          />
        </OverrideSection>

        <OverrideSection
          id="hybrid-style-mode"
          title="Writing style mode"
          inherited={modeLabel(central.content.styleMode)}
          overridden={form.overrideStyleMode}
          onToggle={() => toggle('overrideStyleMode')}
        >
          <LightSelect
            id="hybrid-style-mode-select"
            label="Style mode for this product"
            value={form.styleMode}
            onChange={(value) => update('styleMode', value as HybridForm['styleMode'])}
            options={STYLE_MODE_OPTIONS}
            disabled={disabled}
            error={styleModeError ?? undefined}
          />
        </OverrideSection>

        <OverrideSection
          id="hybrid-length"
          title="Preferred review length"
          inherited={lengthLabel(central.content.preferredLength)}
          overridden={form.overridePreferredLength}
          onToggle={() => toggle('overridePreferredLength')}
        >
          <LightSelect
            id="hybrid-length-select"
            label="Review length for this product"
            value={form.preferredLength}
            onChange={(value) => update('preferredLength', value as HybridForm['preferredLength'])}
            options={LENGTH_OPTIONS}
            disabled={disabled}
            error={lengthError ?? undefined}
          />
        </OverrideSection>

        <OverrideSection
          id="hybrid-length-mode"
          title="Review length mode"
          inherited={modeLabel(central.content.lengthMode)}
          overridden={form.overrideLengthMode}
          onToggle={() => toggle('overrideLengthMode')}
        >
          <LightSelect
            id="hybrid-length-mode-select"
            label="Length mode for this product"
            value={form.lengthMode}
            onChange={(value) => update('lengthMode', value as HybridForm['lengthMode'])}
            options={LENGTH_MODE_OPTIONS}
            disabled={disabled}
            error={lengthModeError ?? undefined}
          />
        </OverrideSection>

        <OverrideSection
          id="hybrid-topics"
          title="Feedback topics"
          inherited={central.content.feedbackTopics.join(', ') || 'None'}
          overridden={form.overrideFeedbackTopics}
          onToggle={() => toggle('overrideFeedbackTopics')}
        >
          <ReviewTagInput
            id="hybrid-topics-input"
            label="Feedback topics for this product"
            value={form.feedbackTopics}
            onChange={(value) => update('feedbackTopics', value)}
            suggestions={(options?.suggestedFeedbackTopics ?? []).map((topic) => topic.label)}
            placeholder="e.g. Service"
            disabled={disabled}
            theme="light"
          />
        </OverrideSection>

        <OverrideSection
          id="hybrid-services"
          title="Services"
          inherited={central.content.services.join(', ') || 'None'}
          overridden={form.overrideServices}
          onToggle={() => toggle('overrideServices')}
        >
          <ReviewTagInput
            id="hybrid-services-input"
            label="Services for this product"
            value={form.services}
            onChange={(value) => update('services', value)}
            suggestions={(options?.suggestedServices ?? [])}
            placeholder="e.g. Espresso"
            hint="Only add genuine services."
            disabled={disabled}
            theme="light"
          />
        </OverrideSection>

        <OverrideSection
          id="hybrid-employees"
          title="Employees"
          inherited={central.content.employees.join(', ') || 'None'}
          overridden={form.overrideEmployees}
          onToggle={() => toggle('overrideEmployees')}
        >
          <ReviewTagInput
            id="hybrid-employees-input"
            label="Employees for this product"
            value={form.employees}
            onChange={(value) => update('employees', value)}
            suggestions={(options?.suggestedEmployees ?? [])}
            placeholder="e.g. Rahul"
            hint="Only add genuine employee names."
            disabled={disabled}
            theme="light"
          />
        </OverrideSection>

        <OverrideSection
          id="hybrid-keywords"
          title="Keywords"
          inherited={central.content.keywords.join(', ') || 'None'}
          overridden={form.overrideKeywords}
          onToggle={() => toggle('overrideKeywords')}
        >
          <ReviewTagInput
            id="hybrid-keywords-input"
            label="Keywords for this product"
            value={form.keywords}
            onChange={(value) => update('keywords', value)}
            suggestions={(options?.suggestedKeywords ?? [])}
            placeholder="e.g. friendly, reliable"
            hint="Keywords describe the business; they are never forced into every review."
            disabled={disabled}
            theme="light"
          />
        </OverrideSection>

        <section className="rounded-xl border border-gray-200 bg-gray-50 p-3">
          <h3 className="text-sm font-semibold text-gray-900">Effective settings preview</h3>
          <p className="mt-0.5 text-xs text-gray-500">
            This is what this product will use after saving.
          </p>
          <dl className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
            {previewRows.map(([label, value]) => (
              <div key={label} className="min-w-0">
                <dt className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">
                  {label}
                </dt>
                <dd className="truncate text-xs text-gray-800">{value}</dd>
              </div>
            ))}
          </dl>
        </section>

        {optionsError && (
          <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700" role="alert">
            {optionsError} Close and reopen this dialog to retry.
          </p>
        )}

        {error && (
          <p className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            {error}
          </p>
        )}

        <div aria-hidden="true" className="h-12" />
        <div className="sticky bottom-0 -mx-6 mt-1 border-t border-gray-100 bg-white px-6 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3">
          <div className="flex items-center justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={requestClose}
              disabled={busy}
            >
              Cancel
            </Button>
            <Button
              type="button"
              aria-label="Connect with overrides"
              onClick={() => void save()}
              disabled={disabled || Boolean(validationError)}
            >
              {busy ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  Connecting…
                </>
              ) : (
                <>
                  <span className="sm:hidden">Connect</span>
                  <span className="hidden sm:inline">Connect with overrides</span>
                </>
              )}
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
