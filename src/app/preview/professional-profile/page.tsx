import type { Metadata } from 'next';
import { PublicVcardRenderer } from '@/components/public/template-registry';
import type { ICard, IProduct } from '@/types';

export const metadata: Metadata = {
  title: 'Professional Profile — Template Preview',
  robots: { index: false, follow: false },
};

/**
 * Generic, customer-agnostic sample data used ONLY to preview the
 * Professional Profile template at /preview/professional-profile.
 * It is never reachable from (and never used by) any real card alias,
 * account or product route. Names/numbers/links below are placeholders.
 */
const SAMPLE_CARD = {
  _id: 'preview-professional-profile',
  cardUid: 'PREVIEW000000000001',
  slug: 'preview-professional-profile',
  routeSlug: 'preview',
  assignedUserId: '',
  status: 'active',
  setupComplete: true,
  totalTaps: 0,
  userId: '',
  urlAlias: 'professional-profile-preview',
  name: 'Mehta Manufacturing',
  cardLabel: '',
  occupation: 'Turnkey Industrial Plants',
  descriptionHtml:
    '<p>End-to-end design, fabrication and commissioning of recycling and material-processing plants. Engineering industrial excellence since 2005.</p>',
  templateKey: 'professional-profile',
  kind: 'profile',
  redirectUrl: '',
  isActive: true,
  coverType: 'image',
  coverStyle: 'cover',
  coverValue:
    'https://images.unsplash.com/photo-1504328345606-18bbc8c9d7d1?w=1200&q=60',
  profileImageUrl:
    'https://images.unsplash.com/photo-1560179707-f14e90ef3623?w=200&q=60',
  galleryImages: [
    { imageUrl: 'https://images.unsplash.com/photo-1504328345606-18bbc8c9d7d1?w=600&q=60', caption: 'Plant floor' },
    { imageUrl: 'https://images.unsplash.com/photo-1537462715879-360eeb61a0ad?w=600&q=60', caption: 'Material handling' },
    { imageUrl: 'https://images.unsplash.com/photo-1581094288338-2314dddb7ece?w=600&q=60', caption: 'Fabrication' },
    { imageUrl: 'https://images.unsplash.com/photo-1530124566582-a618bc2615dc?w=600&q=60', caption: 'Control room' },
    { imageUrl: 'https://images.unsplash.com/photo-1581092918056-0c4c3acd3789?w=600&q=60', caption: 'Assembly line' },
    { imageUrl: 'https://images.unsplash.com/photo-1565043666747-69f6646db940?w=600&q=60', caption: 'Metal stock' },
  ],
  services: [
    { title: 'Aluminium Recycling Plant', description: '' },
    { title: 'Aluminium Extrusion Plant', description: '' },
    { title: 'Copper Recycling Plant', description: '' },
    { title: 'Dross Processing Plant', description: '' },
    { title: 'Scrap Sorting Line', description: '' },
    { title: 'Turnkey Plant Setup', description: '' },
  ],
  themeConfig: { accentColor: '#059669', bgColor: '#FFFFFF' },
  basic: {
    firstName: 'Mehta',
    lastName: 'Manufacturing',
    email: 'hello@mehtamfg.example',
    alternateEmail: '',
    phone: '+919830041223',
    alternatePhone: '+912674432100',
    company: 'Mehta Manufacturing',
    jobTitle: 'Managing Director',
    defaultLanguage: 'en',
  },
  location: {
    type: 'link',
    address: 'Pithampur Industrial Area, Indore',
    mapsUrl: 'https://maps.google.com/?q=Indore',
  },
  businessHours: [
    { day: 'monday', enabled: true, from: '09:00', to: '18:00' },
    { day: 'tuesday', enabled: true, from: '09:00', to: '18:00' },
    { day: 'wednesday', enabled: true, from: '09:00', to: '18:00' },
    { day: 'thursday', enabled: true, from: '09:00', to: '18:00' },
    { day: 'friday', enabled: true, from: '09:00', to: '18:00' },
    { day: 'saturday', enabled: true, from: '09:00', to: '14:00' },
    { day: 'sunday', enabled: false, from: '', to: '' },
  ],
  socialLinks: [
    { platform: 'instagram', url: 'https://instagram.com/mehtamfg' },
    { platform: 'linkedin', url: 'https://linkedin.com/company/mehtamfg' },
    { platform: 'facebook', url: 'https://facebook.com/mehtamfg' },
    { platform: 'website', url: 'https://www.mehtamfg.example' },
  ],
  banner: {
    title: '',
    url: '',
    description: '',
    ctaLabel: '',
    show: false,
  },
  privacyPolicyHtml: '',
  termsHtml: '',
  config: {
    displayLocalization: false,
    displayDownloadQrIcon: false,
    displayQrSection: false,
    displayAddToContact: true,
    hideStickyBar: false,
    displayWhatsAppShare: false,
    qrDownloadSize: 200,
  },
  sections: {
    header: true,
    contact: true,
    businessHours: false,
    map: false,
    banner: false,
    newsletterPopup: false,
  },
  stats: { taps: 0 },
  whatsappConfig: { phoneNumber: '+919830041223', defaultMessage: 'Hello!' },
  createdAt: new Date(),
  updatedAt: new Date(),
} as ICard;

const SAMPLE_PRODUCTS: IProduct[] = [
  {
    _id: 'preview-pp1',
    cardId: 'preview-professional-profile',
    userId: '',
    title: 'Aluminium Recycling Plant',
    description: '',
    priceMinor: 0,
    currency: 'INR',
    imageUrl: 'https://images.unsplash.com/photo-1504328345606-18bbc8c9d7d1?w=600&q=60',
    category: 'other',
    active: true,
    sortOrder: 1,
  },
  {
    _id: 'preview-pp2',
    cardId: 'preview-professional-profile',
    userId: '',
    title: 'Dross Processing & Recovery Systems',
    description: '',
    priceMinor: 0,
    currency: 'INR',
    imageUrl: 'https://images.unsplash.com/photo-1537462715879-360eeb61a0ad?w=600&q=60',
    category: 'other',
    active: true,
    sortOrder: 2,
  },
  {
    _id: 'preview-pp3',
    cardId: 'preview-professional-profile',
    userId: '',
    title: 'Scrap Charging & Sorting Line',
    description: '',
    priceMinor: 0,
    currency: 'INR',
    imageUrl: 'https://images.unsplash.com/photo-1565043666747-69f6646db940?w=600&q=60',
    category: 'other',
    active: true,
    sortOrder: 3,
  },
];

export default function ProfessionalProfilePreviewPage() {
  const themeVars = {
    '--v-bg': '#FFFFFF',
    '--v-surface': '#F8FAFC',
    '--v-text': '#111827',
    '--v-muted': '#4B5563',
    '--v-border': '#E5E7EB',
    '--v-accent': '#059669',
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