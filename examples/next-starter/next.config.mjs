/** @type {import('next').NextConfig} */
const nextConfig = {
  // Skip static optimization - this is a dynamic app with API calls
  skipTrailingSlashRedirect: false,
};

export default nextConfig;
