/* eslint-disable no-console */
const { spawnSync } = require("node:child_process");

// Увімкнено в vercel.json (RUN_PRISMA_MIGRATE_ON_BUILD=1), щоб нові міграції (напр. communicationChannel) потрапляли в прод-БД під час build.
const shouldRun = process.env.RUN_PRISMA_MIGRATE_ON_BUILD === "1";

if (!shouldRun) {
  console.log(
    "[build] Пропуск prisma migrate deploy (додай RUN_PRISMA_MIGRATE_ON_BUILD=1 у Vercel env або vercel.json)."
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
