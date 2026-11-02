'use client';

import { KeyboardEvent, useEffect, useId, useRef, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  Check,
  ChevronDown,
  Plus,
  Search,
  X,
} from 'lucide-react';
import { Badge, Button, Input } from '@/components/ui';
import { cn } from '@/lib/utils';
import type { ReviewCategoryOption } from './types';

const FIELD_CLASS =
  'border-line bg-field text-ink placeholder:text-ink-faint hover:border-line-strong focus:border-accent-500 focus:ring-accent-500/25';
const MAX_TAGS = 12;
const MAX_TAG_LENGTH = 50;

export type ReviewFieldTheme = 'dark' | 'light';

const TONES = {
  dark: {
    field: FIELD_CLASS,
    label: 'text-ink-mute',
    faint: 'text-ink-faint',
    panel: 'border-line bg-surface shadow-e3',
    active: 'bg-accent-600/10 text-accent-400',
    idle: 'text-ink hover:bg-field',
    chip: 'bg-field text-ink ring-line-subtle',
    suggestion:
      'border-line-subtle bg-surface text-ink-mute hover:border-accent-500/40 hover:text-ink',
    warn: 'text-warn',
  },
  light: {
    field:
      'border-gray-300 bg-white text-gray-900 placeholder:text-gray-400 hover:border-gray-400 focus:border-blue-500 focus:ring-blue-500/20',
    label: 'text-ink-mute',
    faint: 'text-gray-500',
    panel: 'border-gray-200 bg-white shadow-xl',
    active: 'bg-blue-50 text-blue-700',
    idle: 'text-gray-900 hover:bg-gray-50',
    chip: 'bg-gray-50 text-gray-800 ring-gray-200',
    suggestion:
      'border-gray-200 bg-white text-gray-600 hover:border-blue-300 hover:text-gray-900',
    warn: 'text-amber-600',
  },
} as const;

function useOutsideClose(open: boolean, rootRef: React.RefObject<HTMLElement>, close: () => void) {
  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) close();
    };
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open, rootRef, close]);
}

function focusOptionByKey(event: KeyboardEvent<HTMLElement>) {
  if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
  const panel = event.currentTarget.closest('[data-review-panel]');
  if (!panel) return;
  const options = Array.from(panel.querySelectorAll<HTMLButtonElement>('[role="option"]:not([disabled])'));
  if (options.length === 0) return;
  event.preventDefault();
  const current = options.indexOf(document.activeElement as HTMLButtonElement);
  const next = event.key === 'ArrowDown'
    ? Math.min(options.length - 1, current < 0 ? 0 : current + 1)
    : Math.max(0, current <= 0 ? 0 : current - 1);
  options[next]?.focus();
}

// ─── Category single-select ────────────────────────────────────────────────

