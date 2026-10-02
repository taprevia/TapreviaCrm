'use client';

/**
 * use-card-draft — editable Card draft state with section-granular dirty
 * tracking and debounced autosave.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useToast } from '@/components/ui/toast';
import type { DayOfWeek, ICard, IReviewAssistantConfig, IServiceItem } from '@/types';
import { DEFAULT_TEMPLATE_KEY } from '@/lib/card-templates';

/* ─── Public types ──────────────────────────────────────────────────────────── */

export type CardDraft = Omit<ICard, 'createdAt' | 'updatedAt'> & {
  createdAt: string;
  updatedAt: string;
};

export interface UploadResult {
  url: string;
  key: string;
  bytes: number;
  width: number;
  height: number;
  mime: string;
}

export type DraftLoadState = 'loading' | 'ready' | 'not-found' | 'error';
export type SaveStatus = 'saving' | 'unsaved' | 'saved';

/* ─── Internals ─────────────────────────────────────────────────────────────── */

const AUTOSAVE_DEBOUNCE_MS = 900;

type DirtyOwner =
  | 'name'
  | 'cardLabel'
  | 'basic'
  | 'urlAlias'
  | 'occupation'
  | 'descriptionHtml'
  | 'templateKey'
  | 'profileImageUrl'
  | 'galleryImages'
  | 'coverType'
  | 'coverStyle'
  | 'coverValue'
  | 'socialLinks'
  | 'services'
  | 'businessHours'
  | 'themeConfig'
  | 'reviewAssistant'
  | 'redirectUrl';

const OWNER_PATH_HEADS: ReadonlySet<string> = new Set<DirtyOwner>([
  'name',
  'cardLabel',
  'basic',
  'urlAlias',
  'occupation',
  'descriptionHtml',
  'templateKey',
  'profileImageUrl',
  'galleryImages',
  'coverType',
  'coverStyle',
  'coverValue',
  'socialLinks',
  'services',
  'businessHours',
  'themeConfig',
  'reviewAssistant',
  'redirectUrl',
]);

const DAY_ORDER: readonly DayOfWeek[] = [
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
];

const BASIC_FIELDS = [
  'firstName',
  'lastName',
  'email',
  'alternateEmail',
  'phone',
  'alternatePhone',
  'company',
  'jobTitle',
  'defaultLanguage',
] as const;

function jsonClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function ownerOfPath(path: string): DirtyOwner | null {
  const head = path.split('.')[0] ?? '';
  if (!OWNER_PATH_HEADS.has(head)) return null;
  return head as DirtyOwner;
}

