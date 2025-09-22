// web/app/(admin)/campaigns/page.tsx
import { cookies } from "next/headers";
import Link from "next/link";

type Rule = { op?: "contains" | "equals"; value?: string };
type Campaign = {
  id?: string;
  name?: string;
  created_at?: number;
  active?: boolean;

  base_pipeline_id?: number;
  base_status_id?: number;
  base_pipeline_name?: string | null;
  base_status_name?: string | null;

  rules?: {
    v1?: Rule;
    v2?: Rule;
  };

  exp?: {
    to_pipeline_id?: number;
    to_status_id?: number;
    to_pipeline_name?: string | null;
    to_status_name?: string | null;
    trigger?: Rule;
  };

  v1_count?: number;
  v2_count?: number;
  exp_count?: number;
};

function fmtDate(ts?: number) {
  if (!ts) return "—";
  try {
    const d = new Date(ts);
    return d.toLocaleString();
  } catch {
    return String(ts);
  }
}

function RuleBadge({ label, rule }: { label: string; rule?: Rule }) {
  if (!rule || (!rule.value && !rule.op)) return null;
  return (
    <div className="inline-flex items-center gap-2 text-xs rounded border px-2 py-1">
      <span className="opacity-60">{label}</span>
      <span className="font-mono">{rule.op || "contains"}</span>
      <span className="font-mono">“{rule.value || ""}”</span>
    </div>
  );
}

function PairCell({
  pipelineName,
  statusName,
  pipelineId,
  statusId,
}: {
  pipelineName?: string | null;
  statusName?: string | null;
  pipelineId?: number;
  statusId?: number;
}) {
  const p = pipelineName ?? undefined;
  const s = statusName ?? undefined;
  return (
    <span className="whitespace-nowrap">
      {(p ?? pipelineId ?? "—")} → {(s ?? statusId ?? "—")}
    </span>
  );
}

export const dynamic = "force-dynamic";

export default async function CampaignsPage() {
  const token = cookies().get("admin_token")?.value?.trim() || "";

  let items: Campaign[] = [];
  let error: string | null = null;

  if (!token) {
    error =
      "Немає admin_token у cookies. Введи токен на сторінці створення кампанії (праворуч вгорі).";
  } else {
    try {
      const urlBase =
        process.env.NEXT_PUBLIC_BASE_URL && process.env.NEXT_PUBLIC_BASE_URL.length > 0
          ? process.env.NEXT_PUBLIC_BASE_URL
          : "";
      const res = await fetch(
        `${urlBase}/api/campaigns?token=${encodeURIComponent(token)}`,
        { cache: "no-store" }
      ).catch(() =>
        fetch(`/api/campaigns?token=${encodeURIComponent(token)}`, { cache: "no-store" })
      );

      const json = await res.json().catch(() => ({} as any));
      if (!res.ok || !json?.ok) {
        error =
          json?.error ||
          (res.status === 401
            ? "Unauthorized: missing or invalid admin token"
            : `Fetch error: ${res.status} ${res.statusText}`);
      } else {
        items = Array.isArray(json.items) ? (json.items as Campaign[]) : [];
      }
    } catch (e: any) {
      error = e?.message || String(e);
    }
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold">Campaigns</h1>
        <Link
          href="/admin/campaigns/new"
          className="ml-auto bg-black text-white px-3 py-2 rounded hover:opacity-90"
        >
          + New
        </Link>
      </div>

      {error ? (
        <div className="border border-red-300 bg-red-50 text-red-700 rounded p-3 text-sm">
          {error}
        </div>
      ) : null}

      <div className="overflow-x-auto rounded-lg border">
        <table className="min-w-full text-sm">
          <thead className="bg-gray-50">
            <tr className="text-left">
              <th className="px-4 py-2">Created</th>
              <th className="px-4 py-2">Name / Active</th>
              <th className="px-4 py-2">V1 Base</th>
              <th className="px-4 py-2">V1 Rule</th>
              <th className="px-4 py-2">V2 Rule</th>
              <th className="px-4 py-2">EXP Move</th>
              <th className="px-4 py-2">EXP Trigger</th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 ? (
              <tr>
                <td className="px-4 py-6 text-center text-gray-500" colSpan={7}>
                  Кампаній немає або фільтр порожний.
                </td>
              </tr>
            ) : (
              items.map((c) => (
                <tr key={c.id || Math.random()} className="border-t">
                  <td className="px-4 py-2">{fmtDate(c.created_at)}</td>

                  <td className="px-4 py-2">
                    <div className="font-medium">{c.name || "—"}</div>
                    <div className="text-xs opacity-60">
                      id: {c.id || "—"} · {c.active ? "active" : "inactive"}
                    </div>
                  </td>

                  <td className="px-4 py-2">
                    <PairCell
                      pipelineName={c.base_pipeline_name}
                      statusName={c.base_status_name}
                      pipelineId={c.base_pipeline_id}
                      statusId={c.base_status_id}
                    />
                  </td>

                  <td className="px-4 py-2">
                    <RuleBadge label="v1" rule={c.rules?.v1} />
                  </td>

                  <td className="px-4 py-2">
                    <RuleBadge label="v2" rule={c.rules?.v2} />
                  </td>

                  <td className="px-4 py-2">
                    {c.exp ? (
                      <PairCell
                        pipelineName={c.exp.to_pipeline_name}
                        statusName={c.exp.to_status_name}
                        pipelineId={c.exp.to_pipeline_id}
                        statusId={c.exp.to_status_id}
                      />
                    ) : (
                      <span className="opacity-50">—</span>
                    )}
                  </td>

                  <td className="px-4 py-2">
                    <RuleBadge label="exp" rule={c.exp?.trigger} />
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="text-xs text-gray-500">
        Якщо не бачиш нову кампанію — перевір: 1) правильний <code>ADMIN_TOKEN</code> у cookie{" "}
        <code>admin_token</code>; 2) сторінка створення зберігає назви воронок/статусів разом з id;
        3) бекенд повертає їх у відповіді списку.
      </div>
    </div>
  );
}
