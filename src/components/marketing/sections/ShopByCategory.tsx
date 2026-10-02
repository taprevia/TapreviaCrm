'use client';

import React from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { ProductCategory } from '@/types/marketing';
import { PRODUCTS } from '@/lib/marketing/products';

const categoryImages: Record<ProductCategory, string> = {
  'NFC Card': PRODUCTS.find((p) => p.id === 'business-nfc-card')!.image,
  'Standee NFC': PRODUCTS.find((p) => p.id === 'google-review-standee')!.image,
  'Plate NFC': PRODUCTS.find((p) => p.id === 'google-review-nfc-plate')!.image,
  'Combo': PRODUCTS.find((p) => p.id === 'combo-1-card-standee')!.image,
};

const categories: { title: string; image: string; category: ProductCategory }[] = [
  {
    title: 'NFC Cards',
    image: categoryImages['NFC Card'],
    category: 'NFC Card',
  },
  {
    title: 'Standees',
    image: categoryImages['Standee NFC'],
    category: 'Standee NFC',
  },
  {
    title: 'Review Plates',
    image: categoryImages['Plate NFC'],
    category: 'Plate NFC',
  },
  {
    title: 'Combo',
    image: categoryImages['Combo'],
    category: 'Combo',
  },
];

export const ShopByCategory: React.FC = () => {
  const selectCategory = (category: ProductCategory) => {
    window.dispatchEvent(
      new CustomEvent('taprevia:select-category', { detail: { category } })
    );
  };

  return (
    <section className="py-20 bg-white">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        
        {/* Section Title */}
        <div className="max-w-2xl mb-12">
          <p className="text-xs font-bold text-brand-navy uppercase tracking-widest mb-2">
            COLLECTIONS
          </p>
          <h2 className="text-3xl sm:text-4xl lg:text-5xl font-black text-brand-navy tracking-tight">
            Shop by Category
          </h2>
          <p className="text-base text-gray-500 mt-2 font-normal">
            Curated for every kind of professional.
          </p>
        </div>

        {/* 3-Column Image Cards Grid */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-5 md:gap-8">
          {categories.map((item, idx) => (
            <Link
              key={idx}
              href="#products"
              onClick={() => selectCategory(item.category)}
              className="group relative h-72 md:h-96 rounded-3xl overflow-hidden shadow-brandCard block transition-transform duration-300 hover:-translate-y-1"
            >
              {/* Background Image */}
              <Image
                src={item.image}
                alt={item.title}
                fill
                className="object-cover group-hover:scale-105 transition-transform duration-500"
              />

              {/* Gradient Overlay */}
              <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/30 to-transparent flex flex-col justify-end p-6 sm:p-8">
                <h3 className="text-2xl font-black text-white mb-2">
                  {item.title}
                </h3>
                <span className="inline-flex items-center gap-2 text-sm font-semibold text-white/90 group-hover:text-white transition-colors">
                  Shop now <ArrowRight size={16} className="group-hover:translate-x-1 transition-transform" />
                </span>
              </div>
            </Link>
          ))}
        </div>

      </div>
    </section>
  );
};