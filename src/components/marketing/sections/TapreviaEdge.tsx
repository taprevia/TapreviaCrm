import React from 'react';
import { Award, Truck, Sparkles, RefreshCw, TrendingUp, ShieldCheck } from 'lucide-react';

const edgeItems = [
  { label: 'Premium Quality Products', icon: <Award size={20} className="text-brand-navy" /> },
  { label: 'Fast Delivery Across India', icon: <Truck size={20} className="text-brand-navy" /> },
  { label: 'Professional Design Support', icon: <Sparkles size={20} className="text-brand-navy" /> },
  { label: 'Easy Profile Updates', icon: <RefreshCw size={20} className="text-brand-navy" /> },
  { label: 'Powerful Lead Generation', icon: <TrendingUp size={20} className="text-brand-navy" /> },
  { label: 'Trusted by Businesses', icon: <ShieldCheck size={20} className="text-brand-navy" /> },
];

export const TapreviaEdge: React.FC = () => {
  return (
    <section className="py-20 bg-brand-bgLight">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
        
        {/* Section Header */}
        <div className="max-w-2xl mx-auto mb-14">
          <p className="text-xs font-bold text-brand-navy uppercase tracking-widest mb-2">
            THE TAPREVIA EDGE
          </p>
          <h2 className="text-3xl sm:text-4xl lg:text-5xl font-black text-brand-navy tracking-tight">
            What makes Taprevia different.
          </h2>
        </div>

        {/* 2-Row 3-Column Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6">
          {edgeItems.map((item, idx) => (
            <div
              key={idx}
              className="bg-white rounded-3xl p-5 sm:p-6 shadow-xs flex flex-col sm:flex-row items-center sm:items-center gap-3 sm:gap-4 text-center sm:text-left hover:shadow-md transition-shadow"
            >
              <div className="w-11 h-11 sm:w-12 sm:h-12 rounded-2xl bg-gray-100 flex items-center justify-center shrink-0">
                {item.icon}
              </div>
              <span className="text-xs sm:text-base font-bold text-brand-navy leading-snug">
                {item.label}
              </span>
            </div>
          ))}
        </div>

      </div>
    </section>
  );
};
