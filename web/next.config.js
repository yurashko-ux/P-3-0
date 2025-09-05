/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: { appDir: true },
  // важливо: тут НЕ має бути `output: 'export'`, бо тоді /api/* не існують
  typescript: { ignoreBuildErrors: true },
  eslint: { ignoreDuringBuilds: true }
};
module.exports = nextConfig;
