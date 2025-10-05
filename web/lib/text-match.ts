export type Rule = { op: 'contains' | 'equals'; value: string };

export function cleanInput(value: unknown, fallback = ''): string {
  const str = typeof value === 'string' ? value : fallback;
  if (!str) return '';
  return str.trim().normalize('NFKC');
}

export function canonicalLower(value: unknown): string {
  return cleanInput(value).toLowerCase();
}

export function matchRuleNormalized(text: unknown, rule?: Rule): boolean {
  if (!rule || !rule.value) return false;
  const hay = canonicalLower(typeof text === 'string' ? text : '');
  const needle = canonicalLower(rule.value);
  if (rule.op === 'equals') return hay === needle;
  if (rule.op === 'contains') return hay.includes(needle);
  return false;
}
