/** @type {import('next').NextConfig} */
// No remote image hosts are configured: the site imports next/image nowhere, and
// a wildcard remotePatterns entry turns the optimizer into an open proxy.
const nextConfig = {
  poweredByHeader: false,
  async headers() {
    return [{
      source: '/:path*',
      headers: [
        { key: 'X-Content-Type-Options', value: 'nosniff' },
        { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
      ],
    }];
  },
};
module.exports = nextConfig;
