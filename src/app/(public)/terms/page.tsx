import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Terms & Conditions',
  description:
    'Terms and Conditions governing the use of the Taprevia website and services.',
};

export default function TermsPage() {
  return (
    <main className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-16 sm:py-20">
      <div className="mb-8 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
        Template copy — to be reviewed and finalised by legal counsel before launch.
      </div>
      <h1 className="text-3xl sm:text-4xl font-black text-brand-navy tracking-tight mb-4">
        Terms &amp; Conditions
      </h1>
      <p className="text-sm text-gray-500 mb-8">Last updated: [Date to be set at launch]</p>

      <div className="space-y-8 text-sm text-gray-700 leading-relaxed">
        <section>
          <h2 className="text-lg font-bold text-brand-navy mb-2">1. Acceptance of Terms</h2>
          <p>
            By accessing or using the Taprevia website, you agree to be bound by these Terms &amp; Conditions.
            If you do not agree with any part of these terms, please do not use our website or services.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-bold text-brand-navy mb-2">2. Products and Ordering</h2>
          <p>
            All product descriptions, images, pricing, and availability are subject to change without notice.
            Order requests placed through the website or WhatsApp are an expression of interest and do not
            constitute a binding order until confirmed by Taprevia. While we strive to be accurate, we do not
            warrant that product descriptions or other content are error-free.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-bold text-brand-navy mb-2">3. Pricing and Payments</h2>
          <p>
            Prices are listed in Indian Rupees (INR) and include applicable taxes unless stated otherwise.
            We reserve the right to change prices at any time. Payment terms will be communicated at the time
            of confirming an order.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-bold text-brand-navy mb-2">4. Shipping and Delivery</h2>
          <p>
            Orders are dispatched within 24–48 hours. Delivery timelines are estimates and may vary based
            on your location and third-party logistics. Risk of loss passes to you upon delivery.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-bold text-brand-navy mb-2">5. Warranty and Returns</h2>
          <p>
            Our digital profiles are valid for the lifetime of the card. Warranty claims, if any, are
            governed by the specific product terms and do not cover misuse, accidental damage, or
            unauthorised modifications. Return and exchange policies, if any, will be communicated at the
            time of purchase.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-bold text-brand-navy mb-2">6. Limitation of Liability</h2>
          <p>
            To the maximum extent permitted by law, Taprevia shall not be liable for any indirect, incidental,
            special, or consequential damages arising out of or in connection with your use of the website or
            products.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-bold text-brand-navy mb-2">7. Governing Law</h2>
          <p>
            These Terms shall be governed by and construed in accordance with the laws of India. Any disputes
            shall be subject to the exclusive jurisdiction of the courts at Ahmedabad, Gujarat.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-bold text-brand-navy mb-2">8. Contact Us</h2>
          <p>
            For questions about these Terms, contact us at{' '}
            <a href="mailto:support@taprevia.com" className="text-brand-accent hover:underline">
              support@taprevia.com
            </a>.
          </p>
        </section>
      </div>
    </main>
  );
}
