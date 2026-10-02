'use client';

/**
 * ReviewAssistantFlow — the public mobile-first review-writing flow.
 *
 * A writing assistant, NOT a positive-review generator: the customer supplies
 * their own words, the AI only phrases them. Everything here is editable and
 * the customer copies + posts to Google themselves.
 *
 * Generation flow (single, from the customer's perspective):
 *   1. Category-driven template suggestions first (zero OpenAI calls).
 *   2. If no category/eligible templates exist and the customer wrote enough
 *      for the AI to be meaningful (20+ chars), the AI phrases their words.
 *   3. "Write it with AI instead" locks the manual composer to the AI flow;
 *      "Use my words as my review" hands full control back to the customer.
 *
 * Layout (consumer UX, progressive disclosure): identity → hero question →
 * suggested reviews (hero) → "Want to write your own?" → manual composer
 * (revealed on demand) → Generate Review → "Your review" → Google CTA.
 */

import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, animate, motion, useReducedMotion } from 'framer-motion';
import {
  ArrowLeft,
  Check,
  ChevronDown,
  ClipboardCopy,
  ExternalLink,
  Loader2,
  PenLine,
  RefreshCw,
  Sparkles,
} from 'lucide-react';
import type { ReviewPreferredLength } from '@/types';
import { cn } from '@/lib/utils';
import { isSafeExternalUrl, safeExternalUrl } from '@/lib/safe-url';

interface ReviewAssistantConfig {
  googleReviewUrl: string;
  welcomeMessage: string;
  writingStyle: string;
  preferredLength: ReviewPreferredLength;
  languages: string[];
  feedbackTopics: string[];
}

interface ReviewAssistantFlowProps {
  alias: string;
  businessName: string;
  avatarUrl?: string;
  initials: string;
  config: ReviewAssistantConfig;
}

interface TemplateSuggestion {
  templateId: string;
  text: string;
}

const LENGTH_OPTIONS: { value: ReviewPreferredLength; label: string }[] = [
  { value: 'short', label: 'Short' },
  { value: 'medium', label: 'Medium' },
  { value: 'detailed', label: 'Detailed' },
];

// Session repetition control (M14): the recently-displayed template ids live
// in sessionStorage under review:hist:{alias} so a refresh in the same session
// keeps excluding them. Bounded window; template ids only — never review text,
// feedback, or business configuration.
const HISTORY_KEY_PREFIX = 'review:hist:';
const HISTORY_CAP = 12;

function readRecentHistory(alias: string): string[] {
  try {
    const raw = window.sessionStorage.getItem(`${HISTORY_KEY_PREFIX}${alias}`);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((v): v is string => typeof v === 'string' && /^[0-9a-fA-F]{24}$/.test(v))
      .slice(-HISTORY_CAP);
  } catch {
    return [];
  }
}

function writeRecentHistory(alias: string, ids: string[]): void {
  try {
    window.sessionStorage.setItem(
      `${HISTORY_KEY_PREFIX}${alias}`,
      JSON.stringify(ids.slice(-HISTORY_CAP))
    );
  } catch {
    /* non-critical — exclusion degrades to the global rotation baseline */
  }
}

/** Append served template ids, deduped, keeping only the recent bounded window. */
function appendHistory(current: string[], served: string[]): string[] {
  const seen = new Set(current);
  const next = [...current];
  for (const id of served) {
    if (typeof id !== 'string' || !/^[0-9a-fA-F]{24}$/.test(id)) continue;
    if (seen.has(id)) continue;
    seen.add(id);
    next.push(id);
  }
  return next.slice(-HISTORY_CAP);
}

/** The AI only rewrites a meaningful amount of the customer's own words. */
const AI_MIN_FEEDBACK_CHARS = 20;

/** Single-suggestion status copy — served one at a time, replaced on regenerate. */
const readyStatus = (count: number): string =>
  count === 1
    ? '1 suggestion ready — use it or keep writing.'
    : `${count} suggestions ready — pick one or keep writing.`;

type GenerationMode = 'template' | 'ai';

function track(alias: string, action: string): void {
  void fetch('/api/public/track', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    keepalive: true,
    body: JSON.stringify({ alias, action }),
  }).catch(() => {});
}

