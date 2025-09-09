"use client";

import { useEffect, useState } from "react";
import CounterPill from "@/components/CounterPill";
import Chip from "@/components/Chip";

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

  useEffect(() => {
    loadAll();
  }, []);

  function chips(pid: string | null, sid: string | null) {
    if (!pid || !sid) return <span className="text-gray-500">—/—</span>;
    const p = pipelines[pid] ?? pid;
    const s = statusesByPipeline[pid]?.[sid] ?? sid;
    return (
      <span className="inline-flex items-center gap-1">
        <Chip text={p} tone="pipeline" />
        <span className="text-gray-400">/</span>
        <Chip text={s} tone="status" />
      </span>
    );
  }

  return (
    <div className="p-4 sm:p-6">
      <div className="max-w-5xl mx-auto">
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-3xl font-extrabold">Кампанії</h1>
          <div className="flex gap-2">
            <a href="/admin/tools" className="rounded-lg border px-3 py-2 hover:bg-gray-50">
              Інструменти
            </a>
            <button onClick={loadAll} className="rounded-lg border px-3 py-2 hover:bg-gray-50">
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
          <table className="min-w-full table-fixed">
            <colgroup>
              <col className="w-44" />
              <col className="w-48" />
              <col />
              <col className="w-20" />
              <col className="w-28" />
            </colgroup>

            <thead className="bg-gray-50">
              <tr className="text-left text-gray-600">
                <th className="px-4 py-3">Дата</th>
                <th className="px-4 py-3">Назва</th>
                <th className="px-4 py-3">Сутність</th>
                <th className="px-4 py-3">Статус</th>
                <th className="px-4 py-3">Дії</th>
              </tr>
            </thead>

            <tbody>
              {items.map((c) => (
                <tr key={c.id} className="border-t align-top">
                  <td className="px-4 py-3 text-gray-700">
                    {new Date(c.created_at).toLocaleString("uk-UA")}
                  </td>

                  <td className="px-4 py-3 font-semibold">{c.name}</td>

                  <td className="px-4 py-3">
                    {/* База */}
                    <div className="mb-1 text-gray-800">
                      <span className="font-bold mr-2">База:</span>
                      {chips(c.base_pipeline_id, c.base_status_id)}
                    </div>

                    {/* V1 */}
                    <div className="flex flex-wrap items-center gap-2 mb-1">
                      <div className="text-gray-900">
                        <span className="font-semibold mr-2">V1 →</span>
                        {chips(c.v1_to_pipeline_id, c.v1_to_status_id)}
                        {c.v1_value ? (
                          <span className="ml-2 text-gray-500">({c.v1_value})</span>
                        ) : null}
                      </div>
                      <CounterPill label="V1" value={c.v1_count} />
                    </div>

                    {/* V2 */}
                    {c.v2_enabled ? (
                      <div className="flex flex-wrap items-center gap-2 mb-1">
                        <div className="text-gray-900">
                          <span className="font-semibold mr-2">V2 →</span>
                          {chips(c.v2_to_pipeline_id, c.v2_to_status_id)}
                          {c.v2_value ? (
                            <span className="ml-2 text-gray-500">({c.v2_value})</span>
                          ) : null}
                        </div>
                        <CounterPill label="V2" value={c.v2_count} />
                      </div>
                    ) : null}

                    {/* EXP */}
                    <div className="flex flex-wrap items-center gap-2">
                      <div className="text-gray-900">
                        <span className="font-semibold mr-2">EXP({c.exp_days}д) →</span>
                        {chips(c.exp_to_pipeline_id, c.exp_to_status_id)}
                      </div>
                      <CounterPill label="EXP" value={c.exp_count} />
                    </div>
                  </td>

                  <td className="px-4 py-3">{c.enabled ? "yes" : "no"}</td>

                  <td className="px-4 py-3 whitespace-nowrap">
                    <a
                      href={`/admin/campaigns/${c.id}/edit`}
                      className="text-blue-600 hover:underline mr-3"
                    >
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
    </div>
  );
}
