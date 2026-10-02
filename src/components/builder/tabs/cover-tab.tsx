'use client';

/**
 * Cover & Photos tab.
 *
 * coverType options mirror the public renderer union exactly:
 *   z.enum(['image', 'color', 'video'])  (lib/validation/vcard.ts)
 * The public CoverMedia renders `color` as a solid background-color — there are
 * NO gradient presets anywhere in the public portal, so the swatch grid offers
 * solid presets only (a gradient string would break backgroundColor rendering).
 *
 * Also exposes coverStyle (cover | banner | boxed) — same union hero.tsx
 * switches on — since it materially changes public layout and is part of the
 * accepted PATCH payload.
 */

import type { ChangeEvent } from 'react';
import { Input, SegmentedControl } from '@/components/ui';
import { useToast } from '@/components/ui/toast';
import type { CoverType, CoverStyle } from '@/types';
import { useBuilder } from '../context';
import { RemoveUploadButton, UploadButton } from '../upload-button';
import { cn } from '@/lib/utils';

const darkInput =
  'border-line bg-field text-ink placeholder:text-ink-faint focus:border-accent-500 focus:ring-accent-500/25 hover:border-line-strong';

/** Solid colour presets for the cover — tasteful, dark-UI-friendly defaults. */
const COLOR_PRESETS = [
  '#2563EB', // brand blue (current default)
  '#0EA5E9',
  '#10B981',
  '#8B5CF6',
  '#EC4899',
  '#F59E0B',
  '#EF4444',
  '#14B8A6',
  '#475569',
  '#0F172A',
] as const;

function isHexColor(value: string): boolean {
  return /^#[0-9a-fA-F]{6}$/.test(value.trim());
}

function initialsFallback(draft: ReturnType<typeof useBuilder>['draft']): string {
  const source =
    draft.name?.trim() ||
    `${draft.basic?.firstName ?? ''} ${draft.basic?.lastName ?? ''}`.trim();
  const words = source.split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  if (words.length === 1) return words[0]!.slice(0, 2).toUpperCase();
  return `${words[0]?.charAt(0) ?? ''}${words[words.length - 1]?.charAt(0) ?? ''}`.toUpperCase();
}

