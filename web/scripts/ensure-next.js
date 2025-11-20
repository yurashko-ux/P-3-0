#!/usr/bin/env node
const { existsSync } = require('fs');
const { join } = require('path');
const { spawnSync } = require('child_process');

const root = process.cwd();
const binName = process.platform === 'win32' ? 'next.cmd' : 'next';
const nextBinPath = join(root, 'node_modules', '.bin', binName);
const nextPkgPath = join(root, 'node_modules', 'next', 'package.json');

if (existsSync(nextBinPath) || existsSync(nextPkgPath)) {
  process.exit(0);
}

const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const result = spawnSync(npmCmd, ['install'], { stdio: 'inherit', cwd: root });

if (result.error) {
  console.error('[ensure-next] Failed to run npm install:', result.error.message);
  process.exit(result.status ?? 1);
}

process.exit(result.status ?? 0);
