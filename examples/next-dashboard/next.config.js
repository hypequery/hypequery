/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@hypequery/clickhouse", "@hypequery/react", "@hypequery/serve"],
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