import test from 'node:test';
import assert from 'node:assert/strict';
import Module from 'node:module';

const requireFromHere = Module.createRequire(import.meta.url);
const originalResolve = Module._resolveFilename;
Module._resolveFilename = function (request, parent, isMain, options) {
  if (request === '@/lib/kv') {
    return requireFromHere.resolve('./.dist/tests/.stubs/lib/kv.js');
  }
  return originalResolve.call(this, request, parent, isMain, options);
};

const { normalize: mcNormalize, matchRule: mcMatchRule } = await import('./.dist/app/api/mc/manychat/route.js');
const { matchRule: pairMatchRule } = await import('./.dist/app/api/keycrm/sync/pair/route.js');

test('ManyChat normalize trims and applies NFKC', () => {
  const payload = {
    message: { text: '  Cafe\u0301  ' },
    subscriber: { username: '  ＦｏｏＢａｒ  ' },
  };

  const normalized = mcNormalize(payload);

  assert.equal(normalized.text, 'Café');
  assert.equal(normalized.handle, 'FooBar');
  assert.equal(normalized.title, 'IG Message');
});

test('ManyChat matchRule matches despite whitespace/unicode differences', () => {
  const equalsRule = { op: 'equals', value: 'café' };
  const containsRule = { op: 'contains', value: 'foobar' };

  assert.ok(mcMatchRule('  Cafe\u0301  ', equalsRule));
  assert.ok(mcMatchRule('  --ＦｏｏＢａｒ--  ', containsRule));
});

test('KeyCRM matchRule applies the same normalization', () => {
  const equalsRule = { op: 'equals', value: 'café' };
  const containsRule = { op: 'contains', value: 'foobar' };

  assert.ok(pairMatchRule('  Cafe\u0301  ', equalsRule));
  assert.ok(pairMatchRule('  --ＦｏｏＢａｒ--  ', containsRule));
});
