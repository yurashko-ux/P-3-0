// web/next.config.ts
import type { NextConfig } from 'next';
import path from 'path';

const nextConfig: NextConfig = {
  webpack(config) {
    config.resolve.alias = {
      ...(config.resolve.alias || {}),
      '@': path.resolve(__dirname), // тепер '@/lib/kv' => web/lib/kv.ts
    };

    const guardEntry = "./lib/polyfills/lockdown-guard.ts";
    if (typeof config.entry === "function") {
      const originalEntry = config.entry;
      config.entry = async () => {
        const entries = await originalEntry();
        for (const name of Object.keys(entries)) {
          const value = entries[name];
          if (Array.isArray(value)) {
            if (!value.includes(guardEntry)) {
              entries[name] = [guardEntry, ...value];
            }
          } else if (typeof value === "string") {
            entries[name] = value === guardEntry ? value : [guardEntry, value];
          }
        }
        return entries;
      };
    }

    return config;
  },
};

export default nextConfig;

