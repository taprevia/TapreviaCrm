'use client';

/**
 * BuilderShell — orchestrates hydration, tab navigation, autosave status UI
 * and the live preview panel. Pure layout/state glue; all editing lives in
 * the tabs, all draft/save logic in use-vcard-draft.
 */

import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Check,
  Clock,
  ExternalLink,
  FileText,
  Image as ImageIcon,
  Images,
  LayoutTemplate,
  Loader2,
  Palette,
  SearchX,
  Share2,
  ShoppingBag,
  Sparkles,
  User,
  type LucideIcon,
} from 'lucide-react';
import { Button, EmptyState } from '@/components/ui';
import { useCardDraft, type UseCardDraftResult } from '@/lib/hooks/use-card-draft';
import { BuilderContext, type BuilderContextValue } from './context';
import { PreviewPanel, vcardDisplayName } from './preview-panel';
import { resolveCardDisplayName } from '@/lib/card-display';
import { BasicTab } from './tabs/basic-tab';
import { AboutTab } from './tabs/about-tab';
import { CoverTab } from './tabs/cover-tab';
import { GalleryTab } from './tabs/gallery-tab';
import { TemplateTab } from './tabs/template-tab';
import { SocialsTab } from './tabs/socials-tab';
import { HoursTab } from './tabs/hours-tab';
import { ThemeTab } from './tabs/theme-tab';
import { ProductsTab } from './tabs/products-tab';
import { ServicesTab } from './tabs/services-tab';
import { ReviewAssistantTab } from './tabs/review-assistant-tab';
import { SocialDestinationTab } from './tabs/social-tab';
import { cn } from '@/lib/utils';

/* ─── Tab rail config ───────────────────────────────────────────────────────── */

interface TabDef {
  key: string;
  label: string;
  icon: LucideIcon;
  heading: string;
  description: string;
}

const TABS: readonly TabDef[] = [
  {
    key: 'basic',
    label: 'Basic',
    icon: User,
    heading: 'Basic information',
    description: 'Identity and contact details shown at the top of your profile.',
  },
  {
    key: 'about',
    label: 'About',
    icon: FileText,
    heading: 'About',
    description: 'Occupation and description for your public page.',
  },
  {
    key: 'cover',
    label: 'Cover & Photos',
    icon: ImageIcon,
    heading: 'Cover & photos',
    description: 'Profile photo and the cover media at the top of your page.',
  },
  {
    key: 'gallery',
    label: 'Gallery',
    icon: Images,
    heading: 'Gallery photos',
    description: 'Photos visitors can browse on your card.',
  },
  {
    key: 'socials',
    label: 'Socials',
    icon: Share2,
    heading: 'Social links',
    description: 'Up to 12 links — brand icons render automatically on your profile.',
  },
  {
    key: 'hours',
    label: 'Business Hours',
    icon: Clock,
    heading: 'Business hours',
    description: 'Weekly opening hours shown on your profile.',
  },
  {
    key: 'theme',
    label: 'Theme',
    icon: Palette,
    heading: 'Theme',
    description: 'Accent and background colours used across your page.',
  },
  {
    key: 'template',
    label: 'Template',
    icon: LayoutTemplate,
    heading: 'Template',
    description: 'Choose the layout your card uses.',
  },
  {
    key: 'products',
    label: 'Products',
    icon: ShoppingBag,
    heading: 'Products',
    description: 'Services or goods visitors can enquire about on your profile.',
  },
  {
    key: 'services',
    label: 'Services',
    icon: Sparkles,
    heading: 'Services',
    description: 'Services list shown on event-focused layouts (e.g. Panthevent).',
  },
  {
    key: 'review-assistant',
    label: 'Review Assistant',
    icon: Sparkles,
    heading: 'Review Assistant',
    description: 'Turn customer feedback into editable Google review drafts.',
  },
];

/* The card's experience is controlled by its allocated product `kind`.
   Non-profile kinds get a purpose-built, minimal tab rail. */
const SOCIAL_TABS: readonly TabDef[] = [
  {
    key: 'social-destination',
    label: 'Destination',
    icon: ExternalLink,
    heading: 'Destination',
    description: 'Where this card sends visitors, and its stable printed URL.',
  },
];

