import React from 'react';
import { MessageCircle, Smartphone, Zap, Infinity } from 'lucide-react';

export const TrustStats: React.FC = () => {
  const row2 = [
    {
      icon: <MessageCircle size={20} className="text-brand-navy" />,
      title: 'Easy WhatsApp Ordering',
      caption: 'Quick & personal service',
    },
    {
      icon: <Smartphone size={20} className="text-brand-navy" />,
      title: 'NFC + QR Hybrid',
      caption: 'Works on almost all phones',
    },
    {
      icon: <Zap size={20} className="text-brand-navy" />,
      title: 'Quick & Easy Setup',
      caption: 'Ready to use right away',
    },
    {
      icon: <Infinity size={20} className="text-brand-navy" />,
      title: 'Lifetime Digital Validity',
      caption: 'One-time investment, no subscription',
    },
  ];

  return (
    <section className="py-12 bg-white border-b border-gray-100">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 space-y-6">
        
        {/* Row 2: Why Taprevia */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
          {row2.map((item, idx) => (
            <div
              key={idx}
              className="bg-brand-bgLight rounded-2xl p-4 sm:p-5 flex flex-col sm:flex-row items-center gap-2 sm:gap-4 text-center sm:text-left shadow-xs"
            >
              <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-xl bg-gray-200/70 flex items-center justify-center shrink-0">
                {item.icon}
              </div>
              <div>
                <p className="text-xs sm:text-base font-bold text-brand-navy">{item.title}</p>
                <p className="text-[10px] sm:text-xs text-gray-500 font-medium">{item.caption}</p>
              </div>
            </div>
          ))}
        </div>

      </div>
    </section>
  );
};
