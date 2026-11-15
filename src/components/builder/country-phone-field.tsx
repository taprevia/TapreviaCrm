'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, Search } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import {
  DEFAULT_COUNTRY_ISO,
  PHONE_COUNTRIES,
  combinePhone,
  countryFlag,
  getPhoneCountry,
  splitE164,
  type PhoneCountry,
} from '@/lib/phone';

interface CountryPhoneFieldProps {
  id: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  autoComplete?: string;
  className?: string;
}

interface PhoneDisplayState {
  iso2: string;
  national: string;
}

/**
 * Derive selector state from a stored value without ever mutating it. A value
 * the parser cannot resolve is shown verbatim under the default country until
 * the customer intentionally edits it.
 */
function displayStateFromValue(value: string): PhoneDisplayState {
  const split = splitE164(value);
  if (split) return { iso2: split.iso2, national: split.national };
  if (value.trim()) return { iso2: DEFAULT_COUNTRY_ISO, national: value.trim() };
  return { iso2: DEFAULT_COUNTRY_ISO, national: '' };
}

export function CountryPhoneField({
  id,
  value,
  onChange,
  placeholder,
  autoComplete = 'tel',
  className,
}: CountryPhoneFieldProps) {
  const initial = useRef(displayStateFromValue(value));
  const [iso2, setIso2] = useState(initial.current.iso2);
  const [national, setNational] = useState(initial.current.national);
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);

  /** Last value this component emitted or hydrated from, to avoid feedback. */
  const lastValueRef = useRef(value);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);

  /* External updates (load, save response) refresh the display, but the
     component never writes back just because the prop changed. */
  useEffect(() => {
    if (value === lastValueRef.current) return;
    lastValueRef.current = value;
    const next = displayStateFromValue(value);
    setIso2(next.iso2);
    setNational(next.national);
    setError(null);
    setTouched(false);
  }, [value]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    const focusTimer = window.setTimeout(() => searchRef.current?.focus(), 20);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
      window.clearTimeout(focusTimer);
    };
  }, [open]);

  const selected = getPhoneCountry(iso2) ?? getPhoneCountry(DEFAULT_COUNTRY_ISO)!;

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase().replace(/^\+/, '');
    if (!query) return PHONE_COUNTRIES;
    return PHONE_COUNTRIES.filter((country) => {
      return (
        country.name.toLowerCase().includes(query) ||
        country.dialCode.startsWith(query) ||
        country.iso2.toLowerCase() === query
      );
    });
  }, [search]);

  /** Emit only valid E.164 (or an intentional clear); never partial input. */
  function emit(nextIso2: string, nextNational: string) {
    const result = combinePhone(nextIso2, nextNational);
    if (!result.ok) return null;
    if (result.e164 !== value) {
      lastValueRef.current = result.e164;
      onChange(result.e164);
    }
    return result.e164;
  }

  function handleNationalChange(raw: string) {
    setTouched(true);
    setNational(raw);
    setError(null);

    // `combinePhone` treats explicit `+`/`00` input as complete international,
    // so the selected country is ignored for that value. Do not rewrite the
    // field while the customer is still typing it.
    const result = combinePhone(iso2, raw);
    if (!result.ok) return;
    if (result.e164 !== value) {
      lastValueRef.current = result.e164;
      onChange(result.e164);
    }
  }

  function handleNationalBlur() {
    if (!touched) return;
    if (!national.trim()) {
      setError(null);
      return;
    }
    const result = combinePhone(iso2, national);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setError(null);
    // Once typing is finished, show the country the completed number belongs
    // to. This keeps the selector accurate without disturbing the keystrokes.
    if (/^(\+|00)/.test(national.trim())) {
      const split = splitE164(result.e164);
      if (split) {
        setIso2(split.iso2);
        setNational(split.national);
      }
    }
  }

  function selectCountry(country: PhoneCountry) {
    setIso2(country.iso2);
    setOpen(false);
    setSearch('');
    setError(null);
    setTouched(true);
    const e164 = emit(country.iso2, national);
    if (e164 === null && national.trim()) {
      const result = combinePhone(country.iso2, national);
      setError(result.ok ? null : result.error);
    }
  }

  return (
    <div ref={containerRef} className="relative">
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => setOpen((prev) => !prev)}
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-label={`Country calling code: ${selected.name} +${selected.dialCode}`}
          className="flex h-[42px] shrink-0 items-center gap-1 rounded-lg border border-line bg-field px-2.5 text-sm text-ink transition-colors hover:border-line-strong focus:border-accent-500 focus:outline-none focus:ring-2 focus:ring-accent-500/25"
        >
          <span aria-hidden="true" className="text-base leading-none">
            {countryFlag(selected.iso2)}
          </span>
          <span className="tabular-nums">+{selected.dialCode}</span>
          <ChevronDown className="h-3.5 w-3.5 text-ink-faint" aria-hidden="true" />
        </button>
        <div className="min-w-0 flex-1">
          <Input
            id={id}
            type="tel"
            inputMode="tel"
            maxLength={30}
            autoComplete={autoComplete}
            placeholder={placeholder}
            className={className}
            value={national}
            onChange={(event) => handleNationalChange(event.target.value)}
            onBlur={handleNationalBlur}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? `${id}-error` : undefined}
          />
        </div>
      </div>

      {error && (
        <p id={`${id}-error`} role="alert" className="mt-1.5 text-xs font-medium text-bad">
          {error}
        </p>
      )}

      {open && (
        <div className="absolute left-0 top-full z-50 mt-1 w-72 max-w-[calc(100vw-2rem)] overflow-hidden rounded-lg border border-line bg-field shadow-lg">
          <div className="flex items-center gap-2 border-b border-line px-3">
            <Search className="h-4 w-4 shrink-0 text-ink-faint" aria-hidden="true" />
            <input
              ref={searchRef}
              type="text"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search country or code"
              aria-label="Search country or calling code"
              className="h-10 w-full bg-transparent text-sm text-ink placeholder:text-ink-faint focus:outline-none"
            />
          </div>
          <ul role="listbox" aria-label="Countries" className="max-h-64 overflow-y-auto py-1">
            {filtered.length === 0 && (
              <li className="px-3 py-2 text-sm text-ink-faint">No countries found</li>
            )}
            {filtered.map((country) => {
              const isSelected = country.iso2 === selected.iso2;
              return (
                <li key={country.iso2} role="option" aria-selected={isSelected}>
                  <button
                    type="button"
                    onClick={() => selectCountry(country)}
                    className={cn(
                      'flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-ink hover:bg-accent-500/10',
                      isSelected && 'bg-accent-500/10'
                    )}
                  >
                    <span aria-hidden="true" className="text-base leading-none">
                      {countryFlag(country.iso2)}
                    </span>
                    <span className="min-w-0 flex-1 truncate">{country.name}</span>
                    <span className="shrink-0 tabular-nums text-ink-mute">+{country.dialCode}</span>
                    {isSelected && <Check className="h-3.5 w-3.5 shrink-0 text-accent-500" aria-hidden="true" />}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
