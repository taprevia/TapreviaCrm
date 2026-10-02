'use client';

/**
 * Products tab — CRUD surface for a vCard's catalogue.
 *
 * Unlike draft-backed tabs this one owns its fetch/mutation state against
 * /api/cards/[id]/products (GET list + POST create) and /api/products/[id]
 * (PATCH update, DELETE). The builder context is intentionally not used:
 * products are a standalone REST resource, not part of the vCard document.
 */

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
} from 'react';
import { Package, Pencil, Plus, Trash2 } from 'lucide-react';
import {
  Badge,
  Button,
  EmptyState,
  Input,
  Modal,
  Select,
  Switch,
  useToast,
} from '@/components/ui';
import { RemoveUploadButton, UploadButton } from '../upload-button';
import { cn } from '@/lib/utils';

/* ─── Client-side contracts (mirror the live API responses) ─────────────────── */

/** Product as it travels over JSON (dates omitted — unused by this tab). */
interface ProductRow {
  _id: string;
  title: string;
  description: string;
  priceMinor: number;
  currency: string;
  imageUrl: string;
  category: string;
  active: boolean;
  sortOrder: number;
  enquiryCount: number;
}

interface ListMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

interface ProductsResponse {
  items?: ProductRow[];
  meta?: ListMeta;
}

/** Uniform error body; VALIDATION_ERROR carries per-field messages. */
interface ApiErrorBody {
  error?: string;
  fieldErrors?: Record<string, string>;
}

type ProductMutationResponse = { product?: ProductRow } & ApiErrorBody;

/* ─── Formatting helpers ────────────────────────────────────────────────────── */

const CURRENCY_SYMBOLS: Record<string, string> = {
  INR: '₹',
  USD: '$',
  EUR: '€',
  GBP: '£',
};

const CURRENCY_OPTIONS = [
  { value: 'INR', label: 'INR (₹)' },
  { value: 'USD', label: 'USD ($)' },
  { value: 'EUR', label: 'EUR (€)' },
  { value: 'GBP', label: 'GBP (£)' },
];

/**
 * '₹1,299' style price label. Integers stay decimal-free; fractional amounts
 * cap at two places. Unknown currencies fall back to the ₹ symbol.
 */
function formatPrice(priceMinor: number, currency: string): string {
  const major = (priceMinor ?? 0) / 100;
  const symbol = CURRENCY_SYMBOLS[currency] ?? '₹';
  const locale = currency === 'INR' ? 'en-IN' : 'en-US';
  return `${symbol}${major.toLocaleString(locale, {
    maximumFractionDigits: Number.isInteger(major) ? 0 : 2,
    minimumFractionDigits: 0,
  })}`;
}

/** Major-units string for <input type="number"> prefill ('12', '12.5', …). */
function minorToMajorInput(priceMinor: number): string {
  return String((priceMinor ?? 0) / 100);
}

/* ─── Form model ────────────────────────────────────────────────────────────── */

interface ProductFormState {
  title: string;
  description: string;
  /** Price in MAJOR units as typed by the user ('' allowed); ×100 on save. */
  priceMajor: string;
  currency: string;
  category: string;
  imageUrl: string;
  sortOrder: string;
}

function emptyForm(nextSortOrder: number): ProductFormState {
  return {
    title: '',
    description: '',
    priceMajor: '',
    currency: 'INR',
    category: '',
    imageUrl: '',
    sortOrder: String(nextSortOrder),
  };
}

const RED_GHOST = 'text-red-400 hover:bg-bad/10 hover:text-red-300';

const ICON_BUTTON =
  'inline-flex h-8 w-8 items-center justify-center rounded-lg text-ink-mute transition-colors hover:bg-surface-2 hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 disabled:pointer-events-none disabled:opacity-40';

/* ─── Component ─────────────────────────────────────────────────────────────── */

interface ProductsTabProps {
  cardId: string;
}

