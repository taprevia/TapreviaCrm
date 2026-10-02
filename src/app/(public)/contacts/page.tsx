"use client";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { brandLabelFromUrl } from "@/utils/get-link-icon";
import { getBrandIcon } from "@/utils/getBrandIcon";
import { buildVcf } from "@/lib/vcf";
import { downloadVcfBlob } from "@/lib/vcf-download";
import type { ICard } from "@/types";

interface ProductItem {
  title: string;
  desc: string | null;
  imageUrl: string;
}

interface SocialItem {
  network: string;
  url: string;
}

interface CardData {
  name: string;
  tagline: string;
  phoneDisplay: string;
  phoneRaw: string;
  email: string;
  website: string;
  cardUrl: string;
  bio: string | null;
  avatarUrl: string;
  heroUrl: string;
  socials: SocialItem[];
  products: ProductItem[];
  services: string[];
  gallery: string[];
}

// =====================================================================
// EDIT THIS SECTION — CARD_DATA
// Single source of truth for the Taprevia profile.
// Data sourced from https://taprevia.com/
// TODO(client): re-host avatar/hero/product/gallery images on your own
// CDN and swap the URLs below before launch.
// =====================================================================
const CARD_DATA: CardData = {
  name: "TAPREVIA",
  tagline: "ONE TAP DIGITAL BUSINESS CARDS",
  phoneDisplay: "+91 99 74 99 2213",
  phoneRaw: "919974992213",
  email: "support@taprevia.com",
  website: "https://taprevia.com/",
  cardUrl: "https://taprevia.com/",
  bio: "Premium NFC business cards engineered for entrepreneurs, sales teams and enterprises. Share contacts, capture leads and project a brand that earns trust on first impression.",
  // TODO(client): swap with actual Taprevia logo/avatar image URL
  avatarUrl:
    "https://res.cloudinary.com/dju7dmfib/image/upload/v1779963658/nfc-profiles/aca46f59-805d-44c6-b12c-c38e84b6f028/avatar_url/bxxkfzcjjchjhcgu995l.jpg",
  // TODO(client): swap with actual Taprevia hero/banner image URL
  heroUrl:
    "https://res.cloudinary.com/dju7dmfib/image/upload/v1779963674/nfc-profiles/aca46f59-805d-44c6-b12c-c38e84b6f028/hero_bg_url/a8khsmpoobyxwf1nw6ch.jpg",
  socials: [
    { network: "instagram", url: "https://instagram.com/taprevia" },
    { network: "facebook", url: "https://facebook.com/taprevia" },
    { network: "linkedin", url: "https://linkedin.com/company/taprevia" },
    { network: "twitter", url: "https://x.com/taprevia" },
    { network: "youtube", url: "https://youtube.com/@taprevia" },
    { network: "pinterest", url: "https://pinterest.com/taprevia" },
    { network: "website", url: "https://taprevia.com/" },
  ],
  products: [
    {
      title: "NFC Business Card (Black)",
      desc: "Premium black NFC card — tap to share contacts, socials & payment QR",
      imageUrl:
        "https://taprevia.com/images/product-nfc-black.svg",
    },
    {
      title: "NFC Business Card (White)",
      desc: "Premium white NFC card — tap to share contacts, socials & payment QR",
      imageUrl:
        "https://taprevia.com/images/product-nfc-black.svg",
    },
    {
      title: "LinkedIn Social Card",
      desc: "Grow your LinkedIn network with one tap",
      imageUrl:
        "https://taprevia.com/images/product-linkedin.svg",
    },
    {
      title: "Google Review Standy",
      desc: "Standee that lets customers leave a Google review instantly",
      imageUrl:
        "https://taprevia.com/images/product-google-standy.svg",
    },
    {
      title: "Instagram Profile Card",
      desc: "Gain followers with one tap — direct to your Instagram profile",
      imageUrl:
        "https://taprevia.com/images/product-insta.svg",
    },
    {
      title: "Customised Standy",
      desc: "Fully customised standee with your branding — ₹1299",
      imageUrl:
        "https://taprevia.com/images/product-custom-standy.svg",
    },
    {
      title: "Profile Card",
      desc: "All-in-one digital profile card — share everything in one tap",
      imageUrl:
        "https://taprevia.com/images/product-profile-card.svg",
    },
  ],
  services: [
    "NFC Business Cards",
    "Digital Standees",
    "Customised Standy",
    "Bulk / Team Orders",
    "Google Review Cards",
    "Instagram Profile Cards",
    "LinkedIn Social Cards",
  ],
  // TODO(client): swap with actual Taprevia product photos / lifestyle shots
  gallery: [
    "https://taprevia.com/images/product-nfc-black.svg",
    "https://taprevia.com/images/product-linkedin.svg",
    "https://taprevia.com/images/product-google-standy.svg",
    "https://taprevia.com/images/product-insta.svg",
    "https://taprevia.com/images/product-custom-standy.svg",
    "https://taprevia.com/images/product-profile-card.svg",
  ],
};
// =====================================================================
// END OF EDITABLE SECTION
// =====================================================================

interface TapreviaProps {
  onSubmit?: (payload: Record<string, string>) => void | Promise<void>;
}

type OverlayKind = "closed" | "open" | "closing";

const WA_NUMBER = CARD_DATA.phoneRaw;
// TODO(client): replace with actual Google Place ID before launch
const GOOGLE_REVIEW_URL = "https://g.page/r/REPLACE_WITH_PLACE_ID/review";

const buildWaLink = (message: string): string =>
  `https://wa.me/${WA_NUMBER}?text=${encodeURIComponent(message)}`;

const WA_PRODUCT_MSG = (title: string): string =>
  `Hello ${CARD_DATA.name}! I'd like to enquire about your "${title}" package.`;

const WA_SERVICE_MSG = (service: string): string =>
  `Hello ${CARD_DATA.name}! I'm interested in ${service}. Please share details.`;

const WA_BAR_MSG = `Hello ${CARD_DATA.name}! I found your digital card and would like to connect.`;

// The marketing page has no CRM card behind it, so `CARD_DATA` is adapted into
// the minimal ICard shape the canonical builder needs. Sharing `buildVcf()`
// keeps this page's .vcf byte-identical in structure to every real card, which
// is what makes it importable on iOS and Android.
const VCF_SITE_ORIGIN = "https://taprevia.com";

const VCF_CARD = {
  _id: "taprevia-marketing",
  cardUid: "taprevia-marketing",
  name: CARD_DATA.name,
  occupation: "",
  urlAlias: "taprevia",
  profileImageUrl: CARD_DATA.avatarUrl,
  basic: {
    firstName: CARD_DATA.name,
    lastName: "",
    email: CARD_DATA.email,
    alternateEmail: "",
    phone: CARD_DATA.phoneDisplay,
    alternatePhone: "",
    company: "Taprevia",
    jobTitle: CARD_DATA.tagline,
    defaultLanguage: "en",
  },
  location: { type: "link", address: "", mapsUrl: "" },
  socialLinks: CARD_DATA.socials.map((social) => ({
    platform: social.network,
    url: social.url,
  })),
} as unknown as ICard;

const downloadVCard = (): void => {
  downloadVcfBlob(buildVcf(VCF_CARD, VCF_SITE_ORIGIN), "taprevia.vcf");
};

const FALLBACK_AVATAR = `data:image/svg+xml,${encodeURIComponent(
  "<svg xmlns='http://www.w3.org/2000/svg' width='224' height='224' viewBox='0 0 224 224'><defs><linearGradient id='g' x1='0' y1='0' x2='1' y2='1'><stop offset='0' stop-color='#3B5BFF'/><stop offset='1' stop-color='#151E3D'/></linearGradient></defs><rect width='224' height='224' fill='url(#g)'/><text x='50%25' y='54%25' dominant-baseline='middle' text-anchor='middle' fill='white' font-size='28' font-weight='bold' font-family='Arial,sans-serif'>T</text></svg>",
)}`;

const FALLBACK_MEDIA = `data:image/svg+xml,${encodeURIComponent(
  "<svg xmlns='http://www.w3.org/2000/svg' width='600' height='450' viewBox='0 0 600 450'><defs><linearGradient id='g' x1='0' y1='0' x2='1' y2='1'><stop offset='0' stop-color='#3B5BFF'/><stop offset='1' stop-color='#151E3D'/></linearGradient></defs><rect width='600' height='450' fill='url(#g)'/><text x='300' y='235' text-anchor='middle' font-family='Arial,sans-serif' font-weight='bold' letter-spacing='6' font-size='32' fill='white' fill-opacity='.9'>TAPREVIA</text><text x='300' y='275' text-anchor='middle' font-family='Arial,sans-serif' font-size='14' fill='white' fill-opacity='.6'>NFC Business Cards</text></svg>",
)}`;

