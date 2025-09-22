// web/app/(admin)/campaigns/page.tsx
import Link from "next/link";

export const dynamic = "force-dynamic";

type Rule = {
  op?: "contains" | "equals";
  value?: string;
};

type Campaign = {
  id?: string;
  name?: string;

  // база (V1)
  base_pipeline_id?: number;
  base_status_id?: number;
  base_pipeline_name?: string | null;
  base_status_name?: string | null;

  // правила
  rules?: {
    v1?: Rule;
    v2?: Rule;
  };

  // експерименти
  exp?: {
    to_pipeline_id?: number;
    to_status_id?: number;
    to_pipeline_name?: string | null;
    to_status_name?: string | null;
    trigger?: Rule;
  };

  // діагн./агрегації (опційні)
  v1_count?: number;
  v2_count?: number;
  exp_count?: number;

  created_at?: number;
  active?: boolean;
};

async function fetchCampaigns(): Promise<Campaign[]> {
  const res = await fetch(`${process.env.NEXT_PUBLIC_BASE_URL || ""}/api/campaigns`, {
    cache: "no-store",
    headers: { "x-no-cache": "1" },
  }).catch(() => null);

  if (!res || !res.ok) return [];

  const data = (await res.json().catch(() => null)) as any;
  const items = (data?.items || []) as Campaign[];
  return items;
}

function safeNameOrId(name?: string | null, id?: number | string) {
  if (name && String(name).trim()) return name;
  return id ?? "";
}

function RuleView({ label, rule }: { label: string; rule?: Rule }) {
  if (!rule || !rule.value) return (
    <div className="text-sm text-gray-400">—</div>
  );
  return (
    <div className="text-sm">
      <span className="px-1.5 py-0.5 rounded bg-gray-100 text-gray-700 mr-2">{label}</span>
      <span className="uppercase text-xs tracking-wide text-gray-500 mr-2">{rule.op || "contains"}</span>
      <span className="font-mono">{rule.value}</span>
    </div>
  );
}

export default async function CampaignsPage() {
  const campaigns = await fetchCampaigns();

  return (
    <main className="p-6">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-semibold">Campaigns</h1>
        <div className="flex gap-3">
          <Link
            href="/admin/campaigns/new"
            className="px-3 py-2 rounded-xl bg-black text-white hover:opacity-90"
          >
            + New campaign
          </Link>
          <Link
            href="/admin"
            className="px-3 py-2 rounded-xl border hover:bg-gray-50"
          >
            Admin home
          </Link>
        </div>
      </div>

      {(!campaigns || campaigns.length === 0) ? (
        <div className="rounded-xl border p-6 bg-white">
          <div className="text-gray-600">Поки що немає кампаній.</div>
          <div className="mt-3">
            <Link href="/admin/campaigns/new" className="text-blue-600 hover:underline">
              Створити першу кампанію →
            </Link>
          </div>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border bg-white">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50 text-left">
              <tr>
                <th className="px-4 py-3 font-medium">ID</th>
                <th className="px-4 py-3 font-medium">Name</th>
                <th className="px-4 py-3 font-medium">V1 Base (pipeline → status)</th>
                <th className="px-4 py-3 font-medium">V1</th>
                <th className="px-4 py-3 font-medium">V2</th>
                <th className="px-4 py-3 font-medium">EXP</th>
                <th className="px-4 py-3 font-medium">Active</th>
                <th className="px-4 py-3 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {campaigns.map((c) => {
                const v1 = c.rules?.v1;
                const v2 = c.rules?.v2;

                const basePipe = safeNameOrId(c.base_pipeline_name ?? undefined, c.base_pipeline_id ?? "");
                const baseStatus = safeNameOrId(c.base_status_name ?? undefined, c.base_status_id ?? "");

                const expPipe = safeNameOrId(c.exp?.to_pipeline_name ?? undefined, c.exp?.to_pipeline_id ?? "");
                const expStatus = safeNameOrId(c.exp?.to_status_name ?? undefined, c.exp?.to_status_id ?? "");

                return (
                  <tr key={String(c.id ?? Math.random())} className="border-t">
                    <td className="px-4 py-3 font-mono text-gray-600">{c.id ?? "—"}</td>
                    <td className="px-4 py-3">{c.name ?? "—"}</td>

                    <td className="px-4 py-3">
                      <div className="text-sm">
                        <div className="font-medium">{basePipe || "—"} <span className="text-gray-400">→</span> {baseStatus || "—"}</div>
                        <div className="text-xs text-gray-500 mt-1">
                          {typeof c.base_pipeline_id !== "undefined" && typeof c.base_status_id !== "undefined" ? (
                            <>IDs: {c.base_pipeline_id} → {c.base_status_id}</>
                          ) : "IDs: —"}
                        </div>
                      </div>
                    </td>

                    <td className="px-4 py-3">
                      <RuleView label="V1" rule={v1} />
                      {typeof c.v1_count === "number" && (
                        <div className="text-xs text-gray-500 mt-1">count: {c.v1_count}</div>
                      )}
                    </td>

                    <td className="px-4 py-3">
                      {/* 👇 тепер V2 відображається завжди, якщо є value */}
                      <RuleView label="V2" rule={v2} />
                      {typeof c.v2_count === "number" && (
                        <div className="text-xs text-gray-500 mt-1">count: {c.v2_count}</div>
                      )}
                    </td>

                    <td className="px-4 py-3">
                      <div className="text-sm">
                        <div className="font-medium">
                          {expPipe || "—"} <span className="text-gray-400">→</span> {expStatus || "—"}
                        </div>
                        <div className="text-xs text-gray-500 mt-1">
                          {typeof c.exp?.to_pipeline_id !== "undefined" && typeof c.exp?.to_status_id !== "undefined"
                            ? <>IDs: {c.exp?.to_pipeline_id} → {c.exp?.to_status_id}</>
                            : "IDs: —"}
                        </div>
                      </div>
                      <div className="mt-2">
                        <RuleView label="EXP" rule={c.exp?.trigger} />
                        {typeof c.exp_count === "number" && (
                          <div className="text-xs text-gray-500 mt-1">count: {c.exp_count}</div>
                        )}
                      </div>
                    </td>

                    <td className="px-4 py-3">
                      {c.active ? (
                        <span className="inline-block px-2 py-0.5 rounded-full bg-green-100 text-green-700 text-xs">active</span>
                      ) : (
                        <span className="inline-block px-2 py-0.5 rounded-full bg-gray-100 text-gray-600 text-xs">inactive</span>
                      )}
                    </td>

                    <td className="px-4 py-3">
                      <Link
                        className="text-blue-600 hover:underline"
                        href={`/admin/campaigns/${c.id}/edit`}
                      >
                        Edit →
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
