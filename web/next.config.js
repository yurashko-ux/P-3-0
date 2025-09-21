// web/next.config.js
/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    // Force Next to honor tsconfig "paths" -> "@/..." imports
    tsconfigPaths: true,
  },
};

module.exports = nextConfig;

