import React from 'react';
import { Users, MessageCircle } from 'lucide-react';
import { Badge } from '@/components/marketing/ui/Badge';
import { Button } from '@/components/marketing/ui/Button';
import { getWhatsAppUrl } from '@/lib/marketing/whatsapp';

export const ForTeamsCTA: React.FC = () => {
  const bulkPricingWhatsAppUrl = getWhatsAppUrl({
    customMessage: "Hi Taprevia! 🚀 We'd like to order Taprevia NFC cards in bulk for our team. Can you share corporate pricing?"
  });

  return (
    <section id="for-teams" className="py-12 bg-white">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="bg-brand-navy rounded-3xl p-6 sm:p-12 lg:p-16 shadow-2xl relative overflow-hidden text-white flex flex-col lg:flex-row items-center lg:items-center justify-between gap-8 lg:gap-10">
          
          {/* Subtle Background Glow Accent */}
          <div className="absolute top-0 right-0 w-96 h-96 bg-brand-accent/10 rounded-full blur-3xl pointer-events-none" />

          {/* Left Content */}
          <div className="max-w-2xl space-y-4 relative z-10 text-center lg:text-left">
            <Badge variant="dark" icon={<Users size={14} className="text-white" />}>
              FOR TEAMS
            </Badge>

            <h2 className="text-2xl sm:text-4xl lg:text-5xl font-black text-white tracking-tight leading-tight">
              Equip your whole team. Save up to 20%.
            </h2>

            <p className="text-sm sm:text-lg text-gray-300 font-normal leading-relaxed">
              Order custom-branded NFC cards for your team with centralized admin and a dedicated success manager — delivered within days.
            </p>
          </div>

          {/* Right Action Button & Caption */}
          <div className="shrink-0 flex flex-col items-center gap-3 w-full lg:w-auto relative z-10">
            <a
              href={bulkPricingWhatsAppUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="w-full sm:w-auto"
            >
              <Button
                variant="outline"
                size="lg"
                pill
                className="w-full sm:w-auto bg-emerald-600 text-white hover:bg-emerald-700 font-extrabold text-sm sm:text-base gap-2 px-6 sm:px-8 shadow-lg border-none"
              >
                <MessageCircle size={18} />
                Get Bulk Pricing on WhatsApp
              </Button>
            </a>
            <p className="text-xs text-gray-400 text-center font-medium">
              Custom branding · No commitment required
            </p>
          </div>

        </div>
      </div>
    </section>
  );
};
