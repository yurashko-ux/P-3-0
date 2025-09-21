// web/next.config.js
/** @type {import('next').NextConfig} */
const path = require('path');

const nextConfig = {
  // remove invalid experimental.tsconfigPaths
  webpack: (config) => {
    // Map "@/..." to the web/ directory explicitly
    config.resolve.alias['@'] = path.resolve(__dirname);
    return config;
  },
};

module.exports = nextConfig;
