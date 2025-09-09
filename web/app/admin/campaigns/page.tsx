// web/app/admin/campaigns/page.tsx
"use client";

import { useEffect, useState } from "react";

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
};

type Dict = Record<string, string>;

async function fetchJSON<T>(url: string): Promise<T> {
  const r = await fetch(url, { cache: "no-store", credentials: "include" });
  return r.json();
}

export default function Page() {
  const [items, setItems] = useState<Campaign[]>([]);
  const [pipelines, setPipelines] = useState<Dict>({});
  const [statusesByPipeline, setStatusesByPipeline] = useState<Record<string, Dict>>({});

  async function loadAll() {
    const list = await fetchJSON<{ ok: boolean; items: Campaign[] }>("/api/campaigns");
    setItems(list.items || []);

    // Пайплайни
    const pls: any[] = await fetchJSON("/api/keycrm/pipelines");
    const pMap: Dict = {};
    for (const p of pls || []) pMap[String(p.id)] = String(p.name ?? p.title ?? p.id);
    setPipelines(pMap);

    // Статуси по пайплайнах
    const stMap: Record<string, Dict> = {};
    for (const pid of Object.keys(pMap)) {
      const sts: any[] = await fetchJSON(`/api/keycrm/statuses?pipeline_id=${pid}`);
      stMap[pid] = {};
      for (const s of sts || []) stMap[pid][String(s.id)] = String(s.name ?? s.title ?? s.id);
    }
    setStatusesByPipeline(stMap);
  }

  useEffect(() => {
    loadAll();
  }, []);

  const pname = (pid?: string | null) => (pid ? (pipelines[pid] ?? pid) : "—");
  const sname = (pid?: string | null, sid?: string | null) =>
    pid && sid ? (statusesByPipeline[pid]?.[sid] ?? sid) : "—";

  return (
    <div className="p-4 sm:p-6">
      <div className="max-w-6xl mx-auto">
        <div className="mb-4 flex items-center justify-between">
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

        <div className="overflow-x-auto rounded-2xl">
          {/* border-separate + spacing — імітація «без рамок», але все акуратно розкладено */}
          <table className="min-w-full table-fixed border-separate border-spacing-y-2">
            <colgroup>
              <col className="w-[220px]" /> {/* Дата */}
              <col className="w-[160px]" />  {/* Назва */}
              <col className="w-[120px]" />  {/* Сутність */}
              <col />                        {/* Воронка */}
              <col />                        {/* Статус */}
              <col className="w-[140px]" />  {/* Тригер */}
              <col className="w-[80px]" />   {/* Стан */}
              <col className="w-[120px]" />  {/* Дії */}
            </colgroup>

            <thead>
              <tr className="text-center text-gray-600">
                <th className="py-2">Дата</th>
                <th className="py-2">Назва</th>
                <th className="py-2">Сутність</th>
                <th className="py-2">Воронка</th>
                <th className="py-2">Статус</th>
                <th className="py-2">Тригер</th>
                <th className="py-2">Стан</th>
                <th className="py-2">Дії</th>
              </tr>
            </thead>

            <tbody>
              {items.map((c) => {
                const rows = [
                  {
                    label: "База",
                    pipeline: pname(c.base_pipeline_id),
                    status: sname(c.base_pipeline_id, c.base_status_id),
                    trigger: "",
                  },
                  {
                    label: "V1",
                    pipeline: pname(c.v1_to_pipeline_id),
                    status: sname(c.v1_to_pipeline_id, c.v1_to_status_id),
                    trigger: c.v1_value || "",
                  },
                ] as {
                  label: string;
                  pipeline: string;
                  status: string;
                  trigger: string;
                }[];

                if (c.v2_enabled) {
                  rows.push({
                    label: "V2",
                    pipeline: pname(c.v2_to_pipeline_id),
                    status: sname(c.v2_to_pipeline_id, c.v2_to_status_id),
                    trigger: c.v2_value || "",
                  });
                }

                rows.push({
                  label: "EXP",
                  pipeline: pname(c.exp_to_pipeline_id),
                  status: sname(c.exp_to_pipeline_id, c.exp_to_status_id),
                  trigger: `${c.exp_days} днів`,
                });

                const rowSpan = rows.length;

                return (
                  <tr key={c.id} className="align-middle bg-white/80 shadow-sm rounded-xl">
                    {/* Дата */}
                    <td className="py-3 text-center" rowSpan={rowSpan}>
                      <div className="text-gray-900">
                        {new Date(c.created_at).toLocaleString("uk-UA")}
                      </div>
                    </td>

                    {/* Назва */}
                    <td className="py-3 text-center font-semibold" rowSpan={rowSpan}>
                      {c.name}
                    </td>

                    {/* перший ряд «База» */}
                    <td className="py-3 text-center">{rows[0].label}</td>
                    <td className="py-3 text-center">{rows[0].pipeline}</td>
                    <td className="py-3 text-center">{rows[0].status}</td>
                    <td className="py-3 text-center">{rows[0].trigger || "—"}</td>

                    {/* Стан (yes/no) одна клітинка на всю групу */}
                    <td className="py-3 text-center" rowSpan={rowSpan}>
                      {c.enabled ? "yes" : "no"}
                    </td>

                    {/* Дії одна клітинка на всю групу */}
                    <td className="py-3 text-center whitespace-nowrap" rowSpan={rowSpan}>
                      <a
                        className="text-blue-600 hover:underline mr-3"
                        href={`/admin/campaigns/${c.id}/edit`}
                      >
                        Edit
                      </a>
                      <a
                        className="text-red-600 hover:underline"
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
                      >
                        Delete
                      </a>
                    </td>
                  </tr>
                );
              }).flatMap((cRow, idx) => {
                // додаткові рядки для V1/V2/EXP (рендеримо їх одразу після першого)
                const c = items[idx];
                if (!c) return [];
                const rows: {
                  label: string;
                  pipeline: string;
                  status: string;
                  trigger: string;
                }[] = [];

                rows.push({
                  label: "V1",
                  pipeline: pname(c.v1_to_pipeline_id),
                  status: sname(c.v1_to_pipeline_id, c.v1_to_status_id),
                  trigger: c.v1_value || "",
                });

                if (c.v2_enabled) {
                  rows.push({
                    label: "V2",
                    pipeline: pname(c.v2_to_pipeline_id),
                    status: sname(c.v2_to_pipeline_id, c.v2_to_status_id),
                    trigger: c.v2_value || "",
                  });
                }

                rows.push({
                  label: "EXP",
                  pipeline: pname(c.exp_to_pipeline_id),
                  status: sname(c.exp_to_pipeline_id, c.exp_to_status_id),
                  trigger: `${c.exp_days} днів`,
                });

                // перший ряд уже відрендерили у <tbody> вище,
                // а тут генеруємо решту рядків для цієї кампанії:
                return rows.slice(1).map((r, i) => (
                  <tr key={`extra-${c.id}-${i}`} className="align-middle bg-white/80 shadow-sm">
                    <td className="py-3 text-center">{r.label}</td>
                    <td className="py-3 text-center">{r.pipeline}</td>
                    <td className="py-3 text-center">{r.status}</td>
                    <td className="py-3 text-center">{r.trigger || "—"}</td>
                  </tr>
                ));
              })}
              {!items.length && (
                <tr>
                  <td className="py-10 text-center text-gray-500" colSpan={8}>
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
