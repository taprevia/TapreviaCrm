'use client';

import { useEffect, useMemo, useState } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Modal } from '@/components/ui/modal';
import { Search, Package, Eye, Sparkles, Lock } from 'lucide-react';
import { PRODUCT_CATALOG, ALL_PRODUCT_IDS, type ProductId, type ProductDefinition } from '@/config/products';
import { CAPABILITY_DEFS, type CapabilityId } from '@/config/capabilities';

interface CatalogProduct {
  _id: string;
  name: string;
  slug: string;
  description: string;
  category: 'card' | 'standee' | 'other';
  kind?: string;
  features?: Record<string, { enabled?: boolean; max?: number }>;
  priceMinor: number;
  currency: string;
  imageUrl: string;
  active: boolean;
  sortOrder: number;
  createdAt: string;
}

const CATEGORY_BADGE: Record<string, { label: string; className: string }> = {
  card: { label: 'NFC Card', className: 'bg-accent-600/15 text-accent-400 ring-accent-500/25' },
  nfc_card: { label: 'NFC Card', className: 'bg-accent-600/15 text-accent-400 ring-accent-500/25' },
  standee: { label: 'Standee', className: 'bg-warn/15 text-warn ring-line-subtle' },
  plate: { label: 'NFC Plate', className: 'bg-ok/15 text-ok ring-ok/25' },
  other: { label: 'Other', className: 'bg-field text-ink-faint ring-line-subtle' },
};

