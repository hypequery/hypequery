/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ["@hypequery/react", "@hypequery/serve"],
  // Skip static optimization - this is a dynamic app with API calls
  skipTrailingSlashRedirect: false,
};

export default nextConfig;
