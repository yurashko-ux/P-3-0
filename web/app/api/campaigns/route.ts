// web/app/api/campaigns/route.ts
import { NextResponse } from "next/server";
import { kv } from "@vercel/kv";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const revalidate = 0;

// Уніфікатор будь-якого "загорнутого" значення з KV
function unwrapDeep(v: any): any {
  try {
    if (v == null) return v;
    if (typeof v === "string") {
      try { return JSON.parse(v); } catch { return v; }
    }
    if (typeof v === "object" && "value" in v && Object.keys(v).length === 1) {
      return unwrapDeep((v as any).value);
    }
    return v;
  } catch { return v; }
}
const uniq = (arr: any[]) => Array.from(new Set(arr.filter(Boolean)));

async function readIdList(key: string): Promise<string[]> {
  // пробуємо як просте значення (json/строка) або як список
  const raw = await kv.get(key as any);
  const v = unwrapDeep(raw);
  if (Array.isArray(v)) return uniq(v.map(String));

  // інколи ключ — це саме Redis list
  const kvAny = kv as any;
  if (typeof kvAny?.lrange === "function") {
    try {
      const list = await kvAny.lrange(key, 0, -1);
      if (Array.isArray(list)) return uniq(list.map(String));
    } catch {}
  }
  // fallback: одиничне значення
  return v ? uniq([String(v)]) : [];
}

async function readItem(id: string): Promise<any | null> {
  const key = `cmp:item:${id}`;
  const raw = await kv.get(key as any);
  const v = unwrapDeep(raw);
  if (v) return { id, ...v };

  // спроба як hash або list
  const kvAny = kv as any;
  try {
    if (typeof kvAny?.hgetall === "function") {
      const h = await kvAny.hgetall(key);
      if (h && typeof h === "object") return { id, ...h };
    }
  } catch {}
  try {
    if (typeof kvAny?.lrange === "function") {
      const list = await kvAny.lrange(key, 0, 0);
      if (Array.isArray(list) && list.length) return { id, ...unwrapDeep(list[0]) };
    }
  } catch {}
  return null;
}

function normalizeCampaign(c: any) {
  const id = String(c?.id ?? "").trim();
  const name = String(c?.name ?? c?.title ?? "").trim();
  const base = c?.base ?? {};
  return {
    id,
    name: name || "—",
    base: {
      pipelineName: base?.pipelineName ?? c?.pipelineName ?? "—",
      statusName:   base?.statusName   ?? c?.statusName   ?? "—",
    },
    counters: c?.counters ?? { v1: 0, v2: 0, exp: 0 },
  };
}

export async function GET() {
  // списки ID можуть лежати у двох ключах
  const ro = await readIdList("cmp:list:ids:RO");
  const wr = await readIdList("cmp:list:ids:WR");
  const ids = uniq([...ro, ...wr]);

  const items: any[] = [];
  for (const id of ids) {
    const it = await readItem(id);
    if (it) items.push(normalizeCampaign(it));
  }

  return NextResponse.json({ ok: true, count: items.length, items });
}
