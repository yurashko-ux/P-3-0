// web/app/(admin)/campaigns/page.tsx
export const dynamic = "force-dynamic";

type Rule = { op?: "contains" | "equals"; value?: string };

type Campaign = {
  id: string;
  name?: string;

  // base (V1 base pair)
  base_pipeline_id?: number;
  base_status_id?: number;
  base_pipeline_name?: string | null;
  base_status_name?: string | null;

  // rules
  rules?: { v1?: Rule; v2?: Rule };

  // experiment (EXP)
  exp?: {
    to_pipeline_id?: number;
    to_status_id?: number;
    to_pipeline_name?: string | null;
    to_status_name?: string | null;
    trigger?: Rule;
  };

  // counters
  v1_count?: number;
  v2_count?: number;
  exp_count?: number;

  created_at?: number;
  active?: boolean;
};

async function getCampaigns(): Promise<Campaign[]> {
  const res = await fetch(`${process.env.NEXT_PUBLIC_BASE_URL ?? ""}/api/campaigns`, {
    cache: "no-store",
  }).catch(() => null as any);

  if (!res?.ok) {
    // fallback: виклик локального відносного шляху, якщо NEXT_PUBLIC_BASE_URL не заданий
    const rel = await fetch(`/api/campaigns`, { cache: "no-store" }).catch(() => null as any);
    if (!rel?.ok) return [];
    const data = await rel.json();
    return (data?.items ?? []) as Campaign[];
  }

  const data = await res.json();
  return (data?.items ?? []) as Campaign[];
}

function fmtDate(ts?: number) {
  if (!ts) return "-";
  try {
    const d = new Date(ts);
    return d.toLocaleString();
  } catch {
    return String(ts);
  }
}

function ruleText(r?: Rule) {
  if (!r?.value) return "-";
  return `${r.op === "equals" ? "==" : "∋"} ${r.value}`;
}

export default async function CampaignsPage() {
  const items = await getCampaigns();

  return (
    <div className="p-6">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Кампанії</h1>
        <a
          href="/admin/campaigns/new"
          className="rounded-xl px-4 py-2 border hover:shadow transition"
        >
          + Нова кампанія
        </a>
      </div>

      {(!items || items.length === 0) && (
        <div className="rounded-xl border p-6 text-gray-600">
          Список порожній. Створіть першу кампанію.
        </div>
      )}

      {items && items.length > 0 && (
        <div className="overflow-x-auto rounded-xl border">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50">
              <tr className="text-left">
                <th className="px-4 py-3 font-medium">ID</th>
                <th className="px-4 py-3 font-medium">Назва</th>
                <th className="px-4 py-3 font-medium">База (V1)</th>
                <th className="px-4 py-3 font-medium">V1 правило</th>
                <th className="px-4 py-3 font-medium">V2 правило</th>
                <th className="px-4 py-3 font-medium">EXP → ціль</th>
                <th className="px-4 py-3 font-medium">EXP тригер</th>
                <th className="px-4 py-3 font-medium">Лічильники</th>
                <th className="px-4 py-3 font-medium">Статус</th>
                <th className="px-4 py-3 font-medium">Створено</th>
              </tr>
            </thead>
            <tbody>
              {items.map((c) => {
                const basePipe =
                  (c.base_pipeline_name ?? undefined) || (c.base_pipeline_id != null ? `#${c.base_pipeline_id}` : "-");
                const baseStatus =
                  (c.base_status_name ?? undefined) || (c.base_status_id != null ? `#${c.base_status_id}` : "-");

                const toPipe =
                  (c.exp?.to_pipeline_name ?? undefined) ||
                  (c.exp?.to_pipeline_id != null ? `#${c.exp?.to_pipeline_id}` : "-");
                const toStatus =
                  (c.exp?.to_status_name ?? undefined) ||
                  (c.exp?.to_status_id != null ? `#${c.exp?.to_status_id}` : "-");

                return (
                  <tr key={c.id} className="border-t">
                    <td className="px-4 py-3 text-gray-500">{c.id}</td>
                    <td className="px-4 py-3 font-medium">{c.name ?? "-"}</td>
                    <td className="px-4 py-3">
                      <div className="text-gray-900">{basePipe} → {baseStatus}</div>
                    </td>
                    <td className="px-4 py-3">{ruleText(c.rules?.v1)}</td>
                    <td className="px-4 py-3">{ruleText(c.rules?.v2)}</td>
                    <td className="px-4 py-3">
                      <div className="text-gray-900">{toPipe} → {toStatus}</div>
                    </td>
                    <td className="px-4 py-3">{ruleText(c.exp?.trigger)}</td>
                    <td className="px-4 py-3 text-gray-700">
                      <div className="flex gap-3">
                        <span>V1: {c.v1_count ?? 0}</span>
                        <span>V2: {c.v2_count ?? 0}</span>
                        <span>EXP: {c.exp_count ?? 0}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex items-center gap-2 rounded-full px-2.5 py-1 text-xs border ${
                          c.active ? "bg-green-50 border-green-200 text-green-700" : "bg-gray-50 border-gray-200 text-gray-600"
                        }`}
                      >
                        <span
                          className={`h-1.5 w-1.5 rounded-full ${
                            c.active ? "bg-green-500" : "bg-gray-400"
                          }`}
                        />
                        {c.active ? "active" : "inactive"}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-500">{fmtDate(c.created_at)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
