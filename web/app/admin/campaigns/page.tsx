// web/app/admin/campaigns/page.tsx
export const dynamic = 'force-dynamic';
export const revalidate = 0;

import React from "react";
import { headers } from "next/headers";

type Campaign = {
  id: string;
  created_at: string | number;
  name: string;
  base_pipeline_id: string | null;
  base_status_id: string | null;
  v1_condition?: { field: string; op: string; value: string } | null;
  v1_to_pipeline_id?: string | null;
  v1_to_status_id?: string | null;
  v2_condition?: { field: string; op: string; value: string } | null;
  v2_to_pipeline_id?: string | null;
  v2_to_status_id?: string | null;
  exp_days?: number;
  exp_to_pipeline_id?: string | null;
  exp_to_status_id?: string | null;
  enabled?: boolean;
  v1_count?: number;
  v2_count?: number;
  exp_count?: number;
};

function arr(x: any): any[] {
  if (Array.isArray(x)) return x;
  if (x && typeof x === "object") {
    for (const k of ["items", "data", "result", "rows", "campaigns"]) {
      const v = (x as any)[k];
      if (Array.isArray(v)) return v;
      if (v && typeof v === "object" && Array.isArray((v as any).items)) {
        return (v as any).items;
      }
    }
  }
  return [];
}

function ts(v: any): number {
  if (typeof v === "number") return v;
  const n = Date.parse(String(v ?? ""));
  return Number.isFinite(n) ? n : 0;
}

function essence(c: Campaign) {
  const base = `${c.base_pipeline_id ?? "—"}/${c.base_status_id ?? "—"}`;
  const v1 = `v1: —→ ${c.v1_to_pipeline_id ?? "—"}/${c.v1_to_status_id ?? "—"}`;
  const v2 = `; v2: —→ ${c.v2_to_pipeline_id ?? "—"}/${c.v2_to_status_id ?? "—"}`;
  const exp =
    typeof c.exp_days === "number"
      ? `; exp (${c.exp_days} д.): —→ ${c.exp_to_pipeline_id ?? "—"}/${c.exp_to_status_id ?? "—"}`
      : "";
  return `${base} — ${v1}${v2}${exp}`;
}

async function fetchCampaigns(): Promise<Campaign[]> {
  // Надійно формуємо origin (Vercel/локально)
  const h = headers();
  const host =
    h.get("x-forwarded-host") ??
    h.get("host") ??
    process.env.VERCEL_URL ??
    "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.includes("localhost") ? "http" : "https");
  const origin = `${proto}://${host}`;

  const r = await fetch(`${origin}/api/campaigns`, {
    cache: "no-store",
    // на всяк випадок
    next: { revalidate: 0 },
  }).catch(() => null as any);

  if (!r || !r.ok) return [];
  const j = await r.json().catch(() => ({}));
  const items = arr(j);
  items.sort((a: any, b: any) => ts(b?.created_at) - ts(a?.created_at));
  return items as Campaign[];
}

export default async function CampaignsPage() {
  const items = await fetchCampaigns();

  return (
    <div className="mx-auto max-w-6xl p-6">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-3xl font-semibold">Кампанії</h1>
        <a
          href="/admin/campaigns/new"
          className="rounded-2xl bg-blue-600 text-white px-4 py-2"
        >
          Нова кампанія
        </a>
      </div>

      <div className="rounded-2xl border overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-gray-600">
            <tr>
              <th className="text-left px-4 py-3">Дата</th>
              <th className="text-left px-4 py-3">Назва</th>
              <th className="text-left px-4 py-3">Сутність</th>
              <th className="text-left px-4 py-3">Статус</th>
              <th className="text-left px-4 py-3">Дії</th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-10 text-center text-gray-500">
                  Поки що порожньо.
                </td>
              </tr>
            ) : (
              items.map((c) => (
                <tr key={c.id} className="border-t">
                  <td className="px-4 py-3">
                    {new Date(ts(c.created_at)).toLocaleString()}
                  </td>
                  <td className="px-4 py-3 font-medium">{c.name}</td>
                  <td className="px-4 py-3">{essence(c)}</td>
                  <td className="px-4 py-3">{c.enabled ? "yes" : "no"}</td>
                  <td className="px-4 py-3">
                    <a
                      href={`/admin/campaigns/${c.id}/edit`}
                      className="underline"
                    >
                      Edit
                    </a>
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
