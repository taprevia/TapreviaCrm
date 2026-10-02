export type ProductCategory =
  | 'NFC Card'
  | 'Standee NFC'
  | 'Plate NFC'
  | 'Combo';

export interface Product {
  id: string;
  name: string;
  price: number;
  originalPrice?: number;
  rating: number;
  reviewsCount: number;
  category: ProductCategory;
  image: string;
  images: string[];
  badge?: 'NEW ARRIVAL' | 'BEST SELLER';
  tagline?: string;
  description?: string;
  highlights?: string[];
  features: string[];
}

export interface Testimonial {
  id: string;
  rating: number;
  quote: string;
  name: string;
  role: string;
  company: string;
  avatarInitials: string;
}

export interface FAQItem {
  id: string;
  question: string;
  answer: string;
  iconName?: string;
}

export interface FeatureItem {
  id: string;
  title: string;
  description: string;
  iconName: string;
}

export interface StatItem {
  label: string;
  value: string;
  caption?: string;
  iconName: string;
}
