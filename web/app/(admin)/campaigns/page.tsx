// web/app/(admin)/campaigns/page.tsx
import { redis } from "@/lib/redis";

export const dynamic = "force-dynamic";

type Rule = { op?: "contains" | "equals"; value?: string };
type Campaign = {
  id: string;
  name?: string;

  base_pipeline_id?: number;
  base_status_id?: number;
  base_pipeline_name?: string | null;
  base_status_name?: string | null;

  rules?: { v1?: Rule; v2?: Rule };

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

  created_at?: number;
  active?: boolean;
};

const NS = "campaigns";
const INDEX_KEY = `${NS}:index`;
const ITEM_KEY = (id: string) => `${NS}:${id}`;

async function loadCampaigns(): Promise<Campaign[]> {
  "use server";
  try {
    const ids = (await redis.zrange(INDEX_KEY, 0, -1, { rev: true })) as string[];
    const out: Campaign[] = [];
    for (const id of ids || []) {
      const raw = await redis.get(ITEM_KEY(id));
      if (!raw) continue;
      try {
        out.push(JSON.parse(raw) as Campaign);
      } catch {
        // skip broken
      }
    }
    return out;
  } catch {
    return [];
  }
}

function KV({ k, v }: { k: string; v: any }) {
  const val =
    v === null || v === undefined
      ? "—"
      : typeof v === "object"
      ? JSON.stringify(v)
      : String(v);
  return (
    <div className="text-xs text-gray-500">
      <span className="font-mono text-gray-400">{k}:</span> {val}
    </div>
  );
}

function RuleBadge({ label, rule }: { label: string; rule?: Rule }) {
  if (!rule?.value) return null;
  return (
    <div className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs">
      <span className="font-semibold">{label}</span>
      <span className="opacity-70">{rule.op || "contains"}</span>
      <span className="font-mono">“{rule.value}”</span>
    </div>
  );
}

function Pair({
  id,
  name,
}: {
  id?: number;
  name?: string | null;
}) {
  if (!id && !name) return <span className="opacity-50">—</span>;
  return (
    <div className="flex flex-col leading-tight">
      <span>{name ?? "—"}</span>
      {id ? <span className="text-xs text-gray-500">id: {id}</span> : null}
    </div>
  );
}

export default async function Page() {
  const items = await loadCampaigns();

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold">Campaigns</h1>
        <a
          href="/admin/campaigns/new"
          className="rounded-xl border px-4 py-2 text-sm hover:bg-gray-50"
        >
          + New Campaign
        </a>
      </div>

      {items.length === 0 ? (
        <div className="rounded-xl border p-8 text-center text-gray-500">
          Campaign list is empty.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="bg-gray-50 text-left">
                <th className="px-4 py-3">Name / ID</th>
                <th className="px-4 py-3">V1 (Base)</th>
                <th className="px-4 py-3">Rules</th>
                <th className="px-4 py-3">V2</th>
                <th className="px-4 py-3">EXP → Target</th>
                <th className="px-4 py-3">Counts</th>
                <th className="px-4 py-3">Created</th>
                <th className="px-4 py-3">Active</th>
              </tr>
            </thead>
            <tbody>
              {items.map((c) => (
                <tr key={c.id} className="border-t">
                  <td className="px-4 py-3 align-top">
                    <div className="font-medium">{c.name || "—"}</div>
                    <KV k="id" v={c.id} />
                  </td>

                  <td className="px-4 py-3 align-top">
                    <div className="font-semibold mb-1">Base pipeline/status</div>
                    <div className="grid grid-cols-2 gap-3">
                      <Pair
                        id={c.base_pipeline_id}
                        name={c.base_pipeline_name ?? undefined}
                      />
                      <Pair
                        id={c.base_status_id}
                        name={c.base_status_name ?? undefined}
                      />
                    </div>
                  </td>

                  <td className="px-4 py-3 align-top">
                    <div className="flex flex-col gap-1">
                      <RuleBadge label="V1" rule={c.rules?.v1} />
                      <RuleBadge label="V2" rule={c.rules?.v2} />
                      {c.exp?.trigger ? (
                        <RuleBadge label="EXP" rule={c.exp?.trigger} />
                      ) : null}
                    </div>
                  </td>

                  <td className="px-4 py-3 align-top">
                    {/* окрема колонка для явного показу V2 value/op */}
                    {c.rules?.v2?.value ? (
                      <div className="flex flex-col">
                        <div className="font-medium">V2</div>
                        <div className="text-xs text-gray-600">
                          {c.rules?.v2?.op || "contains"}{" "}
                          <span className="font-mono">“{c.rules?.v2?.value}”</span>
                        </div>
                      </div>
                    ) : (
                      <span className="opacity-50">—</span>
                    )}
                  </td>

                  <td className="px-4 py-3 align-top">
                    <div className="font-semibold mb-1">Experiment target</div>
                    <div className="grid grid-cols-2 gap-3">
                      <Pair
                        id={c.exp?.to_pipeline_id}
                        name={c.exp?.to_pipeline_name ?? undefined}
                      />
                      <Pair
                        id={c.exp?.to_status_id}
                        name={c.exp?.to_status_name ?? undefined}
                      />
                    </div>
                  </td>

                  <td className="px-4 py-3 align-top">
                    <KV k="v1_count" v={c.v1_count ?? 0} />
                    <KV k="v2_count" v={c.v2_count ?? 0} />
                    <KV k="exp_count" v={c.exp_count ?? 0} />
                  </td>

                  <td className="px-4 py-3 align-top">
                    {c.created_at
                      ? new Date(c.created_at).toLocaleString()
                      : "—"}
                  </td>

                  <td className="px-4 py-3 align-top">
                    {c.active !== false ? (
                      <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs text-green-700">
                        active
                      </span>
                    ) : (
                      <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600">
                        inactive
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
