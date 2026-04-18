#!/usr/bin/env node
/* eslint-disable no-console */
const { spawnSync } = require("node:child_process");

require("./ensure-database-url-unpooled.js");

const result = spawnSync("npx", ["prisma", "generate"], {
  stdio: "inherit",
  shell: process.platform === "win32",
  env: process.env,
});

process.exit(result.status ?? 0);