const handleImgError = (event: React.SyntheticEvent<HTMLImageElement>): void => {
  const image = event.currentTarget;
  if (image.dataset.pep2fb === "1") return;
  image.dataset.pep2fb = "1";
  image.src =
    image.className.indexOf("tv2-avatar") !== -1 ? FALLBACK_AVATAR : FALLBACK_MEDIA;
};

type TapIconName =
  | "share"
  | "user-plus"
  | "exchange"
  | "close"
  | "phone"
  | "chat"
  | "check"
  | "chevron-left"
  | "chevron-right"
  | "chevron-down"
  | "globe"
  | "mail"
  | "package"
  | "wrench"
  | "images"
  | "clipboard"
  | "heart"
  | "briefcase"
  | "sparkles"
  | "megaphone"
  | "cake"
  | "gem"
  | "star"
  | "instagram"
  | "facebook"
  | "linkedin"
  | "twitter"
  | "youtube"
  | "pinterest";

const ICON_PATHS: Record<TapIconName, React.ReactNode> = {
  share: (
    <>
      <circle cx="18" cy="5" r="3" />
      <circle cx="6" cy="12" r="3" />
      <circle cx="18" cy="19" r="3" />
      <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
      <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
    </>
  ),
  "user-plus": (
    <>
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <line x1="19" y1="8" x2="19" y2="14" />
      <line x1="22" y1="11" x2="16" y2="11" />
    </>
  ),
  exchange: (
    <>
      <path d="M8 3 4 7l4 4" />
      <path d="M4 7h16" />
      <path d="m16 21 4-4-4-4" />
      <path d="M20 17H4" />
    </>
  ),
  close: (
    <>
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </>
  ),
  phone: (
    <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
  ),
  chat: (
    <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
  ),
  check: <polyline points="20 6 9 17 4 12" />,
  "chevron-left": <polyline points="15 18 9 12 15 6" />,
  "chevron-right": <polyline points="9 18 15 12 9 6" />,
  "chevron-down": <polyline points="6 9 12 15 18 9" />,
  globe: (
    <>
      <circle cx="12" cy="12" r="10" />
      <line x1="2" y1="12" x2="22" y2="12" />
      <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
    </>
  ),
  mail: (
    <>
      <rect x="2" y="4" width="20" height="16" rx="2" />
      <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
    </>
  ),
  package: (
    <>
      <line x1="16.5" y1="9.4" x2="7.5" y2="4.21" />
      <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
      <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
      <line x1="12" y1="22.08" x2="12" y2="12" />
    </>
  ),
  wrench: (
    <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
  ),
  images: (
    <>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <circle cx="9" cy="9" r="2" />
      <path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" />
    </>
  ),
  clipboard: (
    <>
      <rect x="8" y="2" width="8" height="4" rx="1" ry="1" />
      <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
      <path d="M12 11h4" />
      <path d="M12 16h4" />
      <path d="M8 11h.01" />
      <path d="M8 16h.01" />
    </>
  ),
  heart: (
    <path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z" />
  ),
  briefcase: (
    <>
      <rect x="2" y="7" width="20" height="14" rx="2" ry="2" />
      <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" />
    </>
  ),
  sparkles: (
    <>
      <path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3L12 3Z" />
      <path d="M5 3v4" />
      <path d="M19 17v4" />
      <path d="M3 5h4" />
      <path d="M17 19h4" />
    </>
  ),
  megaphone: (
    <>
      <path d="m3 11 18-5v12L3 14v-3z" />
      <path d="M11.6 16.8a3 3 0 1 1-5.8-1.6" />
    </>
  ),
  cake: (
    <>
      <path d="M20 21v-8a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8" />
      <path d="M4 16c.9.9 1.8.9 2.7 0 .9-.9 1.8-.9 2.7 0 .9.9 1.8.9 2.7 0 .9-.9 1.8-.9 2.7 0 .9.9 1.8.9 2.7 0" />
      <path d="M12 9V5" />
      <path d="M8 9V7" />
      <path d="M16 9V7" />
      <path d="M2 21h20" />
    </>
  ),
  gem: (
    <>
      <path d="M6 3h12l4 6-10 13L2 9Z" />
      <path d="M11 3 8 9l4 13 4-13-3-6" />
      <path d="M2 9h20" />
    </>
  ),
  star: (
    <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
  ),
  instagram: (
    <>
      <rect x="2" y="2" width="20" height="20" rx="5" ry="5" />
      <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z" />
      <line x1="17.5" y1="6.5" x2="17.51" y2="6.5" />
    </>
  ),
  facebook: (
    <path
      fill="currentColor"
      stroke="none"
      d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"
    />
  ),
  linkedin: (
    <path
      fill="currentColor"
      stroke="none"
      d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"
    />
  ),
  twitter: (
    <path
      fill="currentColor"
      stroke="none"
      d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"
    />
  ),
  youtube: (
    <path
      fill="currentColor"
      stroke="none"
      d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"
    />
  ),
  pinterest: (
    <path
      fill="currentColor"
      stroke="none"
      d="M12.017 0C5.396 0 .029 5.367.029 11.987c0 5.079 3.158 9.417 7.618 11.162-.105-.949-.199-2.403.041-3.439.219-.937 1.406-5.957 1.406-5.957s-.359-.72-.359-1.781c0-1.663.967-2.911 2.168-2.911 1.024 0 1.518.769 1.518 1.688 0 1.029-.653 2.567-.992 3.992-.285 1.193.6 2.165 1.775 2.165 2.128 0 3.768-2.245 3.768-5.487 0-2.861-2.063-4.869-5.008-4.869-3.41 0-5.409 2.562-5.409 5.199 0 1.033.394 2.143.889 2.741.099.12.112.225.085.345-.09.375-.293 1.199-.334 1.363-.053.225-.172.271-.401.165-1.495-.69-2.433-2.878-2.433-4.646 0-3.776 2.748-7.252 7.92-7.252 4.158 0 7.392 2.967 7.392 6.923 0 4.135-2.607 7.462-6.233 7.462-1.214 0-2.354-.629-2.758-1.379l-.749 2.848c-.269 1.045-1.004 2.352-1.498 3.146 1.123.345 2.306.535 3.55.535 6.607 0 11.985-5.365 11.985-11.987C23.97 5.39 18.592.026 11.985.026L12.017 0z"
    />
  ),
};

interface IconProps {
  name: TapIconName;
  size?: number;
}

const Icon = ({ name, size = 18 }: IconProps): React.ReactElement => (
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
    focusable="false"
  >
    {ICON_PATHS[name]}
  </svg>
);

const SERVICE_ICONS: Record<string, TapIconName> = {
  "NFC Business Cards": "gem",
  "Digital Standees": "images",
  "Customised Standy": "sparkles",
  "Bulk / Team Orders": "briefcase",
  "Google Review Cards": "star",
  "Instagram Profile Cards": "instagram",
  "LinkedIn Social Cards": "linkedin",
};

const VISIBLE_SERVICES = 3;

