// lib/normalize.ts
/**
 * Безпечно парсить JSON-рядок. Якщо не JSON — повертає оригінал.
 */
export function safeParse<T = unknown>(v: unknown): T | unknown {
  if (typeof v !== "string") return v;
  try {
    return JSON.parse(v);
  } catch {
    return v;
  }
}

/**
 * Розгортає значення до примітива/об'єкта, забираючи нескінченні:
 *  - JSON-рядок усередині рядка
 *  - об'єкт виду { value: ... } (і так багато разів)
 */
export function unwrapDeep<T = unknown>(input: unknown): T {
  let cur: any = input;

  // обмеження ітерацій на випадок «поганих» даних
  for (let i = 0; i < 200; i++) {
    const parsed = safeParse(cur);

    if (parsed !== cur) {
      cur = parsed;
      continue;
    }

    // якщо формату { value: ... }
    if (cur && typeof cur === "object" && "value" in cur) {
      cur = (cur as any).value;
      continue;
    }

    // якщо це рядок із «каскадними» лапками, спробуємо раз обрізати
    if (typeof cur === "string" && /^"{/.test(cur)) {
      const trimmed = cur.replace(/^"+|"+$/g, "");
      if (trimmed !== cur) {
        cur = trimmed;
        continue;
      }
    }

    break;
  }

  return cur as T;
}

/**
 * Нормалізація ID -> завжди рядок без пробілів.
 */
export function normalizeId(id: unknown): string {
  const un = unwrapDeep(id);
  return String(un).trim();
}

/**
 * Унікалізація та фільтрація масиву ID.
 */
export function uniqIds(arr: unknown[]): string[] {
  const out = new Set<string>();
  for (const x of arr ?? []) {
    const id = normalizeId(x);
    if (id) out.add(id);
  }
  return [...out];
}

/**
 * Мінімальна цільова форма кампанії.
 */
export type Campaign = {
  id: string;
  name?: string;
  base?: {
    pipeline?: string;
    status?: string;
    pipelineName?: string;
    statusName?: string;
  };
  current?: { v1?: string; v2?: string };
  counters?: { v1?: number; v2?: number; exp?: number };
  active?: boolean;
};

/**
 * Приводить «будь-що» до Campaign.
 */
export function normalizeCampaign(raw: any): Campaign {
  const obj = unwrapDeep<any>(raw) || {};
  const id = normalizeId(obj.id ?? obj._id ?? obj.key ?? "");
  const name = unwrapDeep<string>(obj.name ?? obj.title ?? "");
  const base = unwrapDeep(obj.base ?? {});
  const current = unwrapDeep(obj.current ?? {});
  const counters = unwrapDeep(obj.counters ?? {});

  return {
    id,
    name: String(name || "").trim() || undefined,
    base: {
      pipeline: unwrapDeep(base?.pipeline) ?? undefined,
      status: unwrapDeep(base?.status) ?? undefined,
      pipelineName: unwrapDeep(base?.pipelineName) ?? undefined,
      statusName: unwrapDeep(base?.statusName) ?? undefined,
    },
    current: {
      v1: unwrapDeep(current?.v1) ?? undefined,
      v2: unwrapDeep(current?.v2) ?? undefined,
    },
    counters: {
      v1: Number(unwrapDeep(counters?.v1) ?? 0) || 0,
      v2: Number(unwrapDeep(counters?.v2) ?? 0) || 0,
      exp: Number(unwrapDeep(counters?.exp) ?? 0) || 0,
    },
    active: Boolean(unwrapDeep(obj.active)),
  };
}
