/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    // The app renders media through plain <img> (uploaded via the storage
    // layer), so no remote hosts are needed. Open remotePatterns is an SSRF
    // hazard for any future next/image adoption. Explicitly allow remote hosts
    // via IMAGE_HOSTS (comma-separated), otherwise only same-origin media works.
    remotePatterns: (process.env.IMAGE_HOSTS ?? '')
      .split(',')
      .map((h) => h.trim())
      .filter(Boolean)
      .map((hostname) => ({ protocol: 'https', hostname })),
  },
  // Legacy CRM routes removed in the redesign — permanently redirect
  // bookmarks/history entries so users never land on stale UI again.
  async redirects() {
    return [
      { source: '/dashboard/profile', destination: '/dashboard/vcards', permanent: true },
      { source: '/dashboard/leads', destination: '/dashboard/inquiries', permanent: true },
    ];
  },
  async headers() {
    const isProd = process.env.NODE_ENV === 'production';
    // Next injects its RSC bootstrap payload as inline <script>; React styles
    // are inline style props. 'unsafe-inline' is therefore required, but remote
    // script/blob/data execution and framing are still blocked.
    const scriptSrc = isProd
      ? "'self' 'unsafe-inline'"
      : "'self' 'unsafe-inline' 'unsafe-eval'";
    const csp = [
      "default-src 'self'",
      `script-src ${scriptSrc}`,
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "img-src 'self' data: blob: https:",
      "font-src 'self' data: https://fonts.gstatic.com",
      "connect-src 'self' https: https://*.r2.cloudflarestorage.com",
      "media-src 'self' blob:",
      "object-src 'none'",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join('; ');

    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'Content-Security-Policy', value: csp },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'no-referrer' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), interest-cohort=()' },
          { key: 'X-Frame-Options', value: 'DENY' },
          ...(isProd
            ? [{ key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' }]
            : []),
        ],
      },
    ];
  },
};

export default nextConfig;
