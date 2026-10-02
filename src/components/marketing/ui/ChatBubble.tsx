'use client';

import React, { useState } from 'react';
import { MessageCircle, X } from 'lucide-react';
import { getWhatsAppUrl } from '@/lib/marketing/whatsapp';

export const ChatBubble: React.FC = () => {
  const [isOpen, setIsOpen] = useState(false);
  const whatsappUrl = getWhatsAppUrl({
    customMessage: "Hi Taprevia Team! 👋 I'm on your website and would like help ordering an NFC card / Standy."
  });

  return (
    <div className="fixed bottom-6 right-6 z-50 flex flex-col items-end">
      {/* Floating Popup Window */}
      {isOpen && (
        <div className="mb-3 w-80 bg-white rounded-3xl p-5 shadow-2xl border border-gray-100 animate-in fade-in slide-in-from-bottom-5 duration-200">
          <div className="flex items-center justify-between pb-3 border-b border-gray-100">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-emerald-600 text-white flex items-center justify-center font-bold">
              T
              </div>
              <div>
                <h4 className="text-sm font-bold text-brand-navy">Taprevia Support</h4>
                <p className="text-[11px] text-emerald-600 font-medium flex items-center gap-1">
                  <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
                  Online · Direct WhatsApp Order
                </p>
              </div>
            </div>
            <button
              onClick={() => setIsOpen(false)}
              className="p-1 text-gray-400 hover:text-gray-600 rounded-full hover:bg-gray-100 transition-colors"
            >
              <X size={18} />
            </button>
          </div>
          
          <div className="py-4 text-xs text-gray-600 leading-relaxed">
            👋 Hi there! Need help picking the right NFC card or placing an order? Tap below to chat and buy directly on WhatsApp.
          </div>

          <a
            href={whatsappUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="w-full py-3 px-4 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs rounded-xl flex items-center justify-center gap-2 transition-colors shadow-sm"
          >
            <MessageCircle size={16} />
            Order / Chat on WhatsApp
          </a>
        </div>
      )}

      {/* Floating Button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        aria-label="Chat with Taprevia Support"
        className="w-14 h-14 rounded-full bg-brand-whatsapp text-white shadow-float flex items-center justify-center hover:scale-110 active:scale-95 transition-all duration-300 cursor-pointer"
      >
        {isOpen ? <X size={24} /> : <MessageCircle size={28} className="fill-white/20" />}
      </button>
    </div>
  );
};
