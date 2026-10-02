'use client';

/**
 * Theme tab — accent/background colour pairing.
 *
 * Writes draft.themeConfig.accentColor / bgColor. The live strip previews the
 * pairing with real contrast-derived text colours (same helper the preview
 * panel uses). NOTE: today's updateVcardSchema has no themeConfig key, so the
 * draft hook detects when the backend strips it and surfaces
 * themeSaveSupported=false — this tab then shows an honest inline notice.
 */

import { useEffect, useState } from 'react';
import type { ChangeEvent, CSSProperties } from 'react';
import { AlertTriangle } from 'lucide-react';
import { Input } from '@/components/ui';
import { useBuilder } from '../context';
import { readableOn } from '../preview-panel';
import { cn } from '@/lib/utils';

const ACCENT_PRESETS = [
  '#2563EB', // current default
  '#0EA5E9',
  '#10B981',
  '#EC4899',
  '#F59E0B',
  '#8B5CF6',
];

const BG_PRESETS = [
  '#FFFFFF', // current default
  '#F8FAFC',
  '#FFF7ED',
  '#ECFDF5',
  '#EEF2FF',
  '#0F172A',
];

const HEX_RE = /^#?[0-9a-fA-F]{6}$/;

interface ColorRowProps {
  idPrefix: string;
  label: string;
  hint?: string;
  value: string;
  presets: readonly string[];
  onChange: (hex: string) => void;
}

/** One labelled row: native colour picker + editable hex + preset swatches. */
function ColorRow({ idPrefix, label, hint, value, presets, onChange }: ColorRowProps) {
  // Local text state allows partial typing ("#25", "25", …) before committing.
  const [text, setText] = useState(value);
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    if (!focused) setText(value);
  }, [value, focused]);

  const commitText = () => {
    const candidate = text.trim();
    if (HEX_RE.test(candidate)) {
      onChange(`#${candidate.replace('#', '').toUpperCase()}`);
    } else {
      setText(value); // snap back to last valid value
    }
  };

  const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
    setText(event.target.value);
    const candidate = event.target.value.trim();
    if (HEX_RE.test(candidate)) {
      onChange(`#${candidate.replace('#', '').toUpperCase()}`);
    }
  };

  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between gap-3">
        <label htmlFor={`${idPrefix}-color`} className="block text-sm font-medium text-ink-mute">
          {label}
        </label>
        {hint && <span className="text-xs text-ink-faint">{hint}</span>}
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <input
          id={`${idPrefix}-color`}
          type="color"
          aria-label={`${label} picker`}
          className="h-10 w-14 cursor-pointer rounded-lg border border-line-subtle bg-transparent p-1 [color-scheme:dark]"
          value={/^#[0-9a-fA-F]{6}$/i.test(value) ? value : '#000000'}
          onChange={(event) => onChange(event.target.value.toUpperCase())}
        />
        <Input
          aria-label={`${label} hex value`}
          spellCheck={false}
          autoComplete="off"
          maxLength={7}
          className="w-28 font-mono text-[13px] uppercase border-line bg-field text-ink focus:border-accent-500 focus:ring-accent-500/25 hover:border-line-strong"
          value={text}
          onFocus={() => setFocused(true)}
          onBlur={() => {
            setFocused(false);
            commitText();
          }}
          onChange={handleChange}
        />
        <div className="flex items-center gap-1.5" role="group" aria-label={`${label} presets`}>
          {presets.map((preset) => {
            const active = value.toLowerCase() === preset.toLowerCase();
            return (
              <button
                key={preset}
                type="button"
                aria-pressed={active}
                aria-label={`Use ${preset}`}
                title={preset}
                onClick={() => onChange(preset)}
                className={cn(
                  'h-7 w-7 rounded-full ring-2 ring-offset-2 ring-offset-bg-raised transition-transform hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-400',
                  active ? 'ring-accent-400' : 'ring-transparent'
                )}
                style={{ backgroundColor: preset }}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}

export function ThemeTab() {
  const { draft, setField, themeSaveSupported } = useBuilder();
  const accent = draft.themeConfig?.accentColor ?? '#2563EB';
  const bgColor = draft.themeConfig?.bgColor ?? '#FFFFFF';

  const setAccent = (hex: string) =>
    setField('themeConfig.accentColor', hex);
  const setBg = (hex: string) => setField('themeConfig.bgColor', hex);

  return (
    <div className="space-y-5">
      {!themeSaveSupported && (
        <p className="flex items-start gap-2 rounded-lg bg-warn/10 px-3 py-2.5 text-xs leading-relaxed text-warn ring-1 ring-warn/20">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          Theme colours can’t be saved yet — the API schema doesn’t accept
          themeConfig. They still preview here live.
        </p>
      )}

      <ColorRow
        idPrefix="theme-accent"
        label="Accent colour"
        hint="Buttons, links, highlights"
        value={accent}
        presets={ACCENT_PRESETS}
        onChange={setAccent}
      />

      <ColorRow
        idPrefix="theme-bg"
        label="Background colour"
        hint="Public page canvas"
        value={bgColor}
        presets={BG_PRESETS}
        onChange={setBg}
      />

      {/* Live pairing strip */}
      <div>
        <p className="mb-1.5 text-sm font-medium text-ink-mute">Pairing preview</p>
        <div
          className="flex flex-wrap items-center gap-3 rounded-xl p-4 ring-1 ring-line-subtle"
          style={
            {
              '--v-accent': accent,
              '--v-bg': bgColor,
              '--v-on-accent': readableOn(accent),
              '--v-text': readableOn(bgColor),
            } as CSSProperties
          }
        >
          <span
            className="rounded-full px-4 py-2 text-xs font-semibold"
            style={{ backgroundColor: 'var(--v-accent)', color: 'var(--v-on-accent)' }}
          >
            Button
          </span>
          <span
            className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold ring-1"
            style={{
              color: 'var(--v-accent)',
              borderColor: 'var(--v-accent)',
              boxShadow: 'inset 0 0 0 1px var(--v-accent)',
            }}
          >
            Badge
          </span>
          <span className="text-sm font-medium" style={{ color: 'var(--v-text)' }}>
            Name on background
          </span>
          <span className="ml-auto font-mono text-[11px] opacity-70" style={{ color: 'var(--v-text)' }}>
            {accent} / {bgColor}
          </span>
        </div>
      </div>
    </div>
  );
}
