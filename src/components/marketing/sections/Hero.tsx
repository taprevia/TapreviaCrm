import React from 'react';
import Image from 'next/image';
import { ShieldCheck, CheckCircle2, ArrowRight, Truck, Star, Rocket } from 'lucide-react';
import { Button } from '@/components/marketing/ui/Button';
import { Badge } from '@/components/marketing/ui/Badge';


export const Hero: React.FC = () => {
  return (
    <section id="hero" className="relative pt-8 pb-16 md:pt-14 md:pb-24 overflow-hidden bg-white">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 lg:gap-8 items-center">
          
          {/* Left Column: Text & Value Proposition */}
          <div className="lg:col-span-7 space-y-6">
            
            {/* Top Pill Badge */}
            <div>
              <Badge variant="light" icon={<Rocket size={14} className="text-brand-accent" />}>
                🚀 LIVE NOW — ORDER ON WHATSAPP
              </Badge>
            </div>

            {/* H1 Headline */}
            <h1 className="text-4xl sm:text-5xl lg:text-6xl font-black text-brand-navy tracking-tight leading-[1.1]">
              NFC business cards to{' '}
              <span className="relative inline-block text-brand-navy">
                grow your business
                <svg className="absolute left-0 -bottom-2 w-full h-3 text-brand-accent/30 -z-10" viewBox="0 0 300 12" fill="none" preserveAspectRatio="none">
                  <path d="M3 9C50 3 150 2 297 9" stroke="currentColor" strokeWidth="6" strokeLinecap="round" />
                </svg>
              </span>{' '}
              with one tap.
            </h1>

            {/* Subtext */}
            <p className="text-base sm:text-lg text-gray-600 leading-relaxed max-w-2xl font-normal">
              Premium NFC business cards engineered for entrepreneurs, sales teams and enterprises. Share contacts, capture leads and project a brand that earns trust on first impression.
            </p>

            {/* Checklist items */}
            <div className="space-y-3 pt-2">
              {[
                'No app required — works on every modern phone',
                'Update your profile anytime, instantly',
                'Share contacts, social links & payment QR in one tap',
              ].map((item, index) => (
                <div key={index} className="flex items-center gap-3">
                  <div className="w-5 h-5 rounded-full bg-brand-navy text-white flex items-center justify-center shrink-0">
                    <CheckCircle2 size={14} />
                  </div>
                  <span className="text-sm font-semibold text-brand-navy">{item}</span>
                </div>
              ))}
            </div>

            <div className="flex flex-wrap items-center gap-4 pt-4">
              <a href="#order">
                <Button variant="primary" size="lg" pill className="gap-2 text-base px-8 shadow-md">
                  Order Now <ArrowRight size={18} />
                </Button>
              </a>
              <a href="#products">
                <Button variant="outline" size="lg" pill className="text-base px-8">
                  Explore Products
                </Button>
              </a>
            </div>

            {/* Trust line */}
            <div className="flex items-start gap-2 text-xs font-medium text-gray-500 pt-2">
              <ShieldCheck size={16} className="text-emerald-600 shrink-0 mt-0.5" />
              <span>Dispatched within 24–48 hours · Lifetime digital validity</span>
            </div>

            {/* Divider & 3-Column Stats Row */}
            <div className="pt-8 border-t border-gray-100 grid grid-cols-3 gap-4 max-w-lg">
              <div>
                <div className="flex items-center gap-1.5 text-gray-500 text-xs font-semibold uppercase tracking-wider mb-1">
                  <Truck size={14} className="text-brand-accent" />
                  <span>Dispatch Time</span>
                </div>
                <p className="text-lg sm:text-xl font-extrabold text-brand-navy">24–48 hrs</p>
              </div>

              <div>
                <div className="flex items-center gap-1.5 text-gray-500 text-xs font-semibold uppercase tracking-wider mb-1">
                  <ShieldCheck size={14} className="text-brand-accent" />
                  <span>Digital Validity</span>
                </div>
                <p className="text-lg sm:text-xl font-extrabold text-brand-navy">Lifetime</p>
              </div>

              <div>
                <div className="flex items-center gap-1.5 text-gray-500 text-xs font-semibold uppercase tracking-wider mb-1">
                  <Star size={14} className="fill-amber-400 text-amber-400" />
                  <span>Rating</span>
                </div>
                <p className="text-lg sm:text-xl font-extrabold text-brand-navy">4.9</p>
              </div>
            </div>

          </div>

          {/* Right Column: Interactive Graphic Panel */}
          <div className="lg:col-span-5 relative">
            <div className="relative mx-auto max-w-md bg-gradient-to-b from-blue-50/50 to-gray-100/80 rounded-4xl p-6 lg:p-8 shadow-heroCard">
              
              {/* Phone Mockup Screen */}
              <div className="relative mx-auto w-[240px] sm:w-[260px] aspect-[9/18] rounded-[36px] overflow-hidden shadow-2xl border-4 border-gray-700 bg-gray-950">
                <Image
                  src="/images/hero-phone.svg"
                  alt="Taprevia NFC Digital Profile Card Preview"
                  fill
                  priority
                  className="object-cover"
                />
              </div>

              {/* Overlapping Physical NFC Card */}
              <div className="absolute left-1 sm:-left-4 bottom-14 w-40 sm:w-52 aspect-[1.58/1] rounded-2xl overflow-hidden shadow-2xl transform -rotate-12 hover:rotate-0 transition-transform duration-300">
                <Image
                  src="/images/MarketingImg/Metal%20card.svg"
                  alt="Taprevia Metal NFC Business Card"
                  fill
                  className="object-cover"
                />
              </div>

              {/* Floating Badge Top Left */}
              <div className="absolute top-4 left-1 sm:-left-6 bg-white rounded-2xl p-3.5 shadow-xl flex items-center gap-3 animate-bounce-slow">
                <div className="w-8 h-8 rounded-full bg-brand-navy text-white flex items-center justify-center font-bold text-xs">
                  &#10003;
                </div>
                <div>
                  <p className="text-xs font-bold text-brand-navy">In Stock</p>
                </div>
              </div>

              {/* Floating Review Badge Bottom Right */}
              <div className="absolute -bottom-4 right-1 sm:-right-4 bg-white rounded-2xl p-4 shadow-xl max-w-[200px]">
                <div className="flex items-center gap-1 mb-1">
                  {[...Array(5)].map((_, i) => (
                    <Star key={i} size={12} className="fill-amber-400 text-amber-400" />
                  ))}
                </div>
                <p className="text-xs font-bold text-brand-navy leading-snug">&quot;Looks incredibly premium.&quot;</p>
                <p className="text-[10px] text-gray-400 mt-1">— Verified buyer</p>
              </div>

            </div>
          </div>

        </div>
      </div>
    </section>
  );
};
