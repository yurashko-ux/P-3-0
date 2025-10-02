// web/app/(admin)/admin/campaigns/page.tsx
import { kv } from "@vercel/kv";
import { Campaign, Target } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const IDS_KEY = "cmp:ids";
const ITEM_KEY = (id: string) => `cmp:item:${id}`;

function renderTarget(t?: Target) {
  if (!t) return "—";
  const p = t.pipelineName ?? "—";
  const s = t.statusName ?? "—";
  return (
    <div className="text-gray-500">
      <div className="font-medium text-gray-700">{p}</div>
      <div className="text-xs">{s}</div>
    </div>
  );
}

function CounterPills({ c }: { c: Campaign["counters"] }) {
  const v1 = c?.v1 ?? 0;
  const v2 = c?.v2 ?? 0;
  const exp = c?.exp ?? 0;
  const pill = "inline-flex items-center gap-1 rounded-full border px-2 py-1 text-xs";
  return (
    <div className="flex gap-2">
      <span className={pill}><span className="font-semibold">V1:</span>{v1}</span>
      <span className={pill}><span className="font-semibold">V2:</span>{v2}</span>
      <span className={pill}><span className="font-semibold">EXP:</span>{exp}</span>
    </div>
  );
}

async function getCampaigns(): Promise<Campaign[]> {
  try {
    const ids = (await kv.get<string[] | null>(IDS_KEY)) ?? [];
    if (!Array.isArray(ids) || ids.length === 0) return [];
    const keys = ids.filter(Boolean).map(ITEM_KEY);
    const items = await kv.mget<Campaign[]>(...keys);
    return (items ?? []).filter(Boolean) as Campaign[];
  } catch (err) {
    console.error("campaigns list error:", err);
    return [];
  }
}

export default async function Page() {
  const items = await getCampaigns();

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-extrabold">Кампанії</h1>
        <div className="flex gap-2">
          <a
            href="/admin/campaigns/new"
            className="px-4 py-2 rounded-xl shadow bg-blue-600 text-white hover:bg-blue-700"
          >
            + Нова кампанія
          </a>
          <form action="/admin/campaigns" method="get">
            <button type="submit" className="px-4 py-2 rounded-xl shadow">
              Оновити
            </button>
          </form>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="text-left">
            <tr className="border-b">
              <th className="py-2 pr-4">Дата</th>
              <th className="py-2 pr-4">Назва</th>
              <th className="py-2 pr-4">Базова Воронка</th>
              <th className="py-2 pr-4">Базовий Статус</th>
              <th className="py-2 pr-4">Цільова воронка</th>
              <th className="py-2 pr-4">Цільовий статус</th>
              <th className="py-2 pr-4">Лічильник</th>
              <th className="py-2 pr-4">Дії</th>
            </tr>
          </thead>
          <tbody>
            {items.map((c) => {
              const date = c?.createdAt
                ? new Date(c.createdAt).toLocaleString("uk-UA", {
                    day: "2-digit", month: "2-digit", year: "numeric",
                    hour: "2-digit", minute: "2-digit",
                  })
                : "—";
              return (
                <tr key={c.id} className="border-b align-top">
                  <td className="py-3 pr-4 whitespace-nowrap">
                    <div>{date}</div>
                    <div className="text-xs text-gray-400">#{c.id}</div>
                  </td>
                  <td className="py-3 pr-4">{c.name ?? "—"}</td>

                  {/* Base */}
                  <td className="py-3 pr-4">{c.base?.pipelineName ?? "—"}</td>
                  <td className="py-3 pr-4">{c.base?.statusName ?? "—"}</td>

                  {/* Targets in compact stacked view like on your screenshot */}
                  <td className="py-3 pr-4">
                    <div className="text-gray-400 text-xs mb-1">V1</div>
                    <div>{c.t1?.pipelineName ?? "—"}</div>
                    <div className="text-gray-400 text-xs mt-2">V2</div>
                    <div>{c.t2?.pipelineName ?? "—"}</div>
                    <div className="text-gray-400 text-xs mt-2">EXP</div>
                    <div>{c.texp?.pipelineName ?? "—"}</div>
                  </td>
                  <td className="py-3 pr-4">
                    <div className="text-gray-400 text-xs mb-1">V1</div>
                    <div>{c.t1?.statusName ?? "—"}</div>
                    <div className="text-gray-400 text-xs mt-2">V2</div>
                    <div>{c.t2?.statusName ?? "—"}</div>
                    <div className="text-gray-400 text-xs mt-2">EXP</div>
                    <div>{c.texp?.statusName ?? "—"}</div>
                  </td>

                  <td className="py-3 pr-4">
                    <CounterPills c={c.counters} />
                  </td>

                  <td className="py-3 pr-4">
                    <form action={`/api/campaigns/${c.id}`} method="post">
                      <input type="hidden" name="_method" value="DELETE" />
                      <button
                        type="submit"
                        className="px-3 py-2 rounded-xl shadow bg-red-600 text-white hover:bg-red-700"
                      >
                        Видалити
                      </button>
                    </form>
                  </td>
                </tr>
              );
            })}
            {items.length === 0 && (
              <tr>
                <td colSpan={8} className="py-6 text-center text-gray-500">
                  Порожньо. Створіть першу кампанію.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
