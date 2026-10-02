import React from 'react';
import { Building2, Home, Stethoscope, Utensils, Megaphone, Laptop, Users, Store, Calendar } from 'lucide-react';

const audienceList = [
  { label: 'Business Owners', icon: <Building2 size={16} /> },
  { label: 'Real Estate Agents', icon: <Home size={16} /> },
  { label: 'Doctors', icon: <Stethoscope size={16} /> },
  { label: 'Restaurant Owners', icon: <Utensils size={16} /> },
  { label: 'Influencers', icon: <Megaphone size={16} /> },
  { label: 'Freelancers', icon: <Laptop size={16} /> },
  { label: 'Corporate Teams', icon: <Users size={16} /> },
  { label: 'Shop Owners', icon: <Store size={16} /> },
  { label: 'Event Managers', icon: <Calendar size={16} /> },
];

export const AudienceTags: React.FC = () => {
  return (
    <section className="py-16 bg-white">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 items-center">
          
          {/* Left Column: Heading */}
          <div className="lg:col-span-5 space-y-3">
            <p className="text-xs font-bold text-brand-navy uppercase tracking-widest">
              BUILT FOR EVERYONE
            </p>
            <h2 className="text-3xl sm:text-4xl lg:text-5xl font-black text-brand-navy tracking-tight leading-tight">
              Perfect for every professional.
            </h2>
            <p className="text-base text-gray-500 font-normal leading-relaxed">
              Whether you&apos;re closing deals, growing a brand, or running a busy storefront — Taprevia adapts to your workflow.
            </p>
          </div>

          {/* Right Column: Pill Tags Grid */}
          <div className="lg:col-span-7 flex flex-wrap gap-3">
            {audienceList.map((item, idx) => (
              <div
                key={idx}
                className="bg-brand-bgLight hover:bg-white border border-gray-100 rounded-full px-5 py-3 text-xs font-bold text-brand-navy flex items-center gap-2.5 shadow-xs hover:shadow-md transition-all duration-200 cursor-pointer"
              >
                <span className="text-brand-navy shrink-0">{item.icon}</span>
                <span>{item.label}</span>
              </div>
            ))}
          </div>

        </div>
      </div>
    </section>
  );
};
