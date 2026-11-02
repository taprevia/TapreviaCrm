'use client';

/**
 * Tenant settings — general preferences.
 *
 * AI Review configuration (including the customer OpenAI provider) lives in
 * /dashboard/review-management. The underlying /api/settings contract is
 * unchanged; this page simply no longer duplicates the customer-facing UI.
 *
 * Saves are section-scoped PATCHes against updateTenantSettingsSchema:
 * - { general: { timeFormat12h, newsletterModalDelaySeconds } }
 */

import { useEffect, useState } from 'react';
import { Clock, Loader2 } from 'lucide-react';
import { Button, Input, Switch, useToast } from '@/components/ui';
import type {
  ApiErrorBody,
  SettingsResponse,
} from '@/components/dashboard/settings/types';

/** Schema bounds mirrored client-side so onBlur clamping matches validation. */
const DELAY_MIN = 0;
const DELAY_MAX = 60;

/** Dark-token overrides for the light-styled Input primitive (inquiries pattern). */
const INPUT_DARK =
  'border-line bg-field text-ink placeholder-ink-faint hover:border-line-strong focus:border-accent-500 focus:ring-accent-500/25';

/** Round + clamp a raw text input; falls back on unparsable garbage. */
function clampInt(raw: string, min: number, max: number, fallback: number): number {
  const n = Math.round(Number(raw));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

export default function SettingsPage() {
  const { toast } = useToast();

  // Hydration state
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  // General draft (delay kept as text for natural typing) + server snapshot.
  const [generalDraft, setGeneralDraft] = useState({ timeFormat12h: true, delayText: '' });
  const [generalSnapshot, setGeneralSnapshot] = useState<{ timeFormat12h: boolean; delay: number } | null>(null);
  const [savingGeneral, setSavingGeneral] = useState(false);

  // Newsletter popup master switch (persisted on the User doc via
  // /api/customer/settings — distinct from the tenant delay above).
  const [newsletterEnabled, setNewsletterEnabled] = useState(false);
  const [newsletterEnabledSnapshot, setNewsletterEnabledSnapshot] = useState<boolean | null>(null);
  const [savingNewsletter, setSavingNewsletter] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);

    fetch('/api/settings', { signal: controller.signal })
      .then(async (res) => {
        const body = (await res.json().catch(() => null)) as (SettingsResponse & ApiErrorBody) | null;
        if (!res.ok) throw new Error(body?.error || 'Failed to load settings');
        return body as SettingsResponse;
      })
      .then((body) => {
        const settings = body.settings;
        const general = settings?.general;
        const timeFormat12h = general?.timeFormat12h ?? true;
        const delay = general?.newsletterModalDelaySeconds ?? 8;

        setGeneralDraft({ timeFormat12h, delayText: String(delay) });
        setGeneralSnapshot({ timeFormat12h, delay });
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setError(err instanceof Error ? err.message : 'Failed to load settings');
        setLoading(false);
      });

    return () => controller.abort();
  }, [reloadKey]);

  useEffect(() => {
    // Hydrate the per-customer newsletter switch from the session user.
    fetch('/api/auth/me')
      .then(async (res) =>
        res.ok ? ((await res.json().catch(() => null)) as { user?: { isNewsletterEnabled?: boolean } } | null) : null
      )
      .then((body) => {
        const flag = Boolean(body?.user?.isNewsletterEnabled);
        setNewsletterEnabled(flag);
        setNewsletterEnabledSnapshot(flag);
      })
      .catch(() => {/* leave defaults; the toggle saves on first flip */});
  }, []);

  function patchSettings(body: Record<string, unknown>): Promise<ApiErrorBody & Record<string, unknown>> {
    return fetch('/api/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).then(async (res) => {
      const data = (await res.json().catch(() => null)) as (ApiErrorBody & Record<string, unknown>) | null;
      if (!res.ok) throw new Error(data?.error || 'Could not save settings');
      return data ?? {};
    });
  }

  async function saveGeneral() {
    if (generalSnapshot === null || !dirtyGeneral) return;
    const nextDelay = clampInt(generalDraft.delayText, DELAY_MIN, DELAY_MAX, generalSnapshot.delay);
    setSavingGeneral(true);
    try {
      await patchSettings({
        general: { timeFormat12h: generalDraft.timeFormat12h, newsletterModalDelaySeconds: nextDelay },
      });
      setGeneralDraft((prev) => ({ ...prev, delayText: String(nextDelay) }));
      setGeneralSnapshot({ timeFormat12h: generalDraft.timeFormat12h, delay: nextDelay });
      toast({ title: 'Settings saved', description: 'General preferences updated.', variant: 'success' });
    } catch (err) {
      toast({
        title: 'Save failed',
        description: err instanceof Error ? err.message : 'Could not save general settings.',
        variant: 'error',
      });
    } finally {
      setSavingGeneral(false);
    }
  }

  async function saveNewsletter(next: boolean) {
    setSavingNewsletter(true);
    try {
      const res = await fetch('/api/customer/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isNewsletterEnabled: next }),
      });
      const data = (await res.json().catch(() => null)) as ({ error?: string } & Record<string, unknown>) | null;
      if (!res.ok) throw new Error(data?.error || 'Could not save preference');
      setNewsletterEnabled(next);
      setNewsletterEnabledSnapshot(next);
      toast({
        title: next ? 'Newsletter popup enabled' : 'Newsletter popup disabled',
        variant: 'success',
      });
    } catch (err) {
      setNewsletterEnabled(newsletterEnabledSnapshot ?? false);
      toast({
        title: 'Save failed',
        description: err instanceof Error ? err.message : 'Could not save preference.',
        variant: 'error',
      });
    } finally {
      setSavingNewsletter(false);
    }
  }

  // Dirty checks vs hydrated snapshots (normalized values, not raw text).
  const dirtyGeneral =
    generalSnapshot !== null &&
    (generalDraft.timeFormat12h !== generalSnapshot.timeFormat12h ||
      clampInt(generalDraft.delayText, DELAY_MIN, DELAY_MAX, generalSnapshot.delay) !==
        generalSnapshot.delay);

  return (
    <div className="animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-bold tracking-tight text-ink">Settings</h1>
      </div>

      {/* Loading: single centered pulse block */}
      {loading && (
        <div
          className="mx-auto mt-6 h-40 w-full max-w-2xl animate-pulse rounded-xl bg-surface ring-1 ring-line-subtle"
          role="status"
          aria-label="Loading settings"
        />
      )}

      {/* Fetch error */}
      {!loading && error && (
        <div className="mt-6 flex items-center justify-between gap-4 rounded-lg bg-bad/10 p-3">
          <p className="text-sm text-bad">{error}</p>
          <Button variant="ghost" size="sm" onClick={() => setReloadKey((k) => k + 1)}>
            Retry
          </Button>
        </div>
      )}

      {!loading && !error && (
        <div className="mt-6 max-w-2xl space-y-6">
          {/* ── S1 · General ─────────────────────────────────────────────── */}
          <section className="rounded-xl bg-surface p-6 ring-1 ring-line-subtle">
            <div className="mb-4 flex items-center gap-2">
              <Clock className="h-4 w-4 text-accent-400" aria-hidden="true" />
              <h2 className="text-base font-semibold text-ink">General</h2>
              {dirtyGeneral && (
                <span className="h-1.5 w-1.5 rounded-full bg-warn" aria-label="Unsaved changes" />
              )}
            </div>

            <div className="divide-y divide-line-subtle">
              {/* 24-hour time */}
              <div className="flex items-center justify-between gap-6 py-4 first:pt-0 last:pb-0">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-ink">24-hour time</p>
                  <p className="text-xs text-ink-mute">Show business hours in 24h format</p>
                </div>
                <Switch
                  checked={!generalDraft.timeFormat12h}
                  onChange={(checked) =>
                    setGeneralDraft((prev) => ({ ...prev, timeFormat12h: !checked }))
                  }
                  aria-label="24-hour time"
                  className="shrink-0"
                />
              </div>

              {/* Enable Newsletter Popup */}
              <div className="flex items-center justify-between gap-6 py-4 first:pt-0 last:pb-0">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-ink">Enable Newsletter Popup</p>
                  <p className="text-xs text-ink-mute">
                    Show the email signup modal on your public profile when someone taps your card
                  </p>
                </div>
                <Switch
                  checked={newsletterEnabled}
                  onChange={(checked) => void saveNewsletter(checked)}
                  disabled={savingNewsletter}
                  aria-label="Enable Newsletter Popup"
                  className="shrink-0"
                />
              </div>

              {/* Newsletter popup delay */}
              <div className="flex items-center justify-between gap-6 py-4 first:pt-0 last:pb-0">
                <div className="min-w-0">
                  <label htmlFor="newsletter-delay" className="block text-sm font-medium text-ink">
                    Newsletter popup delay
                  </label>
                  <p className="text-xs text-ink-mute">
                    Seconds before the signup modal appears (only when the popup is enabled)
                  </p>
                </div>
                <div className="w-20 shrink-0">
                  <Input
                    id="newsletter-delay"
                    type="number"
                    min={DELAY_MIN}
                    max={DELAY_MAX}
                    value={generalDraft.delayText}
                    onChange={(e) => setGeneralDraft((prev) => ({ ...prev, delayText: e.target.value }))}
                    onBlur={() =>
                      setGeneralDraft((prev) => ({
                        ...prev,
                        delayText: String(
                          clampInt(prev.delayText, DELAY_MIN, DELAY_MAX, generalSnapshot?.delay ?? 8)
                        ),
                      }))
                    }
                    className={INPUT_DARK}
                  />
                </div>
              </div>
            </div>

            <div className="mt-5 flex justify-end">
              <Button size="sm" disabled={!dirtyGeneral} onClick={() => void saveGeneral()}>
                {savingGeneral && (
                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                )}
                Save
              </Button>
            </div>
          </section>

        </div>
      )}
    </div>
  );
}
