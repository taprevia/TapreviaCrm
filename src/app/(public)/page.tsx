import React from 'react';
import type { Metadata } from 'next';
import { Hero } from '@/components/marketing/sections/Hero';
import { PreBookingSection } from '@/components/marketing/sections/PreBookingSection';
import { WhyTaprevia } from '@/components/marketing/sections/WhyTaprevia';
import { TrustStats } from '@/components/marketing/sections/TrustStats';
import { ShopByCategory } from '@/components/marketing/sections/ShopByCategory';
import { BestSellers } from '@/components/marketing/sections/BestSellers';
import { Testimonials } from '@/components/marketing/sections/Testimonials';
import { ForTeamsCTA } from '@/components/marketing/sections/ForTeamsCTA';
import { AudienceTags } from '@/components/marketing/sections/AudienceTags';
import { TapreviaEdge } from '@/components/marketing/sections/TapreviaEdge';
import { FinalCTA } from '@/components/marketing/sections/FinalCTA';
import { FAQ } from '@/components/marketing/sections/FAQ';
import { PRODUCTS } from '@/lib/marketing/products';

export const metadata: Metadata = {
  title: {
    absolute: 'Taprevia — One Tap Digital Business Cards & NFC Standees India',
  },
  description:
    'Order premium NFC business cards, Instagram social cards, and Google review standees with NFC + QR, dynamic profiles, and lifetime digital validity. Order easily via WhatsApp.',
};

export default function HomePage() {
  // Schema.org JSON-LD Structured Data
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Store',
    name: 'Taprevia',
    description: 'Premium NFC Digital Business Cards & Standees in India',
    url: 'https://taprevia.com',
    priceRange: '₹399 - ₹1499',
    areaServed: 'IN',
    hasOfferCatalog: {
      '@type': 'OfferCatalog',
      name: 'NFC Cards and Standees',
      itemListElement: PRODUCTS.map((p, i) => ({
        '@type': 'Offer',
        itemOffered: {
          '@type': 'Product',
          name: p.name,
          description: p.description,
          image: `https://taprevia.com${p.image}`,
          offers: {
            '@type': 'Offer',
            priceCurrency: 'INR',
            price: p.price,
            availability: 'https://schema.org/InStock',
          },
        },
        position: i + 1,
      })),
    },
  };

  const orgLd = {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: 'Taprevia',
    url: 'https://taprevia.com',
    logo: 'https://taprevia.com/images/logo.png',
    contactPoint: {
      '@type': 'ContactPoint',
      telephone: '+91 99 74 99 2213',
      contactType: 'customer service',
      areaServed: 'IN',
    },
    address: {
      '@type': 'PostalAddress',
      addressLocality: 'Ahmedabad',
      addressRegion: 'Gujarat',
      addressCountry: 'IN',
    },
    sameAs: [
      'https://instagram.com/taprevia',
      'https://facebook.com/taprevia',
      'https://linkedin.com/company/taprevia',
      'https://x.com/taprevia',
      'https://threads.net/@taprevia',
      'https://pinterest.com/taprevia',
      'https://taprevia.tumblr.com',
      'https://youtube.com/@taprevia',
    ],
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(orgLd) }}
      />
      <Hero />
      <PreBookingSection />
      {/* <LogoStrip /> */}
      <WhyTaprevia />
      <TrustStats />
      <ShopByCategory />
      <BestSellers />
      <Testimonials />
      <ForTeamsCTA />
      <AudienceTags />
      <TapreviaEdge />
      <FinalCTA />
      <FAQ />
    </>
  );
}
