// web/app/(admin)/campaigns/page.tsx
import { headers } from "next/headers";

export const dynamic = "force-dynamic";

type Campaign = {
  id?: string | number;
  name?: string;
  created_at?: number;
  base_pipeline_name?: string | null;
  base_status_name?: string | null;
  base_pipeline_id?: number | string;
  base_status_id?: number | string;
  rules?: {
    v1?: { op?: "contains" | "equals"; value?: string };
    v2?: { op?: "contains" | "equals"; value?: string };
  };
  v1_count?: number;
  v2_count?: number;
  exp_count?: number;
};

async function getCampaigns(): Promise<{ ok: boolean; items: Campaign[] }> {
  const h = headers();
  const host = h.get("host")!;
  const proto =
    (h.get("x-forwarded-proto") || "").includes("https") ? "https" : "https";
  const url = `${proto}://${host}/api/campaigns`;

  // Проксую cookie поточного запиту до API
  const cookie = h.get("cookie") ?? "";
  const res = await fetch(url, {
    method: "GET",
    cache: "no-store",
    headers: { cookie },
  });

  if (!res.ok) {
    // Повертаємо порожній список щоб хоч якось відрендеритись,
    // але показуємо код відповіді всередині UI для дебагу.
    return { ok: false, items: [] };
  }
  const data = await res.json();
  return { ok: !!data?.ok, items: data?.items || [] };
}

export default async function CampaignsPage() {
  const { ok, items } = await getCampaigns();

  return (
    <main className="px-6 py-6">
      <h1 className="text-3xl font-semibold mb-6">Кампанії</h1>

      {!ok && (
        <div className="mb-4 rounded-md border border-amber-300 bg-amber-50 p-3 text-amber-800">
          Не вдалося отримати дані (можливо не встановлено адмін-доступ).
          Спробуй відкрити{" "}
          <a
            className="underline"
            href="/api/auth/set?token=11111"
          >
            /api/auth/set?token=11111
          </a>{" "}
          і потім перезавантаж сторінку.
        </div>
      )}

      <div className="rounded-2xl border p-6">
        {items.length === 0 ? (
          <div className="text-center text-gray-500 py-16">
            Кампаній поки немає
          </div>
        ) : (
          <table className="w-full border-collapse">
            <thead>
              <tr className="text-left text-gray-600">
                <th className="py-2 pr-4">Дата</th>
                <th className="py-2 pr-4">Назва</th>
                <th className="py-2 pr-4">Сутність</th>
                <th className="py-2 pr-4">Воронка</th>
                <th className="py-2 pr-4">Лічильник</th>
              </tr>
            </thead>
            <tbody>
              {items.map((c) => (
                <tr key={String(c.id)} className="border-t">
                  <td className="py-2 pr-4">
                    {c.created_at
                      ? new Date(c.created_at).toLocaleString()
                      : "—"}
                  </td>
                  <td className="py-2 pr-4">{c.name ?? "—"}</td>
                  <td className="py-2 pr-4">База / V1 / EXP</td>
                  <td className="py-2 pr-4">
                    {(c.base_pipeline_name ?? c.base_pipeline_id ?? "—") +
                      " → " +
                      (c.base_status_name ?? c.base_status_id ?? "—")}
                  </td>
                  <td className="py-2 pr-4">
                    {(c.v1_count ?? 0) + (c.v2_count ?? 0) + (c.exp_count ?? 0)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </main>
  );
}