/** Best-effort copy with a legacy fallback; returns whether we actually copied. */
async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through to the legacy path */
  }
  const area = document.createElement('textarea');
  area.value = text;
  area.setAttribute('readonly', '');
  area.style.position = 'fixed';
  area.style.top = '-9999px';
  document.body.appendChild(area);
  area.select();
  let ok = false;
  try {
    ok = document.execCommand('copy');
  } catch {
    ok = false;
  }
  document.body.removeChild(area);
  return ok;
}

const inputClass =
  'w-full rounded-xl border border-gray-200 bg-white px-3.5 py-2.5 text-sm text-gray-900 placeholder-gray-400 transition-colors focus:border-[var(--v-accent)] focus:outline-none focus:ring-2 focus:ring-[var(--v-accent)]/25';
const primaryButtonClass =
  'flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-[var(--v-accent)] text-sm font-semibold text-[var(--v-on-accent)] transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--v-accent)] focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50';
const secondaryButtonClass =
  'flex h-12 w-full items-center justify-center gap-2 rounded-xl border border-[var(--v-border)] bg-[var(--v-surface)] text-sm font-semibold text-[var(--v-text)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--v-accent)]';

/**
 * Typewriter reveal for review text, driven by an `animate()` motion value so
 * each character never triggers a React re-render (smooth, cheap) and the
 * running animation can be stopped + cleaned the instant the text changes.
 * The target text is laid out invisibly first so the card keeps its height and
 * never jumps while typing; the visible stream is drawn over it, so neither a
 * language switch nor a regenerate can splice the old prefix with new content.
 * Reduced-motion users receive the full text in a single commit.
 */
function TypewriterText({
  text,
  className,
  intervalMs = 24,
}: {
  text: string;
  className?: string;
  intervalMs?: number;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const reduced = useReducedMotion();
  const [typing, setTyping] = useState(false);

  useEffect(() => {
    if (reduced) return;
    const node = ref.current;
    if (!node) return;
    node.textContent = '';
    setTyping(true);
    const controls = animate(0, text.length, {
      duration: Math.min(4.5, Math.max(0.6, (text.length * intervalMs) / 1000)),
      ease: 'linear',
      onUpdate: (count) => {
        node.textContent = text.slice(0, Math.round(count));
      },
      onComplete: () => setTyping(false),
    });
    return () => {
      controls.stop();
      setTyping(false);
      // Leave the fully-revealed text behind if a parent swap cancels us, so
      // nothing ever flashes blank mid-transition.
      node.textContent = text;
    };
  }, [text, reduced, intervalMs]);

  // Reduced motion (or an empty review) — commit in one shot.
  if (reduced || text.length === 0) {
    return <span className={className}>{text}</span>;
  }

  return (
    <span className={cn('relative inline-block w-full align-top', className)}>
      {/* Invisible full copy holds the layout while the stream draws over it. */}
      <span className="invisible whitespace-pre-wrap">{text}</span>
      <span className="pointer-events-none absolute inset-0 whitespace-pre-wrap" aria-hidden="true">
        <span ref={ref} />
        {typing && (
          <motion.span
            aria-hidden="true"
            className="ml-0.5 inline-block h-[1em] w-[3px] translate-y-[0.15em] rounded-full bg-[var(--v-accent)]"
            animate={{ opacity: [1, 0.1, 1] }}
            transition={{ duration: 1, repeat: Infinity, ease: 'easeInOut' }}
          />
        )}
      </span>
    </span>
  );
}

/**
 * The single-suggestion review card — the hero interaction of the flow. The
 * review text types itself in, then the three actions (Use / Copy / Regenerate)
 * become available. Regeneration swaps the card in place via AnimatePresence,
 * so there is never an empty or overlapping frame between suggestions.
 */
function SuggestionCard({
  item,
  index,
  generating,
  copying,
  onUse,
  onCopy,
  onRegenerate,
}: {
  item: TemplateSuggestion;
  index: number;
  generating: boolean;
  copying: boolean;
  onUse: () => void;
  onCopy: (text: string) => void;
  onRegenerate: () => void;
}) {
  return (
    <motion.li
      layout
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -6 }}
      transition={{ duration: 0.25, ease: 'easeOut' }}
      className="rounded-2xl border border-[var(--v-border)] bg-[var(--v-surface)] p-5 text-left shadow-sm"
    >
      <blockquote id={`ra-suggestion-${index}`} className="text-[15px] leading-7 text-[var(--v-text)]">
        <TypewriterText text={item.text} />
      </blockquote>

      <div className={cn('mt-4 space-y-2.5', generating && 'pointer-events-none opacity-60')}>
        <button
          type="button"
          disabled={generating}
          onClick={onUse}
          aria-describedby={`ra-suggestion-${index}`}
          className={primaryButtonClass}
        >
          Use this review
        </button>
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            disabled={generating}
            onClick={() => onCopy(item.text)}
            className={cn(secondaryButtonClass, 'gap-1.5 px-2 text-[13px]')}
          >
            {copying ? (
              <motion.span
                key="copied"
                initial={{ scale: 0.6, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ type: 'spring', stiffness: 500, damping: 25 }}
                className="flex items-center gap-1.5 text-green-600"
              >
                <Check className="h-4 w-4" aria-hidden="true" />
                Copied
              </motion.span>
            ) : (
              <span className="flex items-center gap-1.5">
                <ClipboardCopy className="h-4 w-4" aria-hidden="true" />
                Copy to Clipboard
              </span>
            )}
          </button>
          <button
            type="button"
            disabled={generating}
            onClick={onRegenerate}
            className={cn(secondaryButtonClass, 'gap-1.5 px-2 text-[13px]')}
          >
            <RefreshCw className={cn('h-4 w-4', generating && 'animate-spin')} aria-hidden="true" />
            Regenerate
          </button>
        </div>
      </div>
    </motion.li>
  );
}

