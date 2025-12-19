// web/lib/normalize.ts

/** Уніфікує будь-яке "обгорнуте" значення (рядок JSON, { value }, тощо). */
export function unwrapDeep<T = any>(input: any): T | undefined {
  let v = input;
  // Розпаковуємо вкладені { value } або рядки JSON
  for (let i = 0; i < 10; i++) {
    if (v == null) return v as T | undefined;

    // { value: ... }
    if (typeof v === 'object' && 'value' in v && Object.keys(v).length === 1) {
      v = (v as any).value;
      continue;
    }

    // Рядок JSON
    if (typeof v === 'string') {
      const s = v.trim();
      if ((s.startsWith('{') && s.endsWith('}')) || (s.startsWith('[') && s.endsWith(']')) || s.startsWith('"')) {
        try {
          v = JSON.parse(s);
          continue;
        } catch {
          // не JSON — залишаємо як є
        }
      }
    }

    break;
  }
  return v as T;
}

/** Приводить будь-який id/об’єкт до нормального string id. */
export function normalizeId(x: any): string {
  const v = unwrapDeep<any>(x);
  if (v == null) return '';
  if (typeof v === 'string' || typeof v === 'number') return String(v);
  if (typeof v === 'object') {
    if ('id' in v) return String((v as any).id);
    if ('value' in v) return String((v as any).value);
  }
  return String(v);
}

/** Унікалізує список id (приводячи їх через normalizeId). */
export function uniqIds(list: any[]): string[] {
  const arr = Array.isArray(list) ? list : [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const it of arr) {
    const id = normalizeId(it);
    if (id && !seen.has(id)) {
      seen.add(id);
      out.push(id);
    }
  }
  return out;
}

export type Counters = { v1: number; v2: number; exp: number };
export type Base = {
  pipeline?: string;
  status?: string;
  pipelineName?: string;
  statusName?: string;
};

export type Campaign = {
  id: string;
  name?: string;
  v1?: string;
  v2?: string;
  base?: Base;
  counters?: Counters;
  deleted?: boolean;
  createdAt?: number;
};

/**
 * Нормалізація Instagram username
 * Прибирає @, протоколи, домени, залишає тільки username
 */
export function normalizeInstagram(username: string | null | undefined): string | null {
  if (!username) return null;
  let normalized = username.trim().toLowerCase();
  normalized = normalized.replace(/^@+/, ''); // Прибираємо @
  normalized = normalized.replace(/^https?:\/\//, ''); // Прибираємо протокол
  normalized = normalized.replace(/^www\./, '');
  normalized = normalized.replace(/^instagram\.com\//, '');
  normalized = normalized.split('/')[0]; // Беремо тільки username
  normalized = normalized.split('?')[0]; // Прибираємо query параметри
  normalized = normalized.split('#')[0]; // Прибираємо hash
  return normalized || null;
}

/** Нормалізація Campaign з будь-якої "сирої" структури. */
export function normalizeCampaign(input: any): Campaign {
  const v = unwrapDeep<any>(input) ?? {};
  const id = normalizeId(v.id ?? v);
  const name = (v.name ?? '').toString().trim() || undefined;

  const base0 = unwrapDeep<any>(v.base) ?? {};
  const base: Base = {
    pipeline: unwrapDeep(base0?.pipeline) ?? undefined,
    status: unwrapDeep(base0?.status) ?? undefined,
    pipelineName: unwrapDeep(base0?.pipelineName) ?? undefined,
    statusName: unwrapDeep(base0?.statusName) ?? undefined,
  };

  const counters0 = unwrapDeep<any>(v.counters) ?? {};
  const counters: Counters = {
    v1: Number(counters0?.v1 ?? 0) || 0,
    v2: Number(counters0?.v2 ?? 0) || 0,
    exp: Number(counters0?.exp ?? 0) || 0,
  };

  return {
    id,
    name,
    v1: (v.v1 ?? '—').toString(),
    v2: (v.v2 ?? '—').toString(),
    base,
    counters,
    deleted: Boolean(v.deleted ?? false),
    createdAt: Number(v.createdAt ?? Date.now()),
  };
}
