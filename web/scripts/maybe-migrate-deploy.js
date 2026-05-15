/* eslint-disable no-console */
const { spawnSync } = require("node:child_process");

// На Vercel міграції мають застосовуватись під час build, інакше нові API можуть
// поїхати в production раніше за таблиці/колонки, які вони використовують.
const shouldRun = process.env.RUN_PRISMA_MIGRATE_ON_BUILD === "1" || process.env.VERCEL === "1";

if (!shouldRun) {
  console.log(
    "[build] Пропуск prisma migrate deploy (локальний build без RUN_PRISMA_MIGRATE_ON_BUILD=1)."
  );
  process.exit(0);
}

console.log("[build] Vercel/RUN_PRISMA_MIGRATE_ON_BUILD -> running prisma migrate deploy...");
const result = spawnSync("npx", ["prisma", "migrate", "deploy"], {
  stdio: "inherit",
  shell: process.platform === "win32",
  env: process.env,
});

if (result.status !== 0) {
  process.exit(result.status || 1);
}

console.log("[build] prisma migrate deploy completed.");
