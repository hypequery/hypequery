/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@hypequery/core"],
  async rewrites() {
    return [
      {
        source: '/clickhouse/:path*',
        destination: 'http://localhost:8123/:path*',
      },
    ]
  },
};

module.exports = nextConfig; 