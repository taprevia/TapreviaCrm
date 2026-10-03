/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    // The app renders media through plain <img> (uploaded via the storage
    // layer), so no remote hosts are needed today. Open remotePatterns is an
    // SSRF hazard for any future next/image adoption. Allowlist remote hosts
    // via IMAGE_HOSTS (comma-separated) instead.
    //
    // Hostnames must NOT include a scheme or path: next/image matches
    // `hostname` literally, so an operator writing the natural
    // "https://cdn.example.com" silently produced a pattern that could never
    // match (and images then failed validation). Normalise it away, and add
    // port + wildcard variants for convenience.
    remotePatterns: (process.env.IMAGE_HOSTS ?? '')
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean)
      .map((entry) => {
        // Strip scheme, credentials, path and trailing slash -> bare hostname.
        const hostname = entry
          .replace(/^[a-z][a-z0-9+.-]*:\/\//i, '')
          .replace(/^[^@/]*@/, '')
          .replace(/[/?#].*$/, '')
          .replace(/:(\d+)$/, '')
          .toLowerCase();
        return hostname ? [{ protocol: 'https', hostname }] : [];
      })
      .flat(),
    // Candidate widths the optimizer may generate for `sizes`-based images;
    // any requested width outside this list 400s at /_next/image.
    // NOTE: this is byte-identical to next's built-in default, so it is
    // documentation rather than a fix — see git history for the real cause of
    // the earlier 400s (pre-encoded `%20` image paths, since resolved).
    deviceSizes: [640, 750, 828, 1080, 1200, 1920, 2048, 3840],
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
