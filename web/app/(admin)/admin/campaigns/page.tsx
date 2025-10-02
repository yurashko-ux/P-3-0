// web/app/(admin)/admin/campaigns/page.tsx
import Link from "next/link";
import { kv } from "@vercel/kv";

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
  // можливі назви для кількості днів EXP
  expDays?: number;
  expireDays?: number;
  expire?: number;
  vexp?: number;
};

// ---- KV helpers (без мережі) ----
const IDS_KEY = "cmp:ids";
const ITEM_KEY = (id: string) => `cmp:item:${id}`;

async function readIds(): Promise<string[]> {
  // канонічний варіант — масив
  const arr = await kv.get<string[] | null>(IDS_KEY);
  if (Array.isArray(arr) && arr.length) return arr.filter(Boolean);

  // fallback на випадок старого списку (list)
  try {
    const list = await kv.lrange<string>(IDS_KEY, 0, -1);
    return Array.isArray(list) ? list.filter(Boolean) : [];
  } catch {
    return [];
  }
}

async function readCampaigns(): Promise<Campaign[]> {
  const ids = await readIds();
  if (!ids.length) return [];
  const keys = ids.map(ITEM_KEY);
  const items = await kv.mget<(Campaign | null)[]>(...keys);
  const onlyExisting: Campaign[] = [];
  items.forEach((it) => {
    if (it && typeof it === "object") onlyExisting.push(it as Campaign);
  });
  // сортуємо за createdAt (спадання), щоб було стабільно
  return onlyExisting.sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
}

// ---- UI helpers ----
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
function joinTargets(p1?: string, p2?: string, p3?: string) {
  return [`V1: ${nn(p1)}`, `V2: ${nn(p2)}`, `EXP: ${nn(p3)}`].join(" • ");
}
function getExpireDays(c: Campaign): number | undefined {
  const v =
    (c as any)?.expDays ??
    (c as any)?.expireDays ??
    (c as any)?.expire ??
    (typeof (c as any)?.vexp === "number" ? (c as any)?.vexp : undefined);
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

// ---- Page ----
export default async function Page() {
  const campaigns = await readCampaigns();

  return (
    <div className="p-4 sm:p-6">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-3xl font-extrabold tracking-tight">Кампанії</h1>
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

      <div className="rounded-xl border bg-white overflow-hidden">
        <table className="w-full table-fixed">
          <thead>
            <tr className="text-left text-slate-600 text-sm border-b">
              <th className="px-4 py-3 w-[180px]">Дата</th>
              <th className="px-2 py-3 w-[160px]">Назва</th>
              <th className="px-2 py-3 w-[200px]">Базова Воронка</th>
              <th className="px-2 py-3 w-[160px]">Базовий Статус</th>
              <th className="px-2 py-3">Цільова воронка</th>
              <th className="px-2 py-3 w-[280px]">Цільовий статус</th>
              <th className="px-2 py-3 w-[140px]">Лічильник</th>
              <th className="px-4 py-3 w-[120px] text-right">Дії</th>
            </tr>
          </thead>
          <tbody>
            {campaigns.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-4 py-10 text-center text-slate-500">
                  Порожньо. Створіть першу кампанію.
                </td>
              </tr>
            ) : (
              campaigns.map((c) => {
                const days = getExpireDays(c);
                return (
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
                    {/* Цільова воронка — в один рядок */}
                    <td className="px-2 py-3 text-sm whitespace-nowrap">
                      {joinTargets(c.t1?.pipelineName, c.t2?.pipelineName, c.texp?.pipelineName)}
                    </td>
                    {/* Цільовий статус — вертикально; EXP з днями */}
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
                          <span className="text-slate-500 mr-2">
                            {days != null ? `EXP (${days} дн.)` : "EXP"}
                          </span>
                          {nn(c.texp?.statusName)}
                        </div>
                      </div>
                    </td>
                    {/* Лічильник — вертикально */}
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
                      <form>
                        <button
                          formAction={`/api/campaigns/${c.id}`}
                          formMethod="delete"
                          className="rounded-lg bg-red-600 text-white px-4 py-1.5 text-sm shadow hover:bg-red-700"
                        >
                          Видалити
                        </button>
                      </form>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
