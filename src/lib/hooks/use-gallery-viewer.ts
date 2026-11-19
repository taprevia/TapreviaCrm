'use client';

/**
 * Shared gallery viewer behavior for public profile templates.
 *
 * Layers:
 *   closed -> image-viewer (preview thumbnail or product photo)
 *   closed -> gallery-grid -> image-viewer -> gallery-grid -> closed
 *
 * Templates own all markup/styling. This hook owns state, ordered image sets,
 * navigation, topmost-layer keyboard/focus handling, scroll locking and swipe.
 * It never mutates saved card data or touches browser history.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type TouchEvent as ReactTouchEvent,
} from 'react';

/** Maximum number of thumbnails rendered before "View All X Photos". */
export const GALLERY_PREVIEW_COUNT = 6;

export interface GalleryImage {
  url: string;
  caption?: string;
}

export type GalleryImageSource = 'preview' | 'grid' | 'product';

/** Return the first `count` gallery rows without mutating the saved order. */
export function galleryPreview<T>(
  items: readonly T[],
  count: number = GALLERY_PREVIEW_COUNT
): T[] {
  return items.slice(0, count);
}

/** Wrap-around index helper shared by button, keyboard and swipe navigation. */
export function stepGalleryIndex(index: number, delta: number, total: number): number {
  if (total <= 0) return 0;
  return (((index + delta) % total) + total) % total;
}

interface GridState {
  images: GalleryImage[];
}

interface ImageState {
  images: GalleryImage[];
  index: number;
  source: GalleryImageSource;
}

const FOCUSABLE =
  'a[href],button:not([disabled]):not([tabindex="-1"]),input:not([disabled]):not([tabindex="-1"]),textarea:not([disabled]):not([tabindex="-1"]),[tabindex]:not([tabindex="-1"])';

function snapshot(images: readonly GalleryImage[]): GalleryImage[] {
  return images.map((image) => ({ ...image }));
}

function activeElement(): HTMLElement | null {
  return typeof document === 'undefined' ? null : (document.activeElement as HTMLElement | null);
}

interface BackdropDismissProps {
  onPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerMove: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerUp: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerLeave: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerCancel: () => void;
  onClick: (event: ReactMouseEvent<HTMLDivElement>) => void;
}

const BACKDROP_DRAG_TOLERANCE = 8;

/**
 * Only a press that starts and ends on the backdrop, without a meaningful
 * drag, dismisses the overlay. Presses on the image/controls or drags that
 * cross elements cannot accidentally fall through to the backdrop.
 */
function useBackdropDismiss(onDismiss: () => void): BackdropDismissProps {
  const start = useRef<{
    x: number;
    y: number;
    pointerId: number;
    valid: boolean;
    down: boolean;
  } | null>(null);

  const onPointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType === 'mouse' && event.button !== 0) {
      start.current = null;
      return;
    }
    start.current = {
      x: event.clientX,
      y: event.clientY,
      pointerId: event.pointerId,
      valid: event.target === event.currentTarget,
      down: true,
    };
  }, []);

  const onPointerMove = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const current = start.current;
    if (!current || current.pointerId !== event.pointerId || !current.valid) return;
    const distance = Math.hypot(event.clientX - current.x, event.clientY - current.y);
    if (distance > BACKDROP_DRAG_TOLERANCE) current.valid = false;
  }, []);

  const onPointerUp = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const current = start.current;
    if (!current || current.pointerId !== event.pointerId) return;
    const distance = Math.hypot(event.clientX - current.x, event.clientY - current.y);
    if (event.target !== event.currentTarget || distance > BACKDROP_DRAG_TOLERANCE) {
      current.valid = false;
    }
    current.down = false;
  }, []);

  const onPointerLeave = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const current = start.current;
    if (current && current.down && current.pointerId === event.pointerId) current.valid = false;
  }, []);

  const onPointerCancel = useCallback(() => {
    start.current = null;
  }, []);

  const onClick = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>) => {
      const current = start.current;
      start.current = null;
      if (!current?.valid || event.target !== event.currentTarget) return;
      onDismiss();
    },
    [onDismiss]
  );

  return useMemo(
    () => ({
      onPointerDown,
      onPointerMove,
      onPointerUp,
      onPointerLeave,
      onPointerCancel,
      onClick,
    }),
    [onPointerDown, onPointerMove, onPointerUp, onPointerLeave, onPointerCancel, onClick]
  );
}

