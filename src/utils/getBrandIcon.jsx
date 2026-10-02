import {
  FaInstagram,
  FaLinkedin,
  FaXTwitter,
  FaFacebook,
  FaYoutube,
  FaGithub,
  FaWhatsapp,
  FaTiktok,
  FaSpotify,
  FaSnapchat,
  FaPinterest,
  FaTelegram,
  FaEnvelope,
  FaPhone,
  FaGlobe,
} from 'react-icons/fa6';

/**
 * Brand icon resolver for profile links.
 *
 * Parses the URL's hostname and returns the matching react-icons fa6 brand
 * glyph; unknown / general websites fall back to FaGlobe. Handles `mailto:` /
 * `tel:` schemes explicitly and exact hostname only — never a loose substring
 * match (`box.com` must not become the X logo).
 */
const BRAND_RULES = [
  { brand: FaInstagram, hosts: ['instagram.com', 'instagr.am'] },
  { brand: FaLinkedin, hosts: ['linkedin.com', 'lnkd.in'] },
  { brand: FaXTwitter, hosts: ['twitter.com', 'x.com'] },
  { brand: FaFacebook, hosts: ['facebook.com', 'fb.com', 'fb.me'] },
  { brand: FaYoutube, hosts: ['youtube.com', 'youtu.be', 'youtube-nocookie.com'] },
  { brand: FaGithub, hosts: ['github.com', 'github.io'] },
  { brand: FaWhatsapp, hosts: ['whatsapp.com', 'wa.me'] },
  { brand: FaTiktok, hosts: ['tiktok.com'] },
  { brand: FaSpotify, hosts: ['spotify.com'] },
  { brand: FaSnapchat, hosts: ['snapchat.com'] },
  { brand: FaPinterest, hosts: ['pinterest.com', 'pin.it'] },
  { brand: FaTelegram, hosts: ['telegram.org', 't.me'] },
];

function hostnameOf(url) {
  const raw = (url ?? '').trim();
  if (!raw) return null;
  try {
    return new URL(raw).hostname.toLowerCase();
  } catch {
    // No scheme (e.g. "tiktok.com/@user") → assume https.
    try {
      return new URL(`https://${raw.split(/[/?#]/)[0]}`).hostname.toLowerCase();
    } catch {
      return null;
    }
  }
}

export const getBrandIcon = (url) => {
  const raw = (url ?? '').trim();
  if (!raw) return <FaGlobe aria-hidden="true" />;

  const lower = raw.toLowerCase();
  if (lower.startsWith('mailto:')) return <FaEnvelope aria-hidden="true" />;
  if (lower.startsWith('tel:')) return <FaPhone aria-hidden="true" />;

  const host = hostnameOf(raw);
  if (host) {
    const rule = BRAND_RULES.find((r) =>
      r.hosts.some((h) => host === h || host.endsWith(`.${h}`))
    );
    if (rule) return <rule.brand aria-hidden="true" />;
  }

  return <FaGlobe aria-hidden="true" />;
};

export default getBrandIcon;