import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Privacy Policy',
  description:
    'Privacy Policy for Taprevia — how we collect, use, and protect your information.',
};

export default function PrivacyPage() {
  return (
    <main className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-16 sm:py-20">
      <div className="mb-8 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
        Template copy — to be reviewed and finalised by legal counsel before launch.
      </div>
      <h1 className="text-3xl sm:text-4xl font-black text-brand-navy tracking-tight mb-4">
        Privacy Policy
      </h1>
      <p className="text-sm text-gray-500 mb-8">Last updated: [Date to be set at launch]</p>

      <div className="space-y-8 text-sm text-gray-700 leading-relaxed">
        <section>
          <h2 className="text-lg font-bold text-brand-navy mb-2">1. Introduction</h2>
          <p>
            Taprevia (&ldquo;we&rdquo;, &ldquo;us&rdquo;, or &ldquo;our&rdquo;) operates the website at{' '}
            <a href="https://taprevia.com" className="text-brand-accent hover:underline">https://taprevia.com</a>.
            This Privacy Policy explains how we collect, use, disclose, and safeguard your information when you
            visit our website or use our services. Please read this policy carefully.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-bold text-brand-navy mb-2">2. Information We Collect</h2>
          <p>We may collect the following types of information:</p>
          <ul className="list-disc pl-6 space-y-2 mt-2">
            <li>Contact information you provide, such as your name, email address, and phone number.</li>
            <li>Pre-booking and order details when you express interest in our products.</li>
            <li>Usage data such as pages visited, time spent, and device/browser information.</li>
          </ul>
        </section>

        <section>
          <h2 className="text-lg font-bold text-brand-navy mb-2">3. How We Use Your Information</h2>
          <p>We use the information we collect to:</p>
          <ul className="list-disc pl-6 space-y-2 mt-2">
            <li>Process your pre-bookings, orders, and requests.</li>
            <li>Communicate with you about products, updates, and offers.</li>
            <li>Improve our website, products, and customer experience.</li>
            <li>Comply with applicable legal and regulatory obligations.</li>
          </ul>
        </section>

        <section>
          <h2 className="text-lg font-bold text-brand-navy mb-2">4. Sharing of Information</h2>
          <p>
            We do not sell your personal information. We may share information with trusted service providers
            who assist us in operating our website and delivering our products (such as payment processors,
            delivery partners, and email providers), subject to appropriate confidentiality obligations, and
            when required by law.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-bold text-brand-navy mb-2">5. Data Security</h2>
          <p>
            We implement reasonable technical and organisational measures to protect your personal information.
            However, no method of transmission over the internet is completely secure, and we cannot guarantee
            absolute security.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-bold text-brand-navy mb-2">6. Your Rights</h2>
          <p>
            Subject to applicable law, you may have the right to access, correct, or delete your personal
            information, and to object to or restrict certain processing. To exercise these rights, contact us
            at{' '}
            <a href="mailto:support@taprevia.com" className="text-brand-accent hover:underline">
              support@taprevia.com
            </a>.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-bold text-brand-navy mb-2">7. Contact Us</h2>
          <p>
            If you have any questions about this Privacy Policy, please contact us at{' '}
            <a href="mailto:support@taprevia.com" className="text-brand-accent hover:underline">
              support@taprevia.com
            </a>{' '}
            or by writing to Taprevia, Keshavpriya Homes, Nikol, Ahmedabad, Gujarat, India.
          </p>
        </section>
      </div>
    </main>
  );
}
