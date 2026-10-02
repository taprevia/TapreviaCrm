import React from 'react';
import { ArrowRight, MessageCircle } from 'lucide-react';
import { Button } from '@/components/marketing/ui/Button';
import { getWhatsAppUrl } from '@/lib/marketing/whatsapp';

export const FinalCTA: React.FC = () => {
  const salesWhatsAppUrl = getWhatsAppUrl({
    customMessage: "Hi Taprevia! 🚀 I'd like to order a Taprevia NFC card. Please share the payment & delivery details."
  });

  return (
    <section className="py-20 bg-white">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="relative rounded-4xl bg-gradient-to-b from-blue-50/70 via-gray-50 to-blue-50/30 p-10 sm:p-16 lg:p-20 text-center shadow-heroCard overflow-hidden">
          
          <p className="text-xs font-bold text-brand-navy uppercase tracking-widest mb-4">
            AVAILABLE NOW · ORDER ON WHATSAPP
          </p>

          {/* Headline */}
          <h2 className="text-3xl sm:text-5xl lg:text-6xl font-black text-brand-navy tracking-tight max-w-4xl mx-auto leading-tight mb-6">
            Make a first impression{' '}
            <span className="bg-gradient-to-r from-blue-600 via-indigo-500 to-teal-400 bg-clip-text text-transparent">
              with every tap.
            </span>
          </h2>

          <p className="text-base sm:text-lg text-gray-600 max-w-2xl mx-auto mb-10 font-normal leading-relaxed">
            Order your Taprevia card today and network like a pro. Every card ships with NFC + QR, a dynamic profile, and lifetime digital validity.
          </p>

          <div className="flex flex-wrap items-center justify-center gap-4">
            <a href="#order">
              <Button variant="primary" size="lg" pill className="gap-2 text-base px-8 shadow-md">
                Order Your Card <ArrowRight size={18} />
              </Button>
            </a>
            
            <a
              href={salesWhatsAppUrl}
              target="_blank"
              rel="noopener noreferrer"
            >
              <Button variant="outline" size="lg" pill className="text-base px-8 gap-2">
                <MessageCircle size={18} className="text-emerald-600" />
                Chat with our team
              </Button>
            </a>
          </div>

        </div>
      </div>
    </section>
  );
};