const REVIEW_TABS: readonly TabDef[] = [
  {
    key: 'review-assistant',
    label: 'Review Assistant',
    icon: Sparkles,
    heading: 'Review Assistant',
    description: 'Turn customer feedback into editable Google review drafts.',
  },
];

/** Public URL shown in the builder header — human business public URL when
 *  allocated, kind-aware legacy route otherwise. */
function cardPublicPath(draft: {
  publicSlug?: string | null;
  kind?: string;
  urlAlias?: string;
}): string {
  const publicSlug = (draft.publicSlug ?? '').trim();
  if (publicSlug) return `/${publicSlug}`;
  const alias = (draft.urlAlias ?? '').trim();
  if (!alias) return '/';
  return draft.kind === 'review' ? `/review/${alias}` : `/profile/${alias}`;
}

/* ─── Status chip ───────────────────────────────────────────────────────────── */

function SaveStatusChip({ saveStatus, isDirty }: { saveStatus: UseCardDraftResult['saveStatus']; isDirty: boolean }) {
  return (
    <span role="status" aria-live="polite" className="inline-flex items-center">
      {saveStatus === 'saving' ? (
        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-ink-mute">
          <Loader2 className="h-3.5 w-3.5 animate-spin text-accent-400" aria-hidden="true" />
          Saving…
        </span>
      ) : isDirty ? (
        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-warn">
          <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-warn" />
          Unsaved changes
        </span>
      ) : (
        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-400">
          <Check className="h-3.5 w-3.5" aria-hidden="true" />
          Saved
        </span>
      )}
    </span>
  );
}

/* ─── Shell ─────────────────────────────────────────────────────────────────── */

interface BuilderShellProps {
  id: string;
}

