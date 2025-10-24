// web/next.config.js
const path = require("path");

const LOCKDOWN_GUARD_ENTRY = "./lib/polyfills/lockdown-guard.ts";

function withLockdownGuard(entryValue) {
  if (!entryValue) return entryValue;

  if (Array.isArray(entryValue)) {
    return entryValue.includes(LOCKDOWN_GUARD_ENTRY)
      ? entryValue
      : [LOCKDOWN_GUARD_ENTRY, ...entryValue];
  }

  if (typeof entryValue === "string") {
    return entryValue === LOCKDOWN_GUARD_ENTRY
      ? entryValue
      : [LOCKDOWN_GUARD_ENTRY, entryValue];
  }

  if (typeof entryValue === "object" && Array.isArray(entryValue.import)) {
    entryValue.import = withLockdownGuard(entryValue.import);
    return entryValue;
  }

  return entryValue;
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    serverActions: {
      allowedOrigins: ["*"],
    },
  },
  webpack(config) {
    config.resolve.alias = {
      ...(config.resolve.alias || {}),
      "@": path.resolve(__dirname),
    };

    if (typeof config.entry === "function") {
      const originalEntry = config.entry;
      config.entry = async () => {
        const entries = await originalEntry();
        for (const key of Object.keys(entries)) {
          entries[key] = withLockdownGuard(entries[key]);
        }
        return entries;
      };
    } else if (config.entry && typeof config.entry === "object") {
      for (const key of Object.keys(config.entry)) {
        config.entry[key] = withLockdownGuard(config.entry[key]);
      }
    }

    return config;
  },
};

module.exports = nextConfig;
