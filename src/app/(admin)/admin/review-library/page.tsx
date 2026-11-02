'use client';

/**
 * Admin Review Library — manage reusable review categories and templates.
 *
 * Editing is add/edit/deactivate only for templates; a category can also be
 * permanently deleted (with its templates) behind a confirmation. Bulk
 * import/export round-trip the full { categories, templates } JSON artifact.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Modal } from '@/components/ui/modal';
import { useToast } from '@/components/ui/toast';
import {
  BookOpen,
  Check,
  Download,
  FileUp,
  Loader2,
  Pencil,
  Plus,
  Save,
  Trash2,
  X,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  REVIEW_IMPORT_MAX_BYTES,
  ReviewImportPayloadError,
  parseReviewLibraryImportText,
  toReviewLibraryImportBody,
  type NormalizedReviewLibraryImport,
} from '@/lib/review-library-import-payload';

type ReviewPreferredLength = 'short' | 'medium' | 'detailed';
type ReviewWritingStyle = 'friendly' | 'professional' | 'casual' | 'simple';

interface Scenario {
  key: string;
  name: string;
}

interface CategoryView {
  _id: string;
  key: string;
  name: string;
  active: boolean;
  languages: string[];
  scenarios: Scenario[];
  templateCount: number;
}

interface TemplateView {
  _id: string;
  key: string;
  categoryKey: string;
  scenario: string;
  language: string;
  text: string;
  variables: string[];
  length: ReviewPreferredLength | (string & {});
  style?: ReviewWritingStyle | '';
  compatibleKeywords?: string[];
  active: boolean;
  usageCount: number;
  lastShownAt?: string | null;
}

const LENGTH_OPTIONS = [
  { value: 'short', label: 'Short' },
  { value: 'medium', label: 'Medium' },
  { value: 'detailed', label: 'Detailed' },
];

const STYLE_OPTIONS = [
  { value: '', label: 'Any style' },
  { value: 'friendly', label: 'Friendly' },
  { value: 'professional', label: 'Professional' },
  { value: 'casual', label: 'Casual' },
  { value: 'simple', label: 'Simple' },
];

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function collectErrorMessages(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((item) => collectErrorMessages(item));
  }
  const record = asRecord(value);
  if (!record) return typeof value === 'string' && value.trim() ? [value.trim()] : [];
  return Object.entries(record).flatMap(([key, item]) => {
    if (Array.isArray(item)) {
      return item
        .filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
        .map((entry) => `${key}: ${entry}`);
    }
    if (typeof item === 'string' && item.trim()) return [`${key}: ${item.trim()}`];
    return collectErrorMessages(item);
  });
}

function formatApiError(body: unknown, fallback: string): string {
  const record = asRecord(body);
  const error = typeof record?.error === 'string' && record.error.trim() ? record.error : fallback;
  const details = collectErrorMessages(record?.details);
  return details.length > 0 ? `${error}: ${details.slice(0, 4).join('; ')}` : error;
}

async function readJsonResponse(
  response: Response
): Promise<{ body: unknown; validJson: boolean; empty: boolean }> {
  const text = await response.text();
  if (!text.trim()) return { body: null, validJson: false, empty: true };
  try {
    return { body: JSON.parse(text) as unknown, validJson: true, empty: false };
  } catch {
    return { body: null, validJson: false, empty: false };
  }
}

const slugify = (value: string) =>
  value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);

interface TemplateForm {
  key: string;
  scenario: string;
  language: string;
  text: string;
  length: ReviewPreferredLength;
  style: ReviewWritingStyle | '';
  compatibleKeywords: string;
}

const EMPTY_TEMPLATE_FORM: TemplateForm = {
  key: '',
  scenario: '',
  language: 'English',
  text: '',
  length: 'medium',
  style: '',
  compatibleKeywords: '',
};

export default function AdminReviewLibraryPage() {
  const { toast } = useToast();

  const [categories, setCategories] = useState<CategoryView[]>([]);
  const [loading, setLoading] = useState(true);
  const [pageError, setPageError] = useState<string | null>(null);

  const [selectedKey, setSelectedKey] = useState('');
  const [templates, setTemplates] = useState<TemplateView[]>([]);
  const [templatesLoading, setTemplatesLoading] = useState(false);
  const [templatesError, setTemplatesError] = useState('');
  const templatesKeyRef = useRef('');
  const templatesSeqRef = useRef(0);

  // Category editor draft (initialised from the selected category).
  const [catForm, setCatForm] = useState<{
    key: string;
    name: string;
    active: boolean;
    languages: string;
    scenarios: Scenario[];
  }>({ key: '', name: '', active: true, languages: '', scenarios: [] });

  // Template editor modal.
  const [tplModalOpen, setTplModalOpen] = useState(false);
  const [tplForm, setTplForm] = useState<TemplateForm>(EMPTY_TEMPLATE_FORM);
  const [savingTemplate, setSavingTemplate] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<TemplateView | null>(null);
  const [tplInitial, setTplInitial] = useState<TemplateForm>(EMPTY_TEMPLATE_FORM);

  // Import modal.
  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState('');
  const [importFileName, setImportFileName] = useState('');
  const [importPayload, setImportPayload] = useState<NormalizedReviewLibraryImport | null>(null);
  const [importing, setImporting] = useState(false);
  const [overwriteExisting, setOverwriteExisting] = useState(false);
  const [importPreview, setImportPreview] = useState<{
    categoriesNew: number;
    categoriesExisting: number;
    templatesNew: number;
    templatesExisting: number;
    invalid: string[];
  } | null>(null);
  const importingRef = useRef(false);
  const [importResult, setImportResult] = useState<{
    imported: { categories: number; templates: number };
    errors?: string[];
  } | null>(null);

  // Delete-category confirmation.
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const fetchCategories = useCallback(async () => {
    setLoading(true);
    setPageError(null);
    try {
      const res = await fetch('/api/admin/review-library');
      if (!res.ok) throw new Error('Failed to load review library');
      const data: { categories?: CategoryView[] } = await res.json();
      const rows = data.categories ?? [];
      setCategories(rows);
      setSelectedKey((prev) => prev || rows[0]?.key || '');
    } catch (err) {
      setPageError(err instanceof Error ? err.message : 'Failed to load review library');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchCategories();
  }, [fetchCategories]);

  const fetchTemplates = useCallback(async (key: string) => {
    const seq = ++templatesSeqRef.current;
    if (!key) {
      templatesKeyRef.current = '';
      setTemplates([]);
      setTemplatesLoading(false);
      setTemplatesError('');
      return;
    }
    // A different category must never show the previous category's rows.
    if (templatesKeyRef.current !== key) {
      templatesKeyRef.current = key;
      setTemplates([]);
    }
    setTemplatesLoading(true);
    setTemplatesError('');
    try {
      const res = await fetch(
        `/api/admin/review-library?categoryKey=${encodeURIComponent(key)}`
      );
      if (!res.ok) throw new Error('Failed to load templates');
      const data: { templates?: TemplateView[] } = await res.json();
      if (seq !== templatesSeqRef.current) return;
      setTemplates(data.templates ?? []);
    } catch {
      if (seq !== templatesSeqRef.current) return;
      setTemplatesError('Could not load templates for this category.');
    } finally {
      if (seq === templatesSeqRef.current) setTemplatesLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchTemplates(selectedKey);
  }, [selectedKey, fetchTemplates]);

  const refreshLibrary = useCallback(async () => {
    await fetchCategories();
    if (selectedKey) await fetchTemplates(selectedKey);
  }, [fetchCategories, fetchTemplates, selectedKey]);

  const selectedCategory = useMemo(
    () => categories.find((c) => c.key === selectedKey) ?? null,
    [categories, selectedKey]
  );

  const categoryDirty = useMemo(() => {
    if (!selectedCategory) {
      return Boolean(
        catForm.name.trim() ||
          catForm.key.trim() ||
          catForm.languages.trim() ||
          catForm.scenarios.length > 0
      );
    }
    return (
      catForm.name.trim() !== selectedCategory.name ||
      catForm.active !== selectedCategory.active ||
      catForm.languages
        .split(',')
        .map((v) => v.trim())
        .filter(Boolean)
        .join(',') !== (selectedCategory.languages ?? []).join(',') ||
      JSON.stringify(
        catForm.scenarios.map((s) => ({ key: s.key.trim(), name: s.name.trim() }))
      ) !==
        JSON.stringify(
          (selectedCategory.scenarios ?? []).map((s) => ({ key: s.key, name: s.name }))
        )
    );
  }, [catForm, selectedCategory]);

  const templateDirty = useMemo(
    () => JSON.stringify(tplForm) !== JSON.stringify(tplInitial),
    [tplForm, tplInitial]
  );

  const confirmDiscardCategory = (action: () => void) => {
    if (categoryDirty && !window.confirm('Discard unsaved category and scenario changes?')) return;
    action();
  };

  const closeTemplateModal = () => {
    if (templateDirty && !window.confirm('Discard unsaved template changes?')) return;
    setTplModalOpen(false);
    setEditingTemplate(null);
  };

  // Sync the category editor draft when the selection changes.
  useEffect(() => {
    if (!selectedCategory) {
      setCatForm({ key: '', name: '', active: true, languages: '', scenarios: [] });
      return;
    }
    setCatForm({
      key: selectedCategory.key,
      name: selectedCategory.name,
      active: selectedCategory.active,
      languages: (selectedCategory.languages ?? []).join(', '),
      scenarios: selectedCategory.scenarios ?? [],
    });
  }, [selectedCategory]);

  const saveCategory = async () => {
    const name = catForm.name.trim();
    if (!name) {
      toast({ title: 'Name required', description: 'Give the category a name.', variant: 'warning' });
      return;
    }
    const scenarioKeys = catForm.scenarios.map((s) => s.key.trim());
    const scenarioNames = catForm.scenarios.map((s) => s.name.trim().toLowerCase());
    if (scenarioKeys.some((key) => !key) || scenarioNames.some((value) => !value)) {
      toast({ title: 'Scenario incomplete', description: 'Every scenario needs a key and a name.', variant: 'warning' });
      return;
    }
    if (new Set(scenarioKeys).size !== scenarioKeys.length) {
      toast({ title: 'Duplicate scenario key', description: 'Scenario keys must be unique.', variant: 'warning' });
      return;
    }
    if (new Set(scenarioNames).size !== scenarioNames.length) {
      toast({ title: 'Duplicate scenario name', description: 'Scenario names must be unique.', variant: 'warning' });
      return;
    }
    const languages = catForm.languages
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    // New categories default to English; existing categories keep whatever the
    // admin saved and additional languages remain allowed.
    if (languages.length === 0) languages.push('English');
    const payload = {
      key: catForm.key.trim() || slugify(name),
      name,
      active: catForm.active,
      languages,
      scenarios: catForm.scenarios,
    };
    try {
      const res = await fetch('/api/admin/review-library', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'category',
          mode: selectedCategory ? 'update' : 'create',
          payload,
        }),
      });
      const data: { error?: string; category?: CategoryView } = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || 'Failed to save category');
      await fetchCategories();
      setSelectedKey(payload.key);
      toast({ title: 'Saved', description: 'Category updated.', variant: 'success' });
    } catch (err) {
      toast({
        title: 'Could not save',
        description: err instanceof Error ? err.message : 'Something went wrong.',
        variant: 'error',
      });
    }
  };

  const deleteCategory = async () => {
    if (!selectedCategory) return;
    setDeleting(true);
    try {
      const res = await fetch(
        `/api/admin/review-library/categories/${encodeURIComponent(selectedCategory.key)}?cascade=true`,
        { method: 'DELETE' }
      );
      const data: { error?: string; deletedTemplates?: number } = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || 'Failed to delete category');
      setDeleteOpen(false);
      setSelectedKey('');
      await fetchCategories();
      const deletedTemplates = data.deletedTemplates ?? 0;
      toast({
        title: 'Category deleted',
        description:
          deletedTemplates > 0
            ? `The category and ${deletedTemplates} template(s) were removed.`
            : 'The category was removed.',
        variant: 'success',
      });
    } catch (err) {
      toast({
        title: 'Could not delete',
        description: err instanceof Error ? err.message : 'Something went wrong.',
        variant: 'error',
      });
    } finally {
      setDeleting(false);
    }
  };

  const addScenario = () => {
    setCatForm((prev) => ({
      ...prev,
      scenarios: [...prev.scenarios, { key: '', name: '' }],
    }));
  };

  const updateScenario = (index: number, patch: Partial<Scenario>) => {
    setCatForm((prev) => ({
      ...prev,
      scenarios: prev.scenarios.map((s, i) => (i === index ? { ...s, ...patch } : s)),
    }));
  };

  const removeScenario = (index: number) => {
    const key = catForm.scenarios[index]?.key;
    const usedBy = key ? templates.filter((tpl) => tpl.scenario === key).length : 0;
    if (usedBy > 0) {
      toast({
        title: 'Scenario in use',
        description: `${usedBy} template(s) use this scenario. Reassign or delete them first.`,
        variant: 'error',
      });
      return;
    }
    setCatForm((prev) => ({
      ...prev,
      scenarios: prev.scenarios.filter((_, i) => i !== index),
    }));
  };

  const openCreateTemplate = () => {
    const next = {
      ...EMPTY_TEMPLATE_FORM,
      scenario: catForm.scenarios[0]?.key ?? '',
      key: `${catForm.key}-tl-${Date.now()}`,
    };
    setEditingTemplate(null);
    setTplInitial(next);
    setTplForm(next);
    setTplModalOpen(true);
  };

  const openEditTemplate = (tpl: TemplateView) => {
    const next = {
      key: tpl.key,
      scenario: tpl.scenario,
      language: tpl.language,
      text: tpl.text,
      length: tpl.length as ReviewPreferredLength,
      style: (tpl.style ?? '') as ReviewWritingStyle | '',
      compatibleKeywords: (tpl.compatibleKeywords ?? []).join(', '),
    };
    setEditingTemplate(tpl);
    setTplInitial(next);
    setTplForm(next);
    setTplModalOpen(true);
  };

  const saveTemplate = async () => {
    const text = tplForm.text.trim();
    if (!text) {
      toast({ title: 'Text required', description: 'Template text cannot be empty.', variant: 'warning' });
      return;
    }
    const compatibleKeywords = tplForm.compatibleKeywords
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    setSavingTemplate(true);
    try {
      const res = await fetch('/api/admin/review-library', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'template',
          mode: editingTemplate ? 'update' : 'create',
          payload: {
            key: tplForm.key.trim(),
            categoryKey: selectedKey,
            scenario: tplForm.scenario,
            language: tplForm.language.trim() || 'English',
            text,
            length: tplForm.length,
            style: tplForm.style || undefined,
            compatibleKeywords,
            active: editingTemplate ? editingTemplate.active : true,
          },
        }),
      });
      const data: { error?: string } = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || 'Failed to save template');
      await fetchTemplates(selectedKey);
      await fetchCategories();
      setTplModalOpen(false);
      toast({ title: 'Saved', description: 'Template added to the library.', variant: 'success' });
    } catch (err) {
      toast({
        title: 'Could not save template',
        description: err instanceof Error ? err.message : 'Something went wrong.',
        variant: 'error',
      });
    } finally {
      setSavingTemplate(false);
    }
  };

  const toggleTemplate = async (tpl: TemplateView, next: boolean) => {
    try {
      const res = await fetch('/api/admin/review-library', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'template',
          mode: 'update',
          payload: {
            key: tpl.key,
            categoryKey: tpl.categoryKey,
            scenario: tpl.scenario,
            language: tpl.language,
            text: tpl.text,
            length: tpl.length,
            style: tpl.style || undefined,
            compatibleKeywords: tpl.compatibleKeywords ?? [],
            active: next,
          },
        }),
      });
      const data: { error?: string } = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || 'Failed to update template');
      setTemplates((prev) => prev.map((t) => (t._id === tpl._id ? { ...t, active: next } : t)));
      toast({ title: 'Updated', description: `Template ${next ? 'activated' : 'deactivated'}.`, variant: 'success' });
    } catch (err) {
      toast({
        title: 'Could not update',
        description: err instanceof Error ? err.message : 'Something went wrong.',
        variant: 'error',
      });
    }
  };

  const deleteTemplate = async (tpl: TemplateView) => {
    if (!window.confirm(`Permanently delete template "${tpl.key}"? It will stop serving immediately. This cannot be undone.`)) return;
    try {
      const res = await fetch(`/api/admin/review-library/templates/${encodeURIComponent(tpl.key)}`, {
        method: 'DELETE',
      });
      const data: { error?: string } = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || 'Failed to delete template');
      setTemplates((prev) => prev.filter((item) => item._id !== tpl._id));
      await fetchCategories();
      toast({ title: 'Deleted', description: 'Template removed.', variant: 'success' });
    } catch (err) {
      toast({
        title: 'Could not delete',
        description: err instanceof Error ? err.message : 'Something went wrong.',
        variant: 'error',
      });
    }
  };

  const handleImportFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const input = event.currentTarget;
    const file = input.files?.[0];
    // Allow selecting the same file again after a correction.
    input.value = '';
    if (!file) return;

    if (file.size === 0) {
      toast({
        title: 'File is empty',
        description: 'Select a non-empty exported JSON file.',
        variant: 'error',
      });
      return;
    }
    if (file.size > REVIEW_IMPORT_MAX_BYTES) {
      toast({
        title: 'File is too large',
        description: `Import files must be ${Math.round(REVIEW_IMPORT_MAX_BYTES / (1024 * 1024))} MB or smaller.`,
        variant: 'error',
      });
      return;
    }

    try {
      const text = await file.text();
      if (!text.trim()) throw new ReviewImportPayloadError('The selected file is empty.');
      // Parse exactly once here; Preview/Import reuse the normalized payload.
      const parsed = parseReviewLibraryImportText(text);
      setImportText(text);
      setImportFileName(file.name);
      setImportPayload(parsed);
      setImportPreview(null);
      setImportResult(null);
      toast({
        title: 'File loaded',
        description: `${file.name}: ${parsed.categories.length} categor${parsed.categories.length === 1 ? 'y' : 'ies'} and ${parsed.templates.length} template${parsed.templates.length === 1 ? '' : 's'}.`,
        variant: 'success',
      });
    } catch (err) {
      setImportText('');
      setImportFileName('');
      setImportPayload(null);
      setImportPreview(null);
      setImportResult(null);
      toast({
        title: 'Could not read file',
        description: err instanceof Error ? err.message : 'Select a valid JSON file.',
        variant: 'error',
      });
    }
  };

  const runPreview = async () => {
    if (importingRef.current) return;
    try {
      const payload = importPayload ?? parseReviewLibraryImportText(importText);
      if (!importPayload) setImportPayload(payload);

      const res = await fetch('/api/admin/review-library/import/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...toReviewLibraryImportBody(payload),
          overwrite: overwriteExisting,
        }),
      });
      const response = await readJsonResponse(res);
      if (!response.validJson) {
        throw new Error(
          response.empty
            ? 'Preview failed: the server returned an empty response.'
            : 'Preview failed: the server returned non-JSON data.'
        );
      }
      const data = asRecord(response.body);
      const preview = asRecord(data?.preview);
      if (!res.ok || !preview) throw new Error(formatApiError(response.body, 'Preview failed'));

      const invalid = Array.isArray(preview.invalid)
        ? preview.invalid.filter((item): item is string => typeof item === 'string')
        : [];
      setImportPreview({
        categoriesNew: Number(preview.categoriesNew) || 0,
        categoriesExisting: Number(preview.categoriesExisting) || 0,
        templatesNew: Number(preview.templatesNew) || 0,
        templatesExisting: Number(preview.templatesExisting) || 0,
        invalid,
      });
    } catch (err) {
      setImportPreview(null);
      toast({
        title: 'Preview failed',
        description: err instanceof Error ? err.message : 'Invalid JSON payload.',
        variant: 'error',
      });
    }
  };

  const runImport = async () => {
    if (importingRef.current || !importPreview || importPreview.invalid.length > 0) return;
    importingRef.current = true;
    setImporting(true);
    setImportResult(null);
    try {
      const payload = importPayload ?? parseReviewLibraryImportText(importText);
      if (!importPayload) setImportPayload(payload);

      const res = await fetch('/api/admin/review-library/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...toReviewLibraryImportBody(payload),
          overwrite: overwriteExisting,
        }),
      });
      const response = await readJsonResponse(res);
      if (!response.validJson) {
        throw new Error(
          response.empty
            ? 'Import failed: the server returned an empty response.'
            : 'Import failed: the server returned non-JSON data.'
        );
      }
      if (!res.ok) throw new Error(formatApiError(response.body, 'Import failed'));

      const data = asRecord(response.body);
      const imported = asRecord(data?.imported);
      const errors = Array.isArray(data?.errors)
        ? data.errors.filter((item): item is string => typeof item === 'string')
        : [];
      setImportResult({
        imported: {
          categories: Number(imported?.categories) || 0,
          templates: Number(imported?.templates) || 0,
        },
        errors,
      });
      await fetchCategories();
      if (selectedKey) await fetchTemplates(selectedKey);
      setImportPreview(null);
      if (errors.length > 0) {
        toast({
          title: 'Import completed with errors',
          description: `${errors.length} record(s) were rejected.`,
          variant: 'warning',
        });
      } else {
        toast({ title: 'Imported', description: 'Review library updated.', variant: 'success' });
      }
    } catch (err) {
      toast({
        title: 'Import failed',
        description: err instanceof Error ? err.message : 'Invalid JSON payload.',
        variant: 'error',
      });
    } finally {
      importingRef.current = false;
      setImporting(false);
    }
  };

  const runExport = async () => {
    try {
      const res = await fetch('/api/admin/review-library/export');
      const response = await readJsonResponse(res);
      if (!res.ok) throw new Error(formatApiError(response.body, 'Export failed'));
      if (!response.validJson) {
        throw new Error(
          response.empty
            ? 'Export failed: the server returned an empty response.'
            : 'Export failed: the server returned non-JSON data.'
        );
      }
      const data = asRecord(response.body);
      const exported = {
        categories: Array.isArray(data?.categories) ? data.categories : [],
        templates: Array.isArray(data?.templates) ? data.templates : [],
      };
      const blob = new Blob([JSON.stringify(exported, null, 2)], {
        type: 'application/json',
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'review-library.json';
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1500);
    } catch (err) {
      toast({
        title: 'Export failed',
        description: err instanceof Error ? err.message : 'Something went wrong.',
        variant: 'error',
      });
    }
  };

  const scenarioNames = new Map((selectedCategory?.scenarios ?? []).map((s) => [s.key, s.name]));

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-ink tracking-tight">Review Library</h1>
          <p className="text-ink-mute text-sm mt-0.5">
            Reusable categories and templates for template-based review suggestions.
          </p>
          <p className="text-ink-mute/80 text-xs mt-1 max-w-2xl">
            Templates only use {'{businessName}'}, {'{employee}'}, {'{service}'} and{' '}
            {'{keyword}'} placeholders. Deactivating hides them from suggestion rotation;
            deleting a category permanently removes it (and, by confirmation, its templates).
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button data-testid="export-json" variant="outline" size="sm" onClick={() => void runExport()}>
            <Download className="h-4 w-4 mr-1.5" />
            Export
          </Button>
          <Button data-testid="import-open" variant="outline" size="sm" onClick={() => setImportOpen(true)}>
            <FileUp className="h-4 w-4 mr-1.5" />
            Import
          </Button>
          <Button data-testid="refresh" variant="primary" size="sm" onClick={() => confirmDiscardCategory(() => void refreshLibrary())} disabled={loading}>
            <Loader2 className={cn('h-4 w-4 mr-1.5', loading && 'animate-spin')} />
            Refresh
          </Button>
        </div>
      </div>

      {pageError && (
        <div className="flex items-center justify-between gap-4 rounded-lg bg-red-500/10 px-4 py-3 ring-1 ring-red-500/20">
          <p className="text-sm text-red-400">{pageError}</p>
          <Button variant="outline" size="sm" onClick={() => void refreshLibrary()}>
            Retry
          </Button>
        </div>
      )}

      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="skeleton h-24 rounded-lg" />
          ))}
        </div>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[280px_1fr]">
          {/* ── Category list ── */}
          <aside className="space-y-2">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-ink">Categories</h2>
              <Button data-testid="category-new" variant="ghost" size="sm" onClick={() => confirmDiscardCategory(() => setSelectedKey(''))}>
                <Plus className="h-4 w-4" />
                New
              </Button>
            </div>
            {categories.length === 0 && (
              <p className="rounded-lg bg-bg-raised px-3 py-6 text-center text-sm text-ink-faint">
                No categories yet. Create your first one.
              </p>
            )}
            {categories.map((cat) => (
              <button
                key={cat.key}
                type="button"
                data-testid={`category-${cat.key}`} onClick={() => confirmDiscardCategory(() => setSelectedKey(cat.key))}
                className={cn(
                  'flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2.5 text-left ring-1 transition-colors',
                  selectedKey === cat.key
                    ? 'bg-accent-600/10 ring-accent-600/25'
                    : 'bg-surface ring-line-subtle hover:bg-bg-raised'
                )}
              >
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium text-ink">{cat.name}</span>
                  <span className="block truncate text-xs text-ink-faint">/{cat.key}</span>
                </span>
                <span className="flex shrink-0 items-center gap-1.5">
                  <Badge variant="default" className="bg-field text-ink-faint ring-line-subtle">
                    {cat.templateCount} tpl
                  </Badge>
                  <span
                    aria-label={cat.active ? 'Active' : 'Inactive'}
                    className={cn(
                      'h-2 w-2 rounded-full',
                      cat.active ? 'bg-ok' : 'bg-ink-faint'
                    )}
                  />
                </span>
              </button>
            ))}
          </aside>

          {/* ── Detail panel ── */}
          <section className="space-y-6">
            {/* Category editor */}
            <Card className="bg-surface border-transparent ring-1 ring-line-subtle">
              <div className="border-b border-line-subtle p-4 sm:p-5">
                <h2 className="text-base font-semibold text-ink">
                  {selectedCategory ? 'Edit category' : 'New category'}
                </h2>
              </div>
              <div className="space-y-4 p-4 sm:p-5">
                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <label htmlFor="rl-cat-name" className="mb-1.5 block text-sm font-medium text-ink-mute">
                      Name
                    </label>
                    <Input
                      id="rl-cat-name"
                      value={catForm.name}
                      onChange={(e) => {
                        const name = e.target.value;
                        setCatForm((prev) => ({
                          ...prev,
                          name,
                          key: selectedCategory ? prev.key : slugify(name),
                        }));
                      }}
                      placeholder="Mobile Repair"
                    />
                  </div>
                  <div>
                    <label htmlFor="rl-cat-key" className="mb-1.5 block text-sm font-medium text-ink-mute">
                      Key
                    </label>
                    <Input
                      id="rl-cat-key"
                      value={catForm.key}
                      disabled={!!selectedCategory}
                      onChange={(e) => setCatForm((prev) => ({ ...prev, key: slugify(e.target.value) }))}
                      placeholder="mobile-repair"
                    />
                  </div>
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <label htmlFor="rl-cat-langs" className="mb-1.5 block text-sm font-medium text-ink-mute">
                      Languages <span className="text-ink-faint">(comma-separated)</span>
                    </label>
                    <Input
                      id="rl-cat-langs"
                      value={catForm.languages}
                      onChange={(e) => setCatForm((prev) => ({ ...prev, languages: e.target.value }))}
                      placeholder="English, Spanish…"
                    />
                  </div>
                  <div className="flex items-end pb-1">
                    <label className="flex items-center gap-2 text-sm font-medium text-ink-mute">
                      <Switch
                        data-testid="category-active"
                        aria-label="Category active"
                        checked={catForm.active}
                        onChange={(checked) => setCatForm((prev) => ({ ...prev, active: checked }))}
                        size="sm"
                      />
                      Active
                    </label>
                  </div>
                </div>

                <div>
                  <div className="mb-1.5 flex items-center justify-between">
                    <p className="text-sm font-medium text-ink-mute">
                      Scenarios <span className="text-ink-faint">(templates are grouped by scenario)</span>
                    </p>
                    <Button data-testid="scenario-add" variant="outline" size="sm" onClick={addScenario}>
                      <Plus className="h-4 w-4 mr-1" />
                      Add
                    </Button>
                  </div>
                  {catForm.scenarios.length === 0 && (
                    <p className="rounded-lg bg-bg-raised px-3 py-4 text-center text-xs text-ink-faint">
                      Add scenarios such as {"\u201cemployee-service\u201d, \u201cservice-quality\u201d"}…
                    </p>
                  )}
                  <ul className="space-y-2">
                    {catForm.scenarios.map((scenario, index) => (
                      <li key={index} className="flex flex-col gap-2 sm:flex-row sm:items-center">
                        <Input
                          value={scenario.key}
                          placeholder="key (e.g. service-quality)"
                          data-testid={`scenario-key-${index}`} aria-label={`Scenario ${index + 1} key`}
                          onChange={(e) =>
                            updateScenario(index, { key: slugify(e.target.value) })
                          }
                          className="font-mono text-xs"
                        />
                        <Input
                          value={scenario.name}
                          placeholder="Display name (e.g. Service quality)"
                          data-testid={`scenario-name-${index}`} aria-label={`Scenario ${index + 1} name`}
                          onChange={(e) => updateScenario(index, { name: e.target.value })}
                        />
                        <Button
                          variant="ghost"
                          size="sm"
                          data-testid={`scenario-remove-${index}`} aria-label="Remove scenario"
                          onClick={() => removeScenario(index)}
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      </li>
                    ))}
                  </ul>
                </div>

                <div className="flex items-center justify-between gap-2 pt-1">
                  {selectedCategory ? (
                    <Button variant="danger" size="sm" onClick={() => setDeleteOpen(true)}>
                      <Trash2 className="h-4 w-4 mr-1.5" />
                      Delete category
                    </Button>
                  ) : (
                    <span />
                  )}
                  <Button data-testid="category-save" variant="primary" onClick={() => void saveCategory()}>
                    <Save className="h-4 w-4 mr-1.5" />
                    Save category
                  </Button>
                </div>
              </div>
            </Card>

            {/* Templates */}
            <Card className="bg-surface border-transparent ring-1 ring-line-subtle">
              <div className="flex items-center justify-between border-b border-line-subtle p-4 sm:p-5">
                <div>
                  <h2 className="text-base font-semibold text-ink">Templates</h2>
                  <p className="text-xs text-ink-faint mt-0.5">
                    {selectedCategory
                      ? selectedCategory.scenarios.length > 0
                        ? `${selectedCategory.name} / ${selectedCategory.scenarios.length} scenarios`
                        : 'Add at least one scenario before adding templates.'
                      : 'Save the category to add templates to it.'}
                  </p>
                </div>
                <Button
                  variant="primary"
                  size="sm"
                  data-testid="template-add" disabled={!selectedCategory || selectedCategory.scenarios.length === 0}
                  title={selectedCategory && selectedCategory.scenarios.length === 0 ? 'Add a scenario first' : undefined}
                  onClick={openCreateTemplate}
                >
                  <Plus className="h-4 w-4 mr-1.5" />
                  Add template
                </Button>
              </div>

              {templatesError && (
                <div
                  role="alert"
                  aria-live="polite"
                  className="mx-4 mt-4 rounded-lg bg-bad/10 px-3 py-2 text-xs text-bad ring-1 ring-bad/20"
                >
                  {templatesError}
                </div>
              )}

              {templatesLoading ? (
                <div className="space-y-3 p-5">
                  {Array.from({ length: 3 }).map((_, i) => (
                    <div key={i} className="skeleton h-16 rounded-lg" />
                  ))}
                </div>
              ) : templates.length === 0 ? (
                <div className="p-12 text-center">
                  <BookOpen className="mx-auto mb-3 h-8 w-8 text-ink-faint" aria-hidden="true" />
                  <p className="text-sm font-medium text-ink">
                    {templatesError ? 'Templates unavailable' : 'No templates yet'}
                  </p>
                  <p className="mt-1 text-sm text-ink-mute">
                    {templatesError
                      ? 'The category templates could not be loaded. Retry with Refresh.'
                      : selectedCategory
                        ? 'Add a template to start serving category suggestions.'
                        : 'Save a category first.'}
                  </p>
                </div>
              ) : (
                <ul className="divide-y divide-line-subtle">
                  {templates.map((tpl) => (
                    <li key={tpl._id} className="flex flex-col gap-2 p-4 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
                      <div className="min-w-0">
                        <div className="mb-1 flex flex-wrap items-center gap-1.5">
                          <Badge variant="default" className="bg-field text-ink-faint ring-line-subtle">
                            {scenarioNames.get(tpl.scenario) ?? tpl.scenario}
                          </Badge>
                          <Badge variant="default" className="bg-field text-ink-faint ring-line-subtle">
                            {tpl.language}
                          </Badge>
                          <Badge variant="default" className="bg-field text-ink-faint ring-line-subtle">
                            {tpl.length}
                          </Badge>
                          {tpl.style && (
                            <Badge variant="default" className="bg-field text-ink-faint ring-line-subtle">
                              {tpl.style}
                            </Badge>
                          )}
                          {tpl.usageCount > 0 && (
                            <Badge variant="default" className="bg-accent-600/10 text-accent-400 ring-accent-600/20">
                              used {tpl.usageCount}×
                            </Badge>
                          )}
                        </div>
                        <p className="text-sm leading-relaxed text-ink line-clamp-2">{tpl.text}</p>
                        <p className="mt-0.5 text-xs font-mono text-ink-faint">/{tpl.key}</p>
                      </div>
                      <div className="flex shrink-0 items-center gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          title="Edit template"
                          data-testid={`template-edit-${tpl.key}`} aria-label={`Edit ${tpl.key}`}
                          onClick={() => openEditTemplate(tpl)}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          title="Delete template"
                          data-testid={`template-delete-${tpl.key}`} aria-label={`Delete ${tpl.key}`}
                          onClick={() => void deleteTemplate(tpl)}
                          className="text-bad hover:bg-bad/10"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                        <Switch
                          checked={tpl.active}
                          onChange={(next) => toggleTemplate(tpl, next)}
                          size="sm"
                          data-testid={`template-toggle-${tpl.key}`} aria-label={`${tpl.active ? 'Deactivate' : 'Activate'} ${tpl.key}`}
                        />
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </section>
        </div>
      )}

      {/* ── Add template modal ── */}
      <Modal
        isOpen={tplModalOpen}
        onClose={closeTemplateModal}
        title={editingTemplate ? 'Edit template' : 'Add template'}
        className="max-w-lg"
      >
        <div className="space-y-4">
          <div>
            <label htmlFor="tpl-key" className="mb-1.5 block text-sm font-medium text-ink-mute">
              Template key
            </label>
            <Input
              id="tpl-key"
              value={tplForm.key}
              readOnly={Boolean(editingTemplate)}
              onChange={(event) => setTplForm((prev) => ({ ...prev, key: event.target.value }))}
              className="font-mono text-xs"
            />
            <p className="mt-1 text-xs text-ink-faint">
              {editingTemplate ? 'Template identity is locked while editing.' : 'Unique key for this template.'}
            </p>
          </div>
          <div>
            <label htmlFor="tpl-text" className="mb-1.5 block text-sm font-medium text-ink-mute">
              Template text
            </label>
            <textarea
              id="tpl-text"
              rows={4}
              maxLength={1000}
              value={tplForm.text}
              onChange={(e) => setTplForm((prev) => ({ ...prev, text: e.target.value }))}
              placeholder={'Thank you for choosing us, {businessName}… {employee} took great care.'}
              className="w-full rounded-lg border border-line bg-field px-3 py-2 text-sm text-ink placeholder:text-ink-faint focus:border-accent-500 focus:outline-none focus:ring-2 focus:ring-accent-500/25"
            />
            <p className="mt-1 text-xs text-ink-faint">
              Allowed placeholders: {'{businessName}'}, {'{employee}'}, {'{service}'}, {'{keyword}'}
            </p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Select
                id="tpl-scenario"
                label="Scenario"
                value={tplForm.scenario}
                options={(selectedCategory?.scenarios ?? []).map((s) => ({
                  value: s.key,
                  label: `${s.name} (${s.key})`,
                }))}
                onChange={(value) => setTplForm((prev) => ({ ...prev, scenario: value }))}
              />
            </div>
            <div>
              <label htmlFor="tpl-lang" className="mb-1.5 block text-sm font-medium text-ink-mute">
                Language
              </label>
              <Input
                id="tpl-lang"
                value={tplForm.language}
                onChange={(e) => setTplForm((prev) => ({ ...prev, language: e.target.value }))}
                placeholder="English"
              />
            </div>
            <div>
              <Select
                id="tpl-length"
                label="Length"
                value={tplForm.length}
                options={LENGTH_OPTIONS}
                onChange={(value) =>
                  setTplForm((prev) => ({ ...prev, length: value as ReviewPreferredLength }))
                }
              />
            </div>
            <div>
              <Select
                id="tpl-style"
                label="Style"
                value={tplForm.style}
                options={STYLE_OPTIONS}
                onChange={(value) =>
                  setTplForm((prev) => ({ ...prev, style: value as ReviewWritingStyle | '' }))
                }
              />
            </div>
          </div>
          <div>
            <label htmlFor="tpl-keywords" className="mb-1.5 block text-sm font-medium text-ink-mute">
              Compatible keywords <span className="text-ink-faint">(comma-separated, for {'{keyword}'})</span>
            </label>
            <Input
              id="tpl-keywords"
              value={tplForm.compatibleKeywords}
              onChange={(e) => setTplForm((prev) => ({ ...prev, compatibleKeywords: e.target.value }))}
              placeholder="fast, professional…"
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={closeTemplateModal}>
              Cancel
            </Button>
            <Button data-testid="template-save" variant="primary" onClick={() => void saveTemplate()} isLoading={savingTemplate}>
              <Check className="h-4 w-4 mr-1.5" />
              Save template
            </Button>
          </div>
        </div>
      </Modal>

      {/* ── Import modal ── */}
      <Modal
        isOpen={importOpen}
        onClose={() => {
          if (importing) return;
          setImportOpen(false);
          setImportText('');
          setImportFileName('');
          setImportPayload(null);
          setImportResult(null);
          setImportPreview(null);
          setOverwriteExisting(false);
        }}
        title="Import review library"
        className="max-w-lg"
      >
        <div className="space-y-4">
          <p className="text-sm text-ink-mute">
            Select an exported JSON file or paste the{' '}
            <code className="rounded bg-field px-1 py-0.5 font-mono text-xs">{"{ categories, templates }"}</code>{' '}
            payload. This upserts by key and never deletes existing rows.
          </p>

          <div className="rounded-lg border border-dashed border-line-strong bg-field/60 px-3 py-3">
            <label htmlFor="rl-import-file" className="mb-1.5 block text-sm font-medium text-ink">
              JSON file
            </label>
            <input
              data-testid="import-file"
              id="rl-import-file"
              type="file"
              accept=".json,application/json"
              onChange={(event) => void handleImportFile(event)}
              disabled={importing}
              className="block w-full text-sm text-ink-mute file:mr-3 file:rounded-lg file:border-0 file:bg-accent-600/15 file:px-3 file:py-2 file:text-sm file:font-medium file:text-accent-300 hover:file:bg-accent-600/25 disabled:opacity-50"
            />
            <p className="mt-1.5 text-xs text-ink-faint">
              The complete file is read before parsing. Maximum {Math.round(REVIEW_IMPORT_MAX_BYTES / (1024 * 1024))} MB.
            </p>
            {importFileName && (
              <p className="mt-1.5 font-mono text-xs text-accent-400">Loaded: {importFileName}</p>
            )}
          </div>

          <label htmlFor="rl-import-json" className="mb-1.5 block text-sm font-medium text-ink-mute">
            JSON payload
          </label>
          <textarea
            data-testid="import-json" id="rl-import-json"
            rows={10}
            value={importText}
            onChange={(e) => {
              setImportText(e.target.value);
              setImportFileName('');
              setImportPayload(null);
              setImportPreview(null);
            }}
            placeholder='{ "categories": [], "templates": [] }'
            className="w-full rounded-lg border border-line bg-field px-3 py-2 font-mono text-xs text-ink placeholder:text-ink-faint focus:border-accent-500 focus:outline-none focus:ring-2 focus:ring-accent-500/25"
          />
          {importPreview && (
            <div className="rounded-lg bg-field px-3 py-2 text-xs text-ink-mute ring-1 ring-line-subtle">
              <p>
                Categories: {importPreview.categoriesNew} new, {importPreview.categoriesExisting} existing.
                {' '}Templates: {importPreview.templatesNew} new, {importPreview.templatesExisting} existing.
              </p>
              {importPreview.invalid.length > 0 && (
                <>
                  <p className="mt-1 font-medium text-warn">
                    Fix these issues before importing — nothing has been written.
                  </p>
                  <ul className="mt-1 list-disc pl-4 text-warn">
                    {importPreview.invalid.slice(0, 10).map((error) => (
                      <li key={error}>{error}</li>
                    ))}
                  </ul>
                </>
              )}
            </div>
          )}

          <label className="flex items-start gap-2 rounded-lg bg-warn/10 px-3 py-2 text-xs text-warn ring-1 ring-warn/20">
            <input
              data-testid="import-overwrite"
              type="checkbox"
              checked={overwriteExisting}
              onChange={(event) => {
                setOverwriteExisting(event.target.checked);
                // Overwrite changes which records are written, so preview again
                // before enabling Import.
                setImportPreview(null);
              }}
              className="mt-0.5"
            />
            <span>
              Overwrite existing categories/templates with the same keys. Leave unchecked to skip
              existing records (default).
            </span>
          </label>

          {importResult && (
            <div className={cn(
              'rounded-lg px-3 py-2 text-xs ring-1',
              importResult.errors?.length ? 'bg-warn/10 ring-warn/20 text-warn' : 'bg-ok/10 ring-ok/20 text-ok'
            )}>
              Imported {importResult.imported?.categories ?? 0} categories and{' '}
              {importResult.imported?.templates ?? 0} templates.
              {importResult.errors && importResult.errors.length > 0 && (
                <ul className="mt-1 list-disc pl-4">
                  {importResult.errors.map((err) => (
                    <li key={err} className="text-xs">{err}</li>
                  ))}
                </ul>
              )}
            </div>
          )}
          <div className="flex flex-wrap justify-end gap-2">
            <Button
              variant="outline"
              onClick={() => {
                setImportOpen(false);
                setImportText('');
                setImportFileName('');
                setImportPayload(null);
                setImportResult(null);
                setImportPreview(null);
                setOverwriteExisting(false);
              }}
              disabled={importing}
            >
              Close
            </Button>
            <Button
              data-testid="import-preview"
              variant="outline"
              onClick={() => void runPreview()}
              disabled={!importText.trim() || importing}
            >
              Preview
            </Button>
            <Button
              data-testid="import-submit"
              variant="primary"
              onClick={() => void runImport()}
              disabled={
                !importText.trim() ||
                !importPreview ||
                importPreview.invalid.length > 0 ||
                importing
              }
              isLoading={importing}
            >
              <FileUp className="h-4 w-4 mr-1.5" />
              {importing ? 'Importing…' : 'Import'}
            </Button>
          </div>
        </div>
      </Modal>

      {/* ── Delete category confirmation ── */}
      <Modal
        isOpen={deleteOpen}
        onClose={() => {
          if (!deleting) setDeleteOpen(false);
        }}
        title="Delete category?"
        className="max-w-md"
      >
        <div className="space-y-4">
          <p className="text-sm leading-relaxed text-ink-mute">
            Permanently delete{' '}
            <span className="font-semibold text-ink">
              {selectedCategory?.name} (/{selectedCategory?.key})
            </span>
            {selectedCategory && selectedCategory.templateCount > 0 && (
              <>
                {' '}and its{' '}
                <span className="font-semibold text-ink">
                  {selectedCategory?.templateCount} template(s)
                </span>
              </>
            )}
            ? This cannot be undone. If you only want to hide it from rotation, deactivate it
            instead.
          </p>
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="outline" onClick={() => setDeleteOpen(false)} disabled={deleting}>
              Cancel
            </Button>
            <Button variant="danger" onClick={() => void deleteCategory()} isLoading={deleting}>
              <Trash2 className="h-4 w-4 mr-1.5" />
              Delete
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}