import type { Metadata } from 'next';
import { PublicVcardRenderer } from '@/components/public/template-registry';
import type { ICard, IProduct } from '@/types';

export const metadata: Metadata = {
  title: 'Panthi Event — Template Preview',
  robots: { index: false, follow: false },
};

/**
 * Generic, customer-agnostic sample data used ONLY to preview the
 * Panthi Event template at /preview/panthi-event.
 * It is never reachable from (and never used by) any real card alias,
 * account or product route. Names/numbers/links below are placeholders.
 */
const SAMPLE_CARD = {
  _id: 'preview-panthi-event',
  cardUid: 'PREVIEW000000000000',
  slug: 'preview-panthi-event',
  routeSlug: 'preview',
  assignedUserId: '',
  status: 'active',
  setupComplete: true,
  totalTaps: 0,
  userId: '',
  urlAlias: 'jwellers-preview',
  name: 'Shree Krishna Jewellers',
  cardLabel: '',
  occupation: 'Jewellery Store',
  descriptionHtml:
    '<p>Fine gold, silver and diamond jewellery crafted for every celebration. Family-run for three generations.</p>',
  templateKey: 'panthi-event',
  kind: 'profile',
  redirectUrl: '',
  isActive: true,
  coverType: 'color',
  coverStyle: 'cover',
  coverValue: '#1F2937',
  profileImageUrl: '',
  galleryImages: [
    { imageUrl: 'https://images.unsplash.com/photo-1602173574767-37ac01994b2a?w=600&q=60', caption: 'Handcrafted gold' },
    { imageUrl: 'https://images.unsplash.com/photo-1599643478518-a784e5dc4c8f?w=600&q=60', caption: 'Bridal collection' },
    { imageUrl: 'https://images.unsplash.com/photo-1611652022419-a9419f74343d?w=600&q=60', caption: 'Diamond studs' },
    { imageUrl: 'https://images.unsplash.com/photo-1617038220319-276d3cfab638?w=600&q=60', caption: 'Kundan jewellery' },
  ],
  services: [
    { title: 'Custom Jewellery', description: 'Bespoke pieces designed to your taste.' },
    { title: 'Gold Exchange', description: 'Fair, transparent rates for your old gold.' },
    { title: 'Diamond Certification', description: 'Certified stones with lifetime buyback.' },
    { title: 'Repairs & Resizing', description: 'Quick, skilled finishing in-house.' },
  ],
  themeConfig: { accentColor: '#B45309', bgColor: '#FFFFFF' },
  basic: {
    firstName: 'Shree Krishna',
    lastName: 'Jewellers',
    email: 'hello@shreekrishnajewellers.example',
    alternateEmail: '',
    phone: '+919876543210',
    alternatePhone: '',
    company: 'Shree Krishna Jewellers',
    jobTitle: 'Jewellery Store',
    defaultLanguage: 'en',
  },
  location: {
    type: 'link',
    address: 'Shop 12, MG Road, Indore',
    mapsUrl: 'https://maps.google.com/?q=Indore',
  },
  businessHours: [
    { day: 'monday', enabled: true, from: '10:00', to: '20:00' },
    { day: 'tuesday', enabled: true, from: '10:00', to: '20:00' },
    { day: 'wednesday', enabled: true, from: '10:00', to: '20:00' },
    { day: 'thursday', enabled: true, from: '10:00', to: '20:00' },
    { day: 'friday', enabled: true, from: '10:00', to: '20:00' },
    { day: 'saturday', enabled: true, from: '10:00', to: '21:00' },
    { day: 'sunday', enabled: false, from: '', to: '' },
  ],
  socialLinks: [
    { platform: 'instagram', url: 'https://instagram.com/shreekrishnajewellers' },
    { platform: 'facebook', url: 'https://facebook.com/shreekrishnajewellers' },
  ],
  banner: {
    title: 'Festive Sale — Flat 12% off',
    description: 'On all gold coins this festive season.',
    url: 'https://shreekrishnajewellers.example',
    ctaLabel: 'Shop now',
    show: true,
  },
  privacyPolicyHtml: '',
  termsHtml: '',
  config: {
    displayLocalization: false,
    displayDownloadQrIcon: false,
    displayQrSection: true,
    displayAddToContact: true,
    hideStickyBar: false,
    displayWhatsAppShare: false,
    qrDownloadSize: 200,
  },
  sections: {
    header: true,
    contact: true,
    businessHours: true,
    map: true,
    banner: true,
    newsletterPopup: false,
  },
  stats: { taps: 0 },
  reviewAssistant: {
    enabled: true,
    googleReviewUrl: 'https://g.page/r/example-review',
    writingStyle: 'friendly',
    preferredLength: 'medium',
    languages: ['en'],
    feedbackTopics: [],
  },
  whatsappConfig: { phoneNumber: '+919876543210', defaultMessage: 'Hello!' },
  createdAt: new Date(),
  updatedAt: new Date(),
} as ICard;

const SAMPLE_PRODUCTS: IProduct[] = [
  {
    _id: 'preview-p1',
    cardId: 'preview-panthi-event',
    userId: '',
    title: '22K Gold Necklace',
    description: '',
    priceMinor: 1250000,
    currency: 'INR',
    imageUrl: 'https://images.unsplash.com/photo-1602173574767-37ac01994b2a?w=600&q=60',
    category: 'other',
    active: true,
    sortOrder: 1,
  },
  {
    _id: 'preview-p2',
    cardId: 'preview-panthi-event',
    userId: '',
    title: 'Diamond Headband',
    description: '',
    priceMinor: 950000,
    currency: 'INR',
    imageUrl: 'https://images.unsplash.com/photo-1599643478518-a784e5dc4c8f?w=600&q=60',
    category: 'other',
    active: true,
    sortOrder: 2,
  },
];

export default function PanthiEventPreviewPage() {
  const themeVars = {
    '--v-bg': '#FFFFFF',
    '--v-surface': '#F8FAFC',
    '--v-text': '#111827',
    '--v-muted': '#4B5563',
    '--v-border': '#E5E7EB',
    '--v-accent': '#B45309',
    '--v-on-accent': '#FFFFFF',
  } as React.CSSProperties;

  return (
    <div className="vcard-root min-h-screen" style={themeVars}>
      <div className="mx-auto w-full max-w-md">
        <PublicVcardRenderer
          vcard={SAMPLE_CARD}
          products={SAMPLE_PRODUCTS}
          newsletterDelaySeconds={0}
        />
      </div>
    </div>
  );
}