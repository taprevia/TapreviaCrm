'use client';

/**
 * Admin Review Library — manage reusable review categories and templates.
 *
 * Editing is add/edit/deactivate only for templates; a category can also be
 * permanently deleted (with its templates) behind a confirmation. Bulk
 * import/export round-trip the full { categories, templates } JSON artifact.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
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
  Plus,
  Save,
  Trash2,
  X,
} from 'lucide-react';
import { cn } from '@/lib/utils';

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

  // Import modal.
  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState('');
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
    if (!key) {
      setTemplates([]);
      return;
    }
    setTemplatesLoading(true);
    try {
      const res = await fetch(
        `/api/admin/review-library?categoryKey=${encodeURIComponent(key)}`
      );
      if (!res.ok) throw new Error('Failed to load templates');
      const data: { templates?: TemplateView[] } = await res.json();
      setTemplates(data.templates ?? []);
    } catch {
      setTemplates([]);
    } finally {
      setTemplatesLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchTemplates(selectedKey);
  }, [selectedKey, fetchTemplates]);

  const selectedCategory = useMemo(
    () => categories.find((c) => c.key === selectedKey) ?? null,
    [categories, selectedKey]
  );

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
    const payload = {
      key: catForm.key.trim() || slugify(name),
      name,
      active: catForm.active,
      languages: catForm.languages
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
      scenarios: catForm.scenarios,
    };
    try {
      const res = await fetch('/api/admin/review-library', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'category', payload }),
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
    setCatForm((prev) => ({
      ...prev,
      scenarios: prev.scenarios.filter((_, i) => i !== index),
    }));
  };

  const openCreateTemplate = () => {
    setTplForm({
      ...EMPTY_TEMPLATE_FORM,
      scenario: catForm.scenarios[0]?.key ?? '',
      key: `${catForm.key}-tl-${Date.now()}`,
    });
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
          payload: {
            key: tplForm.key.trim(),
            categoryKey: selectedKey,
            scenario: tplForm.scenario,
            language: tplForm.language.trim() || 'English',
            text,
            length: tplForm.length,
            style: tplForm.style || undefined,
            compatibleKeywords,
            active: true,
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

  const runImport = async () => {
    setImportResult(null);
    try {
      const parsed = JSON.parse(importText);
      const res = await fetch('/api/admin/review-library/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(parsed),
      });
      const data: {
        error?: string;
        imported?: { categories: number; templates: number };
        errors?: string[];
      } = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || 'Import failed');
      setImportResult({
        imported: data.imported ?? { categories: 0, templates: 0 },
        errors: data.errors,
      });
      if (data.errors?.length === 0) {
        await fetchCategories();
        toast({ title: 'Imported', description: 'Review library updated.', variant: 'success' });
      }
    } catch (err) {
      toast({
        title: 'Import failed',
        description: err instanceof Error ? err.message : 'Invalid JSON payload.',
        variant: 'error',
      });
    }
  };

  const runExport = async () => {
    try {
      const res = await fetch('/api/admin/review-library/export');
      if (!res.ok) throw new Error('Export failed');
      const data = await res.json();
      const blob = new Blob([JSON.stringify(data.categories ? { categories: data.categories, templates: data.templates } : data, null, 2)], {
        type: 'application/json',
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'review-library.json';
      a.click();
      URL.revokeObjectURL(url);
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
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => void runExport()}>
            <Download className="h-4 w-4 mr-1.5" />
            Export
          </Button>
          <Button variant="outline" size="sm" onClick={() => setImportOpen(true)}>
            <FileUp className="h-4 w-4 mr-1.5" />
            Import
          </Button>
          <Button variant="primary" size="sm" onClick={() => void fetchCategories()} disabled={loading}>
            <Loader2 className={cn('h-4 w-4 mr-1.5', loading && 'animate-spin')} />
            Refresh
          </Button>
        </div>
      </div>

      {pageError && (
        <div className="flex items-center justify-between gap-4 rounded-lg bg-red-500/10 px-4 py-3 ring-1 ring-red-500/20">
          <p className="text-sm text-red-400">{pageError}</p>
          <Button variant="outline" size="sm" onClick={() => void fetchCategories()}>
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
              <Button variant="ghost" size="sm" onClick={() => setSelectedKey('')}>
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
                onClick={() => setSelectedKey(cat.key)}
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
                    <Button variant="outline" size="sm" onClick={addScenario}>
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
                      <li key={index} className="flex items-center gap-2">
                        <Input
                          value={scenario.key}
                          placeholder="key (e.g. service-quality)"
                          onChange={(e) =>
                            updateScenario(index, { key: slugify(e.target.value) })
                          }
                          className="font-mono text-xs"
                        />
                        <Input
                          value={scenario.name}
                          placeholder="Display name (e.g. Service quality)"
                          onChange={(e) => updateScenario(index, { name: e.target.value })}
                        />
                        <Button
                          variant="ghost"
                          size="sm"
                          aria-label="Remove scenario"
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
                  <Button variant="primary" onClick={() => void saveCategory()}>
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
                      ? `${selectedCategory.name} / ${selectedCategory.scenarios.length} scenarios`
                      : 'Save the category to add templates to it.'}
                  </p>
                </div>
                <Button
                  variant="primary"
                  size="sm"
                  disabled={!selectedCategory}
                  onClick={openCreateTemplate}
                >
                  <Plus className="h-4 w-4 mr-1.5" />
                  Add template
                </Button>
              </div>

              {templatesLoading ? (
                <div className="space-y-3 p-5">
                  {Array.from({ length: 3 }).map((_, i) => (
                    <div key={i} className="skeleton h-16 rounded-lg" />
                  ))}
                </div>
              ) : templates.length === 0 ? (
                <div className="p-12 text-center">
                  <BookOpen className="mx-auto mb-3 h-8 w-8 text-ink-faint" aria-hidden="true" />
                  <p className="text-sm font-medium text-ink">No templates yet</p>
                  <p className="mt-1 text-sm text-ink-mute">
                    {selectedCategory
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
                      <div className="flex shrink-0 items-center gap-2">
                        <Switch
                          checked={tpl.active}
                          onChange={(next) => toggleTemplate(tpl, next)}
                          size="sm"
                          aria-label={`${tpl.active ? 'Deactivate' : 'Activate'} ${tpl.key}`}
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
        onClose={() => setTplModalOpen(false)}
        title="Add template"
        className="max-w-lg"
      >
        <div className="space-y-4">
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
            <Button variant="outline" onClick={() => setTplModalOpen(false)}>
              Cancel
            </Button>
            <Button variant="primary" onClick={() => void saveTemplate()} isLoading={savingTemplate}>
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
          setImportOpen(false);
          setImportText('');
          setImportResult(null);
        }}
        title="Import review library"
        className="max-w-lg"
      >
        <div className="space-y-4">
          <p className="text-sm text-ink-mute">
            Paste the exported JSON <code className="rounded bg-field px-1 py-0.5 font-mono text-xs">{"{ categories, templates }"}</code>payload. This upserts by key and never deletes existing rows.
          </p>
          <textarea
            rows={10}
            value={importText}
            onChange={(e) => setImportText(e.target.value)}
            placeholder='{ "categories": [], "templates": [] }'
            className="w-full rounded-lg border border-line bg-field px-3 py-2 font-mono text-xs text-ink placeholder:text-ink-faint focus:border-accent-500 focus:outline-none focus:ring-2 focus:ring-accent-500/25"
          />
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
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setImportOpen(false)}>
              Close
            </Button>
            <Button variant="primary" onClick={() => void runImport()} disabled={!importText.trim()}>
              <FileUp className="h-4 w-4 mr-1.5" />
              Import
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