export function useGalleryViewer() {
  const [grid, setGrid] = useState<GridState | null>(null);
  const [image, setImage] = useState<ImageState | null>(null);

  const gridOverlayRef = useRef<HTMLDivElement | null>(null);
  const imageOverlayRef = useRef<HTMLDivElement | null>(null);
  const gridScrollRef = useRef<HTMLDivElement | null>(null);
  const gridTriggerRef = useRef<HTMLElement | null>(null);
  const imageTriggerRef = useRef<HTMLElement | null>(null);
  const pendingFocusRef = useRef<HTMLElement | null>(null);
  const touchStart = useRef<{ x: number; y: number } | null>(null);

  const isGridOpen = grid !== null;
  const isImageOpen = image !== null;
  const anyOverlayOpen = isGridOpen || isImageOpen;
  const gridImages = grid?.images ?? [];
  const current = image ? (image.images[image.index] ?? null) : null;
  const index = image?.index ?? 0;
  const total = image?.images.length ?? 0;
  const imageSource = image?.source ?? null;

  const openGrid = useCallback((images: readonly GalleryImage[]) => {
    if (images.length === 0) return;
    pendingFocusRef.current = null;
    gridTriggerRef.current = activeElement();
    setGrid({ images: snapshot(images) });
    setImage(null);
  }, []);

  const openImage = useCallback(
    (images: readonly GalleryImage[], startIndex: number, source: GalleryImageSource) => {
      if (images.length === 0) return;
      pendingFocusRef.current = null;
      imageTriggerRef.current = activeElement();
      setImage({
        images: snapshot(images),
        index: Math.max(0, Math.min(startIndex, images.length - 1)),
        source,
      });
    },
    []
  );

  const openPreviewImage = useCallback(
    (images: readonly GalleryImage[], startIndex: number) => openImage(images, startIndex, 'preview'),
    [openImage]
  );

  const openProductImage = useCallback(
    (images: readonly GalleryImage[], startIndex: number) => openImage(images, startIndex, 'product'),
    [openImage]
  );

  const openGridImage = useCallback(
    (startIndex: number) => {
      if (!grid) return;
      openImage(grid.images, startIndex, 'grid');
    },
    [grid, openImage]
  );

  const closeImage = useCallback(() => {
    pendingFocusRef.current = imageTriggerRef.current;
    setImage(null);
  }, []);

  const closeGrid = useCallback(() => {
    pendingFocusRef.current = gridTriggerRef.current;
    setImage(null);
    setGrid(null);
  }, []);

  const closeTop = useCallback(() => {
    if (image) closeImage();
    else if (grid) closeGrid();
  }, [image, grid, closeImage, closeGrid]);

  const gridBackdropProps = useBackdropDismiss(closeGrid);
  const imageBackdropProps = useBackdropDismiss(closeImage);

  const step = useCallback((delta: number) => {
    setImage((state) => {
      if (!state) return null;
      return {
        ...state,
        index: stepGalleryIndex(state.index, delta, state.images.length),
      };
    });
  }, []);

  const goTo = useCallback((nextIndex: number) => {
    setImage((state) => {
      if (!state) return null;
      return {
        ...state,
        index: Math.max(0, Math.min(nextIndex, state.images.length - 1)),
      };
    });
  }, []);

  // Escape closes only the topmost layer; arrows only act on the image viewer.
  useEffect(() => {
    if (!anyOverlayOpen) return undefined;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeTop();
        return;
      }
      if (!isImageOpen) return;
      if (event.key === 'ArrowRight') {
        event.preventDefault();
        step(1);
      } else if (event.key === 'ArrowLeft') {
        event.preventDefault();
        step(-1);
      } else if (event.key === 'Home') {
        event.preventDefault();
        goTo(0);
      } else if (event.key === 'End') {
        event.preventDefault();
        goTo(total - 1);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [anyOverlayOpen, isImageOpen, closeTop, step, goTo, total]);

  // Focus the topmost layer on open; restore the correct trigger on close.
  useEffect(() => {
    if (anyOverlayOpen) {
      const pending = pendingFocusRef.current;
      if (pending?.isConnected) {
        pending.focus();
        pendingFocusRef.current = null;
        return;
      }
      const node = isImageOpen ? imageOverlayRef.current : gridOverlayRef.current;
      const focusable = node?.querySelector<HTMLElement>(FOCUSABLE);
      (focusable ?? node)?.focus();
      return;
    }
    pendingFocusRef.current?.focus?.();
    pendingFocusRef.current = null;
  }, [anyOverlayOpen, isImageOpen]);

  // Keep the page locked until every gallery layer is closed.
  useEffect(() => {
    if (!anyOverlayOpen) return undefined;
    const previous = document.documentElement.style.overflow;
    document.documentElement.style.overflow = 'hidden';
    return () => {
      document.documentElement.style.overflow = previous;
    };
  }, [anyOverlayOpen]);

  // Each overlay wrapper can use this; event.currentTarget scopes the trap.
  const trapTabKeys = useCallback((event: ReactKeyboardEvent<HTMLDivElement>): void => {
    if (event.key !== 'Tab') return;
    const nodes = event.currentTarget.querySelectorAll<HTMLElement>(FOCUSABLE);
    if (nodes.length === 0) return;
    const first = nodes[0]!;
    const last = nodes[nodes.length - 1]!;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }, []);

  const touchHandlers = useMemo(
    () => ({
      onTouchStart: (event: ReactTouchEvent<HTMLDivElement>): void => {
        const touch = event.changedTouches[0];
        if (!touch) return;
        touchStart.current = { x: touch.clientX, y: touch.clientY };
      },
      onTouchEnd: (event: ReactTouchEvent<HTMLDivElement>): void => {
        const start = touchStart.current;
        touchStart.current = null;
        const touch = event.changedTouches[0];
        if (!start || !touch) return;
        const dx = touch.clientX - start.x;
        const dy = touch.clientY - start.y;
        if (Math.abs(dx) < 40 || Math.abs(dx) <= Math.abs(dy) * 1.2) return;
        step(dx < 0 ? 1 : -1);
      },
    }),
    [step]
  );

  return {
    isGridOpen,
    isImageOpen,
    anyOverlayOpen,
    gridImages,
    current,
    index,
    total,
    imageSource,
    openGrid,
    openPreviewImage,
    openGridImage,
    openProductImage,
    closeImage,
    closeGrid,
    closeTop,
    step,
    goTo,
    gridOverlayRef,
    imageOverlayRef,
    gridScrollRef,
    gridBackdropProps,
    imageBackdropProps,
    trapTabKeys,
    touchHandlers,
  };
}
