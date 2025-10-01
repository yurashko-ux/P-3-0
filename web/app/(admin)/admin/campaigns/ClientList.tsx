// web/app/(admin)/admin/campaigns/ClientList.tsx
"use client";

import { useEffect, useState } from "react";

type Row = {
  id: string;
  name: string;
  base?: { pipelineName?: string; statusName?: string };
  counters?: { v1?: number; v2?: number; exp?: number };
};

export default function ClientList() {
  const [rows, setRows] = useState<Row[] | null>(null);

  async function refresh() {
    setRows(null);
    try {
      const r = await fetch("/api/campaigns", { cache: "no-store" });
      const j = await r.json();
      setRows(Array.isArray(j.items) ? j.items : []);
    } catch {
      setRows([]);
    }
  }

  useEffect(() => { refresh(); }, []);

  if (rows === null) {
    return (
      <tr>
        <td colSpan={6} className="py-10 text-center text-gray-500">
          Завантаження…
        </td>
      </tr>
    );
  }

  if (!rows.length) {
    return (
      <tr>
        <td colSpan={6} className="py-10 text-center text-gray-500">
          Кампаній поки немає
        </td>
      </tr>
    );
  }

  return (
    <>
      {rows.map((r) => (
        <tr key={r.id} className="border-t">
          <td className="px-4 py-2 text-sm text-gray-600">
            <div>—</div>
            <div className="text-xs text-gray-400">ID: {r.id}</div>
          </td>
          <td className="px-4 py-2">{r.name || "—"}</td>
          <td className="px-4 py-2">
            v1: {r.counters?.v1 ?? 0} · v2: {r.counters?.v2 ?? 0}
          </td>
          <td className="px-4 py-2">
            {r.base?.pipelineName ?? "—"}
            {" · "}
            {r.base?.statusName ?? "—"}
          </td>
          <td className="px-4 py-2">
            v1: {r.counters?.v1 ?? 0} · v2: {r.counters?.v2 ?? 0} · exp: {r.counters?.exp ?? 0}
          </td>
          <td className="px-4 py-2">
            <form action="/api/campaigns/delete" method="post" onSubmit={() => setTimeout(refresh, 150)}>
              <input type="hidden" name="id" value={r.id} />
              <button
                type="submit"
                className="rounded bg-red-600 px-3 py-1.5 text-white hover:bg-red-700"
              >
                Видалити
              </button>
            </form>
          </td>
        </tr>
      ))}
    </>
  );
}
