import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import ts from 'typescript';

const projectRoot = process.cwd();

export async function resolve(specifier, context, defaultResolve) {
  if (specifier.startsWith('@/')) {
    const candidate = path.join(projectRoot, specifier.slice(2));
    const withExt = await resolveWithExtension(candidate);
    if (withExt) {
      return { url: pathToFileURL(withExt).href, shortCircuit: true };
    }
  }

  if (specifier.startsWith('next/')) {
    const candidate = path.join(projectRoot, 'node_modules', 'next', specifier.slice(5));
    const withExt = await resolveWithExtension(candidate);
    if (withExt) {
      return { url: pathToFileURL(withExt).href, shortCircuit: true };
    }
  }

  // Allow importing TypeScript files without extension by checking the filesystem.
  if (!specifier.startsWith('node:') && !specifier.startsWith('file:') && !specifier.includes(':')) {
    const parentURL = context.parentURL ? new URL(context.parentURL) : pathToFileURL(path.join(projectRoot, 'index.ts'));
    const parentDir = parentURL.protocol === 'file:' ? path.dirname(fileURLToPath(parentURL)) : projectRoot;
    const candidate = path.resolve(parentDir, specifier);
    const withExt = await resolveWithExtension(candidate);
    if (withExt) {
      return { url: pathToFileURL(withExt).href, shortCircuit: true };
    }
  }

  return defaultResolve(specifier, context, defaultResolve);
}

async function resolveWithExtension(candidate) {
  const extensions = ['', '.ts', '.tsx', '.js', '/index.ts', '/index.tsx'];
  for (const ext of extensions) {
    const full = ext.startsWith('/') ? candidate + ext : candidate + ext;
    try {
      const file = await stat(full);
      if (file.isFile()) {
        return full;
      }
    } catch {
      // continue
    }
  }
  return null;
}

export async function load(url, context, defaultLoad) {
  if (url.endsWith('.ts') || url.endsWith('.tsx')) {
    const source = await readFile(fileURLToPath(url), 'utf8');
    const { outputText } = ts.transpileModule(source, {
      compilerOptions: {
        module: ts.ModuleKind.ES2022,
        target: ts.ScriptTarget.ES2022,
        jsx: ts.JsxEmit.Preserve,
        moduleResolution: ts.ModuleResolutionKind.NodeNext,
        esModuleInterop: true,
        allowJs: true,
      },
      fileName: fileURLToPath(url),
    });
    return {
      format: 'module',
      source: outputText,
      shortCircuit: true,
    };
  }
  return defaultLoad(url, context, defaultLoad);
}
