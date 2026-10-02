import React from 'react';
import { TESTIMONIALS } from '@/lib/marketing/testimonials';
import { StarRating } from '@/components/marketing/ui/StarRating';

export const Testimonials: React.FC = () => {
  return (
    <section className="py-20 bg-white">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
        
        {/* Header */}
        <div className="max-w-2xl mx-auto mb-14">
          <p className="text-xs font-bold text-brand-navy uppercase tracking-widest mb-2">
            LOVED BY LEADERS
          </p>
          <h2 className="text-3xl sm:text-4xl lg:text-5xl font-black text-brand-navy tracking-tight">
            Real growth, real reviews
          </h2>
          <p className="text-base text-gray-500 mt-2 font-normal">
            Don&apos;t take our word for it. Here&apos;s what teams are saying.
          </p>
        </div>

        {/* 3-Column Grid */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 text-left">
          {TESTIMONIALS.map((item) => (
            <div
              key={item.id}
              className="bg-brand-bgLight rounded-3xl p-8 shadow-xs flex flex-col justify-between hover:shadow-md transition-shadow"
            >
              <div>
                <StarRating rating={item.rating} showCount={false} size={16} />
                <p className="text-sm text-gray-700 leading-relaxed italic mt-5 mb-6 font-normal">
                  {item.quote}
                </p>
              </div>

              <div className="pt-5 border-t border-gray-200/60 flex items-center gap-3">
                <div className="w-11 h-11 rounded-full bg-gray-300 text-brand-navy font-bold text-xs flex items-center justify-center shrink-0">
                  {item.avatarInitials}
                </div>
                <div>
                  <h3 className="text-sm font-bold text-brand-navy">{item.name}</h3>
                  <p className="text-xs text-gray-500">{item.role} · {item.company}</p>
                </div>
              </div>
            </div>
          ))}
        </div>

      </div>
    </section>
  );
};