export function ReviewCategorySelect({
  id,
  value,
  categories,
  savedInactiveLabel,
  loading,
  disabled,
  onChange,
  theme = 'dark',
}: {
  id: string;
  value: string;
  categories: ReviewCategoryOption[];
  savedInactiveLabel?: string;
  loading?: boolean;
  disabled?: boolean;
  onChange: (value: string) => void;
  theme?: ReviewFieldTheme;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const rootRef = useRef<HTMLDivElement>(null);
  const listId = useId();
  useOutsideClose(open, rootRef, () => setOpen(false));
  const tone = TONES[theme];

  const selected = categories.find((category) => category.key === value);
  const selectedLabel = selected?.label ?? (value ? savedInactiveLabel ?? value : 'All categories');
  const filtered = categories.filter((category) =>
    category.label.toLowerCase().includes(query.trim().toLowerCase())
  );

  const choose = (next: string) => {
    onChange(next);
    setOpen(false);
    setQuery('');
  };

  return (
    <div className="relative min-w-0" ref={rootRef}>
      <label htmlFor={id} className={cn('mb-1.5 block text-sm font-medium', tone.label)}>
        Business category
      </label>
      <button
        id={id}
        type="button"
        disabled={disabled || loading}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => setOpen((prev) => !prev)}
        className={cn(
          'flex h-11 w-full items-center justify-between gap-2 rounded-lg border px-3 text-left text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/25 disabled:cursor-not-allowed disabled:opacity-50',
          tone.field
        )}
      >
        <span className={cn('truncate', !value && tone.faint)}>{selectedLabel}</span>
        <ChevronDown
          className={cn('h-4 w-4 shrink-0 transition-transform', tone.faint, open && 'rotate-180')}
          aria-hidden="true"
        />
      </button>
      {value && !selected && (
        <p className={cn('mt-1.5 flex items-start gap-1.5 text-xs leading-relaxed', tone.warn)}>
          <span aria-hidden="true">●</span>
          This saved category is no longer active. It is kept until you choose another category.
        </p>
      )}
      {open && (
        <div
          data-review-panel
          className={cn(
            'absolute z-30 mt-1 w-full max-w-xl rounded-xl border p-2',
            tone.panel
          )}
        >
          <div className="relative">
            <Search
              className={cn(
                'pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2',
                tone.faint
              )}
              aria-hidden="true"
            />
            <Input
              autoFocus
              aria-label="Search categories"
              placeholder="Search categories…"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={focusOptionByKey}
              className={cn('pl-9', tone.field)}
            />
          </div>
          <div id={listId} role="listbox" aria-label="Business categories" className="mt-2 max-h-64 space-y-0.5 overflow-y-auto">
            <button
              type="button"
              role="option"
              aria-selected={value === ''}
              onClick={() => choose('')}
              className={cn(
                'flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-left text-sm transition-colors',
                value === '' ? tone.active : tone.idle
              )}
            >
              All categories
              {value === '' && <Check className="h-4 w-4" aria-hidden="true" />}
            </button>
            {loading ? (
              <p className={cn('px-2.5 py-3 text-xs', tone.faint)}>Loading categories…</p>
            ) : filtered.length === 0 ? (
              <p className={cn('px-2.5 py-3 text-xs', tone.faint)}>No active categories match.</p>
            ) : (
              filtered.map((category) => {
                const active = category.key === value;
                return (
                  <button
                    key={category.key}
                    type="button"
                    role="option"
                    aria-selected={active}
                    onClick={() => choose(category.key)}
                    className={cn(
                      'flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-2 text-left text-sm transition-colors',
                      active ? tone.active : tone.idle
                    )}
                  >
                    <span className="min-w-0">
                      <span className="block truncate">{category.label}</span>
                      <span className={cn('block text-[11px]', tone.faint)}>
                        {category.scenarioCount === 1 ? '1 topic group' : `${category.scenarioCount} topic groups`}
                      </span>
                    </span>
                    {active && <Check className="h-4 w-4 shrink-0" aria-hidden="true" />}
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Language multi-select ─────────────────────────────────────────────────

export function ReviewLanguageMultiSelect({
  id,
  value,
  options,
  loading,
  disabled,
  onChange,
  theme = 'dark',
}: {
  id: string;
  value: string[];
  options: string[];
  loading?: boolean;
  disabled?: boolean;
  onChange: (value: string[]) => void;
  theme?: ReviewFieldTheme;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const rootRef = useRef<HTMLDivElement>(null);
  const listId = useId();
  useOutsideClose(open, rootRef, () => setOpen(false));
  const tone = TONES[theme];

  const filtered = options.filter((language) =>
    language.toLowerCase().includes(query.trim().toLowerCase())
  );
  const unsupported = value.filter((language) => !options.includes(language));

  const toggle = (language: string) => {
    if (value.includes(language)) {
      onChange(value.filter((item) => item !== language));
    } else if (value.length < MAX_TAGS) {
      onChange([...value, language]);
    }
  };

  const move = (index: number, direction: -1 | 1) => {
    const next = [...value];
    const target = index + direction;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    onChange(next);
  };

  return (
    <div className="relative min-w-0" ref={rootRef}>
      <div className="mb-1.5 flex items-baseline justify-between gap-3">
        <label htmlFor={id} className={cn('block text-sm font-medium', tone.label)}>
          Review languages
        </label>
        <span className={cn('text-xs', tone.faint)}>{value.length}/12</span>
      </div>

      {value.length > 0 && (
        <ul className="mb-2 flex flex-wrap items-center gap-1.5" role="list" aria-label="Selected review languages">
          {value.map((language, index) => {
            const isLegacy = unsupported.includes(language);
            return (
              <li
                key={language}
                className={cn(
                  'inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium ring-1',
                  tone.chip
                )}
              >
                <span>{language}</span>
                {index === 0 && <Badge variant="info" className="px-1.5 py-0 text-[10px]">Default</Badge>}
                {isLegacy && <Badge variant="warning" className="px-1.5 py-0 text-[10px]">Saved</Badge>}
                <button
                  type="button"
                  aria-label={`Move ${language} earlier`}
                  disabled={index === 0}
                  onClick={() => move(index, -1)}
                  className={cn('rounded-full transition-colors disabled:opacity-30', tone.faint)}
                >
                  <ArrowUp className="h-3 w-3" aria-hidden="true" />
                </button>
                <button
                  type="button"
                  aria-label={`Move ${language} later`}
                  disabled={index === value.length - 1}
                  onClick={() => move(index, 1)}
                  className={cn('rounded-full transition-colors disabled:opacity-30', tone.faint)}
                >
                  <ArrowDown className="h-3 w-3" aria-hidden="true" />
                </button>
                <button
                  type="button"
                  aria-label={`Remove ${language}`}
                  onClick={() => toggle(language)}
                  className={cn('rounded-full transition-colors', tone.faint)}
                >
                  <X className="h-3 w-3" aria-hidden="true" />
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <div className="relative">
        <button
          id={id}
          type="button"
          disabled={disabled || loading}
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-controls={listId}
          onClick={() => setOpen((prev) => !prev)}
          className={cn(
            'flex h-11 w-full items-center justify-between gap-2 rounded-lg border px-3 text-left text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/25 disabled:cursor-not-allowed disabled:opacity-50',
            tone.field
          )}
        >
          <span className={cn('truncate', value.length === 0 && tone.faint)}>
            {value.length === 0 ? 'Select languages…' : `${value.length} selected`}
          </span>
          <ChevronDown
            className={cn('h-4 w-4 shrink-0 transition-transform', tone.faint, open && 'rotate-180')}
            aria-hidden="true"
          />
        </button>

        {open && (
          <div
            data-review-panel
            className={cn('absolute z-30 mt-1 w-full rounded-xl border p-2', tone.panel)}
          >
            <div className="relative">
              <Search
                className={cn(
                  'pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2',
                  tone.faint
                )}
                aria-hidden="true"
              />
              <Input
                autoFocus
                aria-label="Search review languages"
                placeholder="Search languages…"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={focusOptionByKey}
                className={cn('pl-9', tone.field)}
              />
            </div>
            <div id={listId} role="listbox" aria-multiselectable="true" aria-label="Review languages" className="mt-2 max-h-64 space-y-0.5 overflow-y-auto">
              {loading ? (
                <p className={cn('px-2.5 py-3 text-xs', tone.faint)}>Loading languages…</p>
              ) : filtered.length === 0 ? (
                <p className={cn('px-2.5 py-3 text-xs', tone.faint)}>No supported languages found for this category.</p>
              ) : (
                filtered.map((language) => {
                  const active = value.includes(language);
                  const atLimit = !active && value.length >= MAX_TAGS;
                  return (
                    <button
                      key={language}
                      type="button"
                      role="option"
                      aria-selected={active}
                      disabled={atLimit}
                      onClick={() => toggle(language)}
                      className={cn(
                        'flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-2 text-left text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-40',
                        active ? tone.active : tone.idle
                      )}
                    >
                      <span className="truncate">{language}</span>
                      {active && <Check className="h-4 w-4 shrink-0" aria-hidden="true" />}
                    </button>
                  );
                })
              )}
            </div>
            {value.length >= MAX_TAGS && (
              <p className={cn('px-2.5 pt-2 text-[11px]', tone.faint)}>Maximum 12 languages selected.</p>
            )}
          </div>
        )}
      </div>
      {unsupported.length > 0 && (
        <p className={cn('mt-1.5 text-xs leading-relaxed', tone.warn)}>
          {unsupported.length === 1
            ? 'One saved language is no longer supported by the active library. It is kept as a saved value until you remove it.'
            : `${unsupported.length} saved languages are no longer supported by the active library. They are kept as saved values until you remove them.`}
        </p>
      )}
    </div>
  );
}

// ─── Tag input + suggestions ───────────────────────────────────────────────

export function ReviewTagInput({
  id,
  label,
  value,
  onChange,
  placeholder,
  hint,
  suggestions = [],
  disabled,
  theme = 'dark',
}: {
  id: string;
  label: string;
  value: string[];
  onChange: (value: string[]) => void;
  placeholder?: string;
  hint?: string;
  suggestions?: string[];
  disabled?: boolean;
  theme?: ReviewFieldTheme;
}) {
  const [text, setText] = useState('');
  const tone = TONES[theme];

  const add = (raw: string) => {
    const nextValue = raw.trim().slice(0, MAX_TAG_LENGTH);
    if (!nextValue || value.includes(nextValue) || value.length >= MAX_TAGS) return;
    onChange([...value, nextValue]);
    setText('');
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter' || event.key === ',') {
      event.preventDefault();
      add(text);
    } else if (event.key === 'Backspace' && text === '' && value.length > 0) {
      onChange(value.slice(0, -1));
    }
  };

  const availableSuggestions = suggestions.filter((suggestion) => !value.includes(suggestion));

  return (
    <div className="min-w-0">
      <div className="mb-1.5 flex items-baseline justify-between gap-3">
        <label htmlFor={id} className={cn('block text-sm font-medium', tone.label)}>
          {label}
        </label>
        <span className={cn('text-xs', tone.faint)}>{value.length}/12</span>
      </div>
      {hint && <p className={cn('mb-2 text-xs leading-relaxed', tone.faint)}>{hint}</p>}

      {availableSuggestions.length > 0 && value.length < MAX_TAGS && (
        <div className="mb-2 flex flex-wrap gap-1.5" aria-label={`Suggested ${label.toLowerCase()}`}>
          {availableSuggestions.slice(0, 8).map((suggestion) => (
            <button
              key={suggestion}
              type="button"
              onClick={() => add(suggestion)}
              className={cn(
                'inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs transition-colors',
                tone.suggestion
              )}
            >
              <Plus className="h-3 w-3" aria-hidden="true" />
              {suggestion}
            </button>
          ))}
        </div>
      )}

      {value.length > 0 && (
        <ul className="mb-2 flex flex-wrap items-center gap-1.5" role="list" aria-label={`Selected ${label.toLowerCase()}`}>
          {value.map((tag) => (
            <li
              key={tag}
              className={cn(
                'inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium ring-1',
                tone.chip
              )}
            >
              {tag}
              <button
                type="button"
                aria-label={`Remove ${tag}`}
                onClick={() => onChange(value.filter((item) => item !== tag))}
                className={cn('rounded-full transition-colors', tone.faint)}
              >
                <X className="h-3 w-3" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <Input
            id={id}
            value={text}
            disabled={disabled || value.length >= MAX_TAGS}
            maxLength={MAX_TAG_LENGTH}
            placeholder={value.length >= MAX_TAGS ? 'Maximum reached' : placeholder}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={onKeyDown}
            className={tone.field}
          />
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled || !text.trim() || value.length >= MAX_TAGS}
          onClick={() => add(text)}
        >
          <Plus className="h-4 w-4" aria-hidden="true" />
          Add
        </Button>
      </div>
    </div>
  );
}
