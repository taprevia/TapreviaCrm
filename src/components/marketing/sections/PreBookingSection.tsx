'use client';

import React, { useState } from 'react';
import { MessageCircle, CheckCircle2, Users, Zap, Star, AlertCircle } from 'lucide-react';
import { getWhatsAppUrl } from '@/lib/marketing/whatsapp';

const PRODUCTS_LIST = [
  'NFC Business Card (Black)',
  'NFC Business Card (White)',
  'LinkedIn Social Card',
  'Google Review Standee',
  'Instagram Profile Card',
  'Bulk / Team Order (10+ cards)',
  'Not sure yet — need advice',
];

interface FormState {
  name: string;
  phone: string;
  product: string;
  city: string;
}

interface FormErrors {
  name?: string;
  phone?: string;
}

const CUSTOMER_COUNT = 47;

// ── Validation rules ────────────────────────────────────────────────────────
function validate(form: FormState): FormErrors {
  const errors: FormErrors = {};

  if (!form.name.trim()) {
    errors.name = 'Full name is required.';
  } else if (form.name.trim().length < 2) {
    errors.name = 'Name must be at least 2 characters.';
  }

  const rawPhone = form.phone.replace(/\s+/g, '');
  if (!rawPhone) {
    errors.phone = 'WhatsApp / phone number is required.';
  } else if (!/^[6-9]\d{9}$/.test(rawPhone)) {
    errors.phone = 'Enter a valid 10-digit Indian mobile number (starts with 6–9).';
  }

  return errors;
}

// ── Reusable inline field error ───────────────────────────────────────────────
const FieldError: React.FC<{ message?: string }> = ({ message }) =>
  message ? (
    <p className="flex items-center gap-1.5 text-[11px] text-red-400 font-semibold mt-1.5">
      <AlertCircle size={12} className="shrink-0" />
      {message}
    </p>
  ) : null;

// ── Border helper ─────────────────────────────────────────────────────────────
const fieldClass = (hasError: boolean) =>
  `w-full bg-brand-navy border rounded-xl px-4 py-3 text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-1 transition-all ${
    hasError
      ? 'border-red-500/70 focus:border-red-500 focus:ring-red-500/30'
      : 'border-white/15 focus:border-brand-accent focus:ring-brand-accent/40'
  }`;

