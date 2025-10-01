// web/lib/normalize.ts

export type Counters = { v1?: number; v2?: number; exp?: number };
export type BaseInfo = {
  pipeline?: string;
  status?: string;
  pipelineName?: string;
  statusName?: string;
};
export type Campaign = {
  id: string;
  name?: string;
  counters?: Counters;
  base?: BaseInfo;
  deleted?: boolean;
  active?: boolean;
  createdAt?: string;
  updatedAt?: string;
};

/**
 * Розкручує глибоко вкладені значення типу {"value": "..."} або JSON-рядки.
 */
export function unwrapDeep(v: any): any {
  try {
    let cur = v;
    let guard = 0;
    while (guard++ < 50) {
      if (cur && typeof cur === "object" && "value" in cur) {
        cur = (cur as any).value;
        continue;
      }
      if (typeof cur === "string") {
        const s = cur.trim();
        const looksJson =
          (s.startsWith("{") && s.endsWith("}")) ||
          (s.startsWith("[") && s.endsWith("]"));
        if (looksJson) {
          try {
            cur = JSON.parse(s);
            continue;
          } catch {
            // не валідний JSON — зупиняємось
          }
        }
      }
      break;
    }
    return cur;
  } catch {
    return v;
  }
}

/** Нормалізація ID до плаского string */
export function normalizeId(raw: any): string {
  const v = unwrapDeep(raw);
  if (v == null) return "";
  return String(v);
}

/** Дедуп ID зі збереженням порядку */
export function uniqIds(ids: any[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const it of ids || []) {
    const id = normalizeId(it);
    if (!id) continue;
    if (!seen.has(id)) {
      seen.add(id);
      out.push(id);
    }
  }
  return out;
}

/** Нормалізація однієї кампанії */
export function normalizeItem(raw: any): Campaign {
  const idRaw = raw?.id ?? raw?._id ?? raw;
  let id = normalizeId(idRaw);
  if (!id) id = String(Date.now());

  const name = unwrapDeep(raw?.name);

  const cAny = unwrapDeep(raw?.counters) ?? {};
  const counters: Counters = {
    v1: toNumOrUndef(cAny?.v1),
    v2: toNumOrUndef(cAny?.v2),
    exp: toNumOrUndef(cAny?.exp),
  };

  const bAny = unwrapDeep(raw?.base) ?? {};
  const base: BaseInfo = {
    pipeline: toStrOrUndef(bAny?.pipeline),
    status: toStrOrUndef(bAny?.status),
    pipelineName: toStrOrUndef(bAny?.pipelineName),
    statusName: toStrOrUndef(bAny?.statusName),
  };

  const deleted = Boolean(unwrapDeep(raw?.deleted)) || false;
  const active = Boolean(unwrapDeep(raw?.active));
  const createdAt = toStrOrUndef(raw?.createdAt);
  const updatedAt = toStrOrUndef(raw?.updatedAt);

  return {
    id,
    name: typeof name === "string" ? name.trim() || undefined : undefined,
    counters,
    base,
    deleted,
    active,
    createdAt,
    updatedAt,
  };
}

/** Синонім під існуючі імпорти у route.ts */
export function normalizeCampaign(raw: any): Campaign {
  return normalizeItem(raw);
}

/** Нормалізація списку кампаній */
export function normalizeList(list: any): Campaign[] {
  const arr = unwrapDeep(list);
  if (!Array.isArray(arr)) return [];
  return arr.map(normalizeItem);
}

/* ---------------- helpers ---------------- */

function toNumOrUndef(v: any): number | undefined {
  const n = Number(unwrapDeep(v));
  return Number.isFinite(n) && n !== 0 ? n : undefined;
}

function toStrOrUndef(v: any): string | undefined {
  const s = unwrapDeep(v);
  if (s == null) return undefined;
  const str = String(s).trim();
  return str ? str : undefined;
}
