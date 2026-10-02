import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Cookie Policy',
  description:
    'How Taprevia uses cookies and similar technologies on its website.',
};

export default function CookiesPage() {
  return (
    <main className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-16 sm:py-20">
      <div className="mb-8 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
        Template copy — to be reviewed and finalised by legal counsel before launch.
      </div>
      <h1 className="text-3xl sm:text-4xl font-black text-brand-navy tracking-tight mb-4">
        Cookie Policy
      </h1>
      <p className="text-sm text-gray-500 mb-8">Last updated: [Date to be set at launch]</p>

      <div className="space-y-8 text-sm text-gray-700 leading-relaxed">
        <section>
          <h2 className="text-lg font-bold text-brand-navy mb-2">1. What Are Cookies</h2>
          <p>
            Cookies are small text files stored on your device when you visit a website. They help the
            website remember your preferences and understand how you interact with the site.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-bold text-brand-navy mb-2">2. How We Use Cookies</h2>
          <p>We may use cookies and similar technologies to:</p>
          <ul className="list-disc pl-6 space-y-2 mt-2">
            <li>Ensure the website functions correctly and securely.</li>
            <li>Remember your preferences and settings.</li>
            <li>Understand how visitors use the website to improve our content and user experience.</li>
            <li>Support analytics and, where applicable, advertising.</li>
          </ul>
        </section>

        <section>
          <h2 className="text-lg font-bold text-brand-navy mb-2">3. Types of Cookies</h2>
          <ul className="list-disc pl-6 space-y-2">
            <li>
              <strong>Strictly necessary cookies:</strong> required for the core functionality of the site.
            </li>
            <li>
              <strong>Analytics cookies:</strong> help us understand visitor behaviour (e.g. page views).
            </li>
            <li>
              <strong>Preference cookies:</strong> remember choices you make on the site.
            </li>
          </ul>
        </section>

        <section>
          <h2 className="text-lg font-bold text-brand-navy mb-2">4. Managing Cookies</h2>
          <p>
            You can control or delete cookies through your browser settings. Disabling cookies may affect the
            functionality of the website. Refer to your browser&rsquo;s help section for instructions.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-bold text-brand-navy mb-2">5. Contact Us</h2>
          <p>
            If you have any questions about our use of cookies, contact us at{' '}
            <a href="mailto:support@taprevia.com" className="text-brand-accent hover:underline">
              support@taprevia.com
            </a>.
          </p>
        </section>
      </div>
    </main>
  );
}
