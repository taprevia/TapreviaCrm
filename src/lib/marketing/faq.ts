import { FAQItem } from '@/types/marketing';

export const FAQ_ITEMS: FAQItem[] = [
  {
    id: 'faq-1',
    question: 'Do NFC cards work on all phones?',
    answer: 'Yes! Taprevia NFC cards work with almost all modern smartphones (iPhone 7 and newer, and 95%+ of Android phones). For older phones without NFC enabled, a custom QR code on the back of the card serves as an instant fallback.',
    iconName: 'Smartphone'
  },
  {
    id: 'faq-2',
    question: 'Do users need to install any app?',
    answer: 'No app is required! When someone taps your Taprevia card or scans the QR code, your interactive digital profile opens instantly in their browser.',
    iconName: 'AppWindow'
  },
  {
    id: 'faq-3',
    question: 'Can I update my details later?',
    answer: 'Absolutely! You can update your contact info, social links, payment QR code, and design catalog anytime via your Taprevia cloud dashboard in real-time — without needing a new card.',
    iconName: 'RefreshCw'
  },
  {
    id: 'faq-4',
    question: 'How long does delivery take?',
    answer: 'Standard orders are dispatched within 24-48 hours and typically arrive within 3-5 business days depending on your location.',
    iconName: 'Truck'
  },
  {
    id: 'faq-5',
    question: 'Can I order for my team or company?',
    answer: 'Yes! We offer corporate bulk discounts (up to 20% off), custom logo branding, bulk team profile management, and dedicated enterprise account managers.',
    iconName: 'Users'
  }
];
