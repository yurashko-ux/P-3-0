// web/lib/types.ts
// Чистий TypeScript без zod. Експортує типи + утиліти, які використовуються в API.

// ---------- Типи ----------
export type Counters = {
  v1?: number;
  v2?: number;
  exp?: number;
};

export type BaseInfo = {
  pipeline?: string;
  status?: string;
  pipelineName?: string;
  statusName?: string;
};

export type Campaign = {
  id: string;
  name?: string;
  base?: BaseInfo;
  v1?: string;
  v2?: string;
  counters?: Counters;
  active?: boolean;
};

// ---------- Утиліти ----------
/** Обережна перевірка на Record */
function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}

/** Безпечне "розпакування" значень, що можуть бути загорнуті у вигляді { value: ... } багато разів */
export function unwrapDeep<T = unknown>(input: unknown): T | unknown {
  let cur: any = input;
  const seen = new Set<any>();
  while (isRecord(cur) && "value" in cur && !seen.has(cur)) {
    seen.add(cur);
    cur = (cur as any).value;
    try {
      // Якщо всередині JSON-рядок — розпарсити
      if (typeof cur === "string" && /^(?:\{|\[)/.test(cur)) {
        const parsed = JSON.parse(cur);
        if (parsed !== undefined) cur = parsed;
      }
    } catch {
      // ігноруємо помилку JSON.parse
    }
  }
  return cur as any;
}

/** Приводить будь-який id до рядка */
export function normalizeId(raw: unknown): string {
  let v: any = unwrapDeep(raw);
  if (isRecord(v) && "id" in v) v = unwrapDeep((v as any).id);
  if (typeof v === "number") return String(v);
  if (typeof v === "string") return v.trim();
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

/** Унікалізація масиву id (будь-якого формату) з нормалізацією */
export function uniqIds(list: unknown[]): string[] {
  const set = new Set<string>();
  for (const x of list ?? []) {
    const id = normalizeId(x);
    if (id) set.add(id);
  }
  return Array.from(set);
}

/** Нормалізує одну кампанію до стабільної структури */
export function normalizeCampaign(raw: unknown): Campaign {
  const r: any = unwrapDeep(raw);

  const id = normalizeId(r?.id ?? r?._id ?? r);

  const nameRaw =
    r?.name ??
    r?.title ??
    r?.campaignName ??
    (isRecord(r?.base) ? (r.base as any)?.name : undefined);

  const baseRaw = isRecord(r?.base) ? r.base : undefined;

  // v1/v2 можуть бути строками, або {value}, або бути в base.{v1,v2}
  const v1Raw = r?.v1 ?? baseRaw?.v1;
  const v2Raw = r?.v2 ?? baseRaw?.v2;

  // counters можуть бути десь глибше
  const countersRaw =
    r?.counters ??
    r?.counts ??
    (isRecord(baseRaw) ? (baseRaw as any)?.counters : undefined);

  // Побудова об’єкта
  const norm: Campaign = {
    id,
    name:
      (typeof nameRaw === "string" ? nameRaw.trim() : undefined) ||
      undefined,
    base: {
      pipeline: String(unwrapDeep((baseRaw as any)?.pipeline ?? r?.pipeline ?? "") || ""),
      status: String(unwrapDeep((baseRaw as any)?.status ?? r?.status ?? "") || ""),
      pipelineName: String(unwrapDeep((baseRaw as any)?.pipelineName ?? r?.pipelineName ?? "") || ""),
      statusName: String(unwrapDeep((baseRaw as any)?.statusName ?? r?.statusName ?? "") || ""),
    },
    v1: ((): string | undefined => {
      const v = unwrapDeep(v1Raw);
      if (typeof v === "string") return v;
      if (typeof v === "number") return String(v);
      return undefined;
    })(),
    v2: ((): string | undefined => {
      const v = unwrapDeep(v2Raw);
      if (typeof v === "string") return v;
      if (typeof v === "number") return String(v);
      return undefined;
    })(),
    counters: ((): Counters | undefined => {
      if (!countersRaw) return undefined;
      const c: any = unwrapDeep(countersRaw);
      if (!isRecord(c)) return undefined;
      const num = (x: any) => {
        const u = unwrapDeep(x);
        const n = typeof u === "string" ? Number(u) : u;
        return typeof n === "number" && Number.isFinite(n) ? n : undefined;
      };
      const out: Counters = {
        v1: num(c.v1),
        v2: num(c.v2),
        exp: num(c.exp),
      };
      if (out.v1 === undefined && out.v2 === undefined && out.exp === undefined)
        return undefined;
      return out;
    })(),
    active: Boolean(unwrapDeep(r?.active)),
  };

  // Порожні рядки у base -> undefined
  if (norm.base) {
    if (!norm.base.pipeline) delete norm.base.pipeline;
    if (!norm.base.status) delete norm.base.status;
    if (!norm.base.pipelineName) delete norm.base.pipelineName;
    if (!norm.base.statusName) delete norm.base.statusName;
    if (
      norm.base.pipeline === undefined &&
      norm.base.status === undefined &&
      norm.base.pipelineName === undefined &&
      norm.base.statusName === undefined
    ) {
      delete (norm as any).base;
    }
  }

  return norm;
}

/** Глибоке перетворення масиву/значення кампаній до нормалізованих Campaign[] */
export function normalizeCampaignArray(input: unknown): Campaign[] {
  const arr = unwrapDeep(input);
  const list = Array.isArray(arr) ? arr : [arr];
  const out: Campaign[] = [];
  for (const x of list) {
    const n = normalizeCampaign(x);
    if (n.id) out.push(n);
  }
  // Унікалізація за id (останнє входження перемагає)
  const map = new Map<string, Campaign>();
  for (const c of out) map.set(c.id, c);
  return Array.from(map.values());
}
