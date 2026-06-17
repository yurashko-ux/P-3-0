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

// Якщо попередній deploy залишив failed migration (P3009), дозволяємо повторно застосувати ідемпотентний SQL.
const failedMigrationsToResolve = ["20260617180000_add_reconciliation_number"];
for (const migrationName of failedMigrationsToResolve) {
  const resolveResult = spawnSync(
    "npx",
    ["prisma", "migrate", "resolve", "--rolled-back", migrationName],
    {
      stdio: "pipe",
      shell: process.platform === "win32",
      env: process.env,
      encoding: "utf8",
    },
  );
  if (resolveResult.status === 0) {
    console.log(`[build] prisma migrate resolve --rolled-back ${migrationName}`);
  }
}

const result = spawnSync("npx", ["prisma", "migrate", "deploy"], {
  stdio: "inherit",
  shell: process.platform === "win32",
  env: process.env,
});

if (result.status !== 0) {
  process.exit(result.status || 1);
}

console.log("[build] prisma migrate deploy completed.");
