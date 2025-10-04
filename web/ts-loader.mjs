import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { resolve as resolvePath } from "node:path";
import ts from "typescript";

const projectRoot = fileURLToPath(new URL("./", import.meta.url));

export async function resolve(specifier, context, defaultResolve) {
  if (specifier === "@vercel/kv") {
    const url = pathToFileURL(resolvePath(projectRoot, "tests/mocks/kv.ts"));
    return { url: url.href, shortCircuit: true };
  }
  if (specifier === "@/lib/keycrm") {
    const url = pathToFileURL(resolvePath(projectRoot, "tests/mocks/keycrm.ts"));
    return { url: url.href, shortCircuit: true };
  }
  if (specifier === "next/server") {
    const url = pathToFileURL(resolvePath(projectRoot, "tests/mocks/next-server.ts"));
    return { url: url.href, shortCircuit: true };
  }
  if (specifier.startsWith("@/")) {
    const basePath = resolvePath(projectRoot, specifier.slice(2));
    const candidates = [
      basePath,
      `${basePath}.ts`,
      `${basePath}.tsx`,
      `${basePath}.js`,
      `${basePath}.mjs`,
      `${basePath}.cjs`,
      resolvePath(basePath, "index.ts"),
      resolvePath(basePath, "index.tsx"),
      resolvePath(basePath, "index.js"),
    ];
    for (const candidate of candidates) {
      if (candidate && existsSync(candidate)) {
        const url = pathToFileURL(candidate);
        return { url: url.href, shortCircuit: true };
      }
    }
    const fallback = pathToFileURL(basePath);
    return defaultResolve(fallback.href, context, defaultResolve);
  }
  return defaultResolve(specifier, context, defaultResolve);
}

export async function load(url, context, defaultLoad) {
  if (url.endsWith(".ts")) {
    const source = await readFile(fileURLToPath(url), "utf8");
    const { outputText } = ts.transpileModule(source, {
      compilerOptions: {
        module: ts.ModuleKind.ESNext,
        target: ts.ScriptTarget.ES2022,
        jsx: ts.JsxEmit.Preserve,
        moduleResolution: ts.ModuleResolutionKind.NodeNext,
        esModuleInterop: true,
      },
      fileName: fileURLToPath(url),
    });
    return { format: "module", source: outputText, shortCircuit: true };
  }
  return defaultLoad(url, context, defaultLoad);
}
