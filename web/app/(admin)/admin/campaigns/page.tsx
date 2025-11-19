// web/app/(admin)/admin/campaigns/page.tsx
import Link from "next/link";
import { kv } from "@vercel/kv";
import { headers } from "next/headers";
import { unstable_noStore as noStore } from "next/cache";
import DeleteButton from "@/components/DeleteButton";
import { kvRead } from "@/lib/kv";
import { fetchKeycrmPipelines } from "@/lib/keycrm-pipelines";

// повністю вимикаємо кешування цієї сторінки
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

  // значення варіантів
  v1?: string;
  v2?: string;

  // інколи EXP можуть зберігатися як різні поля — лишаємо на майбутнє
  exp?: number;
  expDays?: number;
  expireDays?: number;
  expire?: number;
  vexp?: number;
};

const IDS_KEY = "cmp:ids";
const IDS_LIST_KEY = "cmp:ids:list";
const ITEM_KEY = (id: string) => `cmp:item:${id}`;

function logKvError(message: string, err: unknown) {
  if (process.env.NODE_ENV !== "production") {
    console.warn(`[campaigns] ${message}`, err);
  }
}

async function readIds(): Promise<string[]> {
  noStore();
  try {
    const arr = await kv.get<string[] | null>(IDS_KEY);
    if (Array.isArray(arr) && arr.length) return arr.filter(Boolean);
  } catch (err) {
    logKvError("kv.get failed", err);
  }
  try {
    const list = await kvRead.lrange(IDS_LIST_KEY, 0, -1);
    if (Array.isArray(list) && list.length) return list.filter(Boolean);
  } catch (err) {
    logKvError("kv.lrange failed", err);
  }
  return [];
}

async function readFromKV(): Promise<Campaign[]> {
  noStore();
  const ids = await readIds();
  if (!ids.length) return [];
  try {
    const items = await kv.mget<(Campaign | null)[]>(...ids.map(ITEM_KEY));
    const out: Campaign[] = [];
    items.forEach((it) => it && typeof it === "object" && out.push(it as Campaign));
    return out.sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
  } catch (err) {
    logKvError("kv.mget failed", err);
    return [];
  }
}

function buildBaseUrl() {
  const h = headers();
  const proto = h.get("x-forwarded-proto") ?? "https";
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "";
  return `${proto}://${host}`;
}

