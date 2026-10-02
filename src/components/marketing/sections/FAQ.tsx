import React from 'react';
import { FAQ_ITEMS } from '@/lib/marketing/faq';
import { AccordionItem } from '@/components/marketing/ui/AccordionItem';

export const FAQ: React.FC = () => {
  return (
    <section id="faq" className="py-20 bg-brand-bgLight">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
        
        {/* Section Header */}
        <div className="text-center mb-14">
          <p className="text-xs font-bold text-brand-navy uppercase tracking-widest mb-2">
            FAQ
          </p>
          <h2 className="text-3xl sm:text-4xl lg:text-5xl font-black text-brand-navy tracking-tight">
            Questions, answered.
          </h2>
        </div>

        {/* Accordion Stack */}
        <div className="space-y-4">
          {FAQ_ITEMS.map((item, idx) => (
            <AccordionItem
              key={item.id}
              item={item}
              isOpenDefault={idx === 0}
            />
          ))}
        </div>

      </div>
    </section>
  );
};
