'use client';

import React from 'react';
import { MessageCircle } from 'lucide-react';
import { getWhatsAppUrl } from '@/lib/marketing/whatsapp';

export const WhatsAppButton: React.FC = () => {
  const whatsappUrl = getWhatsAppUrl();

  return (
    <a
      href={whatsappUrl}
      target="_blank"
      rel="noopener noreferrer"
      aria-label="Order on WhatsApp"
      className="fixed bottom-6 right-6 z-50 group flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white p-3.5 sm:px-5 sm:py-3.5 rounded-full shadow-2xl transition-all duration-300 hover:scale-105 active:scale-95 border border-emerald-400/40"
    >
      <MessageCircle size={24} className="fill-white/20 text-white animate-bounce-slow" />
      <span className="hidden sm:inline text-xs font-black uppercase tracking-wider">
        Order on WhatsApp
      </span>
      <span className="relative flex h-3 w-3 -mt-3 -mr-2">
        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-300 opacity-75"></span>
        <span className="relative inline-flex rounded-full h-3 w-3 bg-emerald-200"></span>
      </span>
    </a>
  );
};
