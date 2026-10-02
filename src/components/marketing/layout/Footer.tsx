'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { Mail, Phone, MapPin, CheckCircle2 } from 'lucide-react';

// Inline SVG icons for platforms not in lucide-react (brand icons were
// removed upstream in lucide-react v1.x)
const ThreadsIcon = ({ size = 15 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
    <path d="M12.186 24h-.007c-3.581-.024-6.334-1.205-8.184-3.509C2.35 18.44 1.5 15.586 1.5 12.068c0-3.516.85-6.372 2.495-8.424C5.845 1.34 8.598.159 12.18.135h.014c2.746.018 5.1.761 6.998 2.209 1.87 1.43 3.19 3.487 3.926 6.115l-2.01.55c-.602-2.198-1.674-3.885-3.185-5.013-1.494-1.116-3.434-1.693-5.744-1.707-2.81.019-5.028.916-6.59 2.666-1.532 1.716-2.31 4.227-2.31 7.113 0 2.887.778 5.397 2.31 7.114 1.562 1.749 3.78 2.647 6.59 2.666 2.255-.016 4.08-.576 5.42-1.664 1.438-1.167 2.269-2.924 2.47-5.226H12v-2.067h9.896v.52c-.003 4.748-2.658 8.419-9.71 8.419z"/>
  </svg>
);

const PinterestIcon = ({ size = 15 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
    <path d="M12 0C5.373 0 0 5.373 0 12c0 5.084 3.163 9.426 7.627 11.174-.105-.949-.2-2.405.042-3.441.218-.937 1.407-5.965 1.407-5.965s-.359-.719-.359-1.782c0-1.668.967-2.914 2.171-2.914 1.023 0 1.518.769 1.518 1.69 0 1.029-.655 2.568-.994 3.995-.283 1.194.599 2.169 1.777 2.169 2.133 0 3.772-2.249 3.772-5.495 0-2.873-2.064-4.882-5.012-4.882-3.414 0-5.418 2.561-5.418 5.207 0 1.031.397 2.138.893 2.738a.36.36 0 0 1 .083.345l-.333 1.36c-.053.22-.174.267-.402.161-1.499-.698-2.436-2.889-2.436-4.649 0-3.785 2.75-7.262 7.929-7.262 4.163 0 7.398 2.967 7.398 6.931 0 4.136-2.607 7.464-6.227 7.464-1.216 0-2.359-.632-2.75-1.378l-.748 2.853c-.271 1.043-1.002 2.35-1.492 3.146C9.57 23.812 10.763 24 12 24c6.627 0 12-5.373 12-12S18.627 0 12 0z"/>
  </svg>
);

const TumblrIcon = ({ size = 15 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
    <path d="M14.563 24c-5.093 0-7.031-3.756-7.031-6.411V9.747H5.116V6.648c3.63-1.313 4.512-4.596 4.71-6.469C9.84.051 9.941 0 9.999 0h3.517v6.114h4.801v3.633h-4.82v7.47c.012 1.001.375 2.371 2.207 2.371h.09c.631-.02 1.486-.205 1.936-.419l1.156 3.425c-.436.636-2.4 1.374-4.306 1.406H14.563z"/>
  </svg>
);

const BrandIconShell = ({ size = 15, children }: { size?: number; children: React.ReactNode }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    {children}
  </svg>
);

const InstagramIcon = ({ size = 15 }: { size?: number }) => (
  <BrandIconShell size={size}>
    <rect width="20" height="20" x="2" y="2" rx="5" ry="5" />
    <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z" />
    <line x1="17.5" x2="17.51" y1="6.5" y2="6.5" />
  </BrandIconShell>
);

const FacebookIcon = ({ size = 15 }: { size?: number }) => (
  <BrandIconShell size={size}>
    <path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z" />
  </BrandIconShell>
);

const LinkedinIcon = ({ size = 15 }: { size?: number }) => (
  <BrandIconShell size={size}>
    <path d="M16 8a6 6 0 0 1 6 6v7h-4v-7a2 2 0 0 0-2-2 2 2 0 0 0-2 2v7h-4v-7a6 6 0 0 1 6-6z" />
    <rect width="4" height="12" x="2" y="9" />
    <circle cx="4" cy="4" r="2" />
  </BrandIconShell>
);

const TwitterIcon = ({ size = 15 }: { size?: number }) => (
  <BrandIconShell size={size}>
    <path d="M22 4s-.7 2.1-2 3.4c1.6 10-9.4 17.3-18 11.6 2.2.1 4.4-.6 6-2C3 15.5.5 9.6 3 5c2.2 2.6 5.6 4.1 9 4-.9-4.2 4-6.6 7-3.8 1.1 0 3-1.2 3-1.2z" />
  </BrandIconShell>
);

const YoutubeIcon = ({ size = 15 }: { size?: number }) => (
  <BrandIconShell size={size}>
    <path d="M2.5 17a24.12 24.12 0 0 1 0-10 2 2 0 0 1 1.4-1.4 49.56 49.56 0 0 1 16.2 0A2 2 0 0 1 21.5 7a24.12 24.12 0 0 1 0 10 2 2 0 0 1-1.4 1.4 49.55 49.55 0 0 1-16.2 0A2 2 0 0 1 2.5 17" />
    <path d="m10 15 5-3-5-3z" />
  </BrandIconShell>
);
import { Button } from '@/components/marketing/ui/Button';

// ─────────────────────────────────────────────
//  ✏️  EDIT ALL FOOTER CONTENT HERE
// ─────────────────────────────────────────────
const FOOTER_CONFIG = {
  contact: {
    phone: {
      display: '+91 99 74 99 2213',
      href: 'tel:+919974992213',
    },
    email: {
      display: 'support@taprevia.com',
      href: 'mailto:support@taprevia.com',
    },
    address: {
      display: 'Keshavpriya Homes, Nikol, Ahmedabad, Gujarat',
      href: 'https://maps.google.com/?q=Nikol,Ahmedabad,Gujarat',
    },
  },
  social: [
    {
      label: 'Instagram',
      href: 'https://instagram.com/taprevia',
      icon: InstagramIcon,
    },
    {
      label: 'Facebook',
      href: 'https://facebook.com/taprevia',
      icon: FacebookIcon,
    },
    {
      label: 'LinkedIn',
      href: 'https://linkedin.com/company/taprevia',
      icon: LinkedinIcon,
    },
    {
      label: 'X (Twitter)',
      href: 'https://x.com/taprevia',
      icon: TwitterIcon,
    },
    {
      label: 'Threads',
      href: 'https://threads.net/@taprevia',
      icon: ThreadsIcon,
    },
    {
      label: 'Pinterest',
      href: 'https://pinterest.com/taprevia',
      icon: PinterestIcon,
    },
    {
      label: 'Tumblr',
      href: 'https://taprevia.tumblr.com',
      icon: TumblrIcon,
    },
    {
      label: 'YouTube',
      href: 'https://youtube.com/@taprevia',
      icon: YoutubeIcon,
    },
  ],
  nav: {
    product: [
      { label: 'Products',           href: '#products' },
      { label: 'Compatible Devices', href: '#how-it-works' },
      { label: 'How it works',       href: '#how-it-works' },
      { label: 'Live Demo',          href: '#hero' },
    ],
    company: [
      { label: 'For Teams',       href: '#for-teams' },
      { label: 'Bulk Orders',     href: '#for-teams' },
      { label: 'Contact Support', href: '#faq' },
    ],
    legal: [
      { label: 'Privacy', href: '/privacy' },
      { label: 'Terms',   href: '/terms' },
      { label: 'Cookies', href: '/cookies' },
    ],
  },
  tagline: 'The premium NFC networking ecosystem. Share contacts, social handles, and payment details in one tap.',
  copyright: '© 2026 Taprevia. All rights reserved.',
};
// ─────────────────────────────────────────────

export const Footer: React.FC = () => {
  const [email, setEmail] = useState('');
  const [subscribed, setSubscribed] = useState(false);

  const handleSubscribe = (e: React.FormEvent) => {
    e.preventDefault();
    if (email.trim()) {
      setSubscribed(true);
      setEmail('');
    }
  };

  const { contact, social, nav } = FOOTER_CONFIG;

  return (
    <footer className="bg-brand-navy text-white pt-16 pb-8 border-t border-brand-dark">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">

        {/* Main 4-Column Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-10 pb-12 border-b border-gray-800">

          {/* Column 1: Brand & Newsletter */}
          <div className="space-y-4">
            <Link href="/" className="flex items-center group">
              <Image
                src="/images/logo.png"
                alt="Taprevia"
                width={160}
                height={52}
                className="h-12 w-auto object-contain brightness-0 invert transition-opacity group-hover:opacity-75"
              />
            </Link>

            <p className="text-xs text-gray-400 leading-relaxed max-w-sm">
              {FOOTER_CONFIG.tagline}
            </p>

            <div className="pt-2">
              <h4 className="text-xs font-bold uppercase tracking-wider text-gray-300 mb-2">Get product updates</h4>
              {subscribed ? (
                <div className="flex items-center gap-2 text-emerald-400 text-xs font-semibold bg-emerald-950/50 p-2.5 rounded-xl border border-emerald-800">
                  <CheckCircle2 size={16} /> Subscribed successfully!
                </div>
              ) : (
                <form onSubmit={handleSubscribe} className="flex gap-2">
                  <input
                    type="email"
                    required
                    placeholder="Enter your email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="bg-brand-dark border border-gray-700 rounded-xl px-3.5 py-2.5 text-xs text-white placeholder-gray-500 focus:outline-none focus:border-brand-accent w-full"
                  />
                  <Button type="submit" variant="secondary" size="sm" pill={false} className="shrink-0 rounded-xl">
                    Subscribe
                  </Button>
                </form>
              )}
            </div>
          </div>

          {/* Column 2: Product Links */}
          <div>
            <h4 className="text-sm font-bold text-white uppercase tracking-wider mb-4">Product</h4>
            <ul className="space-y-2.5 text-xs text-gray-400">
              {nav.product.map((item) => (
                <li key={item.label}>
                  <Link href={item.href} className="hover:text-white transition-colors">{item.label}</Link>
                </li>
              ))}
            </ul>
          </div>

          {/* Column 3: Company Links */}
          <div>
            <h4 className="text-sm font-bold text-white uppercase tracking-wider mb-4">Company</h4>
            <ul className="space-y-2.5 text-xs text-gray-400">
              {nav.company.map((item) => (
                <li key={item.label}>
                  <Link href={item.href} className="hover:text-white transition-colors">{item.label}</Link>
                </li>
              ))}
            </ul>
          </div>

          {/* Column 4: Contact Info */}
          <div className="space-y-3">
            <h4 className="text-sm font-bold text-white uppercase tracking-wider mb-4">Contact Us</h4>

            <a href={contact.phone.href} className="flex items-start gap-3 text-xs text-gray-400 hover:text-white transition-colors group">
              <Phone size={16} className="text-brand-accent shrink-0 mt-0.5 group-hover:scale-110 transition-transform" />
              <span>{contact.phone.display}</span>
            </a>

            <a href={contact.email.href} className="flex items-start gap-3 text-xs text-gray-400 hover:text-white transition-colors group">
              <Mail size={16} className="text-brand-accent shrink-0 mt-0.5 group-hover:scale-110 transition-transform" />
              <span>{contact.email.display}</span>
            </a>

            <a href={contact.address.href} target="_blank" rel="noopener noreferrer" className="flex items-start gap-3 text-xs text-gray-400 hover:text-white transition-colors group">
              <MapPin size={16} className="text-brand-accent shrink-0 mt-0.5 group-hover:scale-110 transition-transform" />
              <span>{contact.address.display}</span>
            </a>

            {/* Social Media Icons */}
            <div className="pt-3 flex items-center gap-3">
              {social.map(({ label, href, icon: Icon }) => (
                <a
                  key={label}
                  href={href}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={`Taprevia on ${label}`}
                  className="w-8 h-8 rounded-xl bg-white/10 border border-white/10 flex items-center justify-center text-gray-400 hover:bg-brand-accent hover:text-white hover:border-brand-accent transition-all duration-200"
                >
                  <Icon size={15} />
                </a>
              ))}
            </div>
          </div>
        </div>

        {/* Bottom Copyright & Legal Links */}
        <div className="pt-8 flex flex-col md:flex-row items-center justify-between gap-4 text-xs text-gray-500">
          <p>{FOOTER_CONFIG.copyright}</p>
          <div className="flex items-center gap-6">
            {nav.legal.map((item, idx) => (
              <React.Fragment key={item.label}>
                {idx > 0 && <span className="text-gray-800">·</span>}
                <Link href={item.href} className="hover:text-gray-400 transition-colors">{item.label}</Link>
              </React.Fragment>
            ))}
          </div>
        </div>

      </div>
    </footer>
  );
};
