'use client';

/**
 * Low-level, opt-in logo image for public templates.
 *
 * The template owns the container, size and fallback mark; this helper only
 * validates the source, keeps the intrinsic aspect ratio, and swaps to the
 * supplied fallback if the image fails to load. It is not injected globally.
 */

import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { safeLogoUrl } from '@/lib/safe-url';
import { cn } from '@/lib/utils';

interface BusinessLogoProps {
  src?: string | null;
  alt: string;
  fallback: ReactNode;
  className?: string;
  imageClassName?: string;
}

export function BusinessLogo({
  src,
  alt,
  fallback,
  className,
  imageClassName,
}: BusinessLogoProps) {
  const url = safeLogoUrl(src);
  const [broken, setBroken] = useState(false);

  useEffect(() => {
    setBroken(false);
  }, [url]);

  const showImage = url !== '' && !broken;

  return (
    <span className={className} aria-hidden={showImage ? undefined : true}>
      {showImage ? (
        // eslint-disable-next-line @next/next/no-img-element -- mirrors public portal img usage
        <img
          src={url}
          alt={alt}
          className={cn('max-h-full max-w-full object-contain', imageClassName)}
          onError={() => setBroken(true)}
        />
      ) : (
        fallback
      )}
    </span>
  );
}
