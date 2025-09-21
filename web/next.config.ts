// web/next.config.ts
import type { NextConfig } from 'next';
import path from 'path';

const nextConfig: NextConfig = {
  webpack(config) {
    config.resolve.alias = {
      ...(config.resolve.alias || {}),
      '@': path.resolve(__dirname), // тепер '@/lib/kv' => web/lib/kv.ts
    };
    return config;
  },
};

export default nextConfig;