export function CoverTab() {
  const { draft, setField, setUploadedFile, clearUploadedFile } = useBuilder();
  const { toast } = useToast();

  const avatarUrl = draft.profileImageUrl?.trim() ?? '';

  const handleTypeChange = (next: CoverType) => {
    // Reset a value that doesn't fit the newly selected kind of cover.
    const value = draft.coverValue.trim();
    if (next === 'color' && !isHexColor(value)) setField('coverValue', '');
    if ((next === 'image' || next === 'video') && isHexColor(value)) setField('coverValue', '');
    setField('coverType', next);
  };

  const removeUpload = async (path: string) => {
    try {
      await clearUploadedFile(path);
    } catch (error) {
      toast({
        title: 'Could not remove file',
        description: error instanceof Error ? error.message : 'Please try again.',
        variant: 'error',
      });
    }
  };

  return (
    <div className="space-y-6">
      {/* ── Profile photo ── */}
      <section aria-label="Profile photo">
        <h3 className="text-sm font-semibold text-ink">Profile photo</h3>
        <div className="mt-3 flex items-center gap-4">
          <div className="relative h-24 w-24 shrink-0 rounded-full">
            <span className="grid h-full w-full place-items-center overflow-hidden rounded-full bg-field ring-1 ring-line-subtle">
              {avatarUrl ? (
                // eslint-disable-next-line @next/next/no-img-element -- mirrors public portal img usage
                <img src={avatarUrl} alt="Profile photo" className="h-full w-full object-cover" />
              ) : (
                <span aria-hidden="true" className="text-lg font-bold text-ink-faint">
                  {initialsFallback(draft)}
                </span>
              )}
            </span>
            {avatarUrl && (
              <RemoveUploadButton
                label="Remove profile photo"
                className="absolute -right-1 -top-1"
                onRemove={() => removeUpload('profileImageUrl')}
              />
            )}
          </div>
          <div className="min-w-0 space-y-2">
            <UploadButton
              category="avatar"
              cardId={draft._id}
              label={avatarUrl ? 'Replace photo' : 'Upload photo'}
              onUploaded={(result) => setUploadedFile('profileImageUrl', result)}
            />
            <p className="text-xs text-ink-faint">Square JPG, PNG or WebP — cropped to a circle.</p>
          </div>
        </div>
      </section>

      {/* ── Cover media ── */}
      <section aria-label="Cover">
        <h3 className="text-sm font-semibold text-ink">Cover</h3>

        <div className="mt-3 flex flex-wrap items-center gap-x-6 gap-y-3">
          <div>
            <p className="mb-1.5 text-sm font-medium text-ink-mute">Type</p>
            <SegmentedControl<CoverType>
              aria-label="Cover type"
              value={draft.coverType}
              onChange={handleTypeChange}
              options={[
                { value: 'image', label: 'Image' },
                { value: 'color', label: 'Color' },
                { value: 'video', label: 'Video' },
              ]}
            />
          </div>
          <div>
            <p className="mb-1.5 text-sm font-medium text-ink-mute">Layout</p>
            <SegmentedControl<CoverStyle>
              aria-label="Cover layout"
              value={draft.coverStyle}
              onChange={(value) => setField('coverStyle', value)}
              options={[
                { value: 'cover', label: 'Full' },
                { value: 'banner', label: 'Banner' },
                { value: 'boxed', label: 'Boxed' },
              ]}
            />
          </div>
        </div>

        <div className="mt-4">
          {draft.coverType === 'image' && (
            <div className="space-y-2">
              <UploadButton
                category="cover"
                cardId={draft._id}
                label="Upload cover image"
                className="block w-fit"
                onUploaded={(result) => setUploadedFile('coverValue', result)}
                preview={
                  <div className="relative mb-2 h-32 w-full max-w-md overflow-hidden rounded-lg bg-field ring-1 ring-line-subtle">
                    {draft.coverValue.trim() ? (
                      <>
                        {/* eslint-disable-next-line @next/next/no-img-element -- mirrors public portal img usage */}
                        <img
                          src={draft.coverValue}
                          alt="Cover preview"
                          className="h-full w-full object-cover"
                        />
                        <RemoveUploadButton
                          label="Remove cover image"
                          className="absolute right-2 top-2"
                          onRemove={() => removeUpload('coverValue')}
                        />
                      </>
                    ) : (
                      <span className="grid h-full place-items-center text-xs text-ink-faint">
                        No cover image yet
                      </span>
                    )}
                  </div>
                }
              />
            </div>
          )}

          {draft.coverType === 'color' && (
            <div>
              <p className="mb-2 text-xs text-ink-faint">Pick a solid colour for the cover.</p>
              <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Cover colour presets">
                {COLOR_PRESETS.map((preset) => {
                  const active = draft.coverValue.toLowerCase() === preset.toLowerCase();
                  return (
                    <button
                      key={preset}
                      type="button"
                      aria-pressed={active}
                      aria-label={`Use ${preset}`}
                      title={preset}
                      onClick={() => setField('coverValue', preset)}
                      className={cn(
                        'h-8 w-8 rounded-full ring-2 ring-offset-2 ring-offset-bg-raised transition-transform hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-400',
                        active ? 'ring-accent-400' : 'ring-transparent'
                      )}
                      style={{ backgroundColor: preset }}
                    />
                  );
                })}
                <input
                  type="color"
                  aria-label="Custom cover colour"
                  className={cn(
                    'h-8 w-10 cursor-pointer rounded border border-line-subtle bg-transparent p-0.5',
                    '[color-scheme:dark]'
                  )}
                  value={isHexColor(draft.coverValue) ? draft.coverValue : '#2563EB'}
                  onChange={(event: ChangeEvent<HTMLInputElement>) =>
                    setField('coverValue', event.target.value.toUpperCase())
                  }
                />
              </div>
            </div>
          )}

          {draft.coverType === 'video' && (
            <div className="max-w-md">
              <Input
                type="url"
                placeholder="https://example.com/clip.mp4"
                className={darkInput}
                value={draft.coverValue}
                onChange={(event: ChangeEvent<HTMLInputElement>) =>
                  setField('coverValue', event.target.value)
                }
              />
              <p className="mt-1.5 text-xs text-ink-faint">
                Direct MP4/WebM URL — plays muted + looping, like the public page.
              </p>
            </div>
          )}
        </div>
      </section>

      <p className="text-xs text-ink-faint">
        The panel on the right previews these changes live.
      </p>
    </div>
  );
}