async function readWithFallback(): Promise<Campaign[]> {
  noStore();
  // 1) напряму з KV
  const kvData = await readFromKV();
  if (kvData.length) return kvData;

  // 2) fallback — API
  try {
    const base = buildBaseUrl();
    const r = await fetch(`${base}/api/campaigns`, {
      cache: "no-store",
      next: { revalidate: 0 },
    });
    if (r.ok) {
      const payload = await r.json().catch(() => null);
      const arr = Array.isArray(payload)
        ? (payload as Campaign[])
        : Array.isArray(payload?.items)
          ? (payload.items as Campaign[])
          : [];
      if (arr.length) return arr;
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

export default async function Page() {
  noStore();
  
  // Автоматичне оновлення воронок з KeyCRM при завантаженні сторінки
  try {
    await fetchKeycrmPipelines({ forceRefresh: true, persist: true });
  } catch (err) {
    // Ігноруємо помилки оновлення - використаємо кешовані дані
    if (process.env.NODE_ENV !== "production") {
      console.warn("[campaigns] Failed to refresh pipelines:", err);
    }
  }
  
  const campaigns = await readWithFallback();

  return (
    <div className="p-4 sm:p-6">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-3xl font-extrabold tracking-tight">Кампанії</h1>
        <div className="flex items-start gap-3">
          <div className="flex gap-3">
            <Link
              href="/admin/campaigns/new"
              className="rounded-lg bg-blue-600 text-white px-4 py-2 font-medium shadow hover:bg-blue-700"
            >
              + Нова кампанія
            </Link>
            <Link
              href={`/admin/campaigns?t=${Date.now()}`}
              className="rounded-lg border px-4 py-2 shadow-sm"
            >
              Оновити
            </Link>
          </div>
        </div>
      </div>

      <div className="rounded-xl border bg-white overflow-hidden">
        <table className="w-full table-fixed">
          <thead>
            <tr className="text-left text-slate-600 text-sm border-b">
              <th className="px-4 py-3 w-[180px]">Дата</th>
              <th className="px-2 py-3 w-[160px]">Назва</th>
              <th className="px-2 py-3 w-[200px]">Базова Воронка</th>
              <th className="px-2 py-3 w-[160px]">Базовий Статус</th>
              <th className="px-2 py-3 w-[120px]">Варіант</th>
              <th className="px-2 py-3 w-[260px]">Цільова воронка</th>
              <th className="px-2 py-3 w-[280px]">Цільовий статус</th>
              <th className="px-2 py-3 w-[140px]">Лічильник</th>
              <th className="px-4 py-3 w-[120px] text-right">Дії</th>
            </tr>
          </thead>
          <tbody>
            {campaigns.length === 0 ? (
              <tr>
                <td colSpan={9} className="px-4 py-10 text-center text-slate-500">
                  Порожньо. Створіть першу кампанію.
                </td>
              </tr>
            ) : (
              campaigns.map((c) => (
                <tr key={c.id} className="border-b align-top">
                  {/* Дата */}
                  <td className="px-4 py-3 text-sm text-slate-800">
                    <div>{fmtDate(c.createdAt)}</div>
                    <div className="text-slate-400 text-xs">#{c.id}</div>
                  </td>

                  {/* Назва */}
                  <td className="px-2 py-3 text-sm">{nn(c.name)}</td>

                  {/* База */}
                  <td className="px-2 py-3 text-sm">{nn(c.base?.pipelineName)}</td>
                  <td className="px-2 py-3 text-sm">{nn(c.base?.statusName)}</td>

                  {/* Варіант — V1/V2/EXP значення */}
                  <td className="px-2 py-3 text-sm">
                    <div className="flex flex-col gap-1">
                      <div>
                        <span className="text-slate-500 mr-2">V1</span>
                        {nn(c.v1)}
                      </div>
                      <div>
                        <span className="text-slate-500 mr-2">V2</span>
                        {nn(c.v2)}
                      </div>
                      <div>
                        <span className="text-slate-500 mr-2">EXP</span>
                        {(() => {
                          const v =
                            (c as any)?.exp ??          // ← тепер спочатку читаємо exp
                            (c as any)?.expDays ??
                            (c as any)?.expireDays ??
                            (c as any)?.expire ??
                            (c as any)?.vexp;
                          return v == null ? "—" : String(v);
                        })()}
                      </div>
                    </div>
                  </td>

                  {/* Цільова воронка — вертикально V1/V2/EXP */}
                  <td className="px-2 py-3 text-sm">
                    <div className="flex flex-col gap-1">
                      <div>
                        <span className="text-slate-500 mr-2">V1</span>
                        {nn(c.t1?.pipelineName)}
                      </div>
                      <div>
                        <span className="text-slate-500 mr-2">V2</span>
                        {nn(c.t2?.pipelineName)}
                      </div>
                      <div>
                        <span className="text-slate-500 mr-2">EXP</span>
                        {nn(c.texp?.pipelineName)}
                      </div>
                    </div>
                  </td>

                  {/* Цільовий статус — вертикально */}
                  <td className="px-2 py-3 text-sm">
                    <div className="flex flex-col gap-1">
                      <div>
                        <span className="text-slate-500 mr-2">V1</span>
                        {nn(c.t1?.statusName)}
                      </div>
                      <div>
                        <span className="text-slate-500 mr-2">V2</span>
                        {nn(c.t2?.statusName)}
                      </div>
                      <div>
                        <span className="text-slate-500 mr-2">EXP</span>
                        {nn(c.texp?.statusName)}
                      </div>
                    </div>
                  </td>

                  {/* Лічильники — вертикально */}
                  <td className="px-2 py-3 text-sm">
                    <div className="flex flex-col gap-1">
                      <div className="inline-flex items-center rounded-full border px-2 py-0.5 text-xs">
                        <span className="text-slate-500 mr-1">V1:</span>
                        <span>{c.counters?.v1 ?? 0}</span>
                      </div>
                      <div className="inline-flex items-center rounded-full border px-2 py-0.5 text-xs">
                        <span className="text-slate-500 mr-1">V2:</span>
                        <span>{c.counters?.v2 ?? 0}</span>
                      </div>
                      <div className="inline-flex items-center rounded-full border px-2 py-0.5 text-xs">
                        <span className="text-slate-500 mr-1">EXP:</span>
                        <span>{c.counters?.exp ?? 0}</span>
                      </div>
                    </div>
                  </td>

                  {/* Дії */}
                  <td className="px-4 py-3 text-right">
                    <DeleteButton id={c.id} />
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