export function ReviewAssistantFlow({
  alias,
  businessName,
  avatarUrl,
  initials,
  config,
}: ReviewAssistantFlowProps) {
  const [selectedTopics, setSelectedTopics] = useState<string[]>([]);
  const [feedback, setFeedback] = useState('');
  const [language, setLanguage] = useState(config.languages[0] ?? 'English');
  const [length, setLength] = useState<ReviewPreferredLength>(config.preferredLength);

  const [draft, setDraft] = useState('');
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  // "Copy to Clipboard" success state for the suggestion card's own action.
  const [cardCopied, setCardCopied] = useState(false);
  const [suggestions, setSuggestions] = useState<TemplateSuggestion[]>([]);
  const [mode, setMode] = useState<GenerationMode>('template');
  const [selfWrite, setSelfWrite] = useState(false);
  const [status, setStatus] = useState('');
  // Whether the currently shown suggestions came from the initial-load request
  // (drives the "get you started" heading vs. the regular suggestions heading).
  const [initialSuggestions, setInitialSuggestions] = useState(false);
  // Progressive disclosure: the manual composer (topics/textarea/options/
  // generate) stays collapsed until the customer asks for it.
  const [showManualComposer, setShowManualComposer] = useState(false);

  const startedRef = useRef(false);
  const pageViewRef = useRef(false);
  // M14: session-scoped history of rendered template ids (source of truth for
  // exclusions), plus guards so the initial request never double-fires in dev
  // (StrictMode) and a stale response can never clobber a newer one.
  const historyRef = useRef<string[]>([]);
  const initialRequestedRef = useRef(false);
  const requestSeqRef = useRef(0);

  /* Privacy-conscious analytics: fire-and-forget, metadata-free. */
  useEffect(() => {
    if (pageViewRef.current) return;
    pageViewRef.current = true;
    track(alias, 'review_page_view');
  }, [alias]);

  /* M14-A: fire one template-only suggestions request on load — no feedback,
     no topics, no OpenAI. Loads the visitor's session history first and uses
     the configured language/length. Renders suggestions immediately when one
     or more are served; any failure/empty result silently keeps the existing
     input UI. */
  useEffect(() => {
    if (initialRequestedRef.current) return;
    initialRequestedRef.current = true;
    const history = readRecentHistory(alias);
    historyRef.current = history;
    const seq = ++requestSeqRef.current;
    const initialLanguage = config.languages[0] ?? 'English';
    const initialLength = config.preferredLength;
    void (async () => {
      try {
        const res = await fetch(
          `/api/public/reviews/${encodeURIComponent(alias)}/suggestions`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              language: initialLanguage,
              length: initialLength,
              excludeTemplateIds: history,
              init: true,
            }),
          }
        );
        const data = (await res.json().catch(() => null)) as
          | { mode?: string; suggestions?: TemplateSuggestion[] }
          | null;
        if (!res.ok || data?.mode !== 'template' || !data.suggestions?.length) return;
        if (seq !== requestSeqRef.current) return;
        setSuggestions(data.suggestions);
        setInitialSuggestions(true);
        const ids = data.suggestions.map((s) => s.templateId).filter(Boolean) as string[];
        const next = appendHistory(history, ids);
        historyRef.current = next;
        writeRecentHistory(alias, next);
        setStatus(readyStatus(data.suggestions.length));
      } catch {
        /* never break the page — fall back to the existing input UI */
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one initial fetch per alias mount; config is stable per page load.
  }, [alias]);

  const googleUrl = safeExternalUrl(config.googleReviewUrl);
  const hasGoogleUrl = isSafeExternalUrl(config.googleReviewUrl ?? '');
  const trimmedFeedback = feedback.trim();
  const aiGated = trimmedFeedback.length >= AI_MIN_FEEDBACK_CHARS;
  // In template mode the button stays usable from the start: as soon as sample
  // suggestions render, or once the customer has a draft, they can request
  // different suggestions without first typing feedback.
  const canGenerate =
    (mode === 'ai'
      ? aiGated
      : trimmedFeedback.length > 0 || suggestions.length > 0 || draft.length > 0) &&
    !generating;
  const hasDraft = draft.length > 0 || selfWrite;

  const toggleTopic = (topic: string) => {
    setSelectedTopics((prev) =>
      prev.includes(topic) ? prev.filter((t) => t !== topic) : [...prev, topic]
    );
  };

  async function runGenerate(
    nextLength: ReviewPreferredLength,
    forceAi = false,
    forceTemplate = false
  ) {
    if (generating) return;
    const aiMode = forceTemplate ? false : forceAi || mode === 'ai';
    setMode(aiMode ? 'ai' : 'template');
    setSelfWrite(false);
    setCopyFailed(false);
    setError(null);
    setGenerating(true);
    // M15 scroll-stability: keep the current suggestions visible and dimmed
    // while regenerating so the suggestions section never collapses mid-scroll
    // (a shrink above the viewport makes the browser clamp scrollTop to 0 and
    // the page jumps to the top). The list is cleared only in the settled
    // terminal branches below; once the AI settles, the draft section carries
    // the flow and the suggestions region collapses by design with the user
    // already at the point of action.
    setInitialSuggestions(false);
    setStatus(aiMode ? 'Writing your draft…' : 'Looking for review ideas…');
    if (!startedRef.current) {
      startedRef.current = true;
      track(alias, 'review_started');
    }
    const seq = ++requestSeqRef.current;
    try {
      // Category-driven template mode first — zero OpenAI calls.
      if (!aiMode) {
        const sres = await fetch(
          `/api/public/reviews/${encodeURIComponent(alias)}/suggestions`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              topics: selectedTopics,
              language,
              length: nextLength,
              excludeTemplateIds: historyRef.current,
            }),
          }
        );
        const sdata = (await sres.json().catch(() => null)) as
          | { mode?: string; suggestions?: TemplateSuggestion[] }
          | null;
        if (sres.ok && sdata?.mode === 'template' && sdata.suggestions?.length) {
          if (seq !== requestSeqRef.current) return;
          setSuggestions(sdata.suggestions);
          const ids = sdata.suggestions.map((s) => s.templateId).filter(Boolean) as string[];
          const next = appendHistory(historyRef.current, ids);
          historyRef.current = next;
          writeRecentHistory(alias, next);
          setStatus(readyStatus(sdata.suggestions.length));
          return;
        }
        if (!aiGated) {
          setSuggestions([]);
          setError(
            "We couldn't find a template that fits — add a sentence or two more and we can phrase it for you."
          );
          setStatus('');
          return;
        }
      }

      // AI fallback (only meaningful with enough of the customer's own words).
      if (!aiGated) {
        setSuggestions([]);
        setError(
          'Please write at least a sentence or two so we can phrase your experience accurately — or pick a template above.'
        );
        return;
      }

      const res = await fetch(`/api/public/reviews/${encodeURIComponent(alias)}/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          feedback: trimmedFeedback,
          topics: selectedTopics,
          language,
          length: nextLength,
        }),
      });
      const data = (await res.json().catch(() => null)) as
        | { review?: string; error?: string; code?: string }
        | null;
      if (!res.ok || !data?.review) {
        setSuggestions([]);
        if (data?.code === 'UNAVAILABLE') {
          setError(
            "AI review-writing isn't available for this business right now — you can still write your own review below."
          );
        } else if (data?.code === 'LIMIT_REACHED') {
          setError(
            data?.error ??
              "We're all out of AI drafts for today — you can still write your own review below."
          );
        } else if (res.status === 429) {
          setError('Too many requests — try again in a minute.');
        } else {
          setError(data?.error ?? 'Couldn’t generate a draft. Please try again.');
        }
        setStatus('');
        return;
      }
      if (seq !== requestSeqRef.current) return;
      setSuggestions([]);
      setDraft(data.review);
      setStatus('Draft ready — edit, copy, and post it to Google.');
    } catch {
      setSuggestions([]);
      setError('Couldn’t reach the review assistant. Please try again.');
      setStatus('');
    } finally {
      setGenerating(false);
    }
  }

  const pickSuggestion = (index: number) => {
    const item = suggestions[index];
    if (!item) return;
    setDraft(item.text);
    setSuggestions([]);
    setStatus('Template added to your draft — edit and copy below.');
    track(alias, 'review_template_used');
  };

  /** Progressive disclosure: reveal the manual composer (template-first). */
  const openManualComposer = () => {
    setMode('template');
    setError(null);
    setShowManualComposer(true);
  };

  /** Progressive disclosure: reveal the manual composer, AI-first, without
      firing anything yet — the customer still writes their own words and the
      20-character gate is enforced inside runGenerate. */
  const openAiComposer = () => {
    setMode('ai');
    setError(null);
    setShowManualComposer(true);
  };

  /** Collapse the manual composer back to the suggestion experience without
      discarding the customer's input (feedback/topics/language/length stay in
      state) and without firing any new request — suggestions remain mounted
      and simply become the visible flow again. */
  const closeManualComposer = () => {
    setShowManualComposer(false);
  };

  /** Hand full control to the customer — never requires the AI. */
  const writeItMyself = () => {
    setError(null);
    setSuggestions([]);
    setCopyFailed(false);
    setSelfWrite(true);
    setDraft(trimmedFeedback);
    setStatus(
      trimmedFeedback
        ? 'Your own words are ready — edit freely, then copy and post to Google.'
        : 'Write your review here, then copy and post it to Google.'
    );
  };

  const handleChangeLength = (next: ReviewPreferredLength) => {
    setLength(next);
    // Suggestions reflect the length they were generated for — refresh them so
    // what's shown matches the selected length. An already-created draft is
    // never silently replaced; regenerating applies the new length instead.
    // (M14: initial suggestions can exist without feedback, so refresh whenever
    // suggestions are shown — the draft is only ever set by pick/AI/myself.)
    if (suggestions.length > 0 && !generating) {
      void runGenerate(next, false, true);
    }
  };

  async function handleCopy() {
    if (!draft) return;
    const ok = await copyToClipboard(draft);
    if (ok) {
      setCopyFailed(false);
      setCopied(true);
      setStatus('Copied — paste it into Google (hold and tap the text box).');
      track(alias, 'review_copied');
      window.setTimeout(() => setCopied(false), 3000);
    } else {
      setCopyFailed(true);
      setStatus("Couldn't copy automatically — select the text and copy it manually.");
    }
  }

  const handleGoogleClick = () => {
    if (!hasGoogleUrl) return;
    track(alias, 'review_google_clicked');
    // Copy convenience — never blocks navigation, never claims success.
    if (draft) {
      void copyToClipboard(draft).then((ok) => {
        if (ok) {
          setCopied(true);
          setStatus('Copied — paste it into Google (hold and tap the text box).');
          track(alias, 'review_copied');
          window.setTimeout(() => setCopied(false), 8000);
        }
      });
    }
  };

  /** Copy a suggestion straight from the card, with a temporary check state. */
  const handleCardCopy = async (text: string) => {
    const ok = await copyToClipboard(text);
    if (ok) {
      setCardCopied(true);
      setStatus('Copied — paste it into Google (hold and tap the text box).');
      track(alias, 'review_copied');
      window.setTimeout(() => setCardCopied(false), 3000);
    }
  };

  // A fresh suggestion (or a regenerate) resets the card's copy checkmark so a
  // stale "Copied" never clings to new content.
  useEffect(() => {
    setCardCopied(false);
  }, [suggestions]);

  return (
    <main className="mx-auto flex w-full max-w-md flex-col space-y-6 px-4 pb-10 pt-6 text-center sm:my-8 sm:rounded-2xl sm:border sm:border-[var(--v-border)] sm:bg-[var(--v-surface)] sm:p-6">
      {/* Screen-reader announcements for async outcomes. */}
      <p aria-live="polite" role="status" className="sr-only">
        {status}
      </p>

      {/* Business identity — clean, centered, minimal */}
      <header className="flex flex-col items-center">
        <span
          aria-hidden="true"
          className="relative inline-flex h-11 w-11 shrink-0 select-none items-center justify-center overflow-hidden rounded-full bg-[var(--v-accent)] align-middle"
        >
          {avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- plain img per public-portal spec
            <img
              src={avatarUrl}
              alt=""
              loading="eager"
              decoding="async"
              className="absolute inset-0 h-full w-full object-cover"
            />
          ) : (
            <span className="text-sm font-bold leading-none text-[var(--v-on-accent)]">
              {initials || '?'}
            </span>
          )}
        </span>
        <p className="mt-2 truncate text-base font-semibold text-[var(--v-text)]">{businessName}</p>
        <p className="mt-0.5 inline-flex items-center gap-1 text-xs font-medium text-[var(--v-accent)]">
          <Sparkles className="h-3 w-3" aria-hidden="true" />
          Leave a review
        </p>
      </header>

      {/* Hero question */}
      <div className="space-y-2">
        <h1 className="text-xl font-bold leading-snug text-[var(--v-text)] sm:text-2xl">
          How was your experience?
        </h1>
        <p className="text-sm leading-relaxed text-[var(--v-muted)]">
          {config.welcomeMessage.trim() ||
            `Tell ${businessName} about your experience. We’ll help you write it — you stay in control.`}
        </p>
      </div>

      {/* Suggested reviews — the hero interaction when templates are available.
          Stays mounted while generating (dimmed) so the section never
          collapses mid-scroll (M15). */}
      {!hasDraft && (suggestions.length > 0 || generating) && (
        <section className="space-y-3" aria-labelledby="ra-suggestions-heading">
          <div className="flex items-center justify-between gap-3">
            <h2 id="ra-suggestions-heading" className="text-left text-[13px] font-semibold text-[var(--v-text)]">
              {generating
                ? 'Updating suggestion…'
                : initialSuggestions
                  ? 'Here’s a suggestion to get you started'
                  : 'Another suggestion'}
            </h2>
            {generating && (
              <span className="inline-flex items-center gap-1 text-[11px] font-medium text-[var(--v-muted)]">
                <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
                Updating…
              </span>
            )}
          </div>
          {suggestions.length > 0 ? (
            <ul
              className={cn('space-y-2.5 text-left', generating && 'opacity-70')}
              role="list"
            >
              <AnimatePresence initial={false} mode="popLayout">
                {suggestions.map((item, index) => (
                  <SuggestionCard
                    key={item.templateId}
                    item={item}
                    index={index}
                    generating={generating}
                    copying={cardCopied}
                    onUse={() => pickSuggestion(index)}
                    onCopy={(text) => void handleCardCopy(text)}
                    onRegenerate={() => void runGenerate(length, false, true)}
                  />
                ))}
              </AnimatePresence>
            </ul>
          ) : (
            // Skeleton only while a (re)generation is in flight with nothing to
            // show — never permanent whitespace.
            generating && (
              <div className="space-y-2.5" role="status" aria-label="Loading suggestion">
                <div className="h-24 animate-pulse rounded-xl border border-[var(--v-border)] bg-[var(--v-surface)]" />
              </div>
            )
          )}
        </section>
      )}

      {/* "Want to write your own?" — quiet entry to the manual composer. */}
      {!hasDraft && !showManualComposer && (
        <div className="space-y-3">
          <p className="text-sm font-medium text-[var(--v-text)]">Want to write your own?</p>
          <button
            type="button"
            onClick={openManualComposer}
            className={secondaryButtonClass}
          >
            <PenLine className="h-4 w-4" aria-hidden="true" />
            Write my own review →
          </button>
          <button
            type="button"
            onClick={openAiComposer}
            className="inline-flex min-h-11 w-full items-center justify-center gap-1.5 text-xs font-medium text-[var(--v-accent)] transition-opacity hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--v-accent)] focus-visible:ring-offset-2"
          >
            <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
            Write it with AI instead
          </button>
        </div>
      )}

      {/* Manual composer — only revealed after the customer asks for it. */}
      {!hasDraft && showManualComposer && (
        <section className="space-y-4 text-left" aria-labelledby="ra-manual-heading">
          {/* Back — quiet exit to the suggestion experience. */}
          <button
            type="button"
            onClick={closeManualComposer}
            className="-ml-2 inline-flex min-h-11 items-center gap-1.5 text-left text-xs font-medium text-[var(--v-muted)] transition-colors hover:text-[var(--v-text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--v-accent)] focus-visible:ring-offset-2"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            Back to suggestions
          </button>
          <h2 id="ra-manual-heading" className="text-left text-base font-semibold text-[var(--v-text)]">
            Write your own review
          </h2>

          {/* Feedback topics */}
          {config.feedbackTopics.length > 0 && (
            <section aria-labelledby="ra-topics-heading">
              <h3 id="ra-topics-heading" className="mb-2 text-[13px] font-medium text-[var(--v-text)]">
                What did your experience cover? <span className="font-normal text-[var(--v-muted)]">(optional)</span>
              </h3>
              <div className="flex flex-wrap gap-2">
                {config.feedbackTopics.map((topic) => {
                  const active = selectedTopics.includes(topic);
                  return (
                    <button
                      key={topic}
                      type="button"
                      aria-pressed={active}
                      onClick={() => toggleTopic(topic)}
                      className={cn(
                        'min-h-10 items-center rounded-full border px-3.5 py-2 text-[13px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--v-accent)]',
                        active
                          ? 'border-[var(--v-accent)] bg-[var(--v-accent)] text-[var(--v-on-accent)]'
                          : 'border-[var(--v-border)] bg-[var(--v-surface)] text-[var(--v-text)]'
                      )}
                    >
                      {topic}
                    </button>
                  );
                })}
              </div>
            </section>
          )}

          {/* Experience input */}
          <div>
            <label
              htmlFor="ra-feedback"
              id="ra-feedback-heading"
              className="mb-2 block text-[13px] font-semibold text-[var(--v-text)]"
            >
              Describe your experience in your own words
            </label>
            <textarea
              id="ra-feedback"
              rows={5}
              maxLength={5000}
              placeholder="What stood out? How were you treated? What did you love (or not)?"
              className={cn(inputClass, 'resize-y')}
              value={feedback}
              onChange={(event) => setFeedback(event.target.value)}
              aria-describedby="ra-feedback-hint"
            />
            <p id="ra-feedback-hint" className="mt-1.5 text-xs text-[var(--v-muted)]">
              {aiGated
                ? 'Thanks — we’ll only use your own words.'
                : trimmedFeedback.length > 0
                  ? 'A little more detail helps us phrase it accurately.'
                  : 'Anything you share stays your own — we only help you phrase it.'}
            </p>
          </div>

          {/* Options row: language + length */}
          <div className="grid grid-cols-1 items-start gap-5 sm:grid-cols-2">
            {/* Language */}
            {config.languages.length > 0 && (
              <section aria-labelledby="ra-language-heading">
                <label
                  htmlFor="ra-language"
                  id="ra-language-heading"
                  className="mb-2 block text-[13px] font-semibold text-[var(--v-text)]"
                >
                  Review language
                </label>
                <div className="relative">
                  <select
                    id="ra-language"
                    value={language}
                    onChange={(event) => setLanguage(event.target.value)}
                    className={cn(inputClass, 'appearance-none pr-9')}
                  >
                    {config.languages.map((lang) => (
                      <option key={lang} value={lang}>
                        {lang}
                      </option>
                    ))}
                  </select>
                  <ChevronDown
                    className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--v-muted)]"
                    aria-hidden="true"
                  />
                </div>
              </section>
            )}

            {/* Draft length */}
            <section aria-labelledby="ra-length-heading">
              <label id="ra-length-heading" className="mb-2 block text-[13px] font-semibold text-[var(--v-text)]">
                Draft length
              </label>
              <div
                role="group"
                aria-label="Draft length"
                className="grid grid-cols-3 gap-1 rounded-xl bg-[var(--v-surface)] p-1 ring-1 ring-[var(--v-border)]"
              >
                {LENGTH_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    aria-pressed={length === opt.value}
                    onClick={() => handleChangeLength(opt.value)}
                    className={cn(
                      'flex h-9 items-center justify-center rounded-lg text-[12px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--v-accent)]',
                      length === opt.value
                        ? 'bg-[var(--v-accent)] text-[var(--v-on-accent)]'
                        : 'text-[var(--v-muted)]'
                    )}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </section>
          </div>
        </section>
      )}

      {/* Generate Review — inside the manual composer. */}
      {!hasDraft && showManualComposer && (
        <div className="space-y-3">
          <button
            type="button"
            disabled={!canGenerate}
            onClick={() => void runGenerate(length, mode === 'ai')}
            className={cn(primaryButtonClass, generating && 'opacity-70')}
          >
            {generating ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                Working…
              </>
            ) : (
              <>
                <Sparkles className="h-4 w-4" aria-hidden="true" />
                Generate Review
              </>
            )}
          </button>

          {/* Own-words path — the customer's words are the review, never AI. */}
          <button
            type="button"
            onClick={writeItMyself}
            className="inline-flex min-h-11 w-full items-center justify-center gap-1.5 text-xs font-medium text-[var(--v-muted)] transition-colors hover:text-[var(--v-text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--v-accent)]"
          >
            <PenLine className="h-3.5 w-3.5" aria-hidden="true" />
            Use my words as my review
          </button>
        </div>
      )}

      {error && (
        <div className="rounded-xl bg-red-50 px-3.5 py-2.5 ring-1 ring-red-200">
          <p role="alert" className="text-xs leading-relaxed text-red-700">
            {error}
          </p>
        </div>
      )}

      {/* Your review — the terminal draft stage. */}
      {hasDraft && (
        <section className="space-y-3 text-left" aria-labelledby="ra-draft-heading">
          <div className="text-center">
            <h2 id="ra-draft-heading" className="text-base font-semibold text-[var(--v-text)]">
              Your review
            </h2>
            <p className="mt-1 text-sm text-[var(--v-muted)]">
              Edit it until it sounds like you — nothing is posted automatically.
            </p>
          </div>

          <div className="space-y-3 rounded-2xl border border-[var(--v-border)] bg-[var(--v-surface)] p-5 shadow-sm">
            <textarea
              id="ra-draft"
              rows={6}
              aria-label="Editable review draft"
              className={cn(inputClass, 'resize-y')}
              value={draft}
              onChange={(event) => {
                setDraft(event.target.value);
                setSelfWrite(false);
              }}
            />
            {copyFailed && (
              <p className="text-xs font-medium text-red-600">Couldn’t copy automatically — select the text and copy it manually.</p>
            )}

            {/* Copy — secondary to the Google CTA. */}
            <button type="button" onClick={() => void handleCopy()} className={secondaryButtonClass}>
              {copied ? (
                <>
                  <Check className="h-4 w-4 text-green-600" aria-hidden="true" />
                  Copied
                </>
              ) : (
                <>
                  <ClipboardCopy className="h-4 w-4" aria-hidden="true" />
                  Copy review
                </>
              )}
            </button>
          </div>

          {/* Google CTA — the dominant action, full width. */}
          {hasGoogleUrl ? (
            <a
              href={googleUrl}
              target="_blank"
              rel="noopener noreferrer"
              onClick={handleGoogleClick}
              className={primaryButtonClass}
            >
              <ExternalLink className="h-4 w-4" aria-hidden="true" />
              Continue to Google Reviews →
            </a>
          ) : (
            <div className="rounded-xl bg-[var(--v-surface)] px-3.5 py-3 ring-1 ring-[var(--v-border)]">
              <p className="flex min-h-12 items-center justify-center gap-2 text-sm font-semibold text-[var(--v-muted)]">
                <ExternalLink className="h-4 w-4" aria-hidden="true" />
                Continue to Google Reviews →
              </p>
              <p className="mt-1 text-center text-[11px] leading-relaxed text-[var(--v-muted)]">
                {businessName} hasn’t added a Google Reviews link yet — copy your review and post it on Google your way.
              </p>
            </div>
          )}
        </section>
      )}
    </main>
  );
}