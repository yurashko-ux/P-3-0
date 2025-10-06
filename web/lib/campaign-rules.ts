// web/lib/campaign-rules.ts
// Допоміжні функції для нормалізації кампаній та правил V1/V2.

export type RuleLike =
  | string
  | number
  | boolean
  | null
  | undefined
  | { [key: string]: any };

export type CampaignLike = Record<string, any> & {
  rules?: Record<'v1' | 'v2' | string, RuleLike> | null;
};

const VALUE_KEYS = ['value', 'label', 'text', 'title', 'name', 'id', 'key', 'code'];

export function normalizeCandidate(value: unknown, depth = 12): string {
  if (depth <= 0 || value == null) return '';

  if (typeof value === 'string') {
    let s = value.trim();
    if (!s) return '';

    if ((s.startsWith('{') && s.endsWith('}')) || (s.startsWith('[') && s.endsWith(']'))) {
      try {
        const parsed = JSON.parse(s);
        const cand = normalizeCandidate(parsed, depth - 1);
        if (cand) return cand;
      } catch {}
    }

    if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
      const unquoted = s.slice(1, -1);
      const cand = normalizeCandidate(unquoted, depth - 1);
      if (cand) return cand;
    }

    return s;
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const cand = normalizeCandidate(item, depth - 1);
      if (cand) return cand;
    }
    return '';
  }

  if (typeof value === 'object') {
    for (const key of VALUE_KEYS) {
      if (Object.prototype.hasOwnProperty.call(value, key)) {
        const cand = normalizeCandidate((value as any)[key], depth - 1);
        if (cand) return cand;
      }
    }
    for (const v of Object.values(value as Record<string, unknown>)) {
      const cand = normalizeCandidate(v, depth - 1);
      if (cand) return cand;
    }
    return '';
  }

  return String(value);
}

function resolveOp(raw: unknown): 'contains' | 'equals' {
  if (typeof raw !== 'string') return 'contains';
  const lowered = raw.trim().toLowerCase();
  if (['equals', 'equal', 'eq', 'is', 'match'].includes(lowered)) return 'equals';
  if (['contains', 'contain', 'includes', 'include', 'has'].includes(lowered)) return 'contains';
  return 'contains';
}

export function resolveRule(rule: RuleLike): { op: 'contains' | 'equals'; value: string } | null {
  if (rule == null) return null;

  if (typeof rule === 'string' || typeof rule === 'number' || typeof rule === 'boolean') {
    const value = normalizeCandidate(rule).trim();
    if (!value) return null;
    return { op: 'contains', value };
  }

  if (Array.isArray(rule)) {
    for (const item of rule) {
      const resolved = resolveRule(item);
      if (resolved) return resolved;
    }
    return null;
  }

  if (typeof rule === 'object') {
    const obj = rule as Record<string, any>;
    const op = resolveOp(obj.op ?? obj.operator ?? obj.mode ?? obj.match ?? obj.type);
    const valueSource =
      obj.value ??
      obj.val ??
      obj.pattern ??
      obj.needle ??
      obj.text ??
      obj.target ??
      obj.content ??
      obj.rule ??
      obj.match ??
      obj.data ??
      obj.v ??
      obj.value1 ??
      obj.value2 ??
      obj.payload ??
      obj.body ??
      obj.src ??
      obj.source ??
      obj[0];
    const normalized = normalizeCandidate(
      valueSource !== undefined ? valueSource : obj,
    ).trim();
    if (!normalized) return null;
    return { op, value: normalized };
  }

  const fallback = normalizeCandidate(rule).trim();
  if (!fallback) return null;
  return { op: 'contains', value: fallback };
}

export function matchRuleAgainstInputs(inputs: string[], rule?: RuleLike): boolean {
  const resolved = resolveRule(rule ?? null);
  if (!resolved) return false;
  const needle = resolved.value.toLowerCase();
  if (!needle) return false;
  return inputs.some((input) => {
    const hay = normalizeCandidate(input).trim().toLowerCase();
    if (!hay) return false;
    if (resolved.op === 'equals') return hay === needle;
    return hay.includes(needle);
  });
}

const RULE_FALLBACK_KEYS = (
  slot: 'v1' | 'v2',
): string[] => [
  slot,
  `${slot}_value`,
  `${slot}Value`,
  `${slot.toUpperCase()}Value`,
  `${slot.toUpperCase()}_VALUE`,
  `${slot}_val`,
  `${slot}Val`,
  `${slot}_text`,
  `${slot}Text`,
  `${slot}_rule`,
  `${slot}Rule`,
  `${slot}_pattern`,
  `${slot}Pattern`,
  `${slot}_target`,
  `${slot}Target`,
];

export function pickRuleCandidate(campaign: CampaignLike, slot: 'v1' | 'v2'): RuleLike | undefined {
  if (campaign?.rules && campaign.rules[slot] != null) return campaign.rules[slot];
  for (const key of RULE_FALLBACK_KEYS(slot)) {
    if (Object.prototype.hasOwnProperty.call(campaign, key) && campaign[key] != null) {
      return campaign[key];
    }
  }
  return undefined;
}

export function chooseCampaignRoute(inputs: string[], campaign: CampaignLike): 'v1' | 'v2' | 'none' {
  const v1Rule = pickRuleCandidate(campaign, 'v1');
  const v2Rule = pickRuleCandidate(campaign, 'v2');
  const r1 = matchRuleAgainstInputs(inputs, v1Rule);
  const r2 = matchRuleAgainstInputs(inputs, v2Rule);
  if (r1 && !r2) return 'v1';
  if (r2 && !r1) return 'v2';
  if (r1 && r2) return 'v1';
  return 'none';
}
