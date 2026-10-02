'use client';

import type { ReactNode } from 'react';

/**
 * Public click actions the shared `/api/public/track` endpoint understands.
 * Same fire-and-forget pattern as StickyDock and the review-assistant:
 * keeps the existing analytics system and never blocks navigation.
 */
type PublicTrackAction =
  | 'link_click'
  | 'review_google_clicked';

/**
 * Anchor that fires one analytics track event on click (fire-and-forget)
 * before letting the link navigate. Used by templates that need a tracked
 * destination (e.g. the Google review CTA) without building a second
 * analytics path.
 */
export function TrackLink({
  href,
  alias,
  action,
  className,
  children,
  'aria-label': ariaLabel,
}: {
  href: string;
  alias: string;
  action: PublicTrackAction;
  className?: string;
  children: ReactNode;
  'aria-label'?: string;
}) {
  const handleClick = () => {
    // Mirror the exact request shape of the shared track endpoint
    // (review-assistant.tsx:track / sticky-dock.tsx:handleShareClick).
    void fetch('/api/public/track', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      keepalive: true,
      body: JSON.stringify({ alias, action }),
    }).catch(() => {});
  };

  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={className}
      aria-label={ariaLabel}
      onClick={handleClick}
    >
      {children}
    </a>
  );
}