const STYLES = `
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');

.tv2-scope{--tv2-primary:#3B5BFF;--tv2-primary-hover:#2F4FE0;--tv2-primary-active:#2545CC;--tv2-gradient:linear-gradient(135deg,#3B5BFF,#151E3D);--tv2-wa:#25D366;--tv2-wa-hover:#1fc35b;--tv2-bg:#F8F9FB;--tv2-surface:#ffffff;--tv2-muted:#EEF1F8;--tv2-muted-hover:#E0E4EF;--tv2-muted-fg:#6B7280;--tv2-fg:#151E3D;--tv2-border:#D9E0EC;--tv2-error:#ef4444;--tv2-wash-15:rgb(59 91 255/.15);--tv2-wash-20:rgb(59 91 255/.20);--tv2-halo:rgb(59 91 255/.25);--tv2-shadow-card:0 1px 3px rgb(0 0 0/.04),0 1px 2px -1px rgb(0 0 0/.04);--tv2-shadow-up:0 10px 25px -5px rgb(0 0 0/.08),0 8px 10px -6px rgb(0 0 0/.04);--tv2-shadow-chip:0 2px 8px rgb(0 0 0/.12);--tv2-r-sm:8px;--tv2-r-md:12px;--tv2-r-lg:16px;--tv2-e-std:cubic-bezier(.4,0,.2,1);--tv2-e-decel:cubic-bezier(.05,.7,.1,1);--tv2-e-spring:cubic-bezier(.32,.72,0,1);display:block;min-height:100vh;padding-bottom:80px;background:var(--tv2-bg);font-family:'Inter',ui-sans-serif,system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;color:var(--tv2-fg);-webkit-font-smoothing:antialiased;-webkit-tap-highlight-color:transparent;}
.tv2-scope *,.tv2-scope *::before,.tv2-scope *::after{box-sizing:border-box;margin:0;padding:0;}
.tv2-scope :focus-visible{outline:2px solid var(--tv2-primary);outline-offset:2px;border-radius:4px;}
.tv2-sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0;}

.tv2-card{width:100%;max-width:448px;margin-inline:auto;background:var(--tv2-surface);}

.tv2-hero{position:relative;height:200px;overflow:hidden;background:var(--tv2-muted);}
.tv2-hero-img{width:100%;height:100%;object-fit:cover;display:block;}
.tv2-hero-dim{position:absolute;inset:0;background:rgb(21 30 61/.15);pointer-events:none;}
.tv2-hero-fade{position:absolute;inset:0;background:linear-gradient(180deg,rgb(255 255 255/0) 45%,var(--tv2-surface) 100%);pointer-events:none;}
.tv2-share-btn{position:absolute;top:12px;right:12px;width:36px;height:36px;display:flex;align-items:center;justify-content:center;border:none;border-radius:9999px;background:rgb(255 255 255/.8);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);box-shadow:var(--tv2-shadow-chip);color:var(--tv2-fg);cursor:pointer;z-index:2;transition:background 180ms var(--tv2-e-std),transform 120ms var(--tv2-e-std);}
.tv2-share-btn::after{content:"";position:absolute;inset:-4px;}
.tv2-share-btn:hover{background:rgb(255 255 255/.95);}
.tv2-share-btn:active{transform:scale(.95);}
.tv2-share-chip{position:absolute;top:15px;right:56px;max-width:70%;display:flex;align-items:center;gap:6px;padding:7px 12px;border-radius:9999px;background:rgb(21 30 61/.9);color:#fff;font-size:12px;line-height:1;font-weight:500;opacity:0;transform:translateY(-4px);pointer-events:none;z-index:60;transition:opacity 180ms var(--tv2-e-decel),transform 180ms var(--tv2-e-decel);}
.tv2-share-chip--visible{opacity:1;transform:translateY(0);}
.tv2-share-chip svg{color:#3B5BFF;flex:0 0 auto;}

.tv2-main{padding:0 20px 36px;}
.tv2-identity{margin-top:-32px;display:flex;align-items:center;gap:16px;text-align:left;position:relative;z-index:10;}
.tv2-avatar{display:block;width:104px;height:104px;flex:0 0 auto;border-radius:var(--tv2-r-lg);border:4px solid #fff;box-shadow:var(--tv2-shadow-up);object-fit:cover;background:var(--tv2-muted);}
.tv2-idtext{min-width:0;}
.tv2-name{font-size:20px;line-height:26px;font-weight:700;letter-spacing:.02em;text-transform:uppercase;color:var(--tv2-fg);}
.tv2-tagline{margin-top:3px;font-size:13px;line-height:18px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--tv2-primary);}
.tv2-meta{display:flex;flex-wrap:wrap;justify-content:flex-start;align-items:center;gap:4px 12px;margin-top:8px;}
.tv2-meta-item{display:inline-flex;align-items:center;gap:5px;font-size:12px;line-height:16px;color:var(--tv2-muted-fg);text-decoration:none;overflow-wrap:anywhere;}
.tv2-meta-item:hover{color:var(--tv2-fg);}
.tv2-bio{margin-top:8px;font-size:13px;line-height:20px;color:var(--tv2-muted-fg);}

.tv2-actions{display:flex;justify-content:center;gap:10px;margin-top:16px;}
.tv2-btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;border:none;border-radius:var(--tv2-r-md);font-family:inherit;font-weight:600;cursor:pointer;text-decoration:none;transition:transform 120ms var(--tv2-e-std),background 180ms var(--tv2-e-std),box-shadow 180ms var(--tv2-e-std),color 180ms var(--tv2-e-std),border-color 180ms var(--tv2-e-std);}
.tv2-btn:active{transform:scale(.97);}
.tv2-btn[disabled]{opacity:.7;pointer-events:none;}
.tv2-btn--sm{padding:10px 16px;font-size:12px;line-height:16px;}
.tv2-btn--block{width:100%;padding:12px 0;font-size:14px;line-height:20px;}
.tv2-btn--soft{background:var(--tv2-muted);color:var(--tv2-fg);}
.tv2-btn--outline{background:#fff;border:1px solid var(--tv2-border);color:var(--tv2-fg);}
.tv2-btn--brand{background:var(--tv2-primary);color:#fff;}
.tv2-btn--wa{background:var(--tv2-wa);color:#fff;}
.tv2-btn--wa-ghost{background:transparent;border:2px solid var(--tv2-primary);color:var(--tv2-primary);}

.tv2-btn--review{width:100%;margin-top:10px;}

.tv2-socials{display:flex;flex-wrap:nowrap;align-items:center;justify-content:center;gap:10px;margin-top:16px;}
.tv2-social-tile{flex:1 1 0;width:100%;min-width:0;max-width:48px;height:auto;aspect-ratio:1/1;display:grid;place-items:center;border-radius:var(--tv2-r-md);background:var(--tv2-muted);color:var(--tv2-muted-fg);transition:background 180ms var(--tv2-e-std),color 180ms var(--tv2-e-std),transform 120ms var(--tv2-e-std),box-shadow 180ms var(--tv2-e-std);}
.tv2-social-tile:active{transform:scale(.95);}

.tv2-section{margin-top:32px;}
.tv2-head{display:flex;align-items:center;gap:8px;margin-bottom:12px;font-size:14px;line-height:20px;font-weight:700;color:var(--tv2-fg);}
.tv2-head-ico{width:28px;height:28px;display:grid;place-items:center;border-radius:var(--tv2-r-sm);background:var(--tv2-wash-15);color:var(--tv2-primary);}

.tv2-ptrack{display:flex;gap:12px;overflow-x:auto;scroll-snap-type:x mandatory;scrollbar-width:none;-webkit-overflow-scrolling:touch;}

.tv2-ptrack::-webkit-scrollbar{display:none;}

.tv2-pslide{display:flex;flex-direction:column;flex:0 0 72%;scroll-snap-align:start;border:1px solid var(--tv2-border);border-radius:12px;background:#F8F9FB;overflow:hidden;}

.tv2-pmedia{position:relative;display:block;width:100%;aspect-ratio:16/10;padding:0;border:none;background:var(--tv2-muted);cursor:zoom-in;}

.tv2-pill{position:absolute;right:8px;bottom:8px;width:20px;height:4px;border-radius:9999px;background:rgb(255 255 255/.8);}

.tv2-psimg{width:100%;height:100%;object-fit:cover;display:block;pointer-events:none;}

.tv2-pbody{display:flex;flex-direction:column;flex:1;padding:10px;}

.tv2-ptitle{font-size:13px;line-height:18px;font-weight:700;color:#0F172A;word-break:break-word;margin-bottom:8px;}

.tv2-pcta{margin-top:auto;width:100%;display:flex;align-items:center;justify-content:center;gap:4px;padding:8px 6px;border-radius:9999px;background:var(--tv2-wa);color:#fff;font-family:inherit;font-size:10px;line-height:14px;font-weight:600;text-decoration:none;white-space:normal;text-align:center;transition:background 180ms var(--tv2-e-std),transform 120ms var(--tv2-e-std);}

.tv2-pcta:hover{background:var(--tv2-wa-hover);}

.tv2-pcta:active{transform:scale(.98);}

.tv2-svc-list{display:flex;flex-direction:column;gap:12px;}
.tv2-svc{display:flex;align-items:center;gap:12px;padding:14px;border-radius:var(--tv2-r-md);background:var(--tv2-muted);}
.tv2-svc-ico{width:36px;height:36px;flex:0 0 auto;display:grid;place-items:center;border-radius:var(--tv2-r-sm);background:var(--tv2-wash-15);color:var(--tv2-primary);}
.tv2-svc-title{font-size:14px;line-height:20px;font-weight:600;color:var(--tv2-fg);word-break:break-word;}
.tv2-svc-pill{margin-left:auto;flex:0 0 auto;display:inline-flex;align-items:center;gap:5px;padding:10px 12px;border-radius:9999px;background:var(--tv2-wa);color:#fff;font-size:11px;line-height:1;font-weight:600;text-decoration:none;transition:background 180ms var(--tv2-e-std),transform 120ms var(--tv2-e-std);}
.tv2-svc-pill:active{transform:scale(.95);}
.tv2-svc-more{margin-top:12px;width:100%;display:flex;align-items:center;justify-content:center;gap:6px;padding:10px 0;border-radius:9999px;border:none;background:transparent;color:var(--tv2-primary);font-family:inherit;font-size:12px;font-weight:600;cursor:pointer;transition:background 180ms var(--tv2-e-std),transform 120ms var(--tv2-e-std);}
.tv2-svc-more:hover{background:var(--tv2-wash-15);}
.tv2-svc-more:active{transform:scale(.98);}
.tv2-svc-more-ico{display:flex;transition:transform 180ms var(--tv2-e-std);}
.tv2-svc-more-ico--open{transform:rotate(180deg);}

.tv2-gal{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;}
.tv2-gthumb{aspect-ratio:1/1;padding:0;border:0;border-radius:var(--tv2-r-md);overflow:hidden;background:var(--tv2-muted);cursor:zoom-in;transition:transform 120ms var(--tv2-e-std);}
.tv2-gthumb:active{transform:scale(.95);}
.tv2-gimg{width:100%;height:100%;object-fit:cover;display:block;transition:transform 300ms var(--tv2-e-std),filter 300ms var(--tv2-e-std);}

.tv2-form{display:flex;flex-direction:column;gap:12px;margin-top:12px;}
.tv2-frow{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;}
.tv2-field{display:flex;flex-direction:column;gap:4px;}
.tv2-input,.tv2-textarea{width:100%;background:#fff;border:1px solid var(--tv2-border);border-radius:var(--tv2-r-md);font-family:inherit;font-size:14px;line-height:20px;font-weight:400;color:var(--tv2-fg);padding:11px 14px;outline:none;transition:border-color 180ms var(--tv2-e-std),box-shadow 180ms var(--tv2-e-std);}
.tv2-textarea{padding-top:10px;resize:vertical;min-height:76px;}
.tv2-input::placeholder,.tv2-textarea::placeholder{color:var(--tv2-muted-fg);}
.tv2-input:focus,.tv2-textarea:focus{border-color:var(--tv2-primary);box-shadow:0 0 0 3px var(--tv2-halo);}
.tv2-input--error,.tv2-textarea--error{border-color:var(--tv2-error);animation:tv2-shake 300ms var(--tv2-e-std);}
.tv2-input--error:focus,.tv2-textarea--error:focus{box-shadow:0 0 0 3px rgb(239 68 68/.15);}
.tv2-err{font-size:12px;line-height:16px;font-weight:500;color:var(--tv2-error);animation:tv2-err-in 160ms var(--tv2-e-decel);}
.tv2-spin{animation:tv2-spin 800ms linear infinite;}
.tv2-okcard{background:var(--tv2-muted);border-radius:var(--tv2-r-md);padding:24px;text-align:center;}
.tv2-okico{width:56px;height:56px;margin-inline:auto;display:grid;place-items:center;border-radius:9999px;background:var(--tv2-wash-20);color:var(--tv2-primary-active);animation:tv2-pop 350ms var(--tv2-e-spring);}
.tv2-oktitle{margin-top:12px;font-size:15px;line-height:22px;font-weight:600;color:var(--tv2-fg);}
.tv2-oksub{margin-top:4px;font-size:13px;line-height:20px;color:var(--tv2-muted-fg);}
.tv2-oksub em{font-style:italic;}
.tv2-okagain{margin-top:12px;border:none;background:none;font-family:inherit;font-size:12px;font-weight:600;color:var(--tv2-primary);cursor:pointer;text-decoration:none;}
.tv2-okagain:hover{text-decoration:underline;text-underline-offset:3px;}

.tv2-footer{margin-top:32px;border-top:1px solid var(--tv2-border);padding:16px 0 20px;text-align:center;}
.tv2-flink{font-size:12px;font-weight:600;color:var(--tv2-primary);text-decoration:none;}
.tv2-flink:hover{text-decoration:underline;text-underline-offset:3px;color:var(--tv2-primary-hover);}
.tv2-fnote{display:block;margin-top:6px;font-size:11px;line-height:15px;color:var(--tv2-muted-fg);text-decoration:none;}
.tv2-fnote:hover{text-decoration:underline;}

.tv2-bar{position:sticky;bottom:0;z-index:40;background:rgb(255 255 255/.92);backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px);border-top:1px solid var(--tv2-border);box-shadow:0 -4px 16px rgb(0 0 0/.06);}
.tv2-bar-in{max-width:448px;margin-inline:auto;display:flex;gap:8px;padding:12px 16px calc(12px + env(safe-area-inset-bottom));}
.tv2-bar-btn{flex:1;min-height:48px;font-size:14px;line-height:20px;}
.tv2-bar-btn--brand:hover{background:var(--tv2-primary-hover);box-shadow:var(--tv2-shadow-up);}
.tv2-bar-btn--wa-ghost{border-width:2px;}
.tv2-bar-icon{width:48px;height:48px;min-height:48px;flex:0 0 auto;padding:0;}

.tv2-overlay{position:fixed;inset:0;z-index:50;background:rgb(21 30 61/.6);opacity:0;visibility:hidden;transition:opacity 240ms var(--tv2-e-decel),visibility 0s linear 240ms;}
.tv2-overlay--open{opacity:1;visibility:visible;transition:opacity 240ms var(--tv2-e-decel);}
.tv2-sheet{position:fixed;left:0;right:0;bottom:0;margin-inline:auto;width:min(448px,100%);z-index:55;background:#fff;border-radius:var(--tv2-r-lg) var(--tv2-r-lg) 0 0;padding:20px 20px calc(20px + env(safe-area-inset-bottom));transform:translateY(100%);transition:transform 240ms var(--tv2-e-std);}
.tv2-overlay--open .tv2-sheet{transform:translateY(0);transition:transform 320ms var(--tv2-e-spring);}
.tv2-sheet-head{display:flex;align-items:flex-start;gap:12px;padding-right:44px;}
.tv2-sheet-ico{width:40px;height:40px;flex:0 0 auto;display:grid;place-items:center;border-radius:9999px;background:var(--tv2-wash-15);color:var(--tv2-primary);}
.tv2-sheet-title{font-size:16px;line-height:22px;font-weight:700;color:var(--tv2-fg);}
.tv2-sheet-intro{margin-top:2px;font-size:13px;line-height:18px;color:var(--tv2-muted-fg);}
.tv2-xbtn{position:absolute;top:14px;right:14px;width:36px;height:36px;display:flex;align-items:center;justify-content:center;border:none;border-radius:9999px;background:transparent;color:var(--tv2-muted-fg);cursor:pointer;transition:background 180ms var(--tv2-e-std),color 180ms var(--tv2-e-std),transform 120ms var(--tv2-e-std);}
.tv2-xbtn:hover{background:var(--tv2-muted);color:var(--tv2-fg);}
.tv2-xbtn:active{transform:scale(.95);}
.tv2-sheet-body{display:flex;flex-direction:column;gap:12px;margin-top:16px;}
.tv2-lb-stage{position:fixed;inset:0;z-index:55;display:flex;align-items:center;justify-content:center;padding:20px;}
.tv2-lb-img{max-width:92vw;max-height:82vh;border-radius:var(--tv2-r-md);object-fit:contain;animation:tv2-zoom-in 260ms var(--tv2-e-decel);}
.tv2-lb-close{position:absolute;top:12px;right:12px;width:40px;height:40px;display:flex;align-items:center;justify-content:center;border:none;border-radius:9999px;background:rgb(255 255 255/.16);color:#fff;cursor:pointer;transition:background 180ms var(--tv2-e-std),transform 120ms var(--tv2-e-std);}
.tv2-lb-close:hover{background:rgb(255 255 255/.26);}
.tv2-lb-close:active{transform:scale(.95);}
.tv2-lb-nav{position:absolute;top:50%;transform:translateY(-50%);width:44px;height:44px;display:flex;align-items:center;justify-content:center;border:none;border-radius:9999px;background:rgb(255 255 255/.16);color:#fff;cursor:pointer;transition:background 180ms var(--tv2-e-std),transform 120ms var(--tv2-e-std);}
.tv2-lb-nav:hover{background:rgb(255 255 255/.26);}
.tv2-lb-nav:active{transform:translateY(-50%) scale(.95);}
.tv2-lb-nav--prev{left:8px;}
.tv2-lb-nav--next{right:8px;}
.tv2-lb-count{position:absolute;top:14px;left:16px;font-size:12px;font-weight:500;color:#fff;text-shadow:0 1px 4px rgb(0 0 0/.4);}

@media(hover:hover) and (pointer:fine){
.tv2-share-btn:hover{background:rgb(255 255 255/.95);}
.tv2-btn--soft:hover{background:var(--tv2-muted-hover);}
.tv2-btn--outline:hover{border-color:var(--tv2-primary);color:var(--tv2-primary);background:var(--tv2-wash-15);}
.tv2-btn--brand:hover{background:var(--tv2-primary-hover);box-shadow:var(--tv2-shadow-up);}
.tv2-btn--wa:hover,.tv2-svc-pill:hover{background:var(--tv2-wa-hover);}
.tv2-btn--wa-ghost:hover,.tv2-bar-btn--wa-ghost:hover{background:var(--tv2-wash-15);color:var(--tv2-primary-active);border-color:var(--tv2-primary-active);}
.tv2-social-tile:hover{background:var(--tv2-muted-hover);color:var(--tv2-fg);transform:translateY(-2px);box-shadow:var(--tv2-shadow-card);}
.tv2-gthumb:hover .tv2-gimg{transform:scale(1.06);filter:brightness(1.05);}
}

@media(min-width:480px){
.tv2-card{margin:24px 16px;border-radius:var(--tv2-r-lg);box-shadow:var(--tv2-shadow-card);overflow:hidden;}
.tv2-lb-img{max-height:86vh;}
.tv2-pslide{flex:0 0 42%;}
}
@media(max-width:420px){
.tv2-frow{grid-template-columns:1fr;}
.tv2-svc-pill{padding:10px 12px;min-height:44px;}
}
@media(max-width:359px){
.tv2-hero{height:160px;}
.tv2-avatar{width:84px;height:84px;}
.tv2-name{font-size:17px;line-height:22px;}
.tv2-share-chip{max-width:55%;font-size:11px;}
.tv2-actions{flex-direction:column;gap:8px;}
.tv2-pslide{flex-basis:50%;}
.tv2-socials{flex-wrap:wrap;gap:8px;}
.tv2-social-tile{max-width:40px;}
.tv2-bar-in{gap:6px;padding:10px 12px calc(10px + env(safe-area-inset-bottom));}
.tv2-bar-btn{font-size:12px;min-height:44px;}
.tv2-bar-icon{width:44px;height:44px;min-height:44px;}
.tv2-lb-nav{width:36px;height:36px;}
.tv2-lb-close{width:36px;height:36px;}
}

@keyframes tv2-zoom-in{from{opacity:0;transform:scale(.9);}to{opacity:1;transform:scale(1);}}
@keyframes tv2-pop{0%{opacity:0;transform:scale(.5);}70%{transform:scale(1.08);}100%{opacity:1;transform:scale(1);}}
@keyframes tv2-shake{0%,100%{transform:translateX(0);}20%,60%{transform:translateX(-4px);}40%,80%{transform:translateX(4px);}}
@keyframes tv2-spin{to{transform:rotate(360deg);}}
@keyframes tv2-err-in{from{opacity:0;transform:translateY(-3px);}to{opacity:1;transform:translateY(0);}}

@media(prefers-reduced-motion:reduce){
.tv2-scope *,.tv2-scope *::before,.tv2-scope *::after{animation-duration:.01ms!important;animation-iteration-count:1!important;transition-duration:.01ms!important;}
}
`;

