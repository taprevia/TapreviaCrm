'use client';

/**
 * Upload flow helper for the builder.
 *
 * - Goes through the shared client upload pipeline (presign/direct-to-store in
 *   production, legacy multipart fallback in local/dev) for (file, category,
 *   cardId).
 * - While uploading, an overlay with a spinner covers the optional `preview`
 *   node so the user sees exactly what is being replaced.
 * - `RemoveUploadButton` is the delete-X affordance; the actual DELETE
 *   /api/uploads?key= call + field clearing is orchestrated by the draft hook
 *   (clearUploadedFile) so key bookkeeping lives in one place.
 */

import { ChangeEvent, ReactNode, useRef, useState } from 'react';
import { ImagePlus, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useToast } from '@/components/ui/toast';
import { uploadFile as uploadViaPipeline, type UploadResult } from '@/lib/upload-client';
import type { MediaCategory } from '@/types';

interface UploadButtonProps {
  category: MediaCategory;
  cardId: string;
  /** value for the hidden file input's accept attribute */
  accept?: string;
  label?: string;
  disabled?: boolean;
  /** Preview node rendered inside the relative wrapper (overlay target). */
  preview?: ReactNode;
  onUploaded: (result: UploadResult) => void;
  className?: string;
}

export function UploadButton({
  category,
  cardId,
  accept = 'image/jpeg,image/png,image/webp',
  label = 'Upload',
  disabled = false,
  preview,
  onUploaded,
  className,
}: UploadButtonProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const { toast } = useToast();

  const uploadFile = async (file: File) => {
    setUploading(true);
    try {
      const data = await uploadViaPipeline(file, { category, cardId });
      onUploaded(data);
    } catch (error) {
      toast({
        title: 'Upload failed',
        description:
          error instanceof Error && error.message !== 'Upload failed'
            ? error.message
            : 'Something went wrong. Please try again.',
        variant: 'error',
      });
    } finally {
      setUploading(false);
    }
  };

  const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = ''; // allow re-picking the same file
    if (file) void uploadFile(file);
  };

  return (
    <div className={cn('relative inline-block', className)}>
      {preview}
      <label
        className={cn(
          'inline-flex cursor-pointer select-none items-center gap-1.5 rounded-lg border border-dashed border-line-strong px-3 py-2 text-xs font-medium text-ink-mute transition-colors hover:border-accent-500 hover:text-accent-400',
          (uploading || disabled) && 'pointer-events-none opacity-60'
        )}
      >
        <ImagePlus className="h-3.5 w-3.5" aria-hidden="true" />
        {uploading ? 'Uploading…' : label}
        <input
          ref={inputRef}
          type="file"
          accept={accept}
          className="sr-only"
          disabled={uploading || disabled}
          onChange={handleChange}
        />
      </label>

      {uploading && (
        <div
          role="status"
          aria-label="Uploading"
          className="absolute inset-0 z-10 grid place-items-center rounded-[inherit] bg-bg-base/60 backdrop-blur-[2px]"
        >
          <span className="inline-flex items-center gap-2 rounded-full bg-bg-raised px-3 py-1.5 text-xs font-medium text-ink shadow-e2 ring-1 ring-line-subtle">
            <Loader2 className="h-3.5 w-3.5 animate-spin text-accent-400" aria-hidden="true" />
            Uploading…
          </span>
        </div>
      )}
    </div>
  );
}

interface RemoveUploadButtonProps {
  label?: string;
  onRemove: () => void | Promise<void>;
  className?: string;
}

/** Small circular ✕ that shows its own spinner while the removal promise runs. */
export function RemoveUploadButton({
  label = 'Remove',
  onRemove,
  className,
}: RemoveUploadButtonProps) {
  const [busy, setBusy] = useState(false);

  const handleClick = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await onRemove();
    } finally {
      setBusy(false);
    }
  };

  return (
    <button
      type="button"
      onClick={() => void handleClick()}
      disabled={busy}
      aria-label={label}
      title={label}
      className={cn(
        'grid h-7 w-7 place-items-center rounded-full bg-bg-base/80 text-ink-mute ring-1 ring-line-subtle transition-colors hover:text-red-400 hover:ring-red-500/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500/50 disabled:pointer-events-none disabled:opacity-50',
        className
      )}
    >
      {busy ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
      ) : (
        <span aria-hidden="true" className="text-sm leading-none">
          ✕
        </span>
      )}
    </button>
  );
}
