'use client';

/**
 * Gallery tab — a browsable photo gallery on the card.
 *
 * Writes `draft.galleryImages` (max 30). Uploads reuse the standard media
 * pipeline (category 'gallery'); rows are appended, captioned, reordered and
 * removed. Uploaded files are deleted from storage when a row is removed.
 */

import { ChangeEvent } from 'react';
import { ArrowDown, ArrowUp, Images } from 'lucide-react';
import { Input } from '@/components/ui';
import { useToast } from '@/components/ui/toast';
import { useBuilder } from '../context';
import { RemoveUploadButton, UploadButton } from '../upload-button';
import { cn } from '@/lib/utils';

const MAX_GALLERY = 30;

export function GalleryTab() {
  const { draft, setField, clearUploadedFile } = useBuilder();
  const { toast } = useToast();

  const items = draft.galleryImages ?? [];
  const atLimit = items.length >= MAX_GALLERY;

  const appendUpload = (result: { url: string }) => {
    if (atLimit) return;
    setField('galleryImages', [...items, { imageUrl: result.url, caption: '' }]);
  };

  const setCaption = (index: number, value: string) => {
    setField(`galleryImages.${index}.caption`, value);
  };

  const removeRow = async (index: number) => {
    try {
      await clearUploadedFile(`galleryImages.${index}.imageUrl`);
    } catch (error) {
      toast({
        title: 'Could not remove file',
        description: error instanceof Error ? error.message : 'Please try again.',
        variant: 'error',
      });
      return;
    }
    setField(
      'galleryImages',
      items.filter((_, idx) => idx !== index)
    );
  };

  const move = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= items.length) return;
    const next = [...items];
    const [row] = next.splice(index, 1);
    next.splice(target, 0, row!);
    setField('galleryImages', next);
  };

  return (
    <div className="space-y-5">
      {items.length === 0 ? (
        <div className="rounded-xl border border-dashed border-line-strong bg-field p-10 text-center">
          <Images className="mx-auto h-8 w-8 text-ink-faint" aria-hidden="true" />
          <p className="mt-3 text-sm font-medium text-ink">No gallery photos yet</p>
          <p className="mx-auto mt-1 max-w-sm text-xs text-ink-mute">
            Upload photos visitors can browse on your public card — products, office, team, events.
          </p>
        </div>
      ) : (
        <ul className="space-y-3">
          {items.map((item, index) => (
            <li
              key={index}
              className={cn(
                'flex items-center gap-3 rounded-xl border p-3',
                item.imageUrl ? 'border-line-subtle bg-field' : 'border-line-subtle'
              )}
            >
              <div className="relative h-16 w-16 shrink-0 overflow-hidden rounded-lg bg-bg-base ring-1 ring-line-subtle">
                {item.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element -- mirrors public portal img usage
                  <img src={item.imageUrl} alt="" className="h-full w-full object-cover" />
                ) : (
                  <span className="grid h-full place-items-center text-[10px] text-ink-faint">
                    No image
                  </span>
                )}
                {item.imageUrl && (
                  <RemoveUploadButton
                    label="Remove image"
                    className="absolute -right-1.5 -top-1.5 h-6 w-6"
                    onRemove={() => removeRow(index)}
                  />
                )}
              </div>

              <div className="min-w-0 flex-1">
                <Input
                  placeholder="Caption (optional)"
                  value={item.caption ?? ''}
                  onChange={(event: ChangeEvent<HTMLInputElement>) =>
                    setCaption(index, event.target.value)
                  }
                  className="border-line bg-bg-raised text-ink placeholder:text-ink-faint focus:border-accent-500 focus:ring-accent-500/25 hover:border-line-strong"
                />
              </div>

              <div className="flex shrink-0 flex-col gap-1">
                <button
                  type="button"
                  aria-label={`Move image ${index + 1} up`}
                  disabled={index === 0}
                  onClick={() => move(index, -1)}
                  className="grid h-7 w-7 place-items-center rounded-lg text-ink-mute transition-colors hover:bg-white/5 hover:text-ink disabled:pointer-events-none disabled:opacity-30"
                >
                  <ArrowUp className="h-4 w-4" aria-hidden="true" />
                </button>
                <button
                  type="button"
                  aria-label={`Move image ${index + 1} down`}
                  disabled={index === items.length - 1}
                  onClick={() => move(index, 1)}
                  className="grid h-7 w-7 place-items-center rounded-lg text-ink-mute transition-colors hover:bg-white/5 hover:text-ink disabled:pointer-events-none disabled:opacity-30"
                >
                  <ArrowDown className="h-4 w-4" aria-hidden="true" />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <UploadButton
        category="gallery"
        cardId={draft._id}
        label={atLimit ? `Limit of ${MAX_GALLERY} photos reached` : 'Add photo'}
        disabled={atLimit}
        onUploaded={appendUpload}
        className="block w-fit"
      />

      <p className="text-xs text-ink-faint">
        Up to {MAX_GALLERY} photos. Shown as a gallery section on your card.
      </p>
    </div>
  );
}