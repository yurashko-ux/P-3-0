// web/app/(admin)/admin/campaigns/page.tsx
import Link from "next/link";
import { kv } from "@vercel/kv";
import { headers } from "next/headers";
import { unstable_noStore as noStore } from "next/cache";   // ⬅️ додано
import DeleteButton from "@/components/DeleteButton";

// повністю вимикаємо кеш для цієї сторінки
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

type IdName = {
  pipeline?: string;
  status?: string;
  pipelineName?: string;
  statusName?: string;
};
type Counters = { v1: number; v2: number; exp: number };
type Campaign = {
  id: string;
  name: string;
  base?: IdName;
  t1?: IdName;
  t2?: IdName;
  texp?: IdName;
  counters: Counters;
  createdAt: number;
  v1?: string;
  v2?: string;
  expDays?: number;
  expireDays?: number;
  expire?: number;
  vexp?: number;
};

const IDS_KEY = "cmp:ids";
const ITEM_KEY = (id: string) => `cmp:item:${id}`;

async function readIds(): Promise<string[]> {
  // перестраховка від кешу
  noStore();
  const arr = await kv.get<string[] | null>(IDS_KEY);
  if (Array.isArray(arr) && arr.length) return arr.filter(Boolean);
  try {
    const list = await kv.lrange<string>(IDS_KEY, 0, -1);
    if (Array.isArray(list) && list.length) return list.filter(Boolean);
  } catch {}
  return [];
}

async function readFromKV(): Promise<Campaign[]> {
  noStore(); // ⬅️
  const ids = await readIds();
  if (!ids.length) return [];
  const items = await kv.mget<(Campaign | null)[]>(...ids.map(ITEM_KEY));
  const out: Campaign[] = [];
  items.forEach((it) => it && typeof it === "object" && out.push(it as Campaign));
  return out.sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
}

function buildBaseUrl() {
  const h = headers();
  const proto = h.get("x-forwarded-proto") ?? "https";
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "";
  return `${proto}://${host}`;
}

async function readWithFallback(): Promise<Campaign[]> {
  noStore(); // ⬅️
  const kvData = await readFromKV();
  if (kvData.length) return kvData;

  try {
    const base = buildBaseUrl();
    const r = await fetch(`${base}/api/campaigns`, {
      cache: "no-store",                   // ⬅️
      next: { revalidate: 0 },             // ⬅️
    });
    if (r.ok) {
      const arr = (await r.json()) as Campaign[];
      if (Array.isArray(arr) && arr.length) return arr;
    }
  } catch {}
  return [];
}

function fmtDate(ts?: number) {
  try {
    if (!ts) return "—";
    const d = new Date(ts);
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}, ${pad(
      d.getHours()
    )}:${pad(d.getMinutes())}`;
  } catch {
    return "—";
  }
}
function nn(x?: string) {
  return (x && String(x).trim()) || "—";
}
function getExpValue(c: Campaign): string {
  const v =
    (c as any)?.expDays ??
    (c as any)?.expireDays ??
    (c as any)?.expire ??
    (c as any)?.vexp;
  if (v === 0) return "0";
  if (v == null) return "—";
  return String(v);
}

export default async function Page() {
  noStore(); // ⬅️
  const campaigns = await readWithFallback();

  return (
    /* ...залишив інший вміст файлу без змін... */
  );
}