interface FieldErrors {
  name?: string;
  email?: string;
  phone?: string;
  message?: string;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^[+\d][\d\s()-]{6,}$/;

const BUSY_MS = 900;
const SHEET_CLOSE_MS = 240;

const trapTabKeys = (event: React.KeyboardEvent<HTMLDivElement>): void => {
  if (event.key !== "Tab") return;
  const nodes = event.currentTarget.querySelectorAll<HTMLElement>(
    'a[href],button:not([disabled]),input:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])',
  );
  if (nodes.length === 0) return;
  const first = nodes[0];
  const last = nodes[nodes.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
};

const TapreviaProfile = ({ onSubmit }: TapreviaProps = {}): React.ReactElement => {
  const [chipVisible, setChipVisible] = useState<boolean>(false);
  const [sheetState, setSheetState] = useState<OverlayKind>("closed");
  const [lightbox, setLightbox] = useState<{ photos: string[]; index: number } | null>(null);

  const CAROUSEL_CLONES = CARD_DATA.products.length;
  const carouselItems = useMemo(
    () => [...CARD_DATA.products, ...CARD_DATA.products, ...CARD_DATA.products],
    [],
  );
  const recentering = useRef<boolean>(false);

  const [leadName, setLeadName] = useState<string>("");
  const [leadEmail, setLeadEmail] = useState<string>("");
  const [leadPhone, setLeadPhone] = useState<string>("");
  const [leadMessage, setLeadMessage] = useState<string>("");
  const [leadErrors, setLeadErrors] = useState<FieldErrors>({});
  const [leadBusy, setLeadBusy] = useState<boolean>(false);
  const [leadSent, setLeadSent] = useState<boolean>(false);

  const [exName, setExName] = useState<string>("");
  const [exPhone, setExPhone] = useState<string>("");
  const [exEmail, setExEmail] = useState<string>("");
  const [exErrors, setExErrors] = useState<FieldErrors>({});
  const [exBusy, setExBusy] = useState<boolean>(false);
  const [exSent, setExSent] = useState<boolean>(false);
  const [servicesExpanded, setServicesExpanded] = useState<boolean>(false);

  const chipTimer = useRef<number | null>(null);
  const sheetTimer = useRef<number | null>(null);
  const leadTimer = useRef<number | null>(null);
  const exTimer = useRef<number | null>(null);
  const productTrackRef = useRef<HTMLDivElement | null>(null);
  const productScrollRaf = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (chipTimer.current !== null) window.clearTimeout(chipTimer.current);
      if (sheetTimer.current !== null) window.clearTimeout(sheetTimer.current);
      if (leadTimer.current !== null) window.clearTimeout(leadTimer.current);
      if (exTimer.current !== null) window.clearTimeout(exTimer.current);
      if (productScrollRaf.current !== null) window.cancelAnimationFrame(productScrollRaf.current);
    },
    [],
  );

