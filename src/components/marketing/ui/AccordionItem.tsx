'use client';

import React, { useState } from 'react';
import { ChevronDown, HelpCircle, Smartphone, AppWindow, RefreshCw, Truck, Users } from 'lucide-react';
import { FAQItem } from '@/types/marketing';

interface AccordionItemProps {
  item: FAQItem;
  isOpenDefault?: boolean;
}

const iconMap: Record<string, React.ReactNode> = {
  Smartphone: <Smartphone size={20} className="text-brand-navy" />,
  AppWindow: <AppWindow size={20} className="text-brand-navy" />,
  RefreshCw: <RefreshCw size={20} className="text-brand-navy" />,
  Truck: <Truck size={20} className="text-brand-navy" />,
  Users: <Users size={20} className="text-brand-navy" />,
};

export const AccordionItem: React.FC<AccordionItemProps> = ({ item, isOpenDefault = false }) => {
  const [isOpen, setIsOpen] = useState(isOpenDefault);

  return (
    <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden shadow-xs transition-all duration-200">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full p-5 text-left flex items-center justify-between gap-4 cursor-pointer hover:bg-gray-50/50 transition-colors"
        aria-expanded={isOpen}
      >
        <div className="flex items-center gap-4">
          <div className="w-10 h-10 rounded-xl bg-gray-100 flex items-center justify-center shrink-0">
            {item.iconName && iconMap[item.iconName] ? (
              iconMap[item.iconName]
            ) : (
              <HelpCircle size={20} className="text-brand-navy" />
            )}
          </div>
          <span className="text-base font-bold text-brand-navy">{item.question}</span>
        </div>
        <div className={`p-2 rounded-full transition-transform duration-300 ${isOpen ? 'rotate-180 bg-gray-100 text-brand-navy' : 'text-gray-400'}`}>
          <ChevronDown size={18} />
        </div>
      </button>

      {isOpen && (
        <div className="px-5 pb-5 pt-1 text-sm leading-relaxed text-gray-600 border-t border-gray-50">
          <p className="ml-0 sm:ml-14">{item.answer}</p>
        </div>
      )}
    </div>
  );
};
