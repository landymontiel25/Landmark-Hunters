import type { NextConfig } from 'next';
import path from 'node:path';

// The admin dashboard is its own Vercel project (Root Directory:
// admin-dashboard). Strict security headers: no framing, no sniffing, no
// referrer leak, and the page is never indexed.
const nextConfig: NextConfig = {
  reactStrictMode: true,
  // This folder is its own app inside the main repo: keep Next from treating
  // the repo root (the main app's lockfile) as the workspace root.
  turbopack: { root: path.resolve(__dirname) },
  outputFileTracingRoot: path.resolve(__dirname),
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'no-referrer' },
          { key: 'X-Robots-Tag', value: 'noindex, nofollow' },
          { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' },
          { key: 'Permissions-Policy', value: 'camera=(), geolocation=(), microphone=()' },
        ],
      },
    ];
  },
};

export default nextConfig;
