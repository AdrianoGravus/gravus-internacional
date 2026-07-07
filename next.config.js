/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: false,
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: '**' },
    ],
  },
  async rewrites() {
    return [
      { source: '/', destination: '/internacional.html' },
      { source: '/tv', destination: '/internacional.html' },
    ];
  },
};

module.exports = nextConfig;
