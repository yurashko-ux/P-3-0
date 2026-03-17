/* eslint-disable no-console */
const { spawnSync } = require("node:child_process");

const shouldRun = process.env.RUN_PRISMA_MIGRATE_ON_BUILD === "1";

if (!shouldRun) {
  console.log(
    "[build] Skip prisma migrate deploy (set RUN_PRISMA_MIGRATE_ON_BUILD=1 to enable)."
  );
  process.exit(0);
}

console.log("[build] RUN_PRISMA_MIGRATE_ON_BUILD=1 -> running prisma migrate deploy...");
const result = spawnSync("npx", ["prisma", "migrate", "deploy"], {
  stdio: "inherit",
  shell: process.platform === "win32",
  env: process.env,
});

if (result.status !== 0) {
  process.exit(result.status || 1);
}

console.log("[build] prisma migrate deploy completed.");
