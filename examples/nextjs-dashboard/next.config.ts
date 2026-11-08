import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // The ClickHouse client is a Node package; keep it out of the browser bundle.
  serverExternalPackages: ['@clickhouse/client'],
};

export default nextConfig;
