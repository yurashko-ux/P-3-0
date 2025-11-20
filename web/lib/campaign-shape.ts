// web/lib/campaign-shape.ts
// Utility to consistently unwrap campaign objects coming from KV (value/result wrappers, JSON strings, etc.)

export type CampaignShape = Record<string, any>;

const SHAPE_KEYS = new Set(['id', 'name', 'base', 'rules', 'v1', 'v2', 'texp']);
const WRAPPER_KEYS = ['value', 'result', 'data', 'payload', 'item', 'campaign'];

/**
 * Traverses an arbitrary payload coming from KV (stringified JSON, objects wrapped in {value: {...}}, arrays, etc.)
 * and returns the first object that looks like a campaign (has id/base/...).
 */
export function normalizeCampaignShape<T = CampaignShape>(raw: any): T | null {
  if (raw == null) return null;

  const stack: any[] = [raw];
  const visited = new Set<any>();

  while (stack.length) {
    const value = stack.pop();
    if (value == null) continue;
    if (visited.has(value)) continue;

    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (!trimmed) continue;
      try {
        stack.push(JSON.parse(trimmed));
      } catch {
        continue;
      }
      continue;
    }

    if (Array.isArray(value)) {
      visited.add(value);
      for (const item of value) stack.push(item);
      continue;
    }

    if (typeof value === 'object') {
      visited.add(value);
      const record = value as Record<string, any>;

      for (const key of SHAPE_KEYS) {
        if (Object.prototype.hasOwnProperty.call(record, key)) {
          return record as T;
        }
      }

      for (const key of WRAPPER_KEYS) {
        if (record[key] !== undefined) {
          stack.push(record[key]);
        }
      }
    }
  }

  return null;
}