export function BuilderShell({ id }: BuilderShellProps) {
  const builder = useCardDraft(id);
  const [activeKey, setActiveKey] = useState<string>(TABS[0]!.key);

  const kind = builder.draft?.kind ?? 'profile';
  const tabs = useMemo(() => {
    if (kind === 'social') return SOCIAL_TABS;
    if (kind === 'review') return REVIEW_TABS;
    return TABS;
  }, [kind]);

  /* When the card's experience resolves, land on a tab that exists for that kind. */
  useEffect(() => {
    setActiveKey((prev) => (tabs.some((tab) => tab.key === prev) ? prev : tabs[0]!.key));
  }, [tabs]);

  const activeTab = tabs.find((tab) => tab.key === activeKey) ?? tabs[0]!;

  const contextValue = useMemo<BuilderContextValue | null>(() => {
    if (!builder.draft) return null;
    return {
      draft: builder.draft,
      setField: builder.setField,
      saveStatus: builder.saveStatus,
      isDirty: builder.isDirty,
      themeSaveSupported: builder.themeSaveSupported,
      save: builder.save,
      setUploadedFile: builder.setUploadedFile,
      clearUploadedFile: builder.clearUploadedFile,
      getUploadKey: builder.getUploadKey,
    };
  }, [builder]);

  /* ── Loading skeleton ── */
  if (builder.loadState === 'loading') {
    return (
      <div aria-busy="true" aria-label="Loading vCard builder" className="space-y-6">
        <div className="flex items-center justify-between gap-4">
          <div className="skeleton h-7 w-56" />
          <div className="skeleton h-8 w-40" />
        </div>
        <div className="flex flex-col gap-6 xl:flex-row xl:items-start">
          <div className="min-w-0 flex-1 space-y-4">
            <div className="skeleton h-10 w-64 max-w-full" />
            <div className="skeleton h-[420px] rounded-2xl" />
          </div>
          <div className="skeleton hidden h-80 w-[340px] shrink-0 rounded-2xl xl:block" />
        </div>
      </div>
    );
  }

  /* ── Not found / error ── */
  if (builder.loadState === 'not-found') {
    return (
      <EmptyState
        icon={SearchX}
        title="Not found"
        description="This vCard doesn't exist or you don't have access to it."
      />
    );
  }
  if (builder.loadState === 'error' || !builder.draft || !contextValue) {
    return (
      <EmptyState
        icon={AlertTriangle}
        title="Couldn't load vCard"
        description="Something went wrong while loading this vCard. Please go back and try again."
      />
    );
  }

  /* ── Ready ── */
  const renderActivePanel = () => {
    switch (activeTab.key) {
      case 'about':
        return <AboutTab />;
      case 'cover':
        return <CoverTab />;
      case 'gallery':
        return <GalleryTab />;
      case 'socials':
        return <SocialsTab />;
      case 'hours':
        return <HoursTab />;
      case 'theme':
        return <ThemeTab />;
      case 'template':
        return <TemplateTab />;
      case 'products':
        return <ProductsTab cardId={id} />;
      case 'services':
        return <ServicesTab />;
      case 'review-assistant':
        return <ReviewAssistantTab />;
      case 'social-destination':
        return <SocialDestinationTab />;
      case 'basic':
      default:
        return <BasicTab cardId={id} />;
    }
  };

  return (
    <BuilderContext.Provider value={contextValue}>
      {/* Header: identity + save state */}
      <header className="mb-5 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <h1 className="truncate text-lg font-semibold text-ink">
            {resolveCardDisplayName(builder.draft) || vcardDisplayName(builder.draft)}
          </h1>
          {(() => {
            const publicPath = cardPublicPath(builder.draft);
            if (publicPath === '/') {
              return (
                <p className="truncate font-mono text-xs text-ink-faint">/</p>
              );
            }
            return (
              <a
                href={publicPath}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex min-w-0 items-center gap-1.5 font-mono text-xs text-ink-faint transition-colors hover:text-accent-400"
              >
                <span className="truncate">{publicPath}</span>
                <ExternalLink className="h-3 w-3 shrink-0" aria-hidden="true" />
              </a>
            );
          })()}
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <SaveStatusChip saveStatus={builder.saveStatus} isDirty={builder.isDirty} />
          <Button size="sm" onClick={builder.save} disabled={!builder.isDirty || builder.saveStatus === 'saving'}>
            Save
          </Button>
        </div>
      </header>

      {/* Body: rail + editor + preview */}
      <div className="lg:flex lg:items-start lg:gap-6">
        <div className="min-w-0 flex-1 space-y-0">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:gap-5">
            {/* Rail — horizontal scroll pills on mobile, sticky left column on lg+ */}
            <nav
              role="tablist"
              aria-label="Builder sections"
              className="-mx-1 flex shrink-0 gap-1 overflow-x-auto px-1 pb-1 self-start lg:sticky lg:top-24 lg:mx-0 lg:w-48 lg:flex-col lg:gap-1 lg:overflow-visible lg:px-0 lg:pb-0"
            >
              {tabs.map((tab) => {
                const isActive = tab.key === activeTab.key;
                const Icon = tab.icon;
                return (
                  <button
                    key={tab.key}
                    id={`builder-tab-${tab.key}`}
                    type="button"
                    role="tab"
                    aria-selected={isActive}
                    aria-controls="builder-panel"
                    onClick={() => setActiveKey(tab.key)}
                    className={cn(
                      'flex items-center gap-2 whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500/50 lg:w-full',
                      isActive
                        ? 'bg-accent-600/10 text-accent-400 ring-1 ring-accent-600/20'
                        : 'text-ink-mute hover:bg-white/5 hover:text-ink'
                    )}
                  >
                    <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                    {tab.label}
                  </button>
                );
              })}
            </nav>

            {/* Active panel */}
            <section
              id="builder-panel"
              role="tabpanel"
              aria-labelledby={`builder-tab-${activeTab.key}`}
              className="min-w-0 flex-1 space-y-0 rounded-2xl border border-line-subtle bg-bg-raised p-5 shadow-e1 sm:p-6"
            >
              <div className="mb-5 border-b border-line-subtle pb-4">
                <h2 className="text-base font-semibold text-ink">{activeTab.heading}</h2>
                <p className="mt-0.5 text-xs text-ink-mute">{activeTab.description}</p>
              </div>
              {renderActivePanel()}
            </section>
          </div>
        </div>

        {/* Live preview — desktop only; profile experiences only */}
        {kind === 'profile' && (
          <aside className="mt-6 hidden w-[340px] shrink-0 self-start sticky top-24 xl:block xl:mt-0">
            <PreviewPanel draft={builder.draft} />
          </aside>
        )}
      </div>
    </BuilderContext.Provider>
  );
}