export const PreBookingSection: React.FC = () => {
  const [form, setForm] = useState<FormState>({ name: '', phone: '', product: '', city: '' });
  const [touched, setTouched] = useState<Partial<Record<keyof FormState, boolean>>>({});
  const [submitted, setSubmitted] = useState(false);
  const [submitAttempted, setSubmitAttempted] = useState(false);

  // Errors recomputed every render — always fresh
  const errors = validate(form);

  // Show a field's error only if user blurred it OR tried to submit
  const showError = (field: keyof FormState) =>
    (touched[field] || submitAttempted) && !!errors[field as keyof FormErrors];

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }));
  };

  const handleBlur = (e: React.FocusEvent<HTMLInputElement | HTMLSelectElement>) => {
    setTouched((prev) => ({ ...prev, [e.target.name]: true }));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitAttempted(true);
    setTouched({ name: true, phone: true }); // reveal all required errors

    if (Object.keys(errors).length > 0) return; // block submit

    const message =
      `\uD83C\uDF89 *Taprevia Order Request*\n\n` +
      `\uD83D\uDC64 *Name:* ${form.name}\n` +
      `\uD83D\uDCF1 *Phone:* ${form.phone}\n` +
      `\uD83C\uDFD9\uFE0F *City:* ${form.city || 'Not specified'}\n` +
      `\uD83C\uDFAF *Interested In:* ${form.product || 'Not specified'}\n\n` +
      `I'd like to order a Taprevia NFC card! \uD83D\uDE80`;

    const url = getWhatsAppUrl({ customMessage: message });
    window.open(url, '_blank', 'noopener,noreferrer');
    setSubmitted(true);
  };

  const resetForm = () => {
    setSubmitted(false);
    setSubmitAttempted(false);
    setTouched({});
    setForm({ name: '', phone: '', product: '', city: '' });
  };

  return (
    <section id="order" className="py-20 bg-brand-navy relative overflow-hidden">

      {/* Background decorative blobs */}
      <div className="absolute top-0 left-1/4 w-96 h-96 bg-brand-accent/10 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute bottom-0 right-1/4 w-96 h-96 bg-blue-500/8 rounded-full blur-3xl pointer-events-none" />

      <div className="relative z-10 max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-14 items-center">

          {/* ── Left: Sales Copy ── */}
          <div className="space-y-8">
            <span className="inline-flex items-center gap-2 bg-brand-accent/15 text-brand-accent border border-brand-accent/30 px-4 py-2 rounded-full text-xs font-extrabold uppercase tracking-widest">
              <Zap size={13} className="fill-brand-accent" />
              Order on WhatsApp — Dispatched in 24–48 hrs
            </span>

            <div>
              <h2 className="text-3xl sm:text-4xl lg:text-5xl font-black text-white tracking-tight leading-tight">
                Tap into{' '}
                <span className="bg-gradient-to-r from-brand-accent via-blue-400 to-teal-400 bg-clip-text text-transparent">
                  smarter networking.
                </span>
              </h2>
              <p className="mt-4 text-base sm:text-lg text-gray-300 leading-relaxed font-normal">
                Taprevia is live and shipping across India. Order today — every card is
                dispatched within <span className="text-white font-bold">24–48 hours</span> and
                backed by lifetime digital validity.
              </p>
            </div>

            <ul className="space-y-3">
              {[
                'Dispatched within 24–48 hours',
                'Free custom design consultation',
                'Direct WhatsApp support from our team',
              ].map((perk) => (
                <li key={perk} className="flex items-center gap-3 text-sm text-gray-200 font-medium">
                  <CheckCircle2 size={18} className="text-brand-accent shrink-0" />
                  {perk}
                </li>
              ))}
            </ul>

            <div className="flex items-center gap-4 pt-2">
              <div className="flex -space-x-2">
                {['#3B82F6', '#10B981', '#F59E0B', '#EF4444'].map((color, i) => (
                  <div
                    key={i}
                    className="w-9 h-9 rounded-full border-2 border-brand-navy flex items-center justify-center text-white text-xs font-bold"
                    style={{ background: color }}
                  >
                    <Users size={14} />
                  </div>
                ))}
              </div>
              <p className="text-sm text-gray-300 font-medium">
                <span className="text-white font-extrabold">{CUSTOMER_COUNT}+ people</span> have already ordered
              </p>
              <div className="flex items-center gap-0.5">
                {[...Array(5)].map((_, i) => (
                  <Star key={i} size={13} className="fill-amber-400 text-amber-400" />
                ))}
              </div>
            </div>
          </div>

          {/* ── Right: Order Form ── */}
          <div className="bg-white/5 backdrop-blur-sm border border-white/10 rounded-3xl p-5 sm:p-10 shadow-2xl">
            {submitted ? (
              <div className="flex flex-col items-center justify-center text-center py-8 gap-5">
                <div className="w-20 h-20 rounded-full bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center">
                  <CheckCircle2 size={40} className="text-emerald-400" />
                </div>
                <div>
                  <h3 className="text-2xl font-extrabold text-white mb-2">We&apos;ve got your details! 🎉</h3>
                  <p className="text-gray-300 text-sm leading-relaxed">
                    We&apos;ve opened WhatsApp so our team can confirm your order with you personally.
                  </p>
                </div>
                <button
                  onClick={resetForm}
                  className="text-xs text-gray-400 hover:text-white underline underline-offset-2 transition-colors mt-2"
                >
                  Submit another order
                </button>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-5" noValidate>
                <div>
                  <h3 className="text-xl font-extrabold text-white mb-1">Order Your Card</h3>
                  <p className="text-xs text-gray-400">Fill in your details — we&apos;ll confirm via WhatsApp.</p>
                </div>

                {/* ── Name ── */}
                <div>
                  <label htmlFor="prebook-name" className="block text-xs font-bold text-gray-300 mb-1.5 uppercase tracking-wider">
                    Full Name <span className="text-red-400">*</span>
                  </label>
                  <input
                    id="prebook-name"
                    type="text"
                    name="name"
                    value={form.name}
                    onChange={handleChange}
                    onBlur={handleBlur}
                    placeholder="e.g. Arjun Sharma"
                    autoComplete="name"
                    className={`${fieldClass(showError('name'))} appearance-none cursor-pointer`}
                  />
                  <FieldError message={showError('name') ? errors.name : undefined} />
                </div>

                {/* ── Phone ── */}
                <div>
                  <label htmlFor="prebook-phone" className="block text-xs font-bold text-gray-300 mb-1.5 uppercase tracking-wider">
                    WhatsApp / Phone Number <span className="text-red-400">*</span>
                  </label>
                  <div className="relative">
                    <span className="absolute left-4 top-1/2 -translate-y-1/2 text-sm text-gray-400 font-bold select-none">+91</span>
                    <input
                      id="prebook-phone"
                      type="tel"
                      name="phone"
                      value={form.phone}
                      onChange={handleChange}
                      onBlur={handleBlur}
                      placeholder="98765 43210"
                      autoComplete="tel"
                      maxLength={11}
                      className={`${fieldClass(showError('phone'))} pl-12 appearance-none cursor-pointer`}
                    />
                  </div>
                  <FieldError message={showError('phone') ? errors.phone : undefined} />
                </div>

                {/* ── Product interest ── */}
                <div>
                  <label htmlFor="prebook-product" className="block text-xs font-bold text-gray-300 mb-1.5 uppercase tracking-wider">
                    Interested In
                  </label>
                  <select
                    id="prebook-product"
                    name="product"
                    value={form.product}
                    onChange={handleChange}
                    onBlur={handleBlur}
                    className="w-full bg-brand-navy border border-white/15 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-brand-accent focus:ring-1 focus:ring-brand-accent/40 transition-all appearance-none cursor-pointer"
                  >
                    <option value="" disabled>Select a product…</option>
                    {PRODUCTS_LIST.map((p) => (
                      <option key={p} value={p}>{p}</option>
                    ))}
                  </select>
                </div>

                {/* ── City ── */}
                <div>
                  <label htmlFor="prebook-city" className="block text-xs font-bold text-gray-300 mb-1.5 uppercase tracking-wider">
                    City
                  </label>
                  <input
                    id="prebook-city"
                    type="text"
                    name="city"
                    value={form.city}
                    onChange={handleChange}
                    onBlur={handleBlur}
                    placeholder="e.g. Mumbai, Surat, Delhi…"
                    autoComplete="address-level2"
                    className="w-full bg-brand-navy border border-white/15 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-brand-accent focus:ring-1 focus:ring-brand-accent/40 transition-all appearance-none cursor-pointer"
                  />
                </div>

                {/* ── Summary banner — shown only after a failed submit attempt ── */}
                {submitAttempted && Object.keys(errors).length > 0 && (
                  <div className="flex items-start gap-2.5 bg-red-500/10 border border-red-500/25 rounded-xl px-4 py-3">
                    <AlertCircle size={15} className="text-red-400 shrink-0 mt-0.5" />
                    <p className="text-xs text-red-400 font-semibold leading-relaxed">
                      Please fix the highlighted fields above before continuing.
                    </p>
                  </div>
                )}

                {/* ── Submit ── */}
                <button
                  type="submit"
                  className="w-full flex items-center justify-center gap-2 bg-brand-accent hover:bg-blue-600 text-white font-extrabold text-sm py-4 rounded-xl transition-all duration-200 shadow-lg hover:shadow-brand-accent/30 hover:scale-[1.01] active:scale-[0.99] cursor-pointer"
                >
                  <MessageCircle size={17} />
                  Order via WhatsApp — It&apos;s Free
                </button>

                <p className="text-[11px] text-center text-gray-500">
                  No payment now · We confirm your order personally via WhatsApp
                </p>
              </form>
            )}
          </div>

        </div>
      </div>
    </section>
  );
};
