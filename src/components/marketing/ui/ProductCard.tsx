'use client';

import React, { useState } from 'react';
import Image from 'next/image';
import { Heart, MessageCircle, Zap, Eye } from 'lucide-react';
import { Product } from '@/types/marketing';
import { openWhatsAppOrder } from '@/lib/marketing/whatsapp';

interface ProductCardProps {
  product: Product;
  onView: (product: Product) => void;
  onAddToCart?: (product: Product) => void;
}

export const ProductCard: React.FC<ProductCardProps> = ({ product, onView, onAddToCart }) => {
  const [isWishlisted, setIsWishlisted] = useState(false);
  const [isHovered, setIsHovered] = useState(false);

  const handleOrder = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (onAddToCart) {
      onAddToCart(product);
    }
    openWhatsAppOrder({
      productName: product.name,
      price: product.price,
      customMessage: `Hi Taprevia! 🚀 I'd like to order the *${product.name}* (priced at ₹${product.price}). Please confirm my order!`,
    });
  };

  return (
    <div
      onClick={() => onView(product)}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      className="group cursor-pointer relative bg-white rounded-3xl border border-gray-100 overflow-hidden shadow-sm hover:shadow-xl transition-all duration-300 flex flex-col justify-between"
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onView(product);
        }
      }}
      aria-label={`View ${product.name} details`}
    >
      {/* Image & Badges Container */}
      <div className="relative w-full aspect-[4/3] bg-gray-50 overflow-hidden flex items-center justify-center p-4">
        {/* Product Image */}
        <div className="relative w-full h-full transform group-hover:scale-105 transition-transform duration-500">
          <Image
            src={product.image}
            alt={product.name}
            fill
            className="object-contain"
            sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw"
          />
        </div>

        {/* Top Badges */}
        {product.badge && (
          <div className="absolute top-3 left-3 z-10 flex flex-col gap-1">
            <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full text-[11px] font-bold tracking-wider bg-brand-navy text-white shadow-sm uppercase">
              <Zap size={11} className="fill-amber-400 text-amber-400" />
              {product.badge}
            </span>
          </div>
        )}

        {/* Wishlist Heart Icon */}
        <button
          onClick={(e) => {
            e.stopPropagation();
            setIsWishlisted(!isWishlisted);
          }}
          aria-label={isWishlisted ? 'Remove from wishlist' : 'Add to wishlist'}
          className="absolute top-3 right-3 z-10 p-2.5 rounded-full bg-white/90 backdrop-blur-sm border border-gray-200/80 text-gray-600 hover:text-red-500 hover:bg-white transition-all shadow-sm cursor-pointer"
        >
          <Heart
            size={16}
            className={isWishlisted ? 'fill-red-500 text-red-500' : 'text-gray-600'}
          />
        </button>

        {/* Quick View Overlay Button */}
        <div
          className={`absolute inset-x-4 bottom-4 z-10 transition-all duration-300 ${
            isHovered ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-2 pointer-events-none'
          }`}
        >
          <button
            onClick={(e) => {
              e.stopPropagation();
              onView(product);
            }}
            className="w-full py-3 px-4 bg-white/95 backdrop-blur-sm text-brand-navy text-xs font-bold uppercase tracking-wider rounded-xl shadow-lg flex items-center justify-center gap-2 transition-colors border border-gray-200/80 cursor-pointer"
          >
            <Eye size={15} />
            Quick View
          </button>
        </div>
      </div>

      {/* Product Information */}
      <div className="p-5 flex flex-col flex-grow justify-between">
        <div>
          <h3 className="text-lg font-bold text-brand-navy group-hover:text-emerald-600 transition-colors">
            {product.name}
          </h3>
          <div className="flex items-center gap-1.5 mt-1.5 text-[11px] font-semibold text-brand-accent bg-blue-50 border border-blue-100 px-2.5 py-1 rounded-full w-fit">
            {product.category}
          </div>

          {/* Highlight chips */}
          {product.highlights && product.highlights.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-2.5">
              {product.highlights.slice(0, 2).map((h) => (
                <span
                  key={h}
                  className="text-[10px] font-semibold text-gray-500 bg-gray-50 border border-gray-100 px-2 py-0.5 rounded-full"
                >
                  {h}
                </span>
              ))}
              {product.features.length > 2 && (
                <span className="text-[10px] font-bold text-brand-accent px-1">
                  +{product.features.length - 2} features
                </span>
              )}
            </div>
          )}
        </div>

        <div className="mt-4 pt-3 border-t border-gray-100 flex items-end justify-between">
          <div>
            <div className="flex items-baseline gap-1.5">
              <span className="text-2xl font-extrabold text-brand-navy">₹{product.price}</span>
              {product.originalPrice && (
                <span className="text-xs text-gray-400 line-through">₹{product.originalPrice}</span>
              )}
            </div>
            <p className="text-[11px] text-gray-400 font-medium mt-0.5">Order via WhatsApp</p>
          </div>

          <button
            onClick={handleOrder}
            aria-label={`Order ${product.name}`}
            title="Order This Product"
            className="hidden md:flex p-3 rounded-full bg-blue-50 text-brand-accent hover:bg-brand-accent hover:text-white transition-all duration-200 cursor-pointer border border-blue-200 items-center justify-center"
          >
            <MessageCircle size={18} />
          </button>
        </div>

        {/* Mobile-only primary action button */}
        <div className="mt-4 md:hidden">
          <button
            onClick={handleOrder}
            className="w-full py-3 px-4 bg-brand-accent hover:bg-blue-700 text-white text-xs font-bold uppercase tracking-wider rounded-xl shadow-lg flex items-center justify-center gap-2 transition-colors cursor-pointer border-none"
          >
            <MessageCircle size={15} />
            Order on WhatsApp
          </button>
        </div>
      </div>
    </div>
  );
};