// web/app/(admin)/admin/campaigns/page.tsx
import { Campaign, Target } from "@/lib/types";

export const dynamic = "force-dynamic";

function renderTarget(t?: Target) {
  if (!t) return "—";
  const p = t.pipelineName ?? "—";
  const s = t.statusName ?? "—";
  return `${p} / ${s}`;
}

async function fetchCampaigns(): Promise<Campaign[]> {
  // Якщо у тебе вже був власний data-fetching — лишай його.
  const res = await fetch("/api/campaigns", { cache: "no-store" });
  if (!res.ok) throw new Error("Не вдалося завантажити кампанії");
  return res.json();
}

export default async function Page() {
  const items = await fetchCampaigns();

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Кампанії</h1>
        <div className="flex gap-2">
          <a href="/admin/campaigns/new" className="px-3 py-2 rounded-xl shadow">
            Нова кампанія
          </a>
          <form action="/admin/campaigns" method="get">
            <button type="submit" className="px-3 py-2 rounded-xl shadow">
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
              <th className="py-2 pr-4">Цільова V1</th>
              <th className="py-2 pr-4">Цільова V2</th>
              <th className="py-2 pr-4">Цільова EXP</th>
              <th className="py-2 pr-4">Лічильники V1/V2/EXP</th>
              <th className="py-2 pr-4">Дії</th>
            </tr>
          </thead>
          <tbody>
            {items.map((c) => {
              const date = new Date(c.createdAt).toLocaleString("uk-UA");
              return (
                <tr key={c.id} className="border-b">
                  <td className="py-2 pr-4 whitespace-nowrap">{date}</td>
                  <td className="py-2 pr-4">{c.name}</td>
                  <td className="py-2 pr-4">{c.base?.pipelineName ?? "—"}</td>
                  <td className="py-2 pr-4">{c.base?.statusName ?? "—"}</td>
                  <td className="py-2 pr-4">{renderTarget(c.t1)}</td>
                  <td className="py-2 pr-4">{renderTarget(c.t2)}</td>
                  <td className="py-2 pr-4">{renderTarget(c.texp)}</td>
                  <td className="py-2 pr-4">
                    {c.counters?.v1 ?? 0}/{c.counters?.v2 ?? 0}/{c.counters?.exp ?? 0}
                  </td>
                  <td className="py-2 pr-4">
                    <form>
                      <button
                        formaction={`/api/campaigns/${c.id}`}
                        formMethod="delete"
                        className="px-2 py-1 rounded shadow"
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
                <td colSpan={9} className="py-6 text-center text-gray-500">
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
