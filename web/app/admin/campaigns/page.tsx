// web/app/admin/campaigns/page.tsx
// Показує список кампаній із нового API (/api/campaigns), без прямого доступу до старих KV-ключів.
export const dynamic = "force-dynamic";

type Condition =
  | { field: "text" | "flow" | "tag" | "any"; op: "contains" | "equals"; value: string }
  | null;

type Campaign = {
  id: string;
  created_at: string;
  name: string;
  base_pipeline_id: string;
  base_status_id: string;
  v1_condition: Condition;
  v1_to_pipeline_id: string | null;
  v1_to_status_id: string | null;
  v2_condition: Condition;
  v2_to_pipeline_id: string | null;
  v2_to_status_id: string | null;
  exp_days: number;
  exp_to_pipeline_id: string | null;
  exp_to_status_id: string | null;
  note?: string | null;
  enabled: boolean;
  v1_count: number;
  v2_count: number;
  exp_count: number;
};

async function getCampaigns(): Promise<Campaign[]> {
  const r = await fetch("/api/campaigns", { cache: "no-store" });
  if (!r.ok) return [];
  const j = await r.json().catch(() => ({}));
  return Array.isArray(j?.items) ? (j.items as Campaign[]) : [];
}

function condToText(c: Condition): string {
  if (!c) return "—";
  if (c.field === "any") return "будь-що";
  return `${c.field} ${c.op} "${c.value}"`;
}

function entityLine(c: Campaign): string {
  const base = `${c.base_pipeline_id}/${c.base_status_id}`;
  const v1 = c.v1_to_pipeline_id && c.v1_to_status_id
    ? `v1: ${condToText(c.v1_condition)} → ${c.v1_to_pipeline_id}/${c.v1_to_status_id}`
    : `v1: —`;
  const v2 = c.v2_to_pipeline_id && c.v2_to_status_id
    ? `v2: ${condToText(c.v2_condition)} → ${c.v2_to_pipeline_id}/${c.v2_to_status_id}`
    : `v2: —`;
  const exp = c.exp_to_pipeline_id && c.exp_to_status_id
    ? `exp (${c.exp_days} д.): → ${c.exp_to_pipeline_id}/${c.exp_to_status_id}`
    : `exp: —`;
  return `${base} — ${v1}; ${v2}; ${exp}`;
}

export default async function CampaignsPage() {
  const items = await getCampaigns();

  return (
    <main className="p-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-semibold text-slate-900">Кампанії</h1>
        <a href="/admin/campaigns/new" className="px-4 py-2 rounded-2xl bg-blue-600 hover:bg-blue-700 text-white">
          Нова кампанія
        </a>
      </div>

      {items.length === 0 ? (
        <div className="rounded-2xl border border-gray-200 p-6 text-gray-600 bg-white">
          Поки що немає жодної кампанії.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-gray-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-slate-700">
              <tr>
                <th className="p-3 text-left">Дата</th>
                <th className="p-3 text-left">Назва</th>
                <th className="p-3 text-left">Сутність</th>
                <th className="p-3 text-left">Enabled</th>
                <th className="p-3 text-left">Лічильники</th>
                <th className="p-3 text-left">Дії</th>
              </tr>
            </thead>
            <tbody>
              {items.map((c) => (
                <tr key={c.id} className="border-t hover:bg-gray-50">
                  <td className="p-3">{new Date(c.created_at).toLocaleString()}</td>
                  <td className="p-3 font-medium">{c.name}</td>
                  <td className="p-3">{entityLine(c)}</td>
                  <td className="p-3">{c.enabled ? "yes" : "no"}</td>
                  <td className="p-3">v1:{c.v1_count} • v2:{c.v2_count} • exp:{c.exp_count}</td>
                  <td className="p-3">
                    <div className="flex gap-2">
                      <a className="px-3 py-1 rounded-xl border border-gray-300" href={`/admin/campaigns/${c.id}/edit`}>Edit</a>
                      {/* Delete додамо після /api/campaigns/[id] DELETE в UI */}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
