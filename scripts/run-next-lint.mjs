import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const webDir = resolve(__dirname, '../web');

function getBinaryPath(base, bin) {
  const ext = process.platform === 'win32' ? '.cmd' : '';
  return resolve(base, bin + ext);
}

function run(command, args, options) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, options);
    child.on('close', (code, signal) => {
      if (code === 0) {
        resolvePromise();
      } else {
        const signalInfo = signal ? `, signal ${signal}` : '';
        const error = new Error(`Command failed: ${command} ${args.join(' ')} (code ${code}${signalInfo})`);
        error.code = code ?? 1;
        rejectPromise(error);
      }
    });
    child.on('error', rejectPromise);
  });
}

async function main() {
  const nextBin = getBinaryPath(resolve(webDir, 'node_modules', '.bin'), 'next');
  const npmDir = resolve(process.execPath, '..', '..', 'lib', 'node_modules', 'npm', 'bin');
  const fallbackNpxDir = resolve(process.execPath, '..');
  const fallbackCommand = process.platform === 'win32' ? 'npx.cmd' : 'npx';

  const stdio = 'inherit';

  if (existsSync(nextBin)) {
    await run(nextBin, ['lint'], { cwd: webDir, stdio });
    return;
  }

  const candidateBins = [getBinaryPath(npmDir, 'npx'), getBinaryPath(fallbackNpxDir, 'npx')];
  const resolvedPath = candidateBins.find((bin) => typeof bin === 'string' && existsSync(bin));
  const command = resolvedPath ?? fallbackCommand;

  await run(command, ['--yes', 'next@14.2.7', 'lint'], { cwd: webDir, stdio });
}

main().catch((error) => {
  if (typeof error.code === 'number') {
    process.exit(error.code);
    return;
  }
  console.error(error);
  process.exit(1);
});
