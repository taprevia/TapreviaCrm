'use client';

import React, { useState } from 'react';
import { Zap, Briefcase, Leaf, Smartphone } from 'lucide-react';

export const WhyTaprevia: React.FC = () => {
  const [activeTab, setActiveTab] = useState('Contact Details');

  const features = [
    {
      icon: <Zap size={24} className="text-brand-navy" />,
      title: 'One Tap Sharing',
      description: 'Share everything instantly — no app needed.',
    },
    {
      icon: <Briefcase size={24} className="text-brand-navy" />,
      title: 'Premium Branding',
      description: 'Stand out with elegant, custom NFC cards.',
    },
    {
      icon: <Leaf size={24} className="text-brand-navy" />,
      title: 'Eco-Friendly',
      description: 'Update anytime. Never reprint again.',
    },
    {
      icon: <Smartphone size={24} className="text-brand-navy" />,
      title: 'Smart Profile',
      description: 'A modern digital identity that converts.',
    },
  ];

  const profileTabs = [
    'Contact Details',
    'Social Media',
    'Websites',
    'Payment QR',
    'Portfolio',
    'Product Catalog',
    'Videos & Images',
  ];

  return (
    <section id="how-it-works" className="py-20 bg-brand-bgLight">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        
        {/* Section Header */}
        <div className="max-w-3xl mb-12">
          <p className="text-xs font-bold text-brand-navy uppercase tracking-widest mb-2">
            WHY TAPREVIA
          </p>
          <h2 className="text-3xl sm:text-4xl lg:text-5xl font-black text-brand-navy tracking-tight leading-tight">
            Modern networking, engineered for impact.
          </h2>
          <p className="text-base sm:text-lg text-gray-500 mt-3 font-normal">
            Trusted by thousands of professionals to network smarter.
          </p>
        </div>

        {/* 4-Column Feature Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 mb-12">
          {features.map((item, index) => (
            <div
              key={index}
              className="bg-white rounded-3xl p-7 shadow-brandCard hover:shadow-xl transition-all duration-300 flex flex-col justify-between group"
            >
              <div>
                <div className="w-12 h-12 rounded-2xl bg-gray-100 flex items-center justify-center mb-6 group-hover:bg-blue-50 group-hover:scale-110 transition-all">
                  {item.icon}
                </div>
                <h3 className="text-xl font-bold text-brand-navy mb-2">
                  {item.title}
                </h3>
                <p className="text-sm text-gray-500 leading-relaxed">
                  {item.description}
                </p>
              </div>
            </div>
          ))}
        </div>

        {/* Feature Tab Row Pills */}
        <div className="pt-6 border-t border-gray-200/60">
          <div className="flex items-center justify-center flex-wrap gap-2 sm:gap-3">
            {profileTabs.map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`px-5 py-2.5 rounded-full text-xs font-semibold transition-all cursor-pointer ${
                  activeTab === tab
                    ? 'bg-white text-brand-navy border border-gray-300 shadow-sm font-bold'
                    : 'bg-transparent text-gray-500 border border-gray-200 hover:border-gray-300 hover:text-brand-navy'
                }`}
              >
                {tab}
              </button>
            ))}
          </div>
        </div>

      </div>
    </section>
  );
};