export function ProductsTab({ cardId }: ProductsTabProps) {
  const { toast } = useToast();

  /* ── List state ── */
  const [items, setItems] = useState<ProductRow[]>([]);
  const [meta, setMeta] = useState<ListMeta | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  // Post-mutation refreshes keep stale rows visible instead of flashing skeletons.
  const loadedOnceRef = useRef(false);

  useEffect(() => {
    const controller = new AbortController();
    if (!loadedOnceRef.current) setLoading(true);
    setError(null);

    fetch(`/api/cards/${cardId}/products?page=1&limit=100`, { signal: controller.signal })
      .then(async (res) => {
        const data = (await res.json().catch(() => null)) as (ProductsResponse & ApiErrorBody) | null;
        if (!res.ok) throw new Error(data?.error || "Failed to load products");
        return data as ProductsResponse;
      })
      .then((data) => {
        setItems(data.items ?? []);
        setMeta(data.meta ?? null);
        setLoading(false);
        loadedOnceRef.current = true;
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setError(err instanceof Error ? err.message : "Failed to load products");
        setLoading(false);
        loadedOnceRef.current = true;
      });

    return () => controller.abort();
  }, [cardId, reloadKey]);

  /* ── Editor modal state ── */
  const [editorOpen, setEditorOpen] = useState(false);
  /** null ⇒ create mode; otherwise the _id being patched. */
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<ProductFormState>(() => emptyForm(0));
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  /* ── Row mutation state ── */
  const [togglingIds, setTogglingIds] = useState<ReadonlySet<string>>(new Set());
  const [deleteTarget, setDeleteTarget] = useState<ProductRow | null>(null);
  const [deleting, setDeleting] = useState(false);

  const openCreate = useCallback(() => {
    setForm(emptyForm(items.length)); // default sort order = next index
    setEditingId(null);
    setFieldErrors({});
    setEditorOpen(true);
  }, [items.length]);

  const openEdit = useCallback((product: ProductRow) => {
    setForm({
      title: product.title ?? '',
      description: product.description ?? '',
      priceMajor: product.priceMinor ? minorToMajorInput(product.priceMinor) : '',
      currency: product.currency || 'INR',
      category: product.category ?? '',
      imageUrl: product.imageUrl ?? '',
      sortOrder: String(product.sortOrder ?? 0),
    });
    setEditingId(product._id);
    setFieldErrors({});
    setEditorOpen(true);
  }, []);

  const closeEditor = useCallback(() => {
    if (saving) return;
    setEditorOpen(false);
  }, [saving]);

  /* ── Active toggle: optimistic PATCH with revert-on-fail ── */
  const handleToggleActive = useCallback(
    async (product: ProductRow, nextActive: boolean) => {
      if (product.active === nextActive || togglingIds.has(product._id)) return;

      setTogglingIds((prev) => new Set(prev).add(product._id));
      setItems((prev) =>
        prev.map((p) => (p._id === product._id ? { ...p, active: nextActive } : p))
      );

      try {
        const res = await fetch(`/api/products/${product._id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ active: nextActive }),
        });
        const data = (await res.json().catch(() => null)) as ProductMutationResponse | null;

        if (!res.ok) throw new Error(data?.error || 'Could not update visibility.');

        // Reconcile against the authoritative server value, just in case.
        const serverActive = data?.product?.active;
        if (typeof serverActive === 'boolean' && serverActive !== nextActive) {
          setItems((prev) =>
            prev.map((p) => (p._id === product._id ? { ...p, active: serverActive } : p))
          );
        }
        window.dispatchEvent(new Event('builder:products-changed')); // refresh builder preview
      } catch (err) {
        setItems((prev) =>
          prev.map((p) => (p._id === product._id ? { ...p, active: !nextActive } : p))
        );
        toast({
          title: 'Update failed',
          description:
            err instanceof Error && err.message !== 'Could not update visibility.'
              ? err.message
              : 'Network error. Please try again.',
          variant: 'error',
        });
      } finally {
        setTogglingIds((prev) => {
          const next = new Set(prev);
          next.delete(product._id);
          return next;
        });
      }
    },
    [toast, togglingIds]
  );

  /* ── Delete: confirmed modal → DELETE → remove locally ── */
  const handleDelete = useCallback(async () => {
    if (!deleteTarget || deleting) return;
    const target = deleteTarget;
    setDeleting(true);

    try {
      const res = await fetch(`/api/products/${target._id}`, { method: 'DELETE' });
      const data = (await res.json().catch(() => null)) as ApiErrorBody | null;
      if (!res.ok) throw new Error(data?.error || 'Could not delete this product.');

      const remaining = items.filter((p) => p._id !== target._id);
      setItems(remaining);
      setMeta((prev) => (prev ? { ...prev, total: Math.max(0, prev.total - 1) } : prev));
      setDeleteTarget(null);
      window.dispatchEvent(new CustomEvent('builder:products-changed', { detail: remaining }));
      toast({ title: 'Product deleted', variant: 'success' });
    } catch (err) {
      toast({
        title: 'Delete failed',
        description: err instanceof Error ? err.message : 'Network error. Please try again.',
        variant: 'error',
      });
    } finally {
      setDeleting(false);
    }
  }, [deleteTarget, deleting, toast, items]);

  /* ── Save (create or edit) ── */
  const handleSave = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (saving) return;

      const errors: Record<string, string> = {};
      const title = form.title.trim();
      if (!title) errors.title = 'Title is required.';

      let priceMinor: number | undefined;
      const rawPrice = form.priceMajor.trim();
      if (rawPrice !== '') {
        const major = Number(rawPrice);
        if (!Number.isFinite(major) || major < 0) {
          errors.priceMinor = 'Enter a valid non-negative amount.';
        } else {
          priceMinor = Math.round(major * 100);
        }
      }

      if (Object.keys(errors).length > 0) {
        setFieldErrors(errors);
        return;
      }

      const body: Record<string, unknown> = { title };
      if (form.description.trim()) body.description = form.description.trim();
      if (priceMinor !== undefined) body.priceMinor = priceMinor;
      body.currency = form.currency;
      if (form.category.trim()) body.category = form.category.trim();
      // Always send imageUrl — including '' — so removing a stored image is
      // persisted (the PATCH handler deletes the detached object).
      body.imageUrl = form.imageUrl;
      const sortOrder = Number(form.sortOrder);
      body.sortOrder = Number.isFinite(sortOrder) ? Math.trunc(sortOrder) : items.length;

      setSaving(true);
      setFieldErrors({});
      try {
        const res = await fetch(
          editingId ? `/api/products/${editingId}` : `/api/cards/${cardId}/products`,
          {
            method: editingId ? 'PATCH' : 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          }
        );
        const data = (await res.json().catch(() => null)) as ProductMutationResponse | null;

        // QUOTA — plan limit reached: drop the user back to the list.
        if (res.status === 403) {
          setEditorOpen(false);
          toast({
            title: 'Product limit reached',
            description: data?.error || 'Upgrade your plan to add more products.',
            variant: 'error',
          });
          return;
        }

        if (!res.ok) {
          const serverFieldErrors = data?.fieldErrors;
          if (serverFieldErrors && Object.keys(serverFieldErrors).length > 0) {
            setFieldErrors(serverFieldErrors);
            return;
          }
          throw new Error(data?.error || 'Could not save this product.');
        }

        const product = data?.product;
        if (product && editingId) {
          setItems((prev) => prev.map((p) => (p._id === editingId ? product : p)));
        }
        setEditorOpen(false);
        setReloadKey((k) => k + 1); // refetch after mutation (count/order reconcile)
        window.dispatchEvent(new Event('builder:products-changed')); // refresh builder preview
        toast({
          title: editingId ? 'Product updated' : 'Product added',
          variant: 'success',
        });
      } catch (err) {
        toast({
          title: editingId ? 'Update failed' : 'Add failed',
          description: err instanceof Error ? err.message : 'Network error. Please try again.',
          variant: 'error',
        });
      } finally {
        setSaving(false);
      }
    },
    [editingId, form, items.length, saving, toast, cardId]
  );

  /** Controlled-input setter bound to a form field key. */
  function inputSetter<K extends keyof ProductFormState>(key: K) {
    return (event: ChangeEvent<HTMLInputElement>) =>
      setForm((prev) => ({ ...prev, [key]: event.target.value }));
  }

  function textareaSetter<K extends keyof ProductFormState>(key: K) {
    return (event: ChangeEvent<HTMLTextAreaElement>) =>
      setForm((prev) => ({ ...prev, [key]: event.target.value }));
  }

  const totalCount = meta?.total ?? items.length;

  /* ── Render ── */
  return (
    <div>
      {/* Header row: count + primary action */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-baseline gap-2">
          <h3 className="text-sm font-medium text-ink-mute">Products</h3>
          <span className="text-xs tabular-nums text-ink-faint">{totalCount}</span>
        </div>
        <Button size="sm" onClick={openCreate}>
          <Plus className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
          Add product
        </Button>
      </div>

      {/* Loading skeletons */}
      {loading && (
        <div className="mt-4 space-y-2" role="status" aria-label="Loading products">
          {Array.from({ length: 3 }).map((_, i) => (
            <div
              key={i}
              className="flex animate-pulse items-center gap-3 rounded-lg bg-surface p-3 ring-1 ring-line-subtle"
            >
              <div className="h-10 w-10 shrink-0 rounded-md bg-field" />
              <div className="min-w-0 flex-1 space-y-1.5">
                <div className="h-3.5 w-40 max-w-full rounded bg-field" />
                <div className="h-3 w-20 rounded bg-field" />
              </div>
              <div className="h-5 w-9 shrink-0 rounded-full bg-field" />
            </div>
          ))}
        </div>
      )}

      {/* Fetch error */}
      {!loading && error && (
        <div className="mt-4 flex items-center justify-between gap-4 rounded-lg bg-bad/10 p-3">
          <p className="text-sm text-bad">{error}</p>
          <Button variant="ghost" size="sm" onClick={() => setReloadKey((k) => k + 1)}>
            Retry
          </Button>
        </div>
      )}

      {/* Empty state */}
      {!loading && !error && items.length === 0 && (
        <EmptyState
          icon={Package}
          title="No products yet"
          description="Add services or goods visitors can enquire about."
          action={{ label: '+ Add product', onClick: openCreate }}
        />
      )}

      {/* Rows */}
      {!loading && !error && items.length > 0 && (
        <ul className="mt-4 space-y-2">
          {items.map((product) => {
            const busy = togglingIds.has(product._id);
            return (
              <li
                key={product._id}
                className="flex items-center gap-3 rounded-lg bg-surface p-3 ring-1 ring-line-subtle"
              >
                {/* Thumbnail */}
                <span className="grid h-10 w-10 shrink-0 place-items-center overflow-hidden rounded-md bg-field">
                  {product.imageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element -- mirrors public portal img usage
                    <img
                      src={product.imageUrl}
                      alt=""
                      className="h-full w-full object-cover"
                      loading="lazy"
                    />
                  ) : (
                    <Package className="h-4 w-4 text-ink-faint" aria-hidden="true" />
                  )}
                </span>

                {/* Title + price (+ enquiry badge) */}
                <div className="min-w-0 flex-1">
                  <div className="flex min-w-0 items-center gap-2">
                    <p className="truncate text-sm font-medium text-ink">{product.title}</p>
                    {product.enquiryCount > 0 && (
                      <Badge
                        variant="default"
                        className="shrink-0 bg-accent-600/15 px-2 py-0 text-[11px] font-medium text-accent-400 ring-line-subtle"
                      >
                        {product.enquiryCount}{' '}
                        {product.enquiryCount === 1 ? 'enquiry' : 'enquiries'}
                      </Badge>
                    )}
                  </div>
                  <p className="truncate text-xs text-ink-mute">
                    {formatPrice(product.priceMinor, product.currency)}
                  </p>
                </div>

                {/* Controls: visible switch + edit + delete */}
                <div className="flex shrink-0 items-center gap-2">
                  <Switch
                    checked={product.active}
                    onChange={(checked) => void handleToggleActive(product, checked)}
                    disabled={busy}
                    size="sm"
                    aria-label={`${product.active ? 'Hide' : 'Show'} ${product.title}`}
                  />
                  <button
                    type="button"
                    onClick={() => openEdit(product)}
                    aria-label={`Edit ${product.title}`}
                    className={ICON_BUTTON}
                  >
                    <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setDeleteTarget(product)}
                    aria-label={`Delete ${product.title}`}
                    className={cn(ICON_BUTTON, RED_GHOST)}
                  >
                    <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {/* Create / edit modal */}
      <Modal
        isOpen={editorOpen}
        onClose={closeEditor}
        title={editingId ? 'Edit product' : 'Add product'}
      >
        <form onSubmit={(e) => void handleSave(e)} noValidate className="space-y-4">
          {/* Title */}
          <div>
            <label htmlFor="product-title" className="mb-1.5 block text-sm font-medium text-gray-700">
              Title <span className="text-red-500">*</span>
            </label>
            <Input
              id="product-title"
              required
              autoFocus
              maxLength={120}
              placeholder="e.g. Website audit"
              value={form.title}
              onChange={inputSetter('title')}
              aria-invalid={Boolean(fieldErrors.title)}
            />
            {fieldErrors.title && (
              <p className="mt-1.5 text-xs text-red-500">{fieldErrors.title}</p>
            )}
          </div>

          {/* Description + counter */}
          <div>
            <div className="mb-1.5 flex items-baseline justify-between">
              <label htmlFor="product-description" className="block text-sm font-medium text-gray-700">
                Description
              </label>
              <span className="text-[11px] tabular-nums text-gray-400">
                {form.description.length}/500
              </span>
            </div>
            <textarea
              id="product-description"
              rows={3}
              maxLength={500}
              placeholder="What does the buyer get?"
              value={form.description}
              onChange={textareaSetter('description')}
              className="w-full resize-none rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-900 placeholder-gray-400 transition-all duration-200 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 hover:border-gray-400"
            />
            {fieldErrors.description && (
              <p className="mt-1.5 text-xs text-red-500">{fieldErrors.description}</p>
            )}
          </div>

          {/* Price + currency row */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="product-price" className="mb-1.5 block text-sm font-medium text-gray-700">
                Price
              </label>
              <Input
                id="product-price"
                type="number"
                step="0.01"
                min="0"
                inputMode="decimal"
                placeholder="0.00"
                value={form.priceMajor}
                onChange={inputSetter('priceMajor')}
                aria-invalid={Boolean(fieldErrors.priceMinor)}
              />
              {(fieldErrors.priceMinor || fieldErrors.price) && (
                <p className="mt-1.5 text-xs text-red-500">
                  {fieldErrors.priceMinor ?? fieldErrors.price}
                </p>
              )}
            </div>
            <div>
              <label htmlFor="product-currency" className="mb-1.5 block text-sm font-medium text-gray-700">
                Currency
              </label>
              <Select
                id="product-currency"
                options={CURRENCY_OPTIONS}
                value={form.currency}
                onChange={(value) => setForm((prev) => ({ ...prev, currency: value }))}
              />
              {fieldErrors.currency && (
                <p className="mt-1.5 text-xs text-red-500">{fieldErrors.currency}</p>
              )}
            </div>
          </div>

          {/* Category + sort order row */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="product-category" className="mb-1.5 block text-sm font-medium text-gray-700">
                Category
              </label>
              <Input
                id="product-category"
                maxLength={50}
                placeholder="Optional"
                value={form.category}
                onChange={inputSetter('category')}
              />
              {fieldErrors.category && (
                <p className="mt-1.5 text-xs text-red-500">{fieldErrors.category}</p>
              )}
            </div>
            <div>
              <label htmlFor="product-sort-order" className="mb-1.5 block text-sm font-medium text-gray-700">
                Sort order
              </label>
              <Input
                id="product-sort-order"
                type="number"
                step="1"
                value={form.sortOrder}
                onChange={inputSetter('sortOrder')}
              />
              {fieldErrors.sortOrder && (
                <p className="mt-1.5 text-xs text-red-500">{fieldErrors.sortOrder}</p>
              )}
            </div>
          </div>

          {/* Image upload */}
          <div>
            <p className="mb-1.5 block text-sm font-medium text-gray-700">Image</p>
            <UploadButton
              category="product"
              cardId={cardId}
              label={form.imageUrl ? 'Replace image' : 'Upload image'}
              className="block w-fit"
              onUploaded={(result) =>
                setForm((prev) => ({ ...prev, imageUrl: result.url }))
              }
              preview={
                <div className="relative mb-2 grid h-24 w-full place-items-center overflow-hidden rounded-lg border border-dashed border-gray-300 bg-gray-50">
                  {form.imageUrl ? (
                    <>
                      {/* eslint-disable-next-line @next/next/no-img-element -- mirrors public portal img usage */}
                      <img
                        src={form.imageUrl}
                        alt="Product image preview"
                        className="h-full w-full object-cover"
                      />
                      <RemoveUploadButton
                        label="Remove product image"
                        className="absolute right-1.5 top-1.5"
                        onRemove={() => setForm((prev) => ({ ...prev, imageUrl: '' }))}
                      />
                    </>
                  ) : (
                    <span className="px-3 text-xs text-gray-400">
                      No image yet — optional JPG, PNG or WebP
                    </span>
                  )}
                </div>
              }
            />
          </div>

          {/* Actions */}
          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="ghost" onClick={closeEditor} disabled={saving}>
              Cancel
            </Button>
            <Button type="submit" isLoading={saving}>
              {editingId ? 'Save changes' : 'Add product'}
            </Button>
          </div>
        </form>
      </Modal>

      {/* Delete confirmation */}
      <Modal isOpen={deleteTarget !== null} onClose={() => !deleting && setDeleteTarget(null)} title="Delete product">
        <p className="text-sm text-ink-mute">
          Delete this product?{deleteTarget?.title ? (
            <> “<span className="font-medium text-ink">{deleteTarget.title}</span>” will be removed permanently.</>
          ) : null}
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <Button
            type="button"
            variant="ghost"
            onClick={() => setDeleteTarget(null)}
            disabled={deleting}
          >
            Cancel
          </Button>
          <Button variant="danger" isLoading={deleting} onClick={() => void handleDelete()}>
            Delete
          </Button>
        </div>
      </Modal>
    </div>
  );
}
