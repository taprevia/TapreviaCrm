'use client';

import React, { useEffect, useRef, useState, useCallback } from 'react';
import Image from 'next/image';
import {
  X,
  ChevronLeft,
  ChevronRight,
  Check,
  MessageCircle,
  Truck,
  ShieldCheck,
  BadgeCheck,
  Minus,
  Plus,
} from 'lucide-react';
import { Product } from '@/types/marketing';
import { StarRating } from './StarRating';
import { openWhatsAppOrder } from '@/lib/marketing/whatsapp';

interface ProductModalProps {
  product: Product;
  onClose: () => void;
}

export const ProductModal: React.FC<ProductModalProps> = ({ product, onClose }) => {
  const [activeIndex, setActiveIndex] = useState(0);
  const [quantity, setQuantity] = useState(1);
  const overlayRef = useRef<HTMLDivElement>(null);

  const images = product.images.length > 0 ? product.images : [product.image];

  const goTo = useCallback(
    (index: number) => {
      setActiveIndex((index + images.length) % images.length);
    },
    [images.length]
  );

  const handleOrder = () => {
    openWhatsAppOrder({
      productName: product.name,
      price: product.price,
      customMessage: `Hi Taprevia! 🚀 I'd like to order the *${product.name}* (priced at ₹${product.price}) — Qty: *${quantity}*. Please confirm my order!`,
    });
  };

  const handleAskQuestion = () => {
    openWhatsAppOrder({
      productName: product.name,
      customMessage: `Hi Taprevia! 👋 I have a question about the *${product.name}* (₹${product.price}). Could you help me out?`,
    });
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowRight') goTo(activeIndex + 1);
      if (e.key === 'ArrowLeft') goTo(activeIndex - 1);
    };

    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [onClose, activeIndex, goTo]);

  const discount = product.originalPrice
    ? Math.round(((product.originalPrice - product.price) / product.originalPrice) * 100)
    : 0;

  return (
    <div
      ref={overlayRef}
      onClick={(e) => {
        if (e.target === overlayRef.current) onClose();
      }}
      className="fixed inset-0 z-[100] flex items-center justify-center p-3 sm:p-6 bg-brand-navy/70 backdrop-blur-sm animate-in fade-in duration-200"
      role="dialog"
      aria-modal="true"
      aria-label={`${product.name} details`}
    >
      <div className="relative w-full max-w-5xl max-h-[92vh] bg-white rounded-4xl shadow-2xl overflow-hidden flex flex-col animate-in zoom-in-95 duration-200">
        {/* Close Button */}
        <button
          onClick={onClose}
          aria-label="Close product details"
          className="absolute top-4 right-4 z-30 p-2 rounded-full bg-white/90 backdrop-blur-sm border border-gray-200 text-gray-600 hover:text-brand-navy hover:bg-white transition-all shadow-md cursor-pointer"
        >
          <X size={20} />
        </button>

        <div className="flex flex-col lg:flex-row overflow-y-auto">
          {/* ── Left: Image Carousel ── */}
          <div className="w-full lg:w-[45%] shrink-0 bg-gray-50 border-b lg:border-b-0 lg:border-r border-gray-100 p-4 sm:p-6 flex flex-col gap-4">
            {/* Main image */}
            <div className="relative w-full aspect-square rounded-3xl bg-white overflow-hidden">
              <Image
                src={images[activeIndex]}
                alt={`${product.name} — image ${activeIndex + 1}`}
                fill
                priority
                className="object-contain p-4"
                sizes="(max-width: 1024px) 100vw, 45vw"
              />

              {/* Counter badge */}
              <span className="absolute bottom-3 left-1/2 -translate-x-1/2 text-[11px] font-bold text-gray-500 bg-white/90 border border-gray-200 rounded-full px-3 py-1">
                {activeIndex + 1} / {images.length}
              </span>

              {/* Prev / Next arrows */}
              {images.length > 1 && (
                <>
                  <button
                    onClick={() => goTo(activeIndex - 1)}
                    aria-label="Previous image"
                    className="absolute left-3 top-1/2 -translate-y-1/2 p-2 rounded-full bg-white/90 hover:bg-white border border-gray-200 text-brand-navy shadow-md transition-all cursor-pointer"
                  >
                    <ChevronLeft size={20} />
                  </button>
                  <button
                    onClick={() => goTo(activeIndex + 1)}
                    aria-label="Next image"
                    className="absolute right-3 top-1/2 -translate-y-1/2 p-2 rounded-full bg-white/90 hover:bg-white border border-gray-200 text-brand-navy shadow-md transition-all cursor-pointer"
                  >
                    <ChevronRight size={20} />
                  </button>
                </>
              )}
            </div>

            {/* Thumbnail strip */}
            {images.length > 1 && (
              <div className="flex items-center gap-2 overflow-x-auto no-scrollbar justify-center">
                {images.map((src, idx) => (
                  <button
                    key={src + idx}
                    onClick={() => setActiveIndex(idx)}
                    aria-label={`View image ${idx + 1}`}
                    className={`relative w-16 h-16 sm:w-20 sm:h-20 shrink-0 rounded-xl overflow-hidden border-2 transition-all cursor-pointer ${
                      idx === activeIndex
                        ? 'border-brand-accent ring-2 ring-brand-accent/30'
                        : 'border-gray-200 hover:border-gray-400'
                    }`}
                  >
                    <Image
                      src={src}
                      alt=""
                      fill
                      className="object-contain p-1.5"
                      sizes="80px"
                    />
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* ── Right: Product Details ── */}
          <div className="w-full lg:w-[55%] p-5 sm:p-8 flex flex-col gap-5">
            {/* Category + badge */}
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[11px] font-bold text-brand-accent bg-blue-50 border border-blue-100 px-3 py-1 rounded-full uppercase tracking-wider">
                {product.category}
              </span>
              {product.badge && (
                <span className="text-[11px] font-bold text-white bg-brand-navy px-3 py-1 rounded-full uppercase tracking-wider">
                  {product.badge}
                </span>
              )}
            </div>

            {/* Name */}
            <div>
              <h2 className="text-2xl sm:text-3xl font-black text-brand-navy tracking-tight leading-tight">
                {product.name}
              </h2>
              <div className="mt-2 flex items-center gap-3">
                <StarRating rating={product.rating} count={product.reviewsCount} size={15} />
                <span className="text-[11px] font-semibold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full">
                  {discount > 0 ? `${discount}% off` : 'Best Price'}
                </span>
              </div>
            </div>

            {/* Price */}
            <div className="bg-gray-50 rounded-2xl p-4">
              <div className="flex items-end gap-2.5 flex-wrap">
                <span className="text-4xl sm:text-5xl font-black text-brand-navy tracking-tight">
                  ₹{product.price}
                </span>
                {product.originalPrice && (
                  <>
                    <span className="text-base text-gray-400 line-through font-semibold mb-1.5">
                      ₹{product.originalPrice}
                    </span>
                    <span className="text-xs font-bold text-emerald-600 mb-1.5">
                      Save ₹{product.originalPrice - product.price}
                    </span>
                  </>
                )}
              </div>
              <p className="text-[11px] text-gray-400 mt-1">
                Inclusive of all taxes · Lifetime validity · No subscription
              </p>
            </div>

            {/* Tagline */}
            {product.tagline && (
              <p className="text-sm sm:text-base text-gray-600 leading-relaxed font-medium">
                {product.tagline}
              </p>
            )}

            {/* Highlights chips */}
            {product.highlights && product.highlights.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {product.highlights.map((h) => (
                  <span
                    key={h}
                    className="inline-flex items-center gap-1.5 text-[11px] font-bold text-brand-navy bg-brand-navy/5 border border-brand-navy/10 px-3 py-1.5 rounded-full"
                  >
                    <BadgeCheck size={13} className="text-brand-accent shrink-0" />
                    {h}
                  </span>
                ))}
              </div>
            )}

            {/* Quantity */}
            <div className="flex items-center gap-3">
              <span className="text-sm font-bold text-brand-navy">Quantity</span>
              <div className="flex items-center gap-1 border border-gray-200 rounded-full px-1 py-1 bg-white">
                <button
                  onClick={() => setQuantity((q) => Math.max(1, q - 1))}
                  disabled={quantity <= 1}
                  aria-label="Decrease quantity"
                  className="p-2 rounded-full hover:bg-gray-100 text-brand-navy disabled:opacity-30 transition-colors cursor-pointer"
                >
                  <Minus size={16} />
                </button>
                <span className="w-9 text-center text-sm font-extrabold text-brand-navy tabular-nums">
                  {quantity}
                </span>
                <button
                  onClick={() => setQuantity((q) => Math.min(50, q + 1))}
                  disabled={quantity >= 50}
                  aria-label="Increase quantity"
                  className="p-2 rounded-full hover:bg-gray-100 text-brand-navy disabled:opacity-30 transition-colors cursor-pointer"
                >
                  <Plus size={16} />
                </button>
              </div>
            </div>

            {/* Feature list */}
            <div>
              <p className="text-xs font-black text-brand-navy uppercase tracking-widest mb-2">
                What&apos;s included
              </p>
              <ul className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-2 max-h-40 overflow-y-auto pr-1">
                {product.features.map((f) => (
                  <li key={f} className="flex items-start gap-2 text-[13px] text-gray-600 leading-snug">
                    <Check size={15} className="text-emerald-500 shrink-0 mt-0.5" />
                    {f}
                  </li>
                ))}
              </ul>
            </div>

            {/* CTA */}
            <div className="flex flex-col gap-2.5 pt-1">
              <button
                onClick={handleOrder}
                className="w-full py-4 bg-brand-accent hover:bg-blue-700 text-white text-sm font-extrabold rounded-2xl shadow-lg hover:shadow-brand-accent/30 transition-all active:scale-[0.99] flex items-center justify-center gap-2 cursor-pointer"
              >
                <MessageCircle size={18} />
                Order on WhatsApp — ₹{product.price * quantity}
              </button>
              <button
                onClick={handleAskQuestion}
                className="w-full py-3 border border-gray-200 text-brand-navy text-sm font-bold rounded-2xl hover:bg-gray-50 transition-all cursor-pointer"
              >
                Ask a Question
              </button>
            </div>

            {/* Delivery perks */}
            <div className="grid grid-cols-3 gap-2 pt-1">
              {[
                { icon: Truck, label: 'Shipping ₹79' },
                { icon: ShieldCheck, label: 'Lifetime Validity' },
                { icon: MessageCircle, label: 'WhatsApp Ordering' },
              ].map(({ icon: Icon, label }) => (
                <div
                  key={label}
                  className="flex flex-col items-center gap-1.5 bg-gray-50 rounded-2xl py-3 text-center"
                >
                  <Icon size={18} className="text-brand-accent" />
                  <span className="text-[10px] font-bold text-gray-600">{label}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};