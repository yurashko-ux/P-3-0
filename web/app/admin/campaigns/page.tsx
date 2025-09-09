"use client";

import { useEffect, useState } from "react";
import CounterPill from "@/components/CounterPill";

type Campaign = {
  id: string;
  created_at: string;
  name: string;
  enabled: boolean;

  base_pipeline_id: string;
  base_status_id: string;

  v1_value: string;
  v1_to_pipeline_id: string | null;
  v1_to_status_id: string | null;

  v2_enabled: boolean;
  v2_value: string;
  v2_to_pipeline_id: string | null;
  v2_to_status_id: string | null;

  exp_days: number;
  exp_to_pipeline_id: string | null;
  exp_to_status_id: string | null;

  v1_count: number;
  v2_count: number;
  exp_count: number;
};

type Dict = Record<string, string>;

async function api<T>(url: string): Promise<T> {
  const r = await fetch(url, { credentials: "include", cache: "no-store" });
  const j = await r.json();
  return j?.items ?? j;
}

export default function Page() {
  const [items, setItems] = useState<Campaign[]>([]);
  const [pipelines, setPipelines] = useState<Dict>({});
  const [statusesByPipeline, setStatusesByPipeline] = useState<Record<string, Dict>>({});

  async function loadAll() {
    const list = await api<{ items: Campaign[] }>("/api/campaigns");
    setItems(list as unknown as Campaign[]);

    // Довідники KeyCRM
    const pls: any[] = await api("/api/keycrm/pipelines");
    const pMap: Dict = {};
    for (const p of pls || []) pMap[String(p.id)] = String(p.name ?? p.title ?? p.id);
    setPipelines(pMap);

    const stMap: Record<string, Dict> = {};
    for (const pid of Object.keys(pMap)) {
      const sts: any[] = await api(`/api/keycrm/statuses?pipeline_id=${encodeURIComponent(pid)}`);
      stMap[pid] = {};
      for (const s of sts || []) stMap[pid][String(s.id)] = String(s.name ?? s.title ?? s.id);
    }
    setStatusesByPipeline(stMap);
  }

  useEffect(() => { loadAll(); }, []);

  function statusName(pid: string | null, sid: string | null) {
    if (!pid || !sid) return "—/—";
    return `${pipelines[pid] ?? pid}/${statusesByPipeline[pid]?.[sid] ?? sid}`;
  }

  return (
    <div className="p-4 sm:p-6">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-3xl font-extrabold">Кампанії</h1>
        <div className="flex gap-2">
          <a href="/admin/tools" className="rounded-lg border px-4 py-2 hover:bg-gray-50">
            Інструменти
          </a>
          <button onClick={loadAll} className="rounded-lg border px-4 py-2 hover:bg-gray-50">
            Оновити
          </button>
          <a
            href="/admin/campaigns/new"
            className="rounded-lg bg-blue-600 px-4 py-2 text-white hover:bg-blue-700"
          >
            Нова кампанія
          </a>
        </div>
      </div>

      <div className="overflow-hidden rounded-2xl border">
        <table className="min-w-full">
          <thead className="bg-gray-50">
            <tr className="text-left text-gray-600">
              <th className="px-4 py-3 w-56">Дата</th>
              <th className="px-4 py-3 w-52">Назва</th>
              <th className="px-4 py-3">Сутність</th>
              <th className="px-4 py-3 w-24">Статус</th>
              <th className="px-4 py-3 w-28">Дії</th>
            </tr>
          </thead>
          <tbody>
            {items.map((c) => (
              <tr key={c.id} className="border-t align-top">
                <td className="px-4 py-4 text-gray-700 whitespace-nowrap">
                  {new Date(c.created_at).toLocaleString("uk-UA")}
                </td>
                <td className="px-4 py-4 font-semibold">{c.name}</td>
                <td className="px-4 py-4">
                  {/* База */}
                  <div className="mb-2 text-gray-800">
                    <span className="font-bold">База:</span>{" "}
                    {statusName(c.base_pipeline_id, c.base_status_id)}
                  </div>

                  {/* V1 */}
                  <div className="flex items-center gap-3 mb-1">
                    <div className="text-gray-900">
                      <span className="font-semibold">V1</span> →{" "}
                      {statusName(c.v1_to_pipeline_id, c.v1_to_status_id)}{" "}
                      {c.v1_value ? (
                        <span className="text-gray-500">({c.v1_value})</span>
                      ) : null}
                    </div>
                    <CounterPill label="V1" value={c.v1_count} />
                  </div>

                  {/* V2 */}
                  {c.v2_enabled ? (
                    <div className="flex items-center gap-3 mb-1">
                      <div className="text-gray-900">
                        <span className="font-semibold">V2</span> →{" "}
                        {statusName(c.v2_to_pipeline_id, c.v2_to_status_id)}{" "}
                        {c.v2_value ? (
                          <span className="text-gray-500">({c.v2_value})</span>
                        ) : null}
                      </div>
                      <CounterPill label="V2" value={c.v2_count} />
                    </div>
                  ) : null}

                  {/* EXP */}
                  <div className="flex items-center gap-3">
                    <div className="text-gray-900">
                      <span className="font-semibold">EXP({c.exp_days}д)</span> →{" "}
                      {statusName(c.exp_to_pipeline_id, c.exp_to_status_id)}
                    </div>
                    <CounterPill label="EXP" value={c.exp_count} />
                  </div>
                </td>
                <td className="px-4 py-4">{c.enabled ? "yes" : "no"}</td>
                <td className="px-4 py-4 whitespace-nowrap">
                  <a href={`/admin/campaigns/${c.id}/edit`} className="text-blue-600 hover:underline mr-3">
                    Edit
                  </a>
                  <a
                    href={`/api/campaigns/${c.id}`}
                    onClick={async (e) => {
                      e.preventDefault();
                      if (!confirm("Видалити кампанію?")) return;
                      await fetch(`/api/campaigns/${c.id}`, {
                        method: "DELETE",
                        credentials: "include",
                      });
                      loadAll();
                    }}
                    className="text-red-600 hover:underline"
                  >
                    Delete
                  </a>
                </td>
              </tr>
            ))}

            {!items.length && (
              <tr>
                <td className="px-4 py-10 text-center text-gray-500" colSpan={5}>
                  Кампаній поки немає
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
