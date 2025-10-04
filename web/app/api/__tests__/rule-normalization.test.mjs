import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function extractFunction(source, name) {
  const exportSignature = `export function ${name}`;
  const internalSignature = `function ${name}`;
  let start = source.indexOf(exportSignature);
  if (start === -1) {
    start = source.indexOf(internalSignature);
  }
  if (start === -1) {
    throw new Error(`Unable to locate function ${name}`);
  }
  const braceStart = source.indexOf('{', start);
  let depth = 0;
  let end = braceStart;
  while (end < source.length) {
    const char = source[end];
    if (char === '{') {
      depth += 1;
    } else if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        end += 1;
        break;
      }
    }
    end += 1;
  }
  return source.slice(start, end);
}

function stripTypes(code) {
  return code
    .replace(/export\s+/g, '')
    .replace(/([A-Za-z0-9_]+)\?:\s*[^,)=]+/g, '$1')
    .replace(/:\s*[A-Za-z_$][A-Za-z0-9_<>'"\[\]\|?]*/g, '')
    .replace(/ as [^;\)\],]+/g, '');
}

function loadFunctions(relativePath, include, exported) {
  const absPath = path.resolve(__dirname, relativePath);
  const source = fs.readFileSync(absPath, 'utf8');
  const pieces = include.map((name) => stripTypes(extractFunction(source, name)));
  const exportEntries = exported.map((name) => `${name}: ${name}`).join(', ');
  const script = `${pieces.join('\n')}\nmodule.exports = { ${exportEntries} };`;
  const module = { exports: {} };
  vm.runInNewContext(script, { module, exports: module.exports });
  return module.exports;
}

const manychat = loadFunctions('../mc/manychat/route.ts', ['sanitize', 'normalize', 'toMatchable', 'matchRule'], ['matchRule']);
const keycrm = loadFunctions('../keycrm/sync/pair/route.ts', ['normStr', 'toMatchable', 'matchRule'], ['normStr', 'matchRule']);

const { matchRule: manychatMatchRule } = manychat;
const { matchRule: keycrmMatchRule, normStr } = keycrm;

const decomposedCafe = 'cafe\u0301';
const composedCafe = 'Café';
const normalizedCafe = 'café';

test('ManyChat equals rule matches trimmed and normalized values', () => {
  const text = `  ${composedCafe}  `;
  const rule = { op: 'equals', value: decomposedCafe };
  assert.ok(manychatMatchRule(text, rule));
});

test('ManyChat contains rule matches trimmed and normalized values', () => {
  const text = `  Weekly deals: ${decomposedCafe} latte  `;
  const rule = { op: 'contains', value: ` ${composedCafe} ` };
  assert.ok(manychatMatchRule(text, rule));
});

test('KeyCRM equals rule matches trimmed and normalized values', () => {
  const text = `\u00a0${composedCafe}\u00a0`;
  const rule = { op: 'equals', value: decomposedCafe };
  assert.ok(keycrmMatchRule(text, rule));
});

test('KeyCRM contains rule matches trimmed and normalized values', () => {
  const text = `  Fresh ${decomposedCafe} tastings  `;
  const rule = { op: 'contains', value: ` ${composedCafe} ` };
  assert.ok(keycrmMatchRule(text, rule));
});

test('KeyCRM normStr normalizes unicode and trims', () => {
  const raw = `  ${decomposedCafe}  `;
  assert.equal(normStr(raw), normalizedCafe);
});
