'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { Menu, X, ShoppingBag } from 'lucide-react';
import { Button } from '@/components/marketing/ui/Button';

export const Header: React.FC = () => {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const navLinks = [
    { label: 'Products', href: '#products' },
    { label: 'For Teams', href: '#for-teams' },
    { label: 'How it works', href: '#how-it-works' },
    { label: 'FAQ', href: '#faq' },
  ];

  return (
    <header className="sticky top-0 z-40 w-full px-4 pt-3 pb-1">
      <div className="max-w-6xl mx-auto bg-white/95 backdrop-blur-md border border-gray-100 rounded-full px-6 py-3 shadow-brandCard flex items-center justify-between transition-all duration-300">
        
        {/* Brand Logo */}
        <Link href="/" className="flex items-center group">
          <Image
            src="/images/logo.png"
            alt="Taprevia"
            width={140}
            height={48}
            className="h-10 w-auto object-contain transition-opacity group-hover:opacity-85"
            priority
          />
        </Link>

        {/* Desktop Navigation Links */}
        <nav className="hidden md:flex items-center gap-7">
          {navLinks.map((link) => (
            <Link
              key={link.label}
              href={link.href}
              className="text-sm font-medium text-gray-700 hover:text-brand-navy transition-colors"
            >
              {link.label}
            </Link>
          ))}
        </nav>

        {/* Right Actions */}
        <div className="hidden md:flex items-center gap-4">
          <Link
            href="/login"
            className="text-sm font-semibold text-gray-600 hover:text-brand-navy transition-colors"
          >
            Login
          </Link>

          <a href="#order">
            <Button variant="primary" size="sm" pill className="gap-2 bg-brand-accent hover:bg-blue-700 border-none text-white font-bold">
              <ShoppingBag size={15} /> Order Now
            </Button>
          </a>
        </div>

        {/* Mobile Hamburger Toggle */}
        <button
          onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
          className="md:hidden p-2 text-brand-navy focus:outline-none"
          aria-label="Toggle Navigation Menu"
        >
          {mobileMenuOpen ? <X size={24} /> : <Menu size={24} />}
        </button>
      </div>

      {/* Mobile Dropdown Menu */}
      {mobileMenuOpen && (
        <div className="md:hidden max-w-6xl mx-auto mt-2 bg-white rounded-3xl p-6 border border-gray-100 shadow-xl flex flex-col gap-4 animate-in fade-in slide-in-from-top-2 duration-200">
          <nav className="flex flex-col gap-3">
            {navLinks.map((link) => (
              <Link
                key={link.label}
                href={link.href}
                onClick={() => setMobileMenuOpen(false)}
                className="text-base font-semibold text-gray-800 hover:text-brand-navy py-2 border-b border-gray-100"
              >
                {link.label}
              </Link>
            ))}
          </nav>

          <div className="pt-2 flex flex-col gap-3">
            <Link
              href="/login"
              onClick={() => setMobileMenuOpen(false)}
            >
              <Button variant="outline" size="md" pill className="w-full gap-2 border border-gray-200 text-brand-navy font-bold bg-white">
                Login
              </Button>
            </Link>

            <a
              href="#order"
              onClick={() => setMobileMenuOpen(false)}
            >
              <Button variant="primary" size="md" pill className="w-full gap-2 bg-brand-accent hover:bg-blue-700 border-none text-white font-bold">
                <ShoppingBag size={18} /> Order Now
              </Button>
            </a>
          </div>
        </div>
      )}
    </header>
  );
};
