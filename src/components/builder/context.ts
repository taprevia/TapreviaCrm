'use client';

/**
 * Shared builder context — provided by BuilderShell, consumed by tabs.
 * Kept in its own module so tab ↔ shell imports stay acyclic.
 */

import { createContext, useContext } from 'react';
import type { SaveStatus, UploadResult, CardDraft } from '@/lib/hooks/use-card-draft';

export interface BuilderContextValue {
  draft: CardDraft;
  /** Dot-path setter: 'basic.firstName' | 'coverValue' | 'socialLinks.2.url' | … */
  setField: (path: string, value: unknown) => void;
  saveStatus: SaveStatus;
  isDirty: boolean;
  /** False once the backend has been proven to strip themeConfig (schema gap). */
  themeSaveSupported: boolean;
  save: () => void;
  setUploadedFile: (path: string, result: UploadResult) => void;
  clearUploadedFile: (path: string) => Promise<void>;
  getUploadKey: (path: string) => string | null;
}

export const BuilderContext = createContext<BuilderContextValue | null>(null);

export function useBuilder(): BuilderContextValue {
  const value = useContext(BuilderContext);
  if (!value) throw new Error('useBuilder must be used within <BuilderShell>');
  return value;
}
