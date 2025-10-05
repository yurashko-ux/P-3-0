import { test } from 'node:test';
import { strict as assert } from 'node:assert';

import { matchRuleNormalized, cleanInput, type Rule } from '../lib/text-match';

test('cleanInput trims whitespace and normalizes canonical forms', () => {
  const raw = '  Cafe\u0301  ';
  const result = cleanInput(raw);
  assert.equal(result, 'Café');
});

test('equals rules match across whitespace and Unicode forms', () => {
  const decomposedCafe = 'Cafe\u0301';
  const text = `  ${decomposedCafe}  `; // leading/trailing whitespace + decomposed accent
  const rule: Rule = { op: 'equals', value: 'CAFÉ' }; // composed + uppercase

  assert.equal(matchRuleNormalized(text, rule), true);
});

test('contains rules match across whitespace and Unicode forms', () => {
  const composedCafe = 'Café';
  const text = `\nHello ${composedCafe}!`;
  const rule: Rule = { op: 'contains', value: ' cafe\u0301 ' }; // decomposed + padded

  assert.equal(matchRuleNormalized(text, rule), true);
});
