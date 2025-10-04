import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import ts from 'typescript';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectDir = path.resolve(__dirname, '..');

const outDir = await mkdtemp(path.join(tmpdir(), 'manychat-tests-'));

const filesToTranspile = [
  {
    src: path.join(projectDir, 'app/api/mc/manychat/route.ts'),
    dest: path.join(outDir, 'app/api/mc/manychat/route.js'),
  },
  {
    src: path.join(projectDir, 'app/api/mc/manychat/route.test.ts'),
    dest: path.join(outDir, 'app/api/mc/manychat/route.test.js'),
  },
  {
    src: path.join(projectDir, 'lib/kv.ts'),
    dest: path.join(outDir, 'node_modules/@/lib/kv.js'),
  },
];

try {
  const nodeModulesDir = path.join(outDir, 'node_modules');
  await mkdir(nodeModulesDir, { recursive: true });
  const nextSource = path.join(projectDir, 'node_modules/next');
  const nextTarget = path.join(nodeModulesDir, 'next');
  await rm(nextTarget, { recursive: true, force: true });
  await symlink(nextSource, nextTarget, 'dir');

  for (const { src, dest } of filesToTranspile) {
    const source = await readFile(src, 'utf8');
    const result = ts.transpileModule(source, {
      compilerOptions: {
        module: ts.ModuleKind.NodeNext,
        moduleResolution: ts.ModuleResolutionKind.NodeNext,
        target: ts.ScriptTarget.ES2022,
        esModuleInterop: true,
        inlineSourceMap: true,
        jsx: ts.JsxEmit.Preserve,
      },
      fileName: src,
      reportDiagnostics: true,
    });

    if (result.diagnostics?.length) {
      const message = ts.formatDiagnosticsWithColorAndContext(result.diagnostics, {
        getCurrentDirectory: () => projectDir,
        getCanonicalFileName: (f) => f,
        getNewLine: () => '\n',
      });
      throw new Error(`TypeScript transpile failed for ${src}:\n${message}`);
    }

    await mkdir(path.dirname(dest), { recursive: true });
    await writeFile(dest, result.outputText, 'utf8');
  }

  const testUrl = pathToFileURL(path.join(outDir, 'app/api/mc/manychat/route.test.js')).href;
  await import(testUrl);
} finally {
  await rm(outDir, { recursive: true, force: true });
}
