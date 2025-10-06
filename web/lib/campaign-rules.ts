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
  rules?: unknown;
};

type RulesRecord = Record<string, RuleLike>;

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

type CollectOpts = {
  limit?: number;
  maxDepth?: number;
};

export function collectRuleCandidates(
  payload: unknown,
  seeds: Iterable<unknown> = [],
  opts: CollectOpts = {},
): { values: string[]; truncated: boolean } {
  const limit = Math.max(1, Math.min(opts.limit ?? 50, 500));
  const maxDepth = Math.max(1, Math.min(opts.maxDepth ?? 12, 20));
  const values = new Set<string>();
  let truncated = false;
  const visited = typeof WeakSet !== 'undefined' ? new WeakSet<object>() : undefined;

  const add = (raw: unknown) => {
    if (values.size >= limit) {
      truncated = true;
      return;
    }
    const normalized = normalizeCandidate(raw).trim();
    if (!normalized || values.has(normalized)) return;
    values.add(normalized);
  };

  const walk = (value: unknown, depth: number) => {
    if (depth <= 0 || value == null || values.size >= limit) return;

    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      add(value);
      return;
    }

    if (Array.isArray(value)) {
      if (visited) {
        if (visited.has(value as object)) return;
        visited.add(value as object);
      }
      for (const item of value) {
        walk(item, depth - 1);
        if (values.size >= limit) return;
      }
      return;
    }

    if (typeof value === 'object') {
      const obj = value as Record<string, unknown>;
      if (visited) {
        if (visited.has(obj)) return;
        visited.add(obj);
      }
      for (const v of Object.values(obj)) {
        walk(v, depth - 1);
        if (values.size >= limit) return;
      }
    }
  };

  for (const seed of seeds) {
    add(seed);
    if (values.size >= limit) break;
  }

  walk(payload, maxDepth);

  return { values: Array.from(values), truncated };
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

const RULE_SOURCE_KEYS = [
  'rules',
  'Rules',
  'rules_json',
  'rulesJson',
  'rulesStr',
  'rulesString',
  'rules_data',
  'rulesData',
  'rulesRaw',
  'rules_raw',
];

function parseMaybeJson(value: unknown): unknown {
  if (typeof value !== 'string') return value ?? null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
}

function inferSlotFromHint(hint: unknown): 'v1' | 'v2' | null {
  if (typeof hint !== 'string') return null;
  const lowered = hint.trim().toLowerCase();
  if (!lowered) return null;
  const compact = lowered.replace(/[^a-z0-9]+/g, '');
  if (!compact) return null;
  if (compact.endsWith('v1') || compact === '1' || compact === 'route1' || compact === 'target1') return 'v1';
  if (compact.endsWith('v2') || compact === '2' || compact === 'route2' || compact === 'target2') return 'v2';
  if (lowered.includes('v1') || lowered.includes('route1') || lowered.includes('target1')) return 'v1';
  if (lowered.includes('v2') || lowered.includes('route2') || lowered.includes('target2')) return 'v2';
  return null;
}

function ruleValueFromEntry(entry: Record<string, any>, slot: 'v1' | 'v2'): RuleLike | undefined {
  for (const key of RULE_FALLBACK_KEYS(slot)) {
    if (Object.prototype.hasOwnProperty.call(entry, key) && entry[key] != null) {
      return entry[key];
    }
  }

  const fallback =
    entry.value ??
    entry.val ??
    entry.text ??
    entry.pattern ??
    entry.needle ??
    entry.rule ??
    entry.target ??
    entry.payload ??
    entry.data ??
    entry.match ??
    entry.expression ??
    entry.condition ??
    entry.content;

  if (fallback !== undefined) return fallback;
  return entry as RuleLike;
}

function materializeRules(campaign: CampaignLike): RulesRecord | null {
  const seen = new Set<any>();

  const merge = (source: RulesRecord | null | undefined, incoming: RulesRecord | null | undefined) => {
    if (!incoming) return source ?? null;
    const base = source ? { ...source } : {};
    for (const [key, value] of Object.entries(incoming)) {
      if (value != null && base[key] == null) {
        base[key] = value;
      }
    }
    return base;
  };

  const normaliseRecord = (input: unknown): RulesRecord | null => {
    if (!input) return null;
    if (typeof input === 'string') {
      return normaliseRecord(parseMaybeJson(input));
    }
    if (Array.isArray(input)) {
      const out: RulesRecord = {};
      for (const raw of input) {
        if (!raw || typeof raw !== 'object') continue;
        if (seen.has(raw)) continue;
        seen.add(raw);
        const entry = raw as Record<string, any>;
        let slot: 'v1' | 'v2' | null = null;
        for (const candidate of ['v1', 'v2'] as const) {
          if (slot) break;
          for (const key of RULE_FALLBACK_KEYS(candidate)) {
            if (Object.prototype.hasOwnProperty.call(entry, key) && entry[key] != null) {
              slot = candidate;
              break;
            }
          }
        }
        if (!slot) {
          const hint =
            entry.slot ??
            entry.key ??
            entry.name ??
            entry.field ??
            entry.route ??
            entry.target ??
            entry.id ??
            entry.code ??
            entry.type ??
            entry.mode ??
            entry.match ??
            entry.channel ??
            entry.step;
          slot = inferSlotFromHint(hint);
        }
        if (!slot) continue;
        if (out[slot] != null) continue;
        const value = ruleValueFromEntry(entry, slot);
        if (value != null) {
          out[slot] = value;
        }
      }
      return Object.keys(out).length ? out : null;
    }
    if (typeof input === 'object') {
      return input as RulesRecord;
    }
    return null;
  };

  let aggregated: RulesRecord | null = null;
  for (const key of RULE_SOURCE_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(campaign, key)) continue;
    aggregated = merge(aggregated, normaliseRecord((campaign as any)[key]));
  }

  if (!aggregated) {
    aggregated = normaliseRecord((campaign as any).rules);
  }

  return aggregated;
}

export function pickRuleCandidate(campaign: CampaignLike, slot: 'v1' | 'v2'): RuleLike | undefined {
  const materialized = materializeRules(campaign);
  if (materialized && materialized[slot] != null) {
    return materialized[slot];
  }

  if (materialized) {
    for (const key of RULE_FALLBACK_KEYS(slot)) {
      if (Object.prototype.hasOwnProperty.call(materialized, key) && materialized[key] != null) {
        return materialized[key];
      }
    }
    for (const [key, value] of Object.entries(materialized)) {
      const slotGuess = inferSlotFromHint(key);
      if (slotGuess === slot && value != null) {
        return value;
      }
    }
  }

  for (const key of RULE_FALLBACK_KEYS(slot)) {
    if (Object.prototype.hasOwnProperty.call(campaign, key) && (campaign as any)[key] != null) {
      return (campaign as any)[key];
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