  const anyOverlayOpen = sheetState === "open" || lightbox !== null;

  useEffect(() => {
    const track = productTrackRef.current;
    const first = track?.children[0] as HTMLElement | undefined;
    if (!track || !first) return;
    const step = first.offsetWidth + 12;
    if (step <= 0) return;
    recentering.current = true;
    track.scrollTo({ left: CAROUSEL_CLONES * step, behavior: "auto" });
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        recentering.current = false;
      });
    });
  }, []);

  const openLightbox = (photos: string[], index: number): void => setLightbox({ photos, index });

  const closeLightbox = (): void => setLightbox(null);

  const stepLightbox = (delta: number): void =>
    setLightbox((current) => {
      if (current === null) return null;
      const total = current.photos.length;
      return { photos: current.photos, index: (current.index + delta + total) % total };
    });

  const handleProductScroll = (): void => {
    if (productScrollRaf.current !== null || recentering.current) return;
    productScrollRaf.current = window.requestAnimationFrame(() => {
      productScrollRaf.current = null;
      if (recentering.current) return;
      const track = productTrackRef.current;
      const first = track?.children[0] as HTMLElement | undefined;
      if (!track || !first) return;
      const step = first.offsetWidth + 12;
      if (step <= 0) return;
      const raw = Math.round(track.scrollLeft / step);
      const real = ((raw % CAROUSEL_CLONES) + CAROUSEL_CLONES) % CAROUSEL_CLONES;
      if (raw < CAROUSEL_CLONES || raw >= 2 * CAROUSEL_CLONES) {
        recentering.current = true;
        track.style.scrollSnapType = "none";
        track.style.overflowX = "hidden";
        track.scrollTo({ left: (CAROUSEL_CLONES + real) * step, behavior: "auto" });
        requestAnimationFrame(() => {
          track.style.scrollSnapType = "";
          track.style.overflowX = "";
          requestAnimationFrame(() => {
            recentering.current = false;
          });
        });
        return;
      }
    });
  };

  useEffect(() => {
    if (!anyOverlayOpen) return undefined;
    const previousOverflow = document.documentElement.style.overflow;
    document.documentElement.style.overflow = "hidden";
    return () => {
      document.documentElement.style.overflow = previousOverflow;
    };
  }, [anyOverlayOpen]);

  useEffect(() => {
    if (!anyOverlayOpen) return undefined;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        if (lightbox !== null) closeLightbox();
        else if (sheetState === "open") closeSheet();
        return;
      }
      if (lightbox !== null) {
        if (event.key === "ArrowRight") stepLightbox(1);
        else if (event.key === "ArrowLeft") stepLightbox(-1);
        else if (event.key === "Home") setLightbox({ photos: lightbox.photos, index: 0 });
        else if (event.key === "End")
          setLightbox({ photos: lightbox.photos, index: lightbox.photos.length - 1 });
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  const closeSheet = (): void => {
    if (sheetState !== "open") return;
    setSheetState("closing");
    if (sheetTimer.current !== null) window.clearTimeout(sheetTimer.current);
    sheetTimer.current = window.setTimeout(() => {
      setSheetState("closed");
      setExName("");
      setExPhone("");
      setExEmail("");
      setExErrors({});
      setExBusy(false);
    }, SHEET_CLOSE_MS);
  };

  const openSheet = (): void => {
    if (sheetTimer.current !== null) window.clearTimeout(sheetTimer.current);
    setSheetState("open");
  };

  const copyCardLink = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(CARD_DATA.cardUrl);
    } catch {
      const textarea = document.createElement("textarea");
      textarea.value = CARD_DATA.cardUrl;
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.select();
      try {
        document.execCommand("copy");
      } catch {
        /* clipboard unavailable */
      }
      document.body.removeChild(textarea);
    }
    setChipVisible(true);
    if (chipTimer.current !== null) window.clearTimeout(chipTimer.current);
    chipTimer.current = window.setTimeout(() => setChipVisible(false), 2000);
  };

  const validateLead = (): FieldErrors => {
    const errors: FieldErrors = {};
    if (leadName.trim().length === 0) errors.name = "Please enter your name";
    const email = leadEmail.trim();
    if (email.length > 0 && !EMAIL_RE.test(email)) errors.email = "Please enter a valid email address";
    const phone = leadPhone.trim();
    if (phone.length > 0 && !PHONE_RE.test(phone)) errors.phone = "Please enter a valid phone number";
    if (leadMessage.trim().length === 0) errors.message = "Please tell us how we can help";
    return errors;
  };

  const handleLeadSubmit = (event: React.FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    if (leadBusy) return;
    const errors = validateLead();
    setLeadErrors(errors);
    if (Object.keys(errors).length > 0) return;
    setLeadBusy(true);
    const name = leadName.trim();
    const email = leadEmail.trim();
    const phone = leadPhone.trim();
    const messageLines = [
      `Hello ${CARD_DATA.name}! Here is my enquiry from your digital card.`,
      "",
      `Name: ${name}`,
      phone.length > 0 ? `Phone: ${phone}` : "",
      email.length > 0 ? `Email: ${email}` : "",
      "",
      leadMessage.trim(),
    ].filter((line) => line.length > 0);
    window.open(buildWaLink(messageLines.join("\n")), "_blank", "noopener,noreferrer");
    const payload = {
      kind: "lead",
      name,
      email,
      phone,
      message: leadMessage.trim(),
    };
    if (onSubmit) void Promise.resolve(onSubmit(payload)).catch(() => undefined);
    if (leadTimer.current !== null) window.clearTimeout(leadTimer.current);
    leadTimer.current = window.setTimeout(() => {
      setLeadBusy(false);
      setLeadSent(true);
    }, BUSY_MS);
  };

  const resetLead = (): void => {
    setLeadName("");
    setLeadEmail("");
    setLeadPhone("");
    setLeadMessage("");
    setLeadErrors({});
    setLeadSent(false);
  };

  const handleExchangeSubmit = (event: React.FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    if (exBusy) return;
    const errors: FieldErrors = {};
    if (exName.trim().length === 0) errors.name = "Please enter your name";
    if (exPhone.trim().length === 0) errors.phone = "Please enter your phone";
    else if (!PHONE_RE.test(exPhone.trim())) errors.phone = "Please enter a valid phone number";
    const email = exEmail.trim();
    if (email.length > 0 && !EMAIL_RE.test(email)) errors.email = "Please enter a valid email address";
    setExErrors(errors);
    if (Object.keys(errors).length > 0) return;
    setExBusy(true);
    const name = exName.trim();
    const phone = exPhone.trim();
    const messageLines = [
      `Hello ${CARD_DATA.name}! Sharing my contact details from your digital card.`,
      "",
      `Name: ${name}`,
      `Phone: ${phone}`,
    ];
    if (email.length > 0) messageLines.push(`Email: ${email}`);
    window.open(buildWaLink(messageLines.join("\n")), "_blank", "noopener,noreferrer");
    const payload = {
      kind: "exchange",
      name,
      phone,
      email,
    };
    if (onSubmit) void Promise.resolve(onSubmit(payload)).catch(() => undefined);
    if (exTimer.current !== null) window.clearTimeout(exTimer.current);
    exTimer.current = window.setTimeout(() => {
      setExBusy(false);
      setExSent(true);
    }, BUSY_MS);
  };

  const galleryTotal = CARD_DATA.gallery.length;

  return (
    <div className="tv2-scope">
      <style dangerouslySetInnerHTML={{ __html: STYLES }} />

      <div className="tv2-card">
        <header className="tv2-hero">
          <img
            className="tv2-hero-img"
            src={CARD_DATA.heroUrl}
            alt=""
            width={896}
            height={352}
            fetchPriority="high"
            onError={handleImgError}
          />
          <span className="tv2-hero-dim" aria-hidden="true" />
          <span className="tv2-hero-fade" aria-hidden="true" />
          <button
            type="button"
            className="tv2-share-btn"
            onClick={() => void copyCardLink()}
            aria-label="Copy profile link"
          >
            <Icon name="share" size={18} />
          </button>
          <span
            className={
              chipVisible ? "tv2-share-chip tv2-share-chip--visible" : "tv2-share-chip"
            }
            role="status"
            aria-live="polite"
          >
            <Icon name="check" size={14} />
            Link copied!
          </span>
        </header>

        <main className="tv2-main">
          <section className="tv2-identity">
            <img
              className="tv2-avatar"
              src={CARD_DATA.avatarUrl}
              alt={CARD_DATA.name}
              width={112}
              height={112}
              onError={handleImgError}
            />
            <div className="tv2-idtext">
              <h1 className="tv2-name">{CARD_DATA.name}</h1>
              <p className="tv2-tagline">{CARD_DATA.tagline}</p>
              <div className="tv2-meta">
                <a className="tv2-meta-item" href={`tel:+${WA_NUMBER}`}>
                  <Icon name="phone" size={14} />
                  {CARD_DATA.phoneDisplay}
                </a>
                <a className="tv2-meta-item" href={`mailto:${CARD_DATA.email}`}>
                  <Icon name="mail" size={14} />
                  {CARD_DATA.email}
                </a>
              </div>
              {CARD_DATA.bio ? <p className="tv2-bio">{CARD_DATA.bio}</p> : null}
            </div>
          </section>

          <div className="tv2-actions">
            <button type="button" className="tv2-btn tv2-btn--sm tv2-btn--soft" onClick={downloadVCard}>
              <Icon name="user-plus" size={14} />
              Add to Contacts
            </button>
            <button
              type="button"
              className="tv2-btn tv2-btn--sm tv2-btn--outline"
              onClick={openSheet}
              aria-expanded={sheetState === "open"}
              aria-controls="tv2-sheet"
            >
              <Icon name="exchange" size={14} />
              Exchange Contact
            </button>
          </div>
          <a
            className="tv2-btn tv2-btn--sm tv2-btn--soft tv2-btn--review"
            href={GOOGLE_REVIEW_URL}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`Rate ${CARD_DATA.name} on Google`}
          >
            <Icon name="star" size={14} />
            Rate us on Google
          </a>

          <div className="tv2-socials">
            {CARD_DATA.socials.map((social) => (
              <a
                key={social.network}
                className="tv2-social-tile"
                href={social.url}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={`${brandLabelFromUrl(social.url)} — ${CARD_DATA.name}`}
              >
                {getBrandIcon(social.url)}
              </a>
            ))}
          </div>

          <section className="tv2-section" aria-labelledby="tv2-products-head">
            <h2 className="tv2-head" id="tv2-products-head">
              <span className="tv2-head-ico">
                <Icon name="package" size={16} />
              </span>
              Products
            </h2>
            <div
              className="tv2-pcarousel"
              role="region"
              aria-roledescription="carousel"
              aria-label="Products photo carousel"
            >
              <div
                className="tv2-ptrack"
                ref={productTrackRef}
                onScroll={handleProductScroll}
                tabIndex={0}
                aria-label={`Swipe between ${CAROUSEL_CLONES} product photos`}
              >
                {carouselItems.map((product, idx) => {
                  const realIndex = idx % CAROUSEL_CLONES;
                  return (
                    <article key={`${product.title}-${idx}`} className="tv2-pslide">
                      <button
                        type="button"
                        className="tv2-pmedia"
                        onClick={() =>
                          openLightbox(
                            CARD_DATA.products.map((item) => item.imageUrl),
                            realIndex,
                          )
                        }
                        aria-label={`Open ${product.title} photo`}
                      >
                        <img
                          className="tv2-psimg"
                          src={product.imageUrl}
                          alt={`${product.title} photo`}
                          width={600}
                          height={450}
                          loading="lazy"
                          decoding="async"
                          onError={handleImgError}
                        />
                        <span className="tv2-pill" aria-hidden="true" />
                      </button>
                      <div className="tv2-pbody">
                        <h3 className="tv2-ptitle">{product.title}</h3>
                        <a
                          className="tv2-pcta"
                          href={buildWaLink(WA_PRODUCT_MSG(product.title))}
                          target="_blank"
                          rel="noopener noreferrer"
                          aria-label={`Enquire about ${product.title} on WhatsApp`}
                        >
                          <Icon name="chat" size={16} />
                          Enquire on WhatsApp
                        </a>
                      </div>
                    </article>
                  );
                })}
              </div>
            </div>
          </section>

          <section className="tv2-section" aria-labelledby="tv2-services-head">
            <h2 className="tv2-head" id="tv2-services-head">
              <span className="tv2-head-ico">
                <Icon name="wrench" size={16} />
              </span>
              Services
            </h2>
            <div className="tv2-svc-list">
              {(servicesExpanded
                ? CARD_DATA.services
                : CARD_DATA.services.slice(0, VISIBLE_SERVICES)
              ).map((service) => (
                <div key={service} className="tv2-svc">
                  <span className="tv2-svc-ico">
                    <Icon name={SERVICE_ICONS[service] ?? "sparkles"} size={18} />
                  </span>
                  <span className="tv2-svc-title">{service}</span>
                  <a
                    className="tv2-svc-pill"
                    href={buildWaLink(WA_SERVICE_MSG(service))}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={`Ask about ${service} on WhatsApp`}
                  >
                    <Icon name="chat" size={12} />
                    WhatsApp
                  </a>
                </div>
              ))}
              {CARD_DATA.services.length > VISIBLE_SERVICES ? (
                <button
                  type="button"
                  className="tv2-svc-more"
                  onClick={() => setServicesExpanded((value) => !value)}
                  aria-expanded={servicesExpanded}
                >
                  {servicesExpanded
                    ? "Show less"
                    : `Show all ${CARD_DATA.services.length} services`}
                  <span
                    className={
                      servicesExpanded
                        ? "tv2-svc-more-ico tv2-svc-more-ico--open"
                        : "tv2-svc-more-ico"
                    }
                    aria-hidden="true"
                  >
                    <Icon name="chevron-down" size={14} />
                  </span>
                </button>
              ) : null}
            </div>
          </section>

          <section className="tv2-section" aria-labelledby="tv2-gallery-head">
            <h2 className="tv2-head" id="tv2-gallery-head">
              <span className="tv2-head-ico">
                <Icon name="images" size={16} />
              </span>
              Gallery
            </h2>
            <div className="tv2-gal">
              {CARD_DATA.gallery.map((imageUrl, index) => (
                <button
                  key={imageUrl}
                  type="button"
                  className="tv2-gthumb"
                  onClick={() => openLightbox(CARD_DATA.gallery, index)}
                  aria-label={`Open photo ${index + 1} of ${galleryTotal}`}
                >
                  <img
                    className="tv2-gimg"
                    src={imageUrl}
                    alt={`${CARD_DATA.name} gallery photo ${index + 1}`}
                    width={400}
                    height={400}
                    loading="lazy"
                    decoding="async"
                    onError={handleImgError}
                  />
                </button>
              ))}
            </div>
          </section>

          <section className="tv2-section" aria-labelledby="tv2-contact-head">
            <h2 className="tv2-head" id="tv2-contact-head">
              <span className="tv2-head-ico">
                <Icon name="mail" size={16} />
              </span>
              Get in touch
            </h2>
            {leadSent ? (
              <div className="tv2-okcard">
                <span className="tv2-okico">
                  <Icon name="check" size={26} />
                </span>
                <p className="tv2-oktitle">Thanks! We&apos;ll be in touch.</p>
                <p className="tv2-oksub">Your message has been sent to {CARD_DATA.name}.</p>
                <button type="button" className="tv2-okagain" onClick={resetLead}>
                  Send another message
                </button>
              </div>
            ) : (
              <form className="tv2-form" onSubmit={handleLeadSubmit} noValidate>
                <div className="tv2-field">
                  <label className="tv2-sr-only" htmlFor="tv2-lead-name">
                    Your name
                  </label>
                  <input
                    id="tv2-lead-name"
                    className={
                      leadErrors.name ? "tv2-input tv2-input--error" : "tv2-input"
                    }
                    type="text"
                    placeholder="Your name"
                    autoComplete="name"
                    value={leadName}
                    aria-invalid={leadErrors.name ? true : undefined}
                    aria-describedby={leadErrors.name ? "tv2-lead-name-err" : undefined}
                    onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
                      setLeadName(event.target.value);
                      setLeadErrors((prev) => ({ ...prev, name: undefined }));
                    }}
                  />
                  {leadErrors.name ? (
                    <p className="tv2-err" id="tv2-lead-name-err" role="alert">
                      {leadErrors.name}
                    </p>
                  ) : null}
                </div>
                <div className="tv2-frow">
                  <div className="tv2-field">
                    <label className="tv2-sr-only" htmlFor="tv2-lead-email">
                      Email
                    </label>
                    <input
                      id="tv2-lead-email"
                      className={
                        leadErrors.email ? "tv2-input tv2-input--error" : "tv2-input"
                      }
                      type="email"
                      placeholder="you@email.com"
                      autoComplete="email"
                      value={leadEmail}
                      aria-invalid={leadErrors.email ? true : undefined}
                      aria-describedby={leadErrors.email ? "tv2-lead-email-err" : undefined}
                      onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
                        setLeadEmail(event.target.value);
                        setLeadErrors((prev) => ({ ...prev, email: undefined }));
                      }}
                    />
                    {leadErrors.email ? (
                      <p className="tv2-err" id="tv2-lead-email-err" role="alert">
                        {leadErrors.email}
                      </p>
                    ) : null}
                  </div>
                  <div className="tv2-field">
                    <label className="tv2-sr-only" htmlFor="tv2-lead-phone">
                      Phone
                    </label>
                    <input
                      id="tv2-lead-phone"
                      className={
                        leadErrors.phone ? "tv2-input tv2-input--error" : "tv2-input"
                      }
                      type="tel"
                      placeholder="+91 …"
                      autoComplete="tel"
                      value={leadPhone}
                      aria-invalid={leadErrors.phone ? true : undefined}
                      aria-describedby={leadErrors.phone ? "tv2-lead-phone-err" : undefined}
                      onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
                        setLeadPhone(event.target.value);
                        setLeadErrors((prev) => ({ ...prev, phone: undefined }));
                      }}
                    />
                    {leadErrors.phone ? (
                      <p className="tv2-err" id="tv2-lead-phone-err" role="alert">
                        {leadErrors.phone}
                      </p>
                    ) : null}
                  </div>
                </div>
                <div className="tv2-field">
                  <label className="tv2-sr-only" htmlFor="tv2-lead-message">
                    How can I help you?
                  </label>
                  <textarea
                    id="tv2-lead-message"
                    className={
                      leadErrors.message
                        ? "tv2-textarea tv2-textarea--error"
                        : "tv2-textarea"
                    }
                    rows={3}
                    placeholder="How can I help you?"
                    value={leadMessage}
                    aria-invalid={leadErrors.message ? true : undefined}
                    aria-describedby={leadErrors.message ? "tv2-lead-message-err" : undefined}
                    onChange={(event: React.ChangeEvent<HTMLTextAreaElement>) => {
                      setLeadMessage(event.target.value);
                      setLeadErrors((prev) => ({ ...prev, message: undefined }));
                    }}
                  />
                  {leadErrors.message ? (
                    <p className="tv2-err" id="tv2-lead-message-err" role="alert">
                      {leadErrors.message}
                    </p>
                  ) : null}
                </div>
                <button
                  type="submit"
                  className="tv2-btn tv2-btn--brand tv2-btn--block"
                  disabled={leadBusy}
                >
                  {leadBusy ? (
                    <>
                      <span className="tv2-spin">
                        <Icon name="share" size={16} />
                      </span>
                      Sending…
                    </>
                  ) : (
                    "Send Message"
                  )}
                </button>
              </form>
            )}
          </section>

          <footer className="tv2-footer">
            <a
              className="tv2-flink"
              href="https://taprevia.com/"
              target="_blank"
              rel="noopener noreferrer"
            >
              Powered by Taprevia
            </a>
            <a
              className="tv2-fnote"
              href="https://taprevia.com/"
              target="_blank"
              rel="noopener noreferrer"
            >
              Click here to create your digital business card
            </a>
          </footer>
        </main>
      </div>

      <nav className="tv2-bar" aria-label="Quick actions">
        <div className="tv2-bar-in">
          <a
            className="tv2-btn tv2-btn--brand tv2-bar-btn tv2-bar-btn--brand"
            href={`tel:+${WA_NUMBER}`}
          >
            <Icon name="phone" size={16} />
            Call
          </a>
          <a
            className="tv2-btn tv2-btn--wa-ghost tv2-bar-btn tv2-bar-btn--wa-ghost"
            href={buildWaLink(WA_BAR_MSG)}
            target="_blank"
            rel="noopener noreferrer"
          >
            <Icon name="chat" size={16} />
            WhatsApp
          </a>
          <button
            type="button"
            className="tv2-btn tv2-btn--soft tv2-bar-icon"
            onClick={downloadVCard}
            aria-label="Download contact card (.vcf)"
          >
            <Icon name="user-plus" size={18} />
          </button>
        </div>
      </nav>

      {sheetState !== "closed" ? (
        <div
          className={
            sheetState === "open" ? "tv2-overlay tv2-overlay--open" : "tv2-overlay"
          }
          onClick={() => closeSheet()}
          role="presentation"
          onKeyDown={trapTabKeys}
        >
          <div
            className="tv2-sheet"
            id="tv2-sheet"
            role="dialog"
            aria-modal="true"
            aria-labelledby="tv2-sheet-title"
            onClick={(event: React.MouseEvent<HTMLDivElement>) => event.stopPropagation()}
          >
            <button
              type="button"
              className="tv2-xbtn"
              onClick={() => closeSheet()}
              aria-label="Close dialog"
            >
              <Icon name="close" size={18} />
            </button>
            <div className="tv2-sheet-head">
              <span className="tv2-sheet-ico">
                <Icon name="exchange" size={20} />
              </span>
              <div>
                <h2 className="tv2-sheet-title" id="tv2-sheet-title">
                  Exchange Contact
                </h2>
                <p className="tv2-sheet-intro">Share your details with {CARD_DATA.name}</p>
              </div>
            </div>
            {exSent ? (
              <div className="tv2-okcard" style={{ marginTop: 16 }}>
                <span className="tv2-okico">
                  <Icon name="check" size={26} />
                </span>
                <p className="tv2-oktitle">Contact sent successfully!</p>
                <p className="tv2-oksub">
                  <em>Your contact details have been shared with {CARD_DATA.name}.</em>
                </p>
              </div>
            ) : (
              <form className="tv2-sheet-body" onSubmit={handleExchangeSubmit} noValidate>
                <div className="tv2-field">
                  <label className="tv2-sr-only" htmlFor="tv2-ex-name">
                    Your Name
                  </label>
                  <input
                    id="tv2-ex-name"
                    className={exErrors.name ? "tv2-input tv2-input--error" : "tv2-input"}
                    type="text"
                    placeholder="Your Name"
                    autoComplete="name"
                    value={exName}
                    aria-invalid={exErrors.name ? true : undefined}
                    aria-describedby={exErrors.name ? "tv2-ex-name-err" : undefined}
                    onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
                      setExName(event.target.value);
                      setExErrors((prev) => ({ ...prev, name: undefined }));
                    }}
                  />
                  {exErrors.name ? (
                    <p className="tv2-err" id="tv2-ex-name-err" role="alert">
                      {exErrors.name}
                    </p>
                  ) : null}
                </div>
                <div className="tv2-field">
                  <label className="tv2-sr-only" htmlFor="tv2-ex-phone">
                    Your Phone
                  </label>
                  <input
                    id="tv2-ex-phone"
                    className={exErrors.phone ? "tv2-input tv2-input--error" : "tv2-input"}
                    type="tel"
                    placeholder="Your Phone"
                    autoComplete="tel"
                    value={exPhone}
                    aria-invalid={exErrors.phone ? true : undefined}
                    aria-describedby={exErrors.phone ? "tv2-ex-phone-err" : undefined}
                    onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
                      setExPhone(event.target.value);
                      setExErrors((prev) => ({ ...prev, phone: undefined }));
                    }}
                  />
                  {exErrors.phone ? (
                    <p className="tv2-err" id="tv2-ex-phone-err" role="alert">
                      {exErrors.phone}
                    </p>
                  ) : null}
                </div>
                <div className="tv2-field">
                  <label className="tv2-sr-only" htmlFor="tv2-ex-email">
                    Your Email
                  </label>
                  <input
                    id="tv2-ex-email"
                    className={exErrors.email ? "tv2-input tv2-input--error" : "tv2-input"}
                    type="email"
                    placeholder="Your Email"
                    autoComplete="email"
                    value={exEmail}
                    aria-invalid={exErrors.email ? true : undefined}
                    aria-describedby={exErrors.email ? "tv2-ex-email-err" : undefined}
                    onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
                      setExEmail(event.target.value);
                      setExErrors((prev) => ({ ...prev, email: undefined }));
                    }}
                  />
                  {exErrors.email ? (
                    <p className="tv2-err" id="tv2-ex-email-err" role="alert">
                      {exErrors.email}
                    </p>
                  ) : null}
                </div>
                <button
                  type="submit"
                  className="tv2-btn tv2-btn--brand tv2-btn--block"
                  disabled={exBusy}
                >
                  {exBusy ? (
                    <>
                      <span className="tv2-spin">
                        <Icon name="share" size={16} />
                      </span>
                      Sending…
                    </>
                  ) : (
                    "Share My Contact"
                  )}
                </button>
              </form>
            )}
          </div>
        </div>
      ) : null}

      {lightbox !== null ? (
        <div
          className="tv2-overlay tv2-overlay--open"
          onClick={closeLightbox}
          role="presentation"
          onKeyDown={trapTabKeys}
        >
          <div
            className="tv2-lb-stage"
            role="dialog"
            aria-modal="true"
            aria-label="Photo viewer"
            onClick={(event: React.MouseEvent<HTMLDivElement>) => event.stopPropagation()}
          >
            <span className="tv2-lb-count">
              {lightbox.index + 1} / {lightbox.photos.length}
            </span>
            <button
              type="button"
              className="tv2-lb-close"
              onClick={closeLightbox}
              aria-label="Close photo viewer"
            >
              <Icon name="close" size={18} />
            </button>
            <button
              type="button"
              className="tv2-lb-nav tv2-lb-nav--prev"
              onClick={() => stepLightbox(-1)}
              aria-label="Previous photo"
            >
              <Icon name="chevron-left" size={20} />
            </button>
            <img
              key={lightbox.index}
              className="tv2-lb-img"
              src={lightbox.photos[lightbox.index]}
              alt={`${CARD_DATA.name} photo ${lightbox.index + 1}`}
              onError={handleImgError}
            />
            <button
              type="button"
              className="tv2-lb-nav tv2-lb-nav--next"
              onClick={() => stepLightbox(1)}
              aria-label="Next photo"
            >
              <Icon name="chevron-right" size={20} />
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
};

export default function Page() {
  return <TapreviaProfile />;
}
