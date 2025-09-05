/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // без `output: 'export'` і без experimental.appDir — щоб API працювали
  typescript: { ignoreBuildErrors: true },
  eslint: { ignoreDuringBuilds: true },
};
module.exports = nextConfig;
