'use client';

import React, { useState, useMemo, useEffect } from 'react';
import { Search } from 'lucide-react';
import { PRODUCTS, CATEGORIES } from '@/lib/marketing/products';
import { ProductCard } from '@/components/marketing/ui/ProductCard';
import { ProductModal } from '@/components/marketing/ui/ProductModal';
import { Product } from '@/types/marketing';

export const BestSellers: React.FC = () => {
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [viewedProduct, setViewedProduct] = useState<Product | null>(null);

  const isComboProduct = (p: Product) =>
    p.id.startsWith('combo-') || /combo/i.test(p.name);

  const filteredProducts = useMemo(() => {
    const query = searchQuery.toLowerCase().trim();
    return PRODUCTS.filter((p) => {
      const matchesCategory =
        selectedCategory === 'all' ||
        (selectedCategory === 'Combo'
          ? isComboProduct(p)
          : p.category === selectedCategory);
      const matchesSearch =
        !query ||
        p.name.toLowerCase().includes(query) ||
        (p.tagline && p.tagline.toLowerCase().includes(query)) ||
        (p.description && p.description.toLowerCase().includes(query)) ||
        p.features.some((f) => f.toLowerCase().includes(query)) ||
        (p.highlights && p.highlights.some((h) => h.toLowerCase().includes(query)));
      return matchesCategory && matchesSearch;
    });
  }, [selectedCategory, searchQuery]);

  const handleAddToCart = (product: Product) => {
    setToastMessage(`Redirecting to WhatsApp for ${product.name}...`);
    setTimeout(() => {
      setToastMessage(null);
    }, 3500);
  };

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ category: string }>).detail;
      if (detail?.category) setSelectedCategory(detail.category);
    };
    window.addEventListener('taprevia:select-category', handler);
    return () => window.removeEventListener('taprevia:select-category', handler);
  }, []);

  return (
    <section id="products" className="py-20 bg-brand-bgLight">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        
        {/* Toast Notification */}
        {toastMessage && (
          <div className="fixed top-20 right-6 z-50 bg-emerald-700 text-white px-5 py-3 rounded-2xl shadow-xl border border-emerald-500 text-sm font-semibold animate-in fade-in slide-in-from-top-4 duration-200 flex items-center gap-2">
            💬 {toastMessage}
          </div>
        )}

        {/* Section Header */}
        <div className="max-w-3xl mb-10">
          <p className="text-xs font-bold text-brand-navy uppercase tracking-widest mb-2">
            BEST SELLERS
          </p>
          <h2 className="text-3xl sm:text-4xl lg:text-5xl font-black text-brand-navy tracking-tight">
            Built for business growth
          </h2>
          <p className="text-base text-gray-500 mt-2 font-normal">
            Every card ships with NFC + QR, a dynamic profile, and lifetime digital validity.
          </p>
        </div>

        {/* Controls Bar: Search Input & Category Filter Pills */}
        <div className="bg-white rounded-3xl p-4 sm:p-5 shadow-xs mb-10 flex flex-col md:flex-row items-center justify-between gap-4">
          
          {/* Search Input */}
          <div className="relative w-full md:w-80">
            <Search size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              placeholder="Search products..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-gray-50 border border-gray-200 rounded-full pl-11 pr-4 py-2.5 text-xs text-brand-navy placeholder-gray-400 focus:outline-none focus:border-brand-navy focus:bg-white transition-all"
            />
          </div>

          {/* Category Filter Pills */}
          <div className="flex items-center gap-2 w-full md:w-auto overflow-x-auto no-scrollbar scroll-smooth pb-1 md:pb-0 -mx-4 px-4 md:mx-0 md:px-0">
            {CATEGORIES.map((cat) => {
              const isActive = selectedCategory === cat.id;
              return (
                <button
                  key={cat.id}
                  onClick={() => setSelectedCategory(cat.id)}
                  className={`px-5 py-2 rounded-full text-xs font-bold transition-all cursor-pointer shrink-0 ${
                    isActive
                      ? 'bg-brand-navy text-white shadow-sm'
                      : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                  }`}
                >
                  {cat.label}
                </button>
              );
            })}
          </div>

        </div>

        {/* Product Cards Grid */}
        {filteredProducts.length > 0 ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-8">
            {filteredProducts.map((product) => (
              <ProductCard
                key={product.id}
                product={product}
                onView={setViewedProduct}
                onAddToCart={handleAddToCart}
              />
            ))}
          </div>
        ) : (
          <div className="text-center py-16 bg-white rounded-3xl">
            <p className="text-lg font-bold text-brand-navy">No products match your search.</p>
            <p className="text-sm text-gray-400 mt-1">Try clearing filters or search terms.</p>
            <button
              onClick={() => { setSelectedCategory('all'); setSearchQuery(''); }}
              className="mt-4 px-6 py-2.5 bg-brand-navy text-white text-xs font-bold rounded-full"
            >
              Reset Filters
            </button>
          </div>
        )}

      </div>

      {/* Product Detail Modal */}
      {viewedProduct && (
        <ProductModal product={viewedProduct} onClose={() => setViewedProduct(null)} />
      )}
    </section>
  );
};
