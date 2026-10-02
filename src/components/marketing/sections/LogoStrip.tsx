import React from 'react';

const brands = [
  { name: 'Patel Perfumes', text: 'PATEL PERFUMES' },
  { name: 'Uno Aroma', text: 'UNO AROMA' },
  { name: 'Babo Bebi', text: 'BABO BEBI' },
  { name: 'Apex Logistics', text: 'APEX LOGISTICS' },
  { name: 'Kavya Jewels', text: 'KAVYA JEWELS' },
  { name: 'Zenith Tech', text: 'ZENITH TECH' },
];

export const LogoStrip: React.FC = () => {
  return (
    <section id="clients" className="py-10 bg-white border-y border-gray-100 overflow-hidden">
      <div className="max-w-7xl mx-auto px-4 text-center mb-6">
        <p className="text-xs font-bold text-gray-400 uppercase tracking-widest">
          TRUSTED BY LEADING BRANDS
        </p>
      </div>

      {/* Infinite Scrolling Marquee */}
      <div className="relative w-full overflow-hidden flex items-center">
        {/* Fade gradients on edges */}
        <div className="absolute left-0 top-0 bottom-0 w-24 bg-gradient-to-r from-white to-transparent z-10 pointer-events-none" />
        <div className="absolute right-0 top-0 bottom-0 w-24 bg-gradient-to-l from-white to-transparent z-10 pointer-events-none" />

        <div className="flex animate-marquee whitespace-nowrap items-center gap-12 sm:gap-20">
          {[...brands, ...brands, ...brands].map((brand, idx) => (
            <div
              key={idx}
              className="flex items-center gap-2 opacity-50 hover:opacity-100 transition-opacity duration-200 cursor-pointer grayscale"
            >
              <span className="text-xl sm:text-2xl font-black text-gray-800 tracking-wider uppercase font-mono">
                {brand.text}
              </span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};