function getPathValue(source: unknown, path: string): unknown {
  let cur: unknown = source;
  for (const seg of path.split('.')) {
    if (cur === null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[seg];
  }
  return cur;
}

function setPathValue(target: Record<string, unknown>, path: string, value: unknown): void {
  const segments = path.split('.');
  let cur: Record<string, unknown> = target;
  for (let i = 0; i < segments.length - 1; i += 1) {
    const next = cur[segments[i] as string];
    if (next === null || typeof next !== 'object') {
      cur[segments[i] as string] = {};
    }
    cur = cur[segments[i] as string] as Record<string, unknown>;
  }
  cur[segments[segments.length - 1] as string] = value;
}

function canonicalOwnerValue(owner: DirtyOwner, draft: CardDraft): unknown {
  switch (owner) {
    case 'basic': {
      const out: Record<string, string> = {};
      for (const field of BASIC_FIELDS) out[field] = (draft.basic?.[field] ?? '').trim();
      return out;
    }
    case 'socialLinks':
      return sanitizeSocialLinks(Array.isArray(draft.socialLinks) ? draft.socialLinks : []);
    case 'services':
      return sanitizeServices(Array.isArray(draft.services) ? draft.services : []);
    case 'businessHours':
      return normalizeBusinessHours(
        Array.isArray(draft.businessHours) ? draft.businessHours : []
      );
    case 'themeConfig':
      return {
        accentColor: (draft.themeConfig?.accentColor ?? '#2563EB').trim(),
        bgColor: (draft.themeConfig?.bgColor ?? '#FFFFFF').trim(),
      };
    case 'reviewAssistant':
      return canonicalReviewAssistant(draft.reviewAssistant ?? {});
    case 'redirectUrl':
      return (draft.redirectUrl ?? '').trim().slice(0, 2048);
    case 'galleryImages':
      return (Array.isArray(draft.galleryImages) ? draft.galleryImages : [])
        .map((img) => ({
          imageUrl: (img.imageUrl ?? '').trim(),
          caption: (img.caption ?? '').trim().slice(0, 120),
        }))
        .filter((img) => img.imageUrl.length > 0)
        .slice(0, 30);
    default: {
      const raw = (draft as unknown as Record<string, unknown>)[owner];
      return typeof raw === 'string' ? raw.trim() : raw;
    }
  }
}

function sanitizeSocialLinks(
  links: Array<{ platform?: string; url?: string; label?: string; iconUrl?: string }>
) {
  return links
    .map((link) => {
      const row: { platform: string; url: string; label?: string; iconUrl?: string } = {
        platform: (link.platform ?? '').trim(),
        url: (link.url ?? '').trim(),
      };
      const label = link.label?.trim();
      if (label) row.label = label.slice(0, 100);
      const iconUrl = link.iconUrl?.trim();
      if (iconUrl) row.iconUrl = iconUrl.slice(0, 2048);
      return row;
    })
    .filter((link) => {
      if (!link.platform) return false;
      return link.url.startsWith('/') || /^https?:\/\//i.test(link.url);
    })
    .slice(0, 12);
}

function sanitizeServices(
  services: Array<{ title?: string; description?: string }>
): IServiceItem[] {
  const seen = new Set<string>();
  const out: IServiceItem[] = [];
  for (const item of services) {
    const title = (item.title ?? '').trim().slice(0, 120);
    if (!title || seen.has(title)) continue;
    seen.add(title);
    const row: IServiceItem = { title };
    const description = (item.description ?? '').trim().slice(0, 300);
    if (description) row.description = description;
    out.push(row);
    if (out.length >= 30) break;
  }
  return out;
}

function normalizeBusinessHours(hours: Array<Partial<{ day: DayOfWeek; enabled: boolean; from: string; to: string }>>) {
  const byDay = new Map(hours.map((h) => [h.day as DayOfWeek, h]));
  return DAY_ORDER.map(
    (day): { day: DayOfWeek; enabled: boolean; from: string; to: string } => {
      const row = byDay.get(day);
      return {
        day,
        enabled: row?.enabled === true,
        from: row?.from ?? '',
        to: row?.to ?? '',
      };
    }
  );
}

/** Canonical, default-complete reviewAssistant payload sent to the API. */
function cleanTags(tags: string[] | undefined): string[] {
  if (!Array.isArray(tags)) return [];
  return Array.from(new Set(tags.map((t) => t.trim()).filter((t) => t.length > 0))).slice(0, 12);
}

function canonicalReviewAssistant(config: Partial<IReviewAssistantConfig> = {}) {
  return {
    enabled: config.enabled === true,
    googleReviewUrl: (config.googleReviewUrl ?? '').trim().slice(0, 2048),
    writingStyle: (['friendly', 'professional', 'casual', 'simple'] as const).includes(
      config.writingStyle as never
    )
      ? (config.writingStyle as string)
      : 'friendly',
    preferredLength: (['short', 'medium', 'detailed'] as const).includes(
      config.preferredLength as never
    )
      ? (config.preferredLength as string)
      : 'medium',
    languages: cleanTags(config.languages).length > 0 ? cleanTags(config.languages) : ['English'],
    feedbackTopics: cleanTags(config.feedbackTopics),
    category: (config.category ?? '').trim().slice(0, 60),
    employees: cleanTags(config.employees),
    services: cleanTags(config.services),
    keywords: cleanTags(config.keywords),
    ...((config.welcomeMessage ?? '').trim()
      ? { welcomeMessage: (config.welcomeMessage ?? '').trim().slice(0, 500) }
      : {}),
  };
}

function hydrateCard(raw: CardDraft): CardDraft {
  const draft = jsonClone(raw);
  draft.name ??= '';
  draft.cardLabel ??= '';
  draft.urlAlias ??= '';
  draft.kind ??= 'profile';
  draft.redirectUrl ??= '';
  draft.occupation ??= '';
  draft.descriptionHtml ??= '';
  draft.templateKey ??= DEFAULT_TEMPLATE_KEY;
  draft.coverType ??= 'color';
  draft.coverStyle ??= 'cover';
  draft.coverValue ??= '';
  draft.profileImageUrl ??= '';
  draft.galleryImages = Array.isArray(draft.galleryImages)
    ? draft.galleryImages.map((img) => ({
        imageUrl: img.imageUrl ?? '',
        caption: img.caption ?? '',
      }))
    : [];
  draft.privacyPolicyHtml ??= '';
  draft.termsHtml ??= '';

  const basic = draft.basic;
  draft.basic = {
    ...basic,
    firstName: basic.firstName ?? '',
    lastName: basic.lastName ?? '',
    email: basic.email ?? '',
    alternateEmail: basic.alternateEmail ?? '',
    phone: basic.phone ?? '',
    alternatePhone: basic.alternatePhone ?? '',
    dateOfBirth: basic.dateOfBirth == null ? '' : basic.dateOfBirth,
    company: basic.company ?? '',
    jobTitle: basic.jobTitle ?? '',
    defaultLanguage: basic.defaultLanguage ?? 'en',
  };

  const location = draft.location;
  draft.location = {
    ...location,
    type: location.type ?? 'link',
    address: location.address ?? '',
    mapsUrl: location.mapsUrl ?? '',
  };

  const banner = draft.banner;
  draft.banner = {
    ...banner,
    title: banner.title ?? '',
    url: banner.url ?? '',
    description: banner.description ?? '',
    ctaLabel: banner.ctaLabel ?? '',
    show: banner.show ?? false,
  };

  const theme = draft.themeConfig;
  draft.themeConfig = {
    ...theme,
    accentColor: theme.accentColor ?? '#2563EB',
    bgColor: theme.bgColor ?? '#FFFFFF',
  };

  draft.socialLinks = Array.isArray(draft.socialLinks) ? draft.socialLinks : [];
  draft.services = Array.isArray(draft.services) ? draft.services : [];
  draft.businessHours = normalizeBusinessHours(
    Array.isArray(draft.businessHours) ? draft.businessHours : []
  );
  if (!draft.reviewAssistant || typeof draft.reviewAssistant !== 'object') {
    draft.reviewAssistant = {} as IReviewAssistantConfig;
  }
  return draft;
}

function mediaKeyFromUrl(url: string): string | null {
  if (!url.startsWith('/media/')) return null;
  const key = url.slice('/media/'.length);
  return key.length > 0 ? key : null;
}

/* ─── Hook ──────────────────────────────────────────────────────────────────── */

export interface UseCardDraftResult {
  loadState: DraftLoadState;
  draft: CardDraft | null;
  setField: (path: string, value: unknown) => void;
  saveStatus: SaveStatus;
  isDirty: boolean;
  themeSaveSupported: boolean;
  save: () => void;
  setUploadedFile: (path: string, result: UploadResult) => void;
  clearUploadedFile: (path: string) => Promise<void>;
  getUploadKey: (path: string) => string | null;
}

export function useCardDraft(id: string): UseCardDraftResult {
  const { toast } = useToast();

  const [loadState, setLoadState] = useState<DraftLoadState>('loading');
  const [draft, setDraft] = useState<CardDraft | null>(null);
  const [dirtyOwners, setDirtyOwners] = useState<ReadonlySet<DirtyOwner>>(new Set());
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('saved');
  const [themeSaveSupported, setThemeSaveSupported] = useState(true);

  const draftRef = useRef<CardDraft | null>(null);
  const originalRef = useRef<CardDraft | null>(null);
  const dirtyRef = useRef<Set<DirtyOwner>>(new Set());
  const savingRef = useRef(false);
  const themeSupportedRef = useRef(true);
  const themeWarnedRef = useRef(false);
  const uploadKeysRef = useRef<Map<string, string>>(new Map());

  /* ── Hydration ── */
  useEffect(() => {
    let cancelled = false;
    setLoadState('loading');

    (async () => {
      try {
        const res = await fetch(`/api/cards/${id}`);
        if (res.status === 404) {
          if (!cancelled) setLoadState('not-found');
          return;
        }
        const data: { card?: CardDraft; error?: string } = await res.json().catch(() => null);
        if (!res.ok || !data?.card) throw new Error(data?.error ?? 'Failed to load card');
        if (cancelled) return;

        const hydrated = hydrateCard(data.card);
        draftRef.current = hydrated;
        originalRef.current = jsonClone(hydrated);
        dirtyRef.current = new Set();
        setDirtyOwners(new Set());
        setDraft(hydrated);
        setSaveStatus('saved');
        setLoadState('ready');
      } catch {
        if (!cancelled) setLoadState('error');
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [id]);

  /* ── Dirty bookkeeping ── */
  const reconcileOwner = useCallback((owner: DirtyOwner, next: CardDraft) => {
    const original = originalRef.current;
    if (!original) return;
    const clean =
      JSON.stringify(canonicalOwnerValue(owner, next)) ===
      JSON.stringify(canonicalOwnerValue(owner, original));
    if (clean) dirtyRef.current.delete(owner);
    else dirtyRef.current.add(owner);

    const snapshot = new Set(dirtyRef.current);
    setDirtyOwners(snapshot);
  }, []);

  const setField = useCallback(
    (path: string, value: unknown) => {
      const prev = draftRef.current;
      const owner = ownerOfPath(path);
      if (!prev || !owner) return;

      const next = jsonClone(prev);
      setPathValue(next as unknown as Record<string, unknown>, path, value);
      draftRef.current = next;
      setDraft(next);
      reconcileOwner(owner, next);
    },
    [reconcileOwner]
  );

  /* ── Autosave ── */
  const flush = useCallback(async () => {
    const current = draftRef.current;
    if (!current || savingRef.current || dirtyRef.current.size === 0) return;

    const owners = Array.from(dirtyRef.current);
    const payload: Record<string, unknown> = {};
    for (const owner of owners) {
      if (owner === 'themeConfig' && !themeSupportedRef.current) continue;
      payload[owner] = jsonClone(canonicalOwnerValue(owner, current));
    }
    const payloadKeys = Object.keys(payload);
    if (payloadKeys.length === 0) {
      dirtyRef.current = new Set();
      setDirtyOwners(new Set());
      return;
    }

    savingRef.current = true;
    setSaveStatus('saving');
    try {
      const res = await fetch(`/api/cards/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data: { card?: CardDraft; error?: string } = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? 'Failed to save changes');

      if (payload.themeConfig) {
        const returned = (
          data.card as unknown as
            | { themeConfig?: { accentColor?: string; bgColor?: string } }
            | undefined
        )?.themeConfig;
        const sent = payload.themeConfig as { accentColor: string; bgColor: string };
        const persisted =
          returned?.accentColor === sent.accentColor && returned?.bgColor === sent.bgColor;
        if (!persisted) {
          themeSupportedRef.current = false;
          setThemeSaveSupported(false);
          if (!themeWarnedRef.current) {
            themeWarnedRef.current = true;
            toast({
              title: 'Theme colours are preview-only',
              description:
                'The API schema doesn\'t accept themeConfig yet, so accent/background colours can\'t be saved.',
              variant: 'warning',
            });
          }
        }
      }

      const original = originalRef.current;
      if (original) {
        for (const key of payloadKeys) {
          (original as unknown as Record<string, unknown>)[key] = jsonClone(payload[key]);
        }
      }

      const now = draftRef.current;
      if (now) {
        for (const owner of owners) {
          if (owner === 'themeConfig' && !themeSupportedRef.current) {
            dirtyRef.current.delete(owner);
            continue;
          }
          if (!(owner in payload)) continue;
          const stillSame =
            JSON.stringify(canonicalOwnerValue(owner, now)) === JSON.stringify(payload[owner]);
          if (stillSame) dirtyRef.current.delete(owner);
          else dirtyRef.current.add(owner);
        }
      }
      setDirtyOwners(new Set(dirtyRef.current));
      setSaveStatus(dirtyRef.current.size > 0 ? 'unsaved' : 'saved');
    } catch (error) {
      setSaveStatus('unsaved');
      toast({
        title: 'Save failed',
        description:
          error instanceof Error && error.message !== 'Failed to save changes'
            ? `${error.message} — your changes are kept, press Save to retry.`
            : 'Your changes are kept — press Save to retry.',
        variant: 'error',
      });
    } finally {
      savingRef.current = false;
    }
  }, [id, toast]);

  useEffect(() => {
    if (loadState !== 'ready' || dirtyOwners.size === 0) return;
    const timer = window.setTimeout(() => {
      void flush();
    }, AUTOSAVE_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [dirtyOwners, loadState, flush]);

  const save = useCallback(() => {
    void flush();
  }, [flush]);

  /* ── beforeunload guard ── */
  const hasUnsaved = dirtyOwners.size > 0 || saveStatus === 'saving';
  useEffect(() => {
    if (!hasUnsaved) return;
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [hasUnsaved]);

  /* ── Upload registry ── */
  const setUploadedFile = useCallback(
    (path: string, result: UploadResult) => {
      uploadKeysRef.current.set(path, result.key);
      setField(path, result.url);
    },
    [setField]
  );

  const getUploadKey = useCallback((path: string): string | null => {
    const known = uploadKeysRef.current.get(path);
    if (known) return known;
    const url = getPathValue(draftRef.current, path);
    return typeof url === 'string' ? mediaKeyFromUrl(url) : null;
  }, []);

  const clearUploadedFile = useCallback(
    async (path: string) => {
      const url = getPathValue(draftRef.current, path);
      const key =
        uploadKeysRef.current.get(path) ??
        (typeof url === 'string' ? mediaKeyFromUrl(url) : null);

      if (key) {
        try {
          const res = await fetch(`/api/uploads?key=${encodeURIComponent(key)}`, {
            method: 'DELETE',
          });
          if (!res.ok && res.status !== 404) {
            const data: { error?: string } = await res.json().catch(() => null);
            throw new Error(data?.error ?? 'Delete failed');
          }
        } catch {
          throw new Error('Could not delete the stored file — try again.');
        }
      }
      uploadKeysRef.current.delete(path);
      setField(path, '');
    },
    [setField]
  );

  return useMemo(
    () => ({
      loadState,
      draft,
      setField,
      saveStatus,
      isDirty: dirtyOwners.size > 0,
      themeSaveSupported,
      save,
      setUploadedFile,
      clearUploadedFile,
      getUploadKey,
    }),
    [
      loadState,
      draft,
      setField,
      saveStatus,
      dirtyOwners,
      themeSaveSupported,
      save,
      setUploadedFile,
      clearUploadedFile,
      getUploadKey,
    ]
  );
}
