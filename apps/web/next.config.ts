import path from 'node:path';
import type { NextConfig } from 'next';

const API_URL = process.env.API_URL ?? 'http://localhost:4000';

const config: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // @kora/ui ships TypeScript source; Next compiles it with the app.
  transpilePackages: ['@kora/ui'],
  turbopack: { root: path.join(__dirname, '../..') },
  outputFileTracingRoot: path.join(__dirname, '../..'),

  // The browser only ever talks to this origin. /api/* is forwarded to the
  // API, so session cookies are first-party and there is no CORS to manage.
  async rewrites() {
    return [{ source: '/api/:path*', destination: `${API_URL}/:path*` }];
  },

  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
        ],
      },
    ];
  },
};

export default config;
