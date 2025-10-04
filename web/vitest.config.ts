import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";

const rootDir = dirname(fileURLToPath(new URL(import.meta.url)));

export default defineConfig({
  test: {
    environment: "node",
  },
  resolve: {
    alias: {
      "@": resolve(rootDir, "."),
    },
  },
});