export default function AdminProductsPage() {
  const [dbProducts, setDbProducts] = useState<CatalogProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [showDetailsModal, setShowDetailsModal] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState<ProductDefinition | null>(null);
  const [pageError, setPageError] = useState('');

  useEffect(() => {
    fetchProducts();
  }, []);

  const fetchProducts = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/catalog');
      if (res.ok) {
        const data = await res.json();
        setDbProducts(data.catalog);
        setPageError('');
      } else {
        setPageError('Failed to load catalog');
      }
    } catch (error) {
      console.error('Failed to fetch catalog:', error);
      setPageError('Failed to load catalog');
    } finally {
      setLoading(false);
    }
  };

  // Merge hard-coded products with database records
  const allProducts = useMemo(() => {
    const products: Array<{
      id: string;
      name: string;
      description: string;
      category: string;
      capabilities: CapabilityId[];
      dbRecord?: CatalogProduct;
      isHardcoded: boolean;
    }> = [];

    // Add hard-coded products
    for (const productId of ALL_PRODUCT_IDS) {
      const def = PRODUCT_CATALOG[productId];
      const dbRecord = dbProducts.find(
        (p) => p.slug.toLowerCase() === productId.toLowerCase().replace(/_/g, '-') ||
               p.slug.toLowerCase() === productId.toLowerCase()
      );
      products.push({
        id: productId,
        name: def.name,
        description: def.description,
        category: def.category,
        capabilities: def.capabilities,
        dbRecord,
        isHardcoded: true,
      });
    }

    return products;
  }, [dbProducts]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return allProducts;
    return allProducts.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        p.id.toLowerCase().includes(q) ||
        p.category.toLowerCase().includes(q)
    );
  }, [allProducts, search]);

  const openDetails = (product: typeof allProducts[0]) => {
    setSelectedProduct(PRODUCT_CATALOG[product.id as ProductId]);
    setShowDetailsModal(true);
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-ink tracking-tight">Platform Products</h1>
          <p className="text-ink-mute text-sm mt-0.5">
            Predefined product catalog — products are managed in code, not here
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="default" className="bg-warn/15 text-warn ring-line-subtle gap-1">
            <Lock className="h-3 w-3" />
            Read-only
          </Badge>
        </div>
      </div>

      {pageError && (
        <div className="rounded-lg bg-red-50 p-3 text-sm text-red-600 ring-1 ring-red-200">{pageError}</div>
      )}

      <Card className="p-4 bg-surface border-transparent ring-1 ring-line-subtle">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-faint" />
          <Input
            placeholder="Search products by name or category..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-10 bg-field border-line text-ink placeholder:text-ink-faint hover:border-line-strong focus:border-accent-500 focus:ring-accent-500/25"
          />
        </div>
      </Card>

      <Card className="bg-surface border-transparent ring-1 ring-line-subtle">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-line-subtle">
                <th className="px-5 py-3.5 text-left text-xs font-semibold text-ink-faint uppercase tracking-wider">Product</th>
                <th className="px-5 py-3.5 text-left text-xs font-semibold text-ink-faint uppercase tracking-wider">Category</th>
                <th className="px-5 py-3.5 text-left text-xs font-semibold text-ink-faint uppercase tracking-wider">Capabilities</th>
                <th className="px-5 py-3.5 text-left text-xs font-semibold text-ink-faint uppercase tracking-wider">Status</th>
                <th className="px-5 py-3.5 text-left text-xs font-semibold text-ink-faint uppercase tracking-wider">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line-subtle">
              {loading ? (
                Array.from({ length: 4 }).map((_, i) => (
                  <tr key={i}>
                    <td colSpan={5} className="px-5 py-4">
                      <div className="flex items-center gap-3">
                        <div className="skeleton h-10 w-10 rounded-lg" />
                        <div className="space-y-2">
                          <div className="skeleton h-3 w-24" />
                          <div className="skeleton h-3 w-32" />
                        </div>
                      </div>
                    </td>
                  </tr>
                ))
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-5 py-16 text-center">
                    <div className="flex flex-col items-center">
                      <div className="rounded-full bg-field p-4 mb-4">
                        <Package className="h-8 w-8 text-ink-faint" />
                      </div>
                      <p className="text-sm font-medium text-ink">
                        {search ? 'No matching products' : 'No products found'}
                      </p>
                    </div>
                  </td>
                </tr>
              ) : (
                filtered.map((product) => {
                  const badge = CATEGORY_BADGE[product.category] ?? CATEGORY_BADGE.other;
                  const capCount = product.capabilities.length;
                  return (
                    <tr key={product.id} className="hover:bg-white/5 transition-colors">
                      <td className="px-5 py-3.5">
                        <div className="flex items-center gap-3">
                          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent-600/15 ring-1 ring-accent-500/25">
                            <Package className="h-4 w-4 text-accent-400" />
                          </div>
                          <div>
                            <p className="font-medium text-ink">{product.name}</p>
                            <p className="font-mono text-xs text-ink-faint">{product.id}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-5 py-3.5">
                        <Badge variant="default" className={badge.className}>{badge.label}</Badge>
                      </td>
                      <td className="px-5 py-3.5">
                        <Badge variant="default" className="bg-accent-600/10 text-accent-300 ring-accent-500/20 gap-1">
                          <Sparkles className="h-3 w-3" />
                          {capCount} capabilities
                        </Badge>
                      </td>
                      <td className="px-5 py-3.5">
                        <Badge
                          variant={product.dbRecord?.active !== false ? 'success' : 'danger'}
                          className={product.dbRecord?.active !== false
                            ? 'bg-ok/15 text-ok ring-line-subtle'
                            : 'bg-bad/15 text-bad ring-line-subtle'}
                        >
                          {product.dbRecord?.active !== false ? 'Active' : 'Inactive'}
                        </Badge>
                      </td>
                      <td className="px-5 py-3.5">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => openDetails(product)}
                          title="View Details"
                          className="border-line-strong bg-transparent hover:bg-white/5 hover:border-line-strong focus:ring-accent-500"
                        >
                          <Eye className="h-3.5 w-3.5 text-accent-400" />
                        </Button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Product Details Modal */}
      <Modal
        isOpen={showDetailsModal}
        onClose={() => setShowDetailsModal(false)}
        title={selectedProduct?.name ?? 'Product Details'}
        className="bg-bg-raised text-ink ring-1 ring-line-subtle shadow-pop [&>div]:border-line-subtle [&_h2]:text-ink [&_button]:text-ink-faint hover:[&_button]:text-ink hover:[&_button]:bg-white/5"
      >
        {selectedProduct && (
          <div className="space-y-4">
            <div>
              <p className="text-sm text-ink-mute">{selectedProduct.description}</p>
            </div>

            <div>
              <h3 className="text-sm font-medium text-ink mb-2">Category</h3>
              <Badge variant="default" className={CATEGORY_BADGE[selectedProduct.category]?.className ?? CATEGORY_BADGE.other}>
                {CATEGORY_BADGE[selectedProduct.category]?.label ?? selectedProduct.category}
              </Badge>
            </div>

            <div>
              <h3 className="text-sm font-medium text-ink mb-2">Capabilities ({selectedProduct.capabilities.length})</h3>
              <div className="flex flex-wrap gap-1.5">
                {selectedProduct.capabilities.map((cap) => (
                  <Badge
                    key={cap}
                    variant="default"
                    className="bg-accent-600/10 text-accent-300 ring-accent-500/20"
                  >
                    {CAPABILITY_DEFS[cap]?.label ?? cap}
                  </Badge>
                ))}
              </div>
            </div>

            {selectedProduct.metadata.maxProfiles && (
              <div>
                <h3 className="text-sm font-medium text-ink mb-2">Profile Configuration</h3>
                <div className="rounded-lg bg-field p-3 text-sm">
                  <p>Max Profiles: {selectedProduct.metadata.maxProfiles}</p>
                  <p>NFC Slots: {selectedProduct.metadata.nfcSlots}</p>
                  <p>QR Slots: {selectedProduct.metadata.qrSlots}</p>
                  {selectedProduct.metadata.fixedProfiles && (
                    <p>Fixed Profiles: {selectedProduct.metadata.fixedProfiles.join(', ')}</p>
                  )}
                </div>
              </div>
            )}

            {selectedProduct.metadata.materials && (
              <div>
                <h3 className="text-sm font-medium text-ink mb-2">Available Materials</h3>
                <div className="flex gap-2">
                  {selectedProduct.metadata.materials.map((mat) => (
                    <Badge key={mat} variant="default" className="bg-field text-ink-mute ring-line-subtle">
                      {mat.toUpperCase()}
                    </Badge>
                  ))}
                </div>
              </div>
            )}

            <div className="flex justify-end pt-2">
              <Button variant="outline" onClick={() => setShowDetailsModal(false)}>Close</Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
