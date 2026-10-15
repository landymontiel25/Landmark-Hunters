import type { NextConfig } from 'next';
import path from 'node:path';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // This app lives inside the Landmark Hunters repo; keep Next from using the
  // repo root as the workspace root.
  turbopack: { root: path.resolve(__dirname) },
  outputFileTracingRoot: path.resolve(__dirname),
  poweredByHeader: false,
  experimental: {
    // Profile photos upload through a server action. The action rejects
    // anything over 5 MB; this limit leaves room for the form fields.
    serverActions: { bodySizeLimit: '6mb' },
  },
};

export default nextConfig;
