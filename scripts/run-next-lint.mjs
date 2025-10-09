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
  const nextCli = resolve(webDir, 'node_modules', 'next', 'dist', 'bin', 'next');

  const stdio = 'inherit';

  if (existsSync(nextBin)) {
    await run(nextBin, ['lint'], { cwd: webDir, stdio });
    return;
  }

  if (existsSync(nextCli)) {
    await run(process.execPath, [nextCli, 'lint'], { cwd: webDir, stdio });
    return;
  }

  const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  try {
    await run(npmCommand, ['--prefix', webDir, 'run', 'lint'], { stdio });
    return;
  } catch (error) {
    const npxCommand = process.platform === 'win32' ? 'npx.cmd' : 'npx';
    await run(npxCommand, ['--yes', 'next@14.2.7', 'lint'], { cwd: webDir, stdio });
  }
}

main().catch((error) => {
  if (typeof error.code === 'number') {
    process.exit(error.code);
    return;
  }
  console.error(error);
  process.exit(1);
});
